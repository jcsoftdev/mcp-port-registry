/**
 * Strict TDD — Phase 1 schema tests
 *
 * Tests that detection-map.json conforms to detection-map.schema.json
 * and that intentionally broken fixtures fail validation.
 *
 * Runner: bun test
 */

import { describe, it, expect } from "bun:test";
import Ajv from "ajv";
import { readFileSync } from "fs";
import { join } from "path";

const ASSETS = join(import.meta.dir, "../skills/port-setup/assets");

function loadJSON(file: string): unknown {
  return JSON.parse(readFileSync(join(ASSETS, file), "utf-8"));
}

const schema = loadJSON("detection-map.schema.json");
const ajv = new Ajv({ strict: false });
const validate = ajv.compile(schema as object);

// ─── RED tests (broken fixtures) ─────────────────────────────────────────────

describe("detection-map schema — invalid fixtures MUST fail", () => {
  it("rejects a map missing the top-level 'version' field", () => {
    const broken = {
      technologies: {},
      project_name_sources: [{ source: "cwd_basename" }],
    };
    const valid = validate(broken);
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
  });

  it("rejects a map missing the top-level 'technologies' field", () => {
    const broken = {
      version: "1",
      project_name_sources: [{ source: "cwd_basename" }],
    };
    const valid = validate(broken);
    expect(valid).toBe(false);
  });

  it("rejects a map missing the top-level 'project_name_sources' field", () => {
    const broken = {
      version: "1",
      technologies: {},
    };
    const valid = validate(broken);
    expect(valid).toBe(false);
  });

  it("rejects a technology entry missing required 'detect' field", () => {
    const broken = {
      version: "1",
      project_name_sources: [{ source: "cwd_basename" }],
      technologies: {
        postgresql: {
          env_var: "POSTGRES_PORT",
          kind: "database",
          // detect is missing
        },
      },
    };
    const valid = validate(broken);
    expect(valid).toBe(false);
  });

  it("rejects a technology entry missing required 'env_var' field", () => {
    const broken = {
      version: "1",
      project_name_sources: [{ source: "cwd_basename" }],
      technologies: {
        postgresql: {
          detect: {},
          kind: "database",
          // env_var is missing
        },
      },
    };
    const valid = validate(broken);
    expect(valid).toBe(false);
  });

  it("rejects a technology entry missing required 'kind' field", () => {
    const broken = {
      version: "1",
      project_name_sources: [{ source: "cwd_basename" }],
      technologies: {
        postgresql: {
          detect: {},
          env_var: "POSTGRES_PORT",
          // kind is missing
        },
      },
    };
    const valid = validate(broken);
    expect(valid).toBe(false);
  });

  it("rejects a technology entry with an invalid 'kind' value", () => {
    const broken = {
      version: "1",
      project_name_sources: [{ source: "cwd_basename" }],
      technologies: {
        postgresql: {
          detect: {},
          env_var: "POSTGRES_PORT",
          kind: "INVALID_KIND",
        },
      },
    };
    const valid = validate(broken);
    expect(valid).toBe(false);
  });

  it("rejects an env_var that is not UPPER_SNAKE format", () => {
    const broken = {
      version: "1",
      project_name_sources: [{ source: "cwd_basename" }],
      technologies: {
        postgresql: {
          detect: {},
          env_var: "lowercase_var",
          kind: "database",
        },
      },
    };
    const valid = validate(broken);
    expect(valid).toBe(false);
  });

  it("rejects an empty project_name_sources array", () => {
    const broken = {
      version: "1",
      technologies: {},
      project_name_sources: [],
    };
    const valid = validate(broken);
    expect(valid).toBe(false);
  });
});

// ─── GREEN tests (scaffold + seeded data) ─────────────────────────────────────

describe("detection-map schema — valid fixtures MUST pass", () => {
  it("accepts the empty scaffold (detection-map.json with empty technologies)", () => {
    const scaffold = loadJSON("detection-map.json");
    const valid = validate(scaffold);
    if (!valid) {
      console.error("Validation errors:", validate.errors);
    }
    expect(valid).toBe(true);
  });

  it("accepts a minimal single-technology entry with required fields only", () => {
    const minimal = {
      version: "1",
      project_name_sources: [{ source: "cwd_basename" }],
      technologies: {
        redis: {
          detect: {
            compose_service_images: ["redis"],
          },
          env_var: "REDIS_PORT",
          kind: "cache",
        },
      },
    };
    const valid = validate(minimal);
    if (!valid) {
      console.error("Validation errors:", validate.errors);
    }
    expect(valid).toBe(true);
  });

  it("accepts a full technology entry with all optional fields", () => {
    const full = {
      version: "1",
      project_name_sources: [
        { source: "git_remote", command: "git remote get-url origin" },
        { source: "cwd_basename" },
      ],
      technologies: {
        postgresql: {
          aliases: ["postgres", "pg"],
          detect: {
            files: [],
            package_json_deps: ["pg", "psycopg2"],
            pyproject_deps: ["psycopg2", "asyncpg"],
            compose_service_images: ["postgres"],
            compose_service_names: ["postgres", "db"],
          },
          env_var: "POSTGRES_PORT",
          compose_service: "postgres",
          compose_internal_port: 5432,
          kind: "database",
          priority: 1,
        },
      },
    };
    const valid = validate(full);
    if (!valid) {
      console.error("Validation errors:", validate.errors);
    }
    expect(valid).toBe(true);
  });

  it("accepts all valid kind values", () => {
    const kinds = ["database", "cache", "framework", "infra", "search"] as const;
    for (const kind of kinds) {
      const doc = {
        version: "1",
        project_name_sources: [{ source: "cwd_basename" }],
        technologies: {
          test_tech: {
            detect: {},
            env_var: "TEST_PORT",
            kind,
          },
        },
      };
      const valid = validate(doc);
      expect(valid).toBe(true);
    }
  });
});
