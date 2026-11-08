import assert from "node:assert/strict";
import path from "node:path";

// Artifact-only JSON producer. No OpenClaw imports, filesystem writes, secrets,
// migration metadata, grants, allowlist, or retired heartbeat settings.
const [root, rawPort, ...extra] = process.argv.slice(2);
assert.ok(root && path.isAbsolute(root) && path.resolve(root) !== path.parse(root).root, "Use an absolute, non-root, disposable case directory");
assert.equal(extra.length, 0, "Usage: node make-case-patch.mjs CASE_ROOT PORT");
assert.match(rawPort ?? "", /^[0-9]+$/, "Port must be decimal");
const port = Number(rawPort);
assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535, "Use the reserved nonproduction unprivileged port");
console.log(JSON.stringify({
  cron: { enabled: false },
  gateway: {
    mode: "local", port, bind: "loopback",
    auth: { mode: "token" },
    controlUi: { enabled: false },
  },
  plugins: {
    slots: { memory: "knowledge" },
    entries: {
      knowledge: { enabled: true, config: { maintenance: { enabled: false } } },
      "skill-workshop": { config: { autonomous: { mode: "off" } } },
    },
  },
  hooks: { enabled: false },
  logging: { file: path.join(root, "logs", "gateway.log") },
}, null, 2));
