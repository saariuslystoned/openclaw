import { createHash } from "node:crypto";
import type { PluginStateKeyedStore } from "../plugin-state/plugin-state-store.types.js";

export type ReactionReplyReceipt<T> =
  | { identity: string; state: "pending" | "claimed" | "uncertain" | "not-sent" }
  | { identity: string; state: "confirmed"; result: T };

export type ReactionReplyOutcome<T> =
  | { state: "pending" | "claimed" | "uncertain" | "not-sent" }
  | { state: "confirmed"; result: T };

/** Receipt rows belong to the plugin's worker store, not another delivery owner.
 * Interrupted claims remain ambiguous. Only a proven pre-transport refusal retries.
 */
export async function runReactionReplyWithReceipt<T>(params: {
  store: PluginStateKeyedStore<ReactionReplyReceipt<T>, 2>;
  key: string;
  identity: string;
  assertAuthority: () => void;
  send: () => Promise<T>;
  isConfirmed: (result: T) => boolean;
}): Promise<ReactionReplyOutcome<T>> {
  const { store, identity } = params;
  const key = createHash("sha256").update(params.key).digest("hex");
  await store.registerIfAbsent(key, { identity, state: "pending" });
  const observed = await store.observe(key);
  const previous = observed.value;
  if (!previous || previous.identity !== identity) {
    throw new Error("Reaction reply key already binds another account, target or reaction");
  }
  if (previous.state === "confirmed") {
    // A historical receipt does not grant a new caller live authority.
    params.assertAuthority();
    return previous;
  }
  if (previous.state === "claimed" || previous.state === "uncertain") {
    return { state: previous.state };
  }
  const claim = await store.compareAndApply(key, observed.comparison, {
    operation: "update",
    action: "set",
    value: { identity, state: "claimed" },
  });
  if (claim.status !== "applied") {
    return { state: "claimed" };
  }
  // Persist ambiguity before I/O so restart cannot regenerate an uncertain send.
  await store.register(key, { identity, state: "uncertain" });
  try {
    params.assertAuthority();
  } catch {
    await store.register(key, { identity, state: "not-sent" });
    return { state: "not-sent" };
  }
  let result: T;
  try {
    result = await params.send();
  } catch {
    return { state: "uncertain" };
  }
  if (!params.isConfirmed(result)) {
    return { state: "uncertain" };
  }
  await store.register(key, { identity, state: "confirmed", result });
  return { state: "confirmed", result };
}
