import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServerConfig, IBackend } from "../types.js";
import { VERSION } from "../version.js";
import { OAuthClientProvider } from "../oauth.js";
import { withTimeout } from "../util.js";

export class HttpBackend implements IBackend {
  private client: Client;
  private authProvider: OAuthClientProvider | null = null;

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

    this.authProvider = new OAuthClientProvider(this.name, this.config.url);
    const tokens = await this.authProvider.tokens();

    try {
      await withTimeout(
        this.client.connect(new StreamableHTTPClientTransport(
          new URL(this.config.url),
          tokens ? { authProvider: this.authProvider } : undefined
        )),
        30_000,
        `connect to http server "${this.name}"`
      );
    } catch (e) {
      await this.client.close().catch(() => {});
      throw e;
    }
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
