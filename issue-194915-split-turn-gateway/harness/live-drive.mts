// Phased isolated-Gateway driver for the live-fallback check of openclaw/openclaw#194803 / PR #194813.
// Usage: node --import <checkout>/scripts/tsx.mjs live-drive.mts <checkout> <outDir> <phase> [arg]
//   config <fallbacks-json>  write/merge the throwaway config (keeps plugin-install edits)
//   install <spec>           openclaw plugins install <spec> --force --accept-capabilities
//   seed <turns>             start the Gateway, grow one session over chat.send, stop
//   compact                  start the Gateway, send "/compact", record evidence, stop
// Stubs (live-stubs.mjs) run separately; their ports are read from <outDir>/stub-ports.json.
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [checkout, outDirArg, phase, arg] = process.argv.slice(2);
if (!checkout || !outDirArg || !phase) throw new Error("usage: live-drive.mts <checkout> <outDir> <phase> [arg]");
const outDir = path.resolve(outDirArg);
const root = path.join(outDir, "root");
for (const d of ["home", "state", "workspace", "tmp", "logs", "xdg-config", "xdg-data", "xdg-cache", "xdg-state"]) {
  mkdirSync(path.join(root, d), { recursive: true });
}
const configPath = path.join(root, "openclaw.json");
const requestLog = path.join(outDir, "stub-requests.jsonl");
const SESSION_KEY = "<session-key>";
const REAL_FALLBACK = process.env.LIVE_REAL_FALLBACK ?? "<provider-b>/<model-b>";
// Split-turn proof (#194915): LIVE_PRIMARY=dryfallback/m (healthy stub summarizer) and
// LIVE_CONTEXT_INJECTION=default (keep the per-run bootstrap marker entries).
const PRIMARY = process.env.LIVE_PRIMARY ?? "replay/model-a";
const CONTEXT_INJECTION = process.env.LIVE_CONTEXT_INJECTION ?? "never";

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
};

const readJson = <T,>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback);
const ports = () => readJson<{ replay: number; dryfallback: number }>(path.join(outDir, "stub-ports.json"), { replay: 0, dryfallback: 0 });

function writeConfig(fallbacks: string[], gatewayPort?: number) {
  const p = ports();
  if (!p.replay) throw new Error("stub-ports.json missing; start live-stubs.mjs first");
  const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const cfg = readJson<Record<string, any>>(configPath, {});
  cfg.logging = { file: path.join(root, "logs", "openclaw-YYYY-MM-DD.log") };
  cfg.models = {
    providers: {
      replay: {
        baseUrl: `http://127.0.0.1:${p.replay}/v1beta`,
        apiKey: "test",
        api: "google-generative-ai",
        request: { allowPrivateNetwork: true },
        models: [{ id: "model-a", name: "model-a", api: "google-generative-ai", reasoning: false, input: ["text"], cost: zeroCost, contextWindow: 1_048_576, maxTokens: 8192 }],
      },
      dryfallback: {
        baseUrl: `http://127.0.0.1:${p.dryfallback}/v1`,
        apiKey: "test",
        api: "openai-completions",
        request: { allowPrivateNetwork: true },
        models: [{ id: "m", name: "m", api: "openai-completions", reasoning: false, input: ["text"], cost: zeroCost, contextWindow: 1_048_576, maxTokens: 8192 }],
      },
    },
  };
  cfg.agents = {
    defaults: {
      workspace: path.join(root, "workspace"),
      // No workspace bootstrap marker entries: they move a user-message cut onto metadata and
      // turn the previous complete turn into a second (split-turn prefix) summary request.
      ...(CONTEXT_INJECTION === "default" ? {} : { contextInjection: CONTEXT_INJECTION }),
      model: { primary: PRIMARY, fallbacks },
      models: { "replay/model-a": {}, "dryfallback/m": {}, [REAL_FALLBACK]: {} },
      // compaction.model unset. One summary request per candidate: the quality-guard retry is off
      // and keepRecentTokens puts the cut on a user message (no split-turn prefix summary).
      compaction: { mode: "safeguard", keepRecentTokens: Number(process.env.LIVE_KEEP_RECENT_TOKENS ?? 1000), qualityGuard: { enabled: false }, memoryFlush: { enabled: false } },
    },
  };
  cfg.gateway = { mode: "local", bind: "loopback", ...(gatewayPort ? { port: gatewayPort } : {}), auth: { mode: "none" } };
  writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
const portOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const sock = connect(port, "127.0.0.1");
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
  });
