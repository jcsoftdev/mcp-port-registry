interface TTYStream {
  isTTY?: boolean;
}

/**
 * Returns true only when BOTH stdin and stdout are real TTYs.
 *
 * stdin alone is not enough: `curl ... | bash` rebinds the installer's stdin to
 * /dev/tty, so a piped stdout (`| tee install.log`) would still take the
 * interactive path. The prompts would then render into the pipe — block
 * buffered, so invisible — while the installer waits for keystrokes that the
 * user has no way of knowing are expected.
 */
export function isInteractive(
  stdin: TTYStream = process.stdin,
  stdout: TTYStream = process.stdout
): boolean {
  return stdin.isTTY === true && stdout.isTTY === true;
}
