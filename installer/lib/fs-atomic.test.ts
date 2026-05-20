import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWrite, backup } from "./fs-atomic";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-atomic-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("atomicWrite", () => {
  it("writes content to the target file", async () => {
    const target = path.join(tmpDir, "config.json");
    await atomicWrite(target, '{"a":1}');
    const content = await fs.readFile(target, "utf8");
    expect(content).toBe('{"a":1}');
  });

  it("leaves no tmp file after successful write", async () => {
    const target = path.join(tmpDir, "config.json");
    await atomicWrite(target, "hello");
    const files = await fs.readdir(tmpDir);
    // only the target file should exist
    expect(files).toEqual(["config.json"]);
  });

  it("overwrites existing file atomically", async () => {
    const target = path.join(tmpDir, "config.json");
    await fs.writeFile(target, "old", "utf8");
    await atomicWrite(target, "new");
    const content = await fs.readFile(target, "utf8");
    expect(content).toBe("new");
  });
});

describe("backup", () => {
  it("returns null when target does not exist", async () => {
    const target = path.join(tmpDir, "nonexistent.json");
    const result = await backup(target);
    expect(result).toBeNull();
  });

  it("creates a .bak.{timestamp} file when target exists", async () => {
    const target = path.join(tmpDir, "config.json");
    await fs.writeFile(target, '{"original":true}', "utf8");
    const bakPath = await backup(target);
    expect(bakPath).not.toBeNull();
    expect(bakPath).toMatch(/\.bak\./);
    // backup content matches original
    const bakContent = await fs.readFile(bakPath!, "utf8");
    expect(bakContent).toBe('{"original":true}');
  });

  it("backup filename uses ISO timestamp with colons replaced by hyphens", async () => {
    const target = path.join(tmpDir, "config.json");
    await fs.writeFile(target, "data", "utf8");
    const bakPath = await backup(target);
    expect(bakPath).not.toBeNull();
    // Should not contain colons (invalid on some FS)
    expect(bakPath!).not.toContain(":");
    // Should contain the .bak. marker
    expect(bakPath!).toContain(".bak.");
  });

  it("does not modify the original file", async () => {
    const target = path.join(tmpDir, "config.json");
    await fs.writeFile(target, "original", "utf8");
    await backup(target);
    const content = await fs.readFile(target, "utf8");
    expect(content).toBe("original");
  });
});
