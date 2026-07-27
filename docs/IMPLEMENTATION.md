# MCP Hub Implementation Plan

## Goal

Build a single HTTP/SSE gateway that aggregates multiple MCP servers, so all CLIs connect to one URL instead of managing separate configs.

---

## Phase 1: Core (Minimum Viable Hub)

### 1.1 Project Setup

**Files to create:**
- `package.json`
- `tsconfig.json`
- `.gitignore`
- `src/index.ts`

**Steps:**
1. Initialize project with `pnpm init`
2. Install dependencies:
   ```bash
   pnpm add @modelcontextprotocol/sdk commander
   pnpm add -D typescript @types/node
   ```
3. Create `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "Node16",
       "moduleResolution": "Node16",
       "outDir": "dist",
       "rootDir": "src",
       "strict": true,
       "esModuleInterop": true,
       "skipLibCheck": true
     },
     "include": ["src"]
   }
   ```
4. Add scripts to `package.json`:
   ```json
   "scripts": {
     "build": "tsc",
     "start": "node dist/index.js"
   }
   ```
5. Create `.gitignore`:
   ```
   node_modules/
   dist/
   config.json
   hub.pid
   *.log
   ```
6. Initialize git:
   ```bash
   git init
   git add -A
   git commit -m "feat: initial scaffold"
   ```

### 1.2 Types

**File to create:** `src/types.ts`

```typescript
export interface McpServerConfig {
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface HubConfig {
  port: number;
  mcpServers: Record<string, McpServerConfig>;
}

export interface ServerStatus {
  name: string;
  type: "stdio" | "http";
  status: "connected" | "disconnected" | "error";
  error?: string;
  tools: string[];
}
```

### 1.3 Config Manager

**File to create:** `src/config.ts`

**Implementation:**
```typescript
import { readFileSync, writeFileSync, watch } from "fs";
import { join } from "path";
import { HubConfig } from "./types.js";

const DEFAULT_CONFIG: HubConfig = {
  port: 5431,
  mcpServers: {},
};

const CONFIG_PATH = join(process.env.HOME!, "dev/mcp-hub/config.json");

export class ConfigManager {
  private config: HubConfig;
  private watcher: ReturnType<typeof watch> | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.config = this.load();
  }

  private load(): HubConfig {
    try {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_CONFIG;
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
```

### 1.4 Stdio Backend

**File to create:** `src/backends/stdio.ts`

**Implementation:**
```typescript
import { spawn, ChildProcess } from "child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServerConfig } from "../types.js";

export class StdioBackend {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private process: ChildProcess | null = null;

  constructor(private name: string, private config: McpServerConfig) {
    this.client = new Client({ name: `mcp-hub-${name}`, version: "1.0.0" });
  }

  async connect(): Promise<void> {
    if (!this.config.command) throw new Error("No command specified");

    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args || [],
      env: { ...process.env, ...this.config.env },
    });

    await this.client.connect(this.transport);
  }

  async disconnect(): Promise<void> {
    await this.client.close();
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  getClient(): Client {
    return this.client;
  }

  async getTools(): Promise<Array<{ name: string; description?: string }>> {
    const { tools } = await this.client.listTools();
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({ name, arguments: args });
  }
}
```

### 1.5 MCP Client Manager

**File to create:** `src/backends/manager.ts`

```typescript
import { StdioBackend } from "./stdio.js";
import { McpServerConfig, ServerStatus } from "../types.js";

export class McpClientManager {
  private backends: Map<string, StdioBackend> = new Map();

  async connectAll(servers: Record<string, McpServerConfig>): Promise<void> {
    const results = await Promise.allSettled(
      Object.entries(servers).map(async ([name, config]) => {
        if (config.type === "stdio") {
          const backend = new StdioBackend(name, config);
          await backend.connect();
          this.backends.set(name, backend);
        }
      })
    );

    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`Failed to connect backend ${Object.keys(servers)[i]}:`, r.reason);
      }
    });
  }

  async disconnectAll(): Promise<void> {
    for (const backend of this.backends.values()) {
      await backend.disconnect();
    }
    this.backends.clear();
  }

  getStatus(): ServerStatus[] {
    return Array.from(this.backends.entries()).map(([name, backend]) => ({
      name,
      type: "stdio" as const,
      status: "connected" as const,
      tools: [], // Populated separately
    }));
  }

  getBackend(name: string): StdioBackend | undefined {
    return this.backends.get(name);
  }

  async reconnect(name: string, config: McpServerConfig): Promise<void> {
    const existing = this.backends.get(name);
    if (existing) {
      await existing.disconnect();
      this.backends.delete(name);
    }

    if (config.type === "stdio") {
      const backend = new StdioBackend(name, config);
      await backend.connect();
      this.backends.set(name, backend);
    }
  }
}
```

