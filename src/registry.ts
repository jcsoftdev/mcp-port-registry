import type { Database } from "bun:sqlite";
import type { PortAssignment } from "./types.js";
import { DEFAULT_TECHNOLOGIES, resolveBasePort } from "./technologies.js";

export interface Registry {
  getOrAssignPort(project: string, technology: string): { assignment: PortAssignment; isNew: boolean };
  listAssignments(filterProject?: string, filterTechnology?: string): PortAssignment[];
  setPort(project: string, technology: string, port: number): PortAssignment;
  removePort(project: string, technology: string): PortAssignment;
  getTechnologies(addName?: string, addPort?: number): Record<string, number>;
}

const SELECT_ASSIGNMENT =
  "SELECT project, technology, port, assigned_at AS assignedAt, manual FROM assignments";

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function assertPortRange(port: number): void {
  if (port < 1024 || port > 65535) {
    throw new Error(`Port must be between 1024 and 65535. Got: ${port}`);
  }
}

/**
 * Project-level assignments (the original API). Ports are unique across BOTH
 * this table and the per-worktree `leases` table, so the two models coexist.
 */
export function createRegistry(db: Database): Registry {
  const selectOne = db.query<PortAssignment, [string, string]>(
    `${SELECT_ASSIGNMENT} WHERE project = ? AND technology = ?`
  );

  function toAssignment(row: PortAssignment): PortAssignment {
    return { ...row, manual: Boolean(row.manual) };
  }

  function usedPorts(): Set<number> {
    const used = new Set<number>();
    for (const r of db.query<{ port: number }, []>("SELECT port FROM assignments").all()) used.add(r.port);
    for (const r of db.query<{ port: number }, []>("SELECT port FROM leases").all()) used.add(r.port);
    return used;
  }

  function leaseHolder(port: number): { project: string; worktree: string; technology: string } | null {
    return db
      .query<{ project: string; worktree: string; technology: string }, [number]>(
        "SELECT project, worktree, technology FROM leases WHERE port = ?"
      )
      .get(port);
  }

  // BEGIN IMMEDIATE takes the write lock up front, so "read used ports → pick →
  // insert" is atomic across the many server processes sharing this file.
  const allocate = db.transaction((p: string, t: string): { assignment: PortAssignment; isNew: boolean } => {
    const existing = selectOne.get(p, t);
    if (existing) return { assignment: toAssignment(existing), isNew: false };

    const basePort = resolveBasePort(db, t);
    if (basePort === undefined) {
      throw new Error(`Unknown technology: "${t}". Use port_technologies to see known ones or add a new one.`);
    }

    const used = usedPorts();
    let port = basePort;
    while (used.has(port)) port++;
    if (port > 65535) {
      throw new Error(`No available ports from base ${basePort} for technology "${t}".`);
    }

    const now = new Date().toISOString();
    db.query(
      "INSERT INTO assignments (project, technology, port, assigned_at, manual) VALUES (?, ?, ?, ?, 0)"
    ).run(p, t, port, now);
    return { assignment: { project: p, technology: t, port, assignedAt: now, manual: false }, isNew: true };
  });

  const pin = db.transaction((p: string, t: string, port: number): PortAssignment => {
    const conflict = db
      .query<{ project: string; technology: string }, [number, string, string]>(
        "SELECT project, technology FROM assignments WHERE port = ? AND NOT (project = ? AND technology = ?)"
      )
      .get(port, p, t);
    if (conflict) {
      throw new Error(`Port ${port} is already assigned to "${conflict.project}" (${conflict.technology}).`);
    }
    const lease = leaseHolder(port);
    if (lease) {
      throw new Error(
        `Port ${port} is already leased by "${lease.project}" worktree "${lease.worktree}" (${lease.technology}).`
      );
    }

    const now = new Date().toISOString();
    db.query(
      "INSERT INTO assignments (project, technology, port, assigned_at, manual) VALUES (?, ?, ?, ?, 1) " +
        "ON CONFLICT(project, technology) DO UPDATE SET port = excluded.port, assigned_at = excluded.assigned_at, manual = 1"
    ).run(p, t, port, now);
    return { project: p, technology: t, port, assignedAt: now, manual: true };
  });

  return {
    getOrAssignPort(project, technology) {
      return allocate.immediate(normalize(project), normalize(technology));
    },

    listAssignments(filterProject, filterTechnology) {
      let sql = `${SELECT_ASSIGNMENT} WHERE 1=1`;
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
      return db.query<PortAssignment, string[]>(sql).all(...params).map(toAssignment);
    },

    setPort(project, technology, port) {
      assertPortRange(port);
      return pin.immediate(normalize(project), normalize(technology), port);
    },

    removePort(project, technology) {
      const p = normalize(project);
      const t = normalize(technology);
      const existing = selectOne.get(p, t);
      if (!existing) {
        throw new Error(`No assignment found for "${project}" + "${technology}".`);
      }
      db.query("DELETE FROM assignments WHERE project = ? AND technology = ?").run(p, t);
      return toAssignment(existing);
    },

    getTechnologies(addName, addPort) {
      if (addName && addPort !== undefined) {
        assertPortRange(addPort);
        db.query(
          "INSERT INTO custom_technologies (name, base_port) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET base_port = excluded.base_port"
        ).run(normalize(addName), addPort);
      }
      const result: Record<string, number> = { ...DEFAULT_TECHNOLOGIES };
      for (const row of db
        .query<{ name: string; base_port: number }, []>("SELECT name, base_port FROM custom_technologies")
        .all()) {
        result[row.name] = row.base_port;
      }
      return result;
    },
  };
}
