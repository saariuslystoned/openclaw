import { describe, expect, it } from "vitest";
import {
  observeDiagnosticsTimelinePhases,
  withDiagnosticsTimelineObserver,
} from "../../infra/diagnostics-timeline.js";
import { createAgentRunPreparationTrace } from "./agent-run-preparation-trace.js";

describe("agent preparation trace", () => {
  it("caps active scopes separately and freezes the first abort before cleanup", () => {
    let now = 0;
    const trace = createAgentRunPreparationTrace("target", () => now);
    withDiagnosticsTimelineObserver(trace.observeSpan, () => {
      const scopes = Array.from({ length: 20 }, () =>
        observeDiagnosticsTimelinePhases("agent.command.prepare"),
      );
      now = 35_000;
      trace.observeAbort();
      for (const scope of scopes) {
        scope[Symbol.dispose]();
      }
      now = 36_000;
      trace.observeAbort();
    });
    const snapshot = trace.finish(true);
    expect(snapshot.abortSnapshot).toEqual({
      elapsedMs: 35_000,
      active: Array.from({ length: 16 }, () => ({ stage: "command_prepare", elapsedMs: 0 })),
      truncated: true,
    });
    expect(snapshot.points).toHaveLength(32);
    expect(snapshot.truncated).toBe(true);
    trace.observeAbort();
    expect(trace.observeSpan("agent.command.prepare", undefined)).toBeUndefined();
    expect(trace.finish(false)).toBe(snapshot);
  });

  it("records elapsed entry/exit and preserves results and thrown errors", async () => {
    let now = 100;
    const trace = createAgentRunPreparationTrace("target", () => now);
    await expect(
      trace.measure("workspace", () => {
        now = 107;
        return 42;
      }),
    ).resolves.toBe(42);
    const failure = new Error("private failure must not be recorded");
    await expect(
      trace.measure("model_runtime", () => {
        now = 119;
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(trace.finish(false)).toEqual({
      points: [
        { stage: "workspace", event: "enter", elapsedMs: 0 },
        { stage: "workspace", event: "exit", elapsedMs: 7 },
        { stage: "model_runtime", event: "enter", elapsedMs: 7 },
        { stage: "model_runtime", event: "error", elapsedMs: 19 },
      ],
      elapsedMs: 19,
      dispatched: false,
      truncated: false,
      providerObservation: "diagnostic-events",
    });
  });

  it("keeps an unfinished admission visible and closes the snapshot", () => {
    let now = 0;
    const trace = createAgentRunPreparationTrace("target", () => now);
    trace.enter("session_admission");
    now = 35_000;
    const result = trace.finish(false);
    trace.exit("session_admission");
    trace.observeModelEvent({ type: "model.call.started", runId: "target" });
    expect(result.points).toEqual([{ stage: "session_admission", event: "enter", elapsedMs: 0 }]);
    expect(result.elapsedMs).toBe(35_000);
    expect(result.dispatched).toBe(false);
    expect(result).not.toHaveProperty("providerStarted");
    now = 36_000;
    expect(trace.finish(false)).toBe(result);
    expect(trace.finish(false).elapsedMs).toBe(35_000);
  });

  it("correlates content-free provider observations and caps repeated events", () => {
    const trace = createAgentRunPreparationTrace("target", () => 0);
    trace.observeModelEvent({ type: "model.call.started", runId: "other" });
    trace.observeModelEvent({ type: "agent.commentary", runId: "target" });
    const event = {
      type: "model.call.started",
      runId: "target",
      provider: "private",
      model: "private",
      prompt: "private",
    };
    trace.observeModelEvent(event);
    trace.observeModelEvent({ type: "model.call.completed", runId: "target" });
    trace.observeModelEvent({ type: "model.call.error", runId: "target" });
    for (let n = 0; n < 40; n++) {
      trace.observeModelEvent(event);
    }
    const result = trace.finish(true);
    expect(result.points).toHaveLength(32);
    expect(result.truncated).toBe(true);
    expect(result.points.slice(0, 3)).toEqual([
      { stage: "provider_call", event: "enter", elapsedMs: 0 },
      { stage: "provider_call", event: "exit", elapsedMs: 0 },
      { stage: "provider_call", event: "error", elapsedMs: 0 },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private|target|prompt|model/);
  });
});
