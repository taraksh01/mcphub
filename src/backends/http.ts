import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServerConfig, IBackend, Json } from "../types.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "../version.js";
import { OAuthClientProvider } from "../oauth.js";
import { withTimeout } from "../util.js";

export class HttpBackend implements IBackend {
  private client: Client;
  private authProvider: OAuthClientProvider | null = null;
  private useAuth = false;
  private closing = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
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

  getType(): "http" {
    return "http";
  }

  async connect(): Promise<void> {
    if (!this.config.url) throw new Error("No URL specified");

    this.authProvider = new OAuthClientProvider(this.name, this.config.url);
    const tokens = await this.authProvider.tokens();
    this.useAuth = !!tokens;

    try {
      await this.establishConnection();
    } catch (e) {
      this.closing = true;
      await this.client.close().catch(() => {});
      throw e;
    }
  }

  private async establishConnection(): Promise<void> {
    const transport = new StreamableHTTPClientTransport(
      new URL(this.config.url!),
      this.useAuth ? { authProvider: this.authProvider! } : undefined
    );
    transport.onclose = () => {
      if (!this.closing) this.onclose?.();
    };
    await withTimeout(
      this.client.connect(transport),
      30_000,
      `connect to http server "${this.name}"`
    );
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const ms = this.config.heartbeatMs;
    if (!ms || ms <= 0) return;
    console.error(`[mcphub] http backend "${this.getName()}": heartbeat started (every ${ms}ms)`);
    this.heartbeatTimer = setInterval(() => {
      this.client.ping().catch((e) =>
        console.error(
          `[mcphub] http backend "${this.getName()}": heartbeat ping failed: ${e instanceof Error ? e.message : String(e)}`
        )
      );
    }, ms);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async reconnect(): Promise<void> {
    console.error(`[mcphub] http backend "${this.getName()}": session lost, reinitializing connection...`);
    this.closing = true;
    await this.client.close().catch(() => {});
    this.closing = false;
    this.client = new Client(
      { name: `mcphub-${this.name}`, version: VERSION },
      { capabilities: {} }
    );
    await this.establishConnection();
    console.error(`[mcphub] http backend "${this.getName()}": connection reinitialized`);
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
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
