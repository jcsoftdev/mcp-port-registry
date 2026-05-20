---
name: port-setup
description: >
  Detect a project's tech stack and assign collision-free ports via the
  port-registry MCP server, then write .env / docker-compose.yml safely.
  Trigger: When the user asks to "set up ports", "setup ports", "init ports",
  "wire ports", "configure ports", "assign ports", "port setup",
  "asignar puertos", "configurar puertos", "configura puertos",
  "configura puertos del proyecto", "inicializa puertos", "setea los puertos",
  or any variant about port assignment / configuration for the current project.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

Load this skill when the user asks to:

**English triggers:**
- "set up ports", "setup ports", "init ports", "wire ports"
- "configure ports", "assign ports", "port setup"
- "auto-assign ports", "allocate ports for this project"

**Spanish triggers:**
- "asignar puertos", "configurar puertos", "configura puertos"
- "configura puertos del proyecto", "inicializa puertos"
- "setea los puertos", "asigna los puertos del proyecto"

---

## STEP 0 — MCP Availability Check

Before doing anything else, verify that the port-registry MCP server is registered
in the current session.

1. Inspect your available tool listing (what you can call in this session).
2. Look for any of these names (in any prefix form):
   - `port_get`, `mcp__port-registry__port_get`, `port-registry.port_get`
3. **If found**: continue to STEP 1.
4. **If NOT found**: stop immediately and emit this message:

```
The port-registry MCP server is not registered in this session.

Install it first:
  git clone git@github.com:jcsoftdev/mcp-port-registry.git
  cd mcp-port-registry && bun install

Then register it in your harness (e.g. Claude Code → ~/.claude/.claude.json):
  {
    "mcpServers": {
      "port-registry": {
        "type": "stdio",
        "command": "bun",
        "args": ["/absolute/path/to/mcp-port-registry/src/server.ts"]
      }
    }
  }

Restart the harness and retry.
```

Do NOT attempt to call any port-registry tool if the check fails.

---

## Workflow

### STEP 1 — Determine Project Name

Use the priority order defined in `assets/detection-map.json` under `project_name_sources`:

1. **git_remote**: Run `git remote get-url origin`. Extract the repo name from the URL
   (last path segment, strip `.git` suffix). Example: `git@github.com:org/my-app.git` → `my-app`.
2. **package_json**: Read `package.json` → `name` field.
3. **pyproject**: Read `pyproject.toml` → `[project] name` field.
4. **go_mod**: Read `go.mod` → `module` line, take the last path segment.
5. **cwd_basename**: Use `basename $PWD`.

Normalize the result: lowercase, replace spaces and underscores with `-`.
If none of the above yields a name, ask the user to provide one explicitly.

---

### STEP 2 — Load Detection Map

Read the file `assets/detection-map.json` (this file, in the same skill directory)
using your Read tool. Parse the `technologies` object — it is your lookup table for
all remaining steps. Do this once; do not re-read mid-run.

---

### STEP 3 — Detect Tech Stack

For each entry in `detection-map.technologies`, check the following signals.
A technology is **detected** when **at least one signal** matches.

**Files** (`detect.files`): Check whether any of the listed path globs exist in the
project root. Use shell glob matching (`*` = any chars except `/`).

**npm dependencies** (`detect.package_json_deps`): If `package.json` exists, read its
`dependencies` and `devDependencies`. Check whether any listed package name appears.

**Python dependencies** (`detect.pyproject_deps`): If `pyproject.toml` or
`requirements.txt` exists, check for the listed package names.

**Compose images** (`detect.compose_service_images`): If `docker-compose.yml` or
`docker-compose.yaml` exists, parse each service's `image:` field. A match occurs
when the image value starts with one of the listed prefixes.

**Compose service names** (`detect.compose_service_names`): Match the service key
name itself (e.g. `services.postgres:` matches `["postgres", "db"]`).

Build a `detected` set of tech-ids. If nothing is detected, print:

```
No supported tech found in this project.
Sources checked: package.json, pyproject.toml, docker-compose.yml, file globs.
Please specify the technologies manually, or add them to detection-map.json.
```
Then stop — no files are written.

**Framework PORT conflict**: `nextjs` and `express` both use `env_var: "PORT"`.
If two or more framework entries (kind = "framework", env_var = "PORT") are detected,
pick the one with the lower `priority` value as the `PORT` owner. Assign the other(s)
an explicit var (`NEXT_PORT`, `EXPRESS_PORT`, etc. — use `<TECH_NAME_UPPER>_PORT`).
Inform the user of this decision and ask for confirmation before proceeding.

---

### STEP 4 — Scan Existing Ports (preserve user intent)

Before calling any port-registry tool, read existing port data from the filesystem:

