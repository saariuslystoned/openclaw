import { relaySessions, type RelaySession } from "./state.js";

/** How long a cancelled turn waits for the provider to confirm the cancelled response. */
export const TURN_BOUND_CANCELLATION_DRAIN_MS = 1_000;
/** Upper bound for discarding a stale generation whose provider never reports it done. */
const STALE_OUTPUT_DISCARD_MAX_MS = 30_000;

/**
 * Bounds a cancellation drain. When the provider never confirms the cancelled response,
 * the relay completes the cancellation locally instead of closing the session.
 *
 * Gemini Live has no response.cancel: its bridge interrupts through input audio
 * (server-side VAD) or, on Extended Thinking, a client turn, and only reports the response
 * done at its own turnComplete. Closing at the deadline ended every Google relay call on
 * the first stop or barge-in. Completing locally releases microphone audio and tool
 * results, and the stale generation's remaining output is discarded until the provider
 * reports it done or a replacement response starts.
 */
export function scheduleRelayCancellationDeadline(
  session: RelaySession,
  params: { turnId: string; reason: string; terminalEpoch: number },
): void {
  setTimeout(() => {
    if (
      relaySessions.get(session.id) !== session ||
      session.toolResultEpoch !== params.terminalEpoch ||
      session.outputOwnership.phase !== "cancelling"
    ) {
      return;
    }
    if (!session.outputOwnership.completeCancellationLocally()) {
      return;
    }
    session.context.logGateway.warn(
      `talk relay: provider did not confirm output cancellation within ${TURN_BOUND_CANCELLATION_DRAIN_MS}ms; keeping the session open and discarding stale output (reason=${params.reason}, turnId=${params.turnId})`,
    );
    setTimeout(() => {
      if (relaySessions.get(session.id) === session && session.outputOwnership.discarding) {
        session.outputOwnership.discarding = false;
      }
    }, STALE_OUTPUT_DISCARD_MAX_MS).unref?.();
  }, TURN_BOUND_CANCELLATION_DRAIN_MS).unref?.();
}
