import { execSync } from "child_process";
import { McpServerConfig, IBackend } from "../types.js";
import { StdioBackend } from "./stdio.js";
import { HttpBackend } from "./http.js";

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

export class McpClientManager {
  private backends: Map<string, IBackend> = new Map();
  private failures: Map<string, { type: "stdio" | "http"; error: string }> = new Map();
  private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private retryAttempts: Map<string, number> = new Map();
  private static readonly RETRY_DELAYS_MS = [5000, 10000, 20000];
  private displayWatcher?: ReturnType<typeof setInterval>;
  private hadDisplay = false;
  private watchedServers: Record<string, McpServerConfig> = {};

  private hasDisplay(): boolean {
    if (process.platform !== "linux") return !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
    try {
      const out = execSync("systemctl --user show-environment 2>/dev/null", { encoding: "utf-8" });
      return out.split("\n").some((l) => (l.startsWith("DISPLAY=") && !!l.split("=")[1]) || (l.startsWith("WAYLAND_DISPLAY=") && !!l.split("=")[1]));
    } catch {
      return !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
    }
  }

  private startDisplayWatcher(): void {
    if (process.platform !== "linux" || this.displayWatcher) return;
    this.hadDisplay = this.hasDisplay();
    this.displayWatcher = setInterval(async () => {
      const now = this.hasDisplay();
      if (!this.hadDisplay && now) {
        this.hadDisplay = true;
        for (const [name, cfg] of Object.entries(this.watchedServers)) {
          if (cfg.enabled === false || cfg.type !== "stdio") continue;
          if (!["chrome-devtools", "playwright", "agent-browser", "open-design", "chrome"].some((k) => name.includes(k))) continue;
          const existing = this.backends.get(name);
          if (!existing) continue;
          try { await existing.disconnect(); } catch {}
          this.backends.delete(name);
          try {
            const backend = this.createBackend(name, cfg);
            await backend.connect();
            this.attachDeathHook(name, backend, cfg);
            this.backends.set(name, backend);
            this.failures.delete(name);
            console.log(`[mcphub] display available, reconnected "${name}" headed`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.failures.set(name, { type: "stdio", error: msg });
            this.scheduleRetry(name, cfg);
          }
        }
      } else if (this.hadDisplay && !now) {
        this.hadDisplay = now;
      }
    }, 10000);
    if (this.displayWatcher.unref) this.displayWatcher.unref();
  }

  private stopDisplayWatcher(): void {
    if (this.displayWatcher) { clearInterval(this.displayWatcher); this.displayWatcher = undefined; }
  }

  async connectAll(servers: Record<string, McpServerConfig>): Promise<void> {
    const entries = Object.entries(servers);
    if (entries.length === 0) {
      this.watchedServers = { ...servers };
      this.startDisplayWatcher();
      return;
    }

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
    this.watchedServers = { ...servers };
    this.startDisplayWatcher();
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
    this.stopDisplayWatcher();
    this.watchedServers = {};
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
if (oldServer && deepEqual(oldServer, newServer)) continue;
      // Only disabledTools changed → no reconnect needed (filtered at list/call time)
      if (oldServer &&
          !deepEqual(oldServer, newServer) &&
          McpClientManager.serversEquivalentExceptTools(oldServer, newServer)) {
        console.log(`Updated disabled tools for backend "${name}" (no reconnect needed)`);
        continue;
}
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
    this.watchedServers = { ...newServers };
  }

  getBackend(name: string): IBackend | undefined {
    return this.backends.get(name);
  }

  getAllBackends(): IBackend[] {
    return Array.from(this.backends.values());
  }

  private static serversEquivalentExceptTools(
    a: McpServerConfig,
    b: McpServerConfig
  ): boolean {
    const strip = (s: McpServerConfig) => {
      const { disabledTools: _dt, ...rest } = s;
      return JSON.stringify(rest);
    };
    return strip(a) === strip(b);
  }

  getFailures(): { name: string; type: "stdio" | "http"; error: string }[] {
    return Array.from(this.failures.entries()).map(([name, f]) => ({ name, ...f }));
  }
}
