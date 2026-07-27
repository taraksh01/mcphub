import { readFileSync, writeFileSync, mkdirSync, watch } from "fs";
import { dirname, join } from "path";
import { HubConfig, McpServerConfig } from "./types.js";

const DEFAULT_CONFIG: HubConfig = {
  port: 5431,
  mcpServers: {},
};

function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(process.env.HOME!, ".config");
  const newPath = join(xdg, "mcphub", "config.json");
  const oldPath = join(process.env.HOME!, "dev/mcp-hub/config.json");
  try {
    readFileSync(newPath);
  } catch {
    try {
      readFileSync(oldPath);
      return oldPath;
    } catch {}
  }
  return newPath;
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
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
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
