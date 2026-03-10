#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const API_BASE = process.env.VIBEKIT_API_URL || "https://vibekit.bot/api/v1";
const API_KEY = process.env.VIBEKIT_API_KEY || "";
const SKILLS_REGISTRY = "https://raw.githubusercontent.com/vibekit-apps/skills-registry/main";
// Skills cache (TTL: 5 minutes)
let skillsCache = null;
const CACHE_TTL = 5 * 60 * 1000;
if (!API_KEY) {
    console.error("Error: VIBEKIT_API_KEY environment variable is required");
    console.error("Get one at https://t.me/the_vibe_kit_bot with /apikey command");
    process.exit(1);
}
// API helper
async function apiRequest(method, path, body) {
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
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
}
// Tool definitions
const tools = [
    {
        name: "vibekit_submit_task",
        description: "Submit a coding task to VibeKit. The AI will write code, commit to GitHub, and deploy to Vercel. Returns a task ID to poll for results.",
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
async function handleTool(name, args) {
    let result;
    switch (name) {
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
            if (args.limit)
                params.set("limit", String(args.limit));
            if (args.status)
                params.set("status", String(args.status));
            if (params.toString())
                path += `?${params.toString()}`;
            result = await apiRequest("GET", path);
            break;
        }
        case "vibekit_wait_for_task": {
            const taskId = args.taskId;
            const timeout = (args.timeoutSeconds || 300) * 1000;
            const start = Date.now();
            while (Date.now() - start < timeout) {
                result = await apiRequest("GET", `/task/${taskId}`);
                if (!result.ok)
                    break;
                const task = result.data;
                if (task.status === "completed" || task.status === "failed") {
                    break;
                }
                await new Promise((r) => setTimeout(r, 5000));
            }
            if (!result) {
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
        case "vibekit_account":
            result = await apiRequest("GET", "/account");
            break;
        case "vibekit_list_skills": {
            try {
                // Check cache
                if (skillsCache && Date.now() - skillsCache.fetchedAt < CACHE_TTL) {
                    let skills = skillsCache.manifest.skills;
                    if (args.tag) {
                        skills = skills.filter((s) => s.tags?.includes(args.tag));
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
                    skills = skills.filter((s) => s.tags?.includes(args.tag));
                }
                result = { ok: true, data: { skills, count: skills.length } };
            }
            catch (err) {
                result = { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
            }
            break;
        }
        case "vibekit_get_skill": {
            try {
                const id = args.id;
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
            }
            catch (err) {
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
const server = new index_js_1.Server({
    name: "vibekit-mcp",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Handle tool listing
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
    tools,
}));
// Handle tool calls
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleTool(name, (args || {}));
});
// Start server
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error("VibeKit MCP server running on stdio");
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
