import type { DiscordAccountConfig } from "openclaw/plugin-sdk/config-contracts";

/** Account policy consumed at inbound admission, without replacing the transport. */
export function selectDiscordLivePolicyConfig(config: DiscordAccountConfig) {
  return {
    enabled: config.enabled,
    actions: config.actions,
    groupPolicy: config.groupPolicy,
    capabilities: config.capabilities,
    dmPolicy: config.dmPolicy,
    allowFrom: config.allowFrom,
    dm: config.dm,
    guilds: config.guilds,
    allowBots: config.allowBots,
    dangerouslyAllowNameMatching: config.dangerouslyAllowNameMatching,
  };
}
