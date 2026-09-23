// Headless proof driver for the Extended Thinking interaction lifecycle: runs this checkout's
// Google realtime voice bridge against the live Gemini API, logs every bridge callback AND
// every server frame on the wire (audio stripped), so the trace shows the interactionStatus
// that accompanies each turnComplete next to what the bridge did with it. Not part of the
// tree; copy to the checkout root and run
//   node --import ./scripts/tsx.mjs lifecycle-proof-driver.mts <out.jsonl>
// Needs GEMINI_API_KEY in the environment (never logged).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { buildGoogleRealtimeVoiceProvider } from "./extensions/google/realtime-voice-provider.js";
import { REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ } from "./src/talk/provider-types.js";

const MODEL = "gemini-3.8-live-extended-thinking";
const out = fs.createWriteStream(process.argv[2] ?? "lifecycle-proof.jsonl");
const commit = execFileSync("git", ["rev-parse", "--short=11", "HEAD"]).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain", "extensions/google", "src/talk"])
  .toString()
  .trim();
const t0 = Date.now();
let phase = "connect";
const log = (kind: string, data: Record<string, unknown> = {}) => {
  const rec = { t_ms: Date.now() - t0, phase, kind, ...data };
  out.write(`${JSON.stringify(rec)}\n`);
  if (kind !== "audio" && kind !== "wire-audio") {
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

// --- wire tap: the SDK (@google/genai, resolved from extensions/google) talks over `ws`.
// Wrap that exact module's emit so every inbound frame is logged before the SDK parses it.
type WireTurn = { t_ms: number; interactionStatus?: string; interrupted?: boolean };
const wireTurns: WireTurn[] = [];
const wireToolCalls: Array<{ t_ms: number; ids: string[] }> = [];
{
  const extRequire = createRequire(path.resolve("extensions/google/package.json"));
  const genaiEntry = extRequire.resolve("@google/genai");
  const wsModule = createRequire(genaiEntry)("ws");
  const WS = wsModule.WebSocket ?? wsModule;
  const originalEmit = WS.prototype.emit;
  WS.prototype.emit = function tappedEmit(event: string, ...args: unknown[]) {
    if (event === "message") {
      try {
        const raw = args[0];
        const text = Buffer.isBuffer(raw)
          ? raw.toString("utf8")
          : Array.isArray(raw)
            ? Buffer.concat(raw).toString("utf8")
            : String(raw);
        tapFrame(JSON.parse(text));
      } catch (error) {
        log("wire-unparsed", { message: (error as Error).message });
      }
    }
    return originalEmit.call(this, event, ...args);
  };
}
function tapFrame(frame: Record<string, unknown>): void {
  if (frame.setupComplete) {
    log("wire", { setupComplete: true });
  }
  const content = frame.serverContent as Record<string, unknown> | undefined;
  if (content) {
    const modelTurn = content.modelTurn as { parts?: Array<Record<string, unknown>> } | undefined;
    let audioBytes = 0;
    const texts: string[] = [];
    for (const part of modelTurn?.parts ?? []) {
      const inline = part.inlineData as { data?: string } | undefined;
      if (inline?.data) {
        audioBytes += Math.floor((inline.data.length * 3) / 4);
      }
      if (typeof part.text === "string") {
        texts.push(part.text);
      }
    }
    const outputTranscription = content.outputTranscription as { text?: string } | undefined;
    const inputTranscription = content.inputTranscription as { text?: string } | undefined;
    const boundary =
      content.turnComplete || content.generationComplete || content.interrupted || "interactionStatus" in content;
    if (audioBytes && !boundary && !outputTranscription && !inputTranscription) {
      log("wire-audio", { audioBytes });
      return;
    }
    const rec: Record<string, unknown> = {};
    for (const key of ["turnComplete", "generationComplete", "interrupted", "interactionStatus"]) {
      if (content[key] !== undefined) {
        rec[key] = content[key];
      }
    }
    if (audioBytes) {
      rec.audioBytes = audioBytes;
    }
    if (texts.length) {
      rec.modelText = texts.join("");
    }
    if (outputTranscription?.text) {
      rec.outputTranscription = outputTranscription.text;
    }
    if (inputTranscription?.text) {
      rec.inputTranscription = inputTranscription.text;
    }
    if (content.turnComplete) {
      wireTurns.push({
        t_ms: Date.now() - t0,
        interactionStatus: content.interactionStatus as string | undefined,
        interrupted: Boolean(content.interrupted),
      });
    }
    log("wire", rec);
  }
  const toolCall = frame.toolCall as { functionCalls?: Array<{ id?: string; name?: string }> } | undefined;
  if (toolCall) {
    const ids = (toolCall.functionCalls ?? []).map((c) => `${c.name}#${c.id}`);
    wireToolCalls.push({ t_ms: Date.now() - t0, ids });
    log("wire", { toolCall: ids });
  }
  if (frame.toolCallCancellation) {
    log("wire", { toolCallCancellation: frame.toolCallCancellation });
  }
  if (frame.goAway) {
    log("wire", { goAway: frame.goAway });
  }
}

let ready = false;
let closed = false;
let audioBytes = 0;
const toolCalls: Array<{ t_ms: number; callId: string; name: string; args: unknown }> = [];
const responsesDone: Array<{ t_ms: number; status: string }> = [];
const clears: Array<{ t_ms: number; reason?: string }> = [];
const transcripts: Array<{ t_ms: number; role: string; text: string; final: boolean }> = [];

const provider = buildGoogleRealtimeVoiceProvider();
const bridge = provider.createBridge({
  providerConfig: { model: MODEL, thinkingLevel: "high" },
  audioFormat: REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
  instructions:
    "You are a test voice. Keep answers short unless asked to count or to go into detail. " +
    "Before using a tool, always say a short spoken filler sentence such as 'Let me check on that.' out loud first.",
  tools: [
    {
      type: "function",
      name: "openclaw_agent_consult",
      description: "Ask the OpenClaw agent to look something up (calendar, facts, tasks).",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string" } },
        required: ["prompt"],
      },
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
    toolCalls.push({ t_ms: Date.now() - t0, callId: event.callId, name: event.name, args: event.args });
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
  commit,
  extensionsDirty: dirty !== "",
  model: MODEL,
  thinkingLevel: "high",
  supportsToolResultContinuation: bridge.supportsToolResultContinuation,
});
await bridge.connect();
if (!(await until(() => ready, 15_000))) {
  log("fatal", { message: "bridge never became ready" });
  process.exit(1);
}

// Between utterances stream a real microphone's noise floor (random samples within +/-8 LSB),
// not digital zeros: the bridge treats exact zeros as silence and stops streaming after 500 ms.
const FRAME = (24_000 * 2 * 32) / 1000;
const noiseFloor = () => {
  const frame = Buffer.alloc(FRAME);
  for (let i = 0; i < FRAME / 2; i += 1) {
    frame.writeInt16LE(Math.round((Math.random() * 2 - 1) * 8), i * 2);
  }
  return frame;
};
const pump = setInterval(() => {
  if (!closed) {
    bridge.sendAudio(noiseFloor());
  }
}, 32);
log("mic-pump", { note: "24 kHz PCM16 noise floor every 32 ms, as a relay client would stream" });

// Phase A: spoken filler, then a consult with one final tool result. The filler's own
// turnComplete arrives with interactionStatus IN_PROGRESS; the answer's with IDLE.
phase = "consult";
bridge.sendUserMessage?.(
  "First say 'Let me check on that' out loud, then use the consult tool to find out what is on my calendar tomorrow.",
);
if (!(await until(() => toolCalls.length > 0, 30_000))) {
  log("fatal", { message: "no tool call" });
  process.exit(1);
}
const tToolCall = toolCalls[0]!.t_ms;
const fillerTurns = wireTurns.filter((turn) => turn.t_ms <= tToolCall);
const doneBeforeToolCall = responsesDone.filter((done) => done.t_ms <= tToolCall);
const fillerTranscripts = transcripts.filter((x) => x.role === "assistant" && x.final && x.t_ms <= tToolCall);
log("check-filler", {
  filler_turnCompletes_before_toolCall: fillerTurns.length,
  filler_interactionStatus: fillerTurns.map((turn) => turn.interactionStatus ?? null),
  filler_transcripts: fillerTranscripts.map((x) => x.text),
  onResponseDone_before_toolCall: doneBeforeToolCall.map((done) => done.status),
  interaction_left_active: fillerTurns.length > 0 && doneBeforeToolCall.length === 0,
});
await wait(3_000);
const doneBeforeResult = responsesDone.length;
const turnsBeforeResult = wireTurns.length;
const call = toolCalls[0]!;
bridge.submitToolResult(call.callId, {
  text: "Tomorrow: dentist at ten in the morning, then lunch with Sam at noon.",
});
log("submitToolResult", { callId: call.callId, stage: "final", scheduling: "none" });
await until(
  () => responsesDone.length > doneBeforeResult && transcripts.some((x) => /dentist|sam/i.test(x.text)),
  40_000,
);
await wait(1_500);
const answerTurns = wireTurns.slice(turnsBeforeResult);
const answerDone = responsesDone.slice(doneBeforeResult);
log("check-answer", {
  answer_turnCompletes: answerTurns.map((turn) => turn.interactionStatus ?? null),
  onResponseDone_after_result: answerDone.map((done) => done.status),
  answer_transcripts: transcripts
    .filter((x) => x.role === "assistant" && x.final && x.t_ms > tToolCall)
    .map((x) => x.text),
  completed_at_idle:
    answerDone.some((done) => done.status === "completed") &&
    answerTurns.some((turn) => turn.interactionStatus === "IDLE"),
});

// Phase B: a long reply interrupted through handleBargeIn (client-content turn on this model).
phase = "interrupt";
const audioBefore = audioBytes;
bridge.sendUserMessage?.("Tell me, in a lot of detail, the history of lighthouses. Take your time.");
if (!(await until(() => audioBytes - audioBefore >= 24_000 * 2 * 3, 30_000))) {
  log("fatal", { message: "no reply audio to interrupt" });
}
const clearsBefore = clears.length;
const doneBefore = responsesDone.length;
const turnsBeforeBarge = wireTurns.length;
const tBarge = Date.now() - t0;
bridge.handleBargeIn?.({ audioPlaybackActive: true });
log("handleBargeIn", { audioPlaybackActive: true });
await until(() => clears.length > clearsBefore && responsesDone.length > doneBefore, 8_000);
const audioAtDone = audioBytes;
await wait(3_000);
log("check-interrupt", {
  clear_after_ms: clears[clearsBefore] ? clears[clearsBefore]!.t_ms - tBarge : null,
  clear_reason: clears[clearsBefore]?.reason ?? null,
  response_done_after_ms: responsesDone[doneBefore] ? responsesDone[doneBefore]!.t_ms - tBarge : null,
  response_done_status: responsesDone[doneBefore]?.status ?? null,
  interrupted_turnCompletes: wireTurns
    .slice(turnsBeforeBarge)
    .map((turn) => ({ interrupted: turn.interrupted, interactionStatus: turn.interactionStatus ?? null })),
  audio_bytes_after_done: audioBytes - audioAtDone,
  interruption_terminated_response: responsesDone[doneBefore]?.status === "cancelled",
});

// Phase C: the session is still usable afterwards.
phase = "follow-up";
const tBefore = transcripts.length;
bridge.sendUserMessage?.("Where did you leave off? Answer in one short sentence.");
await until(
  () =>
    transcripts
      .slice(tBefore)
      .some((x) => x.role === "assistant" && x.final && /left|off|stop|lighthouse|interrupt/i.test(x.text)),
  30_000,
);
await wait(2_500);

phase = "close";
clearInterval(pump);
bridge.close();
await until(() => closed, 5_000);
log("summary", {
  commit,
  model: MODEL,
  toolCalls: toolCalls.map((c) => c.name),
  responsesDone,
  clears,
  wireTurns,
  transcripts: transcripts.filter((x) => x.final).map((x) => `${x.role}: ${x.text}`),
});
out.end();
