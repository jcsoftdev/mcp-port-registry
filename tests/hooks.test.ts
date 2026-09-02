import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "..", "hooks", "claude-code", "port-registry-hook.sh");
const CLI = join(import.meta.dir, "..", "src", "cli.ts");

let dir: string;
let dbPath: string;
let env: Record<string, string>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "port-registry-hook-"));
  dbPath = join(dir, "registry.db");
  env = { ...process.env, PORT_REGISTRY_DB: dbPath, PORT_REGISTRY_SKIP_PROBE: "1", HOME: dir } as Record<string, string>;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function runHook(mode: string, stdin: string, cwd = dir) {
  const p = Bun.spawn(["bash", HOOK, mode], { cwd, env, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
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

describe("claude-code hook adapter", () => {
  test("release mode frees the leases of the worktree named by cwd in the payload", async () => {
    const repo = join(dir, "repo");
    sh(["git", "init", "-q", "-b", "main", repo], dir);
    sh(["git", "-C", repo, "remote", "add", "origin", "https://github.com/jcsoftdev/my-app.git"], dir);
    sh(["git", "-C", repo, "commit", "-q", "--allow-empty", "-m", "init"], dir);
    const wt = join(dir, "wt-a");
    sh(["git", "-C", repo, "worktree", "add", "-q", "-b", "feat/a", wt], dir);
    await cli(["acquire", "--technology", "redis"], wt);
    expect(JSON.parse(await cli(["leases", "--json"]))).toHaveLength(1);

    const r = await runHook("release", JSON.stringify({ hook_event_name: "WorktreeRemove", cwd: wt }));
    expect(r.code).toBe(0);
    expect(JSON.parse(await cli(["leases", "--json"]))).toEqual([]);
  });

  test("gc mode reconciles the repo in cwd against its live worktrees", async () => {
    const repo = join(dir, "repo");
    sh(["git", "init", "-q", "-b", "main", repo], dir);
    sh(["git", "-C", repo, "remote", "add", "origin", "https://github.com/jcsoftdev/my-app.git"], dir);
    sh(["git", "-C", repo, "commit", "-q", "--allow-empty", "-m", "init"], dir);
    await cli(["acquire", "--project", "my-app", "--worktree", "feat/gone", "--technology", "redis"], repo);

    const r = await runHook("gc", JSON.stringify({ hook_event_name: "SessionStart", cwd: repo }));
    expect(r.code).toBe(0);
    expect(JSON.parse(await cli(["leases", "--json"]))).toEqual([]);
  });

  test("never fails the hook: garbage payload and unknown directory still exit 0", async () => {
    expect((await runHook("release", "not json")).code).toBe(0);
    expect((await runHook("gc", JSON.stringify({ cwd: "/nope/missing" }))).code).toBe(0);
  });

  test("log mode appends the raw payload under $HOME/.cache", async () => {
    await runHook("log", '{"hook_event_name":"WorktreeCreate","name":"x"}');
    const log = await Bun.file(join(dir, ".cache", "mcp-port-registry", "hooks.log")).text();
    expect(log).toContain('"hook_event_name":"WorktreeCreate"');
  });
});
