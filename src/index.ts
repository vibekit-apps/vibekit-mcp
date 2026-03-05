#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API_BASE = process.env.VIBEKIT_API_URL || "https://vibekit.bot/api/v1";
const API_KEY = process.env.VIBEKIT_API_KEY || "";

if (!API_KEY) {
  console.error("VIBEKIT_API_KEY is required. Get one at https://app.vibekit.bot/settings");
  process.exit(1);
}

// ── API Helper ──────────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: any): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return { ok: true, data: {} };
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message || "Request failed" };
  }
}

// ── Tool Definitions ────────────────────────────────────────────────────────

const tools = [
  // Account
  {
    name: "vibekit_account",
    description: "Get account info: plan, balance, session usage.",
    inputSchema: { type: "object" as const, properties: {} },
  },

  // Apps
  {
    name: "vibekit_list_apps",
    description: "List all your hosted apps with status and URLs.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "vibekit_app_info",
    description: "Get details about a specific app.",
    inputSchema: {
      type: "object" as const,
      properties: { slug: { type: "string", description: "App subdomain slug or full UUID" } },
      required: ["slug"],
    },
  },

  // Agent Chat
  {
    name: "vibekit_chat",
    description: "Send a message to an app's AI agent. The agent can modify code, deploy, fix bugs, add features.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "App subdomain slug" },
        message: { type: "string", description: "Message for the AI agent" },
      },
      required: ["slug", "message"],
    },
  },
  {
    name: "vibekit_agent_status",
    description: "Get the AI agent's status and model info for an app.",
    inputSchema: {
      type: "object" as const,
      properties: { slug: { type: "string", description: "App subdomain slug" } },
      required: ["slug"],
    },
  },

  // Deploy
  {
    name: "vibekit_deploy",
    description: "Trigger a redeploy for an app.",
    inputSchema: {
      type: "object" as const,
      properties: { slug: { type: "string", description: "App subdomain slug" } },
      required: ["slug"],
    },
  },
  {
    name: "vibekit_deploys",
    description: "List deploy history for an app.",
    inputSchema: {
      type: "object" as const,
      properties: { slug: { type: "string", description: "App subdomain slug" } },
      required: ["slug"],
    },
  },
  {
    name: "vibekit_rollback",
    description: "Rollback an app to a previous deploy.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "App subdomain slug" },
        deployId: { type: "string", description: "Deploy ID to rollback to" },
      },
      required: ["slug", "deployId"],
    },
  },

  // Logs
  {
    name: "vibekit_logs",
    description: "Get recent logs for an app.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "App subdomain slug" },
        lines: { type: "number", description: "Number of lines (default 50)" },
      },
      required: ["slug"],
    },
  },

  // Container control
  {
    name: "vibekit_start",
    description: "Start an app's container.",
    inputSchema: {
      type: "object" as const,
      properties: { slug: { type: "string", description: "App subdomain slug" } },
      required: ["slug"],
    },
  },
  {
    name: "vibekit_stop",
    description: "Stop an app's container.",
    inputSchema: {
      type: "object" as const,
      properties: { slug: { type: "string", description: "App subdomain slug" } },
      required: ["slug"],
    },
  },
  {
    name: "vibekit_restart",
    description: "Restart an app's container.",
    inputSchema: {
      type: "object" as const,
      properties: { slug: { type: "string", description: "App subdomain slug" } },
      required: ["slug"],
    },
  },

  // Env vars
  {
    name: "vibekit_env_list",
    description: "List environment variables for an app.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "App subdomain slug" },
        reveal: { type: "boolean", description: "Show real values instead of masked" },
      },
      required: ["slug"],
    },
  },
  {
    name: "vibekit_env_set",
    description: "Set an environment variable.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "App subdomain slug" },
        key: { type: "string", description: "Variable name" },
        value: { type: "string", description: "Variable value" },
      },
      required: ["slug", "key", "value"],
    },
  },
  {
    name: "vibekit_env_delete",
    description: "Delete an environment variable.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "App subdomain slug" },
        key: { type: "string", description: "Variable name to delete" },
      },
      required: ["slug", "key"],
    },
  },

  // Database
  {
    name: "vibekit_db_status",
    description: "Get database status for an app (tables, size, connections).",
    inputSchema: {
      type: "object" as const,
      properties: { slug: { type: "string", description: "App subdomain slug" } },
      required: ["slug"],
    },
  },
  {
    name: "vibekit_db_schema",
    description: "Get database schema — tables, columns, types, foreign keys.",
    inputSchema: {
      type: "object" as const,
      properties: { slug: { type: "string", description: "App subdomain slug" } },
      required: ["slug"],
    },
  },
  {
    name: "vibekit_db_query",
    description: "Run a read-only SQL query against an app's database.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "App subdomain slug" },
        sql: { type: "string", description: "SQL query (SELECT only)" },
      },
      required: ["slug", "sql"],
    },
  },
  {
    name: "vibekit_db_table",
    description: "Browse data in a specific table.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "App subdomain slug" },
        table: { type: "string", description: "Table name" },
        limit: { type: "number", description: "Max rows (default 20)" },
      },
      required: ["slug", "table"],
    },
  },

  // Files
  {
    name: "vibekit_files",
    description: "Browse workspace files for an app.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "App subdomain slug" },
        path: { type: "string", description: "Directory path (default: root)" },
      },
      required: ["slug"],
    },
  },

  // QA
  {
    name: "vibekit_qa",
    description: "Run a QA audit on an app — checks for bugs, accessibility, performance issues.",
    inputSchema: {
      type: "object" as const,
      properties: { slug: { type: "string", description: "App subdomain slug" } },
      required: ["slug"],
    },
  },

  // Domain
  {
    name: "vibekit_set_domain",
    description: "Set a custom domain for an app.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "App subdomain slug" },
        domain: { type: "string", description: "Custom domain (e.g. myapp.com)" },
      },
      required: ["slug", "domain"],
    },
  },

  // Tasks (headless API)
  {
    name: "vibekit_submit_task",
    description: "Submit a coding task. An AI agent will build code and deploy it.",
    inputSchema: {
      type: "object" as const,
      properties: {
        task: { type: "string", description: "What to build or change" },
        repo: { type: "string", description: "GitHub repo (owner/repo)" },
        branch: { type: "string", description: "Branch (default: main)" },
      },
      required: ["task"],
    },
  },
  {
    name: "vibekit_task_status",
    description: "Check status of a submitted task.",
    inputSchema: {
      type: "object" as const,
      properties: { taskId: { type: "string", description: "Task ID" } },
      required: ["taskId"],
    },
  },
];

