# mcphub

**Single MCP gateway for all your AI coding CLIs.**

Instead of configuring every CLI (OpenCode, Claude Code, Cursor, Zed, Pi) with its own MCP server setup, run one hub and point them all at a single URL.

```sh
npm install -g @taraksh011/mcphub
mcphub add my-server --stdio "npx -y some-mcp-server"
mcphub start
```

All tools from all servers appear under `http://localhost:5431/mcp`.

---

## Quick Start

```bash
# 1. Install
npm install -g @taraksh011/mcphub

# 2. Add your first server (e.g., filesystem access)
mcphub add filesystem --stdio "npx -y @modelcontextprotocol/server-filesystem /tmp"

# 3. Start the hub
mcphub start

# 4. Configure your CLI to use http://localhost:5431/mcp
```

That's it! Your CLI now has access to all tools from all configured servers.

---

## Installation

### Global Install (Recommended)

```bash
npm install -g @taraksh011/mcphub
mcphub --help
```

### Run Without Installing

```bash
npx @taraksh011/mcphub <command>
```

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Hub** | Single HTTP/SSE endpoint that aggregates multiple MCP servers |
| **Backend** | An MCP server (stdio or HTTP) connected to the hub |
| **Tool** | Individual capability from a backend (namespaced as `backend:tool`) |
| **Config** | JSON file at `~/.config/mcphub/config.json` |

---

## Adding MCP Servers

### Stdio Servers (Run as Child Processes)

```bash
# Basic
mcphub add filesystem --stdio "npx -y @modelcontextprotocol/server-filesystem /tmp"

# With environment variables
mcphub add github --stdio "npx -y @modelcontextprotocol/server-github" -e GITHUB_TOKEN=xxx

# Custom working directory
mcphub add my-tools --stdio "npx -y @my/mcp-server" --cwd /path/to/project
```

### HTTP Servers (Remote)

```bash
# Public server
mcphub add context7 --url https://mcp.context7.com/mcp

# Private server
mcphub add internal --url https://mcp.internal.company.com/mcp
```

### List & Manage Servers

```bash
mcphub list              # Show all configured servers
mcphub disable github    # Disable without removing
mcphub enable github     # Re-enable
mcphub remove old-server # Remove completely
```

---

## Running the Hub

### Foreground (Development)

```bash
mcphub start
# Listens on http://127.0.0.1:5431/mcp
```

### Background Daemon

```bash
mcphub start --daemon
# Runs in background, logs to ~/.config/mcphub/hub.log
```

### Custom Port / Host

```bash
mcphub start --port 8080
mcphub start --host 0.0.0.0  # ⚠️ Exposes all tools without auth - trusted networks only
```

### Status & Health

```bash
mcphub status              # Shows PID, port, host, server list
curl http://localhost:5431/health  # JSON health check
```

---

## Boot-Time Service (Auto-Start)

MCP Hub can run as a background service so it starts automatically. By default
it installs **per-user** (no `sudo` required); pass `--system` for a system-wide
install that requires root.

### Per-User Install (Default — no sudo)

```bash
mcphub install-service
# Writes ~/.config/systemd/user/mcphub.service; starts at your login
```

The service starts when you log in. To start it at boot without logging in
(Linux), enable lingering once:

```bash
loginctl enable-linger $USER
```

### System-Wide Install (requires sudo)

```bash
mcphub install-service --system
# Writes /etc/systemd/system/mcphub.service, runs as your user via User=
```

### Version Pinning

```bash
mcphub install-service --pin-version           # per-user, pinned
mcphub install-service --system --pin-version # system-wide, pinned
```

| Mode | Behavior | Best For |
|------|----------|----------|
| **Default (auto-update, per-user)** | Uses `~/.local/share/pnpm/bin/mcphub` shim. Picks up new versions on restart. No root needed. | Daily use, always want latest |
| **`--pin-version`** | Uses absolute `node` + script path. Stays on exact version until you re-run `install-service`. | CI/CD, reproducible deploys |
| **`--system`** | Installs system-wide under `/etc/systemd/system` (needs `sudo`). | Shared machines, boot before login |

### Check Status

```bash
systemctl --user status mcphub    # per-user (Linux)
systemctl status mcphub           # system-wide (Linux)
launchctl list | grep mcphub      # macOS
```

### Uninstall

```bash
mcphub uninstall-service           # per-user
mcphub uninstall-service --system  # system-wide (needs sudo)
```

---

## Per-Tool Control

Hide individual tools without removing the whole server:

```bash
mcphub tools                    # List all tools with disabled state
mcphub tools disable github create_issue
mcphub tools enable github create_issue
```

Disabled tools:
- Show `[disabled]` in `mcphub tools`
- Are filtered from `tools/list` RPC
- Return error if called directly

---

