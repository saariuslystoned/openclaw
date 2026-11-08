import { createServer, type ServerResponse } from "node:http";
import type { ChannelInboundTurnPlan } from "openclaw/plugin-sdk/channel-inbound";
import {
  closeOpenClawStateDatabaseForTest,
  createChannelIngressQueueForTests,
} from "openclaw/plugin-sdk/channel-ingress-test-runtime";
import { clearRuntimeConfigSnapshot } from "openclaw/plugin-sdk/runtime-config-snapshot";
import { closeOpenClawStateDatabaseAsync } from "openclaw/plugin-sdk/sqlite-runtime-testing";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  buildReplyRouteThreadingToolContext,
  buildThreadingToolContext,
} from "../src/auto-reply/reply/agent-runner-utils.js";
import { prepareCliReplyPayload } from "../src/auto-reply/reply/cli-reply-payload.js";
import { buildInboundUserContextPrefix } from "../src/auto-reply/reply/inbound-meta.js";
import { createPreparationRun } from "../src/auto-reply/reply/reply-agent-turn-preparation.test-support.js";
import { resolveAndApplyOutboundReplyToId } from "../src/infra/outbound/message-action-threading.js";
import { createPluginRuntimeMock } from "../src/plugin-sdk/test-helpers/plugin-runtime-mock.js";
import { setActivePluginRegistry } from "../src/plugins/runtime.js";
import { createTestRegistry } from "../src/test-utils/channel-plugins.js";
import { reserveTestPortListener } from "../src/test-utils/port-claims.js";
import { createTempDirTracker } from "./helpers/temp-dir.js";

const capture = vi.hoisted(() => ({
  dispatch: async (_plan: ChannelInboundTurnPlan): Promise<void> => {},
}));

// Exercise receive/context/delivery; substitute model dispatch and session recording only.
vi.mock("openclaw/plugin-sdk/channel-inbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/channel-inbound")>();
  return {
    ...actual,
    resolveInboundSessionEnvelopeContextAsync: async () => ({
      storePath: "/tmp/signal-quote-sessions.json",
      envelopeOptions: {},
      previousTimestamp: undefined,
    }),
    runChannelInboundEvent: async (params: Parameters<typeof actual.runChannelInboundEvent>[0]) =>
      actual.runChannelInboundEvent({
        ...params,
        adapter: {
          ...params.adapter,
          resolveTurn: async (...args) => {
            const plan = await params.adapter.resolveTurn(...args);
            if (!("route" in plan) || !("delivery" in plan)) {
              throw new Error("Expected Signal turn plan");
            }
            return {
              channel: plan.channel,
              accountId: plan.accountId,
              routeSessionKey: plan.route.sessionKey,
              storePath: "/tmp/signal-quote-sessions.json",
              ctxPayload: plan.ctxPayload,
              recordInboundSession: async () => {},
              runDispatch: async () => {
                await plan.replyOptions?.turnAdoptionLifecycle?.onAdopted();
                await capture.dispatch(plan);
                return { queuedFinal: false, counts: { tool: 0, block: 1, final: 0 } };
              },
              runDispatchLifecycle: {
                turnAdoptionLifecycle: plan.replyOptions?.turnAdoptionLifecycle,
                onDispatchSkipped: () => {},
              },
            };
          },
        },
      }),
  };
});

const { monitorSignalProvider, signalPlugin } = await import("../extensions/signal/api.js");
const { setSignalRuntime } = await import("../extensions/signal/runtime-api.js");
const temp = createTempDirTracker();
const observations: Awaited<ReturnType<typeof receive>>[] = [];
const recipientA = "c3456789-01bc-4def-9012-3456789abcde";
const recipientB = "d4567890-12cd-4efa-a123-456789abcdef";
const quotedText = "  Ask 🧭 \uFFFC to prepare the fictional report.  ";
const currentId = 1700000001001;
const quoteId = 1700000000007;
const author = "+15550002222";
let eventStream: ServerResponse | undefined;
let input: unknown;
let eventConnected: (() => void) | undefined;
const wires: Record<string, unknown>[] = [];
let listener: Awaited<ReturnType<typeof reserveTestPortListener>>;

