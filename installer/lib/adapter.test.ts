import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAdapter } from "./adapter";
import type { Adapter, DetectResult, WriteOutcome } from "./adapter";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "run-adapter-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeTestAdapter(configFile: string): Adapter {
  return {
    id: "test",
    label: "Test Client",
    async detect(): Promise<DetectResult> {
      return { installed: true, configPath: configFile };
    },
    configPath(): string {
      return configFile;
    },
    buildEntry(serverPath: string) {
      return {
        key: "mcpServers",
        name: "port-registry",
        value: { command: "bun", args: [serverPath] },
      };
    },
    async write(serverPath: string): Promise<WriteOutcome> {
      // Simulate the full orchestration inline for integration tests
      const { readJson, mergeServer, writeJson } = await import("./json-config");
      const { backup } = await import("./fs-atomic");
      await fs.mkdir(path.dirname(configFile), { recursive: true });
      const existing = await readJson(configFile);
      const { outcome, config } = mergeServer(existing, "mcpServers", "port-registry", {
        command: "bun",
        args: [serverPath],
      });
      if (outcome === "skipped") return { status: "already-configured" };
      const bak = await backup(configFile);
      await writeJson(configFile, config);
      return { status: "configured", backup: bak };
    },
  };
}

describe("runAdapter", () => {
  it("returns configured WriteOutcome when adapter.write() succeeds", async () => {
    const configFile = path.join(tmpDir, "cfg.json");
    const adapter = makeTestAdapter(configFile);
    const result = await runAdapter(adapter, "/path/server.ts");
    expect(result.status).toBe("configured");
  });

  it("creates the config file on first run", async () => {
    const configFile = path.join(tmpDir, "subdir", "cfg.json");
    const adapter = makeTestAdapter(configFile);
    await runAdapter(adapter, "/path/server.ts");
    const exists = await fs.access(configFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("returns already-configured on idempotent second run", async () => {
    const configFile = path.join(tmpDir, "cfg.json");
    const adapter = makeTestAdapter(configFile);
    await runAdapter(adapter, "/path/server.ts");
    const second = await runAdapter(adapter, "/path/server.ts");
    expect(second.status).toBe("already-configured");
  });

  it("creates a backup before writing when file already exists", async () => {
    const configFile = path.join(tmpDir, "cfg.json");
    await fs.writeFile(configFile, JSON.stringify({ existing: true }), "utf8");
    const adapter = makeTestAdapter(configFile);
    const result = await runAdapter(adapter, "/path/server.ts");
    expect(result.status).toBe("configured");
    if (result.status === "configured") {
      expect(result.backup).not.toBeNull();
      // backup file should exist
      const bakExists = await fs.access(result.backup!).then(() => true).catch(() => false);
      expect(bakExists).toBe(true);
    }
  });

  it("returns failed status when adapter.write() throws", async () => {
    const brokenAdapter: Adapter = {
      id: "broken",
      label: "Broken",
      async detect() { return { installed: true, configPath: "/tmp/x" }; },
      configPath() { return "/tmp/x"; },
      buildEntry(_: string) { return { key: "k", name: "n", value: {} }; },
      async write(_: string): Promise<WriteOutcome> {
        throw new Error("Disk full");
      },
    };
    const result = await runAdapter(brokenAdapter, "/path/server.ts");
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toContain("Disk full");
    }
  });
});
