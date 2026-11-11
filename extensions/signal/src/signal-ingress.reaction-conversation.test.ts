import { createHash } from "node:crypto";
import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import {
  closeOpenClawStateDatabaseForTest,
  createChannelIngressQueueForTests,
} from "openclaw/plugin-sdk/channel-ingress-test-runtime";
import { createPluginRuntimeMock } from "openclaw/plugin-sdk/channel-test-helpers";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  runReactionReplyWithReceipt,
  type ReactionReplyReceipt,
} from "openclaw/plugin-sdk/plugin-state-store-runtime";
import { createPluginStateKeyedStoreV2ForTests } from "openclaw/plugin-sdk/plugin-state-test-runtime";
import {
  setRuntimeConfigSnapshot,
  clearRuntimeConfigSnapshot,
} from "openclaw/plugin-sdk/runtime-config-snapshot";
import { useAutoCleanupTempDirTracker } from "openclaw/plugin-sdk/test-env";
import { afterEach, expect, it, vi } from "vitest";
import * as approvalReactions from "./approval-reactions.js";
import { signalPlugin } from "./channel.js";
import { useSignalHttpServer } from "./client.test-support.js";
import { signalMessageActions } from "./message-actions.js";
import { createSignalEventHandler } from "./monitor/event-handler.js";
import {
  createBaseSignalEventHandlerDeps,
  createSignalReceiveEvent,
} from "./monitor/event-handler.test-harness.js";
import * as questionReactions from "./question-reactions.js";
import { registerSignalReplyContext } from "./reply-authors.js";
import { setSignalRuntime } from "./runtime.js";
import * as signalReactions from "./send-reactions.js";
import { startSignalIngressMonitor } from "./signal-ingress.js";

const { resolveReply, sendReaction } = vi.hoisted(() => ({
  resolveReply: vi.fn(),
  sendReaction: vi.fn(async () => ({ ok: true as const })),
}));
const withSignalServer = useSignalHttpServer();
// The provider/model result is injected; ingress, authorization, routing, context
// assembly, ordinary reply dispatch and SQLite tombstones remain real.
vi.mock("openclaw/plugin-sdk/channel-inbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/channel-inbound")>();
  type Params = Parameters<typeof actual.runChannelInboundEvent>[0];
  return {
    ...actual,
    runChannelInboundEvent: (params: Params) =>
      actual.runChannelInboundEvent({
        ...params,
        adapter: {
          ...params.adapter,
          resolveTurn: async (...args) => ({
            ...(await params.adapter.resolveTurn(...args)),
            replyResolver: resolveReply,
          }),
        },
      }),
  };
});
const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(() => {
    clearRuntimeConfigSnapshot();
    closeOpenClawStateDatabaseForTest();
    vi.restoreAllMocks();
    cleanup();
  }),
);
type Queue = NonNullable<Parameters<typeof startSignalIngressMonitor>[0]["queue"]>;

it("preserves durable receipt data at capacity and across reopen without replaying expired authority", async () => {
  const stateDir = dirs.make("openclaw-reaction-capacity-");
  const open = () =>
    createPluginStateKeyedStoreV2ForTests<ReactionReplyReceipt<{ ok: true }>>(
      "signal",
      {
        namespace: "reaction-capacity-proof.v1",
        maxEntries: 2,
        overflowPolicy: "reject-new",
        env: { OPENCLAW_STATE_DIR: stateDir },
      },
      { assertCurrent() {} },
    );
  let store = open();
  const send = vi.fn(async () => ({ ok: true as const }));
  const run = (key: string, assertAuthority = () => {}) =>
    runReactionReplyWithReceipt({
      store,
      key,
      identity: "exact-account-target-reaction",
      assertAuthority,
      send,
      isConfirmed: (result) => result.ok,
    });
  expect(await run("confirmed")).toMatchObject({ state: "confirmed" });
  send.mockRejectedValueOnce(new Error("ambiguous timeout"));
  expect(await run("uncertain")).toEqual({ state: "uncertain" });
  await expect(run("over-capacity")).rejects.toThrow(/2-row limit/);
  expect(send).toHaveBeenCalledTimes(2);
  store = open();
  expect(await run("confirmed")).toMatchObject({ state: "confirmed" });
  expect(await run("uncertain")).toEqual({ state: "uncertain" });
  await expect(
    run("confirmed", () => {
      throw new Error("expired caller");
    }),
  ).rejects.toThrow("expired caller");
  expect(send).toHaveBeenCalledTimes(2);
});

