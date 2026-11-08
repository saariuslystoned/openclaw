import { requireRuntimeConfig } from "openclaw/plugin-sdk/plugin-config-runtime";
import { resolveSignalAccount } from "./accounts.js";
import { signalRpcRequest } from "./client-adapter.js";
import { normalizeSignalReactionRecipient } from "./normalize.js";
import { resolveSignalRpcContext } from "./rpc-context.js";
import type { SignalRpcOpts } from "./send.js";

/** signal-cli rejects polls with more options (`SendPollCreateCommand.MAX_POLL_OPTIONS`). */
export const SIGNAL_POLL_MAX_OPTIONS = 10;

export type SignalPollInput = {
  question: string;
  options: string[];
  maxSelections: number;
};

/** Sends a native Signal poll; the returned message id is the poll's own sent timestamp. */
export async function sendPollSignal(
  to: string,
  poll: SignalPollInput,
  opts: SignalRpcOpts & { assertDirectAdapterHandoff?: () => void },
): Promise<{ messageId: string }> {
  const cfg = requireRuntimeConfig(opts.cfg, "Signal polls");
  const accountInfo = resolveSignalAccount({ cfg, accountId: opts.accountId });
  const { baseUrl, account } = resolveSignalRpcContext(opts, accountInfo);
  const target = normalizeSignalReactionRecipient(to);
  const groupId = /^group:/i.test(target) ? target.slice("group:".length).trim() : undefined;
  if (!target || (groupId !== undefined && !groupId)) {
    throw new Error("Recipient or group is required for a Signal poll");
  }
  const params: Record<string, unknown> = {
    question: poll.question,
    option: poll.options,
    // Signal polls allow multiple answers unless the sender opts out.
    ...(poll.maxSelections === 1 ? { "no-multi": true } : {}),
    ...(groupId ? { groupId: [groupId] } : { recipient: [target] }),
    ...(account ? { account } : {}),
  };
  const result = await signalRpcRequest<{ timestamp?: number }>("sendPollCreate", params, {
    baseUrl,
    timeoutMs: opts.timeoutMs,
    transportKind: opts.transportKind ?? accountInfo.transport.kind,
    assertDirectAdapterHandoff: opts.assertDirectAdapterHandoff,
  });
  if (typeof result?.timestamp !== "number") {
    throw new Error("Signal poll was sent without a timestamp");
  }
  return { messageId: String(result.timestamp) };
}
