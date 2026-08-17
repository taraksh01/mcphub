# mcphub

**Single MCP gateway for all your AI coding CLIs.**

Instead of configuring every CLI (OpenCode, Claude Code, Cursor, Zed, Pi) with its own MCP server setup, run one hub and point them all at a single URL.

```sh
npm install -g @taraksh011/mcphub
mcphub add my-server --stdio "npx -y some-mcp-server"
mcphub start
```

All tools from all servers appear under `http://localhost:5431/mcp`.

## Install

```sh
npm install -g @taraksh011/mcphub
```

Or use directly without installing:

```sh
npx @taraksh011/mcphub <command>
```

## Quick start

```sh
# Add a server
mcphub add filesystem --stdio "npx -y @modelcontextprotocol/server-filesystem /tmp"
mcphub add github --stdio "npx -y @modelcontextprotocol/server-github"

# List configured servers
mcphub list

# Disable servers (keeps config, skips them at start)
mcphub disable some-server another-server

# Re-enable them
mcphub enable some-server another-server

# Authenticate an OAuth-protected HTTP server (opens browser for consent)
mcphub auth cloudflare

# Start the hub (foreground)
mcphub start

# Or run as a daemon
mcphub start --daemon

# Show hub status (PID, port, configured servers)
mcphub status

# Stop the daemon
mcphub stop

# Restart the daemon (stops, then starts in the background)
mcphub restart

# Show config path
mcphub config

# Install as a boot-time service (starts on system boot)
mcphub install-service

# Remove the boot-time service
mcphub uninstall-service
```

The hub listens on `http://localhost:5431/mcp` by default. Override with `--port`:

```sh
mcphub start --port 8080
```

Bind to all interfaces (exposes every tool on the network, unauthenticated — use only on trusted networks):

```sh
mcphub start --host 0.0.0.0
```

A `restart` restores the host the running hub was bound to.

Servers that fail to connect at start are retried automatically at 5s, 10s, and 20s, then given up. If a backend dies after connecting, it is reconnected automatically. Failed backends are shown in `mcphub status` (via `GET /health`).

Health check at `GET /health` returns `{ "status": "ok" }`, plus a `failures` list when any backend is down.

## Configure your CLIs

### OpenCode

Add to `~/.config/opencode/opencode.jsonc`:

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

### Pi (terminal AI)

Add to `~/.pi/agent/mcp.json`:

```json
{
  "mcpServers": {
    "MCPHub": {
      "url": "http://localhost:5431/mcp"
    }
  }
}
```

### Claude Code

```sh
claude mcp add --transport http mcphub http://localhost:5431/mcp
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "MCPHub": {
      "type": "http",
      "url": "http://localhost:5431/mcp"
    }
  }
}
```

### Zed

Add to `~/.config/zed/settings.json`:

```json
{
  "mcp_servers": {
    "MCPHub": {
      "url": "http://localhost:5431/mcp"
    }
  }
}
```

## Add MCP servers

```sh
# Stdio server (runs as a child process)
mcphub add my-tools --stdio "npx -y @some/mcp-server --flag value"

# With environment variables
mcphub add my-tools --stdio "npx -y @some/mcp-server" -e API_KEY=abc -e DEBUG=true

# Remote HTTP server
mcphub add gh_grep --url https://mcp.grep.app
```

Disable a server without removing it by setting `"enabled": false` in the config, or via `mcphub disable <name>` / `mcphub enable <name>` (multiple names accepted). Disabled servers show a `[disabled]` marker in `mcphub list` and `mcphub status`, and are skipped on start — toggling takes effect immediately if the hub is running.

## Per-tool control

Hide individual tools without removing the whole server. Disabled tools are marked `[disabled]` in `mcphub tools` and are filtered out of `tools/list`; calling one returns an error. The state is stored under `"disabledTools"` in the server's config entry and takes effect immediately if the hub is running.

```sh
# List every tool across all servers, with disabled state
mcphub tools

# Disable / re-enable a single tool
mcphub tools disable my-server some_tool
mcphub tools enable my-server some_tool
```

## OAuth-protected HTTP servers

Some remote MCP servers (e.g. Cloudflare) require OAuth. Authenticate once — the hub stores the tokens and refreshes them automatically on reconnect:

```sh
mcphub add cloudflare --url https://mcp.cloudflare.com/mcp
mcphub auth cloudflare
```

The flow: RFC 9728 discovery → dynamic client registration → browser consent on `http://localhost:8765/callback` → tokens saved to `~/.config/mcphub/tokens/<name>.json` (access + refresh token).

## Shell environment variables

API keys defined in your shell rc files work under systemd too. `mcphub` loads `export KEY=VALUE` lines from `~/.bashrc`, `~/.zshrc`, and `~/.profile` at startup — variables already set in the environment take precedence.

## Config file location

- Linux: `~/.config/mcphub/config.json`
- macOS: `~/Library/Application Support/mcphub/config.json`
- Windows: `%APPDATA%\mcphub\config.json`

Override with `--config`:

```sh
mcphub --config /path/to/config.json start
```

Or set `MCPHUB_CONFIG` environment variable.

## CLI reference

```
Usage: mcphub [options] [command]

Options:
  -V, --version           output the version number
  -c, --config <path>     Config file path
  -h, --help              display help for command

Commands:
  start [options]         Start the MCP Hub
  stop                    Stop the hub daemon
  restart                 Restart the hub daemon (background)
  add [options] <name>    Add a server
  remove <name>           Remove a server
  list                    List configured servers
  tools                   List tools across servers, with disabled state
  tools disable <server> <tool>   Disable an individual tool
  tools enable <server> <tool>     Re-enable a disabled tool
  status                  Show hub status (PID, port, host, servers)
  auth <name>             Authenticate an OAuth-protected HTTP server
  enable <names...>       Enable servers
  disable <names...>      Disable servers (keeps config, skips them at start)
  config                  Show config path
  install-service         Install as a boot-time service
                          (systemd/launchd/schtasks)
  uninstall-service       Remove the boot-time service
  help [command]          display help for command
```