## OAuth-Protected HTTP Servers

Some servers (e.g., Cloudflare) require OAuth:

```bash
mcphub add cloudflare --url https://mcp.cloudflare.com/mcp
mcphub auth cloudflare
```

Flow: RFC 9728 discovery → dynamic client registration → browser consent on `http://localhost:8765/callback` → tokens saved to `~/.config/mcphub/tokens/<name>.json`.

---

## Configuring Your CLI

All CLIs connect to `http://localhost:5431/mcp`.

### OpenCode

`~/.config/opencode/opencode.jsonc`:
```json
{
  "mcp": {
    "MCPHub": {
      "type": "remote",
      "url": "http://localhost:5431/mcp"
    }
  }
}
```

### Pi (Terminal AI)

`~/.pi/agent/mcp.json`:
```json
{
  "mcpServers": {
    "MCPHub": { "url": "http://localhost:5431/mcp" }
  }
}
```

### Claude Code

```bash
claude mcp add --transport http mcphub http://localhost:5431/mcp
```

### Cursor

`.cursor/mcp.json` in your project:
```json
{
  "mcpServers": {
    "MCPHub": { "type": "http", "url": "http://localhost:5431/mcp" }
  }
}
```

### Zed

`~/.config/zed/settings.json`:
```json
{
  "mcp_servers": {
    "MCPHub": { "url": "http://localhost:5431/mcp" }
  }
}
```

---

## Config File

Location:
- **Linux**: `~/.config/mcphub/config.json`
- **macOS**: `~/Library/Application Support/mcphub/config.json`
- **Windows**: `%APPDATA%\mcphub\config.json`

Override with `--config`:
```bash
mcphub --config /path/to/config.json start
```

Or set `MCPHUB_CONFIG` env var.

### Example Config

```json
{
  "port": 5431,
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "enabled": true
    },
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "xxx" }
    },
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

**HTTP server options:**

- `url` — MCP Streamable HTTP endpoint.
- `heartbeatMs` — *(optional)* when set, mcphub sends a `ping` every `heartbeatMs` ms to keep the backend session alive. Useful when the server enforces a short idle timeout (mcphub automatically reconnects and retries if a session still expires).

---

## Shell Environment Variables

API keys from your shell rc files work under systemd too. `mcphub` loads `export KEY=VALUE` lines from:
- `~/.bashrc`
- `~/.zshrc`
- `~/.profile`

Variables already set in the environment take precedence.

```bash
# In ~/.bashrc or ~/.zshrc
export GITHUB_TOKEN="ghp_xxx"
export ANTHROPIC_API_KEY="sk-xxx"
```

---

## CLI Reference

```
Usage: mcphub [options] [command]

Options:
  -V, --version           Output version number
  -c, --config <path>     Config file path
  -h, --help              Display help for command

Commands:
  start [options]         Start the MCP Hub
    -p, --port <port>     Port number (default: 5431)
    --host <host>         Host to bind (default: 127.0.0.1)
    -d, --daemon          Run as daemon

  stop                    Stop the hub daemon
  restart [options]       Restart the hub daemon (background)

  add [options] <name>    Add a server
    --stdio <command>     Command for stdio server
    --url <url>           URL for HTTP server
    -e, --env <env...>    Environment variables (KEY=VALUE)
    --cwd <path>          Working directory (stdio only)

  remove <name>           Remove a server
  list                    List configured servers
  enable <names...>       Enable servers
  disable <names...>      Disable servers

  tools                   List all tools across servers
  tools disable <server> <tool>   Disable a tool
  tools enable <server> <tool>    Enable a tool

  status                  Show hub status (PID, port, servers)
  auth <name>             Authenticate OAuth-protected HTTP server
  config                  Show config file path

  install-service [--pin-version] [--system]   Install as boot-time service (per-user default; --system for system-wide)
  uninstall-service [--system]                 Remove boot-time service (--system for system-wide)
```

---

## Troubleshooting

### Service Won't Start

```bash
# Check logs
journalctl --user -u mcphub -f   # per-user (Linux)
journalctl -u mcphub -f          # system-wide (Linux)
tail -f ~/.config/mcphub/hub.log # Daemon mode

# Verify binary
mcphub --version
which mcphub
```

> Per-user installs only run inside your login session. If the service
> doesn't start at boot, enable lingering once: `loginctl enable-linger $USER`.

### Port Already in Use

```bash
mcphub stop
# Or change port
mcphub start --port 5432
```

### Server Shows as Failed

```bash
mcphub status
# Check the "Failed backends" section
# Common issues: wrong URL, missing env vars, network unreachable
```

---

## Links

- **MCP Protocol**: https://modelcontextprotocol.io
- **Issues**: https://github.com/taraksh01/mcphub/issues
- **Source**: https://github.com/taraksh01/mcphub