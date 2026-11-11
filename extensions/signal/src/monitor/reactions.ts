import type { SignalReactionNotificationMode } from "openclaw/plugin-sdk/config-contracts";
import { asPositiveFiniteNumber } from "openclaw/plugin-sdk/number-runtime";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import { enqueueSystemEvent } from "openclaw/plugin-sdk/system-event-runtime";
import { normalizeE164 } from "openclaw/plugin-sdk/text-utility-runtime";
import {
  maybeResolveSignalApprovalReaction,
  resolveSignalApprovalConversationKey,
} from "../approval-reactions.js";
import {
  formatSignalSenderDisplay,
  formatSignalSenderId,
  isSignalSenderAllowed,
  resolveSignalPeerId,
  resolveSignalRecipient,
  type SignalSender,
} from "../identity.js";
import type { resolveSignalAccessState } from "./access-policy.js";
import type { SignalEventHandlerDeps, SignalReactionMessage } from "./event-handler.types.js";

type SignalReactionTarget = {
  kind: "phone" | "uuid";
  id: string;
  display: string;
};

export function resolveSignalStatusReactionTimestamp(params: {
  timestamp?: number;
  messageId?: string;
}): number | null {
  const value = typeof params.timestamp === "number" ? params.timestamp : Number(params.messageId);
  return asPositiveFiniteNumber(value) ?? null;
}

export function resolveSignalReactionTargets(
  reaction: SignalReactionMessage,
): SignalReactionTarget[] {
  const targets: SignalReactionTarget[] = [];
  const uuid = reaction.targetAuthorUuid?.trim();
  if (uuid) {
    targets.push({ kind: "uuid", id: uuid, display: `uuid:${uuid}` });
  }
  const author = reaction.targetAuthor?.trim();
  if (author) {
    const normalized = normalizeE164(author);
    targets.push({ kind: "phone", id: normalized, display: normalized });
  }
  return targets;
}

export function isSignalReactionMessage(
  reaction: SignalReactionMessage | null | undefined,
): reaction is SignalReactionMessage {
  if (!reaction) {
    return false;
  }
  const emoji = reaction.emoji?.trim();
  const timestamp = reaction.targetSentTimestamp;
  const hasTarget = Boolean(
    normalizeOptionalString(reaction.targetAuthor) ||
    normalizeOptionalString(reaction.targetAuthorUuid),
  );
  return Boolean(emoji && typeof timestamp === "number" && timestamp > 0 && hasTarget);
}

export function shouldEmitSignalReactionNotification(params: {
  mode?: SignalReactionNotificationMode;
  account?: string | null;
  accountUuid?: string | null;
  targets?: SignalReactionTarget[];
  sender?: SignalSender | null;
  allowlist?: string[];
}) {
  const { mode, account, accountUuid, targets, sender, allowlist } = params;
  const effectiveMode = mode ?? "own";
  if (effectiveMode === "off") {
    return false;
  }
  if (effectiveMode === "own") {
    const accountId = normalizeOptionalString(account);
    const normalizedAccountUuid = normalizeOptionalString(accountUuid);
    if ((!accountId && !normalizedAccountUuid) || !targets || targets.length === 0) {
      return false;
    }
    const normalizedAccount = accountId ? normalizeE164(accountId) : undefined;
    return targets.some((target) => {
      if (target.kind === "uuid") {
        // UUID-only reaction payloads omit the phone identity carried by account.
        return [accountId, normalizedAccountUuid].some(
          (candidate) => candidate === target.id || candidate === `uuid:${target.id}`,
        );
      }
      return Boolean(normalizedAccount) && normalizedAccount === target.id;
    });
  }
  if (effectiveMode === "allowlist") {
    if (!sender || !allowlist || allowlist.length === 0) {
      return false;
    }
    return isSignalSenderAllowed(sender, allowlist);
  }
  return true;
}

