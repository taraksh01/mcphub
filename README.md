# mcphub

**Single MCP gateway for all your AI coding CLIs.**

Instead of configuring every CLI (OpenCode, Claude Code, Cursor, Zed, Pi) with its own MCP server config, run one hub and point them all at a single URL.

```sh
npm install -g mcphub
mcphub add my-server --stdio "npx -y some-mcp-server"
mcphub start
```

All tools from all servers appear under `http://localhost:5431/mcp`.

## Install

```sh
npm install -g mcphub
```

Or use directly without installing:

```sh
npx mcphub <command>
```

## Quick start

```sh
# Add a server
mcphub add filesystem --stdio "npx -y @modelcontextprotocol/server-filesystem /tmp"
mcphub add github --stdio "npx -y @modelcontextprotocol/server-github"

# List configured servers
mcphub list

# Start the hub (foreground)
mcphub start

# Or run as a daemon
mcphub start --daemon

# Stop the daemon
mcphub stop

# Show config path
mcphub config
```

The hub listens on `http://localhost:5431/mcp` by default. Override with `--port`:

```sh
mcphub start --port 8080
```

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

## Config file location

- `~/.config/mcphub/config.json` (Linux)
- `~/Library/Application Support/mcphub/config.json` (macOS)

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
  status                  Show hub status
  config                  Show config path
  help [command]          display help for command
```
