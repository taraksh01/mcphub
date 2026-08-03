#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { ConfigManager } from "./config.js";
import { McpClientManager } from "./backends/manager.js";
import { ToolAggregator } from "./tools.js";
import { McphubServer } from "./server.js";
import { VERSION } from "./version.js";
import { installService, uninstallService } from "./service.js";
import { loadShellEnv } from "./shellEnv.js";

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

    if (options.daemon) {
      const { fork } = await import("child_process");
      const args = ["start", "--port", String(port)];
      const cfgPath = program.opts().config || process.env.MCPHUB_CONFIG;
      if (cfgPath) args.push("--config", cfgPath);
      const child = fork(process.argv[1], args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      mkdirSync(dirname(pidFile()), { recursive: true });
      writeFileSync(pidFile(), String(child.pid));
      console.log(`Hub started as daemon (PID: ${child.pid})`);
      process.exit(0);
    }

    const manager = new McpClientManager();
    const aggregator = new ToolAggregator(manager);
    const server = new McphubServer(aggregator);

    const shutdown = async () => {
      console.log("\nShutting down...");
      config.stopWatching();
      removePid();
      await manager.disconnectAll();
      await server.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await manager.connectAll(cfg.mcpServers);
    await server.start(port);

    writePid();

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
    config = new ConfigManager(program.opts().config);
    const pid = readPid();
    if (!pid) {
      console.log("Hub not running");
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 200));
        try { process.kill(pid, 0); } catch {
          removePid();
          console.log(`Hub stopped (PID: ${pid})`);
          return;
        }
      }
      console.error("Hub did not stop within 4s, force removing PID");
      removePid();
    } catch {
      removePid();
      console.log("Hub process not found, cleaned up PID file");
    }
  });

program
  .command("add <name>")
  .description("Add a server")
  .option("--stdio <command>", "Command and args for stdio server (e.g. `npx -y @modelcontextprotocol/server-github`)")
  .option("--url <url>", "URL for HTTP server")
  .option("-e, --env <env...>", "Environment variables (KEY=VALUE)")
  .action((name, options) => {
    config = new ConfigManager(program.opts().config);
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

    if (options.stdio !== undefined && options.url !== undefined) {
      console.error("Specify only one of --stdio or --url");
      process.exit(1);
    }

    if (options.stdio !== undefined) {
      const parts = options.stdio.trim().split(/\s+/);
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
      if (server.type === "stdio") {
        const envNote = server.env ? " (with env vars)" : "";
        console.log(`${name}: stdio — ${server.command} ${(server.args ?? []).join(" ")}${envNote}`);
      } else {
        console.log(`${name}: http — ${server.url}`);
      }
    }
  });

program
  .command("status")
  .description("Show hub status")
  .action(() => {
    config = new ConfigManager(program.opts().config);
    const pid = readPid();
    if (!pid) {
      console.log("Hub not running");
      return;
    }
    console.log("Hub is running");
    console.log(`PID: ${pid}`);
    console.log(`Port: ${config.get().port}`);
    try {
      process.kill(pid, 0);
    } catch {
      console.log("(Process not found, stale PID file)");
    }
    const entries = Object.entries(config.get().mcpServers);
    if (entries.length > 0) {
      console.log(`Servers (${entries.length}):`);
      for (const [name, server] of entries) {
        if (server.type === "stdio") {
          const envNote = server.env ? " (with env vars)" : "";
          console.log(`  ${name}: stdio — ${server.command} ${(server.args ?? []).join(" ")}${envNote}`);
        } else {
          console.log(`  ${name}: http — ${server.url}`);
        }
      }
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
    uninstallService(config);
  });

program.parse();
