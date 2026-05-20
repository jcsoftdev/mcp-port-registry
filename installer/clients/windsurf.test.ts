import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeWindsurfAdapter } from "./windsurf";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "windsurf-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("windsurf adapter", () => {
  it("configPath() returns ~/.codeium/windsurf/mcp_config.json", () => {
    const adapter = makeWindsurfAdapter({ homeDir: tmpDir });
    expect(adapter.configPath()).toBe(
      path.join(tmpDir, ".codeium", "windsurf", "mcp_config.json")
    );
  });

  it("detect() returns installed:true when ~/.codeium/windsurf/ exists", async () => {
    await fs.mkdir(path.join(tmpDir, ".codeium", "windsurf"), { recursive: true });
    const adapter = makeWindsurfAdapter({ homeDir: tmpDir });
    const result = await adapter.detect();
    expect(result.installed).toBe(true);
  });

  it("detect() returns installed:false when directory does not exist", async () => {
    const adapter = makeWindsurfAdapter({ homeDir: tmpDir });
    const result = await adapter.detect();
    expect(result.installed).toBe(false);
  });

  it("buildEntry() returns mcpServers entry with command:bun", () => {
    const adapter = makeWindsurfAdapter({ homeDir: tmpDir });
    const entry = adapter.buildEntry("/path/server.ts");
    expect(entry.key).toBe("mcpServers");
    expect(entry.name).toBe("port-registry");
    expect((entry.value as any).command).toBe("bun");
    expect((entry.value as any).args).toEqual(["/path/server.ts"]);
  });

  it("write() creates config and merges under mcpServers", async () => {
    const adapter = makeWindsurfAdapter({ homeDir: tmpDir });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(adapter.configPath(), "utf8"));
    expect(written.mcpServers?.["port-registry"]).toBeDefined();
  });
});
