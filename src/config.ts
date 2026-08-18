import { readFileSync, writeFileSync, renameSync, mkdirSync, watch } from "fs";
import { dirname, join, basename } from "path";
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
      return this.parse(readFileSync(this.configPath, "utf-8"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
        console.error(`Config file "${this.configPath}" not found, using defaults`);
        return this.defaultConfig();
      }
      console.error(`Config file "${this.configPath}" is invalid (${msg}), using defaults`);
      return this.defaultConfig();
    }
  }

  reload(): HubConfig | null {
    try {
      return this.parse(readFileSync(this.configPath, "utf-8"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Config file "${this.configPath}" is invalid (${msg}), keeping current config`);
      return null;
    }
  }

  private parse(raw: string): HubConfig {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("config must be a JSON object");
    }
    const merged: HubConfig = { port: DEFAULT_CONFIG.port, mcpServers: {} };
    if (typeof parsed === "object" && parsed !== null) {
      const p = parsed as Partial<HubConfig>;
      if (typeof p.port === "number") merged.port = p.port;
      if (typeof p.mcpServers === "object" && p.mcpServers !== null && !Array.isArray(p.mcpServers)) {
        merged.mcpServers = p.mcpServers;
      }
    }
    if (typeof merged.port !== "number") {
      throw new Error('"port" must be a number');
    }
    const mcpServers = merged.mcpServers;
    if (typeof mcpServers !== "object" || mcpServers === null || Array.isArray(mcpServers)) {
      throw new Error('"mcpServers" must be an object');
    }
    for (const [name, server] of Object.entries(mcpServers)) {
      if (name.includes(":")) {
        throw new Error(`server name "${name}" must not contain ":"`);
      }
      if (typeof server !== "object" || server === null ||
          (server.type !== "stdio" && server.type !== "http")) {
        throw new Error(`invalid server entry "${name}"`);
      }
      if (server.type === "stdio") {
        if (!server.command || typeof server.command !== "string") {
          throw new Error(`server "${name}" (stdio) must have a "command" string`);
        }
      }
      if (server.type === "http") {
        if (!server.url || typeof server.url !== "string") {
          throw new Error(`server "${name}" (http) must have a "url" string`);
        }
        try {
          new URL(server.url);
        } catch {
          throw new Error(`server "${name}" has invalid URL: "${server.url}"`);
        }
      }
      if (server.disabledTools !== undefined &&
          (!Array.isArray(server.disabledTools) ||
           server.disabledTools.some((t) => typeof t !== "string"))) {
        throw new Error(`"disabledTools" of server "${name}" must be an array of strings`);
      }
      if (server.type === "stdio") {
        if (typeof server.command !== "string") {
          throw new Error(`"command" of stdio server "${name}" must be a string`);
        }
        if (server.args !== undefined &&
            (!Array.isArray(server.args) ||
             server.args.some((a) => typeof a !== "string"))) {
          throw new Error(`"args" of server "${name}" must be an array of strings`);
        }
      } else if (server.type === "http") {
        if (typeof server.url !== "string") {
          throw new Error(`"url" of http server "${name}" must be a string`);
        }
      }
      if (server.cwd !== undefined && typeof server.cwd !== "string") {
        throw new Error(`"cwd" of server "${name}" must be a string`);
      }
      if (server.env !== undefined &&
          (typeof server.env !== "object" || server.env === null ||
           Array.isArray(server.env) ||
           Object.values(server.env).some((v) => typeof v !== "string"))) {
        throw new Error(`"env" of server "${name}" must be an object of strings`);
      }
    }
    return merged;
  }

  get(): HubConfig {
    return this.config;
  }

  save(): void {
    mkdirSync(dirname(this.configPath), { recursive: true });
    const tmp = `${this.configPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.config, null, 2));
    renameSync(tmp, this.configPath);
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

  setToolDisabled(name: string, tool: string, disabled: boolean): boolean {
    const server = this.config.mcpServers[name];
    if (!server) return false;
    const list = server.disabledTools ?? [];
    const idx = list.indexOf(tool);
    if (disabled && idx === -1) {
      server.disabledTools = [...list, tool];
      this.save();
    } else if (!disabled && idx !== -1) {
      server.disabledTools = list.filter((t) => t !== tool);
      if (server.disabledTools.length === 0) delete server.disabledTools;
      this.save();
    }
    return true;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  startWatching(callback: (config: HubConfig) => void): void {
    const dir = dirname(this.configPath);
    const base = basename(this.configPath);
    this.watcher = watch(dir, (_event, filename) => {
      if (filename !== base) return;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        const next = this.reload();
        if (!next) return;
        this.config = next;
        callback(this.config);
      }, 500);
    });
    this.watcher.on("error", (err) => {
      console.error("Config watcher error:", err.message);
      this.stopWatching();
    });
  }

  stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.watcher?.close();
    this.watcher = null;
  }

  private defaultConfig(): HubConfig {
    return { port: DEFAULT_CONFIG.port, mcpServers: {} };
  }
}
