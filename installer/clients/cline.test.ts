import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeClineAdapter } from "./cline";

let tmpDir: string;

// macOS globalStorage path relative to homeDir
const macosGlobalStorageSuffix = [
  "Library", "Application Support", "Code", "User",
  "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"
];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("cline adapter", () => {
  it("configPath() returns macOS globalStorage path on darwin", () => {
    const adapter = makeClineAdapter({ homeDir: tmpDir, platform: "darwin" });
    expect(adapter.configPath()).toBe(path.join(tmpDir, ...macosGlobalStorageSuffix));
  });

  it("detect() returns installed:true when globalStorage dir exists", async () => {
    const storagePath = path.join(
      tmpDir, "Library", "Application Support", "Code", "User",
      "globalStorage", "saoudrizwan.claude-dev"
    );
    await fs.mkdir(storagePath, { recursive: true });
    const adapter = makeClineAdapter({ homeDir: tmpDir, platform: "darwin" });
    const result = await adapter.detect();
    expect(result.installed).toBe(true);
  });

  it("detect() returns installed:false when globalStorage dir is absent", async () => {
    const adapter = makeClineAdapter({ homeDir: tmpDir, platform: "darwin" });
    const result = await adapter.detect();
    expect(result.installed).toBe(false);
  });

  it("buildEntry() returns mcpServers entry with command:bun", () => {
    const adapter = makeClineAdapter({ homeDir: tmpDir, platform: "darwin" });
    const entry = adapter.buildEntry("/path/server.ts");
    expect(entry.key).toBe("mcpServers");
    expect(entry.name).toBe("port-registry");
    expect((entry.value as any).command).toBe("bun");
    expect((entry.value as any).args).toEqual(["/path/server.ts"]);
  });

  it("write() creates config and merges under mcpServers", async () => {
    const adapter = makeClineAdapter({ homeDir: tmpDir, platform: "darwin" });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(adapter.configPath(), "utf8"));
    expect(written.mcpServers?.["port-registry"]).toBeDefined();
  });
});