### 1.6 Tool Aggregation

**File to create:** `src/tools.ts`

```typescript
import { McpClientManager } from "./backends/manager.js";

export interface NamespacedTool {
  name: string; // e.g., "github:create_issue"
  originalName: string; // e.g., "create_issue"
  backend: string; // e.g., "github"
  description?: string;
}

export class ToolAggregator {
  constructor(private manager: McpClientManager) {}

  async getAllTools(): Promise<NamespacedTool[]> {
    const tools: NamespacedTool[] = [];
    const status = this.manager.getStatus();

    for (const server of status) {
      const backend = this.manager.getBackend(server.name);
      if (!backend) continue;

      const backendTools = await backend.getTools();
      for (const tool of backendTools) {
        tools.push({
          name: `${server.name}:${tool.name}`,
          originalName: tool.name,
          backend: server.name,
          description: tool.description,
        });
      }
    }

    return tools;
  }

  async callTool(namespacedName: string, args: Record<string, unknown>): Promise<unknown> {
    const [backendName, ...toolParts] = namespacedName.split(":");
    const toolName = toolParts.join(":");

    const backend = this.manager.getBackend(backendName);
    if (!backend) {
      throw new Error(`Backend "${backendName}" not connected`);
    }

    return backend.callTool(toolName, args);
  }
}
```

### 1.7 MCP Server (HTTP Transport)

**File to create:** `src/server.ts`

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpClientManager } from "./backends/manager.js";
import { ToolAggregator } from "./tools.js";

export class McpHubServer {
  private server: Server;
  private transport: StreamableHTTPServerTransport | null = null;

  constructor(
    private manager: McpClientManager,
    private aggregator: ToolAggregator
  ) {
    this.server = new Server(
      { name: "mcp-hub", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler("tools/list", async () => {
      const tools = await this.aggregator.getAllTools();
      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description || `Tool from ${t.backend}`,
          inputSchema: { type: "object", properties: {} }, // Simplified
        })),
      };
    });

    this.server.setRequestHandler("tools/call", async (request) => {
      const { name, arguments: args } = request.params;
      const result = await this.aggregator.callTool(name, args || {});
      return result;
    });
  }

  async start(port: number): Promise<void> {
    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless for simplicity
    });

    await this.server.connect(this.transport);

    // Create HTTP server to handle requests
    const http = await import("http");
    const httpServer = http.createServer(async (req, res) => {
      // Handle MCP protocol messages
      if (req.method === "POST" && req.url === "/mcp") {
        // Parse and handle MCP message
        const body = await this.readBody(req);
        const response = await this.transport!.handleRequest(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      }
    });

    httpServer.listen(port, () => {
      console.log(`MCP Hub running on http://localhost:${port}/mcp`);
    });
  }

  private async readBody(req: any): Promise<any> {
    return new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => resolve(JSON.parse(body)));
    });
  }
}
```

### 1.8 CLI Entry Point

**File to create:** `src/index.ts`

```typescript
import { Command } from "commander";
import { ConfigManager } from "./config.js";
import { McpClientManager } from "./backends/manager.js";
import { ToolAggregator } from "./tools.js";
import { McpHubServer } from "./server.js";

const program = new Command();
const config = new ConfigManager();

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
    const port = options.port || cfg.port || 5431;

    const manager = new McpClientManager();
    await manager.connectAll(cfg.mcpServers);

    const aggregator = new ToolAggregator(manager);
    const server = new McpHubServer(manager, aggregator);
    await server.start(port);
  });

