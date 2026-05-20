import { Database } from "bun:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import type { PortAssignment } from "./types.js";
import { DEFAULT_TECHNOLOGIES } from "./technologies.js";

// Single source of truth across every install path (dev clone, ~/.local/share, etc.).
// Override with PORT_REGISTRY_DB to relocate (tests, isolation).
function resolveDbPath(): string {
  if (process.env.PORT_REGISTRY_DB) return process.env.PORT_REGISTRY_DB;
  const dataHome =
    process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.length > 0
      ? process.env.XDG_DATA_HOME
      : join(homedir(), ".local", "share");
  return join(dataHome, "mcp-port-registry", "registry.db");
}

const DB_PATH = resolveDbPath();
mkdirSync(join(DB_PATH, ".."), { recursive: true });

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS assignments (
    project TEXT NOT NULL,
    technology TEXT NOT NULL,
    port INTEGER NOT NULL UNIQUE,
    assigned_at TEXT NOT NULL,
    manual INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project, technology)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS custom_technologies (
    name TEXT PRIMARY KEY,
    base_port INTEGER NOT NULL
  )
`);

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function getBasePort(technology: string): number | undefined {
  const builtin = DEFAULT_TECHNOLOGIES[technology];
  if (builtin !== undefined) return builtin;

  const row = db
    .query<{ base_port: number }, [string]>(
      "SELECT base_port FROM custom_technologies WHERE name = ?"
    )
    .get(technology);
  return row?.base_port;
}

export function getOrAssignPort(
  project: string,
  technology: string
): { assignment: PortAssignment; isNew: boolean } {
  const p = normalize(project);
  const t = normalize(technology);

  const existing = db
    .query<PortAssignment, [string, string]>(
      "SELECT project, technology, port, assigned_at AS assignedAt, manual FROM assignments WHERE project = ? AND technology = ?"
    )
    .get(p, t);

  if (existing) {
    return { assignment: { ...existing, manual: Boolean(existing.manual) }, isNew: false };
  }

  const basePort = getBasePort(t);
  if (basePort === undefined) {
    throw new Error(
      `Unknown technology: "${technology}". Use port_technologies to see known ones or add a new one.`
    );
  }

  const usedPorts = new Set(
    db
      .query<{ port: number }, []>("SELECT port FROM assignments")
      .all()
      .map((r) => r.port)
  );

  let port = basePort;
  while (usedPorts.has(port)) port++;

  if (port > 65535) {
    throw new Error(`No available ports from base ${basePort} for technology "${technology}".`);
  }

  const now = new Date().toISOString();
  db.query(
    "INSERT INTO assignments (project, technology, port, assigned_at, manual) VALUES (?, ?, ?, ?, 0)"
  ).run(p, t, port, now);

  return {
    assignment: { project: p, technology: t, port, assignedAt: now, manual: false },
    isNew: true,
  };
}

export function listAssignments(
  filterProject?: string,
  filterTechnology?: string
): PortAssignment[] {
  let sql = "SELECT project, technology, port, assigned_at AS assignedAt, manual FROM assignments WHERE 1=1";
  const params: string[] = [];

  if (filterProject) {
    sql += " AND project = ?";
    params.push(normalize(filterProject));
  }
  if (filterTechnology) {
    sql += " AND technology = ?";
    params.push(normalize(filterTechnology));
  }

  sql += " ORDER BY technology, port";

  const rows = db.query<PortAssignment, string[]>(sql).all(...params);
  return rows.map((r) => ({ ...r, manual: Boolean(r.manual) }));
}

export function setPort(
  project: string,
  technology: string,
  port: number
): PortAssignment {
  if (port < 1024 || port > 65535) {
    throw new Error(`Port must be between 1024 and 65535. Got: ${port}`);
  }

  const p = normalize(project);
  const t = normalize(technology);

  const conflict = db
    .query<{ project: string; technology: string }, [number, string, string]>(
      "SELECT project, technology FROM assignments WHERE port = ? AND NOT (project = ? AND technology = ?)"
    )
    .get(port, p, t);

  if (conflict) {
    throw new Error(
      `Port ${port} is already assigned to "${conflict.project}" (${conflict.technology}).`
    );
  }

  const now = new Date().toISOString();
  db.query(
    "INSERT INTO assignments (project, technology, port, assigned_at, manual) VALUES (?, ?, ?, ?, 1) ON CONFLICT(project, technology) DO UPDATE SET port = excluded.port, assigned_at = excluded.assigned_at, manual = 1"
  ).run(p, t, port, now);

  return { project: p, technology: t, port, assignedAt: now, manual: true };
}

export function removePort(project: string, technology: string): PortAssignment {
  const p = normalize(project);
  const t = normalize(technology);

  const existing = db
    .query<PortAssignment, [string, string]>(
      "SELECT project, technology, port, assigned_at AS assignedAt, manual FROM assignments WHERE project = ? AND technology = ?"
    )
    .get(p, t);

  if (!existing) {
    throw new Error(`No assignment found for "${project}" + "${technology}".`);
  }

  db.query("DELETE FROM assignments WHERE project = ? AND technology = ?").run(p, t);
  return { ...existing, manual: Boolean(existing.manual) };
}

export function getTechnologies(
  addName?: string,
  addPort?: number
): Record<string, number> {
  if (addName && addPort !== undefined) {
    const name = normalize(addName);
    if (addPort < 1024 || addPort > 65535) {
      throw new Error(`Port must be between 1024 and 65535. Got: ${addPort}`);
    }
    db.query(
      "INSERT INTO custom_technologies (name, base_port) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET base_port = excluded.base_port"
    ).run(name, addPort);
  }

  const custom = db
    .query<{ name: string; base_port: number }, []>(
      "SELECT name, base_port FROM custom_technologies"
    )
    .all();

  const result: Record<string, number> = { ...DEFAULT_TECHNOLOGIES };
  for (const row of custom) {
    result[row.name] = row.base_port;
  }
  return result;
}
