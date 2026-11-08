import { addAbortListener } from "node:events";
import path from "node:path";
import { expectDefined } from "@openclaw/normalization-core/expect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { awaitGateBeforeSettlement, createDeferred } from "../../../test/helpers/promise.js";
import {
  setRuntimeConfigSnapshot,
  clearRuntimeConfigSnapshot,
} from "../../config/runtime-snapshot.js";
import { dispatchAgentRunFromGateway } from "../../gateway/agent-turn/agent-run-dispatch.js";
import { createAgentTurnTestContext } from "../../gateway/agent-turn/agent-run-dispatch.test-support.js";
import { createAgentRunPreparationTrace } from "../../gateway/agent-turn/agent-run-preparation-trace.js";
import { withDiagnosticsTimelineObserver } from "../../infra/diagnostics-timeline.js";
import * as admission from "../../sessions/session-controller.admission.js";
import { withSessionTurn } from "../../sessions/session-controller.admission.js";
import * as trajectory from "../../trajectory/runtime.js";
import {
  compactionTestState as state,
  compactionTestRuntime as runtime,
  registerAgentCommandCompactionTestHooks,
  requireCompactionStorePath,
} from "../agent-command.compaction.test-support.js";
import * as entryModel from "../embedded-agent-runner/run-entry-model-selection.js";
import * as contextEngine from "../harness/context-engine-logical-turn.js";
import * as placement from "../session-placement-admission.js";

const failures = vi.hoisted(() => [] as unknown[]);
vi.mock("../../commands/agent.js", async () => {
  const actual = await import("../agent-command.js");
  return {
    agentCommandFromGatewayIngress: async (
      ...args: Parameters<typeof actual.agentCommandFromGatewayIngress>
    ) => {
      try {
        return await actual.agentCommandFromGatewayIngress(...args);
      } catch (error) {
        failures.push(error);
        throw error;
      }
    },
  };
});
registerAgentCommandCompactionTestHooks();
beforeEach(() => setRuntimeConfigSnapshot(expectDefined(state.cfg, "fixture config")));
afterEach(() => {
  clearRuntimeConfigSnapshot();
  vi.unstubAllEnvs();
});

it.each([
  "inner_admission",
  "embedded",
  "embedded_trajectory",
  "entry_placement",
  "entry_runtime",
  "entry_model_resolve",
  "entry_context_engine",
  "entry_worker_inference",
  "candidate_setup",
] as const)("keeps the actual %s boundary active through dispatch cancellation", async (stage) => {
  failures.length = 0;
  const withSessionTurnOriginal = admission.withSessionTurn;
  const runId = "command-trace-run";
  const context = createAgentTurnTestContext();
  const trace = createAgentRunPreparationTrace(runId);
  const entered = createDeferred();
  const release = createDeferred();
  const ownerEntered = createDeferred();
  const target = {
    sessionKey: "agent:main:explicit:trace",
    sessionId: "trace-session",
    agentId: "main",
    storePath: requireCompactionStorePath(),
  };
  vi.stubEnv("OPENCLAW_STATE_DIR", path.dirname(target.storePath));
  // The standalone dispatch path lets the real command acquire its own input.
  const controller = new AbortController();
  await runtime.replaceSessionEntry(target, {
    sessionId: target.sessionId,
    updatedAt: Date.now(),
  });
  const owner =
    stage === "inner_admission"
      ? withSessionTurn(target, async () => {
          ownerEntered.resolve();
          await release.promise;
        })
      : Promise.resolve();
  if (stage === "inner_admission") {
    await ownerEntered.promise;
  }
  const stall = async () => {
    entered.resolve();
    await release.promise;
    throw new Error("synthetic cancelled runtime");
  };
  state.runAgentAttemptMock.mockImplementationOnce(stall);
  const boundarySpy =
    stage === "embedded_trajectory"
      ? vi.spyOn(trajectory, "createTrajectoryRuntimeRecorder")
      : stage === "entry_placement"
        ? vi.spyOn(placement, "withRequiredSessionPlacement")
        : stage === "entry_runtime"
          ? vi.spyOn(placement, "resolveSessionPlacementRuntimeOverride")
          : stage === "entry_model_resolve"
            ? vi.spyOn(entryModel, "resolveRunEntryModelSelection")
            : stage === "entry_context_engine"
              ? vi.spyOn(contextEngine, "createContextEngineLogicalTurnLease")
              : stage === "entry_worker_inference"
                ? vi.spyOn(placement, "sessionPlacementUsesWorkerInference")
                : undefined;
  boundarySpy?.mockImplementationOnce(stall);
  const innerAdmission = vi.spyOn(admission, "withSessionTurn").mockImplementation((...args) => {
    const work = withSessionTurnOriginal(...args);
    if (stage === "inner_admission") {
      entered.resolve();
    }
    return work;
  });
  const emitFinal = vi.fn();
  using observations = new DisposableStack();
  observations.use(addAbortListener(controller.signal, trace.observeAbort));
  trace.enter("dispatch");
  const completion = withDiagnosticsTimelineObserver(trace.observeSpan, () =>
    dispatchAgentRunFromGateway({
      runId,
      context,
      admittedRunEntry: undefined,
      dedupeKeys: [],
      abortController: controller,
      cleanupAbortController: () => {},
      preparationTrace: trace,
      ingressOpts: {
        ...target,
        message: "synthetic prompt",
        allowModelOverride: false,
        onActiveModelSelected: stage === "candidate_setup" ? stall : undefined,
        runId,
        abortSignal: controller.signal,
      },
      io: { emitAcceptance: vi.fn(), emitFinal },
    }),
  );
  try {
    await awaitGateBeforeSettlement(
      entered.promise,
      completion.then(() => {
        if (failures.length) {
          throw failures[0];
        }
        expect(emitFinal.mock.calls, "unexpected early final").toEqual([]);
      }),
      "Command did not reach expected boundary",
    );
    controller.abort();
  } finally {
    release.resolve();
    await Promise.all([completion, owner]);
    innerAdmission.mockRestore();
    boundarySpy?.mockRestore();
  }
  expect(emitFinal.mock.calls[0]?.[0]?.[1]).toMatchObject({
    preparationTrace: {
      abortSnapshot: {
        active: expect.arrayContaining([{ stage, elapsedMs: expect.any(Number) }]),
      },
    },
  });
  if (stage !== "embedded") {
    expect(state.runAgentAttemptMock).not.toHaveBeenCalled();
  } else {
    expect(state.runAgentAttemptMock).toHaveBeenCalledOnce();
    expect(emitFinal.mock.calls[0]?.[0]?.[1]?.preparationTrace.abortSnapshot.active).toEqual(
      expect.arrayContaining([
        { stage: "candidate_attempt", elapsedMs: expect.any(Number) },
        { stage: "entry_fallback", elapsedMs: expect.any(Number) },
      ]),
    );
  }
  const finalSnapshot = JSON.stringify(trace.finish(true));
  trace.observeSpan("agent.entry.runtime", undefined);
  trace.observeAbort();
  expect(JSON.stringify(trace.finish(true))).toBe(finalSnapshot);
});
