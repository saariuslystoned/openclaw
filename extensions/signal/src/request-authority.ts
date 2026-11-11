import { AsyncLocalStorage } from "node:async_hooks";
import { resolveGlobalSingleton } from "openclaw/plugin-sdk/global-singleton";

// The receive path and separately built action/transport bundles share this scope.
const requestAuthority = resolveGlobalSingleton(
  Symbol.for("openclaw.signal.requestAuthority"),
  () => new AsyncLocalStorage<() => void>(),
);

export function withSignalRequestAuthority<T>(
  assertCurrent: (() => void) | undefined,
  run: () => T,
): T {
  return assertCurrent
    ? requestAuthority.run(captureSignalRequestAuthority(assertCurrent)!, run)
    : run();
}

export function captureSignalRequestAuthority(
  assertCurrent?: () => void,
): (() => void) | undefined {
  const inherited = requestAuthority.getStore();
  if (!inherited) {
    return assertCurrent;
  }
  return () => {
    inherited();
    assertCurrent?.();
  };
}
