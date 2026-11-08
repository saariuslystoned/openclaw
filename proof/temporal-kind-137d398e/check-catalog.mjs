import fs from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

// Offline observer only: inputs must be the unmodified returned JSON payloads
// of two shipped-CLI calls to the same owned running Gateway.
const [withPluginsPath, coreOnlyPath] = process.argv.slice(2);
assert.ok(withPluginsPath && coreOnlyPath, "Usage: node check-catalog.mjs WITH_PLUGINS.json CORE_ONLY.json");
const read = (path) => {
  const bytes = fs.readFileSync(path);
  return { value: JSON.parse(bytes.toString("utf8")), bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
};
const included = read(withPluginsPath);
const excluded = read(coreOnlyPath);
assert.equal(typeof included.value.agentId, "string");
assert.equal(included.value.agentId, excluded.value.agentId, "same agent on opposite control");
for (const result of [included.value, excluded.value]) {
  assert.ok(Array.isArray(result.groups));
  assert.ok(result.groups.some((group) => group.source === "core" && Array.isArray(group.tools) && group.tools.length > 0), "nonempty core inventory");
}
const all = included.value.groups.flatMap((group) => group.tools);
const coreOnly = excluded.value.groups.flatMap((group) => group.tools);
const names = ["knowledge_timeline", "knowledge_chronicle_day", "knowledge_chronicle_since"];
const expected = "Exact record.type filter, such as decision, event, or meeting; unlike search/lookup kind (page, claim, relationship). Omit to include all eligible dated types.";
const observations = [];
for (const name of names) {
  const rows = all.filter((tool) => tool.id === name);
  assert.equal(rows.length, 1, name + " must resolve exactly once");
  assert.equal(coreOnly.filter((tool) => tool.id === name).length, 0, name + " must be absent without plugins");
  const tool = rows[0];
  assert.equal(tool.source, "plugin");
  assert.equal(tool.pluginId, "knowledge");
  assert.ok(Array.isArray(tool.parameters), "resolved parameters, not a declaration-only fallback");
  const kinds = tool.parameters.filter((parameter) => parameter.name === "kind");
  assert.equal(kinds.length, 1);
  assert.equal(kinds[0].required, false);
  assert.equal(kinds[0].type, "string");
  assert.equal(kinds[0].description, expected);
  observations.push({ id: tool.id, pluginId: tool.pluginId, kind: kinds[0], absentWithoutPlugins: true });
}
console.log(JSON.stringify({
  proof: "H5-running-Gateway-catalog-response-inspection",
  scope: "Offline validation of supplied responses; runtime/source binding requires the separate command and process receipts",
  agentId: included.value.agentId,
  responseHashes: { withPlugins: included.sha256, coreOnly: excluded.sha256 },
  responseBytes: { withPlugins: included.bytes, coreOnly: excluded.bytes },
  observations,
  status: "PASS"
}, null, 2));
