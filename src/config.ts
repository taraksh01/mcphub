import { readFileSync, writeFileSync, mkdirSync, watch } from "fs";
import { dirname, join } from "path";
import { HubConfig, McpServerConfig } from "./types.js";

const DEFAULT_CONFIG: HubConfig = {
  port: 5431,
  mcpServers: {},
};

function defaultConfigPath(): string {
  let base: string;
  if (process.platform === "win32") {
    base = process.env.APPDATA || join(process.env.USERPROFILE!, "AppData", "Roaming");
  } else if (process.platform === "darwin") {
    base = join(process.env.HOME!, "Library", "Application Support");
  } else {
    base = process.env.XDG_CONFIG_HOME || join(process.env.HOME!, ".config");
  }
  return join(base, "mcphub", "config.json");
}

export class ConfigManager {
  private config: HubConfig;
  private configPath: string;
  private watcher: ReturnType<typeof watch> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(configPath?: string) {
    this.configPath = configPath || process.env.MCPHUB_CONFIG || defaultConfigPath();
    this.config = this.load();
  }

  private load(): HubConfig {
    try {
      const raw = readFileSync(this.configPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("config must be a JSON object");
      }
      const merged = { ...DEFAULT_CONFIG, ...(parsed as Partial<HubConfig>) };
      if (typeof merged.port !== "number") {
        throw new Error('"port" must be a number');
      }
      const mcpServers = merged.mcpServers;
      if (typeof mcpServers !== "object" || mcpServers === null || Array.isArray(mcpServers)) {
        throw new Error('"mcpServers" must be an object');
      }
      for (const [name, server] of Object.entries(mcpServers)) {
        if (typeof server !== "object" || server === null ||
            (server.type !== "stdio" && server.type !== "http")) {
          throw new Error(`invalid server entry "${name}"`);
        }
      }
      return merged;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Config file "${this.configPath}" is invalid (${msg}), using defaults`);
      return { ...DEFAULT_CONFIG };
    }
  }

  get(): HubConfig {
    return this.config;
  }

  save(): void {
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  updateServer(name: string, server: McpServerConfig): void {
    this.config.mcpServers[name] = server;
    this.save();
  }

  removeServer(name: string): void {
    delete this.config.mcpServers[name];
    this.save();
  }

  setEnabled(name: string, enabled: boolean): boolean {
    const server = this.config.mcpServers[name];
    if (!server) return false;
    server.enabled = enabled;
    this.save();
    return true;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  startWatching(callback: (config: HubConfig) => void): void {
    this.watcher = watch(this.configPath, () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.config = this.load();
        callback(this.config);
      }, 500);
    });
  }

  stopWatching(): void {
    this.watcher?.close();
  }
}
