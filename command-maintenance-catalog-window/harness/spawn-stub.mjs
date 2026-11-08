// Loopback OpenAI-compatible chat-completions stub for the subagent-completion budget check.
// One server, two model ids (both zero cost): "big" (declared window > 200k) and "small" (200k
// control) share behavior. Behavior by the latest message:
//   - summarization system prompt -> a structured summary (logged kind=summary)
//   - latest user text contains SPAWN-FORK / SPAWN-ISOLATED and no tool result yet -> one
//     sessions_spawn tool call (context fork / isolated)
//   - latest message is a tool result -> "Parent noted the spawn."
//   - latest user text contains CHILD-TASK -> "CHILD-DONE"
//   - otherwise -> "Acknowledged."
// Usage reported as prompt_tokens = ceil(request bytes / 4). Every request is appended to <log>
// as JSONL (sizes and kinds only, no bodies). Prints {"port":N} once listening.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const logPath = process.argv[2];
if (!logPath) throw new Error("usage: spawn-stub.mjs <request-log.jsonl>");
const SUMMARY_SYSTEM = /context summarization assistant/i;
let callSeq = 0;

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

function writeStream(res, delta, finishReason, promptTokens) {
  const usage = { prompt_tokens: promptTokens, completion_tokens: 40, total_tokens: promptTokens + 40 };
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (choices, extra = {}) =>
    res.write(`data: ${JSON.stringify({ id: "chatcmpl_stub", object: "chat.completion.chunk", choices, ...extra })}\n\n`);
  chunk([{ index: 0, delta: { role: "assistant", ...delta } }]);
  chunk([{ index: 0, delta: {}, finish_reason: finishReason }]);
  chunk([], { usage });
  res.write("data: [DONE]\n\n");
  res.end();
}

function summary() {
  return [
    "## Decisions",
    "STUB-SUMMARY: earlier turns discussed the checklist.",
    "## Open TODOs",
    "None.",
    "## Constraints/Rules",
    "None.",
    "## Pending user asks",
    "None.",
    "## Exact identifiers",
    "None.",
  ].join("\n");
}

createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/v1/models") {
      writeJson(res, 200, { object: "list", data: ["big", "small", "options"].map((id) => ({ id, object: "model" })) });
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      writeJson(res, 404, { error: { message: `stub: no route ${req.method} ${url.pathname}` } });
      return;
    }
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => textOf(m.content)).join("\n");
    const last = messages[messages.length - 1];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    // The current turn may append runtime-context user blocks after the typed message.
    const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
    const turnUserText = messages.slice(lastAssistant + 1).filter((m) => m.role === "user").map((m) => textOf(m.content)).join("\n");
    const lastUserText = textOf(lastUser?.content);
    const tools = Array.isArray(body.tools) ? body.tools.map((t) => t?.function?.name).filter(Boolean) : [];
    const promptTokens = Math.ceil(raw.length / 4);
    let kind = "chat";
    if (SUMMARY_SYSTEM.test(system)) {
      kind = "summary";
      writeStream(res, { content: summary() }, "stop", promptTokens);
    } else if (last?.role === "tool") {
      kind = "after-tool";
      writeStream(res, { content: "Parent noted the spawn." }, "stop", promptTokens);
    } else if (/SPAWN-(FORK|ISOLATED)/.test(turnUserText) && tools.includes("sessions_spawn")) {
      kind = "spawn";
      const context = /SPAWN-FORK/.test(turnUserText) ? "fork" : "isolated";
      const args = { task: "CHILD-TASK: reply with CHILD-DONE and nothing else.", label: "budget-check", context };
      writeStream(res, { tool_calls: [{ index: 0, id: `call_${++callSeq}`, type: "function", function: { name: "sessions_spawn", arguments: JSON.stringify(args) } }] }, "tool_calls", promptTokens);
    } else if (/CHILD-TASK/.test(turnUserText)) {
      kind = "child";
      writeStream(res, { content: "CHILD-DONE" }, "stop", promptTokens);
    } else {
      writeStream(res, { content: "Acknowledged." }, "stop", promptTokens);
    }
    appendFileSync(
      logPath,
      `${JSON.stringify({ ts: new Date().toISOString(), model: body.model, kind, bytes: raw.length, estTokens: promptTokens, messages: messages.length, lastRole: last?.role, lastUserHead: lastUserText.slice(0, 40), turnMarker: (/SPAWN-FORK|SPAWN-ISOLATED|CHILD-TASK/.exec(turnUserText) ?? [])[0], hasSpawnTool: tools.includes("sessions_spawn"), tools })}\n`,
    );
  });
}).listen(0, "127.0.0.1", function () {
  process.stdout.write(`${JSON.stringify({ port: this.address().port })}\n`);
});
