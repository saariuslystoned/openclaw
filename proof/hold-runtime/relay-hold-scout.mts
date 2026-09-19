// Headless gateway-relay client for the PR 152428 runtime proof. Not part of the OpenClaw
// tree. Run from the built worktree so the gateway-client package resolves:
//   cd <worktree> && node --import ./scripts/tsx.mjs <this file> <out.jsonl>
// Env: GATEWAY_URL (ws://127.0.0.1:18998), GATEWAY_TOKEN_FILE, QUESTION_WAV (24 kHz PCM16 mono).
// Behaves like the Android/browser client on the Google route: streams microphone audio,
// receives the forwarded toolCall, starts the consult with talk.client.toolCall, waits for
// the chat run's final, and submits it back with talk.session.submitToolResult.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const worktree = process.cwd();
const { GatewayClient } = await import(
  pathToFileURL(path.join(worktree, "packages/gateway-client/src/index.ts")).href
);
const { GATEWAY_CLIENT_IDS } = await import(
  pathToFileURL(path.join(worktree, "packages/gateway-protocol/src/client-info.ts")).href
);

const url = process.env.GATEWAY_URL ?? "ws://127.0.0.1:18998";
const token = fs.readFileSync(process.env.GATEWAY_TOKEN_FILE ?? "", "utf8").trim();
const wavPath = process.env.QUESTION_WAV ?? "";
const outPath = process.argv[2] ?? "relay-hold-scout.jsonl";
const sessionKey = process.env.TALK_SESSION_KEY ?? "main";

const out = fs.createWriteStream(outPath);
const t0 = Date.now();
let audioOutBytes = 0;
const log = (kind: string, data: Record<string, unknown> = {}) => {
  const rec = { t_ms: Date.now() - t0, kind, ...data };
  out.write(`${JSON.stringify(rec)}\n`);
  console.log(JSON.stringify(rec));
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

function readWavPcm(file: string): Buffer {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      const channels = buf.readUInt16LE(offset + 10);
      const rate = buf.readUInt32LE(offset + 12);
      const bits = buf.readUInt16LE(offset + 22);
      if (channels !== 1 || rate !== 24_000 || bits !== 16) {
        throw new Error(`expected 24 kHz mono PCM16, got ${channels}ch ${rate}Hz ${bits}bit`);
      }
    }
    if (id === "data") {
      return buf.subarray(offset + 8, offset + 8 + size);
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

type TalkEvent = {
  relaySessionId?: string;
  type?: string;
  role?: string;
  text?: string;
  final?: boolean;
  callId?: string;
  name?: string;
  args?: unknown;
  forced?: boolean;
  audioBase64?: string;
  reason?: string;
  message?: string;
  talkEvent?: { type?: string; final?: boolean };
};
type ChatPayload = {
  runId?: string;
  state?: string;
  message?: { content?: unknown; role?: string };
  errorMessage?: string;
};

let relaySessionId: string | undefined;
let ready = false;
let closed = false;
const transcripts: Array<{ t_ms: number; role: string; text: string; final: boolean }> = [];
const toolCalls: TalkEvent[] = [];
const toolResults: TalkEvent[] = [];
const chatEvents: ChatPayload[] = [];
let helloResolve!: () => void;
const hello = new Promise<void>((resolve) => {
  helloResolve = resolve;
});

const client = new GatewayClient({
  url,
  token,
  deviceIdentity: null,
  clientName: GATEWAY_CLIENT_IDS.CLI,
  clientDisplayName: "PR152428 relay hold scout",
  mode: "cli",
  scopes: ["operator.read", "operator.write"],
  onHelloOk: () => {
    log("hello");
    helloResolve();
  },
  onConnectError: (error: Error) => log("connectError", { message: error.message }),
  onClose: (code?: number, reason?: string) => {
    closed = true;
    log("wsClose", { code, reason });
  },
  onEvent: (evt: { event: string; payload?: unknown }) => {
    if (evt.event === "chat") {
      const payload = evt.payload as ChatPayload;
      chatEvents.push(payload);
      log("chat", { runId: payload.runId, state: payload.state });
      return;
    }
    if (evt.event !== "talk.event") {
      if (!["tick", "presence", "health"].includes(evt.event)) {
        log("event", { event: evt.event });
      }
      return;
    }
    const event = evt.payload as TalkEvent;
    if (relaySessionId && event.relaySessionId && event.relaySessionId !== relaySessionId) {
      return;
    }
    switch (event.type) {
      case "audio":
        audioOutBytes += event.audioBase64 ? Buffer.from(event.audioBase64, "base64").length : 0;
        return;
      case "ready":
        ready = true;
        log("talk.ready");
        return;
      case "transcript":
        if (event.role && event.text !== undefined) {
          transcripts.push({
            t_ms: Date.now() - t0,
            role: event.role,
            text: event.text,
            final: event.final ?? false,
          });
          if (event.final) {
            log("transcript.final", { role: event.role, text: event.text });
          }
        }
        return;
      case "toolCall":
        toolCalls.push(event);
        log("toolCall", { callId: event.callId, name: event.name, args: event.args, forced: event.forced });
        return;
      case "toolResult":
        toolResults.push(event);
        log("toolResult", { callId: event.callId, talkEvent: event.talkEvent?.type, final: event.talkEvent?.final });
        return;
      case "close":
        closed = true;
        log("talk.close", { reason: event.reason });
        return;
      case "error":
        log("talk.error", { message: event.message });
        return;
      default:
        log("talk.event", { type: event.type, talkEvent: event.talkEvent?.type });
    }
  },
});

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("\n")
      .trim();
  }
  return "";
}

