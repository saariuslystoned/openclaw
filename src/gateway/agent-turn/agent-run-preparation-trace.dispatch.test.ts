import { getEventListeners } from "node:events";
import { asOptionalRecord } from "@openclaw/normalization-core";
import { afterEach, expect, it, vi } from "vitest";
import { awaitGateBeforeSettlement, createDeferred } from "../../../test/helpers/promise.js";
import { agentCommandFromGatewayIngress } from "../../agents/agent-command.js";
import { measureEmbeddedAgentPreparation } from "../../agents/embedded-agent-runner/run/preparation-timing.js";
import {
  emitTrustedDiagnosticEventWithPrivateData,
  waitForDiagnosticEventsDrained,
} from "../../infra/diagnostic-events.js";
import {
  observeDiagnosticsTimelinePhases,
  recordDiagnosticsTimelineDuration,
} from "../../infra/diagnostics-timeline.js";
import { withPluginRuntimeGatewayContextResolver as withGateway } from "../../plugins/runtime/gateway-request-scope.js";
import { resetSessionControllerStateForTest } from "../../sessions/session-lifecycle-admission.test-support.js";
import { startAgentRunExecution } from "./agent-run-execution-phase.js";
import {
  bindRegisteredExecution,
  createExecution,
} from "./agent-run-execution-phase.owner.test-support.js";

const mocks = vi.hoisted(() => ({
  command: vi.fn<typeof import("../../commands/agent.js").agentCommandFromGatewayIngress>(),
  prepare: vi.fn<typeof import("../../agents/command/prepare.js").prepareAgentCommandExecution>(),
  media:
    vi.fn<
      NonNullable<
        Parameters<
          typeof import("./agent-run-dispatch.js").dispatchAgentRunFromGateway
        >[0]["loadMedia"]
      >
    >(),
}));
vi.mock("../../commands/agent.js", () => ({ agentCommandFromGatewayIngress: mocks.command }));
// These gates stand in for pending dependencies; dispatch and ingress command are real.
vi.mock("../../agents/command/prepare.js", () => ({ prepareAgentCommandExecution: mocks.prepare }));
vi.mock("./agent-run-dispatch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-run-dispatch.js")>();
  return {
    ...actual,
    dispatchAgentRunFromGateway: (
      params: Parameters<typeof actual.dispatchAgentRunFromGateway>[0],
    ) =>
      actual.dispatchAgentRunFromGateway({
        ...params,
        ...(mocks.media.getMockImplementation() ? { loadMedia: mocks.media } : {}),
      }),
  };
});
afterEach(() => {
  vi.resetAllMocks();
  resetSessionControllerStateForTest();
});

it.each(["media_load", "command_prepare"] as const)(
  "freezes the real %s boundary before abort cleanup",
  async (stage) => {
    const execution = createExecution();
    await bindRegisteredExecution(execution, "agent:main:incognito-boundary", "boundary");
    execution.params.sessionEntry = { sessionId: "boundary", updatedAt: 0, incognito: true };
    const entered = createDeferred();
    const release = createDeferred();
    const pending = async (): Promise<never> => {
      entered.resolve();
      await release.promise;
      throw new Error("synthetic-private-pending-dependency");
    };
    if (stage === "media_load") {
      mocks.media.mockImplementation(pending);
    } else {
      mocks.command.mockImplementation((opts, runtime, deps) =>
        agentCommandFromGatewayIngress(opts, runtime, deps),
      );
      mocks.prepare.mockImplementation(pending);
    }
    const signal = execution.params.prepared.activeRunAbort.controller.signal;
    const completion = startAgentRunExecution(execution.params);
    try {
      await awaitGateBeforeSettlement(entered.promise, completion, "Expected pending boundary");
      execution.params.prepared.activeRunAbort.controller.abort();
    } finally {
      release.resolve();
      await completion;
    }
    const [frame] = vi.mocked(execution.params.io.emitFinal).mock.calls[0] ?? [];
    expect(frame?.[1]).toMatchObject({
      preparationTrace: {
        abortSnapshot: {
          active: expect.arrayContaining([{ stage, elapsedMs: expect.any(Number) }]),
          truncated: false,
        },
      },
    });
    expect(JSON.stringify(asOptionalRecord(frame?.[1])?.preparationTrace)).not.toContain(
      "synthetic-private",
    );
    expect(getEventListeners(signal, "abort")).toHaveLength(0);
  },
);

