import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, assert, beforeAll, expect, it, vi } from "vitest";
import { createFixtureLifetime } from "../../../test/helpers/fixture-lifetime.js";
import {
  installPrivateUpdateHandoffStore,
  writePrivateUpdateHandoffChildGuard,
} from "../../../test/helpers/private-update-handoff-store.js";
import { sanitizeTriageUpdateFailure } from "../../commands/triage-update.js";
import type { OpenClawConfig } from "../../config/types.js";
import { resolveStateOwnerIdentity } from "../../infra/gateway-state-owner-directory.js";
import {
  encodePackageActivationLauncher,
  openPackageActivationJournal,
  resolvePackageActivationJournalPath,
} from "../../infra/package-update-activation-journal.js";
import { preparePackageActivationJournal } from "../../infra/package-update-activation-prepare.js";
import { packageActivationRuntimeForTest } from "../../infra/package-update-activation-runtime.test-support.js";
import { createPackageIntegrityReader } from "../../infra/package-update-integrity.js";
import { createPublicationOwner } from "../../infra/package-update-publication-owner.js";
import { writePackageRoot } from "../../infra/package-update-steps.test-support.js";
import { SQLITE_READONLY_CHILD_ARG } from "../../infra/runtime-process-entrypoints.js";
import { readDatabasePathIdentitySync } from "../../infra/sqlite-worker-identity.js";
import { createManagedHandoffLeaseStore } from "../../infra/update-managed-service-handoff-lease.js";
import { parsePostCoreMaintenanceDiagnostics } from "../../infra/update-post-core-diagnostics.js";
import { readUpdateRunDriver } from "../../infra/update-run-driver.js";
import { createUpdateRun, getUpdateRun } from "../../infra/update-run-ledger.js";
import type { UpdateRunResult } from "../../infra/update-runner-types.js";
import { resolveInstalledPluginIndexStateDatabaseOptions } from "../../plugins/installed-plugin-index-store-path.js";
import { readPluginMetadataStateRow } from "../../plugins/plugin-metadata-state-worker.js";
import { seedInstalledPluginIndex } from "../../plugins/test-helpers/installed-plugin-index.js";
import { CommandProcessCleanupError } from "../../process/exec-result.js";
import * as processRunner from "../../process/exec.js";
import { resolveOpenClawStateSqlitePath } from "../../state/openclaw-state-db.paths.js";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../../test-utils/openclaw-test-state.js";
import { prepareResult } from "./progress.js";
import { prepareCandidateAuthorityRuntime } from "./update-command-candidate-authority.test-support.js";
import { withUpdateCommandExecutor } from "./update-command-executor.js";
import { continuePostCoreUpdateInFreshProcess } from "./update-command-post-core.js";

const lifetime = createFixtureLifetime();
let state: OpenClawTestState;
let packageRoot: string;
let candidateRoot: string;

async function wrapWorker(workerPath: string, imports = "", setup = "") {
  const implementation = path.basename(workerPath).replace(".js", ".implementation.js");
  await fs.promises.rename(workerPath, path.join(path.dirname(workerPath), implementation));
  await fs.promises.writeFile(
    workerPath,
    `${imports}import * as json5 from "json5";
import { registerSealedRuntime } from "./sealed-runtime-registry.js";
registerSealedRuntime({ json5, resolveSecureTempRoot: () => ${JSON.stringify(state.path("control"))} });
${setup}await import(${JSON.stringify(`./${implementation}`)});
`,
  );
}