async function handleConsult(call: TalkEvent): Promise<void> {
  const callId = call.callId!;
  if (call.forced) {
    await client.request("talk.session.submitToolResult", {
      sessionId: relaySessionId,
      callId,
      result: {
        status: "working",
        tool: "openclaw_agent_consult",
        message:
          "Tell the person briefly that you are checking, then wait for the final OpenClaw result before answering with the actual result.",
      },
      options: { willContinue: true },
    });
    log("submitToolResult.working", { callId });
  }
  const seen = chatEvents.length;
  const run = await client.request<{ runId: string; agentId: string; agentSessionKey: string }>(
    "talk.client.toolCall",
    {
      sessionKey,
      voiceSessionId: relaySessionId,
      relaySessionId,
      callId,
      name: "openclaw_agent_consult",
      args: call.args ?? {},
    },
  );
  log("talk.client.toolCall.ok", { callId, runId: run.runId, agentSessionKey: run.agentSessionKey });
  const finalOf = () =>
    chatEvents
      .slice(seen)
      .find((p) => p.runId === run.runId && ["final", "error", "aborted"].includes(p.state ?? ""));
  if (!(await until(() => finalOf() !== undefined, 120_000))) {
    log("chat.final.timeout", { runId: run.runId });
    await client.request("talk.session.submitToolResult", {
      sessionId: relaySessionId,
      callId,
      result: { error: "scout: chat final timed out" },
    });
    return;
  }
  const final = finalOf()!;
  const text = extractText(final.message?.content);
  log("chat.final", { runId: run.runId, state: final.state, text });
  await client.request("talk.session.submitToolResult", {
    sessionId: relaySessionId,
    callId,
    result: final.state === "final" ? { result: text } : { error: final.errorMessage ?? final.state },
  });
  log("submitToolResult.final", { callId });
}

client.start();
if (!(await Promise.race([hello.then(() => true), wait(20_000).then(() => false)]))) {
  log("fatal", { message: "no hello" });
  process.exit(1);
}
const created = await client.request<{ sessionId: string; relaySessionId?: string; audio?: unknown; model?: string; provider?: string }>(
  "talk.session.create",
  { sessionKey, mode: "realtime", transport: "gateway-relay", brain: "agent-consult" },
  { timeoutMs: 60_000 },
);
relaySessionId = created.relaySessionId ?? created.sessionId;
log("talk.session.create.ok", {
  sessionId: created.sessionId,
  relaySessionId,
  provider: created.provider,
  model: created.model,
  audio: created.audio,
});
if (!(await until(() => ready, 20_000))) {
  log("fatal", { message: "relay never became ready" });
  process.exit(1);
}

// Microphone: the spoken question followed by silence for the rest of the session.
const pcm = readWavPcm(wavPath);
const frameBytes = (24_000 * 2 * 40) / 1000;
const silence = Buffer.alloc(frameBytes);
let micTimestamp = 0;
const appendAudio = async (frame: Buffer) => {
  micTimestamp += 40;
  await client.request("talk.session.appendAudio", {
    sessionId: relaySessionId,
    audioBase64: frame.toString("base64"),
    timestamp: micTimestamp,
  });
};
await wait(1_000);
log("mic.question.start", { bytes: pcm.length, seconds: pcm.length / 48_000 });
for (let offset = 0; offset < pcm.length; offset += frameBytes) {
  const frame = pcm.subarray(offset, Math.min(offset + frameBytes, pcm.length));
  await appendAudio(frame.length === frameBytes ? frame : Buffer.concat([frame, Buffer.alloc(frameBytes - frame.length)]));
  await wait(40);
}
log("mic.question.end");
let pumping = true;
const pump = (async () => {
  while (pumping && !closed) {
    await appendAudio(silence).catch((error: unknown) => log("appendAudio.error", { message: String(error) }));
    await wait(40);
  }
})();

const handled = new Set<string>();
const consultLoop = (async () => {
  while (!closed) {
    const next = toolCalls.find((call) => call.callId && !handled.has(call.callId));
    if (next) {
      handled.add(next.callId!);
      if (next.name === "openclaw_agent_consult") {
        await handleConsult(next).catch((error: unknown) => log("consult.error", { message: String(error) }));
      } else {
        log("toolCall.unsupported", { name: next.name });
      }
    }
    await wait(50);
  }
})();

const gotAnswer = await until(
  () =>
    toolResults.length > 0 &&
    transcripts.some((x) => x.role === "assistant" && x.final && x.t_ms > (toolResults[0] ? 0 : Infinity)),
  150_000,
);
await wait(gotAnswer ? 6_000 : 1_000);
log("summary", {
  toolCalls: toolCalls.map((c) => ({ callId: c.callId, name: c.name, forced: c.forced })),
  toolResults: toolResults.length,
  audioOutBytes,
  finals: transcripts.filter((x) => x.final).map((x) => `${x.role}: ${x.text}`),
});
pumping = false;
await pump;
await client.request("talk.session.close", { sessionId: relaySessionId }).catch((error: unknown) =>
  log("close.error", { message: String(error) }),
);
log("talk.session.close.sent");
await until(() => closed, 5_000);
closed = true;
await consultLoop;
client.stop();
out.end();
process.exit(0);
