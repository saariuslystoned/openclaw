// Read-only: list transcript event types and decode compaction entries from a throwaway run's agent DB.
// Usage: node inspect-state.mjs <outDir>
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const outDir = process.argv[2];
const db = `file:${path.join(outDir, "root/state/agents/main/agent/openclaw-agent.sqlite")}?immutable=1`;
const q = (sql) => execFileSync("sqlite3", ["-json", db, sql], { encoding: "utf8" }).trim();
const rows = JSON.parse(q("select seq, navigation_type as type, message_role as role, event_json, hex(event_zstd) as z from transcript_events order by seq;") || "[]");
const decode = (r) => JSON.parse(r.event_json ?? zlib.zstdDecompressSync(Buffer.from(r.z, "hex")).toString("utf8"));
const timeline = rows.map((r) => {
  const ev = decode(r);
  return {
    seq: r.seq,
    type: ev.type,
    role: ev.message?.role,
    ...(ev.customType ? { customType: ev.customType } : {}),
    ...(ev.customType === "model-snapshot" ? { provider: ev.data?.provider } : {}),
  };
});
const compactions = rows.map(decode).filter((ev) => ev.type === "compaction").map((ev) => ({
  tokensBefore: ev.tokensBefore,
  hasFallbackMarker: String(ev.summary).includes("FALLBACK-SUMMARY-194803"),
  summaryChars: String(ev.summary).length,
}));
const result = { transcriptEvents: rows.length, compactions, timeline };
writeFileSync(path.join(outDir, "state-inspection.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ transcriptEvents: rows.length, compactions, snapshots: timeline.filter((t) => t.customType === "model-snapshot" || t.type === "compaction") }));
