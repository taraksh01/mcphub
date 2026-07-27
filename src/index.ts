#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { ConfigManager } from "./config.js";
import { McpClientManager } from "./backends/manager.js";
import { ToolAggregator } from "./tools.js";
import { McpHubServer } from "./server.js";

const program = new Command();
const config = new ConfigManager();

const PID_FILE = join(process.env.HOME!, "dev/mcp-hub/hub.pid");

function writePid(): void {
  writeFileSync(PID_FILE, process.pid.toString());
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  return parseInt(readFileSync(PID_FILE, "utf-8"));
}

function removePid(): void {
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
}

program
  .name("mcp-hub")
  .description("MCP Hub - single gateway for all MCP servers")
  .version("1.0.0");

program
  .command("start")
  .description("Start the MCP Hub")
  .option("-p, --port <port>", "Port number", parseInt)
  .option("-d, --daemon", "Run as daemon")
  .action(async (options) => {
    const cfg = config.get();
    const port = options.port ?? cfg.port ?? 5431;

    if (options.daemon) {
      const { fork } = await import("child_process");
      const child = fork(process.argv[1], ["start", "--port", String(port)], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      writeFileSync(PID_FILE, String(child.pid));
      console.log(`Hub started as daemon (PID: ${child.pid})`);
      process.exit(0);
    }

    const manager = new McpClientManager();
    await manager.connectAll(cfg.mcpServers);

    const aggregator = new ToolAggregator(manager);
    const server = new McpHubServer(manager, aggregator);
    await server.start(port);

    writePid();

    config.startWatching(async (newConfig) => {
      console.log("\nConfig changed, reconnecting backends...");
      await manager.disconnectAll();
      await manager.connectAll(newConfig.mcpServers);
    });

    process.on("SIGINT", async () => {
      console.log("\nShutting down...");
      config.stopWatching();
      removePid();
      await server.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      config.stopWatching();
      removePid();
      await server.stop();
      process.exit(0);
    });
  });

program
  .command("stop")
  .description("Stop the hub daemon")
  .action(() => {
    const pid = readPid();
    if (!pid) {
      console.log("Hub not running");
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
      removePid();
      console.log(`Hub stopped (PID: ${pid})`);
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
    if (!options.stdio && !options.url) {
      console.error("Specify --stdio or --url");
      process.exit(1);
    }

    const env: Record<string, string> = {};
    if (options.env) {
      for (const e of options.env) {
        const idx = e.indexOf("=");
        if (idx === -1) {
          console.error(`Invalid env format: "${e}". Use KEY=VALUE`);
          process.exit(1);
        }
        env[e.slice(0, idx)] = e.slice(idx + 1);
      }
    }

    if (options.stdio) {
      const parts = options.stdio.split(" ");
      config.updateServer(name, {
        type: "stdio",
        command: parts[0],
        args: parts.slice(1),
        env: Object.keys(env).length > 0 ? env : undefined,
      });
    } else {
      config.updateServer(name, {
        type: "http",
        url: options.url,
      });
    }

    console.log(`Added server: ${name}`);
  });

program
  .command("remove <name>")
  .description("Remove a server")
  .action((name) => {
    config.removeServer(name);
    console.log(`Removed server: ${name}`);
  });

program
  .command("list")
  .description("List configured servers")
  .action(() => {
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
  });

program
  .command("config")
  .description("Show config path")
  .action(() => {
    console.log(config.getConfigPath());
  });

program.parse();
