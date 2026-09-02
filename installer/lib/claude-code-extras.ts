import fs from "node:fs/promises";
import path from "node:path";
import type { WriteOutcome } from "./adapter";
import { readJson, writeJson } from "./json-config";
import { backup } from "./fs-atomic";

type AnyObject = Record<string, unknown>;

interface HookCommand {
  type: "command";
  command: string;
}
interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}

/** Line inside SKILL.md frontmatter that marks a copy as ours to upgrade. */
export const MANAGED_MARKER = "managed-by: mcp-port-registry";

const HOOK_EVENTS: Array<{ event: string; mode: string }> = [
  { event: "SessionStart", mode: "gc" },
  { event: "WorktreeRemove", mode: "release" },
];

function hookCommand(command: string, mode: string): string {
  return `"${command}" hook ${mode}`;
}

function isOurs(group: HookGroup): boolean {
  return group.hooks.some((h) => /port-registry(\.sh)?["']? hook /.test(h.command) || h.command.includes("port-registry-hook.sh"));
}

/**
 * Merge the port-registry hooks into a Claude Code settings object.
 * Unrelated hooks and settings are preserved; our own stale entries
 * (an older install path) are replaced rather than duplicated.
 */
export function mergeHooks(settings: AnyObject, command: string): { outcome: "merged" | "skipped"; settings: AnyObject } {
  const hooks = { ...((settings.hooks ?? {}) as Record<string, HookGroup[]>) };
  let changed = false;

  for (const { event, mode } of HOOK_EVENTS) {
    const wanted: HookGroup = { hooks: [{ type: "command", command: hookCommand(command, mode) }] };
    const current = Array.isArray(hooks[event]) ? hooks[event]! : [];
    const others = current.filter((g) => !isOurs(g));
    const ours = current.filter((g) => isOurs(g));
    const alreadyExact = ours.length === 1 && JSON.stringify(ours[0]) === JSON.stringify(wanted);
    if (alreadyExact) continue;
    hooks[event] = [...others, wanted];
    changed = true;
  }

  if (!changed) return { outcome: "skipped", settings };
  return { outcome: "merged", settings: { ...settings, hooks } };
}

export async function installHooks(opts: { homeDir: string; command: string }): Promise<WriteOutcome> {
  const file = path.join(opts.homeDir, ".claude", "settings.json");
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const existing = await readJson(file);
    const { outcome, settings } = mergeHooks(existing, opts.command);
    if (outcome === "skipped") return { status: "already-configured" };
    const bak = await backup(file);
    await writeJson(file, settings);
    return { status: "configured", backup: bak };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

/**
 * Copy the port-setup skill into ~/.claude/skills. A copy is upgraded only if
 * its SKILL.md carries MANAGED_MARKER; a hand-written skill is left untouched.
 */
export async function installSkill(opts: { homeDir: string; sourceDir: string; name?: string }): Promise<WriteOutcome> {
  const name = opts.name ?? path.basename(opts.sourceDir);
  const target = path.join(opts.homeDir, ".claude", "skills", name);
  try {
    const targetSkill = await readIfExists(path.join(target, "SKILL.md"));
    if (targetSkill !== null && !targetSkill.includes(MANAGED_MARKER)) {
      return {
        status: "failed",
        error: `${target} is a hand-written skill (no "${MANAGED_MARKER}" marker); left untouched.`,
      };
    }

    const files = await listFiles(opts.sourceDir);
    if (targetSkill !== null) {
      const targetFiles = await listFiles(target);
      let identical = JSON.stringify(targetFiles) === JSON.stringify(files);
      for (const rel of files) {
        if (!identical) break;
        const [a, b] = await Promise.all([fs.readFile(path.join(opts.sourceDir, rel)), fs.readFile(path.join(target, rel))]);
        identical = a.equals(b);
      }
      if (identical) return { status: "already-configured" };
      await fs.rm(target, { recursive: true, force: true });
    }

    await fs.cp(opts.sourceDir, target, { recursive: true });
    return { status: "configured", backup: null };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
