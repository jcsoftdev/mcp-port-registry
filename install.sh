#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# MCP Port Registry — One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/jcsoftdev/mcp-port-registry/main/install.sh | bash
# ──────────────────────────────────────────────────────────────────────────────

REPO_URL="https://github.com/jcsoftdev/mcp-port-registry.git"
INSTALL_DIR="$HOME/.local/share/mcp-port-registry"

# ── 1. Platform guard ─────────────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$OS" == MINGW* || "$OS" == CYGWIN* || "$OS" == MSYS* ]]; then
  echo "Error: Windows native shells are not supported." >&2
  echo "Please use WSL (Windows Subsystem for Linux) instead." >&2
  exit 1
fi

if [[ "$ARCH" == "armv6l" || "$ARCH" == "armv7l" ]]; then
  echo "Error: 32-bit ARM ($ARCH) is not supported." >&2
  echo "A 64-bit OS (aarch64 / arm64) is required." >&2
  exit 1
fi

echo "Platform: $OS / $ARCH — supported ✓"

# ── 2. Ensure Bun ─────────────────────────────────────────────────────────────
if command -v bun &>/dev/null; then
  echo "Bun already installed: $(bun --version)"
else
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash

  # Make bun available in this shell session
  BUN_BIN="$HOME/.bun/bin"
  if [[ ":$PATH:" != *":$BUN_BIN:"* ]]; then
    export PATH="$BUN_BIN:$PATH"
  fi

  if ! command -v bun &>/dev/null; then
    echo "Error: Bun installation failed — 'bun' not found in PATH." >&2
    exit 1
  fi
  echo "Bun installed: $(bun --version)"
fi

# ── 3. Clone or update repo ───────────────────────────────────────────────────
# Never let git open an interactive credential prompt: the repo is public, and a
# prompt here would stall a non-interactive `curl | bash` run indefinitely.
export GIT_TERMINAL_PROMPT=0

if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "Updating existing repo at ${INSTALL_DIR}..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "Cloning repo to ${INSTALL_DIR}..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ── 4. Install dependencies ───────────────────────────────────────────────────
echo "Installing dependencies..."
bun install --cwd "$INSTALL_DIR"

# ── 5. Hand off to TUI ────────────────────────────────────────────────────────
# Under `curl | bash`, only stdin is the pipe (it is this script's own source);
# stdout and stderr are already the user's terminal. So rebind stdin only, and
# only for the installer process:
#
#   * Redirecting on the command itself (not via a bare `exec </dev/tty`) keeps
#     bash reading the rest of this script from the pipe. A bare rebind makes
#     bash read its next command from the keyboard — a blank, frozen-looking
#     prompt.
#   * `0<>/dev/tty` opens read-write, matching how a real terminal fd looks.
#     Adding `>/dev/tty 2>/dev/tty` on top would hand Bun freshly opened
#     write-only tty fds, and node:tty's WriteStream dies there with
#     "EINVAL: invalid argument, kqueue", leaving process.stdout undefined and
#     crashing @clack/prompts.
INSTALLER_ENTRY="$INSTALL_DIR/installer/index.ts"

echo "Launching installer..."
STATUS=0
if [[ -e /dev/tty ]] && (exec 3<>/dev/tty) 2>/dev/null; then
  bun "$INSTALLER_ENTRY" 0<>/dev/tty || STATUS=$?
else
  echo "Warning: no controlling terminal detected; the interactive installer may not respond to keystrokes." >&2
  bun "$INSTALLER_ENTRY" || STATUS=$?
fi

if [[ "$STATUS" -eq 0 ]]; then
  exit 0
fi

echo "" >&2
echo "The interactive installer exited with status ${STATUS}." >&2
echo "The repo and its dependencies are installed; you can run it directly with:" >&2
echo "  bun ${INSTALLER_ENTRY}" >&2
exit "$STATUS"
