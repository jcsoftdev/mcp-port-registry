import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileExists, dirExists, whichBinary } from "./detect";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "detect-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("fileExists", () => {
  it("returns true when the file exists", async () => {
    const p = path.join(tmpDir, "test.json");
    await fs.writeFile(p, "{}", "utf8");
    expect(await fileExists(p)).toBe(true);
  });

  it("returns false when the file does not exist", async () => {
    expect(await fileExists(path.join(tmpDir, "nope.json"))).toBe(false);
  });

  it("returns false when path is a directory", async () => {
    expect(await fileExists(tmpDir)).toBe(false);
  });
});

describe("dirExists", () => {
  it("returns true when the directory exists", async () => {
    expect(await dirExists(tmpDir)).toBe(true);
  });

  it("returns false when the directory does not exist", async () => {
    expect(await dirExists(path.join(tmpDir, "no-such-dir"))).toBe(false);
  });

  it("returns false when path is a file", async () => {
    const p = path.join(tmpDir, "file.txt");
    await fs.writeFile(p, "x", "utf8");
    expect(await dirExists(p)).toBe(false);
  });
});

describe("whichBinary", () => {
  it("returns true for a binary that is in PATH (bun)", async () => {
    // bun is definitely installed since we're running tests with it
    expect(await whichBinary("bun")).toBe(true);
  });

  it("returns false for a binary that is definitely not in PATH", async () => {
    expect(await whichBinary("this-binary-does-not-exist-zzzxxx")).toBe(false);
  });
});
