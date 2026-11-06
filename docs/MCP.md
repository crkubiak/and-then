# TaskFlow MCP server

An MCP server over stdio that lets an agent read and update the tasks in a running TaskFlow app. It is a thin client of the app's HTTP API (`GET` and `PUT /api/files`), so every write gets the server's version check, atomic file writes and the live update to open browser tabs. It never touches `todo.txt` or `done.txt` itself.

**The app must be running.** If it is not, every tool answers "Cannot reach TaskFlow". Stdio is enough for one user on one machine. Agents on another machine or in the cloud would need an HTTP transport, which this does not have.

## Run and register

Install once from the repo root: `npm install`. This adds `@modelcontextprotocol/sdk` and `zod`. The app itself (`node server.js`) still has no dependencies.

Both settings are optional. Register with just the command unless you need one.

| Setting | Default | When to set it |
| :--- | :--- | :--- |
| `TASKFLOW_URL` | `http://127.0.0.1:3000` | Only if the app runs on a different port. |
| `TASKFLOW_AGENT` | none | Only if one model is the only thing that ever calls this. Each write tool takes an `agent` argument (`Model_version`, no spaces, e.g. `Opus_5.5`), so the agent names itself on every write and the stamp is always right. This setting is only a fallback, and a stale one stamps the wrong model on a `by:` tag that cannot be changed later. |

### In the `~/.claude-8l` profile

```
CLAUDE_CONFIG_DIR=~/.claude-8l claude mcp add --scope user taskflow \
  -- node /Users/charleskubiak/Repositories/todo-app/mcp/server.js
```

This writes to the profile's own user config, so every project opened from that profile can use it.

### In one project, with `.mcp.json`

Put this in the root of the project whose agents should see the tasks:

```json
{
  "mcpServers": {
    "taskflow": {
      "command": "node",
      "args": ["/Users/charleskubiak/Repositories/todo-app/mcp/server.js"]
    }
  }
}
```

Claude Code asks for approval the first time it sees a project `.mcp.json`.

## Agent skill

The `taskflow-tasks` skill in `~/.claude-8l/skills/taskflow-tasks/` tells an agent how to use these tools: where tasks live, how to name itself, and what `wip:`, `needs:human`, `by:`, `parent:` and `dep:` mean for it. It links to `docs/FORMAT.md` rather than repeating it. It lives in the profile, not in this repo. A copy of it also sits in `~/.claude/skills/taskflow-tasks/`, for the standard profile.

## Tools

A task is named by its `id`, or when it has none by its exact line as `list_tasks` returned it. Writes return the changed task. A refusal comes back as a tool error that says why.

| Tool | Does |
| :--- | :--- |
| `list_tasks` | Tasks in `todo.txt`, open by default. Filters: `project`, `context`, `status` (`open`, `done`, `all`), `needsHuman`, `wip`. The `done.txt` archive is not searched. |
| `add_task` | Adds an open task with today's date, a new `id` and `by:<you>`. Optional `parent` and `dep`. |
| `update_task` | Replaces a whole open line. Same rules as inline edit in the app: keep the `id`, creation date and `by:`. |
| `complete_task` | Completes a task and drops its `wip:` and `needs:`. Refused with open subtasks, and when blocked by a `dep:` unless `allowBlocked` is set. |
| `set_wip` | Sets or clears your own `wip:`. Refused when another agent holds the task or when it has `needs:human`. |
| `flag_needs_human` | Adds `needs:human`, removes your `wip:`, and with `question` adds a subtask the user completes as the answer. Never clears `needs:human`. |
| `validate` | The app's validator over both files: file, line, severity, code, message. |

## What the server guarantees

- Every write follows `docs/FORMAT.md`: creation date and `by:` on lines it creates, `id:` never changed, `wip:` and `needs:` stripped on completion.
- A write is refused, and nothing saved, if it would add a validator problem the files did not already have.
- If the user saves in the browser between the tool's read and its save, the server answers 409. The tool reads the newer files, applies the same edit again, and saves that. Up to five tries.
- Logs go to stderr. Stdout belongs to the protocol.

Tests: `node --test test/` starts the real app and this server over stdio, drives the tools, and checks the files on disk pass the validator.