program
  .command("add <name>")
  .description("Add a server")
  .option("--stdio <command>", "Command for stdio server")
  .option("--url <url>", "URL for HTTP server")
  .option("-e, --env <env...>", "Environment variables (KEY=VALUE)")
  .action((name, options) => {
    const env: Record<string, string> = {};
    if (options.env) {
      for (const e of options.env) {
        const [key, value] = e.split("=");
        env[key] = value;
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
    } else if (options.url) {
      config.updateServer(name, { type: "http", url: options.url });
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
    const servers = Object.entries(cfg.mcpServers);
    if (servers.length === 0) {
      console.log("No servers configured");
      return;
    }
    servers.forEach(([name, server]) => {
      console.log(`${name}: ${server.type} ${server.command || server.url}`);
    });
  });

program.parse();
```

---

## Phase 2: HTTP Backends + Hot-Reload

### 2.1 HTTP Backend

**File to create:** `src/backends/http.ts`

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServerConfig } from "../types.js";

export class HttpBackend {
  private client: Client;
  private transport: StreamableHTTPClientTransport | null = null;

  constructor(private name: string, private config: McpServerConfig) {
    this.client = new Client({ name: `mcp-hub-${name}`, version: "1.0.0" });
  }

  async connect(): Promise<void> {
    if (!this.config.url) throw new Error("No URL specified");

    this.transport = new StreamableHTTPClientTransport(
      new URL(this.config.url)
    );

    await this.client.connect(this.transport);
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  getClient(): Client {
    return this.client;
  }

  async getTools(): Promise<Array<{ name: string; description?: string }>> {
    const { tools } = await this.client.listTools();
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({ name, arguments: args });
  }
}
```

### 2.2 Update McpClientManager

**Modify:** `src/backends/manager.ts`

Add HTTP backend support:
```typescript
import { HttpBackend } from "./http.js";

// In connectAll method:
if (config.type === "http") {
  const backend = new HttpBackend(name, config);
  await backend.connect();
  this.backends.set(name, backend);
}
```

Change `backends` Map type to accept both:
```typescript
private backends: Map<string, StdioBackend | HttpBackend> = new Map();
```

### 2.3 Hot-Reload

**Modify:** `src/config.ts`

Add hot-reload in ConfigManager:
```typescript
startWatching(callback: (config: HubConfig) => void): void {
  this.watcher = watch(CONFIG_PATH, () => {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.config = this.load();
      callback(this.config);
    }, 500);
  });
}
```

**Modify:** `src/index.ts`

In the `start` command, add hot-reload handling:
```typescript
config.startWatching(async (newConfig) => {
  console.log("Config changed, reconnecting backends...");
  await manager.disconnectAll();
  await manager.connectAll(newConfig.mcpServers);
});
```

### 2.4 Status Command

**Add to `src/index.ts`:**
```typescript
program
  .command("status")
  .description("Show hub status")
  .action(() => {
    console.log("MCP Hub Status:");
    console.log(`Port: ${config.get().port}`);
    console.log("Backends:");
    manager.getStatus().forEach((s) => {
      console.log(`  ${s.name}: ${s.status} (${s.tools.length} tools)`);
    });
  });
```

---

## Phase 3: Polish

### 3.1 Daemon Mode

**Modify:** `src/index.ts`

Add PID file management:
```typescript
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

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
```

Update `start` command:
```typescript
if (options.daemon) {
  // Fork process
  const { fork } = await import("child_process");
  const child = fork(process.argv[1], ["start", "--port", String(port)], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  writePid();
  console.log(`Hub started as daemon (PID: ${child.pid})`);
} else {
  writePid();
  // ... normal start
}
```

### 3.2 Stop Command

**Add to `src/index.ts`:**
```typescript
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
      process.kill(pid);
      removePid();
      console.log(`Hub stopped (PID: ${pid})`);
    } catch (e) {
      console.error("Failed to stop hub:", e);
      removePid();
    }
  });
```

### 3.3 Auto-Reconnect

**Modify:** `src/backends/manager.ts`

Add reconnect logic:
```typescript
private async reconnectWithBackoff(
  name: string,
  config: McpServerConfig,
  attempt = 0
): Promise<void> {
  const delay = Math.min(1000 * Math.pow(2, attempt), 30000);

  try {
    await this.reconnect(name, config);
    console.log(`Reconnected ${name}`);
  } catch (e) {
    console.log(`Reconnect failed for ${name}, retrying in ${delay}ms...`);
    setTimeout(() => {
      this.reconnectWithBackoff(name, config, attempt + 1);
    }, delay);
  }
}
```

### 3.4 Config Command

**Add to `src/index.ts`:**
```typescript
program
  .command("config")
  .description("Show config path")
  .action(() => {
    console.log(`Config: ~/dev/mcp-hub/config.json`);
  });
```

---

## Testing & Verification

### Phase 1
1. Create a test config with one stdio server
2. Run `mcp-hub start`
3. Verify tools are listed with namespace prefix
4. Run `mcp-hub list` to see configured servers

### Phase 2
1. Add HTTP server to config
2. Run `mcp-hub start`
3. Modify config while hub is running
4. Verify hot-reload reconnects new backends

### Phase 3
1. Run `mcp-hub start --daemon`
2. Verify PID file created
3. Run `mcp-hub status`
4. Run `mcp-hub stop`
5. Kill a backend process, verify auto-reconnect

---

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0"
  }
}
```
