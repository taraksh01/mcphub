import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServerConfig, IBackend } from "../types.js";

export class StdioBackend implements IBackend {
  private client: Client;
  private transport: StdioClientTransport | null = null;

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
    if (!this.config.command) throw new Error("No command specified");

    const env: Record<string, string> = {};
    for (const key of Object.keys(process.env)) {
      const val = process.env[key];
      if (val !== undefined) env[key] = val;
    }
    Object.assign(env, this.config.env);

    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args || [],
      env,
    });

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
