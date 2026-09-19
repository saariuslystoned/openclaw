import { describe, expect, it, vi } from "vitest";
import type { RealtimeVoiceAgentConsultRunner } from "../../../talk/provider-types.js";
import { bindTalkRealtimeRelayAgentConsult } from "./agent-consult.js";
import type { RelaySession } from "./state.js";

function createRunPrompt(run: () => Promise<{ text: string }>) {
  return Object.assign(vi.fn<RealtimeVoiceAgentConsultRunner>(run), {
    adoptCompletionClaims: vi.fn(),
    claimAppend: vi.fn(() => true),
    claimFailureAppend: vi.fn(() => true),
  });
}

describe("bindTalkRealtimeRelayAgentConsult", () => {
  it("holds assistant transcript appends for the whole consult and releases them once it settles", async () => {
    const relay = {} as RelaySession;
    let resolveRun!: (value: { text: string }) => void;
    const pendingRun = new Promise<{ text: string }>((resolve) => {
      resolveRun = resolve;
    });
    const runAgentConsult = bindTalkRealtimeRelayAgentConsult(
      createRunPrompt(() => pendingRun) as never,
      () => relay,
      async () => {},
    );

    const run = runAgentConsult({ prompt: "what is on my calendar" } as never);
    await vi.waitFor(() => expect(relay.assistantTranscriptHold?.depth).toBe(1));
    resolveRun({ text: "done" });
    await expect(run).resolves.toEqual({ text: "done" });
    expect(relay.assistantTranscriptHold).toBeUndefined();
  });

  it("releases the hold when the consult fails", async () => {
    const relay = {} as RelaySession;
    const runAgentConsult = bindTalkRealtimeRelayAgentConsult(
      createRunPrompt(async () => {
        throw new Error("consult failed");
      }) as never,
      () => relay,
      async () => {},
    );

    await expect(runAgentConsult({ prompt: "again" } as never)).rejects.toThrow("consult failed");
    expect(relay.assistantTranscriptHold).toBeUndefined();
  });

  it("does not run a consult once the relay is gone", async () => {
    const runPrompt = createRunPrompt(async () => ({ text: "done" }));
    const runAgentConsult = bindTalkRealtimeRelayAgentConsult(
      runPrompt as never,
      () => undefined,
      async () => {},
    );

    await expect(runAgentConsult({ prompt: "hi" } as never)).rejects.toThrow(
      "Realtime gateway-relay session is closed",
    );
    expect(runPrompt).not.toHaveBeenCalled();
  });
});