**From .env / .env.local** (scan all that exist; ignore `.env.example`):
- For each line matching `<VAR>=<value>`:
  - If `VAR` matches a `env_var` from any detected tech: record `(tech-id, existing_port)`.

**From docker-compose.yml / docker-compose.yaml** (if present):
- For each service in `detected`, look up `services.<compose_service>.ports`:
  - **Short-form** `"<host>:<internal>"`: record `(tech-id, host_port)` if host ≠ internal
    (or even if equal — user placed it there intentionally).
  - **Long-form** `{target: <n>, published: <n>}`: record `(tech-id, published)`.

Build `existing_ports: Map<tech-id, number>`.

---

### STEP 5 — Pin Existing Ports + Assign New Ones

For each tech-id in `detected`:

- **If** `existing_ports` has an entry for this tech:
  ```
  CALL port_set(project=<project-name>, technology=<tech-id>, port=<existing_port>)
  ```
  This registers the user's port in the registry without changing it.
  - **If port_set returns a conflict** (port already taken by another project):
    Surface the conflict explicitly:
    ```
    ⚠ Port <N> for <tech-id> is already assigned to project "<other-project>".
    Options:
      (a) Keep your port <N> — force it (call port_set with override if supported, or accept conflict)
      (b) Let the registry assign a new collision-free port (call port_get instead)
      (c) Abort and resolve manually
    ```
    Wait for the user to choose before continuing.

- **If** no existing port for this tech:
  ```
  CALL port_get(project=<project-name>, technology=<tech-id>)
  ```
  Returns the current assignment or creates a new collision-free one (idempotent).

Record all results in `assignments: Map<tech-id, port>`.

---

### STEP 6 — Unknown Technology Handling

