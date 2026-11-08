import { AsyncLocalStorage } from "node:async_hooks";
import { isMainThread, threadId } from "node:worker_threads";
import { z } from "zod";
import type { LockPayload } from "./gateway-lock-payload.js";
import { POST_CORE_UPDATE_ENV } from "./update-post-core-context.js";

const REFUSAL_PREFIX = "[openclaw-post-core-refusal-v1] ";
export const POST_CORE_DIAGNOSTIC_PREFIX = "[openclaw-post-core-diagnostics-v1] ";
const MAX_EVENTS = 16;
const MAX_BYTES = 8192;
const runIdSchema = z.string().uuid();
const pidSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const refusalSchema = z
  .object({
    runId: runIdSchema,
    pid: pidSchema,
    parentPid: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    threadId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    mainThread: z.boolean(),
    holderPid: pidSchema,
    holderParentPid: pidSchema.nullable(),
    holderCreatedAtMs: z.number().finite().nullable(),
    holderKind: z.enum(["schema", "process"]),
    namespace: z.enum(["same", "dead", "unknown"]),
  })
  .strict();
type Refusal = z.infer<typeof refusalSchema>;
const stageSchema = z.enum([
  "post_core_enter",
  "maintenance_begin",
  "maintenance_ready",
  "release_state_begin",
  "release_state_done",
  "owner_acquired",
  "close_resources_begin",
  "close_resources_done",
  "capture_settle_begin",
  "capture_settle_done",
  "owner_release_begin",
  "owner_release_done",
  "post_core_settled",
]);
type Stage = z.infer<typeof stageSchema>;
const eventSchema = z
  .object({
    stage: stageSchema,
    elapsedMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    pid: pidSchema,
    parentPid: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    threadId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
type Event = Readonly<z.infer<typeof eventSchema>>;
const diagnosticsSchema = z
  .object({
    runId: runIdSchema,
    events: z.array(eventSchema).max(MAX_EVENTS),
    firstRefusal: refusalSchema.nullable(),
    truncated: z.boolean(),
  })
  .strict();
export type PostCoreMaintenanceDiagnostics = Readonly<{
  runId: string;
  events: readonly Event[];
  firstRefusal: Readonly<Refusal> | null;
  truncated: boolean;
}>;

/** Extract only complete fixed metadata from the private parent error, before report excerpting. */
export function parsePostCoreMaintenanceDiagnostics(
  message: string,
  runId: string,
): PostCoreMaintenanceDiagnostics | undefined {
  const offset = message.lastIndexOf(POST_CORE_DIAGNOSTIC_PREFIX);
  if (offset < 0) {
    return undefined;
  }
  const encoded = message.slice(offset + POST_CORE_DIAGNOSTIC_PREFIX.length).split("\n", 1)[0]!;
  if (Buffer.byteLength(encoded, "utf8") > MAX_BYTES) {
    return undefined;
  }
  try {
    const result = diagnosticsSchema.safeParse(JSON.parse(encoded));
    if (
      result.success &&
      result.data.runId === runId &&
      (!result.data.firstRefusal || result.data.firstRefusal.runId === runId)
    ) {
      return result.data;
    }
  } catch {
    /* Incomplete excerpts and malformed metadata are not observations. */
  }
  return undefined;
}
type Recorder = {
  runId?: string;
  startedAt: number;
  events: Event[];
  firstRefusal: Readonly<Refusal> | null;
  truncated: boolean;
  closed: boolean;
};
const current = new AsyncLocalStorage<Recorder>();

export function markPostCoreMaintenanceStage(stage: Stage): void {
  const recorder = current.getStore();
  if (!recorder?.runId || recorder.closed) {
    return;
  }
  if (recorder.events.length === MAX_EVENTS) {
    recorder.truncated = true;
    return;
  }
  recorder.events.push(
    Object.freeze({
      stage,
      elapsedMs: Math.max(0, Math.floor(performance.now() - recorder.startedAt)),
      pid: process.pid,
      parentPid: process.ppid,
      threadId,
    }),
  );
}

/** The existing private child environment carries correlation, never admission authority. */
export function withPostCoreMaintenanceRefusalOrigin(
  message: string,
  owner: LockPayload,
  namespace: "same" | "dead" | "unknown",
): string {
  const recorder = current.getStore();
  if (recorder && (recorder.closed || !recorder.runId)) {
    return message;
  }
  const runId =
    recorder?.runId ??
    (process.env[POST_CORE_UPDATE_ENV] === "1"
      ? runIdSchema.safeParse(process.env.OPENCLAW_UPDATE_RUN_ID).data
      : undefined);
  if (!runId) {
    return message;
  }
  const createdAt = Date.parse(owner.createdAt);
  const refusal: Refusal = {
    runId,
    pid: process.pid,
    parentPid: process.ppid,
    threadId,
    mainThread: isMainThread,
    holderPid: owner.pid,
    holderParentPid: owner.parentPid ?? null,
    holderCreatedAtMs: Number.isFinite(createdAt) ? createdAt : null,
    holderKind: owner.stateOwnerKind === "schema" ? "schema" : "process",
    namespace,
  };
  if (recorder?.runId && !recorder.firstRefusal) {
    recorder.firstRefusal = Object.freeze(refusal);
  }
  // Snapshot workers intentionally retain their shipped exact {ok,message} shape.
  // A fixed JSON envelope survives that transport without parsing prose or a stack.
  return `${message}\n${REFUSAL_PREFIX}${JSON.stringify(refusal)}`;
}

/** Decode only the fixed origin envelope, never infer an origin from the reporting catch. */
export function recordPostCoreMaintenanceFailure(error: unknown): void {
  const recorder = current.getStore();
  if (!recorder?.runId || recorder.closed || recorder.firstRefusal) {
    return;
  }
  const pending = [error];
  const visited = new Set<unknown>();
  for (let count = 0; pending.length && count < 16; count++) {
    const entry = pending.shift();
    if (!(entry instanceof Error) || visited.has(entry)) {
      continue;
    }
    visited.add(entry);
    const offset = entry.message.indexOf(REFUSAL_PREFIX);
    if (offset >= 0) {
      const start = offset + REFUSAL_PREFIX.length;
      const end = entry.message.indexOf("\n", start);
      const encoded = entry.message.slice(start, end < 0 ? undefined : end);
      if (encoded.length <= 1024) {
        try {
          const parsed = refusalSchema.safeParse(JSON.parse(encoded));
          if (parsed.success && parsed.data.runId === recorder.runId) {
            recorder.firstRefusal = Object.freeze(parsed.data);
            return;
          }
        } catch {
          /* A malformed diagnostic must not replace the original failure. */
        }
      }
    }
    pending.push(entry.cause);
    if (entry instanceof AggregateError) {
      pending.push(...entry.errors.slice(0, 16));
    }
  }
}

export function createPostCoreMaintenanceDiagnostics() {
  const recorder: Recorder = {
    startedAt: 0,
    events: [],
    firstRefusal: null,
    truncated: false,
    closed: false,
  };
  let sealed: PostCoreMaintenanceDiagnostics | undefined;
  return {
    run<T>(operation: () => T): T {
      return current.run(recorder, operation);
    },
    start(runId: string): void {
      if (recorder.closed || recorder.runId) {
        return;
      }
      // This is called only after the existing delegated executor admitted the child.
      if (!runIdSchema.safeParse(runId).success) {
        return;
      }
      recorder.runId = runId;
      recorder.startedAt = performance.now();
      markPostCoreMaintenanceStage("post_core_enter");
    },
    finish(error?: unknown): PostCoreMaintenanceDiagnostics | undefined {
      if (recorder.closed) {
        return sealed;
      }
      recordPostCoreMaintenanceFailure(error);
      markPostCoreMaintenanceStage("post_core_settled");
      recorder.closed = true;
      if (!recorder.runId) {
        return undefined;
      }
      const events = recorder.events.slice();
      const result = {
        runId: recorder.runId,
        events,
        firstRefusal: recorder.firstRefusal,
        truncated: recorder.truncated,
      };
      // Keep the first refusal independently of timeline saturation.
      while (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_BYTES && events.length) {
        events.pop();
        result.truncated = true;
      }
      sealed = Object.freeze({ ...result, events: Object.freeze(events) });
      return sealed;
    },
  };
}
