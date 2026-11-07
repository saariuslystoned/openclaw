// Isolated real-Gateway check for openclaw/openclaw#194803 / PR #194813.
// Usage: node --import <checkout>/scripts/tsx.mjs drive.mts <checkout> <outDir> <label>
// Starts loopback stub providers, a source Gateway (`gateway run --auth none`) with a throwaway
// HOME/state/config on an ephemeral loopback port, grows one session over chat.send until the
// next turn's preflight runs budget-triggered safeguard compaction, then records evidence.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createServer, connect } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [checkout, outDir, label] = process.argv.slice(2);
if (!checkout || !outDir || !label) throw new Error("usage: drive.mts <checkout> <outDir> <label>");
const harnessDir = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(outDir, "root");
const dirs = ["home", "state", "workspace", "tmp", "logs", "xdg-config", "xdg-data", "xdg-cache", "xdg-state"];
for (const d of dirs) mkdirSync(path.join(root, d), { recursive: true });
const requestLog = path.join(outDir, "stub-requests.jsonl");
writeFileSync(requestLog, "");
const SESSION_KEY = "<session-key>";
const CONTEXT_WINDOW = Number(process.env.STUB_CONTEXT_WINDOW ?? 64_000);
const TURN_CHARS = Number(process.env.STUB_TURN_CHARS ?? 24_000);
const MAX_TURNS = Number(process.env.STUB_MAX_TURNS ?? 12);

const children: ChildProcess[] = [];
const stopAll = () => {
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} }
    }
  }
};
process.on("exit", stopAll);

// 1. Stub providers.
const stubs = spawn(process.execPath, [path.join(harnessDir, "stub-providers.mjs"), requestLog], {
  stdio: ["ignore", "pipe", "inherit"],
  detached: true,
});
children.push(stubs);
const ports: { stuba: number; stubb: number } = await new Promise((resolve, reject) => {
  let buf = "";
  stubs.stdout!.on("data", (c) => {
    buf += c;
    const nl = buf.indexOf("\n");
    if (nl >= 0) resolve(JSON.parse(buf.slice(0, nl)));
  });
  stubs.once("exit", (code) => reject(new Error(`stubs exited ${code}`)));
});

// 2. Ephemeral Gateway port.
const gatewayPort: number = await new Promise((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => resolve(p));
  });
});

// 3. Isolated config.
const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const provider = (port: number) => ({
  baseUrl: `http://127.0.0.1:${port}/v1`,
  apiKey: "test",
  api: "openai-completions",
  request: { allowPrivateNetwork: true },
  models: [{ id: "m", name: "m", api: "openai-completions", reasoning: false, input: ["text"], cost: zeroCost, contextWindow: CONTEXT_WINDOW, maxTokens: 2048 }],
});
const configPath = path.join(root, "openclaw.json");
const config = {
  logging: { file: path.join(root, "logs", "openclaw-YYYY-MM-DD.log") },
  models: { mode: "replace", providers: { stuba: provider(ports.stuba), stubb: provider(ports.stubb) } },
  agents: {
    defaults: {
      workspace: path.join(root, "workspace"),
      model: { primary: "stuba/m", fallbacks: ["stubb/m"] },
      models: { "stuba/m": {}, "stubb/m": {} },
      // Budget-triggered safeguard compaction; compaction.model intentionally unset.
      compaction: { mode: "safeguard" },
    },
  },
  gateway: { mode: "local", bind: "loopback", port: gatewayPort, auth: { mode: "none" } },
};
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

// 4. Gateway child with a minimal allowlisted environment (no inherited OPENCLAW_* or provider keys).
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  LANG: "en_US.UTF-8",
  HOME: path.join(root, "home"),
  OPENCLAW_HOME: path.join(root, "home"),
  OPENCLAW_STATE_DIR: path.join(root, "state"),
  OPENCLAW_CONFIG_PATH: configPath,
  TMPDIR: path.join(root, "tmp"),
  XDG_CONFIG_HOME: path.join(root, "xdg-config"),
  XDG_DATA_HOME: path.join(root, "xdg-data"),
  XDG_CACHE_HOME: path.join(root, "xdg-cache"),
  XDG_STATE_HOME: path.join(root, "xdg-state"),
  OPENCLAW_SKIP_CHANNELS: "1",
  OPENCLAW_SKIP_CRON: "1",
  OPENCLAW_SKIP_BROWSER_CONTROL_SERVER: "1",
  OPENCLAW_SKIP_CANVAS_HOST: "1",
  OPENCLAW_SKIP_GMAIL_WATCHER: "1",
  OPENCLAW_DISABLE_BUNDLED_PLUGINS: process.env.STUB_DISABLE_BUNDLED_PLUGINS ?? "1",
};
const gwArgs = ["scripts/run-node.mjs", "gateway", "run", "--port", String(gatewayPort), "--bind", "loopback", "--auth", "none", "--tailscale", "off", "--allow-unconfigured"];
writeFileSync(path.join(outDir, "gateway-command.txt"), `cwd=<checkout>\nnode ${gwArgs.join(" ")}\nenv keys: ${Object.keys(env).join(",")}\n`);
const { openSync } = await import("node:fs");
const gw = spawn(process.execPath, gwArgs, {
  cwd: checkout,
  env,
  detached: true,
  stdio: ["ignore", openSync(path.join(outDir, "gateway.stdout.log"), "w"), openSync(path.join(outDir, "gateway.stderr.log"), "w")],
});
children.push(gw);

const portOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const sock = connect(port, "127.0.0.1");
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
  });
