import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readYaml, mergeServer, writeYaml } from "./yaml-config";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yaml-config-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("mergeServer (YAML sequence upsert)", () => {
  it("adds a new entry when mcpServers list is empty", () => {
    const config = { mcpServers: [] as any[] };
    const result = mergeServer(config, "port-registry", {
      name: "port-registry",
      command: "bun",
      args: ["/path/server.ts"],
    });
    expect(result.outcome).toBe("merged");
    expect(result.config.mcpServers).toHaveLength(1);
    expect(result.config.mcpServers[0].name).toBe("port-registry");
  });

  it("replaces an existing entry by name", () => {
    const config = {
      mcpServers: [
        { name: "port-registry", command: "bun", args: ["/old.ts"] },
        { name: "other", command: "node", args: ["other.js"] },
      ],
    };
    const result = mergeServer(config, "port-registry", {
      name: "port-registry",
      command: "bun",
      args: ["/new.ts"],
    });
    expect(result.outcome).toBe("merged");
    const pr = result.config.mcpServers.find(
      (e: any) => e.name === "port-registry"
    );
    expect(pr.args[0]).toBe("/new.ts");
  });

  it("preserves existing entries when upserting", () => {
    const config = {
      mcpServers: [{ name: "other", command: "node", args: ["other.js"] }],
    };
    const result = mergeServer(config, "port-registry", {
      name: "port-registry",
      command: "bun",
      args: ["/path.ts"],
    });
    expect(result.config.mcpServers).toHaveLength(2);
    expect(result.config.mcpServers.find((e: any) => e.name === "other")).toBeDefined();
  });

  it("returns outcome:skipped when entry already matches deeply", () => {
    const config = {
      mcpServers: [
        { name: "port-registry", command: "bun", args: ["/same.ts"] },
      ],
    };
    const result = mergeServer(config, "port-registry", {
      name: "port-registry",
      command: "bun",
      args: ["/same.ts"],
    });
    expect(result.outcome).toBe("skipped");
    expect(result.config).toBe(config);
  });

  it("creates minimal config structure when mcpServers key is absent", () => {
    const config = {};
    const result = mergeServer(config as any, "port-registry", {
      name: "port-registry",
      command: "bun",
      args: ["/path.ts"],
    });
    expect(result.config.mcpServers).toHaveLength(1);
  });
});

describe("readYaml / writeYaml", () => {
  it("readYaml returns {} for a missing file", async () => {
    const result = await readYaml(path.join(tmpDir, "missing.yaml"));
    expect(result).toEqual({});
  });

  it("readYaml parses an existing YAML file", async () => {
    const p = path.join(tmpDir, "cfg.yaml");
    await fs.writeFile(p, "foo: bar\n", "utf8");
    const result = await readYaml(p);
    expect(result).toEqual({ foo: "bar" });
  });

  it("writeYaml writes valid YAML", async () => {
    const p = path.join(tmpDir, "out.yaml");
    await writeYaml(p, { mcpServers: [{ name: "pr", command: "bun", args: [] }] });
    const raw = await fs.readFile(p, "utf8");
    expect(raw).toContain("mcpServers");
    expect(raw).toContain("name: pr");
  });
});