it("records Signal transport receipts, dedupes reopened/concurrent sends and contains uncertain attempts", async () => {
  const stateDir = dirs.make("openclaw-signal-reaction-receipts-");
  const install = () =>
    setSignalRuntime(
      createPluginRuntimeMock({
        state: {
          openKeyedStoreV2: <T>(
            options: Parameters<PluginRuntime["state"]["openKeyedStoreV2"]>[0],
          ) =>
            createPluginStateKeyedStoreV2ForTests<T>(
              "signal",
              {
                ...options,
                env: { OPENCLAW_STATE_DIR: stateDir },
              },
              { assertCurrent() {} },
            ),
        },
      }),
    );
  install();
  sendReaction.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(signalReactions, "sendReactionSignal").mockImplementation(sendReaction);
  vi.spyOn(signalReactions, "removeReactionSignal").mockImplementation(sendReaction);
  const react = (key: string, assertAuthority = () => {}, messageId = "1700000000000") =>
    signalMessageActions.handleAction!({
      channel: "signal",
      action: "react",
      accountId: "default",
      cfg: { channels: { signal: { account: "+15550001111" } } },
      params: { to: "+15550002222", messageId, emoji: "👍", idempotencyKey: key },
      assertDirectAdapterHandoff: assertAuthority,
    });
  const results = await Promise.all([react("reply-1"), react("reply-1")]);
  expect(results.map((result) => result.details)).toContainEqual(
    expect.objectContaining({ ok: true, reactionReceipt: { state: "confirmed" } }),
  );
  expect(sendReaction).toHaveBeenCalledTimes(1);
  install();
  expect((await react("reply-1")).details).toMatchObject({
    ok: true,
    reactionReceipt: { state: "confirmed" },
  });
  expect(sendReaction).toHaveBeenCalledTimes(1);
  await expect(react("reply-1", undefined, "1700000000001")).rejects.toThrow(
    "another account, target or reaction",
  );
  sendReaction.mockRejectedValueOnce(new Error("transport timeout after possible acceptance"));
  expect((await react("reply-2")).details).toMatchObject({
    ok: false,
    deliveryStatus: "uncertain",
  });
  install();
  expect((await react("reply-2")).details).toMatchObject({
    ok: false,
    deliveryStatus: "uncertain",
  });
  expect(sendReaction).toHaveBeenCalledTimes(2);
  expect(
    (
      await react("reply-3", () => {
        throw new Error("revoked before transport");
      })
    ).details,
  ).toMatchObject({ ok: false, deliveryStatus: "not-sent" });
  expect(sendReaction).toHaveBeenCalledTimes(2);
  expect((await react("reply-3")).details).toMatchObject({
    ok: true,
    reactionReceipt: { state: "confirmed" },
  });
  expect(sendReaction).toHaveBeenCalledTimes(3);
  const store = createPluginStateKeyedStoreV2ForTests<ReactionReplyReceipt<{ ok: true }>>(
    "signal",
    {
      namespace: "reaction-replies.v1",
      maxEntries: 5000,
      overflowPolicy: "reject-new",
      env: { OPENCLAW_STATE_DIR: stateDir },
    },
    { assertCurrent() {} },
  );
  await store.register(createHash("sha256").update("crash-before-send").digest("hex"), {
    identity: JSON.stringify([
      "default",
      { recipient: "+15550002222" },
      1700000000000,
      undefined,
      undefined,
      "👍",
      false,
    ]),
    state: "claimed",
  });
  install();
  expect((await react("crash-before-send")).details).toMatchObject({
    ok: false,
    deliveryStatus: "claimed",
  });
  expect(sendReaction).toHaveBeenCalledTimes(3);
});

