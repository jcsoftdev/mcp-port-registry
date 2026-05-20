import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makePiAdapter } from "./pi";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("pi adapter", () => {
  it("configPath() returns ~/.config/mcp/mcp.json", () => {
    const adapter = makePiAdapter({ homeDir: tmpDir });
    expect(adapter.configPath()).toBe(path.join(tmpDir, ".config", "mcp", "mcp.json"));
  });

  it("detect() returns installed:true when ~/.config/mcp/ exists", async () => {
    await fs.mkdir(path.join(tmpDir, ".config", "mcp"), { recursive: true });
    const adapter = makePiAdapter({ homeDir: tmpDir });
    const result = await adapter.detect();
    expect(result.installed).toBe(true);
  });

  it("detect() returns installed:false when ~/.config/mcp/ does not exist", async () => {
    const adapter = makePiAdapter({ homeDir: tmpDir });
    const result = await adapter.detect();
    expect(result.installed).toBe(false);
  });

  it("buildEntry() returns mcpServers entry with command:bun and args", () => {
    const adapter = makePiAdapter({ homeDir: tmpDir });
    const entry = adapter.buildEntry("/path/server.ts");
    expect(entry.key).toBe("mcpServers");
    expect(entry.name).toBe("port-registry");
    expect((entry.value as any).command).toBe("bun");
    expect((entry.value as any).args).toEqual(["/path/server.ts"]);
  });

  it("write() creates config + merges under mcpServers", async () => {
    await fs.mkdir(path.join(tmpDir, ".config", "mcp"), { recursive: true });
    const adapter = makePiAdapter({ homeDir: tmpDir });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(adapter.configPath(), "utf8"));
    expect(written.mcpServers?.["port-registry"]).toBeDefined();
    expect(written.mcpServers["port-registry"].command).toBe("bun");
  });

  it("write() preserves existing mcpServers entries", async () => {
    await fs.mkdir(path.join(tmpDir, ".config", "mcp"), { recursive: true });
    const cfgPath = path.join(tmpDir, ".config", "mcp", "mcp.json");
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ mcpServers: { engram: { command: "engram", args: ["mcp"] } } }, null, 2),
      "utf8"
    );
    const adapter = makePiAdapter({ homeDir: tmpDir });
    await adapter.write("/path/server.ts");
    const written = JSON.parse(await fs.readFile(cfgPath, "utf8"));
    expect(written.mcpServers.engram).toBeDefined();
    expect(written.mcpServers["port-registry"]).toBeDefined();
  });

  it("write() returns already-configured on idempotent re-run", async () => {
    await fs.mkdir(path.join(tmpDir, ".config", "mcp"), { recursive: true });
    const adapter = makePiAdapter({ homeDir: tmpDir });
    const first = await adapter.write("/path/server.ts");
    expect(first.status).toBe("configured");
    const second = await adapter.write("/path/server.ts");
    expect(second.status).toBe("already-configured");
  });
});
