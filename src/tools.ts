import type { Registry } from "./registry.js";
import type { LeaseStore } from "./leases.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (name: string, args: Record<string, unknown> | undefined) => Promise<ToolResult>;

const project = { type: "string", description: "Project identifier (e.g., 'clinicai', 'my-saas')" };
const technology = { type: "string", description: "Technology name (e.g., 'postgresql', 'nextjs', 'redis')" };
const worktree = {
  type: "string",
  description:
    "Worktree identifier — usually the branch name or the worktree directory basename. Two worktrees of the same project get different ports.",
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "port_get",
    description:
      "Get the project-level port for a project+technology pair (shared by every worktree). Auto-assigns if none exists. For parallel worktrees use port_acquire instead.",
    inputSchema: { type: "object", properties: { project, technology }, required: ["project", "technology"] },
  },
  {
    name: "port_list",
    description: "List all project-level port assignments. Optionally filter by project or technology.",
    inputSchema: { type: "object", properties: { project, technology } },
  },
  {
    name: "port_set",
    description:
      "Manually assign a specific port to a project+technology pair. Fails if the port is taken by another pair or by a worktree lease.",
    inputSchema: {
      type: "object",
      properties: { project, technology, port: { type: "number", description: "Port number to assign (1024-65535)" } },
      required: ["project", "technology", "port"],
    },
  },
  {
    name: "port_remove",
    description: "Remove a project-level port assignment.",
    inputSchema: { type: "object", properties: { project, technology }, required: ["project", "technology"] },
  },
  {
    name: "port_technologies",
    description: "List all known technologies with default base ports. Optionally add a new technology.",
    inputSchema: {
      type: "object",
      properties: {
        add_name: { type: "string", description: "Name of new technology to add" },
        add_port: { type: "number", description: "Default base port for the new technology" },
      },
    },
  },
  {
    name: "port_acquire",
    description:
      "Lease a port for a project+worktree+technology triple. Sticky: the same triple always gets the same port back while the lease lives. " +
      "The port is verified free on the OS before it is returned. Leases expire when their owning session dies and the TTL passes, " +
      "or immediately when port_release / port_gc reclaims them.",
    inputSchema: {
      type: "object",
      properties: {
        project,
        worktree,
        technology,
        session_id: { type: "string", description: "Optional caller session id, recorded on the lease for auditing" },
      },
      required: ["project", "worktree", "technology"],
    },
  },
  {
    name: "port_release",
    description:
      "Release worktree leases. With technology: that one lease. Without: every lease of the worktree. Call this when the task/worktree is done.",
    inputSchema: { type: "object", properties: { project, worktree, technology }, required: ["project", "worktree"] },
  },
  {
    name: "port_leases",
    description: "List active worktree leases. Optionally filter by project and/or worktree.",
    inputSchema: { type: "object", properties: { project, worktree } },
  },
  {
    name: "port_gc",
    description:
      "Reclaim stale leases (owner process dead AND TTL expired). Pass project + worktrees (the output of `git worktree list`) " +
      "to also reclaim leases for worktrees that no longer exist.",
    inputSchema: {
      type: "object",
      properties: {
        project,
        worktrees: {
          type: "array",
          items: { type: "string" },
          description: "Live worktree ids for `project`. Leases for any other worktree of that project are reclaimed.",
        },
      },
    },
  },
];

function json(value: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: isError || undefined };
}

export function createToolHandler(deps: { registry: Registry; leases: LeaseStore }): ToolHandler {
  const { registry, leases } = deps;

  return async (name, rawArgs) => {
    const args = (rawArgs ?? {}) as Record<string, any>;
    try {
      switch (name) {
        case "port_get": {
          const { assignment, isNew } = registry.getOrAssignPort(args.project, args.technology);
          return json({ ...assignment, isNew });
        }
        case "port_list":
          return json(registry.listAssignments(args.project, args.technology));
        case "port_set":
          return json({ success: true, ...registry.setPort(args.project, args.technology, args.port) });
        case "port_remove":
          return json({ success: true, removed: registry.removePort(args.project, args.technology) });
        case "port_technologies":
          return json({ technologies: registry.getTechnologies(args.add_name, args.add_port) });

        case "port_acquire": {
          const { lease, isNew } = await leases.acquire({
            project: args.project,
            worktree: args.worktree,
            technology: args.technology,
            sessionId: args.session_id,
          });
          return json({ ...lease, isNew });
        }
        case "port_release":
          return json({
            success: true,
            released: leases.release({ project: args.project, worktree: args.worktree, technology: args.technology }),
          });
        case "port_leases":
          return json(leases.list({ project: args.project, worktree: args.worktree }));
        case "port_gc":
          return json({ reclaimed: leases.gc({ project: args.project, worktrees: args.worktrees }) });

        default:
          return json({ error: `Unknown tool: ${name}` }, true);
      }
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, true);
    }
  };
}
