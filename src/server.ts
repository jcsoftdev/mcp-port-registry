#!/usr/bin/env bun

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { openDb } from "./db.js";
import { createRegistry } from "./registry.js";
import { createLeaseStore } from "./leases.js";
import { TOOL_DEFINITIONS, createToolHandler } from "./tools.js";

const db = openDb();
const registry = createRegistry(db);
const leases = createLeaseStore(db);
const handleTool = createToolHandler({ registry, leases });

// This process lives exactly as long as the client session that spawned it, so
// it is the natural owner of the leases it hands out. Renewing them here means
// the agent never has to remember to heartbeat; when the session dies the
// renewals stop and the leases age out.
const HEARTBEAT_MS = 10 * 60 * 1000;
const heartbeat = setInterval(() => {
  try {
    leases.heartbeat();
  } catch {
    // A transient SQLITE_BUSY here is harmless; the next tick retries.
  }
}, HEARTBEAT_MS);
heartbeat.unref();

const server = new Server({ name: "port-registry", version: "2.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  handleTool(request.params.name, request.params.arguments as Record<string, unknown> | undefined)
);

const transport = new StdioServerTransport();
await server.connect(transport);
