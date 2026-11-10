import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import type { SignalTransportConfig } from "./account-types.js";
import { containerCheck, containerRpcRequest, streamContainerEvents } from "./client-container.js";
import type { SignalRpcOptions, SignalSseEvent } from "./client-types.js";
import {
  signalCheck as nativeCheck,
  signalRpcRequest as nativeRpcRequest,
  streamSignalEvents as nativeStreamEvents,
} from "./client.js";
import { captureSignalRequestAuthority } from "./request-authority.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export type { SignalSseEvent } from "./client-types.js";

export type SignalTransportKind = SignalTransportConfig["kind"];

export async function signalRpcRequest<T = unknown>(
  method: string,
  params: Record<string, unknown> | undefined,
  opts: SignalRpcOptions & {
    transportKind?: SignalTransportKind;
    maxAttachmentBytes?: number;
  },
): Promise<T> {
  // Capture before asynchronous provider preparation; each transport rechecks
  // this retained owner at its final socket/HTTP effect.
  const options = {
    ...opts,
    assertDirectAdapterHandoff: captureSignalRequestAuthority(opts.assertDirectAdapterHandoff),
  };
  return opts.transportKind === "container"
    ? containerRpcRequest<T>(method, params, options)
    : nativeRpcRequest<T>(method, params, options);
}

export async function signalCheck(
  baseUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  options: { transportKind?: SignalTransportKind; account?: string } = {},
): Promise<{ ok: boolean; status?: number | null; error?: string | null }> {
  try {
    return options.transportKind === "container"
      ? await containerCheck(baseUrl, timeoutMs, options.account)
      : await nativeCheck(baseUrl, timeoutMs);
  } catch (error) {
    return { ok: false, status: null, error: formatErrorMessage(error) };
  }
}

export async function streamSignalEvents(params: {
  baseUrl: string;
  account?: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  lastEventId?: string;
  onEvent: (event: SignalSseEvent) => unknown;
  onStreamOpen?: () => void;
  logger?: { log?: (msg: string) => void; error?: (msg: string) => void };
  transportKind?: SignalTransportKind;
}): Promise<void> {
  if (params.transportKind === "container") {
    return streamContainerEvents({
      ...params,
      onEvent: (event) => params.onEvent({ event: "receive", data: JSON.stringify(event) }),
    });
  }

  return nativeStreamEvents(params);
}
