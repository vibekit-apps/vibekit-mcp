#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const API_BASE = process.env.VIBEKIT_API_URL || "https://vibekit.bot/api/v1";
const API_KEY = process.env.VIBEKIT_API_KEY || "";
const SKILLS_REGISTRY = "https://raw.githubusercontent.com/vibekit-apps/skills-registry/main";

// Skills cache (TTL: 5 minutes)
let skillsCache: { manifest: unknown; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

if (!API_KEY) {
  console.error("Error: VIBEKIT_API_KEY environment variable is required");
  console.error("Get one at https://vibekit.bot or https://t.me/the_vibe_kit_bot with /apikey");
  process.exit(1);
}

// API helper
async function apiRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// Tool definitions
const tools: Tool[] = [
  // ── Hosting & Apps ──────────────────────────────────────────────────────────
  {
    name: "vibekit_list_apps",
    description: "List all hosted apps in your VibeKit account.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "vibekit_get_app",
    description: "Get details about a specific hosted app including status, URL, plan, and usage.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_create_app",
    description: "Create a new hosted app from a template.",
    inputSchema: {
      type: "object",
      properties: {
        template: { type: "string", description: "Template to use (e.g., 'nextjs', 'react', 'express', 'static')" },
        subdomain: { type: "string", description: "Subdomain — app will be at {subdomain}.vibekit.bot" },
      },
      required: ["template", "subdomain"],
    },
  },
  {
    name: "vibekit_deploy",
    description: "Deploy a GitHub repo to VibeKit hosting.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "GitHub repo in format 'owner/repo'" },
        subdomain: { type: "string", description: "Subdomain — app will be at {subdomain}.vibekit.bot" },
      },
      required: ["repo", "subdomain"],
    },
  },
  {
    name: "vibekit_redeploy",
    description: "Redeploy an existing hosted app to pick up the latest code changes.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_rollback",
    description: "Roll back an app to a previous deployment snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        deployId: { type: "string", description: "Deployment ID to roll back to. Use vibekit_deploy_history to list available deployments." },
      },
      required: ["appId", "deployId"],
    },
  },
  {
    name: "vibekit_deploy_history",
    description: "List deployment history for an app so you can roll back to a previous snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_app_logs",
    description: "Get application logs for debugging and monitoring.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        lines: { type: "number", description: "Number of log lines to retrieve (default: 100)" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_restart_app",
    description: "Restart a hosted app (zero-downtime reload).",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_stop_app",
    description: "Stop a hosted app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_start_app",
    description: "Start a stopped hosted app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_delete_app",
    description: "Permanently delete a hosted app and all its data.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },

  // ── Environment Variables ────────────────────────────────────────────────────
  {
    name: "vibekit_app_env",
    description: "Get environment variables for a hosted app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_set_env",
    description: "Set one or more environment variables for a hosted app. Changes take effect on next restart.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        vars: { type: "object", description: "Key-value pairs to set, e.g. { \"API_KEY\": \"abc\", \"DEBUG\": \"true\" }" },
      },
      required: ["appId", "vars"],
    },
  },
  {
    name: "vibekit_delete_env",
    description: "Delete a specific environment variable from a hosted app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        key: { type: "string", description: "Environment variable name to delete" },
      },
      required: ["appId", "key"],
    },
  },

  // ── AI Agent ─────────────────────────────────────────────────────────────────
  {
    name: "vibekit_chat",
    description: "Send a message to an app's AI agent. The agent can read, write, and modify the app's code, run commands, and deploy changes.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        message: { type: "string", description: "Message to send to the AI agent" },
      },
      required: ["appId", "message"],
    },
  },
  {
    name: "vibekit_agent_status",
    description: "Get the current status of an app's AI agent (idle, running, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_agent_stop",
    description: "Stop a currently running agent request.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_agent_history",
    description: "Get the chat history with an app's AI agent.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        limit: { type: "number", description: "Maximum number of messages to return (default: 20)" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_agent_config",
    description: "Get the AI agent configuration for an app (model, system prompt, features).",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_agent_set_model",
    description: "Change the AI model used by an app's agent.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        model: { type: "string", description: "Model to use. Options: 'claude-opus-4-6', 'claude-sonnet-4-20250514', 'claude-haiku-3.5'" },
      },
      required: ["appId", "model"],
    },
  },
  {
    name: "vibekit_exec",
    description: "Run a shell command inside an app's container. The app must be running. Useful for inspecting state, running migrations, or debugging.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        command: { type: "string", description: "Shell command to run, e.g. 'ls -la' or 'node -e \"console.log(process.env)\"'" },
      },
      required: ["appId", "command"],
    },
  },
  {
    name: "vibekit_agent_reset",
    description: "Reset an agent — clears sessions and restarts the agent process. Use when the agent is stuck.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_agent_compact",
    description: "Compact the agent's memory to free up context window space. Useful for long-running agents.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },

  // ── Files ────────────────────────────────────────────────────────────────────
  {
    name: "vibekit_list_files",
    description: "List files in an app's workspace directory.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        path: { type: "string", description: "Directory path to list (default: root)" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_read_file",
    description: "Read the contents of a file in an app's workspace.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        path: { type: "string", description: "File path relative to workspace root, e.g. 'src/index.ts'" },
      },
      required: ["appId", "path"],
    },
  },
  {
    name: "vibekit_write_file",
    description: "Write or update a file in an app's workspace. Use this to edit code directly.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        path: { type: "string", description: "File path relative to workspace root, e.g. 'src/index.ts'" },
        content: { type: "string", description: "Full file content to write" },
      },
      required: ["appId", "path", "content"],
    },
  },
  {
    name: "vibekit_file_changes",
    description: "Get a diff of recent file changes in an app's workspace (uncommitted changes).",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },

  // ── Database ─────────────────────────────────────────────────────────────────
  {
    name: "vibekit_enable_database",
    description: "Enable a managed Postgres database for an app. Free tier users need the database add-on.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_database_status",
    description: "Get database status and connection info for an app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_database_schema",
    description: "Get the database schema (tables and columns) for an app's database.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_database_query",
    description: "Run a SQL query against an app's database. Read-only queries are always safe; write queries modify data.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        sql: { type: "string", description: "SQL query to execute, e.g. 'SELECT * FROM users LIMIT 10'" },
      },
      required: ["appId", "sql"],
    },
  },

  // ── Domain ───────────────────────────────────────────────────────────────────
  {
    name: "vibekit_add_domain",
    description: "Add a custom domain to an app. After adding, update your DNS CNAME to point to vibekit.bot.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        domain: { type: "string", description: "Custom domain to add, e.g. 'myapp.com'" },
      },
      required: ["appId", "domain"],
    },
  },
  {
    name: "vibekit_remove_domain",
    description: "Remove a custom domain from an app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },

  // ── QA ───────────────────────────────────────────────────────────────────────
  {
    name: "vibekit_run_qa",
    description: "Run automated QA tests on a hosted app. Takes a screenshot and tests key flows.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_qa_status",
    description: "Get the latest QA test results for an app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },

  // ── Schedules (app-level cron jobs) ──────────────────────────────────────────
  {
    name: "vibekit_app_schedules",
    description: "List cron schedules configured for an app's agent.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_create_app_schedule",
    description: "Create a cron schedule for an app's agent (e.g. daily report, nightly cleanup).",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        name: { type: "string", description: "Friendly name for the schedule" },
        cron: { type: "string", description: "Cron expression, e.g. '0 9 * * 1' for every Monday 9am UTC" },
        task: { type: "string", description: "What the agent should do on each run" },
      },
      required: ["appId", "name", "cron", "task"],
    },
  },
  {
    name: "vibekit_delete_app_schedule",
    description: "Delete a cron schedule from an app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App ID or subdomain slug" },
        jobId: { type: "string", description: "Schedule job ID to delete" },
      },
      required: ["appId", "jobId"],
    },
  },

  // ── Tasks (async coding tasks) ───────────────────────────────────────────────
  {
    name: "vibekit_submit_task",
    description: "Submit an async coding task to VibeKit. The AI will write code, commit to GitHub, and optionally deploy. Returns a task ID to poll for results.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What you want built or changed. Be specific." },
        repo: { type: "string", description: "GitHub repo in format 'owner/repo'" },
        branch: { type: "string", description: "Git branch to work on (default: main)" },
        deploy: { type: "boolean", description: "Auto-deploy when done (default: true)" },
        callbackUrl: { type: "string", description: "Webhook URL to receive completion notification" },
      },
      required: ["task"],
    },
  },
  {
    name: "vibekit_get_task",
    description: "Get the status and result of a previously submitted task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID from vibekit_submit_task" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "vibekit_list_tasks",
    description: "List recent tasks submitted to VibeKit.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max tasks to return (default: 10)" },
        status: {
          type: "string",
          enum: ["pending", "running", "completed", "failed"],
          description: "Filter by status",
        },
      },
    },
  },
  {
    name: "vibekit_wait_for_task",
    description: "Wait for a task to complete, polling every 5 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID to wait for" },
        timeoutSeconds: { type: "number", description: "Max seconds to wait (default: 300)" },
      },
      required: ["taskId"],
    },
  },

  // ── Account-level Schedules ───────────────────────────────────────────────────
  {
    name: "vibekit_create_schedule",
    description: "Create a recurring coding task schedule (GitHub-based, not app-agent based).",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What to do on each run" },
        repo: { type: "string", description: "GitHub repo in format 'owner/repo'" },
        cron: { type: "string", description: "Cron expression, e.g. '0 9 * * 1'" },
        name: { type: "string", description: "Friendly name for this schedule" },
      },
      required: ["task", "repo", "cron"],
    },
  },
  {
    name: "vibekit_list_schedules",
    description: "List all account-level recurring task schedules.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "vibekit_delete_schedule",
    description: "Delete an account-level recurring schedule.",
    inputSchema: {
      type: "object",
      properties: {
        scheduleId: { type: "string", description: "Schedule ID to delete" },
      },
      required: ["scheduleId"],
    },
  },

  // ── Account ──────────────────────────────────────────────────────────────────
  {
    name: "vibekit_account",
    description: "Get VibeKit account info — plan, credits balance, session usage, and limits.",
    inputSchema: { type: "object", properties: {} },
  },

  // ── Skills ───────────────────────────────────────────────────────────────────
  {
    name: "vibekit_list_skills",
    description: "List available implementation skills. Skills contain code patterns and best practices for specific domains.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Filter by tag (e.g. 'react', 'database', 'security')" },
      },
    },
  },
  {
    name: "vibekit_get_skill",
    description: "Fetch the full content of a specific skill. Use vibekit_list_skills to discover available skill IDs.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Skill ID (e.g. 'nextjs', 'trpc', 'auth')" },
      },
      required: ["id"],
    },
  },
];

