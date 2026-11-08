import { beforeEach, expect, it, vi } from "vitest";
import { signalAccountConfig } from "./signal-rpc.test-support.js";

const signalRpcRequestMock = vi.hoisted(() => vi.fn());
vi.mock("./client-adapter.js", () => ({
  signalRpcRequest: (...args: unknown[]) => signalRpcRequestMock(...args),
}));

const { sendPollSignal } = await import("./send-polls.js");
const cfg = signalAccountConfig("external-native", "http://signal.test");
const poll = { question: "Deploy Task B?", options: ["Approve", "Hold", "Cancel"] };

beforeEach(() => {
  signalRpcRequestMock.mockReset().mockResolvedValue({ timestamp: 1700000000123 });
});

it("sends a multi-answer poll to a direct recipient and returns its timestamp", async () => {
  const result = await sendPollSignal(
    "signal:uuid:e3e7cd8b",
    { ...poll, maxSelections: 3 },
    { cfg },
  );
  expect(result).toEqual({ messageId: "1700000000123" });
  const [method, params] = signalRpcRequestMock.mock.calls[0] ?? [];
  expect(method).toBe("sendPollCreate");
  expect(params).toMatchObject({
    question: poll.question,
    option: poll.options,
    recipient: ["e3e7cd8b"],
  });
  expect(params).not.toHaveProperty("no-multi");
});

it("sends a single-answer poll to a group", async () => {
  await sendPollSignal("group:abc123", { ...poll, maxSelections: 1 }, { cfg });
  expect(signalRpcRequestMock.mock.calls[0]?.[1]).toMatchObject({
    "no-multi": true,
    groupId: ["abc123"],
  });
});
