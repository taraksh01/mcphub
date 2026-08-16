#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, openSync } from "fs";
import { dirname, join } from "path";
import { ConfigManager } from "./config.js";
import { McpClientManager } from "./backends/manager.js";
import { ToolAggregator } from "./tools.js";
import { McphubServer } from "./server.js";
import { VERSION } from "./version.js";
import { installService, uninstallService } from "./service.js";
import { loadShellEnv } from "./shellEnv.js";
import { tokenizeCommand } from "./util.js";
import { OAuthClientProvider } from "./oauth.js";

let config: ConfigManager;

function pidFile(): string {
  return join(dirname(config.getConfigPath()), "hub.pid");
}

function writePid(): void {
  mkdirSync(dirname(pidFile()), { recursive: true });
  writeFileSync(pidFile(), process.pid.toString());
}

function readPid(): number | null {
  const file = pidFile();
  if (!existsSync(file)) return null;
  const pid = parseInt(readFileSync(file, "utf-8"), 10);
  return isNaN(pid) ? null : pid;
}

function removePid(): void {
  const file = pidFile();
  if (existsSync(file)) unlinkSync(file);
}

function runtimeFile(): string {
  return join(dirname(config.getConfigPath()), "hub.runtime.json");
}

function readRuntime(): { port: number; host: string } | null {
  try {
    return JSON.parse(readFileSync(runtimeFile(), "utf-8"));
  } catch {
    return null;
  }
}

function writeRuntime(port: number, host: string): void {
  mkdirSync(dirname(runtimeFile()), { recursive: true });
  writeFileSync(runtimeFile(), JSON.stringify({ port, host }));
}

function removeRuntime(): void {
  const f = runtimeFile();
  if (existsSync(f)) unlinkSync(f);
}

async function stopHub(): Promise<void> {
  config = new ConfigManager(program.opts().config);
  const pid = readPid();
  if (!pid) {
    console.log("Hub not running");
    return;
  }
  let isMcphub = false;
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
    isMcphub = cmdline.includes("mcphub");
  } catch {}
  if (!isMcphub) {
    removePid();
    console.log(`PID ${pid} is not an mcphub process, cleaned up stale PID file`);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      try { process.kill(pid, 0); } catch {
        removePid();
        removeRuntime();
        console.log(`Hub stopped (PID: ${pid})`);
        return;
      }
    }
    console.error("Hub did not stop within 4s, sending SIGKILL");
    process.kill(pid, "SIGKILL");
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 200));
      try { process.kill(pid, 0); } catch {
        removePid();
        removeRuntime();
        console.log(`Hub force-stopped (PID: ${pid})`);
        return;
      }
    }
    removePid();
    removeRuntime();
    console.error("Hub still alive after SIGKILL, removed stale PID file");
  } catch {
    removePid();
    removeRuntime();
    console.log("Hub process not found, cleaned up PID file");
  }
}

async function startDaemon(port: number, host: string): Promise<void> {
  const { fork } = await import("child_process");
  const args = ["start", "--port", String(port), "--host", host];
  const cfgPath = program.opts().config || process.env.MCPHUB_CONFIG;
  if (cfgPath) args.push("--config", cfgPath);
  const hubDir = dirname(config.getConfigPath());
  mkdirSync(hubDir, { recursive: true });
  const logPath = join(hubDir, "hub.log");
  const logFd = openSync(logPath, "a");
  const child = fork(process.argv[1], args, {
    detached: true,
    stdio: ["ignore", logFd, logFd, "ipc"],
  });
  child.unref();
  let childFailed = false;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeAllListeners("message");
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      resolve();
    };
    const timeout = setTimeout(() => {
      console.error("Daemon did not send ready within 5s, proceeding anyway");
      finish();
    }, 5000);
    child.once("message", (msg: { type?: string }) => {
      if (msg?.type === "ready") finish();
      if (msg?.type === "error") { childFailed = true; finish(); }
    });
    child.once("error", finish);
    child.once("exit", finish);
  });
  if (childFailed) {
    console.error("Hub failed to start (check port and config)");
    removePid();
    process.exit(1);
  }
  mkdirSync(hubDir, { recursive: true });
  writeFileSync(pidFile(), String(child.pid));
  writeRuntime(port, host);
  console.log(`Hub started as daemon (PID: ${child.pid}, logs: ${logPath})`);
  process.exit(0);
}

