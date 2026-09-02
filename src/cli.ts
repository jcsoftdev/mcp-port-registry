#!/usr/bin/env bun
/**
 * Hook-friendly CLI over the same SQLite registry the MCP server uses.
 *
 *   bun src/cli.ts acquire --project P --worktree W --technology T [--technology T2] [--json]
 *   bun src/cli.ts release --project P --worktree W [--technology T]
 *   bun src/cli.ts gc [--project P --worktrees a,b] | [--auto]
 *   bun src/cli.ts leases [--project P] [--worktree W] [--json]
 *   bun src/cli.ts whoami [--json]        # project + worktree derived from git in cwd
 *
 * `acquire` prints PORT_<TECHNOLOGY>=<port> lines, ready for `>> "$CLAUDE_ENV_FILE"` or `.env`.
 */
import { parseArgs } from "node:util";
import { basename, resolve } from "node:path";
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

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const worktree = branch && branch !== "HEAD" ? branch : basename(top);
  return { project, worktree, isMain };
}

/** Worktree ids (branch name, or directory basename when detached) of every live worktree. */
export function listLiveWorktrees(cwd: string): string[] {
  const out = git(["worktree", "list", "--porcelain"], cwd);
  if (!out) return [];
  const ids: string[] = [];
  let path = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line.startsWith("branch ")) ids.push(line.slice("branch ".length).replace(/^refs\/heads\//, ""));
    else if (line === "detached") ids.push(basename(path));
  }
  return ids;
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

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
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

  const store: LeaseStore = createLeaseStore(openDb(), {
    // Tests and CI run without touching real sockets.
    ...(process.env.PORT_REGISTRY_SKIP_PROBE ? { isPortFree: async () => true } : {}),
  });

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
      throw new Error(`Unknown command "${command ?? ""}". Use: acquire | release | gc | leases | whoami`);
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
