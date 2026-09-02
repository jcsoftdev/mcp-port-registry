import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { createLeaseStore, type LeaseStore, type LeaseStoreOptions } from "../src/leases";

const HOUR = 60 * 60 * 1000;

let dir: string;
let db: Database;
let clock: { now: number };
let alivePids: Set<number>;
let busyPorts: Set<number>;
let bootId: string;

function makeStore(overrides: Partial<LeaseStoreOptions> = {}): LeaseStore {
  return createLeaseStore(db, {
    now: () => new Date(clock.now),
    isPidAlive: (pid) => alivePids.has(pid),
    bootId: () => bootId,
    isPortFree: async (port) => !busyPorts.has(port),
    ttlMs: 24 * HOUR,
    ownerPid: 4242,
    ...overrides,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "port-registry-leases-"));
  db = openDb(join(dir, "registry.db"));
  clock = { now: Date.parse("2026-09-01T12:00:00.000Z") };
  alivePids = new Set([4242]);
  busyPorts = new Set();
  bootId = "boot-A";
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const key = (worktree: string, technology = "postgresql") => ({
  project: "kanbai",
  worktree,
  technology,
});

describe("acquire", () => {
  test("assigns the technology base port to a brand-new lease", async () => {
    const { lease, isNew } = await makeStore().acquire(key("feat-a"));
    expect(isNew).toBe(true);
    expect(lease.port).toBe(5432);
    expect(lease.worktree).toBe("feat-a");
  });

  test("gives two worktrees of the same project different ports", async () => {
    const store = makeStore();
    const a = await store.acquire(key("feat-a"));
    const b = await store.acquire(key("feat-b"));
    expect(a.lease.port).toBe(5432);
    expect(b.lease.port).toBe(5433);
  });

  test("is sticky: the same key gets the same port back and the lease is renewed", async () => {
    const store = makeStore();
    const first = await store.acquire(key("feat-a"));
    clock.now += 2 * HOUR;
    const second = await store.acquire(key("feat-a"));
    expect(second.isNew).toBe(false);
    expect(second.lease.port).toBe(first.lease.port);
    expect(Date.parse(second.lease.expiresAt)).toBe(clock.now + 24 * HOUR);
  });

  test("skips ports already held by legacy project-level assignments", async () => {
    db.query(
      "INSERT INTO assignments (project, technology, port, assigned_at, manual) VALUES ('lipu', 'postgresql', 5432, '2026-01-01T00:00:00.000Z', 1)"
    ).run();
    const { lease } = await makeStore().acquire(key("feat-a"));
    expect(lease.port).toBe(5433);
  });

  test("skips ports the OS reports as busy even when the registry does not know them", async () => {
    busyPorts.add(5432);
    const { lease } = await makeStore().acquire(key("feat-a"));
    expect(lease.port).toBe(5433);
  });

  test("records owner pid, boot id and session id on the lease", async () => {
    const { lease } = await makeStore().acquire({ ...key("feat-a"), sessionId: "sess-1" });
    expect(lease.ownerPid).toBe(4242);
    expect(lease.bootId).toBe("boot-A");
    expect(lease.sessionId).toBe("sess-1");
  });

  test("rejects unknown technologies", async () => {
    await expect(makeStore().acquire(key("feat-a", "cobol"))).rejects.toThrow(/Unknown technology/);
  });

  test("normalizes project, worktree and technology", async () => {
    const store = makeStore();
    const a = await store.acquire({ project: " Kanbai ", worktree: "Feat/A", technology: "PostgreSQL" });
    const b = await store.acquire({ project: "kanbai", worktree: "feat/a", technology: "postgresql" });
    expect(b.isNew).toBe(false);
    expect(b.lease.port).toBe(a.lease.port);
  });
});

describe("release", () => {
  test("frees the port so another worktree can take it", async () => {
    const store = makeStore();
    await store.acquire(key("feat-a"));
    const released = store.release(key("feat-a"));
    expect(released.map((l) => l.port)).toEqual([5432]);
    const { lease } = await store.acquire(key("feat-b"));
    expect(lease.port).toBe(5432);
  });

  test("without a technology releases every lease of that worktree", async () => {
    const store = makeStore();
    await store.acquire(key("feat-a", "postgresql"));
    await store.acquire(key("feat-a", "redis"));
    await store.acquire(key("feat-b", "postgresql"));
    const released = store.release({ project: "kanbai", worktree: "feat-a" });
    expect(released.map((l) => l.technology).sort()).toEqual(["postgresql", "redis"]);
    expect(store.list({ project: "kanbai" }).map((l) => l.worktree)).toEqual(["feat-b"]);
  });

  test("returns an empty list when nothing matched", () => {
    expect(makeStore().release(key("ghost"))).toEqual([]);
  });
});

describe("gc", () => {
  test("reclaims an expired lease whose owner process is dead", async () => {
    const store = makeStore();
    await store.acquire(key("feat-a"));
    alivePids.delete(4242);
    clock.now += 25 * HOUR;
    const reclaimed = store.gc();
    expect(reclaimed.map((l) => l.worktree)).toEqual(["feat-a"]);
    expect(store.list()).toEqual([]);
  });

  test("keeps an expired lease while its owner process is still alive", async () => {
    const store = makeStore();
    await store.acquire(key("feat-a"));
    clock.now += 25 * HOUR;
    expect(store.gc()).toEqual([]);
    expect(store.list()).toHaveLength(1);
  });

  test("keeps an unexpired lease even if its owner is dead (grace period)", async () => {
    const store = makeStore();
    await store.acquire(key("feat-a"));
    alivePids.delete(4242);
    clock.now += 1 * HOUR;
    expect(store.gc()).toEqual([]);
  });

  test("treats a different boot id as a dead owner", async () => {
    const store = makeStore();
    await store.acquire(key("feat-a"));
    bootId = "boot-B"; // machine rebooted; pid 4242 may be reused by anything
    clock.now += 25 * HOUR;
    expect(store.gc().map((l) => l.worktree)).toEqual(["feat-a"]);
  });

  test("reconciles against the live worktree list: missing worktrees are reclaimed immediately", async () => {
    const store = makeStore();
    await store.acquire(key("feat-a"));
    await store.acquire(key("feat-b"));
    const reclaimed = store.gc({ project: "kanbai", worktrees: ["feat-b"] });
    expect(reclaimed.map((l) => l.worktree)).toEqual(["feat-a"]);
    expect(store.list().map((l) => l.worktree)).toEqual(["feat-b"]);
  });

  test("reconciliation is scoped to the given project", async () => {
    const store = makeStore();
    await store.acquire(key("feat-a"));
    await store.acquire({ project: "other", worktree: "main", technology: "postgresql" });
    store.gc({ project: "kanbai", worktrees: [] });
    expect(store.list().map((l) => l.project)).toEqual(["other"]);
  });

  test("acquire sweeps stale leases first so their ports are reusable", async () => {
    const store = makeStore();
    await store.acquire(key("feat-a"));
    alivePids.delete(4242); // owner session died without releasing
    clock.now += 25 * HOUR;
    alivePids.add(5555);
    const other = makeStore({ ownerPid: 5555 });
    const { lease } = await other.acquire(key("feat-b"));
    expect(lease.port).toBe(5432);
  });
});

describe("heartbeat", () => {
  test("renews every lease owned by this process", async () => {
    const store = makeStore();
    await store.acquire(key("feat-a"));
    await store.acquire(key("feat-a", "redis"));
    clock.now += 10 * HOUR;
    const renewed = store.heartbeat();
    expect(renewed).toBe(2);
    for (const l of store.list()) {
      expect(Date.parse(l.expiresAt)).toBe(clock.now + 24 * HOUR);
    }
  });

  test("does not touch leases owned by other processes", async () => {
    const a = makeStore({ ownerPid: 1111 });
    const b = makeStore({ ownerPid: 2222 });
    await a.acquire(key("feat-a"));
    const before = b.list()[0]!.expiresAt;
    clock.now += 1 * HOUR;
    expect(b.heartbeat()).toBe(0);
    expect(b.list()[0]!.expiresAt).toBe(before);
  });
});