async function listTools(): Promise<void> {
  config = new ConfigManager(program.opts().config);
  const cfg = config.get();
  const manager = new McpClientManager();
  const aggregator = new ToolAggregator(
    manager,
    (name) => cfg.mcpServers[name]?.disabledTools ?? []
  );
  try {
    await manager.connectAll(cfg.mcpServers);
    const tools = await aggregator.getAllTools(true);
    const byBackend = new Map<string, typeof tools>();
    for (const t of tools) {
      const arr = byBackend.get(t.backend) ?? [];
      arr.push(t);
      byBackend.set(t.backend, arr);
    }
    let total = 0;
    for (const [name, server] of Object.entries(cfg.mcpServers)) {
      if (server.enabled === false) continue;
      const list = byBackend.get(name) ?? [];
      const disabledSet = new Set(server.disabledTools ?? []);
      console.log(`[${name}] (${list.length} tools)`);
      for (const t of list) {
        total++;
        console.log(`  ${t.originalName}${disabledSet.has(t.originalName) ? " [disabled]" : ""}`);
      }
    }
    console.log(`Total: ${total} tools`);
  } finally {
    await manager.disconnectAll();
  }
}

const program = new Command();

program
  .name("mcphub")
  .description("mcphub — single gateway for all MCP servers")
  .version(VERSION)
  .option("-c, --config <path>", "Config file path");

program
  .command("start")
  .description("Start the MCP Hub")
  .option("-p, --port <port>", "Port number", parseInt)
  .option("--host <host>", "Host to bind (default 127.0.0.1)")
  .option("-d, --daemon", "Run as daemon")
  .action(async (options) => {
    config = new ConfigManager(program.opts().config);
    const cfg = config.get();
    loadShellEnv();
    const port = options.port ?? cfg.port ?? 5431;
    if (typeof port !== "number" || isNaN(port) || port < 1 || port > 65535) {
      console.error("Port must be a number between 1 and 65535");
      process.exit(1);
    }
    const host = options.host ?? "127.0.0.1";
    if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
      console.warn(`WARNING: binding to ${host} exposes all MCP tools without authentication`);
    }

    if (options.daemon) {
      await startDaemon(port, host);
    }

    const manager = new McpClientManager();
    const aggregator = new ToolAggregator(
      manager,
      (name) => cfg.mcpServers[name]?.disabledTools ?? []
    );
    const server = new McphubServer(aggregator, manager);

    const shutdown = async () => {
      console.log("\nShutting down...");
      config.stopWatching();
      removePid();
      removeRuntime();
      await manager.disconnectAll();
      await server.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await manager.connectAll(cfg.mcpServers);
    try {
      await server.start(port, host);
    } catch (err) {
      if (process.send) {
        try { (process as { send: (m: unknown) => void }).send({ type: "error" }); } catch {}
      }
      throw err;
    }

    writePid();
    writeRuntime(port, host);

    config.startWatching(async (newConfig) => {
      console.log("\nConfig changed, syncing backends...");
      await manager.syncConfig(cfg.mcpServers, newConfig.mcpServers);
      cfg.mcpServers = newConfig.mcpServers;
    });
  });

program
  .command("stop")
  .description("Stop the hub daemon")
  .action(async () => {
    await stopHub();
  });

program
  .command("restart")
  .description("Restart the hub daemon (stops, then starts in the background)")
  .option("-p, --port <port>", "Port number", parseInt)
  .action(async (options) => {
    config = new ConfigManager(program.opts().config);
    const port = options.port ?? config.get().port ?? 5431;
    const pid = readPid();
    const runtime = pid ? readRuntime() : null;
    const host = runtime?.host ?? "127.0.0.1";
    await stopHub();
    await startDaemon(port, host);
  });

