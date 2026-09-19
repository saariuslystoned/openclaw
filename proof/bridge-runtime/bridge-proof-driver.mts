// Headless proof driver: runs this branch's Google realtime voice bridge against the live
// Gemini API and logs every bridge callback. Not part of the tree; run with
//   node --import ./scripts/tsx.mjs scratch-bridge-proof.mts <out.jsonl>
import fs from "node:fs";
import { REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ } from "./src/talk/provider-types.js";
import { buildGoogleRealtimeVoiceProvider } from "./extensions/google/realtime-voice-provider.js";

const out = fs.createWriteStream(process.argv[2] ?? "bridge-proof.jsonl");
const t0 = Date.now();
let audioBytes = 0;
let phase = "connect";
const log = (kind: string, data: Record<string, unknown> = {}) => {
  const rec = { t_ms: Date.now() - t0, phase, kind, ...data };
  out.write(`${JSON.stringify(rec)}\n`);
  if (kind !== "audio") {
    console.log(JSON.stringify(rec));
  }
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (pred: () => boolean, timeoutMs: number) => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      return false;
    }
    await wait(50);
  }
  return true;
};

let ready = false;
let closed = false;
const toolCalls: Array<{ callId: string; name: string; args: unknown }> = [];
const responsesDone: Array<{ t_ms: number; status: string }> = [];
const clears: Array<{ t_ms: number; reason?: string }> = [];
const transcripts: Array<{ t_ms: number; role: string; text: string; final: boolean }> = [];

const provider = buildGoogleRealtimeVoiceProvider();
const bridge = provider.createBridge({
  providerConfig: { model: "gemini-3.8-live-extended-thinking", thinkingLevel: "high" },
  audioFormat: REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
  instructions:
    "You are a test voice. Keep answers short unless asked to count; when asked to count, count steadily and do not stop until told.",
  tools: [
    {
      type: "function",
      name: "openclaw_agent_consult",
      description: "Ask the OpenClaw agent to look something up (calendar, facts, tasks).",
      parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
    },
  ],
  onAudio: (audio) => {
    audioBytes += audio.length;
    log("audio", { bytes: audio.length, total: audioBytes });
  },
  onClearAudio: (reason) => {
    clears.push({ t_ms: Date.now() - t0, reason });
    log("onClearAudio", { reason });
  },
  onTranscript: (role, text, isFinal) => {
    transcripts.push({ t_ms: Date.now() - t0, role, text, final: isFinal });
    log("onTranscript", { role, text, final: isFinal });
  },
  onToolCall: (event) => {
    toolCalls.push({ callId: event.callId, name: event.name, args: event.args });
    log("onToolCall", { callId: event.callId, name: event.name, args: event.args });
  },
  onResponseDone: (outcome) => {
    responsesDone.push({ t_ms: Date.now() - t0, status: outcome.status });
    log("onResponseDone", { status: outcome.status });
  },
  onEvent: (event) => log("onEvent", { direction: event.direction, type: event.type }),
  onReady: () => {
    ready = true;
    log("onReady", { supportsToolResultContinuation: bridge.supportsToolResultContinuation });
  },
  onError: (error) => log("onError", { message: error.message }),
  onClose: (reason) => {
    closed = true;
    log("onClose", { reason });
  },
});

log("createBridge", {
  model: "gemini-3.8-live-extended-thinking",
  thinkingLevel: "high",
  supportsToolResultContinuation: bridge.supportsToolResultContinuation,
});
await bridge.connect();
if (!(await until(() => ready, 15_000))) {
  log("fatal", { message: "bridge never became ready" });
  process.exit(1);
}

// Like the gateway relay, keep microphone audio flowing (silence) for the whole session.
const silence = Buffer.alloc(24_000 * 2 * 32 / 1000);
const pump = setInterval(() => {
  if (!closed) {
    bridge.sendAudio(silence);
  }
}, 32);
log("mic-pump", { note: "24 kHz PCM16 silence every 32 ms, as a relay client would stream" });

// Phase A: a consult with one final tool result (no interim), as the relay now sends for this model.
phase = "consult";
bridge.sendUserMessage?.("What's on my calendar tomorrow? Use the consult tool to check.");
if (!(await until(() => toolCalls.length > 0, 20_000))) {
  log("fatal", { message: "no tool call" });
  process.exit(1);
}
const doneBeforeResult = responsesDone.length;
await wait(6_000);
const call = toolCalls[0]!;
bridge.submitToolResult(call.callId, {
  text: "Tomorrow: dentist at ten in the morning, then lunch with Sam at noon.",
});
log("submitToolResult", { callId: call.callId, stage: "final", scheduling: "none" });
await until(() => responsesDone.length > doneBeforeResult && transcripts.some((x) => /dentist|sam/i.test(x.text)), 25_000);
await wait(1_500);

// Phase B: a long reply interrupted through handleBargeIn (client-content turn on this model).
phase = "interrupt";
const audioBefore = audioBytes;
bridge.sendUserMessage?.("Tell me, in a lot of detail, the history of lighthouses. Take your time.");
if (!(await until(() => audioBytes - audioBefore >= 24_000 * 2 * 3, 20_000))) {
  log("fatal", { message: "no reply audio to interrupt" });
}
const clearsBefore = clears.length;
const doneBefore = responsesDone.length;
const tBarge = Date.now() - t0;
bridge.handleBargeIn?.({ audioPlaybackActive: true });
log("handleBargeIn", { audioPlaybackActive: true });
await until(() => clears.length > clearsBefore && responsesDone.length > doneBefore, 8_000);
const audioAtDone = audioBytes;
await wait(3_000);
log("interrupt-result", {
  clear_after_ms: clears[clearsBefore] ? clears[clearsBefore]!.t_ms - tBarge : null,
  clear_reason: clears[clearsBefore]?.reason ?? null,
  response_done_after_ms: responsesDone[doneBefore] ? responsesDone[doneBefore]!.t_ms - tBarge : null,
  response_done_status: responsesDone[doneBefore]?.status ?? null,
  audio_bytes_after_done: audioBytes - audioAtDone,
});

// Phase C: the session is still usable afterwards.
phase = "follow-up";
const tBefore = transcripts.length;
bridge.sendUserMessage?.("Where did you leave off? Answer in one short sentence.");
await until(() => transcripts.slice(tBefore).some((x) => x.role === "assistant" && x.final && /left|off|stop|lighthouse|interrupt/i.test(x.text)), 20_000);
await wait(2_500);

phase = "close";
clearInterval(pump);
bridge.close();
await until(() => closed, 5_000);
log("summary", {
  toolCalls: toolCalls.map((c) => c.name),
  responsesDone,
  clears,
  transcripts: transcripts.filter((x) => x.final).map((x) => `${x.role}: ${x.text}`),
});
out.end();
