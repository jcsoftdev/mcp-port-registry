import { describe, test, expect } from "bun:test";
import { isPidAlive, isPortFree, readBootId } from "../src/host";

describe("host probes", () => {
  test("isPidAlive is true for this process and false for a pid nobody owns", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(2 ** 22 - 1)).toBe(false);
  });

  test("isPortFree is false while a listener holds the port and true once released", async () => {
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    try {
      expect(await isPortFree(listener.port)).toBe(false);
    } finally {
      listener.stop(true);
    }
    expect(await isPortFree(listener.port)).toBe(true);
  });

  test("readBootId returns a stable non-empty identifier", () => {
    const a = readBootId();
    expect(a.length).toBeGreaterThan(0);
    expect(readBootId()).toBe(a);
  });
});