it.each([true, false, undefined])(
  "dispatches only opted-in=%s reactions, with replay/restart dedupe",
  async (reactionConversations) => {
    const stateDir = dirs.make("openclaw-signal-reaction-conversation-");
    const queue = createChannelIngressQueueForTests<Parameters<Queue["enqueue"]>[1]>({
      channelId: "signal",
      accountId: "default",
      stateDir,
    });
    const approval = vi.spyOn(approvalReactions, "maybeResolveSignalApprovalReaction");
    const question = vi.spyOn(questionReactions, "maybeResolveSignalQuestionReaction");
    const requests: Record<string, unknown>[] = [];
    const baseUrl = await withSignalServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const rpc = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(rpc);
      res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { timestamp: 1700000000900 } }));
    });
    const cfg: OpenClawConfig = {
      session: { store: `${stateDir}/sessions.json` },
      agents: { entries: { coordinator: {} } },
      bindings: [{ agentId: "coordinator", match: { channel: "signal", accountId: "default" } }],
      channels: {
        signal: {
          dmPolicy: "open" as const,
          allowFrom: ["*"],
          groupPolicy: "allowlist" as const,
          groupAllowFrom: ["g1"],
          contextVisibility: "all" as const,
          capabilities:
            reactionConversations === undefined
              ? undefined
              : reactionConversations
                ? ["reaction-conversations"]
                : [],
          account: "+15550009999",
          transport: { kind: "external-native", url: baseUrl },
        },
      },
    };
    setRuntimeConfigSnapshot(cfg);
    const sends = vi.fn(async () => {
      throw new Error("no transport sends permitted");
    });
    const deps = createBaseSignalEventHandlerDeps({
      cfg,
      account: "+15550009999",
      groupPolicy: "allowlist",
      groupAllowFrom: ["g1"],
      reactionMode: "all",
      deliverReplies: sends,
    });
    setSignalRuntime(
      createPluginRuntimeMock({
        state: {
          openKeyedStoreV2: <T>(
            options: Parameters<PluginRuntime["state"]["openKeyedStoreV2"]>[0],
          ) =>
            createPluginStateKeyedStoreV2ForTests<T>(
              "signal",
              { ...options, env: { OPENCLAW_STATE_DIR: stateDir } },
              { assertCurrent() {} },
            ),
        },
      }),
    );
    await registerSignalReplyContext({
      accountId: "default",
      to: "group:g1",
      replyToId: "1700000000000",
      author: "+15550002222",
      body: "Original proposal",
      sourceTimestamp: 1700000000000,
    });
    resolveReply.mockReset().mockImplementation(async (ctx, options) => {
      await options?.turnAdoptionLifecycle?.onAdopted();
      const toolContext = signalPlugin.threading!.buildToolContext!({
        cfg,
        accountId: "default",
        context: {
          To: ctx.To,
          ChatType: ctx.ChatType,
          CurrentMessageId: ctx.MessageSid,
          ReplyToId: ctx.ReplyToId,
        },
      });
      const result = await signalMessageActions.handleAction!({
        channel: "signal",
        action: "react",
        cfg,
        accountId: "default",
        toolContext,
        params: {
          to: ctx.To,
          emoji: "✅",
          targetAuthor: ctx.Reaction.target.authorId,
          idempotencyKey: `reply:${ctx.MessageSid}`,
        },
      });
      expect(result.details).toMatchObject({ ok: true, reactionReceipt: { state: "confirmed" } });
      return { text: "NO_REPLY" };
    });
    const makeMonitor = () =>
      startSignalIngressMonitor({
        accountId: "default",
        queue,
        dispatch: createSignalEventHandler(deps),
        runtime: deps.runtime,
      });
    const event = (isRemove: boolean, timestamp: number, groupId = "g1") =>
      createSignalReceiveEvent({
        timestamp,
        dataMessage: {
          timestamp,
          groupInfo: { groupId },
          reaction: {
            emoji: "👍",
            targetAuthor: "+15550002222",
            targetSentTimestamp: 1700000000000,
            isRemove,
          },
        },
      });
    const add = event(false, 1700000000100);
    const remove = event(true, 1700000000200);
    const monitor = await makeMonitor();
    try {
      await Promise.all([monitor.receive(add), monitor.receive(add)]);
      await monitor.waitForIdle();
      expect(resolveReply).toHaveBeenCalledTimes(reactionConversations ? 1 : 0);
      await monitor.waitForIdle();
      await monitor.receive(remove);
      await vi.waitFor(
        async () => {
          if (resolveReply.mock.calls.length !== (reactionConversations ? 2 : 0)) {
            throw new Error(
              JSON.stringify({
                calls: resolveReply.mock.calls.length,
                pending: (await queue.listPending()).map(({ id, lastError }) => ({
                  id,
                  lastError,
                })),
                claims: (await queue.listClaims()).map(({ id }) => id),
              }),
            );
          }
        },
        { timeout: 5_000 },
      );
      await monitor.waitForIdle();
      for (const [index, action] of (reactionConversations ? ["added", "removed"] : []).entries()) {
        expect(resolveReply.mock.calls[index]![0]).toMatchObject({
          SessionKey: "agent:coordinator:signal:group:g1",
          ReplyToId: "1700000000000",
          CommandAuthorized: false,
          InboundEventKind: "room_event",
          Reaction: {
            channel: "signal",
            accountId: "default",
            conversationId: "g1",
            actorId: "+15550001111",
            action,
            target: {
              messageId: "1700000000000",
              authorId: "+15550002222",
              body: "Original proposal",
            },
          },
        });
      }
      if (reactionConversations) {
        expect(resolveReply.mock.calls[0]![0].Reaction.occurrenceId).not.toBe(
          resolveReply.mock.calls[1]![0].Reaction.occurrenceId,
        );
      }
      await monitor.receive(event(false, 1700000000300, "blocked-group"));
      if (reactionConversations) {
        for (const extra of [
          { targetSentTimestamp: Number.MAX_SAFE_INTEGER + 1 },
          { targetAuthor: "x".repeat(101) },
          { emoji: "x".repeat(101) },
          { groupInfo: { groupId: "x".repeat(257) } },
        ]) {
          await monitor.receive(
            createSignalReceiveEvent({
              timestamp: 1700000000301 + Object.keys(extra)[0]!.length,
              reactionMessage: {
                emoji: "👍",
                targetAuthor: "+15550002222",
                targetSentTimestamp: 1700000000000,
                ...extra,
              },
            }),
          );
        }
      }
      await monitor.receive(
        createSignalReceiveEvent({
          timestamp: 1700000000400,
          sourceNumber: deps.account,
          dataMessage: {
            reaction: {
              emoji: "👍",
              targetAuthor: deps.account,
              targetSentTimestamp: 1700000000000,
            },
          },
        }),
      );
      await monitor.receive(
        createSignalReceiveEvent({
          timestamp: 1700000000500,
          syncMessage: null,
          dataMessage: {
            reaction: {
              emoji: "👍",
              targetAuthor: deps.account,
              targetSentTimestamp: 1700000000000,
            },
          },
        }),
      );
      await monitor.waitForIdle();
      expect(resolveReply).toHaveBeenCalledTimes(reactionConversations ? 2 : 0);
      expect(sends).not.toHaveBeenCalled();
      if (reactionConversations) {
        expect(approval).not.toHaveBeenCalled();
        expect(question).not.toHaveBeenCalled();
      }
      expect(requests).toHaveLength(reactionConversations ? 2 : 0);
      for (const request of requests) {
        expect(request).toMatchObject({
          method: "sendReaction",
          params: {
            groupIds: ["g1"],
            targetTimestamp: 1700000000000,
            targetAuthor: "+15550002222",
            emoji: "✅",
            account: "+15550009999",
          },
        });
      }
    } finally {
      await monitor.stop();
    }
    const replacement = await makeMonitor();
    try {
      await replacement.receive(add);
      await replacement.receive(remove);
      await replacement.waitForIdle();
      expect(resolveReply).toHaveBeenCalledTimes(reactionConversations ? 2 : 0);
      expect(await queue.listPending()).toEqual([]);
      expect(await queue.listClaims()).toEqual([]);
      expect(requests).toHaveLength(reactionConversations ? 2 : 0);
    } finally {
      await replacement.stop();
    }
  },
);
