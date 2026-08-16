import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServerConfig, IBackend } from "../types.js";
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

    const env: Record<string, string> = {};
    for (const key of Object.keys(process.env)) {
      const val = process.env[key];
      if (val !== undefined) env[key] = val;
    }
    Object.assign(env, this.config.env);

    try {
      const transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args || [],
        cwd: this.config.cwd || process.cwd(),
        env,
      });
      transport.onclose = () => {
        if (!this.closing) this.onclose?.();
      };
      await withTimeout(
        this.client.connect(transport),
        30_000,
        `connect to stdio server "${this.name}"`
      );
    } catch (e) {
      this.closing = true;
      await this.client.close().catch(() => {});
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    this.closing = true;
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
