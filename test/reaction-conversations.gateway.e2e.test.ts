import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";
import { rawDataToString } from "@openclaw/gateway-client/websocket-data";
import { expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { createQaGatewayChild } from "../extensions/qa-lab/api.js";
import { checkTargetDatabaseSchemasForContexts } from "../src/cli/update-cli/schema-preflight.js";
import { buildMockOpenAiResponsesProvider } from "../src/gateway/test-openai-responses-model.js";
import { readUpdateStateSchemaVersions } from "../src/infra/update-candidate-state.js";
import { createDeferredCore } from "../src/shared/deferred.js";
import { withArtifactPreservingStateReads } from "../src/state/openclaw-state-db-readonly.js";
import { reserveTestPortListener } from "../src/test-utils/port-claims.js";
import { writeOpenAiResponsesText } from "./helpers/openai-responses-sse.js";
import {
  closeProvider,
  productModelConfig,
  productProvider,
  readRequestText,
  writeToolCall,
} from "./reaction-conversations.test-support.js";

// External protocol fixtures only: Gateway startup, plugin monitors, durable
// ingress, ordinary agent, message tool, authority and native clients are real.
it(
  "runs Discord and Signal reaction conversations through a disposable Gateway and real agent",
  { timeout: 120_000 },
  async () => {
    await using cleanup = new AsyncDisposableStack();
    const errors: unknown[] = [];
    const effects: Array<{ channel: string; method: string; target: string; body?: unknown }> = [];
    const modelRequests: string[] = [];
    const controlTextSends: string[] = [];
    const channelId = "150000000000000001";
    const messageId = "150000000000000002";
    const botId = "150000000000000003";
    const actorId = "150000000000000004";
    const otherBotId = "150000000000000005";
    const signalAccount = "+15550009999";
    const signalActor = "+15550001111";
    const signalTarget = 1700000000000;
    let discordSocket: WebSocket | undefined;
    let signalStream: ServerResponse | undefined;
    let sequence = 1;
    let silentNext = false;
    type Gate = {
      entered: ReturnType<typeof createDeferredCore<void>>;
      release: ReturnType<typeof createDeferredCore<void>>;
    };
    let heldModel: Gate | undefined;
    let retryGate: Gate | undefined;
    let retryAttempts = 0;
    let targetReads = 0;
    let uncertainNext = false;
    let uncertainReceipt = false;
    const fixture = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://fixture.test");
        const route = url.pathname;
        if (route === "/api/v1/events") {
          signalStream = res;
          res.once("close", () => {
            if (signalStream === res) {
              signalStream = undefined;
            }
          });
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.flushHeaders();
          return;
        }
        if (route === "/api/v1/rpc") {
          const rpc = JSON.parse(await readRequestText(req));
          if (
            rpc.method === "send" &&
            (rpc.params.message === "SEED_ACK" || rpc.params.message === "PASSIVE_ACK")
          ) {
            controlTextSends.push(rpc.params.message);
          } else if (rpc.method === "sendReaction" || rpc.method === "send") {
            effects.push({
              channel: "signal",
              method: rpc.method,
              target: String(rpc.params.targetTimestamp),
              body: rpc.params,
            });
          }
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { timestamp: 1700000000900 } }),
          );
          return;
        }
        if (route === "/api/v1/check") {
          res.end("ok");
          return;
        }
        let body: unknown;
        if (route.endsWith("/gateway/bot")) {
          body = {
            url: origin.replace("http:", "ws:") + "/gateway",
            shards: 1,
            session_start_limit: {
              total: 1000,
              remaining: 1000,
              reset_after: 1,
              max_concurrency: 1,
            },
          };
        } else if (route === "/api/v10/oauth2/applications/@me") {
          body = { id: botId, flags: 0 };
        } else if (route.startsWith("/api/v10/users/")) {
          const id = route.split("/").at(-1) === "@me" ? botId : route.split("/").at(-1);
          body = {
            id,
            username: "synthetic",
            discriminator: "0",
            avatar: null,
            global_name: null,
            bot: id === botId || id === otherBotId,
          };
        } else if (route === `/api/v10/channels/${channelId}`) {
          body = { id: channelId, type: 1, recipients: [{ id: actorId, username: "synthetic" }] };
        } else if (req.method === "PUT" && route.includes("/reactions/")) {
          if (retryGate) {
            retryAttempts++;
            const held = retryGate;
            retryGate = undefined;
            res.writeHead(429, { "content-type": "application/json", "retry-after": "0.001" });
            res.flushHeaders();
            held.entered.resolve();
            await held.release.promise;
            res.end(
              JSON.stringify({
                message: "synthetic rate limit",
                retry_after: 0.001,
                global: false,
              }),
            );
            return;
          }
          effects.push({ channel: "discord", method: "react", target: route });
          if (uncertainNext) {
            uncertainNext = false;
            res.destroy(); // Accepted by fixture, receipt lost: never claim confirmed.
            return;
          }
          res.writeHead(204).end();
          return;
        } else if (req.method === "POST" && route.endsWith("/messages")) {
          effects.push({
            channel: "discord",
            method: "send",
            target: route,
            body: JSON.parse(await readRequestText(req)),
          });
          body = { id: "150000000000000099", channel_id: channelId };
        } else if (route.endsWith("/typing")) {
          res.writeHead(204).end();
          return;
        } else if (route === `/api/v10/channels/${channelId}/messages/${messageId}`) {
          targetReads++;
          body = {
            id: messageId,
            channel_id: channelId,
            content: "Original synthetic question",
            author: { id: botId, username: "synthetic", bot: true },
          };
        } else {
          throw new Error(`Unexpected channel request ${req.method} ${route}`);
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
      })().catch((error: unknown) => {
        errors.push(error);
        res.writeHead(500).end("fixture failure");
      });
    });
    const transportListener = await reserveTestPortListener({
      offsets: [0],
      createListener: () => fixture,
    });
    cleanup.defer(transportListener.claim.release);
    const origin = `http://127.0.0.1:${transportListener.claim.port}`;
    const ws = new WebSocketServer({ server: fixture });
    cleanup.defer(async () => {
      for (const client of ws.clients) {
        client.terminate();
      }
      signalStream?.end();
      await new Promise<void>((resolve) => {
        ws.close(() => resolve());
      });
      await closeProvider(fixture);
    });
    ws.on("connection", (socket) => {
      discordSocket = socket;
      socket.once("close", () => {
        if (discordSocket === socket) {
          discordSocket = undefined;
        }
      });
      socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } }));
      socket.on("message", (data) => {
        const frame = JSON.parse(rawDataToString(data));
        if (frame.op === 1) {
          socket.send(JSON.stringify({ op: 11, d: null }));
        }
        if (frame.op === 2 || frame.op === 6) {
          socket.send(
            JSON.stringify({
              op: 0,
              s: 1,
              t: "READY",
              d: {
                v: 10,
                user: { id: botId, username: "synthetic", bot: true },
                guilds: [],
                session_id: "synthetic-reaction-session",
                resume_gateway_url: origin.replace("http:", "ws:") + "/gateway",
                application: { id: botId, flags: 0 },
              },
            }),
          );
        }
      });
    });
    const modelServer = productProvider(errors, async (text, res) => {
      if (text.includes("conversationLabelSource")) {
        writeOpenAiResponsesText(res, {
          text: "Synthetic reactions",
          messageId: randomUUID(),
          responseId: randomUUID(),
        });
        return;
      }
      modelRequests.push(text);
      const request = JSON.parse(text);
      expect(request.tools.map((tool: { name: string }) => tool.name)).toEqual(["message"]);
      const input = request.input as Array<{ role?: string; type?: string }>;
      const lastUser = input.findLastIndex(
        (item) =>
          item.role === "user" && JSON.stringify(item).includes("not approval or task acceptance"),
      );
      const lastBarrier = input.findLastIndex(
        (item) => item.role === "user" && JSON.stringify(item).includes("PASSIVE_BARRIER"),
      );
      if (
        lastBarrier > lastUser ||
        (lastUser < 0 && text.includes("Original synthetic Signal question"))
      ) {
        writeOpenAiResponsesText(res, {
          // Stable requires an answer to an ordinary user request. These
          // control turns are distinct from deliberately silent room events.
          text: lastBarrier > lastUser ? "PASSIVE_ACK" : "SEED_ACK",
          messageId: randomUUID(),
          responseId: randomUUID(),
        });
        return;
      }
      assert(lastUser >= 0, "model receives original typed reaction context");
      const lastOutput = input.findLastIndex((item) => item.type === "function_call_output");
      if (lastUser > lastOutput) {
        const current = JSON.stringify(input[lastUser]);
        const signal = current.includes('\\"channel\\":\\"signal\\"');
        assert(current.includes("not approval or task acceptance"));
        assert(
          current.includes(
            signal ? "Original synthetic Signal question" : "Original synthetic question",
          ),
        );
        if (heldModel) {
          const held = heldModel;
          heldModel = undefined;
          held.entered.resolve();
          await held.release.promise;
          if (res.destroyed) {
            return;
          }
        }
        if (silentNext) {
          silentNext = false;
          writeOpenAiResponsesText(res, {
            text: "NO_REPLY",
            messageId: randomUUID(),
            responseId: randomUUID(),
          });
          return;
        }
        writeToolCall(res, "message", {
          action: "react",
          channel: signal ? "signal" : "discord",
          emoji: "✅",
          final: true,
          ...(signal ? { targetAuthor: signalActor } : {}),
        });
      } else {
        if (JSON.stringify(input[lastOutput]).includes("uncertain")) {
          uncertainReceipt = true;
        }
        writeOpenAiResponsesText(res, {
          text: "NO_REPLY",
          messageId: randomUUID(),
          responseId: randomUUID(),
        });
      }
    });
    const modelListener = await reserveTestPortListener({
      offsets: [0],
      createListener: () => modelServer,
    });
    cleanup.defer(modelListener.claim.release);
    const modelBaseUrl = `http://127.0.0.1:${modelListener.claim.port}/v1`;
    const model = buildMockOpenAiResponsesProvider(modelBaseUrl, "reaction-fixture");
    cleanup.defer(() => closeProvider(modelServer));
    const { defaults, models } = productModelConfig("/replaced-by-disposable-owner", model);
    const cfg = {
      session: { dmScope: "per-channel-peer" as const },
      agents: { entries: { coordinator: {} }, defaults },
      models,
      tools: { allow: ["message"], toolSearch: false, codeMode: { enabled: false } },
      plugins: { allow: ["discord", "signal", "openai"], slots: { memory: "none" } },
      bindings: ["discord", "signal"].map((channel) => ({
        agentId: "coordinator",
        match: { channel, accountId: "default" },
      })),
      channels: {
        discord: {
          enabled: true,
          token: `${Buffer.from(botId).toString("base64url")}.synthetic.signature`,
          applicationId: botId,
          dmPolicy: "allowlist" as const,
          allowFrom: [actorId, otherBotId],
          capabilities: ["reaction-conversations"],
          commands: { native: false as const },
          voice: { enabled: false },
        },
        signal: {
          enabled: true,
          account: signalAccount,
          transport: { kind: "external-native" as const, url: origin },
          dmPolicy: "allowlist" as const,
          allowFrom: [signalActor],
          capabilities: ["reaction-conversations"],
          reactionNotifications: "all" as const,
        },
      },
    };
    const repoRoot = path.resolve(".");
    const stamp = JSON.parse(await readFile(path.join(repoRoot, "dist/.buildstamp"), "utf8"));
    expect(stamp.head).toBe(
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
    );
    const owner = createQaGatewayChild();
    cleanup.defer(async () => {
      await owner.stop();
    });
    const gateway = await owner.start({
      repoRoot,
      command: {
        executablePath: process.execPath,
        argsPrefix: [path.join(repoRoot, "dist/entry.js")],
        cwd: repoRoot,
        usePackagedPlugins: false,
        tempParentDir: process.platform === "darwin" ? "/private/tmp" : undefined,
      },
      providerMode: "mock-openai",
      providerBaseUrl: modelBaseUrl,
      primaryModel: model.modelRef,
      alternateModel: model.modelRef,
      transportBaseUrl: origin,
      enabledPluginIds: ["discord", "signal", "openai"],
      controlUiEnabled: false,
      mutateConfig: (base) => ({
        ...base,
        ...cfg,
        agents: {
          ...cfg.agents,
          defaults: { ...defaults, workspace: base.agents?.defaults?.workspace },
        },
        gateway: base.gateway,
      }),
      runtimeEnvPatch: {
        DISCORD_API_URL: `${origin}/api/v10`,
        OPENCLAW_SKIP_CHANNELS: undefined,
        OPENCLAW_SKIP_PROVIDERS: undefined,
      },
    });
    cleanup.defer(() => {
      console.info("reaction-gateway-receipt", {
        effects: effects.length,
        modelRequests: modelRequests.length,
        errors: errors.length,
        source: stamp.head,
        channels: effects.map((effect) => `${effect.channel}:${effect.method}`),
        diagnostics: gateway
          .logs()
          .split("\n")
          .filter((line) => /failed|cause=|authority revoked/.test(line)),
      });
    });
    await expect.poll(() => Boolean(discordSocket && signalStream)).toBe(true);
    const discord = (remove: boolean, actor = actorId, s = ++sequence) => {
      assert(discordSocket);
      const event = {
        op: 0,
        s,
        t: remove ? "MESSAGE_REACTION_REMOVE" : "MESSAGE_REACTION_ADD",
        d: {
          user_id: actor,
          channel_id: channelId,
          message_id: messageId,
          emoji: { id: null, name: "👍" },
          burst: false,
          type: 0,
        },
      };
      discordSocket.send(JSON.stringify(event));
      return event;
    };
    const signal = (
      remove: boolean,
      actor = signalActor,
      timestamp = 1700000000100 + sequence++,
    ) => {
      assert(signalStream);
      const event = {
        account: signalAccount,
        envelope: {
          sourceNumber: actor,
          sourceName: "Synthetic",
          timestamp,
          dataMessage: {
            timestamp,
            reaction: {
              emoji: "👍",
              targetAuthor: signalActor,
              targetSentTimestamp: signalTarget,
              isRemove: remove,
            },
          },
        },
      };
      signalStream.write(`event: receive\ndata: ${JSON.stringify(event)}\n\n`);
      return event;
    };
    const approvalsBefore = await gateway.call("exec.approvals.get", {});
    const add = discord(false);
    assert(discordSocket);
    discordSocket.send(JSON.stringify(add));
    discordSocket.send(JSON.stringify(add));
    await expect
      .poll(() => effects.filter((x) => x.channel === "discord" && x.method === "react").length, {
        timeout: 20_000,
      })
      .toBe(1);
    assert(signalStream);
    signalStream.write(
      `event: receive\ndata: ${JSON.stringify({ account: signalAccount, envelope: { sourceNumber: signalActor, timestamp: signalTarget, dataMessage: { timestamp: signalTarget, message: "Original synthetic Signal question" } } })}\n\n`,
    );
    await expect.poll(() => controlTextSends, { timeout: 20_000 }).toEqual(["SEED_ACK"]);
    const signalAdd = signal(false);
    signalStream.write(`event: receive\ndata: ${JSON.stringify(signalAdd)}\n\n`);
    signalStream.write(`event: receive\ndata: ${JSON.stringify(signalAdd)}\n\n`);
    await expect
      .poll(
        () => effects.filter((x) => x.channel === "signal" && x.method === "sendReaction").length,
        { timeout: 20_000 },
      )
      .toBe(1);
    discord(true);
    signal(true);
    await expect
      .poll(
        () => effects.filter((x) => x.method === "react" || x.method === "sendReaction").length,
        { timeout: 20_000 },
      )
      .toBe(4);
    await gateway.call("sessions.list", {});
    assert(discordSocket);
    discordSocket.send(JSON.stringify(add));
    discord(false, botId);
    discord(false, otherBotId);
    discord(false, "150000000000000009");
    signal(false, signalAccount);
    signal(false, "+15550008888");
    // History without a native occurrence must not mint a new turn. The native
    // stream reconnects after this non-admittable envelope; observe replacement
    // before sending the sentinel, rather than writing into its closed stream.
    const historyStream = signalStream;
    signalStream.write(
      `event: receive\ndata: ${JSON.stringify({ account: signalAccount, envelope: { sourceNumber: signalActor, dataMessage: { reaction: { emoji: "👍", targetAuthor: signalActor, targetSentTimestamp: signalTarget } } } })}\n\n`,
    );
    await expect
      .poll(() => Boolean(signalStream && signalStream !== historyStream), { timeout: 5_000 })
      .toBe(true);
    // Positive sentinels after rejected/replayed input fence the channel queues.
    discord(false);
    signal(false);
    await expect
      .poll(
        () =>
          effects
            .map((effect) =>
              effect.method === "send"
                ? JSON.stringify(effect)
                : `${effect.channel}:${effect.method}`,
            )
            .toSorted(),
        {
          timeout: 20_000,
        },
      )
      .toEqual([
        "discord:react",
        "discord:react",
        "discord:react",
        "signal:sendReaction",
        "signal:sendReaction",
        "signal:sendReaction",
      ]);
    const beforeRestart = modelRequests.length;
    await gateway.restartAfterStateMutation(async ({ configPath, runtimeEnv, stateDir }) => {
      // Inspect only this stopped disposable owner's real schemas and retained data.
      // No production data, marker relabeling, migration or serving-owner access.
      const config = JSON.parse(await readFile(configPath, "utf8"));
      const versions = await readUpdateStateSchemaVersions({
        stateDir,
        config,
        env: runtimeEnv,
        root: repoRoot,
      });
      expect(versions).toContainEqual({
        path: path.join(stateDir, "state", "openclaw.sqlite"),
        userVersion: 39,
        contentVersion: 39,
      });
      expect(versions.some((entry) => entry.userVersion === 41)).toBe(true);
      const hashes = () =>
        Promise.all(
          versions.map(async (entry) =>
            createHash("sha256")
              .update(await readFile(entry.path))
              .digest("hex"),
          ),
        );
      const retained = await hashes();
      expect(
        await withArtifactPreservingStateReads(() =>
          checkTargetDatabaseSchemasForContexts({ state: 39, agent: 41 }, [
            { config, env: runtimeEnv },
          ]),
        ),
      ).toEqual({ incompatible: [], indeterminate: [] });
      expect(await hashes()).toEqual(retained);
    });
    await expect.poll(() => Boolean(discordSocket && signalStream)).toBe(true);
    assert(discordSocket && signalStream);
    discordSocket.send(JSON.stringify(add));
    signalStream.write(`event: receive\ndata: ${JSON.stringify(signalAdd)}\n\n`);
    discord(false);
    signal(false);
    await expect.poll(() => effects.length, { timeout: 20_000 }).toBe(8);
    expect(modelRequests.length).toBe(beforeRestart + 2);

    // Deliberate silence is a completed room event, never a no-answer notice.
    silentNext = true;
    const silenceMark = gateway.markLogs();
    signal(false);
    await expect
      .poll(() => gateway.readLogsSince(silenceMark), { timeout: 20_000 })
      .toContain("channel=signal");
    expect(effects, JSON.stringify(effects)).toHaveLength(8);

    // The peer accepts the mutation but loses its response. The real tool must
    // expose uncertainty and persisted ingress replay must not resend it.
    uncertainNext = true;
    const uncertainEvent = discord(false);
    await expect.poll(() => uncertainReceipt, { timeout: 20_000 }).toBe(true);
    expect(effects).toHaveLength(9);
    await gateway.restartAfterStateMutation(async () => {});
    await expect.poll(() => Boolean(discordSocket && signalStream)).toBe(true);
    assert(discordSocket);
    discordSocket.send(JSON.stringify(uncertainEvent));
    discord(false);
    await expect.poll(() => effects.length, { timeout: 20_000 }).toBe(10);

    // Revoke the real channel lifetime while provider preparation is awaited.
    const held = { entered: createDeferredCore(), release: createDeferredCore() };
    heldModel = held;
    cleanup.defer(() => held.release.resolve());
    signal(false);
    await held.entered.promise;
    const stop = gateway.call("channels.stop", { channel: "signal", accountId: "default" });
    await expect.poll(() => signalStream === undefined, { timeout: 5_000 }).toBe(true);
    held.release.resolve();
    await stop;
    expect(effects).toHaveLength(10);

    // A real message tool enters Discord's 429 retry owner. Revoke the monitor
    // while the external response is awaited: no queued retry may reach the wire.
    const retry = { entered: createDeferredCore(), release: createDeferredCore() };
    retryGate = retry;
    cleanup.defer(() => retry.release.resolve());
    discord(false);
    await retry.entered.promise;
    const stopDiscord = gateway.call("channels.stop", { channel: "discord", accountId: "default" });
    await expect.poll(() => discordSocket === undefined, { timeout: 5_000 }).toBe(true);
    retry.release.resolve();
    await stopDiscord;
    expect(retryAttempts).toBe(1);
    expect(effects).toHaveLength(10);

    // Changing only the disposable account capability preserves passive defaults.
    // An ordinary Signal message and observed Discord target reads fence the prior
    // reactions without substituting the agent, dispatcher or ingress owner.
    for (const capability of [undefined, []]) {
      await gateway.restartAfterStateMutation(async ({ configPath }) => {
        const config = JSON.parse(await readFile(configPath, "utf8"));
        for (const channel of ["discord", "signal"]) {
          if (capability === undefined) {
            delete config.channels[channel].capabilities;
          } else {
            config.channels[channel].capabilities = capability;
          }
        }
        await writeFile(configPath, JSON.stringify(config));
      });
      await expect.poll(() => Boolean(discordSocket && signalStream)).toBe(true);
      const before = modelRequests.length;
      const reads = targetReads;
      discord(false);
      discord(true);
      signal(false);
      signal(true);
      assert(signalStream);
      const controlCount = controlTextSends.length;
      const timestamp = 1700000005000 + sequence++;
      signalStream.write(
        `event: receive\ndata: ${JSON.stringify({ account: signalAccount, envelope: { sourceNumber: signalActor, timestamp, dataMessage: { timestamp, message: "PASSIVE_BARRIER" } } })}\n\n`,
      );
      await expect.poll(() => targetReads, { timeout: 5_000 }).toBe(reads + 2);
      await expect.poll(() => controlTextSends.length, { timeout: 20_000 }).toBe(controlCount + 1);
      expect(modelRequests.length).toBe(before + 1);
      expect(effects).toHaveLength(10);
    }
    expect(await gateway.call("exec.approvals.get", {})).toEqual(approvalsBefore);
    const sessions = (await gateway.call("sessions.list", {})) as {
      sessions: Array<{ key: string }>;
    };
    expect(sessions.sessions.map((session) => session.key)).toEqual(
      expect.arrayContaining([
        `agent:coordinator:discord:direct:${actorId}`,
        `agent:coordinator:signal:direct:${signalActor}`,
      ]),
    );
    expect(controlTextSends).toEqual(["SEED_ACK", "PASSIVE_ACK", "PASSIVE_ACK"]);
    expect(effects.filter((x) => x.method === "send")).toEqual([]);
    expect(effects.filter((x) => x.channel === "discord").map((x) => x.target)).toEqual(
      Array(6).fill(`/api/v10/channels/${channelId}/messages/${messageId}/reactions/%E2%9C%85/@me`),
    );
    expect(effects.filter((x) => x.channel === "signal").map((x) => x.body)).toEqual(
      Array(4).fill(
        expect.objectContaining({
          targetTimestamp: signalTarget,
          targetAuthor: signalActor,
          emoji: "✅",
          account: signalAccount,
        }),
      ),
    );
    expect(modelRequests.length).toBeGreaterThanOrEqual(4);
    expect(errors).toEqual([]);
  },
);
