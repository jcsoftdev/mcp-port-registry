import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
let dir: string;
let env: Record<string, string>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "port-registry-hook-"));
  env = { ...process.env, PORT_REGISTRY_DB: join(dir, "registry.db"), PORT_REGISTRY_SKIP_PROBE: "1", HOME: dir } as Record<string, string>;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function hook(mode: string, stdin: string, cwd = dir) {
  const p = Bun.spawn(["bun", CLI, "hook", mode], { cwd, env, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  return { code: await p.exited, stderr: await new Response(p.stderr).text() };
}
async function cli(args: string[], cwd = dir) {
  const p = Bun.spawn(["bun", CLI, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  return (await new Response(p.stdout).text()).trim();
}
function sh(cmd: string[], cwd: string) {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
}
function makeRepo(): string {
  const repo = join(dir, "repo");
  sh(["git", "init", "-q", "-b", "main", repo], dir);
  sh(["git", "-C", repo, "remote", "add", "origin", "https://github.com/jcsoftdev/my-app.git"], dir);
  sh(["git", "-C", repo, "commit", "-q", "--allow-empty", "-m", "init"], dir);
  return repo;
}

describe("port-registry hook <mode> (Claude Code adapter)", () => {
  test("release frees the leases of the worktree named by cwd in the payload", async () => {
    const repo = makeRepo();
    const wt = join(dir, "wt-a");
    sh(["git", "-C", repo, "worktree", "add", "-q", "-b", "feat/a", wt], dir);
    await cli(["acquire", "--technology", "redis"], wt);
    expect(JSON.parse(await cli(["leases", "--json"]))).toHaveLength(1);

    const r = await hook("release", JSON.stringify({ hook_event_name: "WorktreeRemove", cwd: wt }));
    expect(r.code).toBe(0);
    expect(JSON.parse(await cli(["leases", "--json"]))).toEqual([]);
  });

  test("release prefers worktree_path over cwd when both are present", async () => {
    const repo = makeRepo();
    const wt = join(dir, "wt-b");
    sh(["git", "-C", repo, "worktree", "add", "-q", "-b", "feat/b", wt], dir);
    await cli(["acquire", "--technology", "redis"], wt);
    await hook("release", JSON.stringify({ worktree_path: wt, cwd: repo }));
    expect(JSON.parse(await cli(["leases", "--json"]))).toEqual([]);
  });

  test("gc reconciles the repo in cwd against its live worktrees", async () => {
    const repo = makeRepo();
    await cli(["acquire", "--project", "my-app", "--worktree", "wt-gone", "--technology", "redis"], repo);
    const r = await hook("gc", JSON.stringify({ hook_event_name: "SessionStart", cwd: repo }));
    expect(r.code).toBe(0);
    expect(JSON.parse(await cli(["leases", "--json"]))).toEqual([]);
  });

  test("never fails the hook: garbage payload, missing directory and unknown mode all exit 0", async () => {
    expect((await hook("release", "not json")).code).toBe(0);
    expect((await hook("gc", JSON.stringify({ cwd: "/nope/missing" }))).code).toBe(0);
    expect((await hook("bogus", "{}")).code).toBe(0);
  });

  test("log appends the raw payload under $HOME/.cache", async () => {
    await hook("log", '{"hook_event_name":"WorktreeCreate","name":"x"}');
    const log = await Bun.file(join(dir, ".cache", "mcp-port-registry", "hooks.log")).text();
    expect(log).toContain('"hook_event_name":"WorktreeCreate"');
  });
});
