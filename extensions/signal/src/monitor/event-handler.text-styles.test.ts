import { expectDefined } from "@openclaw/normalization-core";
import type { MsgContext } from "openclaw/plugin-sdk/reply-runtime";
import { beforeEach, expect, it, vi } from "vitest";

let capturedCtx: MsgContext | undefined;

// mock-isolation: Keep the real inbound runner; replace only persistence and agent dispatch.
vi.mock("openclaw/plugin-sdk/channel-inbound", async (importOriginal) => {
  const { signalInboundTestModule } =
    await import("./event-handler.inbound-context.test-support.js");
  return signalInboundTestModule(
    await importOriginal<typeof import("openclaw/plugin-sdk/channel-inbound")>(),
    async () => {},
    async (plan) => {
      capturedCtx = plan.ctxPayload;
      return { queuedFinal: false, counts: { tool: 0, block: 0, final: 0 } };
    },
  );
});

const [
  { createBaseSignalEventHandlerDeps, createSignalReceiveEvent },
  { createSignalEventHandler },
] = await Promise.all([import("./event-handler.test-harness.js"), import("./event-handler.js")]);

beforeEach(() => {
  capturedCtx = undefined;
});

it.each([
  ["BOLD", "**ship**"],
  ["ITALIC", "_ship_"],
  ["STRIKETHROUGH", "~~ship~~"],
  ["MONOSPACE", "`ship`"],
  ["SPOILER", "||ship||"],
] as const)(
  "keeps %s after a UTF-16 mention without formatting commands",
  async (style, formatted) => {
    const handler = createSignalEventHandler(
      createBaseSignalEventHandlerDeps({ cfg: { messages: { inbound: { debounceMs: 0 } } } }),
    );
    await handler(
      createSignalReceiveEvent({
        dataMessage: {
          message: "😀 ￼ ship it",
          mentions: [{ start: 3, length: 1, uuid: "alice" }],
          textStyles: [{ start: 5, length: 4, style }],
        },
      }),
    );
    const ctx = expectDefined(capturedCtx, "Signal MsgContext");
    expect(ctx.BodyForAgent).toBe(`😀 @alice ${formatted} it`);
    expect(ctx.RawBody).toBe("😀 @alice ship it");
    expect(ctx.CommandBody).toBe("😀 @alice ship it");
  },
);

it("moves a style that covers a mention and keeps literal backticks in monospace", async () => {
  const handler = createSignalEventHandler(
    createBaseSignalEventHandlerDeps({ cfg: { messages: { inbound: { debounceMs: 0 } } } }),
  );
  await handler(
    createSignalReceiveEvent({
      dataMessage: {
        message: "￼ `x`",
        mentions: [{ start: 0, length: 1, uuid: "alice" }],
        textStyles: [
          { start: 0, length: 1, style: "BOLD" },
          { start: 2, length: 3, style: "MONOSPACE" },
        ],
      },
    }),
  );
  const ctx = expectDefined(capturedCtx, "Signal MsgContext");
  expect(ctx.BodyForAgent).toBe("**@alice** `` `x` ``");
  expect(ctx.RawBody).toBe("@alice `x`");
});
