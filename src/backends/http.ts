import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServerConfig, IBackend } from "../types.js";

export class HttpBackend implements IBackend {
  private client: Client;
  private transport: StreamableHTTPClientTransport | null = null;

  constructor(
    private name: string,
    private config: McpServerConfig
  ) {
    this.client = new Client(
      { name: `mcp-hub-${name}`, version: "1.0.0" },
      { capabilities: {} }
    );
  }

  getName(): string {
    return this.name;
  }

  async connect(): Promise<void> {
    if (!this.config.url) throw new Error("No URL specified");

    this.transport = new StreamableHTTPClientTransport(
      new URL(this.config.url)
    );

    await this.client.connect(this.transport);
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  async getTools(): Promise<{ name: string; description?: string; inputSchema?: Record<string, unknown> }[]> {
    const result = await this.client.listTools();
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({ name, arguments: args });
  }
}
