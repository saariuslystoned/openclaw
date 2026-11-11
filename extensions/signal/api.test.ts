import { expect, expectTypeOf, it, vi } from "vitest";
import type { MonitorSignalOpts } from "./src/monitor.js";
import type { SignalProbe } from "./src/probe.js";

const runtime = vi.hoisted(() => ({
  monitorLoaded: false,
  probeLoaded: false,
  monitor: vi.fn<(opts?: MonitorSignalOpts) => Promise<void>>(),
  probe: vi.fn<typeof import("./src/probe.js").probeSignal>(),
}));

// mock-isolation: Observe lazy evaluation without starting a real Signal monitor.
vi.mock("./src/monitor.js", () => {
  runtime.monitorLoaded = true;
  return { monitorSignalProvider: runtime.monitor };
});
// mock-isolation: Observe lazy evaluation without contacting a real Signal endpoint.
vi.mock("./src/probe.js", () => {
  runtime.probeLoaded = true;
  return { probeSignal: runtime.probe };
});

it("imports cold and forwards monitor/probe arguments, defaults, results and rejections", async () => {
  const api = await import("./api.js");
  expectTypeOf(api.monitorSignalProvider).toEqualTypeOf<
    typeof import("./src/monitor.js").monitorSignalProvider
  >();
  expectTypeOf(api.probeSignal).toEqualTypeOf<typeof import("./src/probe.js").probeSignal>();
  expect(runtime.monitorLoaded).toBe(false);
  expect(runtime.probeLoaded).toBe(false);

  const defaults: MonitorSignalOpts[] = [];
  runtime.monitor.mockImplementation(async (opts = {}) => {
    defaults.push(opts);
  });
  await expect(api.monitorSignalProvider()).resolves.toBeUndefined();
  expect(defaults).toEqual([{}]);
  expect(runtime.monitor).toHaveBeenLastCalledWith();
  expect(runtime.monitorLoaded).toBe(true);
  expect(runtime.probeLoaded).toBe(false);
  const opts: MonitorSignalOpts = { autoStart: false, abortSignal: new AbortController().signal };
  await api.monitorSignalProvider(opts);
  expect(defaults[1]).toBe(opts);
  const error = new Error("synthetic Signal runtime failure");
  runtime.monitor.mockRejectedValueOnce(error);
  await expect(api.monitorSignalProvider(opts)).rejects.toBe(error);

  const result: SignalProbe = { ok: true, elapsedMs: 1, version: "synthetic" };
  const optionsSeen: Array<Parameters<typeof api.probeSignal>[2]> = [];
  runtime.probe.mockImplementation(async (_baseUrl, _timeoutMs, options = {}) => {
    optionsSeen.push(options);
    return result;
  });
  await expect(api.probeSignal("http://127.0.0.1:8080", 123)).resolves.toBe(result);
  expect(runtime.probeLoaded).toBe(true);
  expect(optionsSeen).toEqual([{}]);
  expect(runtime.probe).toHaveBeenLastCalledWith("http://127.0.0.1:8080", 123);
  const options = { transportKind: "container" as const };
  await api.probeSignal("http://127.0.0.1:8081", 456, options);
  expect(runtime.probe).toHaveBeenLastCalledWith("http://127.0.0.1:8081", 456, options);
  expect(optionsSeen[1]).toBe(options);
  runtime.probe.mockRejectedValueOnce(error);
  await expect(api.probeSignal("http://127.0.0.1:8080", 123)).rejects.toBe(error);
});