// Tool handlers
async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  let result: { ok: boolean; data?: unknown; error?: string };

  switch (name) {
    // Apps
    case "vibekit_list_apps":
      result = await apiRequest("GET", "/hosting/apps");
      break;

    case "vibekit_get_app":
      result = await apiRequest("GET", `/hosting/app/${args.appId}`);
      break;

    case "vibekit_create_app":
      result = await apiRequest("POST", "/hosting/apps", {
        template: args.template,
        subdomain: args.subdomain,
      });
      break;

    case "vibekit_deploy":
      result = await apiRequest("POST", "/hosting/deploy", {
        repo: args.repo,
        subdomain: args.subdomain,
      });
      break;

    case "vibekit_redeploy":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/redeploy`);
      break;

    case "vibekit_rollback":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/deploys/${args.deployId}/rollback`);
      break;

    case "vibekit_deploy_history":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/deploys`);
      break;

    case "vibekit_app_logs": {
      const lines = args.lines || 100;
      result = await apiRequest("GET", `/hosting/app/${args.appId}/logs?lines=${lines}`);
      break;
    }

    case "vibekit_restart_app":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/restart`);
      break;

    case "vibekit_stop_app":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/stop`);
      break;

    case "vibekit_start_app":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/start`);
      break;

    case "vibekit_delete_app":
      result = await apiRequest("DELETE", `/hosting/app/${args.appId}`);
      break;

    // Env
    case "vibekit_app_env":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/env`);
      break;

    case "vibekit_set_env":
      result = await apiRequest("PUT", `/hosting/app/${args.appId}/env`, {
        vars: args.vars,
      });
      break;

    case "vibekit_delete_env":
      result = await apiRequest("DELETE", `/hosting/app/${args.appId}/env/${args.key}`);
      break;

    // Agent
    case "vibekit_chat":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/agent`, {
        message: args.message,
      });
      break;

    case "vibekit_agent_status":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/agent/status`);
      break;

    case "vibekit_agent_stop":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/agent/stop`);
      break;

    case "vibekit_agent_history": {
      const limit = args.limit || 20;
      result = await apiRequest("GET", `/hosting/app/${args.appId}/agent/history?limit=${limit}`);
      break;
    }

    case "vibekit_agent_config":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/agent/config`);
      break;

    case "vibekit_agent_set_model":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/agent/config`, {
        model: args.model,
      });
      break;

    case "vibekit_exec":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/exec`, {
        command: args.command,
      });
      break;

    case "vibekit_agent_reset":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/agent/reset`);
      break;

    case "vibekit_agent_compact":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/agent/compact`);
      break;

    // Files
    case "vibekit_list_files": {
      let path = `/hosting/app/${args.appId}/agent/files`;
      if (args.path) path += `?path=${encodeURIComponent(args.path as string)}`;
      result = await apiRequest("GET", path);
      break;
    }

    case "vibekit_read_file":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/agent/file?path=${encodeURIComponent(args.path as string)}`);
      break;

    case "vibekit_write_file":
      result = await apiRequest("PUT", `/hosting/app/${args.appId}/agent/file`, {
        path: args.path,
        content: args.content,
      });
      break;

    case "vibekit_file_changes":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/agent/changes`);
      break;

    // Database
    case "vibekit_enable_database":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/database`);
      break;

    case "vibekit_database_status":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/database`);
      break;

    case "vibekit_database_schema":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/database/schema`);
      break;

    case "vibekit_database_query":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/database/query`, {
        sql: args.sql,
      });
      break;

    // Domain
    case "vibekit_add_domain":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/domain`, {
        domain: args.domain,
      });
      break;

    case "vibekit_remove_domain":
      result = await apiRequest("DELETE", `/hosting/app/${args.appId}/domain`);
      break;

    // QA
    case "vibekit_run_qa":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/qa`);
      break;

    case "vibekit_qa_status":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/qa`);
      break;

    // App-level schedules
    case "vibekit_app_schedules":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/schedules`);
      break;

    case "vibekit_create_app_schedule":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/schedules`, {
        name: args.name,
        cron: args.cron,
        task: args.task,
      });
      break;

    case "vibekit_delete_app_schedule":
      result = await apiRequest("DELETE", `/hosting/app/${args.appId}/schedules/${args.jobId}`);
      break;

    // Tasks
    case "vibekit_submit_task":
      result = await apiRequest("POST", "/task", {
        task: args.task,
        repo: args.repo,
        branch: args.branch,
        deploy: args.deploy ?? true,
        callbackUrl: args.callbackUrl,
      });
      break;

    case "vibekit_get_task":
      result = await apiRequest("GET", `/task/${args.taskId}`);
      break;

    case "vibekit_list_tasks": {
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      if (args.status) params.set("status", String(args.status));
      const qs = params.toString();
      result = await apiRequest("GET", `/tasks${qs ? `?${qs}` : ""}`);
      break;
    }

    case "vibekit_wait_for_task": {
      const taskId = args.taskId as string;
      const timeout = ((args.timeoutSeconds as number) || 300) * 1000;
      const start = Date.now();
      result = { ok: false, error: "Timeout waiting for task" };

      while (Date.now() - start < timeout) {
        const poll = await apiRequest("GET", `/task/${taskId}`);
        if (!poll.ok) { result = poll; break; }
        const task = poll.data as { status: string };
        result = poll;
        if (task.status === "completed" || task.status === "failed") break;
        await new Promise((r) => setTimeout(r, 5000));
      }
      break;
    }

    // Account-level schedules
    case "vibekit_create_schedule":
      result = await apiRequest("POST", "/schedule", {
        task: args.task,
        repo: args.repo,
        cron: args.cron,
        name: args.name,
      });
      break;

    case "vibekit_list_schedules":
      result = await apiRequest("GET", "/schedules");
      break;

    case "vibekit_delete_schedule":
      result = await apiRequest("DELETE", `/schedule/${args.scheduleId}`);
      break;

    // Account
    case "vibekit_account":
      result = await apiRequest("GET", "/account");
      break;

    // Skills
    case "vibekit_list_skills": {
      try {
        if (skillsCache && Date.now() - skillsCache.fetchedAt < CACHE_TTL) {
          let skills = (skillsCache.manifest as { skills: Array<{ tags?: string[] }> }).skills;
          if (args.tag) skills = skills.filter((s) => s.tags?.includes(args.tag as string));
          result = { ok: true, data: { skills, count: skills.length } };
          break;
        }
        const res = await fetch(`${SKILLS_REGISTRY}/skills.json`);
        if (!res.ok) { result = { ok: false, error: `Failed to fetch skills: ${res.status}` }; break; }
        const manifest = await res.json();
        skillsCache = { manifest, fetchedAt: Date.now() };
        let skills = manifest.skills;
        if (args.tag) skills = skills.filter((s: { tags?: string[] }) => s.tags?.includes(args.tag as string));
        result = { ok: true, data: { skills, count: skills.length } };
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
      }
      break;
    }

    case "vibekit_get_skill": {
      try {
        const id = args.id as string;
        if (!id) { result = { ok: false, error: "Skill ID is required" }; break; }
        const res = await fetch(`${SKILLS_REGISTRY}/skills/${id}/SKILL.md`);
        if (!res.ok) { result = { ok: false, error: `Skill '${id}' not found (${res.status})` }; break; }
        const content = await res.text();
        result = { ok: true, data: { id, content } };
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
      }
      break;
    }

    default:
      result = { ok: false, error: `Unknown tool: ${name}` };
  }

  const text = result.ok
    ? JSON.stringify(result.data, null, 2)
    : `Error: ${result.error}`;

  return { content: [{ type: "text", text }] };
}

// Server setup
const server = new Server(
  { name: "vibekit-mcp", version: "0.5.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleTool(name, (args || {}) as Record<string, unknown>);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VibeKit MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});