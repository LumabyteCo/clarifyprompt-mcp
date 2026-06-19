// Transport factory (1.11.0, roadmap #6) — the HTTP runway toward A2A.
//
// Default is stdio (unchanged behaviour). Set CLARIFYPROMPT_TRANSPORT to switch:
//   stdio            — one server over stdin/stdout (default)
//   streamable-http  — the MCP Streamable HTTP transport over a Node http server
//
// HTTP env knobs (only read in streamable-http mode):
//   CLARIFYPROMPT_HTTP_PORT  (default 3000)
//   CLARIFYPROMPT_HTTP_HOST  (default 127.0.0.1 — localhost-only; set 0.0.0.0 to expose)
//   CLARIFYPROMPT_HTTP_PATH  (default /mcp)
//
// Built on Node's built-in `http` — no new runtime dependencies. Each HTTP
// session gets its OWN McpServer (via the createServer factory): sharing one
// server across sessions can leak cross-client data (GHSA-345p-7cg4-v4c7).

import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PATH = "/mcp";

export async function startTransport(createServer: () => McpServer): Promise<void> {
  const mode = (process.env.CLARIFYPROMPT_TRANSPORT ?? "stdio").toLowerCase();

  if (mode === "stdio") {
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const server = createServer();
    await server.connect(new StdioServerTransport());
    return;
  }

  if (mode === "streamable-http" || mode === "http") {
    await startStreamableHttp(createServer);
    return;
  }

  throw new Error(
    `Unknown CLARIFYPROMPT_TRANSPORT='${mode}'. Use 'stdio' (default) or 'streamable-http'.`,
  );
}

async function startStreamableHttp(createServer: () => McpServer): Promise<void> {
  const http = await import("node:http");
  const { randomUUID } = await import("node:crypto");
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const { isInitializeRequest } = await import("@modelcontextprotocol/sdk/types.js");

  const port = Number(process.env.CLARIFYPROMPT_HTTP_PORT) || DEFAULT_PORT;
  const host = process.env.CLARIFYPROMPT_HTTP_HOST || DEFAULT_HOST;
  const mcpPath = process.env.CLARIFYPROMPT_HTTP_PATH || DEFAULT_PATH;

  // One transport (and one McpServer, connected at session init) per session id.
  const transports = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();

  const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const readBody = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : undefined;
  };

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);

    // Liveness probe — handy for containers / load balancers.
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { status: "ok", transport: "streamable-http", sessions: transports.size });
    }

    if (url.pathname !== mcpPath) {
      return sendJson(res, 404, { error: `Not found. MCP endpoint is ${mcpPath}.` });
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      // Reuse an existing session's transport (any method).
      if (sessionId && transports.has(sessionId)) {
        const body = req.method === "POST" ? await readBody(req) : undefined;
        await transports.get(sessionId)!.handleRequest(req, res, body);
        return;
      }

      // New session: must be a POST carrying an `initialize` request.
      if (req.method === "POST") {
        const body = await readBody(req);
        if (!isInitializeRequest(body)) {
          return sendJson(res, 400, {
            jsonrpc: "2.0",
            error: { code: -32000, message: "No valid session id, and not an initialize request." },
            id: null,
          });
        }
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => { transports.set(sid, transport); },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) transports.delete(sid);
        };
        // Fresh server per session (see header note on GHSA-345p-7cg4-v4c7).
        await createServer().connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      // GET/DELETE without a known session can't be served.
      return sendJson(res, 400, { error: "Missing or unknown mcp-session-id." });
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: (err as Error).message });
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  // stderr, never stdout — stdout is reserved for the stdio transport's JSON-RPC.
  process.stderr.write(
    `[clarifyprompt] Streamable HTTP transport listening on http://${host}:${port}${mcpPath} ` +
    `(health: http://${host}:${port}/health)\n`,
  );
}
