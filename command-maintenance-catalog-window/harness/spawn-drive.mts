// Isolated real-Gateway check: does a run after a subagent completes budget a model with a
// window above 200k against the declared window or the 200k default?
// Usage: node --import <checkout>/scripts/tsx.mjs spawn-drive.mts <checkout> <outDir> <label>
// Env: SE_MODEL=big|small|options (big: 1,048,576; small: 200,000; options: 1,048,576 default
//      with a 200k option), SE_CONTEXT=fork|isolated,
//      SE_PARENT_TOKENS (target parent prompt size before the spawn, default 190000),
//      SE_TURN_CHARS (chars per seed turn, default 120000), SE_SETTLE_MS (quiet period, default 25000).
// Throwaway HOME/state/config, ephemeral loopback port, auth none, bundled plugins off, one
// zero-cost loopback stub provider. Never touches any other Gateway or state directory.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [checkoutArg, outDirArg, label] = process.argv.slice(2);
if (!checkoutArg || !outDirArg || !label) throw new Error("usage: spawn-drive.mts <checkout> <outDir> <label>");
// Absolute paths: the Gateway runs with the checkout as cwd.
const checkout = path.resolve(checkoutArg);
const outDir = path.resolve(outDirArg);
const harnessDir = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(outDir, "root");
for (const d of ["home", "state", "workspace", "tmp", "logs", "xdg-config", "xdg-data", "xdg-cache", "xdg-state"]) {
  mkdirSync(path.join(root, d), { recursive: true });
}
const requestLog = path.join(outDir, "stub-requests.jsonl");
writeFileSync(requestLog, "");
const SESSION_KEY = "agent:main:main";
const MODEL = process.env.SE_MODEL ?? "big";
const CONTEXT = process.env.SE_CONTEXT ?? "fork";
const PARENT_TOKENS = Number(process.env.SE_PARENT_TOKENS ?? 190_000);
const TURN_CHARS = Number(process.env.SE_TURN_CHARS ?? 120_000);
const SETTLE_MS = Number(process.env.SE_SETTLE_MS ?? 25_000);

const children: ChildProcess[] = [];
const stopAll = () => {
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} }
    }
  }
};
process.on("exit", stopAll);

const stub = spawn(process.execPath, [path.join(harnessDir, "spawn-stub.mjs"), requestLog], { stdio: ["ignore", "pipe", "inherit"], detached: true });
children.push(stub);
const stubPort: number = await new Promise((resolve, reject) => {
  let buf = "";
  stub.stdout!.on("data", (c) => {
    buf += c;
    const nl = buf.indexOf("\n");
    if (nl >= 0) resolve(JSON.parse(buf.slice(0, nl)).port);
  });
  stub.once("exit", (code) => reject(new Error(`stub exited ${code}`)));
});
const gatewayPort: number = await new Promise((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => resolve(p));
  });
});

