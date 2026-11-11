import type {
  ChannelIngressContextBinding,
  ResolvedChannelMessageIngress,
} from "openclaw/plugin-sdk/channel-ingress-runtime";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
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
import { resolveSignalReactionTargets, shouldEmitSignalReactionNotification } from "./reactions.js";

/** Opted-in reactions are room events. Passive question/approval handling stays
 * with the existing event handler and is deliberately not called from here.
 */
export async function prepareSignalReactionConversation(params: {
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
  assertAuthority: () => void;
  resolveIngress: (
    binding?: ChannelIngressContextBinding,
  ) => Promise<ResolvedChannelMessageIngress>;
}): Promise<SignalInboundEntry | undefined> {
  const { deps, cfg, sender, reaction, groupId, timestamp } = params;
  const { senderAccess } = params.access;
  if (
    senderAccess.decision !== "allow" ||
    !Number.isSafeInteger(reaction.targetSentTimestamp) ||
    (reaction.emoji?.trim().length ?? 0) > 100 ||
    (reaction.targetAuthor?.length ?? 0) > 100 ||
    (reaction.targetAuthorUuid?.length ?? 0) > 100
  ) {
    return undefined;
  }
  const senderDisplay = formatSignalSenderDisplay(sender);
  const senderId = formatSignalSenderId(sender);
  const recipient = resolveSignalRecipient(sender);
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
  // A target timestamp is not an occurrence. Unidentified history cannot start a turn.
  if (
    !Number.isSafeInteger(timestamp) ||
    !timestamp ||
    timestamp <= 0 ||
    senderId.length > 100 ||
    (groupId?.length ?? 0) > 256
  ) {
    return undefined;
  }
  const isGroup = Boolean(groupId);
  const messageId = String(reaction.targetSentTimestamp);
  const occurrenceId = JSON.stringify([deps.accountId, senderId, timestamp]);
  const route = resolveAgentRoute({
    cfg,
    channel: "signal",
    accountId: deps.accountId,
    peer: { kind: isGroup ? "group" : "direct", id: groupId ?? resolveSignalPeerId(sender) },
  });
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
  const context: NonNullable<SignalInboundEntry["reaction"]> = {
    channel: "signal",
    accountId: deps.accountId,
    conversationId: groupId ?? recipient,
    actorId: senderId,
    occurrenceId,
    action: reaction.isRemove ? "removed" : "added",
    emoji: (reaction.emoji?.trim() ?? "emoji").slice(0, 100),
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
  params.assertAuthority();
  if (!ingress.senderAccess.allowed) {
    return undefined;
  }
  const body = `Conversational reaction (not approval or task acceptance): ${JSON.stringify(context)}`;
  return {
    cfg,
    senderName: params.senderName ?? senderDisplay,
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
    replyToId: messageId,
    timestamp,
    reaction: context,
    channelIngress: [ingress],
    turnAdoptionLifecycle: params.lifecycle,
    resolveChannelIngress: params.resolveIngress,
    assertAuthority: params.assertAuthority,
  };
}
