import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpClientManager } from "./backends/manager.js";
import { ToolAggregator } from "./tools.js";
import type { IncomingMessage, ServerResponse } from "http";

export class McpHubServer {
  private server: Server;
  private httpServer: import("http").Server | null = null;

  constructor(
    private manager: McpClientManager,
    private aggregator: ToolAggregator
  ) {
    this.server = new Server(
      { name: "mcp-hub", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = await this.aggregator.getAllTools();
      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema ?? { type: "object", properties: {} },
        })),
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        const result = await this.aggregator.callTool(name, args ?? {});
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
  }

  async start(port: number): Promise<void> {
    const transport = new StreamableHTTPServerTransport();
    await this.server.connect(transport);

    const http = await import("http");
    this.httpServer = http.createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === "POST" && req.url === "/mcp") {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(chunk);
            }
            const body = Buffer.concat(chunks).toString("utf-8");
            const parsed = JSON.parse(body);

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
    await this.server.close();
    if (this.httpServer) {
      this.httpServer.close();
    }
  }
}
