type PreparationStage =
  | "workspace"
  | "model_runtime"
  | "skill_authoring"
  | "input_scope"
  | "session_admission"
  | "dispatch"
  | "provider_call"
  | "media_load"
  | "media_activate"
  | "agent_command"
  | "command_prepare"
  | "command_runtime"
  | "inner_admission"
  | "command_owned"
  | "embedded"
  | "embedded_trajectory"
  | "embedded_entry"
  | "entry_placement"
  | "entry_runtime"
  | "entry_model_resolve"
  | "entry_context_engine"
  | "entry_worker_inference"
  | "entry_fallback"
  | "candidate_setup"
  | "candidate_attempt"
  | "candidate_auth_profile"
  | "candidate_accounting"
  | "runner_session_prepare"
  | "runner_placement"
  | "runner_maintenance"
  | "runner_projection"
  | "runner_cli_dispatch"
  | "runner_generation"
  | "runner_runtime_acquire"
  | "runner_projects"
  | "runner_execution_start"
  | "runner_before_reply"
  | "runner_loop"
  | "runner_global_admission"
  | "runner_writer"
  | "runner_turn_admission"
  | "runner_foreground_maintenance"
  | "runner_session_admission"
  | "harness_selected"
  | "harness_invoked"
  | "dispatch_settlement"
  | "startup_session_state"
  | "startup_model_selection"
  | "startup_attempt_import"
  | "prepare_runtime"
  | "prepare_context_engine"
  | "prepare_attempt_setup"
  | "prepare_attempt_history"
  | "prepare_attempt_actor"
  | "prepare_history_boundary";
type HarnessId = "openclaw" | "codex" | "copilot" | "other";
type ActiveBoundary = { stage: PreparationStage; elapsedMs: number; harnessId?: HarnessId };
type TracePoint = ActiveBoundary & { event: "enter" | "exit" | "error" };
type AbortSnapshot = { elapsedMs: number; active: ActiveBoundary[]; truncated: boolean };
type PreparationTraceSnapshot = {
  points: TracePoint[];
  elapsedMs: number;
  dispatched: boolean;
  truncated: boolean;
  providerObservation: "diagnostic-events";
  abortSnapshot?: AbortSnapshot;
};

const phases = new Map<string, PreparationStage>([
  ["agent.media.load", "media_load"],
  ["agent.media.activate", "media_activate"],
  ["agent.command", "agent_command"],
  ["agent.command.prepare", "command_prepare"],
  ["agent.command.runtime", "command_runtime"],
  ["agent.command.admission", "inner_admission"],
  ["agent.command.owned", "command_owned"],
  ["agent.embedded", "embedded"],
  ["agent.embedded.trajectory", "embedded_trajectory"],
  ["agent.embedded.entry", "embedded_entry"],
  ["agent.entry.placement", "entry_placement"],
  ["agent.entry.runtime", "entry_runtime"],
  ["agent.entry.model-resolve", "entry_model_resolve"],
  ["agent.entry.context-engine", "entry_context_engine"],
  ["agent.entry.worker-inference", "entry_worker_inference"],
  ["agent.entry.fallback", "entry_fallback"],
  ["agent.candidate.setup", "candidate_setup"],
  ["agent.candidate.attempt", "candidate_attempt"],
  ["agent.candidate.auth-profile", "candidate_auth_profile"],
  ["agent.candidate.accounting", "candidate_accounting"],
  ["agent.runner.session-prepare", "runner_session_prepare"],
  ["agent.runner.placement", "runner_placement"],
  ["agent.runner.maintenance", "runner_maintenance"],
  ["agent.runner.projection", "runner_projection"],
  ["agent.runner.cli-dispatch", "runner_cli_dispatch"],
  ["agent.runner.generation", "runner_generation"],
  ["agent.runner.runtime-acquire", "runner_runtime_acquire"],
  ["agent.runner.projects", "runner_projects"],
  ["agent.runner.execution-start", "runner_execution_start"],
  ["agent.runner.before-reply", "runner_before_reply"],
  ["agent.runner.loop", "runner_loop"],
  ["agent.runner.global-admission", "runner_global_admission"],
  ["agent.runner.writer", "runner_writer"],
  ["agent.runner.turn-admission", "runner_turn_admission"],
  ["agent.runner.foreground-maintenance", "runner_foreground_maintenance"],
  ["agent.runner.session-admission", "runner_session_admission"],
  ["agent.dispatch.settlement", "dispatch_settlement"],
]);
const startupStages = new Map<string, PreparationStage>([
  ["session-state", "startup_session_state"],
  ["model-selection", "startup_model_selection"],
  ["attempt-runtime-import", "startup_attempt_import"],
]);
const preparationStages = new Map<string, PreparationStage>([
  ["runtime", "prepare_runtime"],
  ["context-engine", "prepare_context_engine"],
  ["attempt.setup", "prepare_attempt_setup"],
  ["attempt.history", "prepare_attempt_history"],
  ["attempt.actor", "prepare_attempt_actor"],
  ["attempt.history-boundary", "prepare_history_boundary"],
]);

