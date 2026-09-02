import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeHooks, installHooks, installSkill, MANAGED_MARKER } from "./claude-code-extras";

const CMD = "/home/u/.local/bin/port-registry";
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cc-extras-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function skillSource(): string {
  const src = join(home, "repo", "skills", "port-setup");
  mkdirSync(join(src, "assets"), { recursive: true });
  writeFileSync(join(src, "SKILL.md"), `---\nname: port-setup\nmetadata:\n  ${MANAGED_MARKER}\n---\nbody v1\n`);
  writeFileSync(join(src, "assets", "detection-map.json"), "{}\n");
  return src;
}

describe("mergeHooks", () => {
  test("adds SessionStart gc and WorktreeRemove release to empty settings", () => {
    const { outcome, settings } = mergeHooks({}, CMD);
    expect(outcome).toBe("merged");
    const hooks = settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    expect(hooks.SessionStart![0]!.hooks[0]!.command).toBe(`"${CMD}" hook gc`);
    expect(hooks.WorktreeRemove![0]!.hooks[0]!.command).toBe(`"${CMD}" hook release`);
  });

  test("keeps unrelated hooks and other top-level settings intact", () => {
    const existing = {
      model: "opus",
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
    };
    const { settings } = mergeHooks(existing, CMD);
    expect(settings.model).toBe("opus");
    const start = (settings.hooks as any).SessionStart;
    expect(start).toHaveLength(2);
    expect(start[0].hooks[0].command).toBe("echo hi");
  });

  test("is idempotent: a second merge is skipped", () => {
    const first = mergeHooks({}, CMD).settings;
    const second = mergeHooks(first, CMD);
    expect(second.outcome).toBe("skipped");
    expect((second.settings.hooks as any).SessionStart).toHaveLength(1);
  });

  test("repoints a stale port-registry hook that used another path", () => {
    const first = mergeHooks({}, "/old/path/port-registry").settings;
    const second = mergeHooks(first, CMD);
    expect(second.outcome).toBe("merged");
    const start = (second.settings.hooks as any).SessionStart;
    expect(start).toHaveLength(1);
    expect(start[0].hooks[0].command).toBe(`"${CMD}" hook gc`);
  });
});

describe("installHooks", () => {
  test("writes ~/.claude/settings.json, then reports already-configured", async () => {
    const r1 = await installHooks({ homeDir: home, command: CMD });
    expect(r1.status).toBe("configured");
    const file = join(home, ".claude", "settings.json");
    expect(JSON.parse(readFileSync(file, "utf8")).hooks.WorktreeRemove).toHaveLength(1);
    const r2 = await installHooks({ homeDir: home, command: CMD });
    expect(r2.status).toBe("already-configured");
  });

  test("backs up an existing settings file before changing it", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), '{"model":"opus"}\n');
    const r = await installHooks({ homeDir: home, command: CMD });
    expect(r.status === "configured" && r.backup).toBeTruthy();
    expect(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")).model).toBe("opus");
  });
});

describe("installSkill", () => {
  test("copies SKILL.md and assets into ~/.claude/skills/port-setup", async () => {
    const r = await installSkill({ homeDir: home, sourceDir: skillSource() });
    expect(r.status).toBe("configured");
    expect(existsSync(join(home, ".claude", "skills", "port-setup", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".claude", "skills", "port-setup", "assets", "detection-map.json"))).toBe(true);
  });

  test("reports already-configured when the managed copy is identical", async () => {
    const src = skillSource();
    await installSkill({ homeDir: home, sourceDir: src });
    expect((await installSkill({ homeDir: home, sourceDir: src })).status).toBe("already-configured");
  });

  test("upgrades a managed copy when the source changed", async () => {
    const src = skillSource();
    await installSkill({ homeDir: home, sourceDir: src });
    writeFileSync(join(src, "SKILL.md"), `---\nname: port-setup\nmetadata:\n  ${MANAGED_MARKER}\n---\nbody v2\n`);
    const r = await installSkill({ homeDir: home, sourceDir: src });
    expect(r.status).toBe("configured");
    expect(readFileSync(join(home, ".claude", "skills", "port-setup", "SKILL.md"), "utf8")).toContain("body v2");
  });

  test("leaves a hand-written skill (no marker) untouched and says so", async () => {
    const target = join(home, ".claude", "skills", "port-setup");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "SKILL.md"), "---\nname: port-setup\n---\nmine\n");
    const r = await installSkill({ homeDir: home, sourceDir: skillSource() });
    expect(r.status).toBe("failed");
    expect(r.status === "failed" && r.error).toMatch(/hand-written|not managed/i);
    expect(readFileSync(join(target, "SKILL.md"), "utf8")).toContain("mine");
  });
});
