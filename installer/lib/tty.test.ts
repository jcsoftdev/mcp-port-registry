import { describe, it, expect } from "bun:test";
import { isInteractive } from "./tty";

describe("isInteractive", () => {
  it("returns a boolean", () => {
    const result = isInteractive();
    expect(typeof result).toBe("boolean");
  });

  it("returns false when process.stdin.isTTY is falsy (test runner has no TTY)", () => {
    // bun test always runs without a TTY on stdin
    expect(isInteractive()).toBe(false);
  });
});
