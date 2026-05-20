import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// We import the adapter factory so tests can inject a custom home dir
import { makeClaudeCodeAdapter } from "./claude-code";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-code-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("claude-code adapter", () => {
  it("configPath() returns ~/.claude.json resolved to the injected home", () => {
    const adapter = makeClaudeCodeAdapter({ homeDir: tmpDir });
    expect(adapter.configPath()).toBe(path.join(tmpDir, ".claude.json"));
  });

  it("buildEntry() returns root-level mcpServers entry with type:stdio", () => {
    const adapter = makeClaudeCodeAdapter({ homeDir: tmpDir });
    const entry = adapter.buildEntry("/path/to/server.ts");
    expect(entry.key).toBe("mcpServers");
    expect(entry.name).toBe("port-registry");
    expect((entry.value as any).type).toBe("stdio");
    expect((entry.value as any).command).toBe("bun");
    expect((entry.value as any).args).toEqual(["/path/to/server.ts"]);
  });

  it("detect() returns installed:true when ~/.claude.json exists", async () => {
    await fs.writeFile(path.join(tmpDir, ".claude.json"), "{}", "utf8");
    const adapter = makeClaudeCodeAdapter({ homeDir: tmpDir });
    const result = await adapter.detect();
    expect(result.installed).toBe(true);
  });

  it("detect() returns installed:false when neither file nor binary exists", async () => {
    const adapter = makeClaudeCodeAdapter({
      homeDir: tmpDir,
      whichOverride: async () => false,
    });
    const result = await adapter.detect();
    expect(result.installed).toBe(false);
  });

  it("write() merges under ROOT mcpServers (not under projects)", async () => {
    const configFile = path.join(tmpDir, ".claude.json");
    await fs.writeFile(configFile, JSON.stringify({ projects: {} }), "utf8");
    const adapter = makeClaudeCodeAdapter({ homeDir: tmpDir });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(configFile, "utf8"));
    expect(written.mcpServers?.["port-registry"]).toBeDefined();
    expect(written.projects).toBeDefined(); // siblings preserved
    expect(written.projects?.["port-registry"]).toBeUndefined(); // NOT under projects
  });

  it("write() is idempotent — returns already-configured on second call", async () => {
    const adapter = makeClaudeCodeAdapter({ homeDir: tmpDir });
    await adapter.write("/path/server.ts");
    const second = await adapter.write("/path/server.ts");
    expect(second.status).toBe("already-configured");
  });
});
