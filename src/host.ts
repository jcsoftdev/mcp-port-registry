import { existsSync, readFileSync } from "node:fs";

/** True when a process with this pid exists (EPERM still means it exists). */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

let cachedBootId: string | undefined;

/**
 * Identifier that changes on every reboot. A lease whose boot id differs from
 * the current one was taken by a process that cannot exist any more, even if
 * its pid number has been reused.
 */
export function readBootId(): string {
  if (cachedBootId !== undefined) return cachedBootId;

  const linux = "/proc/sys/kernel/random/boot_id";
  if (existsSync(linux)) {
    cachedBootId = readFileSync(linux, "utf8").trim();
    return cachedBootId;
  }

  try {
    // macOS: "{ sec = 1756700000, usec = 123456 } Mon Sep  1 ..."
    const out = Bun.spawnSync(["sysctl", "-n", "kern.boottime"]).stdout.toString();
    const sec = /sec\s*=\s*(\d+)/.exec(out)?.[1];
    if (sec) {
      cachedBootId = `boot-${sec}`;
      return cachedBootId;
    }
  } catch {
    // fall through
  }

  cachedBootId = "boot-unknown";
  return cachedBootId;
}

const PROBE_HOSTS = ["127.0.0.1", "::1"];

/**
 * Authoritative "is anything listening here right now" check: try to bind.
 * The registry DB records intent; only the OS knows the truth.
 */
export async function isPortFree(port: number, hosts: string[] = PROBE_HOSTS): Promise<boolean> {
  for (const hostname of hosts) {
    try {
      const listener = Bun.listen({ hostname, port, socket: { data() {} } });
      listener.stop(true);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE" || code === "EACCES") return false;
      // EAFNOSUPPORT / EADDRNOTAVAIL: this address family is not available; not a conflict.
    }
  }
  return true;
}
