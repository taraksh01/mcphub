import { McpServerConfig, IBackend } from "../types.js";
import { StdioBackend } from "./stdio.js";
import { HttpBackend } from "./http.js";

export class McpClientManager {
  private backends: Map<string, IBackend> = new Map();
  private failures: Map<string, { type: "stdio" | "http"; error: string }> = new Map();
  private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private retryAttempts: Map<string, number> = new Map();
  private static readonly RETRY_DELAYS_MS = [5000, 10000, 20000];

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
        this.attachDeathHook(name, backend, config);
        this.backends.set(name, backend);
        this.failures.delete(name);
        this.retryAttempts.delete(name);
      })
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        const reason = (results[i] as PromiseRejectedResult).reason;
        const msg = reason instanceof Error ? reason.message : String(reason);
        console.error(`Failed to connect backend "${entries[i][0]}":`, msg);
        this.failures.set(entries[i][0], { type: entries[i][1].type, error: msg });
        this.scheduleRetry(entries[i][0], entries[i][1]);
      }
    }
  }

  private scheduleRetry(name: string, config: McpServerConfig): void {
    const attempt = this.retryAttempts.get(name) ?? 0;
    if (attempt >= McpClientManager.RETRY_DELAYS_MS.length) {
      this.retryAttempts.delete(name);
      console.error(`Gave up reconnecting backend "${name}" after ${McpClientManager.RETRY_DELAYS_MS.length} retries`);
      return;
    }
    const delay = McpClientManager.RETRY_DELAYS_MS[attempt];
    this.retryAttempts.set(name, attempt + 1);
    console.log(`Backend "${name}" failed, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${McpClientManager.RETRY_DELAYS_MS.length})`);
    const existing = this.retryTimers.get(name);
    if (existing) clearTimeout(existing);
    this.retryTimers.set(name, setTimeout(async () => {
      try {
        const backend = this.createBackend(name, config);
        await backend.connect();
        this.attachDeathHook(name, backend, config);
        this.backends.set(name, backend);
        this.failures.delete(name);
        this.retryAttempts.delete(name);
        console.log(`Reconnected backend "${name}"`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Retry failed for backend "${name}":`, msg);
        this.scheduleRetry(name, config);
      }
    }, delay));
  }

  private clearRetry(name: string): void {
    const timer = this.retryTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(name);
    }
    this.retryAttempts.delete(name);
  }

  async disconnectAll(): Promise<void> {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.retryAttempts.clear();
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

  private attachDeathHook(name: string, backend: IBackend, config: McpServerConfig): void {
    backend.onclose = () => {
      if (!this.backends.has(name)) return;
      this.backends.delete(name);
      const msg = `Backend "${name}" died, reconnecting`;
      console.error(msg);
      this.failures.set(name, { type: config.type, error: msg });
      this.scheduleRetry(name, config);
    };
  }

  async syncConfig(oldServers: Record<string, McpServerConfig>, newServers: Record<string, McpServerConfig>): Promise<void> {
    const allNames = new Set([...Object.keys(oldServers), ...Object.keys(newServers)]);
    for (const name of allNames) {
      const oldServer = oldServers[name];
      const newServer = newServers[name];
      if (!newServer) {
        this.clearRetry(name);
        const b = this.backends.get(name);
        if (b) { try { await b.disconnect(); } catch {} this.backends.delete(name); }
        this.failures.delete(name);
        continue;
      }
      if (newServer.enabled === false) {
        this.clearRetry(name);
        const b = this.backends.get(name);
        if (b) { try { await b.disconnect(); } catch {} this.backends.delete(name); }
        this.failures.delete(name);
        console.log(`Skipping disabled backend "${name}"`);
        continue;
      }
      if (oldServer && JSON.stringify(oldServer) === JSON.stringify(newServer)) continue;
      this.clearRetry(name);
      const existing = this.backends.get(name);
      if (existing) { try { await existing.disconnect(); } catch {} this.backends.delete(name); }
      try {
        const backend = this.createBackend(name, newServer);
        await backend.connect();
        this.attachDeathHook(name, backend, newServer);
        this.backends.set(name, backend);
        this.failures.delete(name);
        this.retryAttempts.delete(name);
        console.log(`Reconnected backend "${name}"`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.failures.set(name, { type: newServer.type, error: msg });
        console.error(`Failed to connect backend "${name}":`, msg);
        this.scheduleRetry(name, newServer);
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
