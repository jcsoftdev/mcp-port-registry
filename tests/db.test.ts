import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, SCHEMA_VERSION } from "../src/db";

const dirs: string[] = [];
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "port-registry-"));
  dirs.push(dir);
  return join(dir, "nested", "registry.db");
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("openDb", () => {
  test("creates parent directories and all tables", () => {
    const db = openDb(tempDbPath());
    const names = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(["assignments", "custom_technologies", "leases", "schema_version"])
    );
    db.close();
  });

  test("enables WAL and a busy_timeout so concurrent processes wait instead of failing", () => {
    const db = openDb(tempDbPath());
    const mode = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
    const timeout = db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get();
    expect(mode?.journal_mode).toBe("wal");
    expect(timeout?.timeout).toBeGreaterThanOrEqual(1000);
    db.close();
  });

  test("records the schema version and is idempotent on reopen", () => {
    const path = tempDbPath();
    openDb(path).close();
    const db = openDb(path);
    const row = db.query<{ version: number }, []>("SELECT MAX(version) AS version FROM schema_version").get();
    expect(row?.version).toBe(SCHEMA_VERSION);
    db.close();
  });
});
