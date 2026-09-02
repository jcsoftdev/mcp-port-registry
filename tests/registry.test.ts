import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { createRegistry, type Registry } from "../src/registry";
import { createLeaseStore } from "../src/leases";

let dir: string;
let dbPath: string;
let db: Database;
let registry: Registry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "port-registry-legacy-"));
  dbPath = join(dir, "registry.db");
  db = openDb(dbPath);
  registry = createRegistry(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("legacy project-level assignments", () => {
  test("assigns the base port and then the next free one", () => {
    expect(registry.getOrAssignPort("a", "redis").assignment.port).toBe(6379);
    expect(registry.getOrAssignPort("b", "redis").assignment.port).toBe(6380);
  });

  test("never hands out a port that a worktree lease already holds", async () => {
    const leases = createLeaseStore(db, { isPortFree: async () => true });
    await leases.acquire({ project: "kanbai", worktree: "feat-a", technology: "redis" });
    expect(registry.getOrAssignPort("other", "redis").assignment.port).toBe(6380);
  });

  test("port_set refuses a port held by a worktree lease", async () => {
    const leases = createLeaseStore(db, { isPortFree: async () => true });
    await leases.acquire({ project: "kanbai", worktree: "feat-a", technology: "redis" });
    expect(() => registry.setPort("other", "redis", 6379)).toThrow(/already/);
  });

  test("concurrent processes allocating against the same file never collide", async () => {
    const worker = join(import.meta.dir, "fixtures", "allocate-worker.ts");
    const procs = Array.from({ length: 4 }, (_, i) =>
      Bun.spawn(["bun", worker, dbPath, `proc${i}`, "25"], { stdout: "pipe", stderr: "pipe" })
    );
    const outputs = await Promise.all(procs.map((p) => new Response(p.stdout).text()));
    const errors = await Promise.all(procs.map((p) => new Response(p.stderr).text()));
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(errors.join("")).toBe("");
    expect(codes).toEqual([0, 0, 0, 0]);
    const ports = outputs.flatMap((o) => o.trim().split("\n").map(Number));
    expect(ports).toHaveLength(100);
    expect(new Set(ports).size).toBe(100);
  });
});
