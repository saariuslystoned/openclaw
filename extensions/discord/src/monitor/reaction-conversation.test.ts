import { installDiscordIngressTestRuntime } from "../test-support/ingress-runtime.js";

installDiscordIngressTestRuntime();
import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import {
  createChannelIngressQueueForTests,
  closeOpenClawStateDatabaseForTest,
} from "openclaw/plugin-sdk/channel-ingress-test-runtime";
import { createPluginRuntimeMock } from "openclaw/plugin-sdk/channel-test-helpers";
import { createDeferred } from "openclaw/plugin-sdk/extension-shared";
import { createPluginStateKeyedStoreV2ForTests } from "openclaw/plugin-sdk/plugin-state-test-runtime";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import {
  setRuntimeConfigSnapshot,
  clearRuntimeConfigSnapshot,
} from "openclaw/plugin-sdk/runtime-config-snapshot";
import { createSubsystemLogger } from "openclaw/plugin-sdk/runtime-env";
import { useAutoCleanupTempDirTracker } from "openclaw/plugin-sdk/test-env";
import { afterEach, expect, it, vi } from "vitest";
import { handleDiscordMessageAction } from "../actions/handle-action.js";
import { ChannelType, User, type Client } from "../internal/discord.js";
import { createReactionDispatchData } from "../internal/gateway-dispatch.js";
import type { DiscordReactionIngressEvent } from "../internal/listeners.js";
import { RequestClient } from "../internal/rest.js";
import { setDiscordRuntime } from "../runtime.js";
import { sendMessageDiscord } from "../send.js";
import * as ingressRuntime from "./ingress.js";
import { createDiscordIngressMonitor } from "./ingress.js";
import { DiscordReactionListener, DiscordReactionRemoveListener } from "./listeners.reactions.js";
import { createDiscordMessageHandler } from "./message-handler.js";
import { createDiscordHandlerParams } from "./message-handler.test-helpers.js";
import { dispatchDiscordReactionConversation } from "./reaction-conversation.js";

const { resolveReply, transport, reactionTransport, deliveryOnly } = vi.hoisted(() => ({
  deliveryOnly: { enabled: false },
  resolveReply: vi.fn(),
  transport: vi.fn(),
  reactionTransport: vi.fn(),
}));
vi.mock("../../action-runtime-api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../action-runtime-api.js")>()),
  handleDiscordAction: reactionTransport,
}));
vi.mock("./reply-delivery.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./reply-delivery.js")>()),
  deliverDiscordReply: transport,
}));
// Inject the model boundary, not routing, ingress, context assembly or dispatch.
vi.mock("openclaw/plugin-sdk/channel-inbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/channel-inbound")>();
  type Params = Parameters<typeof actual.dispatchChannelInboundTurn>[0];
  return {
    ...actual,
    dispatchChannelInboundTurn: async (params: Params) => {
      if (deliveryOnly.enabled) {
        if (!params.delivery || !("deliver" in params.delivery)) {
          throw new Error("Missing delivery");
        }
        await params.delivery.deliver({ text: "Conversational response" }, { kind: "final" });
        return { dispatched: true };
      }
      const before = resolveReply.mock.calls.length;
      const result = await actual.dispatchChannelInboundTurn({
        ...params,
        replyResolver: resolveReply,
      });
      if (resolveReply.mock.calls.length === before) {
        throw new Error(
          `Reaction dispatcher did not reach injected model: ${JSON.stringify(result.dispatched ? result.dispatchResult : result.admission)}`,
        );
      }
      return result;
    },
  };
});
const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(() => {
    deliveryOnly.enabled = false;
    transport.mockReset();
    clearRuntimeConfigSnapshot();
    closeOpenClawStateDatabaseForTest();
    vi.restoreAllMocks();
    cleanup();
  }),
);

type Queue = NonNullable<Parameters<typeof createDiscordIngressMonitor>[0]["queue"]>;