it("isolates interleaved dispatches and retains the first abort snapshot beyond event truncation and finalization", async () => {
  const a = createExecution();
  const b = createExecution();
  a.params.runId = "trace-a";
  b.params.runId = "trace-b";
  await bindRegisteredExecution(a, "agent:main:trace-a", "trace-a");
  await bindRegisteredExecution(b, "agent:main:trace-b", "trace-b");
  const enteredA = createDeferred();
  const enteredB = createDeferred();
  const release = createDeferred();
  let late: (() => void) | undefined;
  mocks.command.mockImplementation(async (opts) => {
    if (opts.runId === "trace-a") {
      // Actual nested timeline scopes overflow both independent bounds.
      using phases = new DisposableStack();
      for (let i = 0; i < 20; i++) {
        phases.use(observeDiagnosticsTimelinePhases("agent.command.prepare"));
      }
      return measureEmbeddedAgentPreparation("attempt.history", async () => {
        using phase = observeDiagnosticsTimelinePhases("agent.harness.invoked:private-plugin-id");
        late = () => phase.mark("agent.harness.invoked:codex");
        enteredA.resolve();
        await release.promise;
        return { payloads: [], meta: { durationMs: 0 } };
      });
    }
    using observations = new DisposableStack();
    observations.use(observeDiagnosticsTimelinePhases("agent.harness.selected:copilot"));
    // Duration replay and arbitrary names/attributes must not become live boundaries.
    recordDiagnosticsTimelineDuration("agent.command.prepare", 10);
    observations.use(observeDiagnosticsTimelinePhases("private-prompt-and-plugin-data"));
    enteredB.resolve();
    await release.promise;
    return { payloads: [], meta: { durationMs: 0 } };
  });
  const completionA = startAgentRunExecution(a.params);
  const completionB = startAgentRunExecution(b.params);
  try {
    await awaitGateBeforeSettlement(
      Promise.all([enteredA.promise, enteredB.promise]),
      Promise.all([completionA, completionB]),
      "Expected interleaved dispatches",
    );
    a.params.prepared.activeRunAbort.controller.abort();
    b.params.prepared.activeRunAbort.controller.abort();
  } finally {
    release.resolve();
    await Promise.all([completionA, completionB]);
  }
  const [frameA] = vi.mocked(a.params.io.emitFinal).mock.calls[0] ?? [];
  const [frameB] = vi.mocked(b.params.io.emitFinal).mock.calls[0] ?? [];
  const traceA = asOptionalRecord(frameA?.[1])?.preparationTrace;
  const traceB = asOptionalRecord(frameB?.[1])?.preparationTrace;
  expect(traceA).toMatchObject({
    truncated: true,
    points: expect.any(Array),
    abortSnapshot: {
      active: expect.arrayContaining([
        { stage: "prepare_attempt_history", elapsedMs: expect.any(Number) },
        { stage: "harness_invoked", harnessId: "other", elapsedMs: expect.any(Number) },
      ]),
      truncated: true,
    },
  });
  expect(traceB).toMatchObject({
    truncated: false,
    abortSnapshot: {
      active: expect.arrayContaining([
        { stage: "harness_selected", harnessId: "copilot", elapsedMs: expect.any(Number) },
      ]),
    },
  });
  const savedA = JSON.stringify(traceA);
  const savedB = JSON.stringify(traceB);
  expect(savedA).not.toMatch(/copilot|private-plugin/);
  expect(savedB).not.toMatch(/prepare_attempt_history|harness_invoked|private-prompt/);
  late?.();
  a.params.prepared.activeRunAbort.controller.abort();
  expect(JSON.stringify(traceA)).toBe(savedA);
  expect(JSON.stringify(traceB)).toBe(savedB);
});

it("does not mix trusted provider events between overlapping sessions with the same run ID", async () => {
  const a = createExecution();
  const b = createExecution();
  // Run IDs are unique within one Gateway, not across independent Gateways.
  const resolveA = () => undefined;
  const resolveB = () => undefined;
  a.params.context.resolveGatewayContext = resolveA;
  b.params.context.resolveGatewayContext = resolveB;
  await withGateway(resolveA, () =>
    bindRegisteredExecution(a, "agent:main:observation-a", "observation-a"),
  );
  await withGateway(resolveB, () =>
    bindRegisteredExecution(b, "agent:main:observation-b", "observation-b"),
  );
  const enteredA = createDeferred();
  const enteredB = createDeferred();
  const release = createDeferred();
  mocks.command.mockImplementation(async (opts) => {
    (opts.sessionId === "observation-a" ? enteredA : enteredB).resolve();
    await release.promise;
    return { payloads: [], meta: { durationMs: 0 } };
  });
  const completionA = withGateway(resolveA, () => startAgentRunExecution(a.params));
  const completionB = withGateway(resolveB, () => startAgentRunExecution(b.params));
  try {
    await awaitGateBeforeSettlement(
      Promise.all([enteredA.promise, enteredB.promise]),
      Promise.all([completionA, completionB]),
      "Expected overlapping sessions",
    );
    emitTrustedDiagnosticEventWithPrivateData({
      type: "model.call.started",
      runId: a.params.runId,
      sessionKey: a.params.resolvedSessionKey,
      sessionId: a.params.resolvedSessionId,
      callId: "synthetic",
      provider: "synthetic",
      model: "synthetic",
    });
    await waitForDiagnosticEventsDrained();
  } finally {
    release.resolve();
    await Promise.all([completionA, completionB]);
  }
  const traceA = asOptionalRecord(
    vi.mocked(a.params.io.emitFinal).mock.calls[0]?.[0]?.[1],
  )?.preparationTrace;
  const traceB = asOptionalRecord(
    vi.mocked(b.params.io.emitFinal).mock.calls[0]?.[0]?.[1],
  )?.preparationTrace;
  expect(JSON.stringify(traceA)?.match(/provider_call/g)).toHaveLength(1);
  expect(JSON.stringify(traceB)).not.toContain("provider_call");
});
