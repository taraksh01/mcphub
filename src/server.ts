import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ToolAggregator } from "./tools.js";
import { McpClientManager } from "./backends/manager.js";
import { VERSION } from "./version.js";
import type { Json, DaemonMessage } from "./types.js";
import type { IncomingMessage, ServerResponse } from "http";
import { randomUUID } from "crypto";

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, mcp-protocol-version");
}

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
      const result = await aggregator.callTool(name, (args ?? {}) as Record<string, Json>);
      return result;
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: e instanceof Error ? e.message : "Unknown error",
          },
        ],
        isError: true,
      } satisfies CallToolResult;
    }
  });

  return server;
}

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const SESSION_IDLE_TTL_MS = 15 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 60 * 1000;

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: Server;
  lastActivity: number;
  openStreams: number;
}

export class McphubServer {
  private httpServer: import("http").Server | null = null;
  private sessions = new Map<string, SessionEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private aggregator: ToolAggregator,
    private manager: McpClientManager
  ) {}

  async start(port: number, host = "127.0.0.1"): Promise<void> {
    const http = await import("http");
    this.httpServer = http.createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        setCors(res);
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }
        if (req.method === "GET" && req.url === "/health") {
          const failures = this.manager.getFailures();
          const body: { status: string; failures: typeof failures } = { status: "ok", failures };
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
                  if (session) this.sessions.set(sid, session);
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
              session = { transport, server, lastActivity: Date.now(), openStreams: 0 };
              await server.connect(transport);
            }

            const { transport, server } = session;
            session.lastActivity = Date.now();
            if (req.method === "GET") {
              session.openStreams++;
              res.on("close", () => {
                session.openStreams--;
              });
            }
            let parsed: Json | undefined;
            if (req.method === "POST") {
              const chunks: Buffer[] = [];
              let size = 0;
              for await (const chunk of req) {
                chunks.push(chunk);
                size += chunk.length;
                if (size > MAX_BODY_BYTES) {
                  res.writeHead(413, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ error: "Request body too large" }));
                  return;
                }
              }
              try {
                parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
              } catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid JSON body" }));
                return;
              }
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

    return new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      this.httpServer!.once("error", onError);
      this.httpServer!.listen(port, host, () => {
        this.httpServer!.off("error", onError);
        if (process.send) {
          try { process.send({ type: "ready" } satisfies DaemonMessage); } catch {}
        }
        console.log(`MCP Hub running on http://${host}:${port}/mcp`);
        resolve();
      });
    }).then(() => {
      this.sweepTimer = setInterval(() => {
        const now = Date.now();
        for (const [sid, entry] of this.sessions) {
          if (entry.openStreams === 0 && now - entry.lastActivity > SESSION_IDLE_TTL_MS) {
            this.sessions.delete(sid);
            entry.server.close().catch(() => {});
            entry.transport.close();
          }
        }
      }, SESSION_SWEEP_INTERVAL_MS);
      this.sweepTimer.unref();
    });
  }

  async stop(): Promise<void> {
    if (!this.httpServer) return;

    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

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