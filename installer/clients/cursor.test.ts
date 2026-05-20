import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeCursorAdapter } from "./cursor";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("cursor adapter", () => {
  it("configPath() returns ~/.cursor/mcp.json", () => {
    const adapter = makeCursorAdapter({ homeDir: tmpDir });
    expect(adapter.configPath()).toBe(path.join(tmpDir, ".cursor", "mcp.json"));
  });

  it("detect() returns installed:true when ~/.cursor/ exists", async () => {
    await fs.mkdir(path.join(tmpDir, ".cursor"));
    const adapter = makeCursorAdapter({ homeDir: tmpDir });
    const result = await adapter.detect();
    expect(result.installed).toBe(true);
  });

  it("detect() returns installed:false when ~/.cursor/ does not exist", async () => {
    const adapter = makeCursorAdapter({ homeDir: tmpDir });
    const result = await adapter.detect();
    expect(result.installed).toBe(false);
  });

  it("buildEntry() returns mcpServers entry with command:bun", () => {
    const adapter = makeCursorAdapter({ homeDir: tmpDir });
    const entry = adapter.buildEntry("/path/server.ts");
    expect(entry.key).toBe("mcpServers");
    expect(entry.name).toBe("port-registry");
    expect((entry.value as any).command).toBe("bun");
    expect((entry.value as any).args).toEqual(["/path/server.ts"]);
  });

  it("write() merges under mcpServers in ~/.cursor/mcp.json", async () => {
    await fs.mkdir(path.join(tmpDir, ".cursor"));
    const adapter = makeCursorAdapter({ homeDir: tmpDir });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(adapter.configPath(), "utf8"));
    expect(written.mcpServers?.["port-registry"]).toBeDefined();
  });
});
