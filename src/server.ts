import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ToolAggregator } from "./tools.js";
import { McpClientManager } from "./backends/manager.js";
import { VERSION } from "./version.js";
import type { IncomingMessage, ServerResponse } from "http";
import { randomUUID } from "crypto";

function createMcpServer(aggregator: ToolAggregator): Server {
  const server = new Server(
    { name: "mcphub", version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await aggregator.getAllTools();
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ?? { type: "object", properties: {} },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await aggregator.callTool(name, args ?? {});
      return result as Record<string, unknown>;
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: e instanceof Error ? e.message : "Unknown error",
          },
        ],
        isError: true,
      } as Record<string, unknown>;
    }
  });

  return server;
}

export class McphubServer {
  private httpServer: import("http").Server | null = null;
  private sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>();

  constructor(
    private aggregator: ToolAggregator,
    private manager: McpClientManager
  ) {}

  async start(port: number): Promise<void> {
    const http = await import("http");
    this.httpServer = http.createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === "GET" && req.url === "/health") {
          const failures = this.manager.getFailures();
          const body: Record<string, unknown> = { status: "ok" };
          if (failures.length > 0) body.failures = failures;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
          return;
        }

        if (req.url === "/mcp") {
          try {
            const sessionId = typeof req.headers["mcp-session-id"] === "string"
              ? req.headers["mcp-session-id"]
              : undefined;
            let session = sessionId ? this.sessions.get(sessionId) : undefined;
            let created = false;
            if (!session) {
              created = true;
              const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid) => {
                  this.sessions.set(sid, { transport, server });
                },
                onsessionclosed: (sid) => {
                  this.sessions.delete(sid);
                  server.close().catch(() => {});
                },
              });
              const server = createMcpServer(this.aggregator);
              transport.onclose = () => {
                for (const [sid, entry] of this.sessions) {
                  if (entry.transport === transport) {
                    this.sessions.delete(sid);
                    server.close().catch(() => {});
                  }
                }
              };
              session = { transport, server };
              await server.connect(transport);
            }

            const { transport, server } = session;
            let parsed: unknown;
            if (req.method === "POST") {
              const chunks: Buffer[] = [];
              for await (const chunk of req) {
                chunks.push(chunk);
              }
              parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            }

            await transport.handleRequest(
              req as Parameters<typeof transport.handleRequest>[0],
              res,
              parsed
            );

            if (created && transport.sessionId === undefined) {
              server.close().catch(() => {});
              transport.close();
            }
          } catch (e) {
            const msg = e instanceof Error ? e.stack || e.message : String(e);
            console.error("MCP request error:", msg);
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.end(msg);
            }
          }
          return;
        }

        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
      }
    );

    return new Promise((resolve) => {
      this.httpServer!.listen(port, () => {
        console.log(`MCP Hub running on http://localhost:${port}/mcp`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.httpServer) return;

    for (const { transport, server } of this.sessions.values()) {
      await server.close().catch(() => {});
      transport.close();
    }
    this.sessions.clear();

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn("Shutdown timeout, forcing exit");
        this.httpServer!.closeAllConnections();
        resolve();
      }, 5000);

      this.httpServer!.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}