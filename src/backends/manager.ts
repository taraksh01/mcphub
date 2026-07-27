import { McpServerConfig, IBackend, ServerStatus } from "../types.js";
import { StdioBackend } from "./stdio.js";
import { HttpBackend } from "./http.js";

export class McpClientManager {
  private backends: Map<string, IBackend> = new Map();
  private failures: Map<string, { type: "stdio" | "http"; error: string }> = new Map();

  async connectAll(servers: Record<string, McpServerConfig>): Promise<void> {
    const entries = Object.entries(servers);
    if (entries.length === 0) return;

    const results = await Promise.allSettled(
      entries.map(async ([name, config]) => {
        const backend = this.createBackend(name, config);
        await backend.connect();
        this.backends.set(name, backend);
        this.failures.delete(name);
      })
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        const reason = (results[i] as PromiseRejectedResult).reason;
        const msg = reason instanceof Error ? reason.message : String(reason);
        console.error(`Failed to connect backend "${entries[i][0]}":`, msg);
        this.failures.set(entries[i][0], { type: entries[i][1].type, error: msg });
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const backend of this.backends.values()) {
      try {
        await backend.disconnect();
      } catch {
        // ignore disconnect errors
      }
    }
    this.backends.clear();
    this.failures.clear();
  }

  async reconnect(name: string, config: McpServerConfig): Promise<void> {
    const existing = this.backends.get(name);
    if (existing) {
      try { await existing.disconnect(); } catch { /* ignore */ }
      this.backends.delete(name);
    }

    const backend = this.createBackend(name, config);
    try {
      await backend.connect();
      this.backends.set(name, backend);
      this.failures.delete(name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.failures.set(name, { type: config.type, error: msg });
      throw e;
    }
  }

  private createBackend(name: string, config: McpServerConfig): IBackend {
    if (config.type === "http") {
      return new HttpBackend(name, config);
    }
    return new StdioBackend(name, config);
  }

  getStatus(): ServerStatus[] {
    const statuses: ServerStatus[] = [];
    for (const [name, backend] of this.backends) {
      statuses.push({
        name,
        type: backend.getType(),
        status: "connected",
        tools: 0,
      });
    }
    for (const [name, failure] of this.failures) {
      if (!this.backends.has(name)) {
        statuses.push({
          name,
          type: failure.type,
          status: "error",
          error: failure.error,
          tools: 0,
        });
      }
    }
    return statuses;
  }

  getBackend(name: string): IBackend | undefined {
    return this.backends.get(name);
  }

  getAllBackends(): IBackend[] {
    return Array.from(this.backends.values());
  }
}