beforeAll(async () => {
  listener = await reserveTestPortListener({
    offsets: [0],
    createListener: () =>
      createServer((req, res) => {
        void (async () => {
          if (req.method === "GET") {
            eventStream = res;
            res.writeHead(200, { "content-type": "text/event-stream" });
            eventConnected?.();
            if (input) {
              res.write(`event: receive\ndata: ${JSON.stringify(input)}\n\n`);
            }
            return;
          }
          const chunks = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
          if (body.method === "send") {
            wires.push(body.params as Record<string, unknown>);
          }
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { timestamp: 1700000002002 } }),
          );
        })().catch((error: unknown) => {
          res.destroy(error instanceof Error ? error : new Error(String(error)));
        });
      }),
  });
});

beforeEach(() => {
  setActivePluginRegistry(
    createTestRegistry([{ pluginId: "signal", source: "test", plugin: signalPlugin }]),
  );
});

afterAll(async () => {
  eventStream?.destroy();
  await listener.releaseListener();
  await listener.claim.release();
  await closeOpenClawStateDatabaseAsync();
  closeOpenClawStateDatabaseForTest();
  temp.cleanup();
  setActivePluginRegistry(createTestRegistry([]));
});

async function receive(options: {
  label: string;
  kind: "quote-native" | "current-native" | "quote-literal" | "quote-ordinary";
  recipient: string;
  denied?: boolean;
}) {
  clearRuntimeConfigSnapshot();
  const stateDir = temp.make("signal-quote-mentions-20261108-");
  setSignalRuntime(
    createPluginRuntimeMock({
      state: {
        openChannelIngressQueue: (params) =>
          createChannelIngressQueueForTests({ ...params, channelId: "signal", stateDir }),
      },
    }),
  );
  const cfg = {
    messages: { inbound: { debounceMs: 0 } },
    channels: {
      signal: {
        account: "+15550009999",
        dmPolicy: "open" as const,
        allowFrom: ["*"],
        replyToMode: "all" as const,
        historyLimit: 0,
        groupPolicy: "allowlist" as const,
        groupAllowFrom: ["+15550001111", ...(options.denied ? [] : [author])],
        contextVisibility: "allowlist" as const,
        groups: { "*": { requireMention: false } },
        transport: {
          kind: "external-native" as const,
          url: `http://127.0.0.1:${listener.claim.port}`,
        },
      },
    },
  };
  const mention = {
    name: options.recipient,
    number: null,
    uuid: options.recipient,
    start: 9,
    length: 1,
  };
  const message = {
    timestamp: currentId,
    message: options.kind === "current-native" ? quotedText : "How is the fictional task going?",
    attachments: [],
    groupInfo: {
      groupId: "aW5kZXBlbmRlbnQtZmljdGlvbmFsLXJvb20=",
      groupName: "Independent fictional room",
    },
    ...(options.kind === "current-native"
      ? { mentions: [mention] }
      : {
          quote: {
            id: quoteId,
            author,
            authorNumber: author,
            authorUuid: null,
            text:
              options.kind === "quote-literal"
                ? `Ask 🧭 @${options.recipient} to prepare the fictional report.`
                : options.kind === "quote-ordinary"
                  ? "An ordinary fictional quote."
                  : quotedText,
            attachments: [],
            ...(options.kind === "quote-native" ? { mentions: [mention] } : {}),
          },
        }),
  };
  const inputPayload = {
    envelope: {
      sourceNumber: "+15550001111",
      sourceName: "Fictional requester",
      timestamp: currentId,
      dataMessage: message,
    },
  };
  input = inputPayload;
  const abort = new AbortController();
  const firstWire = wires.length;
  const dispatched = Promise.withResolvers<ChannelInboundTurnPlan>();
  capture.dispatch = async (plan) => {
    try {
      await plan.delivery.deliver({ text: "Fictional status" }, { kind: "block" });
      const prepareDurable = plan.delivery.durable;
      if (typeof prepareDurable !== "function") {
        throw new Error("Expected Signal final planner");
      }
      const durable = await prepareDurable({ text: "Final fictional status" }, { kind: "final" });
      const send = signalPlugin.message?.send?.text;
      const to = plan.ctxPayload.To;
      if (!durable || !send || !to) {
        throw new Error("Expected Signal durable final adapter");
      }
      await send({
        cfg,
        to,
        text: "Final fictional status",
        accountId: "default",
        deps: durable.deps,
        replyToId: durable.replyToId,
      });
      dispatched.resolve(plan);
    } catch (error) {
      dispatched.reject(error);
    }
  };
  const monitor = monitorSignalProvider({
    config: cfg,
    abortSignal: abort.signal,
    autoStart: false,
    runtime: {
      log: () => {},
      exit: (code) => {
        throw new Error(`Unexpected exit ${code}`);
      },
      error: (error) => dispatched.reject(new Error(String(error))),
    },
  });
  try {
    const plan = await dispatched.promise;
    const context = plan.ctxPayload;
    const tool = buildThreadingToolContext({
      sessionCtx: context,
      config: cfg,
      hasRepliedRef: { value: false },
    });
    const action: Record<string, unknown> = { target: context.To };
    resolveAndApplyOutboundReplyToId(action, {
      channel: "signal",
      toolContext: tool,
      matchesToolContextTarget: signalPlugin.threading?.matchesToolContextTarget,
    });
    const followup = createPreparationRun({
      run: { config: cfg },
      originatingChannel: "signal",
      originatingTo: context.To,
      originatingReplyToId: context.ReplyToId,
    });
    const cliContext = buildReplyRouteThreadingToolContext({
      run: followup.run,
      replyRoute: followup,
      sessionCtx: context,
      hasRepliedRef: { value: false },
    });
    const cli = prepareCliReplyPayload(
      "[[reply_to_current]] Status",
      String(cliContext.currentMessageId),
    );
    return {
      options,
      input: inputPayload,
      config: cfg,
      prefix: buildInboundUserContextPrefix(context),
      context,
      action,
      cli,
      wires: wires.slice(firstWire),
    };
  } finally {
    abort.abort();
    eventStream?.destroy();
    await monitor;
  }
}

