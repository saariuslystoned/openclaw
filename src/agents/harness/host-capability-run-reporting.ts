import { emitAgentRunOutputTokens } from "../../infra/agent-events.js";
import type { SessionControllerWatchdogAttempt } from "../../sessions/session-controller.watchdog.types.js";
import { log } from "../embedded-agent-runner/logger.js";
import type { EmbeddedRunAttemptInternalParams } from "../embedded-agent-runner/run/internal-params.js";
import { runBestEffortCallback } from "../embedded-agent-subscribe.callback.js";
import type { AgentHarnessHostCapabilities } from "./host-capability-types.js";

/** Live run reporting bound to one admitted run; each report first proves the scope is current. */
export function bindHarnessRunReporting(params: {
  assertScopeCurrent: () => void;
  runId: string;
  lifecycleGeneration: string;
  sessionKey?: string;
  onAgentEvent?: EmbeddedRunAttemptInternalParams["onAgentEvent"];
  // Native runtimes report from their own event loop, so the watchdog is captured at creation.
  watchdogAttempt?: Pick<SessionControllerWatchdogAttempt, "progressModel">;
}): Pick<AgentHarnessHostCapabilities, "reportOutputTokens" | "reportModelProgress"> {
  const { assertScopeCurrent, runId, lifecycleGeneration, sessionKey, onAgentEvent } = params;
  return {
    reportOutputTokens: (outputTokens) => {
      assertScopeCurrent();
      const data = emitAgentRunOutputTokens({
        runId,
        lifecycleGeneration,
        sessionKey,
        outputTokens,
      });
      if (data && onAgentEvent) {
        runBestEffortCallback({
          label: "usage agent event",
          log,
          callback: () => onAgentEvent({ stream: "usage", data }),
        });
      }
    },
    reportModelProgress: () => {
      assertScopeCurrent();
      params.watchdogAttempt?.progressModel("native_harness:model_progress");
    },
  };
}
