// H38 one-off proof. Run only in the coordinator's admitted secretless namespace.
// No content is written below the Gateway; the child fixture provisions an EMPTY store.
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const HEAD = "233e789a02100b6c4f78afb6fe50c393f8d4402d";
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = await fs.realpath(process.cwd());
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const load = (p) => import(pathToFileURL(path.join(repo, p)).href);
const emit = (kind, value) => console.log("H38 " + JSON.stringify({ kind, ...value }));
let stage = "preflight";
class ProofStop extends Error {
  constructor(code) { super(code); this.code = code; }
}
// Only literal categories leave this observer; no message/stack/cause serialization.
let primaryFailure;
const errorCodes = new Set(["ENOENT", "EACCES", "EPERM", "EADDRINUSE", "EADDRNOTAVAIL", "ESRCH", "EPIPE",
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ABORT_ERR", "ERR_SERVER_NOT_RUNNING", "ERR_MODULE_NOT_FOUND",
  "ERR_UNKNOWN_FILE_EXTENSION", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE", "ERR_SPAWN_BROKER_UNAVAILABLE",
  "EPROCESSGROUP_CLEANUP_FAILED", "EPROCESS_TREE_VERIFICATION_UNSUPPORTED"]);
function errorKind(e) {
  if (e instanceof ProofStop) return "proof-constraint";
  if (errorCodes.has(e?.code)) return e.code;
  if (e?.name === "GatewayAgentAdmissionError") return "gateway-agent-admission-refused";
  if (e instanceof AggregateError) return "aggregate-error";
  if (e instanceof TypeError) return "type-error";
  if (e instanceof ReferenceError) return "reference-error";
  if (e instanceof SyntaxError) return "syntax-error";
  if (e instanceof RangeError) return "range-error";
  return "owner-operation-failed";
}
function safeError(e) {
  return { category: errorKind(e),
    ...(e instanceof ProofStop ? { check: e.code.split(":")[0] } : {}),
    ...(e instanceof AggregateError ? { members: e.errors.slice(0, 4).map(errorKind),
      omittedMembers: Math.max(0, e.errors.length - 4) } : {}) };
}
function rememberFailure(e, at = stage) {
  if (!primaryFailure) { primaryFailure = { stage: at, ...safeError(e) }; emit("primary-failure", primaryFailure); }
}
function exitFacts(p) {
  return { pidObserved: Number.isSafeInteger(p?.pid) && p.pid > 0,
    code: Number.isSafeInteger(p?.exitCode) ? p.exitCode : null,
    signal: p?.signalCode == null ? null :
      ["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP", "SIGABRT", "SIGSEGV", "SIGBUS"].includes(p.signalCode) ? p.signalCode : "other" };
}
function requireFact(value, code) { if (!value) throw new ProofStop(code); }
function same(actual, expected, code) {
  requireFact(JSON.stringify(actual) === JSON.stringify(expected), code);
}
function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel);
}
async function absent(filename) {
  try { await fs.lstat(filename); return false; }
  catch (e) { if (e.code === "ENOENT") return true; throw e; }
}
async function bindSources() {
  const manifest = JSON.parse(await fs.readFile(path.join(here, "source-bindings.json"), "utf8"));
  requireFact(manifest.head === HEAD, "manifest-head");
  for (const [p, bytes, hash, oid] of manifest.files) {
    const data = await fs.readFile(path.join(repo, p));
    const blob = createHash("sha1").update("blob " + data.length + "\0").update(data).digest("hex");
    requireFact(data.length === bytes && sha(data) === hash && blob === oid, "source-binding:" + p);
  }
  return manifest.files.length;
}

