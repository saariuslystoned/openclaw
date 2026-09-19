// Headless gateway-relay cancellation proof client (not part of the OpenClaw tree).
// Connects to the isolated proof gateway as an operator, opens a realtime relay session,
// speaks a `say`-generated utterance as 24 kHz PCM16, cancels the reply with
// talk.session.cancelOutput once audio flows, then asks a second question and records
// whether it is answered. Audio payloads, the token, and the key are never logged.
//
// Usage: OPENCLAW_WORKTREE=<openclaw worktree> tsx cancel-client.mts <label> <model>
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const RUN = path.resolve(HERE, "..");
const WORKTREE = process.env.OPENCLAW_WORKTREE!;
const { GatewayClient } = await import(path.join(WORKTREE, "packages/gateway-client/dist/index.mjs"));

const [label = "run", model = "gemini-3.8-live"] = process.argv.slice(2);
const OUT = path.join(HERE, `events-${label}.jsonl`);
writeFileSync(OUT, "");
const t0 = Date.now();
const log = (kind: string, data: Record<string, unknown> = {}) => {
  const line = { t: Date.now() - t0, kind, ...data };
  appendFileSync(OUT, JSON.stringify(line) + "\n");
  console.log(JSON.stringify(line));
};

const FRAME_MS = 20;
const FRAME_BYTES = (24_000 * 2 * FRAME_MS) / 1000;
function sayPcm(text: string): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), "say-"));
  const aiff = path.join(dir, "u.aiff");
  const wav = path.join(dir, "u.wav");
  execFileSync("say", ["-o", aiff, text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@24000", "-c", "1", aiff, wav]);
  const buf = readFileSync(wav);
  let off = 12;
  while (off < buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") return buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

const fingerprint = execFileSync(
  "openssl",
  ["x509", "-in", path.join(RUN, "gateway/tls/server.crt"), "-noout", "-fingerprint", "-sha256"],
  { encoding: "utf8" },
)
  .split("=")[1]!
  .trim();
const token = readFileSync(path.join(RUN, "gateway/token.txt"), "utf8").trim();

let relaySessionId: string | undefined;
let lastAudioTurnId: string | undefined;
const audioByTurn = new Map<string, number>();
const hello = Promise.withResolvers<void>();
const client = new GatewayClient({
  url: "wss://127.0.0.1:18999",
  token,
  tlsFingerprint: fingerprint,
  minProtocol: 4,
  maxProtocol: 4,
  role: "operator",
  scopes: ["operator.read", "operator.write", "operator.talk"],
  onHelloOk: () => hello.resolve(),
  onConnectError: (error: Error) => hello.reject(error),
  onEvent: (evt: { event: string; payload: any }) => {
    if (evt.event !== "talk.event" || evt.payload?.relaySessionId !== relaySessionId) return;
    const p = evt.payload;
    const turnId = p.talkEvent?.turnId;
    if (p.type === "inputAudio") return;
    if (p.type === "audio") {
      lastAudioTurnId = turnId;
      audioByTurn.set(turnId, (audioByTurn.get(turnId) ?? 0) + 1);
      const n = audioByTurn.get(turnId)!;
      // Log every audio frame count sparsely; the frame bytes themselves are not recorded.
      if (n === 1 || n % 25 === 0) log("event.audio", { turnId, frame: n });
      return;
    }
    log(`event.${p.type}`, {
      turnId,
      talkEventType: p.talkEvent?.type,
      ...(p.role ? { role: p.role } : {}),
      ...(typeof p.text === "string" ? { text: p.text.slice(0, 200) } : {}),
      ...(p.final !== undefined ? { final: p.final } : {}),
      ...(p.message ? { message: p.message } : {}),
      ...(p.reason ? { reason: p.reason } : {}),
    });
  },
});
client.start();
await hello.promise;
log("connected");

const created = await client.request("talk.session.create", {
  mode: "realtime",
  transport: "gateway-relay",
  brain: "agent-consult",
  provider: "google",
  ...(model === "default" ? {} : { model }),
});
relaySessionId = created.relaySessionId ?? created.sessionId;
log("session.created", { model, relaySessionId });

let streaming: Buffer = Buffer.alloc(0);
let stopped = false;
const silence = Buffer.alloc(FRAME_BYTES);
// The phone and Control UI stream microphone frames continuously; so does this client.
const pump = (async () => {
  let next = Date.now();
  while (!stopped) {
    let frame = silence;
    if (streaming.length > 0) {
      frame = Buffer.alloc(FRAME_BYTES);
      streaming.copy(frame, 0, 0, Math.min(FRAME_BYTES, streaming.length));
      streaming = streaming.subarray(Math.min(FRAME_BYTES, streaming.length));
    }
    await client
      .request("talk.session.appendAudio", {
        sessionId: relaySessionId,
        audioBase64: frame.toString("base64"),
      })
      .catch((error: Error) => log("appendAudio.error", { message: error.message }));
    next += FRAME_MS;
    await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
  }
})();
const speak = (text: string) => {
  streaming = Buffer.concat([streaming, sayPcm(text)]);
  log("user.speak", { text });
};
const waitFor = async (pred: () => boolean, ms: number, what: string) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

await new Promise((r) => setTimeout(r, 1500));
speak("Please tell me a long, detailed story about a lighthouse keeper and a storm. Take at least two minutes.");
await waitFor(() => lastAudioTurnId !== undefined && (audioByTurn.get(lastAudioTurnId) ?? 0) >= 25, 45_000, "reply audio");
const cancelledTurnId = lastAudioTurnId!;
log("cancelOutput.request", { turnId: cancelledTurnId, audioFramesBefore: audioByTurn.get(cancelledTurnId) });
const started = Date.now();
const result = await client.request("talk.session.cancelOutput", {
  sessionId: relaySessionId,
  turnId: cancelledTurnId,
  reason: "headless-proof-stop",
});
log("cancelOutput.result", { latencyMs: Date.now() - started, result });
const framesAtCancel = audioByTurn.get(cancelledTurnId) ?? 0;

await new Promise((r) => setTimeout(r, 8_000));
log("after-cancel.window", {
  cancelledTurnAudioFramesAfterResult: (audioByTurn.get(cancelledTurnId) ?? 0) - framesAtCancel,
});

speak("What is two plus two? Answer in one short sentence.");
await waitFor(
  () => lastAudioTurnId !== undefined && lastAudioTurnId !== cancelledTurnId && (audioByTurn.get(lastAudioTurnId) ?? 0) >= 5,
  45_000,
  "second reply audio",
);
const secondTurnId = lastAudioTurnId!;
await new Promise((r) => setTimeout(r, 8_000));
log("second-turn.answered", { turnId: secondTurnId, audioFrames: audioByTurn.get(secondTurnId) });

stopped = true;
await pump;
await client.request("talk.session.close", { sessionId: relaySessionId }).catch(() => undefined);
log("done", { audioFramesByTurn: Object.fromEntries(audioByTurn) });
client.stop();
process.exit(0);
