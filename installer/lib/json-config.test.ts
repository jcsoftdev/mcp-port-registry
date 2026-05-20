import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJson, mergeServer, writeJson } from "./json-config";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "json-config-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("mergeServer", () => {
  it("adds a new server entry under the specified top-level key", () => {
    const config = {};
    const result = mergeServer(config, "mcpServers", "port-registry", {
      command: "bun",
      args: ["/path/server.ts"],
    });
    expect(result.outcome).toBe("merged");
    expect(result.config).toEqual({
      mcpServers: {
        "port-registry": { command: "bun", args: ["/path/server.ts"] },
      },
    });
  });

  it("replaces an existing server entry with a different value", () => {
    const config = {
      mcpServers: {
        "port-registry": { command: "bun", args: ["/old/path.ts"] },
      },
    };
    const result = mergeServer(config, "mcpServers", "port-registry", {
      command: "bun",
      args: ["/new/path.ts"],
    });
    expect(result.outcome).toBe("merged");
    expect((result.config as any).mcpServers["port-registry"].args[0]).toBe(
      "/new/path.ts"
    );
  });

  it("preserves sibling entries under the top-level key", () => {
    const config = {
      mcpServers: {
        "other-server": { command: "node", args: ["other.js"] },
      },
    };
    const result = mergeServer(config, "mcpServers", "port-registry", {
      command: "bun",
      args: ["/path/server.ts"],
    });
    expect(result.outcome).toBe("merged");
    expect((result.config as any).mcpServers["other-server"]).toEqual({
      command: "node",
      args: ["other.js"],
    });
  });

  it("returns skipped when the entry is already identical (idempotency)", () => {
    const entry = { command: "bun", args: ["/path/server.ts"] };
    const config = { mcpServers: { "port-registry": entry } };
    const result = mergeServer(config, "mcpServers", "port-registry", entry);
    expect(result.outcome).toBe("skipped");
  });

  it("preserves unrelated top-level config keys", () => {
    const config = { theme: "dark", mcpServers: {} };
    const result = mergeServer(config, "mcpServers", "port-registry", {
      command: "bun",
      args: [],
    });
    expect((result.config as any).theme).toBe("dark");
  });
});

describe("readJson / writeJson", () => {
  it("readJson returns {} for a missing file", async () => {
    const result = await readJson(path.join(tmpDir, "missing.json"));
    expect(result).toEqual({});
  });

  it("readJson parses an existing JSON file", async () => {
    const p = path.join(tmpDir, "cfg.json");
    await fs.writeFile(p, JSON.stringify({ foo: "bar" }), "utf8");
    const result = await readJson(p);
    expect(result).toEqual({ foo: "bar" });
  });

  it("writeJson writes pretty JSON with trailing newline", async () => {
    const p = path.join(tmpDir, "out.json");
    await writeJson(p, { key: "value" });
    const raw = await fs.readFile(p, "utf8");
    expect(raw).toContain('"key": "value"');
    expect(raw.endsWith("\n")).toBe(true);
  });
});