it("rejects a revoked conversation reply queued in the real REST owner before final I/O", async () => {
  // Inject only dispatch scheduling and the durable delivery envelope; exercise
  // the actual reaction callback, sender, request scheduler and final fetch fence.
  deliveryOnly.enabled = true;
  const release = createDeferred<void>();
  const queued = createDeferred<void>();
  const fetch = vi.fn(async () => {
    if (fetch.mock.calls.length <= 4) {
      await release.promise;
    }
    return Response.json({ id: "150000000000000002", channel_id: "150000000000000001" });
  });
  const rest = new RequestClient("synthetic-token", { fetch });
  const active = Array.from({ length: 4 }, (_, index) =>
    rest.get(`/channels/blocked-${index}/messages`),
  );
  // Channel metadata is already known for this admitted conversation. Do not
  // deadlock preparation behind the saturated write queue under test.
  const get = rest.get.bind(rest);
  vi.spyOn(rest, "get").mockImplementation((path, query) =>
    path === "/channels/150000000000000001"
      ? Promise.resolve({ id: "150000000000000001", type: ChannelType.DM })
      : get(path, query),
  );
  const post = rest.post.bind(rest);
  const postSpy = vi.spyOn(rest, "post").mockImplementation((...args) => {
    const pending = post(...args);
    queued.resolve();
    return pending;
  });
  const caller = new AbortController();
  const assertCurrent = () => caller.signal.throwIfAborted();
  transport.mockImplementation(async (params) => {
    await sendMessageDiscord(params.target, params.replies[0].text, {
      cfg: params.cfg,
      token: params.token,
      rest,
      assertPlatformSendAuthorized: params.assertPlatformSendAuthorized,
    });
    return { visibleReplySent: true };
  });
  const cfg = { channels: { discord: { token: "synthetic-token" } } };
  const sending = dispatchDiscordReactionConversation(
    {
      cfg,
      context: {
        channel: "discord",
        accountId: "default",
        conversationId: "150000000000000001",
        actorId: "150000000000000003",
        occurrenceId: "a".repeat(64),
        action: "added",
        emoji: "👍",
        target: { messageId: "150000000000000002" },
      },
      route: resolveAgentRoute({
        cfg,
        channel: "discord",
        accountId: "default",
        peer: { kind: "direct", id: "150000000000000003" },
      }),
      conversationKind: "direct",
      isThread: false,
      memberRoleIds: [],
      assertAuthority: assertCurrent,
    },
    {
      token: "synthetic-token",
      textLimit: 2000,
      lifecycle: {
        abortSignal: new AbortController().signal,
        onAdopted() {},
        onDeferred() {},
        onAdoptionFinalizing() {},
        onAbandoned() {},
      },
    },
  );
  const rejected = expect(sending).rejects.toThrow("reaction authority revoked");
  try {
    await Promise.race([queued.promise, sending]);
    expect(postSpy).toHaveBeenCalledOnce();
    caller.abort(new Error("reaction authority revoked"));
    release.resolve();
    await Promise.all(active);
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(4);
  } finally {
    release.resolve();
    await Promise.allSettled([...active, sending, rejected]);
  }
});

