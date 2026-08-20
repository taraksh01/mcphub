import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export type { CallToolResult, Tool };

export interface McpServerConfig {
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  cwd?: string;
  enabled?: boolean;
  disabledTools?: string[];
  /** HTTP only: interval (ms) to send a keep-alive `ping` and refresh the server session. */
  heartbeatMs?: number;
}

export interface HubConfig {
  port: number;
  mcpServers: Record<string, McpServerConfig>;
}

/** A JSON value that can be passed as a tool argument. */
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export interface IBackend {
  getName(): string;
  getType(): "stdio" | "http";
  onclose?: () => void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  reconnect(): Promise<void>;
  getTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, Json>): Promise<CallToolResult>;
}

/** Messages the daemon sends to its parent process (used when started via `start --daemon`). */
export type DaemonMessage =
  | { type: "ready" }
  | { type: "error" };
