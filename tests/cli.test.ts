import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "port-registry-cli-"));
  dbPath = join(dir, "registry.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function run(args: string[], cwd = dir) {
  const p = Bun.spawn(["bun", CLI, ...args], {
    cwd,
    env: { ...process.env, PORT_REGISTRY_DB: dbPath, PORT_REGISTRY_SKIP_PROBE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { stdout, stderr, code };
}

function sh(cmd: string[], cwd: string) {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

describe("cli acquire / release / gc", () => {
  test("acquire prints env-style lines by default", async () => {
    const r = await run(["acquire", "--project", "kanbai", "--worktree", "feat-a", "--technology", "redis", "--technology", "postgresql"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim().split("\n").sort()).toEqual(["PORT_POSTGRESQL=5432", "PORT_REDIS=6379"]);
  });

  test("acquire --json prints the leases", async () => {
    const r = await run(["acquire", "--project", "kanbai", "--worktree", "feat-a", "--technology", "redis", "--json"]);
    const body = JSON.parse(r.stdout);
    expect(body[0].port).toBe(6379);
    expect(body[0].worktree).toBe("feat-a");
  });

  test("release frees every lease of the worktree and reports how many", async () => {
    await run(["acquire", "--project", "kanbai", "--worktree", "feat-a", "--technology", "redis", "--technology", "postgresql"]);
    const r = await run(["release", "--project", "kanbai", "--worktree", "feat-a"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("released 2");
    const list = await run(["leases", "--json"]);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("gc --worktrees reclaims leases of worktrees that are gone", async () => {
    await run(["acquire", "--project", "kanbai", "--worktree", "feat-a", "--technology", "redis"]);
    await run(["acquire", "--project", "kanbai", "--worktree", "feat-b", "--technology", "redis"]);
    const r = await run(["gc", "--project", "kanbai", "--worktrees", "feat-b"]);
    expect(r.stdout).toContain("reclaimed 1");
  });

  test("unknown technology exits non-zero with the error on stderr", async () => {
    const r = await run(["acquire", "--project", "kanbai", "--worktree", "feat-a", "--technology", "cobol"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown technology/);
  });
});

describe("cli whoami (git context detection)", () => {
  test("derives project from the origin remote and worktree from the branch", async () => {
    const repo = join(dir, "repo");
    sh(["git", "init", "-q", "-b", "main", repo], dir);
    sh(["git", "-C", repo, "remote", "add", "origin", "git@github.com:jcsoftdev/My-App.git"], dir);
    sh(["git", "-C", repo, "commit", "-q", "--allow-empty", "-m", "init"], dir);
    sh(["git", "-C", repo, "worktree", "add", "-q", "-b", "feat/login", join(dir, "wt-login")], dir);

    const main = JSON.parse((await run(["whoami", "--json"], repo)).stdout);
    expect(main).toEqual({ project: "my-app", worktree: "main", isMain: true });

    const wt = JSON.parse((await run(["whoami", "--json"], join(dir, "wt-login"))).stdout);
    expect(wt).toEqual({ project: "my-app", worktree: "feat/login", isMain: false });
  });

  test("falls back to the directory basename outside a git repo", async () => {
    const r = JSON.parse((await run(["whoami", "--json"], dir)).stdout);
    expect(r.project).toBe(dir.split("/").pop()!.toLowerCase());
    expect(r.worktree).toBe("main");
  });

  test("gc --auto reconciles against the repo's live worktree list", async () => {
    const repo = join(dir, "repo");
    sh(["git", "init", "-q", "-b", "main", repo], dir);
    sh(["git", "-C", repo, "remote", "add", "origin", "https://github.com/jcsoftdev/my-app.git"], dir);
    sh(["git", "-C", repo, "commit", "-q", "--allow-empty", "-m", "init"], dir);
    sh(["git", "-C", repo, "worktree", "add", "-q", "-b", "feat/a", join(dir, "wt-a")], dir);
    await run(["acquire", "--project", "my-app", "--worktree", "feat/a", "--technology", "redis"], repo);
    await run(["acquire", "--project", "my-app", "--worktree", "feat/zombie", "--technology", "redis"], repo);
    const r = await run(["gc", "--auto"], repo);
    expect(r.stdout).toContain("reclaimed 1");
    const left = JSON.parse((await run(["leases", "--json"], repo)).stdout);
    expect(left.map((l: { worktree: string }) => l.worktree)).toEqual(["feat/a"]);
  });
});
