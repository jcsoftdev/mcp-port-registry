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

  it("returns true only when both stdin and stdout are TTYs", () => {
    expect(isInteractive({ isTTY: true }, { isTTY: true })).toBe(true);
  });

  it("returns false when stdout is a pipe, even if stdin is a TTY", () => {
    // e.g. `curl ... | bash` with stdin rebound to /dev/tty, output piped to tee.
    // Prompts would render into the pipe and the installer would wait forever.
    expect(isInteractive({ isTTY: true }, { isTTY: undefined })).toBe(false);
  });

  it("returns false when stdin is a pipe, even if stdout is a TTY", () => {
    expect(isInteractive({ isTTY: undefined }, { isTTY: true })).toBe(false);
  });
});
