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

# ── 5. Hand off to installer ──────────────────────────────────────────────────
# Do NOT reopen /dev/tty to fake an interactive stdin here. Bun 1.3.14 on macOS
# cannot kqueue a freshly opened /dev/tty: as stdout it dies with
# "EINVAL: invalid argument, kqueue" (process.stdout ends up undefined and
# @clack/prompts crashes in s.write), and as stdin it registers as a TTY, renders
# the prompt, and then never delivers a single keystroke — a frozen picker.
#
# So the fds are simply inherited, which gives the right mode either way:
#   * `curl … | bash`  -> stdin is the pipe, the installer runs non-interactive
#                          and configures every detected client.
#   * `bash install.sh` -> stdin is the real terminal, inherited from the shell,
#                          and the interactive picker works normally.
INSTALLER_ENTRY="$INSTALL_DIR/installer/index.ts"

if [[ ! -t 0 ]]; then
  echo "Non-interactive input detected — every detected client will be configured."
  echo "To pick clients yourself, run: bun ${INSTALLER_ENTRY}"
fi

echo "Launching installer..."
STATUS=0
bun "$INSTALLER_ENTRY" || STATUS=$?

if [[ "$STATUS" -eq 0 ]]; then
  exit 0
fi

echo "" >&2
echo "The installer exited with status ${STATUS}." >&2
echo "The repo and its dependencies are installed; you can rerun it with:" >&2
echo "  bun ${INSTALLER_ENTRY}" >&2
exit "$STATUS"
