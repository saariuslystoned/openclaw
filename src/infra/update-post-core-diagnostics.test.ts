import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { afterEach, assert, expect, it, vi } from "vitest";
import { createDoctorMaintenanceState } from "../commands/doctor-maintenance-state.js";
import { setupDoctorAdmissionFixture } from "../commands/doctor-maintenance.admission.test-support.js";
import type { LockPayload } from "./gateway-lock-payload.js";
import { resolveStateOwnerIdentity } from "./gateway-state-owner-directory.js";
import {
  createPostCoreMaintenanceDiagnostics,
  markPostCoreMaintenanceStage,
  parsePostCoreMaintenanceDiagnostics,
  POST_CORE_DIAGNOSTIC_PREFIX,
  recordPostCoreMaintenanceFailure,
  withPostCoreMaintenanceRefusalOrigin,
} from "./update-post-core-diagnostics.js";

const holder: LockPayload = {
  pid: 1234,
  parentPid: 123,
  createdAt: "2026-11-08T00:14:59.136Z",
  configPath: "/private/config.json",
  stateDir: "/private/state",
  role: "sqlite-maintenance",
};
afterEach(() => vi.unstubAllEnvs());

it("isolates overlapping requests, retains first refusal after saturation, and seals late work", async () => {
  const a = createPostCoreMaintenanceDiagnostics();
  const b = createPostCoreMaintenanceDiagnostics();
  const runId = randomUUID();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = a.run(async () => {
    a.start(runId);
    for (let i = 0; i < 20; i++) {
      markPostCoreMaintenanceStage("maintenance_begin");
    }
    await wait;
    withPostCoreMaintenanceRefusalOrigin("private prompt", holder, "same");
    withPostCoreMaintenanceRefusalOrigin("private second error", { ...holder, pid: 999 }, "same");
    const snapshot = a.finish();
    assert(snapshot);
    await Promise.resolve();
    markPostCoreMaintenanceStage("owner_acquired");
    expect(withPostCoreMaintenanceRefusalOrigin("late", holder, "same")).toBe("late");
    expect(a.finish(new Error("late"))).toBe(snapshot);
    return snapshot;
  });
  const other = b.run(() => {
    b.start(runId); // Even the same correlation ID does not share recorder state.
    markPostCoreMaintenanceStage("owner_acquired");
    return b.finish();
  });
  release();
  const snapshot = await pending;
  expect(snapshot).toMatchObject({ truncated: true, firstRefusal: { holderPid: 1234 } });
  expect(snapshot.events).toHaveLength(16);
  expect(other).toMatchObject({ firstRefusal: null, truncated: false });
  expect(other?.events.map((event) => event.stage)).toEqual([
    "post_core_enter",
    "owner_acquired",
    "post_core_settled",
  ]);
  const encoded = POST_CORE_DIAGNOSTIC_PREFIX + JSON.stringify(snapshot);
  expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(8192);
  expect(encoded).not.toMatch(/private|prompt|config.json/);
  expect(parsePostCoreMaintenanceDiagnostics(encoded, runId)).toEqual(snapshot);
  expect(parsePostCoreMaintenanceDiagnostics(encoded, randomUUID())).toBeUndefined();
  expect(parsePostCoreMaintenanceDiagnostics(encoded.slice(0, -1), runId)).toBeUndefined();
  expect(
    parsePostCoreMaintenanceDiagnostics(
      POST_CORE_DIAGNOSTIC_PREFIX + JSON.stringify({ ...snapshot, content: "secret" }),
      runId,
    ),
  ).toBeUndefined();
  expect(
    parsePostCoreMaintenanceDiagnostics(POST_CORE_DIAGNOSTIC_PREFIX + " ".repeat(8193), runId),
  ).toBeUndefined();
});

it("accepts only matching fixed origin metadata from existing error transport", () => {
  const runId = randomUUID();
  vi.stubEnv("OPENCLAW_UPDATE_POST_CORE", "1");
  vi.stubEnv("OPENCLAW_UPDATE_RUN_ID", runId);
  // Models the existing error-message-only transport; the real process fixture
  // independently exercises the production reader's refusal and serialization.
  const remote = new Error(withPostCoreMaintenanceRefusalOrigin("remote", holder, "same"));
  const trace = createPostCoreMaintenanceDiagnostics();
  trace.run(() => {
    expect(withPostCoreMaintenanceRefusalOrigin("before admission", holder, "same")).toBe(
      "before admission",
    );
    trace.start(runId);
    recordPostCoreMaintenanceFailure(new Error(remote.message.replace(runId, randomUUID())));
    recordPostCoreMaintenanceFailure(
      new Error(remote.message.replace('"pid":', '"secret":"content","pid":')),
    );
    recordPostCoreMaintenanceFailure(new Error("wrapper", { cause: remote }));
    expect(trace.finish()).toMatchObject({ firstRefusal: { runId, holderPid: 1234 } });
  });
  vi.stubEnv("OPENCLAW_UPDATE_POST_CORE", undefined);
  expect(withPostCoreMaintenanceRefusalOrigin("ordinary operation", holder, "same")).toBe(
    "ordinary operation",
  );
});

const maintenanceFixture = setupDoctorAdmissionFixture();

it("observes the real acquired-owner release when resource admission fails", async () => {
  const { env, database, assertIsolation } = maintenanceFixture();
  let lent = false;
  const failure = new Error("Synthetic resource admission failure");
  const trace = createPostCoreMaintenanceDiagnostics();
  const state = await createDoctorMaintenanceState({
    params: {
      root: null,
      options: { repair: true, nonInteractive: true },
      runtime: { log() {}, error() {}, exit() {} },
      lendPolicyCustody: (custody) => {
        lent = custody !== undefined;
      },
    },
    env,
    signal: new AbortController().signal,
    deadline: () => undefined,
    assertCurrent: () => {
      if (lent) {
        throw failure;
      }
    },
    assertReadCurrent() {},
    settle: (operation) => operation(),
    warn() {},
  });
  try {
    await trace.run(async () => {
      trace.start(randomUUID());
      await expect(state.acquire()).rejects.toBe(failure);
      expect(state.owner).toBeUndefined();
      expect(fs.existsSync(resolveStateOwnerIdentity(database).ownerPath)).toBe(false);
      await state.release();
      expect(
        trace
          .finish()
          ?.events.filter((event) => event.stage.startsWith("owner_"))
          .map((event) => event.stage),
      ).toEqual(["owner_acquired", "owner_release_begin", "owner_release_done"]);
    });
  } finally {
    await state.release();
    assertIsolation();
  }
});
