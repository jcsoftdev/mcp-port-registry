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

# ── 5. Hand off to TUI (reopen stdin from /dev/tty so @clack/prompts works) ──
echo "Launching installer..."
exec bun "$INSTALL_DIR/installer/index.ts" </dev/tty
