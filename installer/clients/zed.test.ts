import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeZedAdapter } from "./zed";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zed-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("zed adapter", () => {
  it("configPath() returns ~/.config/zed/settings.json", () => {
    const adapter = makeZedAdapter({ homeDir: tmpDir });
    expect(adapter.configPath()).toBe(
      path.join(tmpDir, ".config", "zed", "settings.json")
    );
  });

  it("buildEntry() uses context_servers key (NOT mcpServers)", () => {
    const adapter = makeZedAdapter({ homeDir: tmpDir });
    const entry = adapter.buildEntry("/path/server.ts");
    expect(entry.key).toBe("context_servers");
    expect(entry.name).toBe("port-registry");
    // Zed shape: { command: { path: "bun", args: [...] } }
    expect((entry.value as any).command.path).toBe("bun");
    expect((entry.value as any).command.args).toEqual(["/path/server.ts"]);
  });

  it("write() writes context_servers key to settings.json", async () => {
    const adapter = makeZedAdapter({ homeDir: tmpDir });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(adapter.configPath(), "utf8"));
    expect(written.context_servers?.["port-registry"]).toBeDefined();
    expect(written.mcpServers).toBeUndefined(); // must NOT write mcpServers
  });

  it("write() preserves existing Zed settings keys", async () => {
    await fs.mkdir(path.join(tmpDir, ".config", "zed"), { recursive: true });
    const existing = { theme: "dark", "context_servers": {} };
    await fs.writeFile(
      path.join(tmpDir, ".config", "zed", "settings.json"),
      JSON.stringify(existing),
      "utf8"
    );
    const adapter = makeZedAdapter({ homeDir: tmpDir });
    await adapter.write("/path/server.ts");
    const written = JSON.parse(
      await fs.readFile(adapter.configPath(), "utf8")
    );
    expect(written.theme).toBe("dark");
    expect(written.context_servers?.["port-registry"]).toBeDefined();
  });
});
