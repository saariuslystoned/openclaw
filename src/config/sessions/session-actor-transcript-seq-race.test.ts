import { expect, it } from "vitest";
import {
  openOpenClawAgentDatabase,
  runOpenClawAgentWriteTransaction,
  type OpenClawAgentDatabase,
} from "../../state/openclaw-agent-db.js";
import { requireNativeSqliteDatabase } from "../../test-utils/native-sqlite.js";
import { withOpenClawTestState } from "../../test-utils/openclaw-test-state.js";
import { readTranscriptAppendStateInTransaction } from "./session-accessor.sqlite-transcript-state.js";
import { appendTranscriptEventInTransaction } from "./session-accessor.sqlite-transcript-store.js";
import type { SessionActorStoredState } from "./session-actor-hydration.types.js";
import { withSessionActorTransactionState } from "./session-actor-transaction.js";
import type { InternalSessionEntry } from "./types.js";

const event = (id: string) => ({ type: "custom" as const, id });

function seqs(database: OpenClawAgentDatabase, sessionId: string): number[] {
  return requireNativeSqliteDatabase(database.db)
    .prepare("SELECT seq FROM transcript_events WHERE session_id = ? ORDER BY seq")
    .all(sessionId)
    .map((row) => Number((row as { seq: number }).seq));
}

function staleActor(
  scope: { agentId: string; sessionId: string; sessionKey: string },
  path: string,
): SessionActorStoredState {
  // Hydrated before the sibling commit: rawSeq is still empty.
  return {
    agentId: scope.agentId,
    path,
    hot: {
      target: {
        database: { kind: "memory", handle: "stale", incarnation: "1" },
        sessionKey: scope.sessionKey,
      },
      version: { epoch: "stale", sequence: 0 },
      writeToken: "stale",
      dependencySessionIds: [],
      entry: { sessionId: scope.sessionId } as InternalSessionEntry,
      hasBoard: false,
      participants: [],
      members: [],
      pendingInputs: [],
      completionKeys: [],
      transcript: {
        version: { generation: null, rawSeq: null, updatedAt: null },
        watermark: { generation: null, maxSeq: null },
        anchorsState: "unavailable",
        anchors: [],
        idempotency: [],
        modelContext: { kind: "resident", entries: [] },
      },
    },
    entryRows: new Map([[scope.sessionKey, undefined]]),
    window: undefined,
    hasBoard: false,
    pendingInputs: new Map(),
    completions: new Map(),
    completionsComplete: true,
    transcript: {
      complete: false,
      coldArchive: undefined,
      projection: undefined,
      identities: new Map(),
      active: new Map(),
      navigation: [],
      payloads: new Map(),
    },
  };
}

it("keeps a single writer on sequential transcript seqs", async () => {
  await withOpenClawTestState({ label: "seq-race-control" }, async (state) => {
    const scope = {
      agentId: "main",
      sessionId: "seq-race-control",
      sessionKey: "agent:main:seq-race-control",
      env: state.env,
    };
    const database = openOpenClawAgentDatabase(scope);
    const write = (id: string) =>
      runOpenClawAgentWriteTransaction(
        (current) => appendTranscriptEventInTransaction(current, scope, event(id)),
        scope,
      );
    write("one");
    write("two");
    expect(seqs(database, scope.sessionId)).toEqual([0, 1]);
  });
});

it("allocates a fresh transcript seq after a sibling commit that used a pre-read seq", async () => {
  await withOpenClawTestState({ label: "seq-race-stale-read" }, async (state) => {
    const scope = {
      agentId: "main",
      sessionId: "seq-race-stale",
      sessionKey: "agent:main:seq-race-stale",
      env: state.env,
    };
    // Real open path. The cached owner is intentional: the bug is the seq snapshot, not a raw handle.
    const database = openOpenClawAgentDatabase(scope);
    const openedAgain = openOpenClawAgentDatabase(scope);
    expect(openedAgain).toBe(database);
    const stale = readTranscriptAppendStateInTransaction(database, scope);
    expect(stale.nextSeq).toBe(0);
    runOpenClawAgentWriteTransaction(
      (current) => appendTranscriptEventInTransaction(current, scope, event("first")),
      scope,
    );
    runOpenClawAgentWriteTransaction(
      (current) =>
        appendTranscriptEventInTransaction(
          current,
          scope,
          event("second"),
          {},
          { initialState: stale },
        ),
      scope,
    );
    expect(seqs(database, scope.sessionId)).toEqual([0, 1]);
  });
});

it("allocates a fresh transcript seq when the session actor snapshot predates a sibling commit", async () => {
  await withOpenClawTestState({ label: "seq-race-actor" }, async (state) => {
    const scope = {
      agentId: "main",
      sessionId: "seq-race-actor",
      sessionKey: "agent:main:seq-race-actor",
      env: state.env,
    };
    const database = openOpenClawAgentDatabase(scope);
    const actor = staleActor(scope, database.path);
    runOpenClawAgentWriteTransaction(
      (current) => appendTranscriptEventInTransaction(current, scope, event("committed-first")),
      scope,
    );
    runOpenClawAgentWriteTransaction((current) => {
      withSessionActorTransactionState(current, actor, () => {
        appendTranscriptEventInTransaction(current, scope, event("actor-second"));
      });
    }, scope);
    expect(seqs(database, scope.sessionId)).toEqual([0, 1]);
  });
});
