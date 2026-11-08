import { AsyncLocalStorage } from "node:async_hooks";
import { addAbortListener } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  awaitGateBeforeSettlement,
  createDeferred,
  withinTest,
} from "../../../test/helpers/promise.js";
import { createTempDirTracker } from "../../../test/helpers/temp-dir.js";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/runtime-snapshot.js";
import { resolveSessionStorePathCore } from "../../config/sessions/paths.js";
import { replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import { createAgentRunPreparationTrace } from "../../gateway/agent-turn/agent-run-preparation-trace.js";
import { withDiagnosticsTimelineObserver } from "../../infra/diagnostics-timeline.js";
import { closeOpenClawAgentDatabasesAsync } from "../../state/openclaw-agent-db.js";
import { closeOpenClawStateDatabaseAsync } from "../../state/openclaw-state-db.js";
import { createEmbeddedAgentRunnerOpenAiConfig } from "../test-helpers/embedded-agent-runner-e2e-fixtures.js";
import { installEmbeddedRunnerBaseE2eMocks } from "../test-helpers/embedded-agent-runner-e2e-mocks.js";
import { withTestAdmission } from "./run-orchestrator.test-support.js";

const stages = [
  "session_prepare",
  "placement",
  "foreground_maintenance",
  "maintenance",
  "projection",
  "cli_dispatch",
  "generation",
  "runtime_acquire",
  "projects",
  "execution_start",
  "before_reply",
  "loop",
] as const;
type Stage = (typeof stages)[number];
const roots = createTempDirTracker();
function gates() {
  return new Map(
    stages.map((stage) => [stage, { entered: createDeferred(), release: createDeferred() }]),
  );
}
const requests = new AsyncLocalStorage<ReturnType<typeof gates>>();
async function hold(stage: Stage) {
  const gate = requests.getStore()?.get(stage);
  if (gate) {
    gate.entered.resolve();
    await gate.release.promise;
  }
}
type Run = typeof import("./run.js").runEmbeddedAgent;
let run: Run;

beforeAll(async () => {
  installEmbeddedRunnerBaseE2eMocks();
  vi.doMock("../models-config.js", () => ({ ensureOpenClawModelsJson: vi.fn() }));
  // Stop at inference: orchestration, admission and retention above this boundary stay real.
  vi.doMock("./run-loop.js", () => ({
    runPreparedEmbeddedLoop: async () => {
      await hold("loop");
      return { payloads: [], meta: { durationMs: 0 } };
    },
  }));
  const bootstrap = await import("./run/session-bootstrap.js");
  const prepare = bootstrap.prepareEmbeddedRunSession;
  vi.spyOn(bootstrap, "prepareEmbeddedRunSession").mockImplementation(async (...args) => {
    await hold("session_prepare");
    return prepare(...args);
  });
  const placement = await import("../session-placement-admission.js");
  const place = placement.withRequiredSessionPlacement;
  vi.spyOn(placement, "withRequiredSessionPlacement").mockImplementation(async (...args) => {
    await hold("placement");
    return place(...args);
  });
  const maintenance = await import("../session-maintenance/coordinator.js");
  const foreground = maintenance.beginForegroundSessionMaintenance;
  vi.spyOn(maintenance, "beginForegroundSessionMaintenance").mockImplementation(async (...args) => {
    await hold("foreground_maintenance");
    return foreground(...args);
  });
  const wait = maintenance.waitForSessionMaintenance;
  vi.spyOn(maintenance, "waitForSessionMaintenance").mockImplementation(async (...args) => {
    await hold("maintenance");
    return wait(...args);
  });
  const projection = await import("../../config/sessions/session-transcript-reconcile.js");
  const project = projection.waitForSessionTranscriptProjection;
  vi.spyOn(projection, "waitForSessionTranscriptProjection").mockImplementation(async (...args) => {
    await hold("projection");
    return project(...args);
  });
  const cli = await import("./cli-backend-dispatch.js");
  const dispatch = cli.runEmbeddedAgentViaCliBackendIfEligible;
  vi.spyOn(cli, "runEmbeddedAgentViaCliBackendIfEligible").mockImplementation(async (...args) => {
    await hold("cli_dispatch");
    return dispatch(...args);
  });
  const generation = await import("../../config/sessions/session-delivery-generation.js");
  const prepareGeneration = generation.prepareCronRootSessionGeneration;
  vi.spyOn(generation, "prepareCronRootSessionGeneration").mockImplementation(async (...args) => {
    await hold("generation");
    return prepareGeneration(...args);
  });
  const runtime = await import("../prepared-model-runtime.js");
  const acquire = vi.mocked(runtime.acquireAgentRunPreparedModelRuntime).getMockImplementation()!;
  vi.spyOn(runtime, "acquireAgentRunPreparedModelRuntime").mockImplementation(async (...args) => {
    await hold("runtime_acquire");
    return acquire(...args);
  });
  const projects = await import("../prompt-projects.js");
  const prepareProjects = projects.prepareAgentPromptProjects;
  vi.spyOn(projects, "prepareAgentPromptProjects").mockImplementation(async (...args) => {
    await hold("projects");
    return prepareProjects(...args);
  });
  const reply = await import("../../plugins/before-agent-reply.js");
  const beforeReply = reply.runBeforeAgentReplyForTurn;
  vi.spyOn(reply, "runBeforeAgentReplyForTurn").mockImplementation(async (...args) => {
    await hold("before_reply");
    return beforeReply(...args);
  });
  run = withTestAdmission(
    (await import("./run.js")).runEmbeddedAgent,
    (await import("../admitted-run-context.js")).prepareSystemAgentRunAdmission,
    "preparation-trace-test",
  );
}, 600_000);
afterEach(async () => {
  await closeOpenClawAgentDatabasesAsync();
  await closeOpenClawStateDatabaseAsync();
  clearRuntimeConfigSnapshot();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  roots.cleanup();
});

it("carries isolated request traces through actual runner owners, transitions and cancellation", async ({
  signal,
}) => {
  const root = roots.make("openclaw-runner-trace-");
  vi.stubEnv("OPENCLAW_STATE_DIR", path.join(root, "state"));
  const workspaceDir = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(agentDir, { recursive: true });
  const config = createEmbeddedAgentRunnerOpenAiConfig(["gpt-5.4-mini"]);
  setRuntimeConfigSnapshot(config);
  async function start(sessionId: string) {
    const target = {
      agentId: "main",
      sessionId,
      sessionKey: "agent:main:" + sessionId,
      storePath: resolveSessionStorePathCore(undefined, { agentId: "main" }),
    };
    await replaceSessionEntry(target, { sessionId, updatedAt: 1 });
    const trace = createAgentRunPreparationTrace("shared-run");
    const active = new Set<string>();
    const controller = new AbortController();
    const abort = addAbortListener(controller.signal, trace.observeAbort);
    const pending = gates();
    const params = {
      ...target,
      config,
      trigger: "user" as const,
      agentDir,
      workspaceDir,
      provider: "openai",
      model: "gpt-5.4-mini",
      prompt: "synthetic private prompt",
      runId: "shared-run",
      timeoutMs: 30_000,
      abortSignal: controller.signal,
      onExecutionStarted: () => hold("execution_start"),
    };
    const completion = requests
      .run(pending, () =>
        withDiagnosticsTimelineObserver(
          (name, attributes, duration) => {
            const finish = trace.observeSpan(name, attributes, duration);
            if (name.startsWith("agent.runner.")) {
              active.add(name);
            }
            return () => {
              active.delete(name);
              finish?.();
            };
          },
          () => run(params),
        ),
      )
      .then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      )
      .finally(() => abort[Symbol.dispose]());
    return { trace, active, controller, pending, completion };
  }
  const a = await start("trace-a");
  const b = await start("trace-b");
  async function reach(request: typeof a, stage: Stage) {
    await withinTest(
      awaitGateBeforeSettlement(
        request.pending.get(stage)!.entered.promise,
        request.completion.then((outcome) => {
          if ("error" in outcome) {
            throw outcome.error;
          }
        }),
        "Runner ended before " + stage,
      ),
      signal,
    );
    expect([...request.active]).toEqual(["agent.runner." + stage.replaceAll("_", "-")]);
  }
  try {
    // Same run ID, distinct live owners. B remains paused while A traverses deeper scopes.
    await reach(b, "session_prepare");
    for (const stage of stages) {
      await reach(a, stage);
      expect([...b.active]).toEqual(["agent.runner.session-prepare"]);
      if (stage !== "loop") {
        a.pending.get(stage)!.release.resolve();
      }
    }
    a.controller.abort();
    const frozen = JSON.stringify(a.trace.finish(true));
    expect(a.trace.finish(true)).toMatchObject({
      abortSnapshot: {
        truncated: false,
        active: [{ stage: "runner_loop", elapsedMs: expect.any(Number) }],
      },
    });
    expect(a.trace.finish(true).points.length).toBeLessThanOrEqual(32);
    expect(frozen).not.toContain("synthetic private prompt");
    a.pending.get("loop")!.release.resolve();
    await a.completion;
    expect(a.active.size).toBe(0);
    // Real owner cleanup/late completions may finish spans, but cannot alter the sealed snapshot.
    expect(JSON.stringify(a.trace.finish(true))).toBe(frozen);
    b.controller.abort();
    expect(b.trace.finish(true).abortSnapshot?.active).toEqual([
      { stage: "runner_session_prepare", elapsedMs: expect.any(Number) },
    ]);
  } finally {
    for (const request of [a, b]) {
      for (const gate of request.pending.values()) {
        gate.release.resolve();
      }
    }
    await Promise.all([a.completion, b.completion]);
  }
});
