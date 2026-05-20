# MCP Port Registry

A global MCP server that manages port assignments across all your projects. No more port conflicts between dev servers.

## How it works

Each technology has a default base port (PostgreSQL → 5432, Next.js → 3000, etc.). When a project requests a port, it gets the next available one starting from that base. Assignments are persisted in a local SQLite database — deterministic, fast, and conflict-free.

```
Project A + postgresql → 5432
Project B + postgresql → 5433
Project A + nextjs    → 3000
Project B + nextjs    → 3001
```

## Requirements

- macOS or Linux (x86_64 or arm64)
- Internet access (to install Bun and clone the repo)

## Installation

Pick the method that fits your setup. All four end up with the same registered MCP server.

### Method 1 — One-line installer (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/jcsoftdev/mcp-port-registry/main/install.sh | bash
```

The installer will:
1. Detect your OS and architecture (refuses on Windows native / 32-bit ARM)
2. Install [Bun](https://bun.sh) if not already present
3. Clone the repo to `~/.local/share/mcp-port-registry`
4. Launch an interactive TUI to detect and configure supported clients

**Supported clients**: Claude Code, Claude Desktop, Cursor, Windsurf, Cline, Continue, Zed

### Method 2 — Local installer (if you already cloned the repo)

Skips the curl + clone steps and runs the same interactive TUI:

```bash
cd /path/to/mcp-port-registry
bun install
bun installer/index.ts
```

Useful for contributors, or after pulling updates with `git pull`.

### Method 3 — Claude Code CLI (one command, Claude Code only)

If you only need it in Claude Code and prefer not to run any TUI:

```bash
# Clone first if you haven't
git clone https://github.com/jcsoftdev/mcp-port-registry.git ~/.local/share/mcp-port-registry
cd ~/.local/share/mcp-port-registry && bun install && cd -

# Register (user scope — available in every project)
claude mcp add port-registry -s user -- bun "$HOME/.local/share/mcp-port-registry/src/server.ts"
```

Restart Claude Code. Verify with `claude mcp list` or `/mcp` inside Claude Code.

<details>
<summary>Method 4 — Manual JSON edit (advanced, all other clients)</summary>

### Manual installation

```bash
# Clone
git clone https://github.com/jcsoftdev/mcp-port-registry.git ~/.local/share/mcp-port-registry
cd ~/.local/share/mcp-port-registry

# Install dependencies
bun install
```

Then add the entry to each client's config manually.

> **Important**: MCP clients do **not** expand `~` or `$HOME` inside `args`. Replace `<ABSOLUTE_PATH>` with the real absolute path (e.g. `/Users/you/.local/share/mcp-port-registry/src/server.ts` or `/home/you/.local/share/mcp-port-registry/src/server.ts`).

**Claude Code** — add to `~/.claude.json` at root level:

```json
{
  "mcpServers": {
    "port-registry": {
      "type": "stdio",
      "command": "bun",
      "args": ["<ABSOLUTE_PATH>/mcp-port-registry/src/server.ts"]
    }
  }
}
```

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `~/.config/Claude/claude_desktop_config.json` (Linux):

```json
{
  "mcpServers": {
    "port-registry": {
      "command": "bun",
      "args": ["<ABSOLUTE_PATH>/mcp-port-registry/src/server.ts"]
    }
  }
}
```

**Zed** — add to `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "port-registry": {
      "command": { "path": "bun", "args": ["<ABSOLUTE_PATH>/mcp-port-registry/src/server.ts"] }
    }
  }
}
```

Restart the client after editing. The tools will be available in all projects.

</details>

## Tools

### `port_get`

Get or auto-assign a port for a project + technology pair.

| Param | Required | Description |
|-------|----------|-------------|
| `project` | yes | Project identifier (e.g., `"my-app"`) |
| `technology` | yes | Technology name (e.g., `"postgresql"`, `"nextjs"`) |

Returns the assigned port. If no assignment exists, one is created automatically.

### `port_list`

List all port assignments. Optionally filter by project or technology.

| Param | Required | Description |
|-------|----------|-------------|
| `project` | no | Filter by project |
| `technology` | no | Filter by technology |

### `port_set`

Manually assign a specific port. Fails if the port is already taken by another pair.

| Param | Required | Description |
|-------|----------|-------------|
| `project` | yes | Project identifier |
| `technology` | yes | Technology name |
| `port` | yes | Port number (1024–65535) |

### `port_remove`

Remove a port assignment, freeing it for future use.

| Param | Required | Description |
|-------|----------|-------------|
| `project` | yes | Project identifier |
| `technology` | yes | Technology name |

### `port_technologies`

List all known technologies and their base ports. Optionally add a new one.

| Param | Required | Description |
|-------|----------|-------------|
| `add_name` | no | Name of technology to add |
| `add_port` | no | Base port for the new technology |

## Built-in Technologies

| Technology | Base Port |
|------------|-----------|
| postgresql | 5432 |
| mysql | 3306 |
| redis | 6379 |
| mongodb | 27017 |
| nextjs | 3000 |
| vite | 5173 |
| express | 3000 |
| fastapi | 8000 |
| django | 8000 |
| flask | 5000 |
| minio | 9000 |
| grafana | 3000 |
| rabbitmq | 5672 |
| elasticsearch | 9200 |
| nginx | 8080 |

## Storage

SQLite database at `$XDG_DATA_HOME/mcp-port-registry/registry.db` (defaults to `~/.local/share/mcp-port-registry/registry.db`). Created automatically on first use, WAL mode enabled. The path is fixed regardless of where the source code lives, so every install (dev clone, `~/.local/share`, Pi, etc.) shares the same assignments and avoids fragmentation.

Override with `PORT_REGISTRY_DB=/abs/path/to.db` (useful for tests or per-host isolation).

## Skills

### `port-setup`

An AI agent skill that auto-detects your project's tech stack and wires up collision-free ports in `.env` and `docker-compose.yml` — no manual bookkeeping.

**Prerequisite**: port-registry MCP server must be registered in your harness (see [Installation](#installation)).

**Triggers** (say any of these to your AI assistant):

| Language | Phrases |
|----------|---------|
| English | "set up ports", "init ports", "configure ports", "assign ports", "port setup" |
| Spanish | "asignar puertos", "configurar puertos", "configura puertos del proyecto" |

**What it does:**
1. Detects your tech stack (PostgreSQL, Redis, Next.js, etc.) via `package.json`, `pyproject.toml`, and `docker-compose.yml`.
2. Scans existing `.env` for already-assigned ports and pins them in the registry (`port_set`).
3. Calls `port_get` for each unassigned tech — collision-free, idempotent.
4. Writes port vars to `.env` (and `.env.local` if present) and updates `docker-compose.yml` ports.
5. Creates `.env.bak` / `docker-compose.yml.bak` before any modification.
6. Prints a summary table of all assignments.

**Dry-run mode**: say "dry run" / "preview" / "sin escribir" — shows planned changes without writing any files.

**Installing the skill** (copy to your harness skills directory):
```bash
# Claude Code
cp -r skills/port-setup ~/.claude/skills/port-setup
```

**Skill source**: [`skills/port-setup/`](skills/port-setup/)

## License

MIT
