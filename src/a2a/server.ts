// A2A server (1.12.0, roadmap #7) — serves ClarifyPrompt as an Agent-to-Agent
// peer over JSON-RPC 2.0 + SSE, on Node's built-in http (same lean approach as
// the streamable-http transport; the only new dep is @a2a-js/sdk, which itself
// pulls only `uuid`).
//
// Endpoints:
//   GET  /.well-known/agent-card.json   — the agent card (discovery)
//   POST /a2a                           — A2A JSON-RPC (message/send, message/stream, tasks/*)
//   GET  /health                        — liveness
//
// HTTP knobs (shared with streamable-http): CLARIFYPROMPT_HTTP_PORT (3000),
// CLARIFYPROMPT_HTTP_HOST (127.0.0.1). CLARIFYPROMPT_A2A_BASE_URL overrides the
// public base URL advertised in the agent card (useful behind a proxy).
//
// Hardened (post-adversarial-review): the request URL is parsed defensively so a
// malformed request line can't crash the process; request bodies are size-capped;
// the task store is bounded; a client that disconnects mid-stream aborts the
// in-flight compose; and malformed JSON gets the spec-correct -32700 (the SDK
// parses the raw string itself).

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { DefaultRequestHandler, JsonRpcTransportHandler } from "@a2a-js/sdk/server";
import { buildAgentCard, A2A_ENDPOINT } from "./card.js";
import { ClarifyPromptExecutor } from "./executor.js";
import { BoundedTaskStore } from "./store.js";

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const AGENT_CARD_PATH = "/.well-known/agent-card.json";
const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MB — generous for prompts + grounding sources

class BodyTooLargeError extends Error {}

function isAsyncGenerator(x: unknown): x is AsyncGenerator<unknown> {
  return x != null && typeof (x as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`CLARIFYPROMPT_HTTP_PORT must be an integer 0-65535, got '${raw}'.`);
  }
  return n;
}

function resolveBaseUrl(raw: string | undefined, host: string, port: number): string {
  const candidate = raw || `http://${host}:${port}`;
  try {
    new URL(candidate);
  } catch {
    throw new Error(`CLARIFYPROMPT_A2A_BASE_URL is not a valid URL: '${candidate}'.`);
  }
  return candidate;
}

export async function startA2A(version: string): Promise<void> {
  const http = await import("node:http");

  // Validate HTTP knobs up front with clear errors (never a raw stack at listen()).
  const port = parsePort(process.env.CLARIFYPROMPT_HTTP_PORT, DEFAULT_PORT);
  const host = process.env.CLARIFYPROMPT_HTTP_HOST || DEFAULT_HOST;
  const baseUrl = resolveBaseUrl(process.env.CLARIFYPROMPT_A2A_BASE_URL, host, port);

  const agentCard = buildAgentCard(baseUrl, version);
  const requestHandler = new DefaultRequestHandler(agentCard, new BoundedTaskStore(), new ClarifyPromptExecutor());
  const jsonRpc = new JsonRpcTransportHandler(requestHandler);

  const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  // Read the body as a raw string with a hard size cap. We deliberately DON'T
  // JSON.parse here — the SDK's JsonRpcTransportHandler parses the string itself
  // and returns the spec-correct -32700 Parse error envelope on malformed JSON.
  const readBody = async (req: IncomingMessage): Promise<string> => {
    let total = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      total += (chunk as Buffer).length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        throw new BodyTooLargeError();
      }
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  };

  const httpServer = http.createServer(async (req, res) => {
    // Parse the request URL defensively: a malformed request line (e.g. `GET //`)
    // makes `new URL()` throw, and an uncaught synchronous throw in the request
    // listener exits the whole process. Never let that happen.
    let url: URL;
    try {
      url = new URL(req.url ?? "/", baseUrl);
    } catch {
      return sendJson(res, 400, { error: "Bad request URL." });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { status: "ok", transport: "a2a", agent: agentCard.name });
    }
    if (req.method === "GET" && url.pathname === AGENT_CARD_PATH) {
      return sendJson(res, 200, agentCard);
    }
    if (req.method === "POST" && url.pathname === A2A_ENDPOINT) {
      let raw: string;
      try {
        raw = await readBody(req);
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          return sendJson(res, 413, {
            jsonrpc: "2.0",
            error: { code: -32600, message: `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.` },
            id: null,
          });
        }
        return sendJson(res, 400, { error: "Failed to read request body." });
      }

      try {
        const result = await jsonRpc.handle(raw); // SDK parses + validates; emits -32700 on bad JSON
        if (isAsyncGenerator(result)) {
          // Streaming method (message/stream, tasks/resubscribe) — SSE.
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });

          // If the peer disconnects before we finish, abort the in-flight compose
          // (the SDK runs execute() detached, so without this the LLM work + cost
          // would keep going against a dead socket).
          let streamTaskId: string | undefined;
          let completed = false;
          res.on("close", () => {
            if (!completed && streamTaskId) {
              requestHandler.cancelTask({ id: streamTaskId }).catch(() => { /* best-effort */ });
            }
          });

          try {
            for await (const event of result) {
              // Events are JSON-RPC response envelopes ({ jsonrpc, id, result }).
              // The task id (needed to cancel on disconnect) is on the inner result.
              if (!streamTaskId) {
                const inner = (event as { result?: { kind?: string; id?: string } }).result ?? (event as { kind?: string; id?: string });
                if (inner?.kind === "task") streamTaskId = inner.id;
              }
              if (res.writableEnded || res.destroyed) break;
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
            completed = true;
            res.end();
          } catch (streamErr) {
            // Mid-stream error AFTER headers are sent: emit a terminal error frame
            // so the peer sees a clean failure instead of a silently truncated 200.
            completed = true;
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: (streamErr as Error).message } })}\n\n`);
              res.end();
            }
          }
        } else {
          sendJson(res, 200, result);
        }
      } catch (err) {
        if (!res.headersSent) {
          sendJson(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: (err as Error).message }, id: null });
        } else {
          res.end();
        }
      }
      return;
    }

    sendJson(res, 404, {
      error: `Not found. A2A JSON-RPC endpoint is POST ${A2A_ENDPOINT}; agent card at GET ${AGENT_CARD_PATH}.`,
    });
  });

  // Malformed HTTP that fails Node's own request parser never reaches the
  // listener above — close the socket cleanly instead of letting Node throw.
  httpServer.on("clientError", (_err: Error, socket: Socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  process.stderr.write(
    `[clarifyprompt] A2A agent '${agentCard.name}' listening on ${baseUrl}${A2A_ENDPOINT} ` +
    `(card: ${baseUrl}${AGENT_CARD_PATH}, health: ${baseUrl}/health)\n`,
  );
}
