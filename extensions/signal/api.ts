export { signalPlugin } from "./src/channel.js";
export { signalSetupPlugin } from "./src/channel.setup.js";
export {
  listEnabledSignalAccounts,
  listSignalAccountIds,
  resolveDefaultSignalAccountId,
  type ResolvedSignalAccount,
  resolveSignalAccount,
} from "./src/accounts.js";
export {
  markdownToSignalText,
  markdownToSignalTextChunks,
  type SignalFormattedText,
  type SignalTextStyleRange,
} from "./src/format.js";
export {
  formatSignalPairingIdLine,
  formatSignalSenderDisplay,
  formatSignalSenderId,
  isSignalSenderAllowed,
  looksLikeUuid,
  normalizeSignalAllowRecipient,
  resolveSignalPeerId,
  resolveSignalRecipient,
  resolveSignalSender,
  type SignalSender,
} from "./src/identity.js";
export { installSignalCli, type SignalInstallResult } from "./src/install-signal-cli.js";
export { signalMessageActions } from "./src/message-actions.js";
export type { MonitorSignalOpts } from "./src/monitor.js";
export const monitorSignalProvider: typeof import("./src/monitor.js").monitorSignalProvider =
  async (...args) => (await import("./src/monitor.js")).monitorSignalProvider(...args);
export { looksLikeSignalTargetId, normalizeSignalMessagingTarget } from "./src/normalize.js";
export {
  type ResolvedSignalOutboundTarget,
  resolveSignalOutboundTarget,
} from "./src/outbound-session.js";
export type { SignalProbe } from "./src/probe.js";
export const probeSignal: typeof import("./src/probe.js").probeSignal = async (...args) =>
  (await import("./src/probe.js")).probeSignal(...args);
export {
  type ResolvedSignalReactionLevel,
  resolveSignalReactionLevel,
  type SignalReactionLevel,
} from "./src/reaction-level.js";
export {
  removeReactionSignal,
  sendReactionSignal,
  type SignalReactionOpts,
  type SignalReactionResult,
} from "./src/send-reactions.js";
export {
  sendMessageSignal,
  sendReadReceiptSignal,
  sendTypingSignal,
  type SignalReceiptType,
  type SignalRpcOpts,
  type SignalSendOpts,
  type SignalSendResult,
} from "./src/send.js";
export { normalizeSignalAccountInput } from "./src/setup-core.js";
export {
  detectSignalTransport,
  prepareSignalManagedNativeTransport,
  probeSignalTransport,
  type SignalManagedNativeTransport,
  type SignalTransportProbeResult,
  writeSignalAccountTransport,
} from "./src/setup-transport.js";
