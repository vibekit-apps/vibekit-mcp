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
  console.error("Get one at https://t.me/the_vibe_kit_bot with /apikey command");
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
  // Hosting & Apps
  {
    name: "vibekit_list_apps",
    description: "List all hosted apps in your VibeKit account.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "vibekit_get_app",
    description: "Get details about a specific hosted app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "The app ID to get details for",
        },
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
        template: {
          type: "string",
          description: "Template to use (e.g., 'nextjs', 'react', 'express')",
        },
        subdomain: {
          type: "string",
          description: "Subdomain for the app (will be deployed to {subdomain}.vibekit.bot)",
        },
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
        repo: {
          type: "string",
          description: "GitHub repo in format 'owner/repo'",
        },
        subdomain: {
          type: "string",
          description: "Subdomain for the app (will be deployed to {subdomain}.vibekit.bot)",
        },
      },
      required: ["repo", "subdomain"],
    },
  },
  {
    name: "vibekit_redeploy",
    description: "Redeploy an existing hosted app to update it with latest code.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "The app ID to redeploy",
        },
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
        appId: {
          type: "string",
          description: "The app ID to get logs for",
        },
        lines: {
          type: "number",
          description: "Number of log lines to retrieve (default: 100)",
        },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_restart_app",
    description: "Restart a hosted app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "The app ID to restart",
        },
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
        appId: {
          type: "string",
          description: "The app ID to stop",
        },
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
        appId: {
          type: "string",
          description: "The app ID to start",
        },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_app_env",
    description: "Get environment variables for a hosted app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "The app ID to get environment variables for",
        },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_set_env",
    description: "Set environment variables for a hosted app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "The app ID to set environment variables for",
        },
        vars: {
          type: "object",
          description: "Object of key-value pairs to set as environment variables",
        },
      },
      required: ["appId", "vars"],
    },
  },
  {
    name: "vibekit_delete_app",
    description: "Delete a hosted app permanently.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "The app ID to delete",
        },
      },
      required: ["appId"],
    },
  },
  // AI Agent
  {
    name: "vibekit_chat",
    description: "Chat with an app's AI agent. The agent can read, write, and modify the app's code.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "The app ID to chat with the agent for",
        },
        message: {
          type: "string",
          description: "Message to send to the AI agent",
        },
      },
      required: ["appId", "message"],
    },
  },
  {
    name: "vibekit_agent_status",
    description: "Get the status of an app's AI agent.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "The app ID to get agent status for",
        },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_agent_history",
    description: "Get chat history with an app's AI agent.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "The app ID to get agent history for",
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to return (default: 20)",
        },
      },
      required: ["appId"],
    },
  },
  // Database
  {
    name: "vibekit_enable_database",
    description: "Enable database for a hosted app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "The app ID to enable database for",
        },
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
        appId: {
          type: "string",
          description: "The app ID to get database status for",
        },
      },
      required: ["appId"],
    },
  },
  // QA
  {
    name: "vibekit_run_qa",
    description: "Run automated QA tests on a hosted app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "The app ID to run QA tests for",
        },
      },
      required: ["appId"],
    },
  },
  {
    name: "vibekit_qa_status",
    description: "Get QA test results and status for an app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "The app ID to get QA status for",
        },
      },
      required: ["appId"],
    },
  },
  // Tasks (existing)
  {
    name: "vibekit_submit_task",
    description: "Submit a coding task to VibeKit. The AI will write code, commit to GitHub, and deploy to {subdomain}.vibekit.bot. Returns a task ID to poll for results.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "What you want built or changed. Be specific about features, design, and behavior.",
        },
        repo: {
          type: "string",
          description: "GitHub repo in format 'owner/repo'. Optional — will use user's current repo if not specified.",
        },
        branch: {
          type: "string",
          description: "Git branch to work on. Default: main",
        },
        deploy: {
          type: "boolean",
          description: "Auto-deploy to Vercel when done. Default: true",
        },
        callbackUrl: {
          type: "string",
          description: "Webhook URL to receive task completion notification.",
        },
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
        taskId: {
          type: "string",
          description: "The task ID returned from vibekit_submit_task",
        },
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
        limit: {
          type: "number",
          description: "Max number of tasks to return. Default: 10",
        },
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
    description: "Wait for a task to complete and return the result. Polls every 5 seconds up to the timeout.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The task ID to wait for",
        },
        timeoutSeconds: {
          type: "number",
          description: "Max seconds to wait. Default: 300 (5 minutes)",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "vibekit_create_schedule",
    description: "Create a scheduled recurring task. The AI will run this task automatically on the specified schedule.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "What to do on each run. e.g., 'Improve SEO and page speed'",
        },
        repo: {
          type: "string",
          description: "GitHub repo in format 'owner/repo'",
        },
        cron: {
          type: "string",
          description: "Cron expression. e.g., '0 9 * * 1' for every Monday at 9am UTC",
        },
        name: {
          type: "string",
          description: "Friendly name for the schedule",
        },
      },
      required: ["task", "repo", "cron"],
    },
  },
  {
    name: "vibekit_list_schedules",
    description: "List all scheduled tasks.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "vibekit_delete_schedule",
    description: "Delete a scheduled task.",
    inputSchema: {
      type: "object",
      properties: {
        scheduleId: {
          type: "string",
          description: "The schedule ID to delete",
        },
      },
      required: ["scheduleId"],
    },
  },
  // Account
  {
    name: "vibekit_account",
    description: "Get VibeKit account info including plan, credits balance, and usage.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "vibekit_list_skills",
    description: "List all available implementation skills. Returns skill IDs, names, descriptions, and tags. Use this to discover what skills are available before fetching specific ones.",
    inputSchema: {
      type: "object",
      properties: {
        tag: {
          type: "string",
          description: "Filter skills by tag (e.g., 'react', 'database', 'security')",
        },
      },
    },
  },
  {
    name: "vibekit_get_skill",
    description: "Fetch the full content of a specific skill. Skills contain implementation patterns, code examples, and best practices for a domain. Fetch skills on-demand when you need guidance on a specific topic.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Skill ID from vibekit_list_skills (e.g., 'nextjs', 'trpc', 'auth')",
        },
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
    // Hosting & Apps
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

    case "vibekit_app_logs": {
      let path = `/hosting/app/${args.appId}/logs`;
      if (args.lines) {
        path += `?lines=${args.lines}`;
      } else {
        path += "?lines=100";
      }
      result = await apiRequest("GET", path);
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

    case "vibekit_app_env":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/env`);
      break;

    case "vibekit_set_env":
      result = await apiRequest("PUT", `/hosting/app/${args.appId}/env`, {
        vars: args.vars,
      });
      break;

    case "vibekit_delete_app":
      result = await apiRequest("DELETE", `/hosting/app/${args.appId}`);
      break;

    // AI Agent
    case "vibekit_chat":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/agent`, {
        message: args.message,
      });
      break;

    case "vibekit_agent_status":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/agent/status`);
      break;

    case "vibekit_agent_history": {
      let path = `/hosting/app/${args.appId}/agent/history`;
      if (args.limit) {
        path += `?limit=${args.limit}`;
      } else {
        path += "?limit=20";
      }
      result = await apiRequest("GET", path);
      break;
    }

    // Database
    case "vibekit_enable_database":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/database`);
      break;

    case "vibekit_database_status":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/database`);
      break;

    // QA
    case "vibekit_run_qa":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/qa`);
      break;

    case "vibekit_qa_status":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/qa`);
      break;

    // Tasks (existing)
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
      let path = "/tasks";
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      if (args.status) params.set("status", String(args.status));
      if (params.toString()) path += `?${params.toString()}`;
      result = await apiRequest("GET", path);
      break;
    }

    case "vibekit_wait_for_task": {
      const taskId = args.taskId as string;
      const timeout = ((args.timeoutSeconds as number) || 300) * 1000;
      const start = Date.now();
      
      while (Date.now() - start < timeout) {
        result = await apiRequest("GET", `/task/${taskId}`);
        if (!result.ok) break;
        
        const task = result.data as { status: string };
        if (task.status === "completed" || task.status === "failed") {
          break;
        }
        
        await new Promise((r) => setTimeout(r, 5000));
      }
      
      if (!result!) {
        result = { ok: false, error: "Timeout waiting for task" };
      }
      break;
    }

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

    case "vibekit_list_skills": {
      try {
        // Check cache
        if (skillsCache && Date.now() - skillsCache.fetchedAt < CACHE_TTL) {
          let skills = (skillsCache.manifest as { skills: Array<{ tags?: string[] }> }).skills;
          if (args.tag) {
            skills = skills.filter((s) => s.tags?.includes(args.tag as string));
          }
          result = { ok: true, data: { skills } };
          break;
        }

        // Fetch manifest
        const res = await fetch(`${SKILLS_REGISTRY}/skills.json`);
        if (!res.ok) {
          result = { ok: false, error: `Failed to fetch skills: ${res.status}` };
          break;
        }
        const manifest = await res.json();
        skillsCache = { manifest, fetchedAt: Date.now() };

        let skills = manifest.skills;
        if (args.tag) {
          skills = skills.filter((s: { tags?: string[] }) => s.tags?.includes(args.tag as string));
        }
        result = { ok: true, data: { skills, count: skills.length } };
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
      }
      break;
    }

    case "vibekit_get_skill": {
      try {
        const id = args.id as string;
        if (!id) {
          result = { ok: false, error: "Skill ID is required" };
          break;
        }

        const res = await fetch(`${SKILLS_REGISTRY}/skills/${id}/SKILL.md`);
        if (!res.ok) {
          result = { ok: false, error: `Skill '${id}' not found (${res.status})` };
          break;
        }

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

// Main server setup
const server = new Server(
  {
    name: "vibekit-mcp",
    version: "0.4.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleTool(name, (args || {}) as Record<string, unknown>);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VibeKit MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});