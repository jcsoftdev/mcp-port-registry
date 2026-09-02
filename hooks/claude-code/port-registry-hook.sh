#!/usr/bin/env bash
# Claude Code hook adapter for mcp-port-registry.
#
#   port-registry-hook.sh gc        # SessionStart: reclaim stale leases + leases of removed worktrees
#   port-registry-hook.sh release   # WorktreeRemove / SessionEnd: release every lease of this worktree
#   port-registry-hook.sh log       # any event: append the raw hook payload to ~/.cache/mcp-port-registry/hooks.log
#
# Reads the hook JSON from stdin. Uses `worktree_path` when present, else `cwd`, to
# find the worktree the event is about. Never fails the hook: exits 0 always, so a
# registry hiccup cannot block a session or a worktree operation.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$HERE/../../src/cli.ts"
MODE="${1:-gc}"
PAYLOAD="$(cat 2>/dev/null || true)"

field() {
  printf '%s' "$PAYLOAD" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n1
}

DIR="$(field worktree_path)"
[ -z "$DIR" ] && DIR="$(field cwd)"
[ -z "$DIR" ] && DIR="$PWD"

case "$MODE" in
  log)
    mkdir -p "$HOME/.cache/mcp-port-registry"
    printf '%s %s\n' "$(date -u +%FT%TZ)" "$PAYLOAD" >> "$HOME/.cache/mcp-port-registry/hooks.log"
    ;;
  gc)
    if [ -d "$DIR" ]; then (cd "$DIR" && bun "$CLI" gc --auto) >/dev/null 2>&1 || true; fi
    ;;
  release)
    if [ -d "$DIR" ]; then (cd "$DIR" && bun "$CLI" release) >/dev/null 2>&1 || true; fi
    ;;
esac
exit 0