beforeAll(async () => {
  state = await lifetime.acquire(() =>
    createOpenClawTestState({
      label: "post-core-admission",
      env: {
        OPENCLAW_PROFILE: undefined,
        OPENCLAW_NO_RESPAWN: "1",
        OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
        OPENCLAW_UPDATE_RUN_ID: undefined,
        OPENCLAW_UPDATE_RUN_HANDOFF: undefined,
        OPENCLAW_UPDATE_POST_CORE: undefined,
        OPENCLAW_SERVICE_REPAIR_POLICY: "external",
      },
    }),
  );
  await lifetime.run(async () => {
    packageRoot = state.path("openclaw");
    candidateRoot = state.path("candidate");
    const runtime = await prepareCandidateAuthorityRuntime(candidateRoot);
    // This compiler-owned legacy test graph is not part of the installed candidate.
    await fs.promises.rm(path.join(candidateRoot, "dist", "legacy-finalizer"), {
      recursive: true,
      force: true,
    });
    // The receiver verifies its loaded package. Source imports from the checkout
    // would bypass the installed-package boundary this regression must exercise.
    expect(fileURLToPath(runtime.worker)).toBe(
      path.join(candidateRoot, "dist", "infra", "update-migrated-finalize.worker.js"),
    );
    // Dependencies are shared beside both generations; publication rejects links
    // escaping the package whose bytes it seals.
    await fs.promises.rename(path.join(candidateRoot, "node_modules"), state.path("node_modules"));
    await fs.promises.unlink(state.path("node_modules", "openclaw"));
    await fs.promises.symlink(packageRoot, state.path("node_modules", "openclaw"), "dir");
    await fs.promises.writeFile(
      path.join(candidateRoot, "dist", "index.js"),
      `import { fileURLToPath } from "node:url";
process.argv[1] = fileURLToPath(new URL("./entry.js", import.meta.url));
await import("./entry.js");
`,
    );
    // Keep native children inside the fixture's private temp root. The receiver
    // and all authority/result owners remain real.
    await wrapWorker(
      fileURLToPath(runtime.worker),
      `import fs, { appendFileSync, existsSync } from "node:fs";
import fsp from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
`,
      `const resultPath = process.env.OPENCLAW_UPDATE_POST_CORE_RESULT_PATH;
// Observe successful physical operations only; never replace owner decisions.
const ownerPath = ${JSON.stringify(resolveStateOwnerIdentity(resolveOpenClawStateSqlitePath(state.env)).ownerPath)};
const refusalFlag = ${JSON.stringify(state.path("force-foreign-read"))};
const databasePath = ${JSON.stringify(resolveOpenClawStateSqlitePath(state.env))};
const observationPath = ${JSON.stringify(state.path("owner-observations.jsonl"))};
const observe = (event, fields = {}) => appendFileSync(observationPath, JSON.stringify({ event, pid: process.pid, ppid: process.ppid, ...fields }) + String.fromCharCode(10));
if (process.argv[2] === "--post-core") {
  const descriptors = new Set();
  const open = fs.openSync;
  const write = fs.writeFileSync;
  const close = fs.closeSync;
  const remove = fs.rmSync;
  const rename = fsp.rename;
  observe("child_enter");
  fs.openSync = (...args) => {
    const fd = open(...args);
    if (String(args[0]) === ownerPath) descriptors.add(fd);
    return fd;
  };
  fs.writeFileSync = (...args) => {
    const result = write(...args);
    if (descriptors.has(args[0])) {
      const owner = JSON.parse(String(args[1]));
      observe("owner_published", { holderPid: owner.pid, holderParentPid: owner.parentPid ?? null, kind: owner.stateOwnerKind === "schema" ? "schema" : "process" });
      if (existsSync(refusalFlag)) {
        const identity = fs.readFileSync(refusalFlag, "utf8");
        remove(refusalFlag);
        // A real child tries to read while the actual post-core owner is held.
        // Its production admission error, not a fixture-created error, propagates.
        const child = spawnSync(process.execPath, [
          fileURLToPath(new URL("./sqlite-readonly-location.worker.js", import.meta.url)),
          ${JSON.stringify(SQLITE_READONLY_CHILD_ARG)}, "metadata", databasePath, "", identity,
        ], { encoding: "utf8", env: process.env, timeout: 30000, maxBuffer: 1024 * 1024 });
        const response = JSON.parse(child.stdout);
        observe("foreign_refusal", { readerPid: child.pid, ok: response.ok });
        if (child.status !== 1 || response.ok !== false || typeof response.message !== "string") {
          throw new Error("Foreign reader did not return its expected refusal protocol");
        }
        throw new Error(response.message);
      }
    }
    return result;
  };
  fs.closeSync = (fd) => {
    const result = close(fd);
    descriptors.delete(fd);
    return result;
  };
  fs.rmSync = (...args) => {
    const result = remove(...args);
    if (String(args[0]) === ownerPath) observe("owner_removed");
    return result;
  };
  fsp.rename = async (...args) => {
    const result = await rename(...args);
    if (String(args[1]) === resultPath + ".pending") observe("result_pending", { ownerPresent: existsSync(ownerPath) });
    return result;
  };
  process.on("exit", () => observe("child_exit", { ownerPresent: existsSync(ownerPath) }));
}
if (process.argv[2] === "--post-core" && resultPath && existsSync(${JSON.stringify(state.path("fail-response-publication"))})) {
  const rename = fsp.rename;
  fsp.rename = async (from, to) => {
    if (String(to) === resultPath) {
      appendFileSync(${JSON.stringify(state.path("fail-response-publication"))}, String(from) === resultPath + ".pending" ? "pending\\n" : "atomic\\n");
      throw Object.assign(new Error("Fixture response publication failed"), { code: "EIO" });
    }
    return rename(from, to);
  };
}
`,
    );
    await wrapWorker(
      path.join(candidateRoot, "dist", "infra", "sqlite-readonly-location.worker.js"),
    );
    await writePackageRoot(packageRoot, "2026.8.1");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(() => lifetime.cleanup());

it.skipIf(process.platform === "win32")(
  "resumes a published package, refuses unowned continuations, and retains unconfirmed results",
  () =>
    lifetime.run(async () => {
      const control = state.path("control");
      fs.mkdirSync(control, { mode: 0o700 });
      const cache = state.path("cache");
      fs.mkdirSync(cache, { mode: 0o700 });
      vi.stubEnv("XDG_CACHE_HOME", cache);
      state.env.XDG_CACHE_HOME = cache;
      const { databasePath } = installPrivateUpdateHandoffStore(control);
      const guardedEnv = writePrivateUpdateHandoffChildGuard(databasePath, control)(state.env);
      vi.stubEnv("NODE_OPTIONS", guardedEnv.NODE_OPTIONS);
      vi.stubEnv("BUN_OPTIONS", guardedEnv.BUN_OPTIONS);
      const config: OpenClawConfig = {
        plugins: { enabled: false, slots: { memory: "none" } },
        update: { channel: "stable" },
      };
      await state.writeConfig(config);
      await seedInstalledPluginIndex({}, { config, env: state.env });
      const driver = readUpdateRunDriver();
      expect(driver).toBeDefined();
      const runId = createUpdateRun(
        { trigger: "cli", origin: { driver } },
        { env: state.env },
      ).runId;
      const launchers = state.path("candidate-bin");
      const bin = state.path("bin");
      fs.mkdirSync(launchers);
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, "openclaw"), "previous launcher\n");
      fs.writeFileSync(path.join(launchers, "openclaw"), "candidate launcher\n");
      const runChild = processRunner.runUtf8CommandWithTimeout;
      const runtime = packageActivationRuntimeForTest();

      await withUpdateCommandExecutor(runId, async (executor) => {
        const fence = await executor.enter(packageRoot);
        const reader = createPackageIntegrityReader();
        const prepared = await preparePackageActivationJournal({
          options: { fence, runtime, onPrepared: () => {} },
          liveRoot: packageRoot,
          stageRoot: candidateRoot,
          launcherRoot: launchers,
          binDir: bin,
          previous: await reader.tree(packageRoot),
          launchers: [
            {
              name: "openclaw",
              previous: encodePackageActivationLauncher(
                await reader.launcher(path.join(bin, "openclaw")),
              ),
            },
          ],
        });
        const publication = createPublicationOwner(
          prepared.anchor,
          prepared.journal,
          fence.assertCurrent,
        );
        await publication.publish(false);
        const journal = openPackageActivationJournal(prepared.anchor);
        expect(journal.read().phase).toBe("publication-complete");
        const invoke = () =>
          continuePostCoreUpdateInFreshProcess({
            root: packageRoot,
            channel: "beta",
            requestedChannel: "beta",
            opts: {
              json: true,
              yes: true,
              restart: false,
              run: { runId, env: state.env, executorFence: fence },
            },
            pluginInstallRecords: {},
            updateStartedAtMs: Date.now(),
            timeoutMs: 30_000,
            nodeRunner: runtime.path,
          });

        // Baseline raw-spawns the public CLI without a grant and is refused by
        // the journal before resume. No fixture supplies the child's fence/result.
        const healthy = await invoke();
        expect(healthy).toMatchObject({ resumed: true, pluginUpdate: { status: "ok" } });
        const observations: Array<{
          event: string;
          pid: number;
          ppid: number;
          holderPid?: number;
          kind?: string;
          ownerPresent?: boolean;
        }> = fs
          .readFileSync(state.path("owner-observations.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const acquired = observations.findIndex(
          (entry) => entry.event === "owner_published" && entry.kind === "process",
        );
        expect(acquired).toBeGreaterThan(-1);
        const owner = observations[acquired];
        assert(owner, "The fresh child must publish its actual maintenance owner");
        expect(owner.holderPid).toBe(owner.pid);
        expect(owner.pid).not.toBe(process.pid);
        expect(owner.ppid).toBe(process.pid);
        const removed = observations.findIndex(
          (entry, index) => index > acquired && entry.event === "owner_removed",
        );
        const pending = observations.findIndex((entry) => entry.event === "result_pending");
        expect(removed).toBeGreaterThan(acquired);
        expect(pending).toBeGreaterThan(removed);
        expect(observations[pending]?.ownerPresent).toBe(false);
        expect(observations.at(-1)).toMatchObject({ event: "child_exit", ownerPresent: false });
        console.log("POST_CORE_OWNER_OBSERVATIONS", JSON.stringify(observations));
        expect(JSON.parse(fs.readFileSync(state.configPath, "utf8")).update.channel).toBe("beta");
        expect(getUpdateRun(runId, { env: state.env })).toMatchObject({
          status: "running",
          steps: expect.arrayContaining([
            expect.objectContaining({ step: "finalize:installed-candidate", status: "completed" }),
          ]),
        });
        fence.assertCurrent();

        await fs.promises.writeFile(
          state.path("force-foreign-read"),
          JSON.stringify(readDatabasePathIdentitySync(resolveOpenClawStateSqlitePath(state.env))),
        );
        const refused = await invoke();
        expect(refused).toMatchObject({ resumed: false, exitCode: 1 });
        const diagnostic = parsePostCoreMaintenanceDiagnostics(refused.error ?? "", runId);
        assert(diagnostic, "The real parent error must preserve the complete diagnostic envelope");
        assert(diagnostic.firstRefusal, "The real read-only child must report its own origin");
        const origin = diagnostic.firstRefusal;
        expect(origin.pid).not.toBe(origin.holderPid);
        expect(origin.pid).not.toBe(process.pid);
        expect(origin.parentPid).toBe(origin.holderPid);
        const refusedObservations = fs
          .readFileSync(state.path("owner-observations.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        // Owner records may omit ancestry; compare the captured field to the
        // physical record, and establish actual OS ancestry independently.
        expect(refusedObservations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: "owner_published",
              pid: origin.holderPid,
              ppid: process.pid,
              holderParentPid: origin.holderParentPid,
            }),
            expect.objectContaining({
              event: "foreign_refusal",
              pid: origin.holderPid,
              readerPid: origin.pid,
              ok: false,
            }),
            expect.objectContaining({
              event: "child_exit",
              pid: origin.holderPid,
              ownerPresent: false,
            }),
          ]),
        );
        expect(origin).toMatchObject({
          mainThread: true,
          threadId: 0,
          holderKind: "process",
          namespace: "same",
        });
        expect(diagnostic.events[0]).toMatchObject({
          stage: "post_core_enter",
          pid: origin.holderPid,
        });
        expect(diagnostic.events.at(-1)?.stage).toBe("post_core_settled");
        expect(Buffer.byteLength(JSON.stringify(diagnostic))).toBeLessThanOrEqual(8192);
        expect(JSON.stringify(diagnostic)).not.toContain(state.stateDir);
        expect(
          fs.existsSync(
            resolveStateOwnerIdentity(resolveOpenClawStateSqlitePath(state.env)).ownerPath,
          ),
        ).toBe(false);
        // Report excerpts are deliberately lossy: capture the validated envelope
        // from the normal parent error before feeding the unchanged artifact owner.
        const failureResult: UpdateRunResult = {
          status: "error",
          mode: "unknown",
          runId,
          steps: [
            {
              name: "post-update verification",
              command: "openclaw update",
              cwd: packageRoot,
              durationMs: 0,
              exitCode: 1,
              stderrTail: refused.error,
            },
          ],
          durationMs: 0,
        };
        const emit = await prepareResult(
          failureResult,
          { json: true },
          {
            readHistory: false,
            writeArtifacts: false,
          },
        );
        const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
        let encoded: string;
        try {
          emit();
          encoded = String(stdout.mock.calls.at(-1)?.[0]);
        } finally {
          stdout.mockRestore();
        }
        // Decode the actual normal CLI JSON serialization before report projection.
        const output = JSON.parse(encoded);
        expect(parsePostCoreMaintenanceDiagnostics(output.steps[0].stderrTail, runId)).toEqual(
          diagnostic,
        );
        const report = sanitizeTriageUpdateFailure(
          { result: failureResult },
          { env: state.env, stateDir: state.stateDir },
          "artifact",
        );
        expect(parsePostCoreMaintenanceDiagnostics(JSON.stringify(report), runId)).toBeUndefined();
        console.log("POST_CORE_REFUSAL_DIAGNOSTICS", JSON.stringify(diagnostic));
        fence.assertCurrent();

        const snapshot = async () => ({
          config: fs.readFileSync(state.configPath, "utf8"),
          index: await readPluginMetadataStateRow(
            "installed-index",
            resolveInstalledPluginIndexStateDatabaseOptions({ env: state.env }),
          ),
          run: getUpdateRun(runId, { env: state.env }),
          journal: fs.readFileSync(resolvePackageActivationJournalPath(prepared.anchor)),
        });
        const unchanged = await snapshot();
        const markerResultPath = state.path("marker-result.json");
        const marker = await runChild(
          [
            process.execPath,
            path.join(packageRoot, "dist", "index.js"),
            "update",
            "--json",
            "--yes",
            "--no-restart",
          ],
          {
            cwd: packageRoot,
            env: {
              ...guardedEnv,
              OPENCLAW_UPDATE_IN_PROGRESS: "1",
              OPENCLAW_UPDATE_POST_CORE: "1",
              OPENCLAW_UPDATE_POST_CORE_CHANNEL: "beta",
              OPENCLAW_UPDATE_POST_CORE_RESULT_PATH: markerResultPath,
              OPENCLAW_UPDATE_RUN_ID: runId,
            },
            timeoutMs: 30_000,
            killProcessTree: true,
            requireProcessTreeExtinction: true,
          },
        );
        expect(marker.code, marker.stderr).toBe(1);
        expect(marker.stdout + marker.stderr).toContain("update-recovery-pending");
        expect(fs.existsSync(markerResultPath)).toBe(false);
        expect(await snapshot()).toEqual(unchanged);

        let mismatchedPid: number | undefined;
        let refusal: Awaited<ReturnType<typeof runChild>> | undefined;
        const transport = vi
          .spyOn(processRunner, "runUtf8CommandWithTimeout")
          .mockImplementation(async (argv, options) => {
            if (!argv.includes("--post-core")) {
              return runChild(argv, options);
            }
            if (typeof options === "number" || typeof options.input !== "string") {
              throw new Error("Post-core producer did not supply its private input");
            }
            const input = JSON.parse(options.input) as { runId: string };
            expect(input.runId).toBe(runId);
            refusal = await runChild(argv, {
              ...options,
              input: JSON.stringify({ ...input, runId: "another-update-run" }),
              beforeInput: (pid, spawnedArgv) => {
                options.beforeInput?.(pid, spawnedArgv);
                mismatchedPid = pid;
              },
            });
            return refusal;
          });
        try {
          await expect(invoke()).resolves.toMatchObject({ resumed: false, exitCode: 1 });
        } finally {
          transport.mockRestore();
        }
        expect(mismatchedPid).toBeGreaterThan(0);
        expect(refusal?.code).toBe(1);
        expect(refusal?.stderr).toMatch(/post-core|update run/i);
        expect(await snapshot()).toEqual(unchanged);
        fence.assertCurrent();

        const { run: beforeUnpublishedRun, ...beforeUnpublishedState } = await snapshot();
        assert(beforeUnpublishedRun, "The admitted update run must remain available");
        const faultPath = state.path("fail-response-publication");
        await fs.promises.writeFile(faultPath, "EIO\n");
        let retainedResultPath: string | undefined;
        let stateAfterChild: Awaited<ReturnType<typeof snapshot>> | undefined;
        const unpublishedTransport = vi
          .spyOn(processRunner, "runUtf8CommandWithTimeout")
          .mockImplementation(async (argv, options) => {
            const postCore = argv.includes("--post-core") && typeof options !== "number";
            if (postCore) {
              retainedResultPath = options.env?.OPENCLAW_UPDATE_POST_CORE_RESULT_PATH;
            }
            const result = await runChild(argv, options);
            if (postCore) {
              stateAfterChild = await snapshot();
            }
            return result;
          });
        try {
          const outcome = await invoke().then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
          expect(fs.readFileSync(faultPath, "utf8")).toBe("EIO\npending\natomic\n");
          expect(outcome).toMatchObject({ error: expect.any(CommandProcessCleanupError) });
          assert(retainedResultPath, "Post-core producer must provide its private result path");
          expect(fs.existsSync(retainedResultPath)).toBe(false);
          expect(
            JSON.parse(fs.readFileSync(`${retainedResultPath}.pending`, "utf8")),
          ).toMatchObject({
            status: "ok",
          });
          assert(stateAfterChild, "The real post-core child must finish before parent settlement");
          expect(stateAfterChild.config).toEqual(beforeUnpublishedState.config);
          expect(stateAfterChild.journal).toEqual(beforeUnpublishedState.journal);
          // Resume can refresh index metadata; the parent must preserve the child's exact state.
          expect(await snapshot()).toEqual(stateAfterChild);
          expect(stateAfterChild.run).toMatchObject({
            runId,
            status: "running",
            steps: expect.arrayContaining([
              expect.objectContaining({
                step: "finalize:installed-candidate",
                status: "completed",
              }),
            ]),
          });
          expect(stateAfterChild.run?.updatedAtMs).toBeGreaterThan(
            beforeUnpublishedRun.updatedAtMs,
          );
          fence.assertCurrent();
        } finally {
          unpublishedTransport.mockRestore();
          await fs.promises.rm(faultPath, { force: true });
          if (retainedResultPath) {
            await fs.promises.rm(path.dirname(retainedResultPath), {
              recursive: true,
              force: true,
            });
          }
        }
      });
      expect(createManagedHandoffLeaseStore().read(packageRoot)).toEqual({ kind: "absent" });
    }),
);