const requests = () =>
  existsSync(requestLog) ? readFileSync(requestLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

async function withGateway<T>(tag: string, body: (call: (m: string, p: unknown, t?: number) => Promise<any>) => Promise<T>): Promise<T> {
  const cfg = readJson<Record<string, any>>(configPath, {});
  const port = await freePort();
  writeConfig(cfg.agents?.defaults?.model?.fallbacks ?? [], port);
  const gwArgs = ["scripts/run-node.mjs", "gateway", "run", "--port", String(port), "--bind", "loopback", "--auth", "none", "--tailscale", "off", "--allow-unconfigured"];
  writeFileSync(path.join(outDir, `${tag}-gateway-command.txt`), `cwd=<checkout>\nnode ${gwArgs.join(" ")}\nenv keys: ${Object.keys(env).join(",")}\n`);
  const gw: ChildProcess = spawn(process.execPath, gwArgs, {
    cwd: checkout,
    env,
    detached: true,
    stdio: ["ignore", openSync(path.join(outDir, `${tag}-gateway.stdout.log`), "w"), openSync(path.join(outDir, `${tag}-gateway.stderr.log`), "w")],
  });
  const stop = async () => {
    if (gw.exitCode === null && gw.pid) {
      try { process.kill(-gw.pid, "SIGTERM"); } catch {}
      for (let i = 0; i < 40 && gw.exitCode === null; i += 1) await sleep(250);
      if (gw.exitCode === null) try { process.kill(-gw.pid, "SIGKILL"); } catch {}
    }
  };
  process.on("exit", () => { if (gw.exitCode === null && gw.pid) try { process.kill(-gw.pid, "SIGKILL"); } catch {} });
  try {
    const deadline = Date.now() + 240_000;
    while (!(await portOpen(port))) {
      if (gw.exitCode !== null) throw new Error(`gateway exited early (${gw.exitCode}); see ${tag}-gateway.stderr.log`);
      if (Date.now() > deadline) throw new Error("gateway not listening within 240s");
      await sleep(500);
    }
    const { GatewayClient, startGatewayClientWhenEventLoopReady } = await import(path.join(checkout, "src/plugin-sdk/gateway-runtime.ts"));
    let helloResolve!: () => void;
    const hello = new Promise<void>((r) => (helloResolve = r));
    const client = new GatewayClient({
      url: `ws://127.0.0.1:${port}`,
      requestTimeoutMs: 240_000,
      clientName: "gateway-client",
      deviceIdentity: null,
      mode: "backend",
      scopes: ["operator.admin"],
      onHelloOk: () => helloResolve(),
    });
    const ready = await startGatewayClientWhenEventLoopReady(client, { timeoutMs: 120_000 });
    if (!ready.ready) throw new Error("gateway client readiness timeout");
    await Promise.race([hello, sleep(120_000).then(() => { throw new Error("hello timeout"); })]);
    const call = (m: string, p: unknown, t = 240_000) => client.request(m, p, { timeoutMs: t });
    try {
      return await body(call);
    } finally {
      await client.stopAndWait?.().catch?.(() => {});
    }
  } finally {
    await stop();
  }
}

function collectLogs(sinceMs: number, file: string) {
  const logDir = path.join(root, "logs");
  const lines = existsSync(logDir)
    ? readdirSync(logDir).filter((f) => f.endsWith(".log")).flatMap((f) => readFileSync(path.join(logDir, f), "utf8").split("\n").filter(Boolean))
    : [];
  const entries = lines
    .map((line) => {
      try {
        const j = JSON.parse(line);
        const sub = (() => { try { return JSON.parse(j["0"]).subsystem; } catch { return undefined; } })();
        return { time: j.time, sub, msg: [j["1"], j["2"]].filter((v) => typeof v === "string").join(" ") || j.message || line, fields: typeof j["1"] === "object" ? j["1"] : undefined, raw: line };
      } catch {
        return { time: undefined, msg: line, raw: line };
      }
    })
    .filter((e) => !e.time || Date.parse(e.time) >= sinceMs);
  const matches = entries.filter((e) => /compaction|fallback|summar|429|quota|RESOURCE_EXHAUSTED/i.test(e.raw));
  writeFileSync(path.join(outDir, file), matches.map((e) => JSON.stringify(e)).join("\n") + (matches.length ? "\n" : ""));
  return matches.length;
}

switch (phase) {
  case "config": {
    writeConfig(JSON.parse(arg ?? "[]"));
    console.log(JSON.stringify(readJson<Record<string, any>>(configPath, {}).agents.defaults.model));
    break;
  }
  case "install": {
    if (!arg) throw new Error("install needs a spec");
    const result = spawnSync(process.execPath, ["scripts/run-node.mjs", "plugins", "install", arg, "--force", "--accept-capabilities"], {
      cwd: checkout,
      env: { ...env, ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}), GIT_TERMINAL_PROMPT: "0" },
      encoding: "utf8",
      timeout: 600_000,
    });
    writeFileSync(path.join(outDir, "plugin-install.log"), `exit=${result.status}\n--- stdout\n${result.stdout}\n--- stderr\n${result.stderr}\n`);
    console.log(`exit=${result.status}`);
    break;
  }
  case "seed": {
    const turns = Number(arg ?? 8);
    const since = Date.now();
    const filler = (turn: number) =>
      Array.from({ length: 64 }, (_, i) => `Turn ${turn} checklist line ${i}: verify rollout step ${turn}-${i} and record the result for the review.`).join("\n");
    const log = await withGateway("seed", async (call) => {
      const out: unknown[] = [];
      for (let turn = 1; turn <= turns; turn += 1) {
        const before = requests().length;
        const message = `${turn === 1 ? "Start" : "Continue"} the rollout review, batch ${turn}.\n${filler(turn)}`;
        const started = await call("chat.send", { sessionKey: SESSION_KEY, message, deliver: false, idempotencyKey: randomUUID() });
        const waited = await call("agent.wait", { runId: started.runId, timeoutMs: 170_000 }, 180_000);
        out.push({ turn, status: waited?.status, effective: waited?.terminalReceipt?.effective, newRequests: requests().slice(before) });
      }
      return out;
    });
    writeFileSync(path.join(outDir, "seed-turns.json"), JSON.stringify(log, null, 2));
    collectLogs(since, "seed-log-matches.jsonl");
    console.log(JSON.stringify(log.map((t: any) => ({ turn: t.turn, status: t.status, effective: t.effective, reqs: t.newRequests.map((r: any) => `${r.provider}:${r.kind}:${r.status}`) }))));
    break;
  }
  case "compact": {
    const since = Date.now();
    const before = requests().length;
    const evidence = await withGateway("compact", async (call) => {
      const started = await call("chat.send", { sessionKey: SESSION_KEY, message: "/compact", deliver: false, idempotencyKey: randomUUID() });
      const waited = await call("agent.wait", { runId: started.runId, timeoutMs: 230_000 }, 240_000);
      const history = await call("chat.history", { sessionKey: SESSION_KEY, limit: 5 }).catch((e: unknown) => ({ error: String(e) }));
      return { waited, history };
    });
    writeFileSync(path.join(outDir, "compact-wait.json"), JSON.stringify(evidence, null, 2));
    const matches = collectLogs(since, "compact-log-matches.jsonl");
    const inspect = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), "inspect-state.mjs"), outDir], { encoding: "utf8" });
    const newRequests = requests().slice(before);
    const summary = {
      checkoutHead: execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      node: process.version,
      waitStatus: evidence.waited?.status,
      stubRequestsDuringCompact: newRequests.map((r: any) => `${r.provider}:${r.kind}:${r.status}`),
      logMatches: matches,
      state: inspect.stdout.trim() ? JSON.parse(inspect.stdout.trim()) : inspect.stderr,
    };
    writeFileSync(path.join(outDir, "compact-summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ ...summary, state: { compactions: summary.state?.compactions } }, null, 2));
    break;
  }
  default:
    throw new Error(`unknown phase ${phase}`);
}
process.exit(0);