function requireObservation(index: number) {
  const observed = observations[index];
  if (!observed) {
    throw new Error(`Missing Signal receive observation ${index}`);
  }
  return observed;
}

function renderedQuote(prefix: string): unknown {
  const section = prefix.split("Reply target of current user message:")[1];
  const json = section?.match(/```json\n([^]*?)\n```/)?.[1];
  return json ? JSON.parse(json) : undefined;
}

it("preserves native quoted recipients in the complete agent context", async () => {
  for (const options of [
    { label: "quote-native-A", kind: "quote-native", recipient: recipientA },
    { label: "quote-native-B", kind: "quote-native", recipient: recipientB },
    { label: "current-native-A", kind: "current-native", recipient: recipientA },
    { label: "current-native-B", kind: "current-native", recipient: recipientB },
    { label: "quote-literal-A", kind: "quote-literal", recipient: recipientA },
    { label: "quote-literal-B", kind: "quote-literal", recipient: recipientB },
    { label: "quote-denied-A", kind: "quote-native", recipient: recipientA, denied: true },
    { label: "quote-ordinary", kind: "quote-ordinary", recipient: recipientA },
  ] as const) {
    observations.push(await receive(options));
  }
  const first = requireObservation(0);
  const second = requireObservation(1);
  expect(renderedQuote(first.prefix)).toMatchObject({
    body: `Ask 🧭 @${recipientA} to prepare the fictional report.`,
    sender_label: author,
  });
  expect(renderedQuote(second.prefix)).toMatchObject({
    body: `Ask 🧭 @${recipientB} to prepare the fictional report.`,
    sender_label: author,
  });
  // The quote renderer must retain the distinct native recipient after UTF16 hydration.
  expect({
    agentText: first.context.agentText,
    prefix: first.prefix,
    context: first.context,
  }).not.toEqual({
    agentText: second.context.agentText,
    prefix: second.prefix,
    context: second.context,
  });
});

