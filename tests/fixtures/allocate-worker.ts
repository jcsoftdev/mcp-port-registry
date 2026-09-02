// Usage: bun allocate-worker.ts <dbPath> <prefix> <count>
// Allocates <count> distinct project ports for one technology and prints them, one per line.
import { openDb } from "../../src/db";
import { createRegistry } from "../../src/registry";

const [dbPath, prefix, countArg] = process.argv.slice(2);
const registry = createRegistry(openDb(dbPath));
const count = Number(countArg);
const out: number[] = [];
for (let i = 0; i < count; i++) {
  out.push(registry.getOrAssignPort(`${prefix}-${i}`, "express").assignment.port);
}
console.log(out.join("\n"));
