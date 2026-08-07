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

# Disable a server (keeps config, skips it at start)
mcphub disable some-server

# Re-enable it
mcphub enable some-server

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

Health check at `GET /health` returns `{ "status": "ok" }`.

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

Disable a server without removing it by setting `"enabled": false` in the config, or via `mcphub disable <name>` / `mcphub enable <name>`. Disabled servers show a `[disabled]` marker in `mcphub list` and `mcphub status`, and are skipped on start — toggling takes effect immediately if the hub is running.

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
  add [options] <name>    Add a server
  remove <name>           Remove a server
  list                    List configured servers
  status                  Show hub status (PID, port, servers)
  auth <name>             Authenticate an OAuth-protected HTTP server
  enable <name>           Enable a server
  disable <name>          Disable a server (keeps config, skips it at start)
  config                  Show config path
  install-service         Install as a boot-time service
                          (systemd/launchd/schtasks)
  uninstall-service       Remove the boot-time service
  help [command]          display help for command
```