it("current native mentions retain distinct recipient identity at the same UTF16 offset", () => {
  const first = requireObservation(2);
  const second = requireObservation(3);
  expect(first.context.agentText).toContain(`@${recipientA}`);
  expect(second.context.agentText).toContain(`@${recipientB}`);
  expect(first.context.agentText).not.toContain("\uFFFC");
  expect(second.context.agentText).not.toContain("\uFFFC");
  expect({ agentText: first.context.agentText, prefix: first.prefix }).not.toEqual({
    agentText: second.context.agentText,
    prefix: second.prefix,
  });
});

it("literal quoted @UUID text remains distinguishable", () => {
  const first = requireObservation(4);
  const second = requireObservation(5);
  expect(renderedQuote(first.prefix)).toMatchObject({
    body: `Ask 🧭 @${recipientA} to prepare the fictional report.`,
  });
  expect(renderedQuote(second.prefix)).toMatchObject({
    body: `Ask 🧭 @${recipientB} to prepare the fictional report.`,
  });
  expect(first.prefix).not.toEqual(second.prefix);
});

it("preserves denied-quote visibility and current native/tool/CLI targets", () => {
  const denied = requireObservation(6);
  expect(denied.prefix).not.toContain("to prepare the fictional report.");
  expect(denied.prefix).not.toContain(recipientA);
  expect(denied.prefix).not.toContain(author);
  expect(denied.context.ReplyToBody).toBeUndefined();
  expect(renderedQuote(requireObservation(7).prefix)).toMatchObject({
    body: "An ordinary fictional quote.",
    sender_label: author,
  });
  expect(requireObservation(0).wires).toEqual(requireObservation(1).wires);
  for (const observed of observations) {
    expect(observed.action.replyTo).toBe(String(currentId));
    expect(observed.cli.replyToId).toBe(String(currentId));
    expect(observed.wires).toHaveLength(2);
    for (const wire of observed.wires) {
      expect(wire).toMatchObject({ quoteTimestamp: currentId, quoteAuthor: "+15550001111" });
    }
  }
});

// Abort an active native receive before any inbound event; no dispatch or outbound send is allowed.
it("cancels an idle native receive without dispatch or outbound work", async () => {
  clearRuntimeConfigSnapshot();
  const stateDir = temp.make("signal-quote-mentions-cancel-");
  setSignalRuntime(
    createPluginRuntimeMock({
      state: {
        openChannelIngressQueue: (params) =>
          createChannelIngressQueueForTests({ ...params, channelId: "signal", stateDir }),
      },
    }),
  );
  const cfg = {
    channels: {
      signal: {
        account: "+15550009999",
        transport: {
          kind: "external-native" as const,
          url: `http://127.0.0.1:${listener.claim.port}`,
        },
      },
    },
  };
  input = undefined;
  const connected = Promise.withResolvers<void>();
  eventConnected = () => connected.resolve();
  let dispatched = false;
  capture.dispatch = async () => {
    dispatched = true;
  };
  const firstWire = wires.length;
  const abort = new AbortController();
  const monitor = monitorSignalProvider({
    config: cfg,
    abortSignal: abort.signal,
    autoStart: false,
    runtime: {
      log: () => {},
      error: (error) => {
        throw new Error(String(error));
      },
      exit: (code) => {
        throw new Error(`Unexpected exit ${code}`);
      },
    },
  });
  try {
    await connected.promise;
    abort.abort();
    eventStream?.destroy();
    await monitor;
  } finally {
    abort.abort();
    eventStream?.destroy();
    eventConnected = undefined;
  }
  const receipt = { cancelled: abort.signal.aborted, dispatched, newWires: wires.slice(firstWire) };
  expect(receipt).toEqual({ cancelled: true, dispatched: false, newWires: [] });
});
