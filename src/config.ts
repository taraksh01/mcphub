import { readFileSync, writeFileSync, watch } from "fs";
import { join } from "path";
import { HubConfig, McpServerConfig } from "./types.js";

const DEFAULT_CONFIG: HubConfig = {
  port: 5431,
  mcpServers: {},
};

const CONFIG_PATH = join(
  process.env.HOME!,
  "dev/mcp-hub/config.json"
);

export class ConfigManager {
  private config: HubConfig;
  private watcher: ReturnType<typeof watch> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.config = this.load();
  }

  private load(): HubConfig {
    try {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  get(): HubConfig {
    return this.config;
  }

  save(): void {
    writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
  }

  updateServer(name: string, server: McpServerConfig): void {
    this.config.mcpServers[name] = server;
    this.save();
  }

  removeServer(name: string): void {
    delete this.config.mcpServers[name];
    this.save();
  }

  getConfigPath(): string {
    return CONFIG_PATH;
  }

  startWatching(callback: (config: HubConfig) => void): void {
    this.watcher = watch(CONFIG_PATH, () => {
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