/** The passive path retains its existing approval-first policy and notification semantics. */
export async function handleSignalPassiveReaction(params: {
  deps: SignalEventHandlerDeps;
  cfg: SignalEventHandlerDeps["cfg"];
  reaction: SignalReactionMessage;
  sender: SignalSender;
  senderName?: string | null;
  senderAccess: Awaited<ReturnType<typeof resolveSignalAccessState>>["senderAccess"];
}): Promise<void> {
  const { deps, cfg, reaction, sender, senderAccess } = params;
  if (reaction.isRemove) {
    return;
  }
  const senderDisplay = formatSignalSenderDisplay(sender);
  const emojiLabel = normalizeOptionalString(reaction.emoji) ?? "emoji";
  const reactionSenderName = params.senderName ?? senderDisplay;
  const reactionGroupId = reaction.groupInfo?.groupId ?? undefined;
  const reactionGroupName = reaction.groupInfo?.groupName ?? undefined;
  const isReactionGroup = Boolean(reactionGroupId);
  const reactionMessageId = reaction.targetSentTimestamp
    ? String(reaction.targetSentTimestamp)
    : "unknown";
  const conversationKey = resolveSignalApprovalConversationKey(
    reactionGroupId ? `group:${reactionGroupId}` : `signal:${resolveSignalRecipient(sender)}`,
  );
  if (
    conversationKey &&
    (await maybeResolveSignalApprovalReaction({
      cfg,
      accountId: deps.accountId,
      conversationKey,
      messageId: reactionMessageId,
      reactionKey: emojiLabel,
      actorId: formatSignalSenderId(sender),
      targetAuthor: reaction.targetAuthor,
      targetAuthorUuid: reaction.targetAuthorUuid,
      logVerboseMessage: logVerbose,
    }))
  ) {
    return;
  }
  if (senderAccess.decision !== "allow") {
    logVerbose(`Blocked signal reaction sender ${senderDisplay} (${senderAccess.reasonCode})`);
    return;
  }
  const targets = resolveSignalReactionTargets(reaction);
  const shouldNotify = shouldEmitSignalReactionNotification({
    mode: deps.reactionMode,
    account: deps.account,
    accountUuid: deps.accountUuid,
    targets,
    sender,
    allowlist: deps.reactionAllowlist,
  });
  if (!shouldNotify) {
    return;
  }
  const reactionRoute = resolveAgentRoute({
    cfg,
    channel: "signal",
    accountId: deps.accountId,
    peer: {
      kind: isReactionGroup ? "group" : "direct",
      id: isReactionGroup ? (reactionGroupId ?? "unknown") : resolveSignalPeerId(sender),
    },
  });
  const groupLabel = isReactionGroup
    ? `${reactionGroupName ?? "Signal Group"} id:${reactionGroupId}`
    : undefined;
  const text = buildSignalReactionSystemEventText({
    emojiLabel,
    actorLabel: reactionSenderName,
    messageId: reactionMessageId,
    targetLabel: targets[0]?.display,
    groupLabel,
  });
  const contextKey = [
    "signal",
    "reaction",
    "added",
    reactionMessageId,
    formatSignalSenderId(sender),
    emojiLabel,
    reactionGroupId ?? "",
  ]
    .filter(Boolean)
    .join(":");
  enqueueSystemEvent(text, {
    sessionKey: reactionRoute.sessionKey,
    contextKey,
  });
}

export function buildSignalReactionSystemEventText(params: {
  emojiLabel: string;
  actorLabel: string;
  messageId: string;
  targetLabel?: string;
  groupLabel?: string;
}) {
  const base = `Signal reaction added: ${params.emojiLabel} by ${params.actorLabel} msg ${params.messageId}`;
  const withTarget = params.targetLabel ? `${base} from ${params.targetLabel}` : base;
  return params.groupLabel ? `${withTarget} in ${params.groupLabel}` : withTarget;
}
