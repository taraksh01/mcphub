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
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.error("Config file has invalid JSON, using defaults");
      }
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