program
  .command("add <name>")
  .description("Add a server")
  .option("--stdio <command>", "Command and args for stdio server (e.g. `npx -y @modelcontextprotocol/server-github`)")
  .option("--url <url>", "URL for HTTP server")
  .option("-e, --env <env...>", "Environment variables (KEY=VALUE)")
  .action((name, options) => {
    config = new ConfigManager(program.opts().config);
    if (name.includes(":")) {
      console.error(`Server name must not contain ":": "${name}"`);
      process.exit(1);
    }
    const env: Record<string, string> = {};
    if (options.env) {
      for (const e of options.env) {
        const idx = e.indexOf("=");
        if (idx <= 0) {
          console.error(`Invalid env format: "${e}". Use KEY=VALUE`);
          process.exit(1);
        }
        env[e.slice(0, idx)] = e.slice(idx + 1);
      }
    }

    if (config.get().mcpServers[name]) {
      console.warn(`Server "${name}" already exists, overwriting`);
    }

    if (options.stdio !== undefined && options.url !== undefined) {
      console.error("Specify only one of --stdio or --url");
      process.exit(1);
    }

    if (options.stdio !== undefined) {
      const parts = tokenizeCommand(options.stdio);
      if (!parts[0]) {
        console.error("Command cannot be empty");
        process.exit(1);
      }
      config.updateServer(name, {
        type: "stdio",
        command: parts[0],
        args: parts.slice(1),
        env: Object.keys(env).length > 0 ? env : undefined,
      });
    } else if (options.url !== undefined) {
      try {
        new URL(options.url);
      } catch {
        console.error(`Invalid URL: "${options.url}"`);
        process.exit(1);
      }
      config.updateServer(name, {
        type: "http",
        url: options.url,
      });
    } else {
      console.error("Specify --stdio or --url");
      process.exit(1);
    }

    console.log(`Added server: ${name}`);
  });

program
  .command("remove <name>")
  .description("Remove a server")
  .action((name) => {
    config = new ConfigManager(program.opts().config);
    config.removeServer(name);
    console.log(`Removed server: ${name}`);
  });

program
  .command("disable <names...>")
  .description("Disable servers (keeps config, skips them at start)")
  .action((names: string[]) => {
    config = new ConfigManager(program.opts().config);
    let failed = false;
    for (const name of names) {
      if (!config.setEnabled(name, false)) {
        console.error(`Server "${name}" not found`);
        failed = true;
      } else {
        console.log(`Disabled server: ${name}`);
      }
    }
    if (failed) process.exit(1);
  });

program
  .command("enable <names...>")
  .description("Enable servers")
  .action((names: string[]) => {
    config = new ConfigManager(program.opts().config);
    let failed = false;
    for (const name of names) {
      if (!config.setEnabled(name, true)) {
        console.error(`Server "${name}" not found`);
        failed = true;
      } else {
        console.log(`Enabled server: ${name}`);
      }
    }
    if (failed) process.exit(1);
  });

const toolsCmd = program
  .command("tools")
  .description("List all tools across servers, with disabled state")
  .action(async () => {
    await listTools();
  });

toolsCmd
  .command("disable <server> <tool>")
  .description("Disable an individual tool on a server")
  .action((server: string, tool: string) => {
    config = new ConfigManager(program.opts().config);
    if (!config.setToolDisabled(server, tool, true)) {
      console.error(`Server "${server}" not found`);
      process.exit(1);
    }
    console.log(`Disabled tool: ${server}:${tool}`);
  });

toolsCmd
  .command("enable <server> <tool>")
  .description("Re-enable a disabled tool on a server")
  .action((server: string, tool: string) => {
    config = new ConfigManager(program.opts().config);
    if (!config.setToolDisabled(server, tool, false)) {
      console.error(`Server "${server}" not found`);
      process.exit(1);
    }
    console.log(`Enabled tool: ${server}:${tool}`);
  });