If during STEP 3 you detect a technology name that is **not in** `detection-map.technologies`
(e.g. the user mentioned "fastify" or you found a compose image you don't recognize):

1. Call `port_technologies()` — list all technologies known to the registry.
2. If the registry **already knows** the tech: proceed with `port_get` directly.
3. If the registry **does not know** the tech:
   - Ask the user: "What default internal port does `<tech>` use?"
   - Call `port_technologies(add_name=<tech>, add_port=<user-supplied-port>)`
   - Then call `port_get(project, tech)` to obtain the assignment.

---

### STEP 7 — Apply Writes (skipped in dry-run mode)

Check for dry-run activation before this step (see **Safety Rules** below). If dry-run
is active, skip this entire step and go to STEP 8.

For each `(tech-id, port)` in `assignments`:

#### a) Write to `.env`

- **File exists, variable present**: replace the existing `<VAR>=...` line in-place.
- **File exists, variable absent**: append `<VAR>=<port>` on a new line.
- **File does not exist**: create `.env` with a header comment and `<VAR>=<port>`.

If `.env.local` also exists, mirror the same changes there.

**Backup rule**: Before the very first write to `.env`, run:
```
cp .env .env.bak
```
Only do this once per session. If `.env.bak` already exists, skip the copy
(preserve the original baseline from the first run, not this one).

#### b) Write to `docker-compose.yml` (only when applicable)

Only if:
- The tech has a `compose_service` value, AND
- That service name exists in `docker-compose.yml`

Locate `services.<compose_service>.ports`:
- **Short-form** `"<host>:<internal>"`: replace the host part with the assigned port.
  Keep the internal port at `tech.compose_internal_port`. Result: `"<assigned>:<internal>"`.
- **Long-form** `{target: <n>, published: <n>}`: update `published` to the assigned port.
- **No `ports:` key exists**: add a `ports:` entry in short-form:
  ```yaml
  ports:
    - "<assigned>:<internal>"
  ```

**Backup rule**: Before the very first write to `docker-compose.yml`, run:
```
cp docker-compose.yml docker-compose.yml.bak
```
Same once-per-session rule — don't overwrite an existing `.bak`.

**Never modify**: `.env.example`, `next.config.*`, `vite.config.*`, `package.json`.

---

### STEP 8 — Report

Print a Markdown table summarizing all assignments:

```
| Technology   | Port  | Source    | Written To                      |
|--------------|-------|-----------|---------------------------------|
| postgresql   | 5432  | registry  | .env (POSTGRES_PORT)            |
| redis        | 6379  | existing  | .env (REDIS_PORT), docker-compose|
| nextjs       | 3000  | new       | .env (PORT)                     |
```

Source values:
- `existing` — the port was already in `.env` / docker-compose; `port_set` was called.
- `registry` — a prior assignment existed in the registry; `port_get` returned it.
- `new` — a fresh collision-free port was assigned; `port_get` created it.

**If dry-run**:
```
--- DRY RUN — no files were written ---
The assignments above WOULD have been applied. Re-run without "dry run" to write.
```

**Always print** (if any files were modified):
```
Backups created: .env.bak, docker-compose.yml.bak
To restore: cp .env.bak .env && cp docker-compose.yml.bak docker-compose.yml
```

---

## Tool Call Protocol

The port-registry tools are available under different names depending on your harness.
Inspect your active tool listing at runtime and use whichever form is exposed.
**Never invent a prefix.**

| Harness | Tool name pattern | Example |
|---|---|---|
| Claude Code | `mcp__<server-id>__<tool>` | `mcp__port-registry__port_get` |
| Cursor (agent) | `<tool>` or `<server>.<tool>` | `port_get` / `port-registry.port_get` |
| Cline | `<tool>` | `port_get` |
| Continue | `<tool>` | `port_get` |

Tool signatures (use whichever prefix form is active):

```
port_get(project: string, technology: string) → { port: number, ... }
port_set(project: string, technology: string, port: number) → { ... }
port_technologies(add_name?: string, add_port?: number) → { technologies: [...] }
port_list(project?: string, technology?: string) → { assignments: [...] }
```

---

## Safety Rules

### Backup policy

- Create one `.bak` per modified file per session, before the first write.
- Command: `cp <file> <file>.bak`
- If `<file>.bak` already exists: **do not overwrite it**. The baseline from the
  first-ever run is the most valuable restore point.

### Dry-run mode

The skill enters dry-run mode when the user's message contains any of:
- `dry run`, `dry-run`, `preview`, `simulate`
- `muestra`, `sin escribir`, `preview ports`, `solo muestra`

In dry-run mode:
- STEPs 0–6 execute normally (all reads + MCP calls happen).
- STEP 7 (file writes) is **completely skipped**.
- STEP 8 prints the report with the DRY RUN footer.

### Existing-port preservation

The pre-scan in STEP 4 is mandatory. Never call `port_get` for a tech that already
has a port in `.env` or docker-compose without first calling `port_set` to register
that existing port. Skipping this could cause the registry to assign a conflicting
number that overwrites the user's intentional choice.

### port_set vs port_get decision matrix

| Situation | Call | Reason |
|---|---|---|
| Existing port in `.env` / docker-compose | `port_set` | Register user's choice as-is |
| New tech, no existing port | `port_get` | Registry assigns collision-free port |
| Re-run on same project | `port_get` | Idempotent — returns prior assignment |
| `port_set` returns conflict | Ask user | Manual resolution required |

---

## Edge Cases

| Case | Handling |
|---|---|
| Unknown tech (not in detection-map, not in registry) | STEP 6: ask user for default port → `port_technologies(add_name, add_port)` → `port_get` |
| MCP not registered | STEP 0: abort with install instructions |
| No tech detected | Print "no supported tech found" message and stop |
| Monorepo (multiple `package.json`) | Use ROOT `package.json` for project name; scan ALL `package.json` under `apps/*` / `packages/*` for dep detection; one port set per repo (v1 limitation) |
| Two frameworks both wanting `PORT` | Pick lowest-priority number wins; assign other an explicit var; ask user to confirm |
| `docker-compose.yml` with no `ports:` for a detected service | ADD `ports:` section with short-form `"<assigned>:<internal>"` |
| Long-form docker-compose ports | Update the `published` field of the entry matching `target: <compose_internal_port>` |
| Pre-existing `.bak` file | Leave untouched — preserves the original baseline |
| `port_set` conflict (port taken by another project) | Surface conflict, present three options, wait for user choice |
| Project name detection fails | Ask user to supply a name explicitly |

---

## Failure Modes

| Failure | Symptom | Recovery |
|---|---|---|
| MCP server crashes mid-run | Tool call returns an error | Stop, report which techs got assigned so far. Re-run after fixing MCP — idempotency makes this safe. |
| Partial write (`.env` updated, docker-compose failed) | Skill reports partial success | Re-run; `.bak` files allow manual restore if needed |
| Wrong project name detected | Wrong assignments stored in registry | Run `port_remove(project=<wrong-name>, technology=<tech>)` for each, then re-run with the correct name |
| User edits `.env` after run | Subsequent re-run may overwrite their edits | STEP 4 reads `.env` first; STEP 5 calls `port_set` to pin their value — safe |

---

## Resources

- **Detection map**: [`assets/detection-map.json`](assets/detection-map.json) — single source of truth for all tech-to-env-var mappings. Extend by adding new entries; no SKILL.md changes required.
- **JSON Schema**: [`assets/detection-map.schema.json`](assets/detection-map.schema.json) — validates detection-map structure.
- **Validation script**: [`scripts/validate-detection-map.sh`](../../scripts/validate-detection-map.sh) — run to verify map is schema-compliant.
- **port-registry install docs**: See [README.md](../../README.md#installation) for setup and harness registration instructions.
