import { addAbortListener } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import {
  awaitGateBeforeSettlement,
  createDeferred,
  nextEventLoopTurn,
  withinTest,
} from "../../../../test/helpers/promise.js";
import { clearRuntimeConfigSnapshot } from "../../../config/runtime-snapshot.js";
import { createAgentRunPreparationTrace } from "../../../gateway/agent-turn/agent-run-preparation-trace.js";
import { resetAgentEventsForTest } from "../../../infra/agent-events.js";
import { withDiagnosticsTimelineObserver } from "../../../infra/diagnostics-timeline.js";
import { setCommandLaneConcurrency } from "../../../process/command-queue.js";
import { resetCommandQueueStateForTest } from "../../../process/command-queue.test-support.js";
import { testing } from "../../../sessions/session-controller.test-support.js";
import { createTestAdmittedRunContext } from "../../admitted-run-context.test-support.js";
import { createLaneControllerFixture } from "./lane-controller.test-support.js";

// Same isolation as the existing custody fixture: real mailbox/capacity owners, no durable writer.
vi.mock("./session-bootstrap.js", () => ({
  claimAgentSessionWriter: vi.fn(async () => undefined),
}));
afterEach(() => {
  testing.resetSessionControllerForTest();
  resetCommandQueueStateForTest();
  resetAgentEventsForTest();
  clearRuntimeConfigSnapshot();
});
it.for(["cancel", "resume"])(
  "observes real mailbox/capacity %s without leaking request context",
  async (mode, { signal }) => {
    const lane = "test:trace-capacity";
    setCommandLaneConcurrency(lane, 1);
    const create = (runId: string, sessionKey: string, abortSignal?: AbortSignal) =>
      createLaneControllerFixture(
        {
          admittedRunContext: createTestAdmittedRunContext(runId),
          runId,
          sessionKey,
          sessionId: sessionKey,
          sessionFile: "synthetic-session",
          workspaceDir: "/synthetic-workspace",
          prompt: "private fixture",
          timeoutMs: 30_000,
          abortSignal,
        },
        { globalLane: lane },
      ).controller;
    const sameSession = "agent:main:trace-wait";
    const owner = create("mailbox-owner", sameSession);
    const capacity = create("capacity-owner", "agent:main:other");
    const controller = new AbortController();
    const candidate = create("waiting-candidate", sameSession, controller.signal);
    const ownerEntered = createDeferred();
    const capacityEntered = createDeferred();
    const releaseOwner = createDeferred();
    const releaseCapacity = createDeferred();
    const queued = createDeferred();
    const first = owner.enqueueSession(async () => {
      ownerEntered.resolve();
      await releaseOwner.promise;
    });
    const capacitySpans: string[] = [];
    const second = withDiagnosticsTimelineObserver(
      (name) => {
        capacitySpans.push(name);
      },
      () =>
        capacity.enqueueSession(() =>
          capacity.enqueueGlobal(async () => {
            capacityEntered.resolve();
            await releaseCapacity.promise;
            return { meta: { durationMs: 0 } };
          }),
        ),
    );
    const trace = createAgentRunPreparationTrace("waiting-candidate");
    const active = new Set<string>();
    const observed: string[] = [];
    using _ = addAbortListener(controller.signal, trace.observeAbort);
    await Promise.all([ownerEntered.promise, capacityEntered.promise]);
    const execute = vi.fn(async () => {
      expect(active.size).toBe(0);
      return { meta: { durationMs: 0 } };
    });
    const work = withDiagnosticsTimelineObserver(
      (name, attributes, duration) => {
        observed.push(name);
        const finish = trace.observeSpan(name, attributes, duration);
        active.add(name);
        return () => {
          active.delete(name);
          finish?.();
        };
      },
      () =>
        candidate.enqueueSession(() =>
          candidate.enqueueGlobal(execute, { onQueued: queued.resolve }),
        ),
    ).then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    try {
      await nextEventLoopTurn();
      expect([...active]).toEqual(["agent.runner.session-admission"]);
      expect(execute).not.toHaveBeenCalled();
      releaseOwner.resolve();
      await withinTest(
        awaitGateBeforeSettlement(queued.promise, work, "candidate never reached capacity queue"),
        signal,
      );
      expect([...active]).toEqual(["agent.runner.global-admission"]);
      const otherRequestSpans = [...capacitySpans];
      if (mode === "cancel") {
        controller.abort();
        const frozen = JSON.stringify(trace.finish(true));
        expect(trace.finish(true).abortSnapshot?.active).toEqual([
          { stage: "runner_global_admission", elapsedMs: expect.any(Number) },
        ]);
        releaseCapacity.resolve();
        await work;
        expect(execute).not.toHaveBeenCalled();
        expect(JSON.stringify(trace.finish(true))).toBe(frozen);
      } else {
        releaseCapacity.resolve();
        const outcome = await work;
        expect(outcome).not.toHaveProperty("error");
        expect(execute).toHaveBeenCalledOnce();
        expect(observed).toContain("agent.runner.writer");
        expect(observed).toContain("agent.runner.turn-admission");
      }
      expect(capacitySpans).toEqual(otherRequestSpans);
      expect(active.size).toBe(0);
    } finally {
      releaseOwner.resolve();
      releaseCapacity.resolve();
      await Promise.all([first, second, work]);
    }
  },
);
