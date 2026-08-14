import { McpServerConfig, IBackend } from "../types.js";
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
        if (config.enabled === false) {
          console.log(`Skipping disabled backend "${name}"`);
          return;
        }
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
      } catch {}
    }
    this.backends.clear();
    this.failures.clear();
  }

  private createBackend(name: string, config: McpServerConfig): IBackend {
    if (config.type === "http") {
      return new HttpBackend(name, config);
    }
    if (config.type !== "stdio") {
      throw new Error(`Invalid type "${config.type}" for backend "${name}". Use "stdio" or "http"`);
    }
    return new StdioBackend(name, config);
  }

  async syncConfig(oldServers: Record<string, McpServerConfig>, newServers: Record<string, McpServerConfig>): Promise<void> {
    const allNames = new Set([...Object.keys(oldServers), ...Object.keys(newServers)]);
    for (const name of allNames) {
      const oldServer = oldServers[name];
      const newServer = newServers[name];
      if (!newServer) {
        const b = this.backends.get(name);
        if (b) { try { await b.disconnect(); } catch {} this.backends.delete(name); this.failures.delete(name); }
        continue;
      }
      if (newServer.enabled === false) {
        const b = this.backends.get(name);
        if (b) { try { await b.disconnect(); } catch {} this.backends.delete(name); }
        console.log(`Skipping disabled backend "${name}"`);
        continue;
      }
      if (oldServer && JSON.stringify(oldServer) === JSON.stringify(newServer)) continue;
      const existing = this.backends.get(name);
      if (existing) { try { await existing.disconnect(); } catch {} this.backends.delete(name); }
      try {
        const backend = this.createBackend(name, newServer);
        await backend.connect();
        this.backends.set(name, backend);
        this.failures.delete(name);
        console.log(`Reconnected backend "${name}"`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.failures.set(name, { type: newServer.type, error: msg });
        console.error(`Failed to connect backend "${name}":`, msg);
      }
    }
  }

  getBackend(name: string): IBackend | undefined {
    return this.backends.get(name);
  }

  getAllBackends(): IBackend[] {
    return Array.from(this.backends.values());
  }

  getFailures(): { name: string; type: "stdio" | "http"; error: string }[] {
    return Array.from(this.failures.entries()).map(([name, f]) => ({ name, ...f }));
  }
}
