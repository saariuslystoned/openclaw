import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { OpenClawConfig } from "../src/config/types.openclaw.js";
import type { buildMockOpenAiResponsesProvider } from "../src/gateway/test-openai-responses-model.js";
import { writeOpenAiResponsesSse } from "./helpers/openai-responses-sse.js";

export async function readRequestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function closeProvider(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export function writeToolCall(
  response: ServerResponse,
  name: string,
  args: Record<string, unknown>,
): void {
  const id = randomUUID();
  const item = {
    type: "function_call",
    id: `fc_${id}`,
    call_id: `call_${id}`,
    name,
    arguments: JSON.stringify(args),
    status: "completed",
  };
  writeOpenAiResponsesSse(response, [
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, status: "in_progress", arguments: "" },
    },
    {
      type: "response.function_call_arguments.done",
      item_id: item.id,
      output_index: 0,
      arguments: item.arguments,
    },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        id: `resp_${id}`,
        status: "completed",
        output: [item],
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      },
    },
  ]);
}

export function productModelConfig(
  workspace: string,
  provider: ReturnType<typeof buildMockOpenAiResponsesProvider>,
) {
  return {
    defaults: {
      workspace,
      skipBootstrap: true,
      model: { primary: provider.modelRef },
      models: {
        [provider.modelRef]: {
          agentRuntime: { id: "openclaw" },
          params: { transport: "sse", openaiWsWarmup: false },
        },
      },
    },
    models: {
      mode: "replace",
      providers: {
        [provider.providerId]: { ...provider.config, request: { allowPrivateNetwork: true } },
      },
    },
  } satisfies {
    defaults: NonNullable<OpenClawConfig["agents"]>["defaults"];
    models: OpenClawConfig["models"];
  };
}

export function productProvider(
  errors: unknown[],
  handle: (body: string, response: ServerResponse) => void | Promise<void>,
) {
  return createServer((request, response) => {
    void readRequestText(request)
      .then((body) => handle(body, response))
      .catch((error: unknown) => {
        errors.push(error);
        response.writeHead(500).end("fixture provider failed");
      });
  });
}
