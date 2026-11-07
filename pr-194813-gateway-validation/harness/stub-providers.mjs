// Two loopback OpenAI-compatible chat-completions stubs for the #194803 Gateway check.
// stuba (primary): answers normal chat turns; returns HTTP 429 for every summarization request,
//   body {"error":{"message":"daily token quota exhausted"}}: no error code, no "too many requests".
// stubb (fallback): returns a structured summary for summarization requests.
// Every request is appended to <log> as JSONL. Prints {"stuba":port,"stubb":port} once listening.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const logPath = process.argv[2];
if (!logPath) throw new Error("usage: stub-providers.mjs <request-log.jsonl>");
const SUMMARY_SYSTEM = /context summarization assistant/i;

const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
      : "";

function writeJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function writeCompletion(res, stream, text, promptTokens) {
  const usage = { prompt_tokens: promptTokens, completion_tokens: 40, total_tokens: promptTokens + 40 };
  if (!stream) {
    writeJson(res, 200, {
      id: "chatcmpl_stub",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage,
    });
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (choices, extra = {}) =>
    res.write(`data: ${JSON.stringify({ id: "chatcmpl_stub", object: "chat.completion.chunk", choices, ...extra })}\n\n`);
  chunk([{ index: 0, delta: { role: "assistant", content: text } }]);
  chunk([{ index: 0, delta: {}, finish_reason: "stop" }]);
  chunk([], { usage });
  res.write("data: [DONE]\n\n");
  res.end();
}

function fallbackSummary(userText) {
  // STUB_GENERIC_SUMMARY=1: an unstructured summary (no required sections), as a generic stub would send.
  if (process.env.STUB_GENERIC_SUMMARY === "1") return "FALLBACK-SUMMARY-194803: summary of the conversation so far.";
  const latest = /Latest user request context:\s*"([^"\n]{0,200})/.exec(userText)?.[1] ?? "Continue the review.";
  return [
    "## Decisions",
    "FALLBACK-SUMMARY-194803: the review checklist was discussed across earlier turns.",
    "## Open TODOs",
    "Finish the remaining checklist items.",
    "## Constraints/Rules",
    "None.",
    "## Pending user asks",
    latest,
    "## Exact identifiers",
    "None.",
  ].join("\n");
}

function makeServer(provider) {
  return createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/v1/models") {
        writeJson(res, 200, { object: "list", data: [{ id: "m", object: "model" }] });
        return;
      }
      if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
        writeJson(res, 404, { error: { message: `stub ${provider}: no route ${req.method} ${url.pathname}` } });
        return;
      }
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {}
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const system = messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => textOf(m.content)).join("\n");
      const user = messages.filter((m) => m.role === "user").map((m) => textOf(m.content)).join("\n");
      const kind = SUMMARY_SYSTEM.test(system) ? "summary" : "chat";
      const promptTokens = Math.ceil(raw.length / 4);
      let status = 200;
      if (provider === "stuba" && kind === "summary") {
        status = 429;
        writeJson(res, 429, { error: { message: "daily token quota exhausted" } });
      } else if (kind === "summary") {
        writeCompletion(res, body.stream === true, fallbackSummary(user), promptTokens);
      } else {
        writeCompletion(res, body.stream === true, `Acknowledged by ${provider}. Turn noted.`, promptTokens);
      }
      appendFileSync(
        logPath,
        `${JSON.stringify({ ts: new Date().toISOString(), provider, model: body.model, kind, status, stream: body.stream === true, bytes: raw.length })}\n`,
      );
    });
  });
}

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const ports = { stuba: await listen(makeServer("stuba")), stubb: await listen(makeServer("stubb")) };
process.stdout.write(`${JSON.stringify(ports)}\n`);
