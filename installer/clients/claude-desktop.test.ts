import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeClaudeDesktopAdapter } from "./claude-desktop";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-desktop-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("claude-desktop adapter", () => {
  it("configPath() returns macOS path when platform is darwin", () => {
    const adapter = makeClaudeDesktopAdapter({ homeDir: tmpDir, platform: "darwin" });
    expect(adapter.configPath()).toBe(
      path.join(tmpDir, "Library", "Application Support", "Claude", "claude_desktop_config.json")
    );
  });

  it("configPath() returns Linux path when platform is linux", () => {
    const adapter = makeClaudeDesktopAdapter({ homeDir: tmpDir, platform: "linux" });
    expect(adapter.configPath()).toBe(
      path.join(tmpDir, ".config", "Claude", "claude_desktop_config.json")
    );
  });

  it("buildEntry() returns mcpServers entry with command:bun and args array", () => {
    const adapter = makeClaudeDesktopAdapter({ homeDir: tmpDir, platform: "darwin" });
    const entry = adapter.buildEntry("/path/server.ts");
    expect(entry.key).toBe("mcpServers");
    expect(entry.name).toBe("port-registry");
    expect((entry.value as any).command).toBe("bun");
    expect((entry.value as any).args).toEqual(["/path/server.ts"]);
  });

  it("write() creates config file and merges under mcpServers", async () => {
    const adapter = makeClaudeDesktopAdapter({ homeDir: tmpDir, platform: "darwin" });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const configPath = adapter.configPath();
    const written = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(written.mcpServers?.["port-registry"]).toBeDefined();
  });
});
