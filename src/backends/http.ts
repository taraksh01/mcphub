import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServerConfig, IBackend } from "../types.js";
import { VERSION } from "../version.js";

export class HttpBackend implements IBackend {
  private client: Client;

  constructor(
    private name: string,
    private config: McpServerConfig
  ) {
    this.client = new Client(
      { name: `mcphub-${name}`, version: VERSION },
      { capabilities: {} }
    );
  }

  getName(): string {
    return this.name;
  }

  getType(): "http" {
    return "http";
  }

  async connect(): Promise<void> {
    if (!this.config.url) throw new Error("No URL specified");

    await this.client.connect(new StreamableHTTPClientTransport(
      new URL(this.config.url)
    ));
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
