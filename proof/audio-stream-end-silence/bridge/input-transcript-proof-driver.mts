// Headless proof driver: runs this checkout's Google realtime voice bridge against the live
// Gemini API with spoken microphone audio and logs every bridge callback, to show which user
// transcripts the bridge finalizes. Not part of the tree; copy to the checkout root and run
//   node --import ./scripts/tsx.mjs input-transcript-proof-driver.mts <model> <out.jsonl>
// Speech is synthesized with macOS `say` at 24 kHz PCM16 and streamed in 32 ms frames with
// silence between utterances, as a relay client streams its microphone.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGoogleRealtimeVoiceProvider } from "./extensions/google/realtime-voice-provider.js";
import { REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ } from "./src/talk/provider-types.js";

const model = process.argv[2] ?? "gemini-3.8-live-extended-thinking";
const out = fs.createWriteStream(process.argv[3] ?? "input-transcript-proof.jsonl");
const commit = execFileSync("git", ["rev-parse", "--short=11", "HEAD"]).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain", "extensions/google"]).toString().trim();
const t0 = Date.now();
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

// `say` writes RIFF with extra chunks (JUNK/FLLR); return only the `data` chunk.
function synth(text: string): Buffer {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "say-")), "u.wav");
  execFileSync("/usr/bin/say", ["-o", file, "--data-format=LEI16@24000", text]);
  const wav = fs.readFileSync(file);
  for (let off = 12; off + 8 <= wav.length; ) {
    const id = wav.toString("ascii", off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === "data") {
      return wav.subarray(off + 8, off + 8 + size);
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

const UTTERANCES = [
  "Hello there. Please tell me, in one short sentence, what color the sky usually is on a clear day.",
  "I want to plan a small garden this spring. I have a sunny patch about four meters long, the soil is a bit sandy, and I would like easy vegetables. [[slnc 700]] Which three would you suggest, briefly?",
  "Thanks. Now name one fruit that is yellow, and keep it short.",
];

let ready = false;
let closed = false;
let audioBytes = 0;
const responsesDone: Array<{ t_ms: number; status: string }> = [];
const transcripts: Array<{ t_ms: number; role: string; text: string; final: boolean }> = [];

const bridge = buildGoogleRealtimeVoiceProvider().createBridge({
  providerConfig: {
    model,
    ...(model.includes("extended-thinking") ? { thinkingLevel: "high" as const } : {}),
  },
  audioFormat: REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
  instructions: "You are a test voice. Keep every answer to one short sentence.",
  onAudio: (audio) => {
    audioBytes += audio.length;
    log("audio", { bytes: audio.length, total: audioBytes });
  },
  onClearAudio: (reason) => log("onClearAudio", { reason }),
  onTranscript: (role, text, isFinal) => {
    transcripts.push({ t_ms: Date.now() - t0, role, text, final: isFinal });
    log("onTranscript", { role, text, final: isFinal });
  },
  onResponseDone: (outcome) => {
    responsesDone.push({ t_ms: Date.now() - t0, status: outcome.status });
    log("onResponseDone", { status: outcome.status });
  },
  onEvent: (event) => log("onEvent", { direction: event.direction, type: event.type }),
  onReady: () => {
    ready = true;
    log("onReady");
  },
  onError: (error) => log("onError", { message: error.message }),
  onClose: (reason) => {
    closed = true;
    log("onClose", { reason });
  },
});

log("createBridge", { model, commit, micSilence: process.env.MIC_SILENCE === "zeros" ? "zeros" : "noise-floor", extensionsGoogleDirty: dirty !== "" });
await bridge.connect();
if (!(await until(() => ready, 15_000))) {
  log("fatal", { message: "bridge never became ready" });
  process.exit(1);
}

// Between utterances stream a real microphone's noise floor (random samples within +/-8 LSB,
// about -72 dBFS), not digital zeros: the bridge treats exact zeros as silence, sends
// audioStreamEnd after 500 ms and stops streaming, which a phone microphone never does.
const FRAME = (24_000 * 2 * 32) / 1000;
const noiseFloor = () => {
  const frame = Buffer.alloc(FRAME);
  for (let i = 0; i < FRAME / 2; i += 1) {
    frame.writeInt16LE(Math.round((Math.random() * 2 - 1) * 8), i * 2);
  }
  return frame;
};
const mic: Buffer[] = [];
const pump = setInterval(() => {
  if (!closed) {
    bridge.sendAudio(mic.shift() ?? (process.env.MIC_SILENCE === "zeros" ? Buffer.alloc(FRAME) : noiseFloor()));
  }
}, 32);

for (const [i, text] of UTTERANCES.entries()) {
  phase = `utterance-${i + 1}`;
  const pcm = synth(text);
  for (let off = 0; off < pcm.length; off += FRAME) {
    mic.push(pcm.subarray(off, off + FRAME));
  }
  const doneBefore = responsesDone.length;
  log("speak", { text: text.replace(/\[\[slnc \d+\]\] /g, ""), audio_ms: Math.round((pcm.length / 48_000) * 1000) });
  if (!(await until(() => responsesDone.length > doneBefore && mic.length === 0, 40_000))) {
    log("no-response-within", { seconds: 40 });
  }
  await wait(4_000);
}

phase = "before-close";
const finalsBeforeClose = transcripts.filter((x) => x.final);
log("finals-before-close", {
  user: finalsBeforeClose.filter((x) => x.role === "user").map((x) => x.text),
  assistant: finalsBeforeClose.filter((x) => x.role === "assistant").map((x) => x.text),
});

phase = "close";
clearInterval(pump);
bridge.close();
await until(() => closed, 5_000);
log("summary", {
  model,
  commit,
  userFinalsDuringCall: finalsBeforeClose.filter((x) => x.role === "user").length,
  userPartialsDuringCall: transcripts.filter((x) => x.role === "user" && !x.final && x.t_ms <= (finalsBeforeClose.at(-1)?.t_ms ?? Infinity)).length,
  finals: transcripts.filter((x) => x.final).map((x) => `${x.role}: ${x.text}`),
});
out.end();