it("confirms Discord reactions only from a transport receipt and never resends an uncertain/reopened occurrence", async () => {
  const stateDir = dirs.make("openclaw-discord-reaction-receipts-");
  const install = () =>
    setDiscordRuntime(
      createPluginRuntimeMock({
        state: {
          openKeyedStoreV2: <T>(
            options: Parameters<PluginRuntime["state"]["openKeyedStoreV2"]>[0],
          ) =>
            createPluginStateKeyedStoreV2ForTests<T>(
              "discord",
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
  reactionTransport.mockReset().mockResolvedValue({
    content: [{ type: "text", text: '{"ok":true}' }],
    details: { ok: true, added: "👍" },
  });
  const react = (key: string, messageId = "150000000000000002") =>
    handleDiscordMessageAction({
      action: "react",
      cfg: {},
      accountId: "work",
      params: { to: "channel:150000000000000001", messageId, emoji: "👍", idempotencyKey: key },
    });
  await Promise.all([react("reply-1"), react("reply-1")]);
  expect(reactionTransport).toHaveBeenCalledTimes(1);
  install();
  expect((await react("reply-1")).details).toMatchObject({
    ok: true,
    reactionReceipt: { state: "confirmed" },
  });
  expect(reactionTransport).toHaveBeenCalledTimes(1);
  await expect(react("reply-1", "150000000000000003")).rejects.toThrow(
    "another account, target or reaction",
  );
  reactionTransport.mockRejectedValueOnce(new Error("timeout after possible acceptance"));
  expect((await react("reply-2")).details).toMatchObject({
    ok: false,
    deliveryStatus: "uncertain",
  });
  install();
  expect((await react("reply-2")).details).toMatchObject({
    ok: false,
    deliveryStatus: "uncertain",
  });
  expect(reactionTransport).toHaveBeenCalledTimes(2);
});

it.each([true, false, undefined])(
  "routes reactions only with opt-in=%s, preserving passive replay semantics",
  async (reactionConversations) => {
    const stateDir = dirs.make("openclaw-reaction-conversation-");
    const queue = createChannelIngressQueueForTests<Parameters<Queue["enqueue"]>[1]>({
      channelId: "discord",
      accountId: "work",
      stateDir,
    });
    const cfg = {
      session: { store: `${stateDir}/sessions.json` },
      agents: { entries: { coordinator: {} } },
      bindings: [{ agentId: "coordinator", match: { channel: "discord", accountId: "work" } }],
      channels: {
        discord: {
          dmPolicy: "open" as const,
          allowFrom: ["*"],
          capabilities:
            reactionConversations === undefined
              ? undefined
              : reactionConversations
                ? ["reaction-conversations"]
                : [],
        },
      },
    };
    setRuntimeConfigSnapshot(cfg);
    const client = {
      fetchUser: async (id: string) =>
        new User(client, {
          id,
          username: "reactor",
          discriminator: "0",
          global_name: null,
          avatar: null,
          bot: id === "150000000000000005",
        }),
      fetchChannel: async () => ({ id: "150000000000000001", type: ChannelType.DM }),
      rest: {
        get: async () => ({
          id: "150000000000000002",
          channel_id: "150000000000000001",
          content: "Original question",
          author: { id: "150000000000000003", username: "bot", bot: true },
        }),
      },
    } as unknown as Client;
    const policy = {
      cfg,
      accountId: "work",
      botUserId: "150000000000000003",
      dmEnabled: true,
      groupDmEnabled: false,
      groupDmChannels: [],
      dmPolicy: "open" as const,
      allowFrom: ["*"],
      groupPolicy: "disabled" as const,
      allowNameMatching: false,
      runtime: { error: vi.fn(), log: vi.fn(), exit: vi.fn() },
      logger: createSubsystemLogger("discord/reaction-test"),
    };
    resolveReply.mockReset().mockImplementation(async (_ctx, options) => {
      await options?.turnAdoptionLifecycle?.onAdopted();
      return { text: "NO_REPLY" };
    });
    // Inject only isolated storage; production handler owns reaction registration,
    // policy/routing, ordinary dispatch and durable settlement.
    const createMonitor = createDiscordIngressMonitor;
    vi.spyOn(ingressRuntime, "createDiscordIngressMonitor").mockImplementation((params) =>
      createMonitor({ ...params, queue }),
    );
    const makeMonitor = () => {
      const handler = createDiscordMessageHandler({
        ...createDiscordHandlerParams(),
        ...policy,
        client,
      });
      expect(handler.acceptReaction).toBeTypeOf("function");
      return { accept: handler.acceptReaction!, stop: handler.deactivate };
    };
    const event = (action: "added" | "removed", id: string): DiscordReactionIngressEvent => ({
      kind: "reaction",
      action,
      occurrenceId: id.repeat(64),
      data: {
        user_id: "150000000000000004",
        channel_id: "150000000000000001",
        message_id: "150000000000000002",
        emoji: { id: null, name: "👍" },
        burst: false,
        type: 0,
      },
    });
    const add = event("added", "a");
    const remove = event("removed", "b");
    const monitor = makeMonitor();
    try {
      const listeners = [
        new DiscordReactionListener({ ...policy, admitReaction: monitor.accept }),
        new DiscordReactionRemoveListener({ ...policy, admitReaction: monitor.accept }),
      ];
      for (const [index, raw] of [add, remove].entries()) {
        await listeners[index]!.handle(
          { ...createReactionDispatchData(client, raw.data), ingressEvent: raw },
          client,
        );
        await vi.waitFor(
          async () => {
            const [pending] = await queue.listPending();
            if (pending?.lastError) {
              throw new Error(pending.lastError);
            }
            expect(
              await queue.enqueue(`reaction:${raw.occurrenceId}`, {
                version: 1,
                receivedAt: 1,
                rawMessage: raw,
              }),
            ).toMatchObject({ kind: "completed" });
          },
          { timeout: 5_000 },
        );
      }
      const bot = event("removed", "c");
      bot.data.user_id = "150000000000000005";
      await monitor.accept(bot);
      await vi.waitFor(async () =>
        expect(
          await queue.enqueue(`reaction:${bot.occurrenceId}`, {
            version: 1,
            receivedAt: 1,
            rawMessage: bot,
          }),
        ).toMatchObject({ kind: "completed" }),
      );
      expect(resolveReply).toHaveBeenCalledTimes(reactionConversations ? 2 : 0);
      expect(transport).not.toHaveBeenCalled();
      for (const [index, action] of (reactionConversations ? ["added", "removed"] : []).entries()) {
        const ctx = resolveReply.mock.calls[index]![0];
        expect(ctx).toMatchObject({
          SessionKey: "agent:coordinator:main",
          MessageSid: "reaction:" + (index === 0 ? add : remove).occurrenceId,
          ReplyToId: "150000000000000002",
          CommandAuthorized: false,
          InboundEventKind: "room_event",
          Reaction: {
            accountId: "work",
            conversationId: "150000000000000001",
            actorId: "150000000000000004",
            action,
            target: {
              messageId: "150000000000000002",
              authorId: "150000000000000003",
              body: "Original question",
            },
          },
        });
        expect(ctx.BodyForAgent).toContain("not approval or task acceptance");
        expect(ctx.CommandBody).not.toContain("approve");
      }
    } finally {
      await monitor.stop();
    }
    const replacement = makeMonitor();
    try {
      await Promise.all([
        replacement.accept(add),
        replacement.accept(add),
        replacement.accept(remove),
      ]);
      expect(resolveReply).toHaveBeenCalledTimes(reactionConversations ? 2 : 0);
      expect(await queue.listPending()).toEqual([]);
      expect(await queue.listClaims()).toEqual([]);
    } finally {
      await replacement.stop();
    }
  },
);
