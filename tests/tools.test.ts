import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { createRegistry } from "../src/registry";
import { createLeaseStore } from "../src/leases";
import { TOOL_DEFINITIONS, createToolHandler, type ToolHandler } from "../src/tools";

let dir: string;
let db: Database;
let handle: ToolHandler;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "port-registry-tools-"));
  db = openDb(join(dir, "registry.db"));
  handle = createToolHandler({
    registry: createRegistry(db),
    leases: createLeaseStore(db, { isPortFree: async () => true }),
  });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await handle(name, args);
  return { isError: res.isError ?? false, body: JSON.parse(res.content[0]!.text) };
}

describe("tool definitions", () => {
  test("exposes the legacy tools and the worktree lease tools", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "port_acquire",
        "port_gc",
        "port_get",
        "port_leases",
        "port_list",
        "port_release",
        "port_remove",
        "port_set",
        "port_technologies",
      ].sort()
    );
  });

  test("port_acquire requires project, worktree and technology", () => {
    const def = TOOL_DEFINITIONS.find((t) => t.name === "port_acquire")!;
    expect(def.inputSchema.required).toEqual(["project", "worktree", "technology"]);
  });
});

describe("worktree tools", () => {
  test("port_acquire leases a port and reports isNew", async () => {
    const { body } = await call("port_acquire", { project: "kanbai", worktree: "feat-a", technology: "redis" });
    expect(body.port).toBe(6379);
    expect(body.isNew).toBe(true);
  });

  test("port_release frees a whole worktree when technology is omitted", async () => {
    await call("port_acquire", { project: "kanbai", worktree: "feat-a", technology: "redis" });
    await call("port_acquire", { project: "kanbai", worktree: "feat-a", technology: "postgresql" });
    const { body } = await call("port_release", { project: "kanbai", worktree: "feat-a" });
    expect(body.released).toHaveLength(2);
    expect((await call("port_leases")).body).toEqual([]);
  });

  test("port_gc reconciles against a worktree list", async () => {
    await call("port_acquire", { project: "kanbai", worktree: "feat-a", technology: "redis" });
    await call("port_acquire", { project: "kanbai", worktree: "feat-b", technology: "redis" });
    const { body } = await call("port_gc", { project: "kanbai", worktrees: ["feat-b"] });
    expect(body.reclaimed.map((l: { worktree: string }) => l.worktree)).toEqual(["feat-a"]);
  });

  test("errors come back as isError with the message, not as a throw", async () => {
    const res = await call("port_acquire", { project: "kanbai", worktree: "feat-a", technology: "cobol" });
    expect(res.isError).toBe(true);
    expect(res.body.error).toMatch(/Unknown technology/);
  });

  test("unknown tool names are an error", async () => {
    const res = await call("port_nope");
    expect(res.isError).toBe(true);
  });
});

describe("legacy tools still work through the handler", () => {
  test("port_get then port_list", async () => {
    await call("port_get", { project: "a", technology: "redis" });
    const { body } = await call("port_list", { project: "a" });
    expect(body).toHaveLength(1);
    expect(body[0].port).toBe(6379);
  });
});
