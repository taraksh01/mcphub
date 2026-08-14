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

        if (req.method === "POST" && req.url === "/mcp") {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(chunk);
            }
            const body = Buffer.concat(chunks).toString("utf-8");
            const parsed = JSON.parse(body);

            const transport = new StreamableHTTPServerTransport();
            const server = createMcpServer(this.aggregator);
            await server.connect(transport);
            await transport.handleRequest(
              req as Parameters<typeof transport.handleRequest>[0],
              res,
              parsed
            );
          } catch (e) {
            const msg = e instanceof Error ? e.stack || e.message : String(e);
            console.error("MCP request error:", msg);
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.end(msg);
            }
          }
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
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
