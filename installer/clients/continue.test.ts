import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeContinueAdapter } from "./continue";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "continue-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("continue adapter", () => {
  it("configPath() returns ~/.continue/config.yaml", () => {
    const adapter = makeContinueAdapter({ homeDir: tmpDir });
    expect(adapter.configPath()).toBe(path.join(tmpDir, ".continue", "config.yaml"));
  });

  it("detect() returns installed:true when ~/.continue/ exists", async () => {
    await fs.mkdir(path.join(tmpDir, ".continue"));
    const adapter = makeContinueAdapter({ homeDir: tmpDir });
    const result = await adapter.detect();
    expect(result.installed).toBe(true);
  });

  it("detect() returns installed:false when ~/.continue/ does not exist", async () => {
    const adapter = makeContinueAdapter({ homeDir: tmpDir });
    const result = await adapter.detect();
    expect(result.installed).toBe(false);
  });

  it("write() creates missing config.yaml with port-registry entry", async () => {
    await fs.mkdir(path.join(tmpDir, ".continue"));
    const adapter = makeContinueAdapter({ homeDir: tmpDir });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const raw = await fs.readFile(adapter.configPath(), "utf8");
    expect(raw).toContain("port-registry");
    expect(raw).toContain("bun");
  });

  it("write() returns already-configured on idempotent re-run", async () => {
    await fs.mkdir(path.join(tmpDir, ".continue"));
    const adapter = makeContinueAdapter({ homeDir: tmpDir });
    const first = await adapter.write("/path/server.ts");
    expect(first.status).toBe("configured");
    const second = await adapter.write("/path/server.ts");
    expect(second.status).toBe("already-configured");
  });

  it("write() preserves existing YAML entries", async () => {
    await fs.mkdir(path.join(tmpDir, ".continue"));
    const existingYaml = `mcpServers:\n  - name: other-server\n    command: node\n    args:\n      - other.js\n`;
    await fs.writeFile(path.join(tmpDir, ".continue", "config.yaml"), existingYaml, "utf8");
    const adapter = makeContinueAdapter({ homeDir: tmpDir });
    await adapter.write("/path/server.ts");
    const raw = await fs.readFile(adapter.configPath(), "utf8");
    expect(raw).toContain("other-server");
    expect(raw).toContain("port-registry");
  });
});