// The model windows come only from a throwaway local provider plugin's manifest catalog, the way
// a plugin-supplied model does; config authors no model rows, so no configured window exists.
const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const modelRow = (id: string, contextWindow: number) => ({ id, name: id, reasoning: false, input: ["text"], cost: zeroCost, contextWindow, maxTokens: 2048 });
const pluginDir = path.join(root, "plugins", "bigwindow");
mkdirSync(pluginDir, { recursive: true });
const manifest = {
  id: "bigwindow",
  name: "Big window test provider",
  description: "Throwaway loopback provider for the subagent-completion budget check.",
  categories: ["models"],
  enabledByDefault: true,
  providers: ["bigwindow"],
  modelCatalog: {
    providers: {
      bigwindow: {
        baseUrl: `http://127.0.0.1:${stubPort}/v1`,
        api: "openai-completions",
        defaultModel: "big",
        models: [
          modelRow("big", 1_048_576),
          modelRow("small", 200_000),
          // Selectable window options: the session stores no resolved-v1 window for this route,
          // so maintenance must read the catalog to budget it.
          {
            ...modelRow("options", 1_048_576),
            contextWindows: [
              { id: "200k", label: "200K", contextWindow: 200_000 },
              { id: "1m", label: "1M", contextWindow: 1_048_576 },
            ],
            contextWindowDefault: "1m",
          },
        ],
      },
    },
    discovery: { bigwindow: "static" },
  },
  setup: { providers: [{ id: "bigwindow", envVars: ["BIGWINDOW_API_KEY"] }] },
  configSchema: { type: "object", additionalProperties: false, properties: {} },
};
writeFileSync(path.join(pluginDir, "openclaw.plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(path.join(pluginDir, "package.json"), `${JSON.stringify({ name: "bigwindow-test-provider", version: "0.0.0", type: "module", openclaw: { extensions: ["./index.mjs"] } }, null, 2)}\n`);
writeFileSync(
  path.join(pluginDir, "index.mjs"),
  [
    'import { readFileSync } from "node:fs";',
    'import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";',
    'const manifest = JSON.parse(readFileSync(new URL("./openclaw.plugin.json", import.meta.url), "utf8"));',
    "export default defineSingleProviderPluginEntry({",
    '  id: "bigwindow",',
    '  name: "Big window test provider",',
    '  description: "Throwaway loopback provider",',
    "  manifest,",
    '  provider: { label: "Big window", docsPath: "/providers", envVars: ["BIGWINDOW_API_KEY"], catalog: {} },',
    "});",
    "",
  ].join("\n"),
);
const configPath = path.join(root, "openclaw.json");
const config = {
  logging: { file: path.join(root, "logs", "openclaw-YYYY-MM-DD.log"), level: "debug" },
  plugins: { load: { paths: [pluginDir] } },
  // No models.providers rows: the plugin catalog is the only window source.
  // Direct tools (no Tool Search) so the stub can call sessions_spawn by name.
  tools: { profile: "coding", toolSearch: false },
  agents: {
    defaults: {
      workspace: path.join(root, "workspace"),
      model: { primary: `bigwindow/${MODEL}` },
    },
  },
  gateway: { mode: "local", bind: "loopback", port: gatewayPort, auth: { mode: "none" } },
};
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

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
  OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
  BIGWINDOW_API_KEY: "test",
};
const gwArgs = ["scripts/run-node.mjs", "gateway", "run", "--port", String(gatewayPort), "--bind", "loopback", "--auth", "none", "--tailscale", "off", "--allow-unconfigured"];
writeFileSync(path.join(outDir, "gateway-command.txt"), `cwd=<checkout>\nnode ${gwArgs.join(" ")}\nenv keys: ${Object.keys(env).join(",")}\nmodel=bigwindow/${MODEL} context=${CONTEXT}\n`);
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

const { GatewayClient, startGatewayClientWhenEventLoopReady } = await import(path.join(checkout, "src/plugin-sdk/gateway-runtime.ts"));
let helloResolve!: () => void;
const hello = new Promise<void>((res) => (helloResolve = res));
const client = new GatewayClient({
  url: `ws://127.0.0.1:${gatewayPort}`,
  requestTimeoutMs: 240_000,
  clientName: "gateway-client",
  deviceIdentity: null,
  mode: "backend",
  scopes: ["operator.admin"],
  onHelloOk: () => helloResolve(),
});
const readiness = await startGatewayClientWhenEventLoopReady(client, { timeoutMs: 120_000 });
if (!readiness.ready) throw new Error("gateway client readiness timeout");
await Promise.race([hello, sleep(120_000).then(() => { throw new Error("hello timeout"); })]);
const call = (method: string, params: unknown, timeoutMs = 240_000) => client.request(method, params, { timeoutMs });
type StubRequest = { ts: string; model: string; kind: string; bytes: number; estTokens: number; messages: number; lastRole?: string; lastUserHead: string; hasSpawnTool: boolean };
const requests = (): StubRequest[] => readFileSync(requestLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const turnLog: unknown[] = [];
const send = async (message: string, note: string) => {
  const before = requests().length;
  const started = (await call("chat.send", { sessionKey: SESSION_KEY, message, deliver: false, idempotencyKey: randomUUID() })) as { runId?: string };
  const waited = await call("agent.wait", { runId: started.runId, timeoutMs: 230_000 }, 240_000);
  const newRequests = requests().slice(before);
  turnLog.push({ note, wait: (waited as { status?: string })?.status ?? waited, newRequests });
  return newRequests;
};

// Seed the parent until its chat request is above the target size.
const filler = (turn: number) =>
  Array.from({ length: Math.ceil(TURN_CHARS / 110) }, (_, i) => `Turn ${turn} note ${i}: record rollout step ${turn}-${i} for the parent review log.`).join("\n");
let parentTokens = 0;
for (let turn = 1; turn <= 20 && parentTokens < PARENT_TOKENS; turn += 1) {
  const reqs = await send(`Rollout batch ${turn}.\n${filler(turn)}`, `seed ${turn}`);
  parentTokens = Math.max(parentTokens, ...reqs.filter((r) => r.kind === "chat").map((r) => r.estTokens));
  if (reqs.length === 0) {
    writeFileSync(path.join(outDir, "turns.json"), JSON.stringify(turnLog, null, 2));
    throw new Error(`seed ${turn} reached no stub request; see gateway logs`);
  }
}
const seedDone = requests().length;

// Spawn one subagent and wait until the Gateway goes quiet after the child finished.
await send(`SPAWN-${CONTEXT.toUpperCase()}: start one helper for the remaining check.`, "spawn");
const spawnDeadline = Date.now() + 300_000;
let lastCount = requests().length;
let lastChange = Date.now();
while (Date.now() < spawnDeadline) {
  await sleep(1000);
  const n = requests().length;
  if (n !== lastCount) { lastCount = n; lastChange = Date.now(); }
  const sawChild = requests().slice(seedDone).some((r) => r.kind === "child");
  if (sawChild && Date.now() - lastChange > SETTLE_MS) break;
}

const sessions = await call("sessions.list", {}).catch((e: unknown) => ({ error: String(e) }));
await client.stopAndWait?.().catch?.(() => {});
const logFiles = existsSync(path.join(root, "logs")) ? readdirSync(path.join(root, "logs")).filter((f) => f.endsWith(".log")) : [];
const logLines = logFiles.flatMap((f) => readFileSync(path.join(root, "logs", f), "utf8").split("\n").filter(Boolean));
const MATCH = /context-pressure-diagnostic|context-overflow|compaction|internal-session-effects|preflight|contextTokenBudget|subagent|announce|low context window/i;
writeFileSync(path.join(outDir, "gateway-log-matches.jsonl"), logLines.filter((l) => MATCH.test(l)).join("\n") + "\n");
const afterSeed = requests().slice(seedDone);
const diag = logLines.filter((l) => l.includes("context-pressure-diagnostic")).map((l) => (/promptBudgetBeforeReserve=(\d+)/.exec(l) ?? [])[1]);
const summary = {
  label,
  checkoutHead: execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  model: `bigwindow/${MODEL}`,
  declaredWindow: MODEL === "small" ? 200_000 : 1_048_576,
  spawnContext: CONTEXT,
  parentTokensBeforeSpawn: parentTokens,
  seedRequests: seedDone,
  afterSeed: afterSeed.map((r) => ({ kind: r.kind, estTokens: r.estTokens, messages: r.messages, lastRole: r.lastRole, lastUserHead: r.lastUserHead })),
  summaryRequestsAfterSeed: afterSeed.filter((r) => r.kind === "summary").length,
  summaryRequestsTotal: requests().filter((r) => r.kind === "summary").length,
  pressureDiagnosticBudgets: diag,
  internalSessionEffectsLogLines: logLines.filter((l) => l.includes("internal-session-effects")).length,
};
writeFileSync(path.join(outDir, "turns.json"), JSON.stringify(turnLog, null, 2));
writeFileSync(path.join(outDir, "sessions.json"), JSON.stringify(sessions, null, 2));
writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
stopAll();
await sleep(1500);
process.exit(0);