/** Temporary diagnostics retained only with the existing final response and its replay cache. */
export function createAgentRunPreparationTrace(runId: string, now = () => performance.now()) {
  const startedAt = now();
  const points: TracePoint[] = [];
  const active: ActiveBoundary[] = [];
  let closed = false;
  let truncated = false;
  let activeTruncated = false;
  let abortSnapshot: AbortSnapshot | undefined;
  let snapshot: PreparationTraceSnapshot | undefined;
  const elapsed = () => Math.max(0, Math.round(now() - startedAt));
  const record = (stage: PreparationStage, event: TracePoint["event"], harnessId?: HarnessId) => {
    if (closed) {
      return;
    }
    if (points.length === 32) {
      truncated = true;
      return;
    }
    points.push({ stage, event, elapsedMs: elapsed(), ...(harnessId ? { harnessId } : {}) });
  };
  const begin = (stage: PreparationStage, harnessId?: HarnessId) => {
    if (closed) {
      return () => {};
    }
    const boundary = { stage, elapsedMs: elapsed(), ...(harnessId ? { harnessId } : {}) };
    // Keep the innermost observations independently of the capped event history.
    // Overflow may omit an outer boundary; the abort snapshot reports that explicitly.
    if (active.length === 16) {
      active.shift();
      activeTruncated = true;
    }
    active.push(boundary);
    record(stage, "enter", harnessId);
    let ended = false;
    return (event: "exit" | "error" = "exit") => {
      if (ended || closed) {
        return;
      }
      ended = true;
      const index = active.indexOf(boundary);
      if (index !== -1) {
        active.splice(index, 1);
      }
      record(stage, event, harnessId);
    };
  };
  const exit = (stage: PreparationStage) => {
    if (closed) {
      return;
    }
    const index = active.findLastIndex((boundary) => boundary.stage === stage);
    if (index !== -1) {
      active.splice(index, 1);
    }
    record(stage, "exit");
  };
  return {
    enter: (stage: PreparationStage) => {
      begin(stage);
    },
    exit,
    async measure<T>(stage: PreparationStage, run: () => T | Promise<T>): Promise<T> {
      const end = begin(stage);
      try {
        const result = await run();
        end();
        return result;
      } catch (error) {
        end("error");
        throw error;
      }
    },
    observeSpan: (
      name: string,
      attributes: Record<string, string | number | boolean | null> | undefined,
      durationMs?: number,
    ): (() => void) | undefined => {
      // Replayed durations are not live boundaries. Never copy arbitrary attributes,
      // error text, model IDs, or plugin-supplied names into the final response.
      if (closed || durationMs !== undefined) {
        return undefined;
      }
      const stage =
        phases.get(name) ??
        (name === "agent.startup" && typeof attributes?.stage === "string"
          ? startupStages.get(attributes.stage)
          : undefined) ??
        (name === "agent.prepare" && typeof attributes?.stage === "string"
          ? preparationStages.get(attributes.stage)
          : undefined);
      if (stage) {
        return begin(stage);
      }
      for (const [prefix, harnessStage] of [
        ["agent.harness.selected:", "harness_selected"],
        ["agent.harness.invoked:", "harness_invoked"],
      ] as const) {
        if (name.startsWith(prefix)) {
          const id = name.slice(prefix.length);
          return begin(
            harnessStage,
            id === "openclaw" || id === "codex" || id === "copilot" ? id : "other",
          );
        }
      }
      return undefined;
    },
    observeAbort: () => {
      if (closed || abortSnapshot) {
        return;
      }
      // The signal listener runs synchronously, before awaited cancellation cleanup.
      // This is an observation, never the terminal owner's timeoutPhase/providerStarted.
      abortSnapshot = { elapsedMs: elapsed(), active: active.slice(), truncated: activeTruncated };
    },
    observeModelEvent: (event: { type: string; runId?: string }) => {
      if (event.runId !== runId) {
        return;
      }
      switch (event.type) {
        case "model.call.started":
          record("provider_call", "enter");
          break;
        case "model.call.completed":
          record("provider_call", "exit");
          break;
        case "model.call.error":
          record("provider_call", "error");
          break;
      }
    },
    finish(dispatched: boolean): PreparationTraceSnapshot {
      if (snapshot) {
        return snapshot;
      }
      if (dispatched) {
        exit("dispatch");
      }
      closed = true;
      active.length = 0;
      snapshot = {
        points,
        elapsedMs: elapsed(),
        dispatched,
        truncated,
        providerObservation: "diagnostic-events",
        ...(abortSnapshot ? { abortSnapshot } : {}),
      };
      return snapshot;
    },
  };
}
