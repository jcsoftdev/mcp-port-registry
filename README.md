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

- [Bun](https://bun.sh) >= 1.0 (uses `bun:sqlite` — zero external DB dependencies)

## Installation

```bash
# Clone
git clone git@github.com:jcsoftdev/mcp-port-registry.git
cd mcp-port-registry

# Install dependencies
bun install
```

### Register in Claude Code

Add to `~/.claude/.claude.json`:

```json
{
  "mcpServers": {
    "port-registry": {
      "type": "stdio",
      "command": "bun",
      "args": ["/path/to/mcp-port-registry/src/server.ts"]
    }
  }
}
```

Restart Claude Code. The tools will be available in all projects.

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

SQLite database at `registry.db` (created automatically on first use). WAL mode enabled for concurrent access. The DB stays local — it's gitignored.

## License

MIT
