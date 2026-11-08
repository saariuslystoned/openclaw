import type { ChannelReactionContext } from "openclaw/plugin-sdk/channel-inbound";
import type {
  ChannelIngressContextBinding,
  ResolvedChannelMessageIngress,
} from "openclaw/plugin-sdk/channel-ingress-runtime";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { enqueueSystemEvent } from "openclaw/plugin-sdk/system-event-runtime";
import { resolveSignalAccount } from "../accounts.js";
import {
  maybeResolveSignalApprovalReaction,
  resolveSignalApprovalConversationKey,
} from "../approval-reactions.js";
import {
  formatSignalSenderDisplay,
  formatSignalSenderId,
  resolveSignalPeerId,
  resolveSignalRecipient,
  type SignalSender,
} from "../identity.js";
import { resolveSignalReplyContextWithPersistence } from "../reply-authors.js";
import type { SignalInboundEntry } from "./event-handler.control-lane.js";
import type { SignalEventHandlerDeps, SignalReactionMessage } from "./event-handler.types.js";
import { resolveSignalQuoteContext } from "./inbound-context.js";
import {
  buildSignalReactionSystemEventText,
  resolveSignalReactionTargets,
  shouldEmitSignalReactionNotification,
} from "./reactions.js";

/** One plugin owner for passive notifications and explicitly opted-in turns. */
export async function handleSignalReaction(params: {
  deps: SignalEventHandlerDeps;
  cfg: SignalEventHandlerDeps["cfg"];
  sender: SignalSender;
  senderName?: string | null;
  reaction: SignalReactionMessage;
  groupId?: string;
  groupName?: string | null;
  timestamp?: number | null;
  access: Awaited<ReturnType<typeof import("./access-policy.js").resolveSignalAccessState>>;
  lifecycle?: SignalInboundEntry["turnAdoptionLifecycle"];
  resolveIngress: (
    binding?: ChannelIngressContextBinding,
  ) => Promise<ResolvedChannelMessageIngress>;
  dispatch: (entry: SignalInboundEntry) => Promise<void>;
}): Promise<{ kind: "deferred" } | undefined> {
  const { deps, cfg, sender, reaction, groupId, timestamp } = params;
  const enabled =
    resolveSignalAccount({ cfg, accountId: deps.accountId }).config.capabilities?.includes(
      "reaction-conversations",
    ) === true;
  if (!enabled && reaction.isRemove) {
    return undefined;
  }
  const emoji = reaction.emoji?.trim() ?? "emoji";
  const senderDisplay = formatSignalSenderDisplay(sender);
  const senderName = params.senderName ?? senderDisplay;
  const senderId = formatSignalSenderId(sender);
  const recipient = resolveSignalRecipient(sender);
  const isGroup = Boolean(groupId);
  const messageId = String(reaction.targetSentTimestamp);
  const conversationKey = resolveSignalApprovalConversationKey(
    groupId ? `group:${groupId}` : `signal:${recipient}`,
  );
  // The legacy explicitly bound approval control remains separate. An opted-in
  // conversational observation never enters it, even if its emoji resembles approval.
  if (
    !enabled &&
    conversationKey &&
    (await maybeResolveSignalApprovalReaction({
      cfg,
      accountId: deps.accountId,
      conversationKey,
      messageId,
      reactionKey: emoji,
      actorId: senderId,
      targetAuthor: reaction.targetAuthor,
      targetAuthorUuid: reaction.targetAuthorUuid,
      logVerboseMessage: logVerbose,
    }))
  ) {
    return undefined;
  }
  const { senderAccess } = params.access;
  if (senderAccess.decision !== "allow") {
    return undefined;
  }
  const targets = resolveSignalReactionTargets(reaction);
  if (
    !shouldEmitSignalReactionNotification({
      mode: deps.reactionMode,
      account: deps.account,
      accountUuid: deps.accountUuid,
      targets,
      sender,
      allowlist: deps.reactionAllowlist,
    })
  ) {
    return undefined;
  }
  const route = resolveAgentRoute({
    cfg,
    channel: "signal",
    accountId: deps.accountId,
    peer: { kind: isGroup ? "group" : "direct", id: groupId ?? resolveSignalPeerId(sender) },
  });
  if (!enabled) {
    enqueueSystemEvent(
      buildSignalReactionSystemEventText({
        emojiLabel: emoji,
        actorLabel: senderName,
        messageId,
        targetLabel: targets[0]?.display,
        groupLabel: isGroup ? `${params.groupName ?? "Signal Group"} id:${groupId}` : undefined,
      }),
      {
        sessionKey: route.sessionKey,
        contextKey: ["signal", "reaction", "added", messageId, senderId, emoji, groupId ?? ""]
          .filter(Boolean)
          .join(":"),
      },
    );
    return undefined;
  }
  // The target timestamp is not a reaction occurrence. History without the
  // original transport occurrence must never mint a fresh turn identity.
  if (
    !Number.isSafeInteger(timestamp) ||
    !timestamp ||
    timestamp <= 0 ||
    senderId.length > 100 ||
    (groupId?.length ?? 0) > 256
  ) {
    return undefined;
  }
  const occurrenceId = JSON.stringify([deps.accountId, senderId, timestamp]);
  const target = await resolveSignalReplyContextWithPersistence({
    accountId: deps.accountId,
    to: groupId ? `group:${groupId}` : `signal:${recipient}`,
    replyToId: messageId,
  });
  const quote = resolveSignalQuoteContext({
    cfg,
    accountId: deps.accountId,
    isGroup,
    effectiveGroupAllow: senderAccess.effectiveGroupAllowFrom,
    dataMessage: {
      quote: {
        author: reaction.targetAuthor,
        authorUuid: reaction.targetAuthorUuid,
        text:
          target &&
          !target.ambiguous &&
          targets.some((entry) => entry.display === target.author || entry.id === target.author)
            ? target.body?.slice(0, 2000)
            : undefined,
      },
    },
  });
  const context: ChannelReactionContext = {
    channel: "signal",
    accountId: deps.accountId,
    conversationId: groupId ?? recipient,
    actorId: senderId,
    occurrenceId,
    action: reaction.isRemove ? "removed" : "added",
    emoji: emoji.slice(0, 100),
    target: {
      messageId,
      authorId: targets[0]?.display,
      ...(quote.visibleQuoteText ? { body: quote.visibleQuoteText } : {}),
    },
  };
  const occurrenceMessageId = `reaction:${occurrenceId}`;
  const ingress = await params.resolveIngress({
    agentId: route.agentId,
    sessionKey: route.sessionKey,
    messageId: occurrenceMessageId,
    inboundEventKind: "room_event",
  });
  if (!ingress.senderAccess.allowed) {
    return undefined;
  }
  const body = `Conversational reaction (not approval or task acceptance): ${JSON.stringify(context)}`;
  await params.dispatch({
    cfg,
    senderName,
    senderDisplay,
    senderRecipient: recipient,
    senderPeerId: resolveSignalPeerId(sender),
    groupId,
    groupName: params.groupName ?? undefined,
    isGroup,
    bodyText: body,
    commandBody: body,
    commandAuthorized: false,
    messageId: occurrenceMessageId,
    timestamp,
    reaction: context,
    channelIngress: [ingress],
    turnAdoptionLifecycle: params.lifecycle,
    resolveChannelIngress: params.resolveIngress,
  });
  return params.lifecycle ? { kind: "deferred" } : undefined;
}
