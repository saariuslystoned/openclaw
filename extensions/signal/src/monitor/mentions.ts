import {
  applyMarkdownTextEdits,
  renderMarkdownWithMarkers,
  type MarkdownStyle,
  type MarkdownStyleSpan,
} from "openclaw/plugin-sdk/text-chunking";
import { normalizeE164 } from "openclaw/plugin-sdk/text-utility-runtime";
import type { SignalTextStyleRange } from "../format.js";
import type { SignalDataMessage, SignalMention } from "./event-handler.types.js";

const OBJECT_REPLACEMENT = "\uFFFC";

function isValidMention(mention: SignalMention | null | undefined): mention is SignalMention {
  if (!mention) {
    return false;
  }
  if (!(mention.uuid || mention.number)) {
    return false;
  }
  if (typeof mention.start !== "number" || Number.isNaN(mention.start)) {
    return false;
  }
  if (typeof mention.length !== "number" || Number.isNaN(mention.length)) {
    return false;
  }
  return mention.length > 0;
}

function clampBounds(start: number, length: number, textLength: number) {
  const safeStart = Math.max(0, Math.trunc(start));
  const safeLength = Math.max(0, Math.trunc(length));
  const safeEnd = Math.min(textLength, safeStart + safeLength);
  return { start: safeStart, end: safeEnd };
}

function isValidStructuredMention(
  message: string,
  mention: SignalMention | null | undefined,
): mention is SignalMention {
  if (!mention || !(mention.uuid || mention.number)) {
    return false;
  }
  const { start, length } = mention;
  if (typeof start !== "number" || typeof length !== "number") {
    return false;
  }
  return (
    Number.isInteger(start) &&
    Number.isInteger(length) &&
    start >= 0 &&
    length > 0 &&
    start + length <= message.length
  );
}

function normalizeAccountPhone(account?: string | null) {
  const trimmed = account?.trim();
  return trimmed ? normalizeE164(trimmed) : undefined;
}

export function resolveSignalMentionFacts(
  identity: {
    account?: string | null;
    accountUuid?: string | null;
  },
  message: string,
  mentions?: SignalMention[] | null,
) {
  const validMentions = (mentions ?? []).filter((mention) =>
    isValidStructuredMention(message, mention),
  );
  const botUuid = identity.accountUuid?.trim();
  const botPhone = normalizeAccountPhone(identity.account);
  const canDetectBotMention = Boolean(botUuid || botPhone);
  const mentionsBot = validMentions.some((mention) => {
    const mentionUuid = mention.uuid?.trim();
    if (botUuid && mentionUuid === botUuid) {
      return true;
    }
    const mentionNumber = mention.number?.trim();
    return Boolean(botPhone && mentionNumber && normalizeE164(mentionNumber) === botPhone);
  });

  return {
    canDetectBotMention,
    hasAnyMention: validMentions.length > 0,
    mentionsBot,
  };
}

const SIGNAL_STYLE_NAMES = new Map<SignalTextStyleRange["style"], MarkdownStyle>([
  ["BOLD", "bold"],
  ["ITALIC", "italic"],
  ["STRIKETHROUGH", "strikethrough"],
  ["MONOSPACE", "code"],
  ["SPOILER", "spoiler"],
]);

/**
 * Renders mentions as `@id` and returns the text twice: plain for command matching and quotes,
 * and with Signal's text styles as Markdown for the agent, so a struck-out word stays struck out.
 */
export function renderSignalText(dataMessage?: SignalDataMessage | null) {
  const message = dataMessage?.message ?? "";
  let styles: MarkdownStyleSpan[] = (dataMessage?.textStyles ?? []).flatMap((range) => {
    const style = SIGNAL_STYLE_NAMES.get(range.style);
    const end = range.start + range.length;
    const valid =
      Number.isInteger(range.start) &&
      Number.isInteger(range.length) &&
      range.start >= 0 &&
      range.length > 0 &&
      end <= message.length;
    return style && valid ? [{ start: range.start, end, style }] : [];
  });
  let normalized = message;
  const candidates = (dataMessage?.mentions ?? [])
    .filter(isValidMention)
    .toSorted((a, b) => b.start! - a.start!);

  for (const mention of candidates) {
    const identifier = mention.uuid ?? mention.number;
    if (!identifier) {
      continue;
    }

    const { start, end } = clampBounds(mention.start!, mention.length!, normalized.length);
    if (start >= end) {
      continue;
    }
    const slice = normalized.slice(start, end);

    if (!slice.includes(OBJECT_REPLACEMENT)) {
      continue;
    }

    // Mentions and styles share the original UTF-16 offsets, so move the styles with each edit.
    const edited = applyMarkdownTextEdits(normalized, [{ start, end, text: `@${identifier}` }]);
    normalized = edited.text;
    styles = styles.map((span) => ({
      ...span,
      start: edited.mapOffset(span.start),
      end: edited.mapOffset(span.end),
    }));
  }

  let longestBacktickRun = 0;
  for (const match of normalized.matchAll(/`+/g)) {
    longestBacktickRun = Math.max(longestBacktickRun, match[0].length);
  }
  const fence = "`".repeat(longestBacktickRun + 1);
  const padding = fence.length > 1 ? " " : "";
  const formattedText = renderMarkdownWithMarkers(
    { text: normalized, styles, links: [] },
    {
      escapeText: (text) => text,
      styleMarkers: {
        bold: { open: "**", close: "**" },
        italic: { open: "_", close: "_" },
        strikethrough: { open: "~~", close: "~~" },
        code: { open: fence + padding, close: padding + fence },
        spoiler: { open: "||", close: "||" },
      },
    },
  );
  return { plainText: normalized.trim(), formattedText: formattedText.trim() };
}
