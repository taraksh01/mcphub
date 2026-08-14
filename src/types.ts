export interface McpServerConfig {
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  cwd?: string;
  enabled?: boolean;
  disabledTools?: string[];
}

export interface HubConfig {
  port: number;
  mcpServers: Record<string, McpServerConfig>;
}

export interface IBackend {
  getName(): string;
  getType(): "stdio" | "http";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getTools(): Promise<{ name: string; description?: string; inputSchema?: Record<string, unknown> }[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}
