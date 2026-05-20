# Skill Registry — port-registry

**Project**: port-registry
**Stack**: TypeScript + Bun
**Generated**: 2026-05-19

## User Skills (Triggers)

| Skill | Path | Trigger Context |
|-------|------|-----------------|
| branch-pr | ~/.claude/skills/branch-pr/SKILL.md | Creating PRs, opening PRs, preparing changes for review |
| issue-creation | ~/.claude/skills/issue-creation/SKILL.md | Creating GitHub issues, reporting bugs, requesting features |
| judgment-day | ~/.claude/skills/judgment-day/SKILL.md | Adversarial dual review ("judgment day", "doble review", "juzgar") |
| skill-creator | ~/.claude/skills/skill-creator/SKILL.md | Creating new AI skills |
| go-testing | ~/.claude/skills/go-testing/SKILL.md | Go testing (NOT applicable — TS project) |

## Project Conventions

None detected at project root (no agents.md, CLAUDE.md, .cursorrules).

User-global CLAUDE.md applies (`~/.claude/CLAUDE.md`):
- Conventional commits only, no Co-Authored-By
- Never `cat/grep/find/sed/ls` → use `bat/rg/fd/sd/eza`
- Never build after changes
- Spanish: Peruvian tuteo, blacklist voseo
- Strict TDD Mode: enabled

## Compact Rules (Auto-Inject Targets)

### TypeScript/Bun code edits
- Runtime: `bun` (not node). Use `bun:sqlite`, `Bun.serve`, etc. when applicable.
- No build step — `bun src/server.ts` runs TS directly.
- Module type: ESM (`"type": "module"`).
- No tsconfig.json — bun's defaults apply. Add one only if tooling requires it.

### Testing
- Test runner: `bun test` (built-in, no dep needed).
- Place tests as `*.test.ts` next to source or in `test/` dir.
- Coverage: `bun test --coverage`.

### MCP server context
- SDK: `@modelcontextprotocol/sdk` ^1.12.0
- Server is stdio-transport (registered in clients via `command + args`).
- Tools must validate inputs (zod or manual) — clients send arbitrary JSON.

### PR / Issue workflow
- When creating PR: trigger `branch-pr` skill.
- When creating issue: trigger `issue-creation` skill.
- Conventional commits required.

### Shell tooling
- Use `eza/bat/rg/fd/sd` instead of `ls/cat/grep/find/sed`.
