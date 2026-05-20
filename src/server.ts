#!/usr/bin/env bun

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getOrAssignPort,
  listAssignments,
  setPort,
  removePort,
  getTechnologies,
} from "./registry.js";

const server = new Server(
  { name: "port-registry", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "port_get",
      description:
        "Get the assigned port for a project+technology pair. Auto-assigns if none exists.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: {
            type: "string",
            description: "Project identifier (e.g., 'clinicai', 'my-saas')",
          },
          technology: {
            type: "string",
            description:
              "Technology name (e.g., 'postgresql', 'nextjs', 'redis')",
          },
        },
        required: ["project", "technology"],
      },
    },
    {
      name: "port_list",
      description:
        "List all port assignments. Optionally filter by project or technology.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: {
            type: "string",
            description: "Filter by project name",
          },
          technology: {
            type: "string",
            description: "Filter by technology",
          },
        },
      },
    },
    {
      name: "port_set",
      description:
        "Manually assign a specific port to a project+technology pair. Fails if port is already taken by another pair.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: {
            type: "string",
            description: "Project identifier",
          },
          technology: {
            type: "string",
            description: "Technology name",
          },
          port: {
            type: "number",
            description: "Port number to assign (1024-65535)",
          },
        },
        required: ["project", "technology", "port"],
      },
    },
    {
      name: "port_remove",
      description: "Remove a port assignment for a project+technology pair.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: {
            type: "string",
            description: "Project identifier",
          },
          technology: {
            type: "string",
            description: "Technology name",
          },
        },
        required: ["project", "technology"],
      },
    },
    {
      name: "port_technologies",
      description:
        "List all known technologies with default base ports. Optionally add a new technology.",
      inputSchema: {
        type: "object" as const,
        properties: {
          add_name: {
            type: "string",
            description: "Name of new technology to add",
          },
          add_port: {
            type: "number",
            description: "Default base port for the new technology",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "port_get": {
        const { project, technology } = args as {
          project: string;
          technology: string;
        };
        const { assignment, isNew } = getOrAssignPort(project, technology);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ...assignment, isNew },
                null,
                2
              ),
            },
          ],
        };
      }

      case "port_list": {
        const { project, technology } = (args ?? {}) as {
          project?: string;
          technology?: string;
        };
        const assignments = listAssignments(project, technology);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(assignments, null, 2),
            },
          ],
        };
      }

      case "port_set": {
        const { project, technology, port } = args as {
          project: string;
          technology: string;
          port: number;
        };
        const assignment = setPort(project, technology, port);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, ...assignment }, null, 2),
            },
          ],
        };
      }

      case "port_remove": {
        const { project, technology } = args as {
          project: string;
          technology: string;
        };
        const removed = removePort(project, technology);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { success: true, removed },
                null,
                2
              ),
            },
          ],
        };
      }

      case "port_technologies": {
        const { add_name, add_port } = (args ?? {}) as {
          add_name?: string;
          add_port?: number;
        };
        const technologies = getTechnologies(add_name, add_port);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ technologies }, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
