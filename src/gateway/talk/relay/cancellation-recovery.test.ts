/**
 * Tests relay output cancellation when the provider cannot confirm the cancelled response.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../../../test/helpers/promise.js";
import type { OpenClawConfig } from "../../../config/types.js";
import type { RealtimeVoiceProviderPlugin } from "../../../plugins/types.js";
import { resetClientVoiceConfirmationStateForTest } from "../../../talk/client-voice-confirmation.test-support.js";
import { ensureClientVoiceAgentSessionEntry } from "../../../talk/client-voice-session.js";
import { clientVoiceSessionTesting } from "../../../talk/client-voice-session.test-support.js";
import { resolveRealtimeVoiceProviderCapabilities } from "../../../talk/provider-resolver.js";
import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCreateRequest,
} from "../../../talk/provider-types.js";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../../../test-utils/openclaw-test-state.js";
import { prepareTalkSessionTarget } from "../session-target.js";
import {
  cancelTalkRealtimeRelayTurn,
  createTalkRealtimeRelaySession,
  sendTalkRealtimeRelayAudio,
  stopTalkRealtimeRelaySession,
} from "./index.js";
import { drainingRelaySessions, relaySessions } from "./state.js";

const activeRelaySessions = new Map<string, string>();

function makeRelayTransport(overrides: Partial<RealtimeVoiceBridge> = {}) {
  return {
    connect: vi.fn(async () => undefined),
    sendAudio: vi.fn(),
    setMediaTimestamp: vi.fn(),
    handleBargeIn: vi.fn(),
    submitToolResult: vi.fn(),
    acknowledgeMark: vi.fn(),
    close: vi.fn(),
    isConnected: vi.fn(() => true),
    ...overrides,
  };
}

function createRelayFixture(transportOverrides: Partial<RealtimeVoiceBridge> = {}) {
  let request: RealtimeVoiceBridgeCreateRequest | undefined;
  const transport = makeRelayTransport(transportOverrides);
  const provider: RealtimeVoiceProviderPlugin = {
    id: "relay-test",
    label: "Relay Test",
    isConfigured: () => true,
    createBridge: (bridgeRequest) => {
      request = bridgeRequest;
      return transport;
    },
  };
  const broadcastToConnIds = vi.fn();
  const warn = vi.fn();
  const cfg = { agents: { entries: { main: { default: true } } } } as OpenClawConfig;
  const capabilities = resolveRealtimeVoiceProviderCapabilities({
    provider,
    providerConfig: {},
    cfg,
    surface: "gateway-relay",
  });
  const session = createTalkRealtimeRelaySession({
    context: {
      broadcastToConnIds,
      broadcast: vi.fn(),
      logGateway: { warn },
      chatAbortControllers: new Map(),
    } as never,
    connId: "conn-1",
    provider,
    providerConfig: {},
    instructions: "brief",
    tools: [],
    controlSource: capabilities?.handlesAgentConsult === true ? "delegation" : "transcript",
    capabilities,
    cfg,
    sessionTarget: prepareTalkSessionTarget(cfg, "agent:main:main"),
  });
  activeRelaySessions.set(session.relaySessionId, "conn-1");
  const relay = relaySessions.get(session.relaySessionId);
  if (!request || !relay) {
    throw new Error("expected the relay to create its bridge");
  }
  const payloadsOfType = (type: string) =>
    broadcastToConnIds.mock.calls
      .map(([, payload]) => payload)
      .filter(
        (payload): payload is Record<string, unknown> =>
          typeof payload === "object" &&
          payload !== null &&
          (payload as Record<string, unknown>).type === type,
      );
  return {
    relaySessionId: session.relaySessionId,
    relay,
    request,
    transport,
    warn,
    payloadsOfType,
  };
}

function ensureActiveRelayTurnId(relaySessionId: string): string {
  const relay = relaySessions.get(relaySessionId);
  if (!relay) {
    throw new Error(`Missing relay test session ${relaySessionId}`);
  }
  if (!relay.harness.talk.activeTurnId) {
    relay.harness.talk.startTurn({ turnId: "turn-1" });
  }
  return relay.harness.talk.activeTurnId ?? "turn-1";
}

describe("talk realtime relay cancellation recovery", () => {
  let testState: OpenClawTestState | undefined;

  beforeEach(async () => {
    testState = await createOpenClawTestState({
      label: "talk-realtime-relay-cancellation",
      scenario: "minimal",
    });
    await ensureClientVoiceAgentSessionEntry({ agentId: "main", sessionKey: "agent:main:main" });
  });

  afterEach(async () => {
    try {
      for (const [relaySessionId, connId] of activeRelaySessions) {
        try {
          await stopTalkRealtimeRelaySession({ relaySessionId, connId });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.includes("Unknown realtime relay session")
          ) {
            throw error;
          }
        }
      }
      await Promise.all(
        [...drainingRelaySessions].map(
          (session) =>
            session.closing?.completion ?? session.voiceSessionClose ?? Promise.resolve(),
        ),
      );
    } finally {
      activeRelaySessions.clear();
      vi.useRealTimers();
      clientVoiceSessionTesting.reset();
      resetClientVoiceConfirmationStateForTest();
      await testState?.cleanup();
      testState = undefined;
    }
  });

  it("keeps a stalled turn-bound cancellation open after its drain deadline and discards the stale generation", async () => {
    vi.useFakeTimers();
    const pending = createDeferred();
    const fixture = createRelayFixture({ submitToolResult: vi.fn(() => pending.promise) });
    const { relaySessionId, relay, request, transport, payloadsOfType } = fixture;

    let cancellationSettled = false;
    const cancellation = cancelTalkRealtimeRelayTurn({
      relaySessionId,
      connId: "conn-1",
      reason: "android-stop-tts",
      turnId: ensureActiveRelayTurnId(relaySessionId),
    });
    void cancellation.then(() => (cancellationSettled = true));
    const pendingAudio = Promise.resolve(
      sendTalkRealtimeRelayAudio({ relaySessionId, connId: "conn-1", audioBase64: "AQI=" }),
    );
    let audioSettled = false;
    void pendingAudio.then(
      () => (audioSettled = true),
      () => (audioSettled = true),
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(relaySessions.has(relaySessionId)).toBe(true);
    expect(cancellationSettled).toBe(false);
    expect(audioSettled).toBe(false);
    expect(transport.sendAudio).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(cancellation).resolves.toEqual({ status: "applied", turnId: expect.any(String) });
    // The session stays open, microphone audio flows again, and the stall is logged.
    await expect(pendingAudio).resolves.toBeUndefined();
    expect(transport.sendAudio).toHaveBeenCalledOnce();
    expect(relaySessions.has(relaySessionId)).toBe(true);
    expect(transport.close).not.toHaveBeenCalled();
    expect(fixture.warn).toHaveBeenCalledWith(
      expect.stringContaining("did not confirm output cancellation"),
    );

    // Output from the interrupted generation is dropped until the provider reports it done.
    const audioBefore = payloadsOfType("audio").length;
    const transcriptsBefore = payloadsOfType("transcript").length;
    request.onAudio(Buffer.from("stale audio"));
    request.onTranscript?.("assistant", "stale words", true);
    request.onToolCall?.({
      itemId: "stale-item",
      callId: "stale-call",
      name: "custom_tool",
      args: {},
    });
    expect(payloadsOfType("audio")).toHaveLength(audioBefore);
    expect(payloadsOfType("transcript")).toHaveLength(transcriptsBefore);
    expect(payloadsOfType("toolCall")).toHaveLength(0);
    expect(relay.outputOwnership.discarding).toBe(true);

    request.onResponseDone?.({ status: "cancelled" });
    expect(relay.outputOwnership.discarding).toBe(false);
    // The phone captures continuously; the next microphone frame re-arms a turn for the reply.
    await sendTalkRealtimeRelayAudio({ relaySessionId, connId: "conn-1", audioBase64: "AQI=" });
    request.onAudio(Buffer.from("fresh audio"));
    expect(payloadsOfType("audio")).toHaveLength(audioBefore + 1);
    expect(relaySessions.has(relaySessionId)).toBe(true);
    pending.resolve();
  });

  it("keeps an exact-response relay open when cancellation is never confirmed", async () => {
    vi.useFakeTimers();
    const { relaySessionId, relay, request, transport, payloadsOfType } = createRelayFixture();
    request.onEvent?.({ direction: "server", type: "response.created", responseId: "response-1" });

    let cancellationSettled = false;
    const cancellation = cancelTalkRealtimeRelayTurn({
      relaySessionId,
      connId: "conn-1",
      turnId: ensureActiveRelayTurnId(relaySessionId),
    });
    void cancellation.then(() => (cancellationSettled = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(relaySessions.has(relaySessionId)).toBe(true);
    expect(cancellationSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(cancellation).resolves.toEqual({ status: "applied", turnId: expect.any(String) });
    expect(relaySessions.has(relaySessionId)).toBe(true);
    expect(transport.close).not.toHaveBeenCalled();

    // The stale response's late audio is discarded until a replacement response starts.
    const before = payloadsOfType("audio").length;
    request.onAudio(Buffer.from("stale audio"));
    expect(payloadsOfType("audio")).toHaveLength(before);
    relay.harness.talk.startTurn({ turnId: "turn-next" });
    request.onEvent?.({ direction: "server", type: "response.created", responseId: "response-2" });
    request.onAudio(Buffer.from("fresh audio"));
    expect(payloadsOfType("audio")).toHaveLength(before + 1);
  });
});
