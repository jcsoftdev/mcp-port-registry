import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type LinkOutcome =
  | { status: "linked" | "updated" | "already-linked"; path: string }
  | { status: "failed"; path: string; error: string };

export interface LinkOptions {
  /** Absolute path to the launcher inside the repo (bin/port-registry). */
  target: string;
  /** Directory that should be on PATH. Defaults to ~/.local/bin. */
  binDir?: string;
  name?: string;
}

export function defaultBinDir(): string {
  return path.join(os.homedir(), ".local", "bin");
}

/** Expose the launcher as a command by symlinking it into `binDir`. */
export function linkCli(opts: LinkOptions): LinkOutcome {
  const binDir = opts.binDir ?? defaultBinDir();
  const link = path.join(binDir, opts.name ?? "port-registry");

  try {
    mkdirSync(binDir, { recursive: true });

    if (existsSync(link) || isDanglingSymlink(link)) {
      if (!lstatSync(link).isSymbolicLink()) {
        return { status: "failed", path: link, error: `${link} exists and is not a symlink; refusing to overwrite it.` };
      }
      if (readlinkSync(link) === opts.target) return { status: "already-linked", path: link };
      unlinkSync(link);
      symlinkSync(opts.target, link);
      return { status: "updated", path: link };
    }

    symlinkSync(opts.target, link);
    return { status: "linked", path: link };
  } catch (err) {
    return { status: "failed", path: link, error: err instanceof Error ? err.message : String(err) };
  }
}

function isDanglingSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function isOnPath(dir: string, pathEnv: string = process.env.PATH ?? ""): boolean {
  const wanted = path.resolve(dir);
  return pathEnv.split(path.delimiter).some((p) => p.length > 0 && path.resolve(p) === wanted);
}