const readyDeadline = Date.now() + 240_000;
while (!(await portOpen(gatewayPort))) {
  if (gw.exitCode !== null) throw new Error(`gateway exited early (${gw.exitCode}); see gateway.stderr.log`);
  if (Date.now() > readyDeadline) throw new Error("gateway not listening within 240s");
  await sleep(500);
}

// 5. Gateway client from the same checkout.
const { GatewayClient, startGatewayClientWhenEventLoopReady } = await import(
  path.join(checkout, "src/plugin-sdk/gateway-runtime.ts")
);
let hello: { resolve: () => void; promise: Promise<void> };
{
  let r!: () => void;
  hello = { resolve: () => r(), promise: new Promise<void>((res) => (r = res)) };
}
const client = new GatewayClient({
  url: `ws://127.0.0.1:${gatewayPort}`,
  requestTimeoutMs: 180_000,
  clientName: "gateway-client",
  deviceIdentity: null,
  mode: "backend",
  scopes: ["operator.admin"],
  onHelloOk: () => hello.resolve(),
});
const readiness = await startGatewayClientWhenEventLoopReady(client, { timeoutMs: 120_000 });
if (!readiness.ready) throw new Error("gateway client readiness timeout");
await Promise.race([hello.promise, sleep(120_000).then(() => { throw new Error("hello timeout"); })]);
const call = (method: string, params: unknown, timeoutMs = 180_000) => client.request(method, params, { timeoutMs });

const requests = () =>
  readFileSync(requestLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { provider: string; kind: string; status: number; bytes: number });
const turnLog: unknown[] = [];

// 6. Grow the session until a turn's preflight asks for a summary.
const filler = (turn: number) =>
  Array.from({ length: Math.ceil(TURN_CHARS / 120) }, (_, i) =>
    `Turn ${turn} checklist line ${i}: verify rollout step ${turn}-${i} and record the result for the review.`,
  ).join("\n");
let compactionTurn: number | undefined;
for (let turn = 1; turn <= MAX_TURNS; turn += 1) {
  const before = requests().length;
  const message = turn === 1 ? `Start the rollout review.\n${filler(turn)}` : `Next batch for the rollout review.\n${filler(turn)}`;
  const started = (await call("chat.send", { sessionKey: SESSION_KEY, message, deliver: false, idempotencyKey: randomUUID() })) as { runId?: string };
  const waited = await call("agent.wait", { runId: started.runId, timeoutMs: 170_000 }, 180_000);
  const newRequests = requests().slice(before);
  turnLog.push({ turn, runId: started.runId ? "<run>" : undefined, wait: waited, newRequests });
  if (newRequests.some((r) => r.kind === "summary")) {
    compactionTurn = turn;
    break;
  }
}

// 6b. Manual variant (matches the wr-web report): small history, then "/compact".
if (process.env.STUB_MANUAL_COMPACT === "1" && compactionTurn === undefined) {
  const before = requests().length;
  const started = (await call("chat.send", { sessionKey: SESSION_KEY, message: "/compact", deliver: false, idempotencyKey: randomUUID() })) as { runId?: string };
  const waited = await call("agent.wait", { runId: started.runId, timeoutMs: 170_000 }, 180_000);
  turnLog.push({ turn: "manual /compact", wait: waited, newRequests: requests().slice(before) });
  compactionTurn = -1;
}

// 7. Evidence.
const history = await call("chat.history", { sessionKey: SESSION_KEY, limit: 200 }).catch((e: unknown) => ({ error: String(e) }));
const sessions = await call("sessions.list", {}).catch((e: unknown) => ({ error: String(e) }));
await client.stopAndWait?.().catch?.(() => {});
const historyText = JSON.stringify(history);
const all = requests();
const count = (provider: string, kind: string, status?: number) =>
  all.filter((r) => r.provider === provider && r.kind === kind && (status === undefined || r.status === status)).length;
const logFiles = existsSync(path.join(root, "logs")) ? readdirSync(path.join(root, "logs")).filter((f) => f.endsWith(".log")) : [];
const logLines = logFiles.flatMap((f) => readFileSync(path.join(root, "logs", f), "utf8").split("\n").filter(Boolean));
const interesting = logLines
  .map((line) => { try { const j = JSON.parse(line); return { time: j.time, sub: (() => { try { return JSON.parse(j["0"]).subsystem; } catch { return undefined; } })(), msg: [j["1"], j["2"]].filter((v) => typeof v === "string").join(" ") || j.message || line, fields: typeof j["1"] === "object" ? j["1"] : undefined, raw: line }; } catch { return { msg: line, raw: line }; } })
  .filter((e) => /compaction|fallback|summar|429|quota/i.test(e.raw));
writeFileSync(path.join(outDir, "gateway-log-matches.jsonl"), interesting.map((e) => JSON.stringify(e)).join("\n") + "\n");
const summary = {
  label,
  checkoutHead: execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  contextWindow: CONTEXT_WINDOW,
  compactionTurn,
  stubRequests: {
    primaryChat: count("stuba", "chat"),
    primarySummary429: count("stuba", "summary", 429),
    fallbackSummary: count("stubb", "summary"),
    fallbackChat: count("stubb", "chat"),
  },
  fallbackSummaryInHistory: historyText.includes("FALLBACK-SUMMARY-194803"),
  sessionsCompactionCount: (JSON.stringify(sessions).match(/"compactionCount":(\d+)/) ?? [])[1] ?? null,
};
writeFileSync(path.join(outDir, "turns.json"), JSON.stringify(turnLog, null, 2));
writeFileSync(path.join(outDir, "history.json"), JSON.stringify(history, null, 2));
writeFileSync(path.join(outDir, "sessions.json"), JSON.stringify(sessions, null, 2));
writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
stopAll();
await sleep(1500);
process.exit(0);