program
  .command("list")
  .description("List configured servers")
  .action(() => {
    config = new ConfigManager(program.opts().config);
    const cfg = config.get();
    const entries = Object.entries(cfg.mcpServers);
    if (entries.length === 0) {
      console.log("No servers configured");
      return;
    }
    for (const [name, server] of entries) {
      const disabledNote = server.enabled === false ? " [disabled]" : "";
      if (server.type === "stdio") {
        const envNote = server.env ? " (with env vars)" : "";
        console.log(`${name}: stdio — ${server.command} ${(server.args ?? []).join(" ")}${envNote}${disabledNote}`);
      } else {
        console.log(`${name}: http — ${server.url}${disabledNote}`);
      }
    }
  });

program
  .command("status")
  .description("Show hub status")
  .action(async () => {
    config = new ConfigManager(program.opts().config);
    const pid = readPid();
    if (!pid) {
      console.log("Hub not running");
      return;
    }
    console.log("Hub is running");
    console.log(`PID: ${pid}`);
    const runtime = readRuntime();
    const port = runtime?.port ?? config.get().port;
    console.log(`Port: ${port}`);
    console.log(`Host: ${runtime?.host ?? "127.0.0.1"}`);
    try {
      process.kill(pid, 0);
    } catch {
      console.log("(Process not found, stale PID file)");
    }
    const entries = Object.entries(config.get().mcpServers);
    if (entries.length > 0) {
      console.log(`Servers (${entries.length}):`);
      for (const [name, server] of entries) {
        const disabledNote = server.enabled === false ? " [disabled]" : "";
        if (server.type === "stdio") {
          const envNote = server.env ? " (with env vars)" : "";
          console.log(`  ${name}: stdio — ${server.command} ${(server.args ?? []).join(" ")}${envNote}${disabledNote}`);
        } else {
          console.log(`  ${name}: http — ${server.url}${disabledNote}`);
        }
      }
      try {
        const health = await fetch(`http://localhost:${port}/health`).then(r => r.json());
        if (health.failures?.length > 0) {
          console.log(`\nFailed backends (${health.failures.length}):`);
          for (const f of health.failures) {
            console.log(`  ${f.name}: ${f.error}`);
          }
        }
      } catch {}
    }
  });

program
  .command("auth <name>")
  .description("Authenticate an OAuth-protected HTTP server")
  .action(async (name) => {
    config = new ConfigManager(program.opts().config);
    const cfg = config.get();
    const server = cfg.mcpServers[name];
    if (!server || server.type !== "http") {
      console.error(`Server "${name}" not found or not an HTTP server`);
      process.exit(1);
    }
    if (!server.url) {
      console.error("Server has no URL");
      process.exit(1);
    }

    const provider = new OAuthClientProvider(name, server.url);
    console.log(`Starting OAuth flow for ${name}...`);
    try {
      const tokens = await provider.startAuthFlow();
      console.log("Authentication successful!");
      console.log(`Access token: ${tokens.access_token.slice(0, 4)}...${tokens.access_token.slice(-4)}`);
      if (tokens.refresh_token) {
        console.log("Refresh token stored for auto-renewal");
      }
      if (readPid()) {
        console.log("Restart the hub (mcphub restart) for it to use the new token");
      }
    } catch (e) {
      console.error("Authentication failed:", String(e));
      process.exit(1);
    }
  });

program
  .command("config")
  .description("Show config path")
  .action(() => {
    config = new ConfigManager(program.opts().config);
    console.log(config.getConfigPath());
  });

program
  .command("install-service")
  .description("Install as a boot-time service (systemd/launchd/schtasks)")
  .action(() => {
    config = new ConfigManager(program.opts().config);
    installService(config);
  });

program
  .command("uninstall-service")
  .description("Remove the boot-time service")
  .action(() => {
    config = new ConfigManager(program.opts().config);
    uninstallService();
  });

program.parse();
