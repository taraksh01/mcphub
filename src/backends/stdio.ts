import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServerConfig, IBackend, Json } from "../types.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "../version.js";
import { withTimeout } from "../util.js";

export class StdioBackend implements IBackend {
  private client: Client;
  private closing = false;
  onclose?: () => void;

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

  getType(): "stdio" {
    return "stdio";
  }

  async connect(): Promise<void> {
    if (!this.config.command) throw new Error("No command specified");

    try {
      await this.establishConnection();
    } catch (e) {
      this.closing = true;
      await this.client.close().catch(() => {});
      throw e;
    }
  }

  private buildEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of Object.keys(process.env)) {
      const val = process.env[key];
      if (val !== undefined) env[key] = val;
    }
    Object.assign(env, this.config.env);
    return env;
  }

  private async establishConnection(): Promise<void> {
    const transport = new StdioClientTransport({
      command: this.config.command!,
      args: this.config.args || [],
      cwd: this.config.cwd || process.cwd(),
      env: this.buildEnv(),
    });
    transport.onclose = () => {
      if (!this.closing) this.onclose?.();
    };
    await withTimeout(
      this.client.connect(transport),
      30_000,
      `connect to stdio server "${this.name}"`
    );
  }

  async reconnect(): Promise<void> {
    console.error(`[mcphub] stdio backend "${name}": session lost, reinitializing connection...`);
    this.closing = true;
    await this.client.close().catch(() => {});
    this.closing = false;
    this.client = new Client(
      { name: `mcphub-${name}`, version: VERSION },
      { capabilities: {} }
    );
    await this.establishConnection();
    console.error(`[mcphub] stdio backend "${name}": connection reinitialized`);
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    await this.client.close();
  }

  async getTools(): Promise<Tool[]> {
    const result = await this.client.listTools();
    return result.tools;
  }

  async callTool(name: string, args: Record<string, Json>): Promise<CallToolResult> {
    return (await this.client.callTool({ name, arguments: args })) as CallToolResult;
  }
}