async function emptyFixture() {
  stage = "empty-registry-fixture";
  const root = await fs.realpath(process.env.H38_ROOT);
  const { readConfigFileSnapshot, resolveStateDir } = await load("src/config/config.ts");
  const { listAgentIds } = await load("src/plugin-sdk/agent-scope-runtime.ts");
  const { parseMembership, readStoresSection, effectiveBinding } = await load("extensions/knowledge/src/stores-config.ts");
  const { RegistryClient } = await load("extensions/knowledge/src/registry-client.ts");
  const snapshot = await readConfigFileSnapshot();
  requireFact(snapshot.exists && snapshot.valid, "fixture-config-invalid");
  const cfg = snapshot.config;
  // Require the canonical roster, not an implicit-agent fallback.
  requireFact(cfg.agents && (cfg.agents.entries || cfg.agents.list), "fixture-roster-absent");
  const agents = listAgentIds(cfg);
  requireFact(agents.length === 1 && /^[a-z][a-z0-9_-]{0,63}$/.test(agents[0]), "fixture-agent-ambiguous");
  const agent = agents[0];
  const membership = parseMembership(readStoresSection(cfg));
  requireFact(membership.issues.length === 0 && membership.invalid.size === 0, "fixture-membership-invalid");
  const binding = effectiveBinding(membership, agent);
  requireFact(binding === "agent:" + agent, "fixture-not-private-binding");
  const stateDir = resolveStateDir();
  requireFact(stateDir === process.env.OPENCLAW_STATE_DIR && inside(root, stateDir), "fixture-state-root");
  const knowledgeRoot = path.join(stateDir, "knowledge");
  requireFact(await absent(knowledgeRoot), "fixture-not-new");
  const registry = new RegistryClient(() => knowledgeRoot);
  let ready;
  try {
    const before = await registry.load();
    requireFact(Object.keys(before.stores).length === 0 && Object.keys(before.bindings).length === 0,
      "fixture-registry-not-empty");
    requireFact(before.pending === null && before.reconciled === null && Object.keys(before.grants).length === 0,
      "fixture-registry-preexisting-authority");
    await registry.call("provision", binding);
    const after = await registry.load();
    requireFact(after.pending === null && Object.keys(after.grants).length === 0, "fixture-unexpected-authority");
    requireFact(Object.keys(after.stores).length === 1 && Object.keys(after.bindings).length === 1,
      "fixture-store-count");
    const vaultId = after.bindings[binding];
    const store = after.stores[vaultId];
    requireFact(store && store.vaultId === vaultId && store.state === "ready" && store.present,
      "fixture-store-not-ready");
    requireFact(inside(knowledgeRoot, store.root) && inside(knowledgeRoot, store.statePath), "fixture-store-path");
    ready = { agent, binding, vaultId, root: store.root, statePath: store.statePath, publicationId: store.publicationId };
  } finally {
    // All owner operations above are sequential and settled before termination.
    await registry.dispose();
  }
  // Filesystem inspection is after the real registry worker's exit; no SQLite writes/reads here.
  const manifest = JSON.parse(await fs.readFile(path.join(ready.root, "vault.json"), "utf8"));
  requireFact(manifest.format === "knowledge-vault-v2" && manifest.generation === 0,
    "fixture-manifest-not-empty");
  requireFact(manifest.vaultId === ready.vaultId && manifest.publicationId === ready.publicationId,
    "fixture-manifest-identity");
  same((await fs.readdir(path.join(ready.root, "private"))).sort(), [], "fixture-content-present");
  requireFact(await absent(path.join(ready.root, "ontology.yaml")), "fixture-ontology-present");
  await fs.writeFile(path.join(root, "empty-store-receipt.json"), JSON.stringify(ready) + "\n", { flag: "wx", mode: 0o600 });
  emit("empty-store", { agent: ready.agent, vaultId: ready.vaultId, generation: 0,
    registryWorkerExited: true, contentRecords: 0, grantEntries: 0 });
}

try { requireFact(process.argv[2] === "empty-store", "empty-only"); await bindSources(); await emptyFixture(); } catch(e) { rememberFailure(e); emit("stopped", {...primaryFailure, proofComplete:false}); process.exitCode=1; }
