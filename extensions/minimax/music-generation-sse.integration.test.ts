import "openclaw/plugin-sdk/compiled-subprocess-testing";
import { once } from "node:events";
import { createServer } from "node:http";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { loadPluginInstanceForTest } from "openclaw/plugin-sdk/plugin-test-runtime";
import { expect, it } from "vitest";

it.each([false, true])("loads MiniMax and decodes SSE JSON (multiline: %s)", async (multiline) => {
  const requests: string[] = [];
  const payload = {
    data: { status: 2, audio: Buffer.from("fictional music").toString("hex") },
    base_resp: { status_code: 0, status_msg: "success" },
  };
  const data = JSON.stringify(payload, null, multiline ? 2 : undefined);
  const body =
    data
      .split("\n")
      .map((line) => "data: " + line)
      .join("\n") + "\n\ndata: [DONE]\n\n";
  const server = createServer((request, response) => {
    requests.push(request.method + " " + request.url);
    request.resume();
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(body);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected loopback TCP listener");
  }
  const cfg: OpenClawConfig = {
    plugins: { allow: ["minimax"], entries: { minimax: { enabled: true } } },
    models: {
      providers: {
        minimax: {
          baseUrl: "http://127.0.0.1:" + address.port,
          apiKey: "fictional-test-key",
          request: { allowPrivateNetwork: true },
          models: [],
        },
      },
    },
  };
  let plugin: Awaited<ReturnType<typeof loadPluginInstanceForTest>> | undefined;
  try {
    plugin = await loadPluginInstanceForTest({ config: cfg, pluginId: "minimax" });
    const provider = plugin.registry.musicGenerationProviders.find(
      (registration) => registration.provider.id === "minimax",
    )?.provider;
    if (!provider) {
      throw new Error("MiniMax music provider was not registered by its plugin");
    }
    const result = await plugin.run(() =>
      provider.generateMusic({
        provider: "minimax",
        model: "music-2.6",
        prompt: "fictional soundtrack",
        cfg,
        timeoutMs: 5_000,
      }),
    );
    expect(requests).toEqual(["POST /v1/music_generation"]);
    expect(result.tracks[0]?.buffer).toEqual(Buffer.from("fictional music"));
    expect(result.tracks[0]?.mimeType).toBe("audio/mpeg");
  } finally {
    await plugin?.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
