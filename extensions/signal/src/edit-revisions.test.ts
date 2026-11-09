import { createPluginStateKeyedStoreV2ForTests as openStore } from "openclaw/plugin-sdk/plugin-state-test-runtime";
import { createPluginRuntimeMock } from "openclaw/plugin-sdk/plugin-test-runtime";
import { closeOpenClawStateDatabaseAsync } from "openclaw/plugin-sdk/sqlite-runtime-testing";
import { useAutoCleanupTempDirTracker } from "openclaw/plugin-sdk/test-env";
import { afterEach, expect, it, vi } from "vitest";
import { recordSignalEditRevision, resolveSignalEditTarget } from "./edit-revisions.js";
import * as runtimeModule from "./runtime.js";

const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeOpenClawStateDatabaseAsync();
    cleanup();
  }),
);

it("aims every later edit of a message at its newest revision", async () => {
  const env = { ...process.env, OPENCLAW_STATE_DIR: dirs.make("signal-edit-revisions-") };
  const runtime = createPluginRuntimeMock({
    state: {
      openKeyedStoreV2: <T>(options: Parameters<typeof openStore>[1]) =>
        openStore<T>("signal", { ...options, env }, { assertCurrent() {} }),
    },
  });
  vi.spyOn(runtimeModule, "getOptionalSignalRuntime").mockReturnValue(runtime);
  const chat = { to: "signal:+15555550123" };
  const target = (timestamp: number) => resolveSignalEditTarget({ ...chat, timestamp });

  await expect(target(500)).resolves.toBe(500);
  await recordSignalEditRevision({ ...chat, timestamp: 500, revision: 600 });
  await expect(target(500)).resolves.toBe(600);
  await recordSignalEditRevision({ ...chat, timestamp: 500, revision: 700 });
  // The original and every older revision resolve to the newest one; other chats are untouched.
  expect(await Promise.all([target(500), target(600), target(700)])).toEqual([700, 700, 700]);
  await expect(
    resolveSignalEditTarget({ to: "signal:+15555550199", timestamp: 500 }),
  ).resolves.toBe(500);
});
