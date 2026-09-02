import { Database } from "bun:sqlite";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

export const SCHEMA_VERSION = 2;

// Wait up to this long for another process's write transaction before failing.
const BUSY_TIMEOUT_MS = 5000;

// Single source of truth across every install path (dev clone, ~/.local/share, etc.).
// Override with PORT_REGISTRY_DB to relocate (tests, isolation).
export function resolveDbPath(): string {
  if (process.env.PORT_REGISTRY_DB) return process.env.PORT_REGISTRY_DB;
  const dataHome =
    process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.length > 0
      ? process.env.XDG_DATA_HOME
      : join(homedir(), ".local", "share");
  return join(dataHome, "mcp-port-registry", "registry.db");
}

export function openDb(path: string = resolveDbPath()): Database {
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA foreign_keys = ON");

  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  // v1 — original tables
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

  // v2 — per-worktree leases
  db.exec(`
    CREATE TABLE IF NOT EXISTS leases (
      project TEXT NOT NULL,
      worktree TEXT NOT NULL,
      technology TEXT NOT NULL,
      port INTEGER NOT NULL UNIQUE,
      owner_pid INTEGER,
      boot_id TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (project, worktree, technology)
    )
  `);

  db.query(
    "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)"
  ).run(SCHEMA_VERSION, new Date().toISOString());
}
