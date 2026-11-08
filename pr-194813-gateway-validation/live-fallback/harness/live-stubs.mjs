// Loopback stubs for the live-fallback check of openclaw/openclaw#194803 / PR #194813.
// replay (primary, Google Generative Language API shape, served to OpenClaw's own Google transport):
//   normal chat turns get a short SSE reply; every summarization request gets HTTP 429 with the
//   Google RESOURCE_EXHAUSTED body shape captured from a real daily-quota 429 on 2026-11-07.
//   Replayed values are redacted: no plan name, no quota figure, model id "model-a".
// dryfallback (OpenAI-compatible, dry run only): returns a structured summary for summary requests.
// Every request is appended to <log> as JSONL (no bodies). Prints {"replay":port,"dryfallback":port}.
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [logPath, portsPath] = process.argv.slice(2);
if (!logPath || !portsPath) throw new Error("usage: live-stubs.mjs <request-log.jsonl> <ports.json>");
const SUMMARY = /context summarization assistant/i;

export const REPLAYED_429_BODY = {
  error: {
    code: 429,
    message:
      "You've reached today's limit for model-a in third-party apps. Your daily limit refreshes in 1 hour, 46 minutes. Until then, you can switch to other models.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.Help",
        links: [{ description: "Learn more about Gemini API quotas", url: "https://aistudio.google.com/docs/rate-limits" }],
      },
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            description: "Generate content tokens per user per day limit exceeded. See https://aistudio.google.com/docs/rate-limits.",
            quotaMetric: "generativelanguage.googleapis.com/generate_content_tokens_per_model_per_user",
            quotaId: "GenerateContentTokensPerProjectPerUserPerModelPerDay",
            quotaDimensions: { location: "global", model: "model-a" },
          },
        ],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "6394s" },
    ],
  },
};

const log = (entry) => appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
  });
const json = (res, status, body, contentType = "application/json") => {
  res.writeHead(status, { "content-type": contentType });
  res.end(JSON.stringify(body));
};

const replay = createServer(async (req, res) => {
  const raw = await readBody(req);
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const match = /\/models\/([^/:]+):(streamGenerateContent|generateContent|countTokens)$/.exec(url.pathname);
  if (!match || req.method !== "POST") {
    log({ provider: "replay", kind: "other", method: req.method, path: url.pathname, status: 404 });
    json(res, 404, { error: { code: 404, message: `stub replay: no route ${req.method} ${url.pathname}`, status: "NOT_FOUND" } });
    return;
  }
  const [, model, method] = match;
  let body = {};
  try { body = JSON.parse(raw); } catch {}
  if (method === "countTokens") {
    log({ provider: "replay", model, kind: "countTokens", status: 200, bytes: raw.length });
    json(res, 200, { totalTokens: Math.ceil(raw.length / 4) });
    return;
  }
  const kind = SUMMARY.test(JSON.stringify(body.systemInstruction ?? "")) ? "summary" : "chat";
  if (kind === "summary") {
    log({ provider: "replay", model, kind, method, status: 429, bytes: raw.length });
    // The captured 429 from the streaming endpoint carried content-type text/event-stream.
    json(res, 429, REPLAYED_429_BODY, method === "streamGenerateContent" ? "text/event-stream" : "application/json");
    return;
  }
  const promptTokenCount = Math.ceil(raw.length / 4);
  const chunk = {
    candidates: [{ content: { role: "model", parts: [{ text: "Acknowledged by replay. Turn noted." }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount, candidatesTokenCount: 8, totalTokenCount: promptTokenCount + 8 },
    modelVersion: model,
  };
  log({ provider: "replay", model, kind, method, status: 200, bytes: raw.length });
  if (method === "streamGenerateContent") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify(chunk)}\r\n\r\n`);
  } else {
    json(res, 200, chunk);
  }
});

const textOf = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n") : "";
const dryfallback = createServer(async (req, res) => {
  const raw = await readBody(req);
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    log({ provider: "dryfallback", kind: "other", method: req.method, path: url.pathname, status: 404 });
    json(res, 404, { error: { message: "no route" } });
    return;
  }
  let body = {};
  try { body = JSON.parse(raw); } catch {}
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => textOf(m.content)).join("\n");
  const kind = SUMMARY.test(system) ? "summary" : "chat";
  const text = kind === "summary"
    ? ["## Decisions", "DRY-FALLBACK-SUMMARY: rollout review discussed.", "## Open TODOs", "Finish checklist.", "## Constraints/Rules", "None.", "## Pending user asks", "Continue the review.", "## Exact identifiers", "None."].join("\n")
    : "Acknowledged by dryfallback.";
  log({ provider: "dryfallback", model: body.model, kind, status: 200, bytes: raw.length });
  const usage = { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: 40, total_tokens: Math.ceil(raw.length / 4) + 40 };
  if (body.stream !== true) {
    json(res, 200, { id: "c", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage });
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const w = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  w({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: text } }] });
  w({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  w({ id: "c", object: "chat.completion.chunk", choices: [], usage });
  res.end("data: [DONE]\n\n");
});

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const ports = { replay: await listen(replay), dryfallback: await listen(dryfallback) };
writeFileSync(portsPath, `${JSON.stringify(ports)}\n`);
process.stdout.write(`${JSON.stringify(ports)}\n`);