// ── Tool Handlers ───────────────────────────────────────────────────────────

async function handleTool(name: string, args: Record<string, any>) {
  let result: { ok: boolean; data?: any; error?: string };
  const s = args.slug;
  const h = `/hosting/app/${s}`;

  switch (name) {
    case "vibekit_account":       result = await api("GET", "/account"); break;
    case "vibekit_list_apps":     result = await api("GET", "/hosting/apps"); break;
    case "vibekit_app_info":      result = await api("GET", h); break;
    case "vibekit_chat":          result = await api("POST", `${h}/agent`, { message: args.message }); break;
    case "vibekit_agent_status":  result = await api("GET", `${h}/agent/status`); break;
    case "vibekit_deploy":        result = await api("POST", `${h}/redeploy`); break;
    case "vibekit_deploys":       result = await api("GET", `${h}/deploys`); break;
    case "vibekit_rollback":      result = await api("POST", `${h}/deploys/${args.deployId}/rollback`); break;
    case "vibekit_logs":          result = await api("GET", `${h}/logs?lines=${args.lines || 50}`); break;
    case "vibekit_start":         result = await api("POST", `${h}/start`); break;
    case "vibekit_stop":          result = await api("POST", `${h}/stop`); break;
    case "vibekit_restart":       result = await api("POST", `${h}/restart`); break;
    case "vibekit_env_list":      result = await api("GET", `${h}/env${args.reveal ? '?reveal=true' : ''}`); break;
    case "vibekit_env_set":       result = await api("POST", `${h}/env`, { vars: { [args.key]: args.value } }); break;
    case "vibekit_env_delete":    result = await api("DELETE", `${h}/env/${args.key}`); break;
    case "vibekit_db_status":     result = await api("GET", `${h}/database`); break;
    case "vibekit_db_schema":     result = await api("GET", `${h}/database/schema`); break;
    case "vibekit_db_query":      result = await api("POST", `${h}/database/query`, { sql: args.sql }); break;
    case "vibekit_db_table":      result = await api("GET", `${h}/database/tables/${args.table}?limit=${args.limit || 20}`); break;
    case "vibekit_files":         result = await api("GET", `${h}/agent/files${args.path ? `?path=${encodeURIComponent(args.path)}` : ''}`); break;
    case "vibekit_qa":            result = await api("POST", `${h}/qa`); break;
    case "vibekit_set_domain":    result = await api("POST", `${h}/domain`, { domain: args.domain }); break;
    case "vibekit_submit_task":   result = await api("POST", "/task", { prompt: args.task, repo: args.repo, branch: args.branch }); break;
    case "vibekit_task_status":   result = await api("GET", `/task/${args.taskId}`); break;
    default: result = { ok: false, error: `Unknown tool: ${name}` };
  }

  const text = result.ok ? JSON.stringify(result.data, null, 2) : `Error: ${result.error}`;
  return { content: [{ type: "text" as const, text }] };
}

// ── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "vibekit-mcp", version: "0.3.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleTool(name, (args || {}) as Record<string, any>);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VibeKit MCP server running on stdio");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
