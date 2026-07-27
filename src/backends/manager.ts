import { McpServerConfig, IBackend, ServerStatus } from "../types.js";
import { StdioBackend } from "./stdio.js";
import { HttpBackend } from "./http.js";

export class McpClientManager {
  private backends: Map<string, IBackend> = new Map();
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  async connectAll(servers: Record<string, McpServerConfig>): Promise<void> {
    const entries = Object.entries(servers);
    if (entries.length === 0) return;

    const results = await Promise.allSettled(
      entries.map(async ([name, config]) => {
        const backend = this.createBackend(name, config);
        await backend.connect();
        this.backends.set(name, backend);
      })
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        console.error(
          `Failed to connect backend "${entries[i][0]}":`,
          (results[i] as PromiseRejectedResult).reason
        );
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    for (const backend of this.backends.values()) {
      try {
        await backend.disconnect();
      } catch {
        // ignore disconnect errors
      }
    }
    this.backends.clear();
  }

  async reconnect(name: string, config: McpServerConfig): Promise<void> {
    const existing = this.backends.get(name);
    if (existing) {
      try { await existing.disconnect(); } catch { /* ignore */ }
      this.backends.delete(name);
    }

    const backend = this.createBackend(name, config);
    await backend.connect();
    this.backends.set(name, backend);
  }

  private createBackend(name: string, config: McpServerConfig): IBackend {
    if (config.type === "http") {
      return new HttpBackend(name, config);
    }
    return new StdioBackend(name, config);
  }

  getStatus(): ServerStatus[] {
    return Array.from(this.backends.entries()).map(([name]) => ({
      name,
      type: "stdio" as const,
      status: "connected" as const,
      tools: 0,
    }));
  }

  getBackend(name: string): IBackend | undefined {
    return this.backends.get(name);
  }

  getAllBackends(): IBackend[] {
    return Array.from(this.backends.values());
  }
}
