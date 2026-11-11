// Discord plugin module owns raw gateway-message durable ingress and replay draining.
import { GatewayDispatchEvents, type APIMessage } from "discord-api-types/v10";
import {
  createChannelIngressError,
  createChannelIngressMonitor,
  DEFAULT_INGRESS_RETRY_MAX_ATTEMPTS,
  type ChannelIngressQueue,
  type ChannelIngressMonitorDeliveryResult,
  type ChannelIngressMonitorLifecycle,
} from "openclaw/plugin-sdk/channel-outbound";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { danger, type RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import {
  isRecord,
  normalizeNullableString as nonEmptyString,
} from "openclaw/plugin-sdk/string-coerce-runtime";
import type { Client } from "../internal/discord.js";
import { mapGatewayDispatchData } from "../internal/gateway-dispatch.js";
import type { DiscordReactionIngressEvent } from "../internal/listeners.js";
import { getDiscordRuntime } from "../runtime.js";
import type { DiscordMessageEvent } from "./listeners.js";

const DISCORD_INGRESS_PAYLOAD_VERSION = 1;
const DISCORD_INGRESS_DRAIN_INTERVAL_MS = 1_000;

type DiscordIngressRaw = APIMessage | DiscordReactionIngressEvent;
export type DiscordIngressPayload = {
  version: 1;
  receivedAt: number;
  rawMessage: DiscordIngressRaw;
};

function isReactionEvent(raw: DiscordIngressRaw): raw is DiscordReactionIngressEvent {
  return "kind" in raw && raw.kind === "reaction";
}

type DiscordIngressBody = Omit<DiscordIngressPayload, "version">;

export type DiscordIngressLifecycle = Omit<ChannelIngressMonitorLifecycle, "admission">;

export type DiscordIngressDispatchResult = ChannelIngressMonitorDeliveryResult;

type DiscordIngressDispatch = (
  event: DiscordMessageEvent,
  lifecycle: DiscordIngressLifecycle,
) => Promise<DiscordIngressDispatchResult | void> | DiscordIngressDispatchResult | void;

type DiscordIngressMonitor = {
  accept: (rawMessage: DiscordIngressRaw) => Promise<void>;
  start: () => void;
  stop: () => Promise<void>;
};

const DiscordIngressPayloadError = createChannelIngressError("DiscordIngressPayloadError");

function inspectDiscordMessage(rawMessage: unknown): { eventId: string; laneKey: string } {
  if (!rawMessage || typeof rawMessage !== "object" || Array.isArray(rawMessage)) {
    throw new DiscordIngressPayloadError("Discord MESSAGE_CREATE payload must be an object");
  }
  if (isRecord(rawMessage) && rawMessage.kind === "reaction") {
    const data = rawMessage.data;
    if (
      typeof rawMessage.occurrenceId !== "string" ||
      !/^[a-f0-9]{64}$/.test(rawMessage.occurrenceId) ||
      (rawMessage.action !== "added" && rawMessage.action !== "removed") ||
      !isRecord(data) ||
      typeof data.channel_id !== "string" ||
      !/^[0-9]{15,22}$/.test(data.channel_id) ||
      typeof data.message_id !== "string" ||
      !/^[0-9]{15,22}$/.test(data.message_id) ||
      typeof data.user_id !== "string" ||
      !/^[0-9]{15,22}$/.test(data.user_id)
    ) {
      throw new DiscordIngressPayloadError("Discord reaction occurrence is invalid");
    }
    return {
      eventId: `reaction:${rawMessage.occurrenceId}`,
      laneKey: `channel:${data.channel_id}`,
    };
  }
  const candidate = rawMessage as { id?: unknown; channel_id?: unknown };
  const eventId = nonEmptyString(candidate.id);
  if (!eventId) {
    throw new DiscordIngressPayloadError("Discord MESSAGE_CREATE payload is missing its snowflake");
  }
  const channelId = nonEmptyString(candidate.channel_id);
  if (!channelId) {
    throw new DiscordIngressPayloadError("Discord MESSAGE_CREATE payload is missing channel_id");
  }
  return { eventId, laneKey: `channel:${channelId}` };
}

function decodeDiscordIngressPayload(
  payload: DiscordIngressPayload,
  claimedId: string,
): { version: unknown; body: DiscordIngressBody } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DiscordIngressPayloadError("Discord ingress payload must be an object");
  }
  const candidate = payload as Partial<DiscordIngressPayload>;
  try {
    inspectDiscordMessage(candidate.rawMessage);
  } catch (error) {
    throw new DiscordIngressPayloadError(`Discord ingress payload ${claimedId} is invalid`, {
      cause: error,
    });
  }
  return {
    version: candidate.version,
    body: {
      receivedAt: candidate.receivedAt as number,
      rawMessage: candidate.rawMessage as DiscordIngressRaw,
    },
  };
}

