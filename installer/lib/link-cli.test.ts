import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readlinkSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkCli, isOnPath } from "./link-cli";

let dir: string;
let target: string;
let binDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "link-cli-"));
  target = join(dir, "repo", "bin", "port-registry");
  binDir = join(dir, "home", ".local", "bin");
  Bun.spawnSync(["mkdir", "-p", join(dir, "repo", "bin")]);
  writeFileSync(target, "#!/bin/sh\n", { mode: 0o755 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("linkCli", () => {
  test("creates the bin dir and a symlink named port-registry", () => {
    const r = linkCli({ target, binDir });
    expect(r.status).toBe("linked");
    expect(r.path).toBe(join(binDir, "port-registry"));
    expect(readlinkSync(r.path)).toBe(target);
  });

  test("is idempotent when the link already points at the target", () => {
    linkCli({ target, binDir });
    expect(linkCli({ target, binDir }).status).toBe("already-linked");
  });

  test("repoints a symlink that targets an older install", () => {
    Bun.spawnSync(["mkdir", "-p", binDir]);
    symlinkSync(join(dir, "old", "port-registry"), join(binDir, "port-registry"));
    const r = linkCli({ target, binDir });
    expect(r.status).toBe("updated");
    expect(readlinkSync(r.path)).toBe(target);
  });

  test("refuses to clobber a regular file that is not ours", () => {
    Bun.spawnSync(["mkdir", "-p", binDir]);
    writeFileSync(join(binDir, "port-registry"), "someone else's script\n");
    const r = linkCli({ target, binDir });
    expect(r.status).toBe("failed");
    expect(r.status === "failed" && r.error).toMatch(/exists/);
    expect(lstatSync(join(binDir, "port-registry")).isSymbolicLink()).toBe(false);
  });
});

describe("isOnPath", () => {
  test("detects the bin dir in a PATH string", () => {
    expect(isOnPath(binDir, `/usr/bin:${binDir}:/bin`)).toBe(true);
    expect(isOnPath(binDir, "/usr/bin:/bin")).toBe(false);
  });
});
