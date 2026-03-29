# vibekit-mcp

MCP server for VibeKit — control your hosted apps, AI agents, and deployments from Claude Desktop, Cursor, or any MCP client.

## Quick Start

**1. Install**

```bash
npm install -g vibekit-mcp
```

**2. Get an API key**

Go to [app.vibekit.bot](https://app.vibekit.bot) → Settings → API Keys, or via Telegram: [@the_vibe_kit_bot](https://t.me/the_vibe_kit_bot) → `/apikey`

**3. Add to Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "vibekit": {
      "command": "vibekit-mcp",
      "env": {
        "VIBEKIT_API_KEY": "vk_your_api_key_here"
      }
    }
  }
}
```

**4. Restart your MCP client** and start building.

---

## What You Can Do

### Apps

| Tool | Description |
|------|-------------|
| `vibekit_list_apps` | List all your hosted apps |
| `vibekit_get_app` | Get app details (status, URL, memory, uptime) |
| `vibekit_create_app` | Create a new app from a template |
| `vibekit_deploy` | Deploy a GitHub repo |
| `vibekit_redeploy` | Redeploy with latest code |
| `vibekit_rollback` | Roll back to a previous snapshot |
| `vibekit_deploy_history` | List deployment snapshots |
| `vibekit_app_logs` | Get runtime logs |
| `vibekit_restart_app` | Restart an app |
| `vibekit_stop_app` | Stop an app |
| `vibekit_start_app` | Start a stopped app |
| `vibekit_delete_app` | Permanently delete an app |
| `vibekit_exec` | Run a shell command inside a running container |

### Environment Variables

| Tool | Description |
|------|-------------|
| `vibekit_app_env` | Get env vars (values revealed) |
| `vibekit_set_env` | Set one or more env vars |
| `vibekit_delete_env` | Delete a specific env var |

### AI Agent

| Tool | Description |
|------|-------------|
| `vibekit_chat` | Send a message to an app's AI agent |
| `vibekit_agent_status` | Check if agent is idle or running |
| `vibekit_agent_stop` | Stop a running agent request |
| `vibekit_agent_history` | Get conversation history |
| `vibekit_agent_config` | Get current model config |
| `vibekit_agent_set_model` | Change model (`claude-opus-4-6`, `claude-sonnet-4-20250514`, `claude-haiku-3.5`) |
| `vibekit_agent_reset` | Reset agent (clear sessions, memory, restart, or cleanup disk) |
| `vibekit_agent_compact` | Compact agent memory to free context |

### Files

| Tool | Description |
|------|-------------|
| `vibekit_list_files` | List files in the workspace |
| `vibekit_read_file` | Read a file's contents |
| `vibekit_write_file` | Write or update a file |
| `vibekit_file_changes` | See uncommitted file changes |

### Database

| Tool | Description |
|------|-------------|
| `vibekit_enable_database` | Provision a Postgres database |
| `vibekit_database_status` | Connection info and stats |
| `vibekit_database_schema` | Get tables and columns |
| `vibekit_database_query` | Run a SQL query |

### Custom Domains

| Tool | Description |
|------|-------------|
| `vibekit_add_domain` | Add a custom domain |
| `vibekit_remove_domain` | Remove a custom domain |

### QA

| Tool | Description |
|------|-------------|
| `vibekit_run_qa` | Run automated QA tests |
| `vibekit_qa_status` | Get latest QA results |

### Cron Schedules (per app)

| Tool | Description |
|------|-------------|
| `vibekit_app_schedules` | List cron jobs for an app |
| `vibekit_create_app_schedule` | Create a cron job |
| `vibekit_delete_app_schedule` | Delete a cron job |

### Async Coding Tasks

| Tool | Description |
|------|-------------|
| `vibekit_submit_task` | Submit an async coding task (GitHub-based) |
| `vibekit_get_task` | Get task status and result |
| `vibekit_list_tasks` | List recent tasks |
| `vibekit_wait_for_task` | Poll until task completes |
| `vibekit_create_schedule` | Create a recurring coding task |
| `vibekit_list_schedules` | List recurring schedules |
| `vibekit_delete_schedule` | Delete a schedule |

### Account & Skills

| Tool | Description |
|------|-------------|
| `vibekit_account` | Plan, credits, and usage |
| `vibekit_list_skills` | Browse implementation skills |
| `vibekit_get_skill` | Fetch a skill's full content |

---

## Example Prompts

```
"List my apps and show the logs for the one that's erroring"

"Chat with the agent on my 'dogs' app — ask it to add a dark mode toggle"

"Read the server.js file from my app and tell me what it does"

"Run a SQL query on my app's database: SELECT COUNT(*) FROM users"

"Redeploy my app, then run QA and show me the results"

"Roll back my app to the previous deployment"

"Set DATABASE_URL and STRIPE_SECRET as env vars on my app, then restart it"

"Check my account balance and show how many sessions I've used this month"
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VIBEKIT_API_KEY` | Your VibeKit API key (required) | — |
| `VIBEKIT_API_URL` | API base URL | `https://vibekit.bot/api/v1` |

---

## Links

- [Dashboard](https://app.vibekit.bot)
- [Website](https://vibekit.bot)
- [API Docs](https://vibekit.bot/SKILL.md)
- [GitHub](https://github.com/609NFT/vibekit)