function isDiscordAuthenticationFailure(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { status?: unknown; statusCode?: unknown; cause?: unknown };
    if (candidate.status === 401 || candidate.statusCode === 401) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export function createDiscordIngressMonitor(params: {
  accountId: string;
  client: Client;
  runtime: Pick<RuntimeEnv, "error" | "log">;
  dispatch: DiscordIngressDispatch;
  dispatchReaction?: (
    event: DiscordReactionIngressEvent,
    lifecycle: DiscordIngressLifecycle,
  ) => Promise<DiscordIngressDispatchResult | void>;
  queue?: ChannelIngressQueue<DiscordIngressPayload>;
}): DiscordIngressMonitor {
  const queue =
    params.queue ??
    getDiscordRuntime().state.openChannelIngressQueue<DiscordIngressPayload>({
      accountId: params.accountId,
    });
  const monitor = createChannelIngressMonitor<
    DiscordIngressRaw,
    DiscordIngressBody,
    DiscordIngressPayload
  >({
    queue,
    inspect: inspectDiscordMessage,
    payload: {
      version: DISCORD_INGRESS_PAYLOAD_VERSION,
      serialize: (rawMessage, { receivedAt }) => ({ receivedAt, rawMessage }),
      deserialize: (body) => body.rawMessage,
      encode: ({ body }) => ({ version: DISCORD_INGRESS_PAYLOAD_VERSION, ...body }),
      decode: (payload, { claim }) => decodeDiscordIngressPayload(payload, claim.id),
      createClaimError: (kind) =>
        new DiscordIngressPayloadError(
          kind === "invalid-version"
            ? "Discord ingress payload version is unsupported"
            : "Discord message identity changed after durable admission",
        ),
    },
    // Gateway mapping is intentionally delayed until after the durable claim.
    deliver: async (rawMessage, lifecycle) => {
      if (isReactionEvent(rawMessage)) {
        if (!params.dispatchReaction) {
          throw new Error("Discord reaction dispatcher is unavailable");
        }
        return await params.dispatchReaction(rawMessage, lifecycle);
      }
      const event = mapGatewayDispatchData(
        params.client,
        GatewayDispatchEvents.MessageCreate,
        rawMessage,
      ) as DiscordMessageEvent;
      return await params.dispatch(event, lifecycle);
    },
    pollIntervalMs: DISCORD_INGRESS_DRAIN_INTERVAL_MS,
    retention: {
      // Discord previously pruned before every enqueue rather than on a timed cadence.
      pruneIntervalMs: 0,
      completedMaxEntries: 5_000,
      failedMaxEntries: 5_000,
    },
    appendRetryDelaysMs: [0],
    drain: {
      deferredLaneOccupancy: "release",
      retryPolicy: {
        maxAttempts: DEFAULT_INGRESS_RETRY_MAX_ATTEMPTS,
        deadLetterMinAgeMs: 0,
      },
      resolveNonRetryableFailure: (error) => {
        if (error instanceof DiscordIngressPayloadError) {
          return { reason: "invalid-event", message: error.message };
        }
        if (isDiscordAuthenticationFailure(error)) {
          return { reason: "authentication-failed", message: formatErrorMessage(error) };
        }
        return null;
      },
      onLog: (message) => params.runtime.error?.(danger(`discord ingress: ${message}`)),
    },
    onError: (error) =>
      params.runtime.error?.(danger(`discord ingress drain failed: ${formatErrorMessage(error)}`)),
  });

  return {
    accept: async (rawMessage) => {
      await monitor.admit(rawMessage);
    },
    start: monitor.start,
    stop: monitor.stop,
  };
}
