#!/usr/bin/env bash
# Validate skills/port-setup/assets/detection-map.json against its JSON Schema.
# Exits 0 on success, 1 on validation failure.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAP="$REPO_ROOT/skills/port-setup/assets/detection-map.json"
SCHEMA="$REPO_ROOT/skills/port-setup/assets/detection-map.schema.json"

echo "Validating: $MAP"
echo "Schema:     $SCHEMA"

bun --eval "
import Ajv from 'ajv';
import { readFileSync } from 'fs';

const schema = JSON.parse(readFileSync('$SCHEMA', 'utf-8'));
const data   = JSON.parse(readFileSync('$MAP',    'utf-8'));

const ajv = new Ajv({ strict: false });
const validate = ajv.compile(schema);
const valid = validate(data);

if (!valid) {
  console.error('Validation FAILED:');
  console.error(JSON.stringify(validate.errors, null, 2));
  process.exit(1);
}
console.log('✓ detection-map.json is valid');
"
