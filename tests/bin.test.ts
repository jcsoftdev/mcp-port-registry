import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "bin", "port-registry");
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "port-registry-bin-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function run(cmd: string[], cwd: string, stdin?: string) {
  const p = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, PORT_REGISTRY_DB: join(dir, "registry.db"), PORT_REGISTRY_SKIP_PROBE: "1", HOME: dir },
    stdin: stdin === undefined ? undefined : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout: stdout.trim(), stderr, code };
}

describe("bin/port-registry launcher", () => {
  test("runs the CLI directly", async () => {
    const r = await run([BIN, "whoami", "--json"], dir);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).worktree).toBe("main");
  });

  test("resolves the repo through a symlink, the way ~/.local/bin installs it", async () => {
    const link = join(dir, "port-registry");
    symlinkSync(BIN, link);
    const r = await run([link, "acquire", "--project", "demo", "--worktree", "wt", "--technology", "redis"], dir);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("PORT_REDIS=6379");
  });

  test("propagates the CLI exit code", async () => {
    const r = await run([BIN, "nope"], dir);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/Unknown command/);
  });
});
