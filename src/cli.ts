#!/usr/bin/env bun
/**
 * Hook-friendly CLI over the same SQLite registry the MCP server uses.
 *
 *   bun src/cli.ts acquire --project P --worktree W --technology T [--technology T2] [--json]
 *   bun src/cli.ts release --project P --worktree W [--technology T]
 *   bun src/cli.ts gc [--project P --worktrees a,b] | [--auto]
 *   bun src/cli.ts leases [--project P] [--worktree W] [--json]
 *   bun src/cli.ts whoami [--json]        # project + worktree derived from git in cwd
 *   bun src/cli.ts hook gc|release|log    # Claude Code hook adapter: reads the hook JSON on stdin, always exits 0
 *
 * `acquire` prints PORT_<TECHNOLOGY>=<port> lines, ready for `>> "$CLAUDE_ENV_FILE"` or `.env`.
 */
import { parseArgs } from "node:util";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { openDb } from "./db.js";
import { createLeaseStore, type Lease, type LeaseStore } from "./leases.js";

interface GitContext {
  project: string;
  worktree: string;
  isMain: boolean;
}

function git(args: string[], cwd: string): string | null {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? r.stdout.toString().trim() : null;
}

function repoNameFromRemote(url: string): string {
  const last = url.replace(/[/:]+$/, "").split(/[/:]/).pop() ?? url;
  return last.replace(/\.git$/, "").trim().toLowerCase();
}

export function detectGitContext(cwd: string): GitContext {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  if (!top) return { project: basename(cwd).toLowerCase(), worktree: "main", isMain: true };

  const gitDir = resolve(cwd, git(["rev-parse", "--git-dir"], cwd) ?? ".git");
  const commonDir = resolve(cwd, git(["rev-parse", "--git-common-dir"], cwd) ?? ".git");
  const isMain = gitDir === commonDir;

  const remote = git(["remote", "get-url", "origin"], cwd);
  const project = remote ? repoNameFromRemote(remote) : basename(resolve(commonDir, "..")).toLowerCase();

  // A worktree is a directory: that is what `git worktree remove` deletes, and
  // switching branches inside it must not change its ports. The main checkout
  // is always "main" regardless of the branch it has checked out.
  const worktree = isMain ? "main" : basename(top);
  return { project, worktree, isMain };
}

/** Worktree ids (directory basenames; the main checkout is "main") of every live worktree. */
export function listLiveWorktrees(cwd: string): string[] {
  const out = git(["worktree", "list", "--porcelain"], cwd);
  if (!out) return [];
  const paths = out
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  // `git worktree list` prints the main worktree first.
  return paths.map((p, i) => (i === 0 ? "main" : basename(p)));
}

function envVarName(technology: string): string {
  return `PORT_${technology.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function printLeases(leases: Lease[], asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(leases, null, 2));
    return;
  }
  if (leases.length === 0) {
    console.log("(no leases)");
    return;
  }
  for (const l of leases) {
    console.log(`${l.project}\t${l.worktree}\t${l.technology}\t${l.port}\texpires ${l.expiresAt}`);
  }
}

function makeStore(): LeaseStore {
  return createLeaseStore(openDb(), {
    // Tests and CI run without touching real sockets.
    ...(process.env.PORT_REGISTRY_SKIP_PROBE ? { isPortFree: async () => true } : {}),
  });
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  try {
    return await Bun.stdin.text();
  } catch {
    return "";
  }
}

/**
 * Claude Code hook adapter. The hook JSON arrives on stdin; `worktree_path`
 * (when present) or `cwd` names the worktree the event is about. Never fails
 * the hook: a registry hiccup must not block a session or a worktree operation.
 */
async function runHook(mode: string | undefined): Promise<number> {
  const payload = await readStdin();
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    // not JSON — fall through with an empty payload
  }
  const str = (k: string): string | undefined => (typeof data[k] === "string" ? (data[k] as string) : undefined);
  const dir = str("worktree_path") ?? str("cwd") ?? process.cwd();

  try {
    switch (mode) {
      case "log": {
        const logDir = join(homedir(), ".cache", "mcp-port-registry");
        mkdirSync(logDir, { recursive: true });
        appendFileSync(join(logDir, "hooks.log"), `${new Date().toISOString()} ${payload.trim()}\n`);
        break;
      }
      case "gc": {
        if (!existsSync(dir)) break;
        const ctx = detectGitContext(dir);
        makeStore().gc({ project: ctx.project, worktrees: listLiveWorktrees(dir) });
        break;
      }
      case "release": {
        if (!existsSync(dir)) break;
        const ctx = detectGitContext(dir);
        makeStore().release({ project: ctx.project, worktree: ctx.worktree });
        break;
      }
      default:
        break;
    }
  } catch {
    // swallowed on purpose — see docstring
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "hook") return runHook(rest[0]);

  const { values } = parseArgs({
    args: rest,
    options: {
      project: { type: "string" },
      worktree: { type: "string" },
      technology: { type: "string", multiple: true },
      worktrees: { type: "string" },
      session: { type: "string" },
      auto: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    strict: true,
  });

  const cwd = process.cwd();
  const ctx = (): GitContext => detectGitContext(cwd);

  if (command === "whoami") {
    const c = ctx();
    console.log(values.json ? JSON.stringify(c) : `${c.project}\t${c.worktree}${c.isMain ? "\t(main)" : ""}`);
    return 0;
  }

  const store = makeStore();

  switch (command) {
    case "acquire": {
      const project = values.project ?? ctx().project;
      const worktree = values.worktree ?? ctx().worktree;
      const techs = values.technology ?? [];
      if (techs.length === 0) throw new Error("acquire: at least one --technology is required.");
      const leases: Lease[] = [];
      for (const technology of techs) {
        const { lease } = await store.acquire({ project, worktree, technology, sessionId: values.session });
        leases.push(lease);
      }
      if (values.json) console.log(JSON.stringify(leases, null, 2));
      else for (const l of leases) console.log(`${envVarName(l.technology)}=${l.port}`);
      return 0;
    }

    case "release": {
      const project = values.project ?? ctx().project;
      const worktree = values.worktree ?? ctx().worktree;
      const released = store.release({ project, worktree, technology: values.technology?.[0] });
      console.log(`released ${released.length} lease(s) for ${project}/${worktree}`);
      return 0;
    }

    case "gc": {
      let project = values.project;
      let worktrees = values.worktrees?.split(",").map((s) => s.trim()).filter(Boolean);
      if (values.auto) {
        project = ctx().project;
        worktrees = listLiveWorktrees(cwd);
      }
      const reclaimed = store.gc({ project, worktrees });
      console.log(`reclaimed ${reclaimed.length} lease(s)`);
      if (values.json) console.log(JSON.stringify(reclaimed, null, 2));
      return 0;
    }

    case "leases":
      printLeases(store.list({ project: values.project, worktree: values.worktree }), values.json);
      return 0;

    default:
      throw new Error(`Unknown command "${command ?? ""}". Use: acquire | release | gc | leases | whoami | hook`);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  );
}
