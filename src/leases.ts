import type { Database } from "bun:sqlite";
import { resolveBasePort } from "./technologies";
import { isPidAlive as hostIsPidAlive, isPortFree as hostIsPortFree, readBootId } from "./host";

export interface Lease {
  project: string;
  worktree: string;
  technology: string;
  port: number;
  ownerPid: number | null;
  bootId: string | null;
  sessionId: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface LeaseKey {
  project: string;
  worktree: string;
  technology: string;
}

export interface AcquireInput extends LeaseKey {
  sessionId?: string;
}

export interface GcOptions {
  /** Scope reconciliation to one project. Required when `worktrees` is given. */
  project?: string;
  /** Live worktree ids for `project`; leases for any other worktree are reclaimed. */
  worktrees?: string[];
}

export interface LeaseStoreOptions {
  now: () => Date;
  isPidAlive: (pid: number) => boolean;
  bootId: () => string;
  isPortFree: (port: number) => Promise<boolean>;
  ttlMs: number;
  ownerPid: number;
}

export interface LeaseStore {
  acquire(input: AcquireInput): Promise<{ lease: Lease; isNew: boolean }>;
  release(key: { project: string; worktree: string; technology?: string }): Lease[];
  list(filter?: { project?: string; worktree?: string }): Lease[];
  gc(options?: GcOptions): Lease[];
  heartbeat(): number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PORT = 65535;

const SELECT_LEASE =
  "SELECT project, worktree, technology, port, owner_pid AS ownerPid, boot_id AS bootId, " +
  "session_id AS sessionId, created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt FROM leases";

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function normalizeKey(k: LeaseKey): LeaseKey {
  return { project: normalize(k.project), worktree: normalize(k.worktree), technology: normalize(k.technology) };
}

export function defaultTtlMs(): number {
  const raw = process.env.PORT_REGISTRY_LEASE_TTL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MS;
}

export function createLeaseStore(db: Database, options: Partial<LeaseStoreOptions> = {}): LeaseStore {
  const opts: LeaseStoreOptions = {
    now: () => new Date(),
    isPidAlive: hostIsPidAlive,
    bootId: readBootId,
    isPortFree: hostIsPortFree,
    ttlMs: defaultTtlMs(),
    ownerPid: process.pid,
    ...options,
  };

  const selectOne = db.query<Lease, [string, string, string]>(
    `${SELECT_LEASE} WHERE project = ? AND worktree = ? AND technology = ?`
  );
  const deleteOne = db.query<unknown, [string, string, string]>(
    "DELETE FROM leases WHERE project = ? AND worktree = ? AND technology = ?"
  );

  function nowIso(): string {
    return opts.now().toISOString();
  }
  function expiryIso(): string {
    return new Date(opts.now().getTime() + opts.ttlMs).toISOString();
  }

  const allocate = db.transaction(
    (k: LeaseKey, sessionId: string | undefined, skipped: Set<number>): { lease: Lease; isNew: boolean } => {
      const existing = selectOne.get(k.project, k.worktree, k.technology);
      const seen = nowIso();
      const expires = expiryIso();

      if (existing) {
        db.query(
          "UPDATE leases SET last_seen_at = ?, expires_at = ?, owner_pid = ?, boot_id = ?, session_id = COALESCE(?, session_id) " +
            "WHERE project = ? AND worktree = ? AND technology = ?"
        ).run(seen, expires, opts.ownerPid, opts.bootId(), sessionId ?? null, k.project, k.worktree, k.technology);
        return { lease: selectOne.get(k.project, k.worktree, k.technology)!, isNew: false };
      }

      const base = resolveBasePort(db, k.technology);
      if (base === undefined) {
        throw new Error(
          `Unknown technology: "${k.technology}". Use port_technologies to see known ones or add a new one.`
        );
      }

      const used = new Set<number>();
      for (const r of db.query<{ port: number }, []>("SELECT port FROM assignments").all()) used.add(r.port);
      for (const r of db.query<{ port: number }, []>("SELECT port FROM leases").all()) used.add(r.port);

      let port = base;
      while (used.has(port) || skipped.has(port)) port++;
      if (port > MAX_PORT) {
        throw new Error(`No available ports from base ${base} for technology "${k.technology}".`);
      }

      db.query(
        "INSERT INTO leases (project, worktree, technology, port, owner_pid, boot_id, session_id, created_at, last_seen_at, expires_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(k.project, k.worktree, k.technology, port, opts.ownerPid, opts.bootId(), sessionId ?? null, seen, seen, expires);

      return { lease: selectOne.get(k.project, k.worktree, k.technology)!, isNew: true };
    }
  );

  function isOwnerDead(lease: Lease, currentBoot: string): boolean {
    if (lease.bootId !== currentBoot) return true;
    if (lease.ownerPid === null) return true;
    return !opts.isPidAlive(lease.ownerPid);
  }

  const sweep = db.transaction((options: GcOptions): Lease[] => {
    const now = opts.now().getTime();
    const currentBoot = opts.bootId();
    const project = options.project ? normalize(options.project) : undefined;
    const live = options.worktrees ? new Set(options.worktrees.map(normalize)) : undefined;
    if (live && !project) throw new Error("gc: `worktrees` requires `project`.");

    const reclaimed: Lease[] = [];
    for (const lease of db.query<Lease, []>(SELECT_LEASE).all()) {
      const stale = isOwnerDead(lease, currentBoot) && Date.parse(lease.expiresAt) <= now;
      const gone = live !== undefined && lease.project === project && !live.has(lease.worktree);
      if (stale || gone) {
        deleteOne.run(lease.project, lease.worktree, lease.technology);
        reclaimed.push(lease);
      }
    }
    return reclaimed;
  });

  return {
    async acquire(input) {
      const k = normalizeKey(input);
      sweep.immediate({});
      const skipped = new Set<number>();
      for (;;) {
        const result = allocate.immediate(k, input.sessionId, skipped);
        if (!result.isNew) return result;
        if (await opts.isPortFree(result.lease.port)) return result;
        // Something outside the registry is listening there: give it back and try the next one.
        deleteOne.run(k.project, k.worktree, k.technology);
        skipped.add(result.lease.port);
      }
    },

    release({ project, worktree, technology }) {
      const p = normalize(project);
      const w = normalize(worktree);
      const rows =
        technology === undefined
          ? db.query<Lease, [string, string]>(`${SELECT_LEASE} WHERE project = ? AND worktree = ?`).all(p, w)
          : db.query<Lease, [string, string, string]>(`${SELECT_LEASE} WHERE project = ? AND worktree = ? AND technology = ?`).all(p, w, normalize(technology));
      for (const r of rows) deleteOne.run(r.project, r.worktree, r.technology);
      return rows;
    },

    list(filter = {}) {
      let sql = `${SELECT_LEASE} WHERE 1=1`;
      const params: string[] = [];
      if (filter.project) {
        sql += " AND project = ?";
        params.push(normalize(filter.project));
      }
      if (filter.worktree) {
        sql += " AND worktree = ?";
        params.push(normalize(filter.worktree));
      }
      sql += " ORDER BY project, worktree, technology, port";
      return db.query<Lease, string[]>(sql).all(...params);
    },

    gc(options = {}) {
      return sweep.immediate(options);
    },

    heartbeat() {
      const res = db
        .query("UPDATE leases SET last_seen_at = ?, expires_at = ? WHERE owner_pid = ? AND boot_id = ?")
        .run(nowIso(), expiryIso(), opts.ownerPid, opts.bootId());
      return Number(res.changes);
    },
  };
}
