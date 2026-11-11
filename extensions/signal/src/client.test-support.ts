import { once } from "node:events";
import http from "node:http";
import { afterEach } from "vitest";

export function useSignalHttpServer() {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(async (server) => {
        server.closeAllConnections();
        await server[Symbol.asyncDispose]();
      }),
    );
  });
  return async (
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>,
  ) => {
    const server = http.createServer((req, res) => {
      void Promise.resolve(handler(req, res)).catch((error: unknown) => {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(error instanceof Error ? error.message : String(error));
      });
    });
    servers.push(server);
    server.on("clientError", () => {});
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("missing test server address");
    }
    return `http://127.0.0.1:${address.port}`;
  };
}
