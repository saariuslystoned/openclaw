import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../types.js";
import type { SessionTreeEntry } from "../types.js";
import { findCutPoint } from "./compaction.js";
import { assistant, text, user } from "./shard-fixtures.test-support.js";

const at = (index: number) => ({ id: `entry-${index}`, parentId: index === 0 ? null : `entry-${index - 1}`, timestamp: new Date(index + 1).toISOString() });
const message = (msg: AgentMessage, index: number): SessionTreeEntry => ({ type: "message", ...at(index), message: msg });
// The entry the embedded runner appends after each completed run (attempt-finalize.ts).
const bootstrapMarker = (index: number): SessionTreeEntry =>
  ({ type: "custom", customType: "openclaw:bootstrap-context:full", data: { timestamp: index }, ...at(index) }) as SessionTreeEntry;
const reply = (content: string, ts: number) =>
  assistant(content, { api: "openai-completions", provider: "stub", model: "m", timestamp: ts });
const big = (label: string) => `${label} ${"checklist line. ".repeat(250)}`;

describe("findCutPoint with a metadata entry before the kept user message", () => {
  it("does not report a split turn when the cut lands on a complete turn", () => {
    const withMarker = [
      message(user([text(big("turn 1"))], 1), 0),
      message(reply("reply 1", 2), 1),
      bootstrapMarker(2),
      message(user([text(big("turn 2"))], 3), 3),
      message(reply("reply 2", 4), 4),
      bootstrapMarker(5),
    ];
    const withoutMarker = withMarker.filter((entry) => entry.type === "message");

    // Control: same transcript without the marker cuts cleanly at the turn-2 user message.
    expect(findCutPoint(withoutMarker, 0, withoutMarker.length, 500)).toEqual({ firstKeptEntryIndex: 2, turnStartIndex: -1, isSplitTurn: false });
    // With the marker, the cut moves onto the marker and turn 1 becomes a "split-turn prefix".
    expect(findCutPoint(withMarker, 0, withMarker.length, 500)).toMatchObject({ isSplitTurn: false });
  });
});
