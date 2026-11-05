// MCP server over stdio for TaskFlow. Register it with an MCP client; see docs/MCP.md.
// stdout belongs to the protocol, so anything this process says for humans goes to stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TaskflowClient } from './client.js';
import { Operations, ToolError } from './operations.js';

const AGENT_FROM_ENV = process.env.TASKFLOW_AGENT;
const client = new TaskflowClient({ baseUrl: process.env.TASKFLOW_URL ?? 'http://127.0.0.1:3000' });

// Local calendar date, YYYY-MM-DD, like the app.
function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const reply = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const refuse = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });

// Wraps a tool body: a ToolError becomes a readable refusal, anything else is a real failure.
function tool(body) {
  return async (args) => {
    try {
      return reply(await body(args));
    } catch (err) {
      if (err instanceof ToolError) return refuse(err.message);
      process.stderr.write(`${err?.stack ?? err}\n`);
      return refuse(`TaskFlow tool failed: ${err?.message ?? err}`);
    }
  };
}

const agentField = z.string().optional().describe('Who you are, as Model_version with no spaces, e.g. Opus_5.5. Defaults to the TASKFLOW_AGENT setting.');
const taskField = z.string().describe('The task id, or for a task with no id its exact line as list_tasks returned it.');
const writeContext = (args) => ({ agent: args.agent ?? AGENT_FROM_ENV, today: today() });

const server = new McpServer({ name: 'taskflow', version: '1.0.0' });

server.registerTool('list_tasks', {
  description: 'List tasks in todo.txt (the archive in done.txt is not searched). Open tasks by default. Every filter is optional and they combine.',
  inputSchema: {
    project: z.string().optional().describe('Project name without the +. Subtasks count under their root task\'s project.'),
    context: z.string().optional().describe('Context name without the @.'),
    status: z.enum(['open', 'done', 'all']).optional().describe('Default open.'),
    needsHuman: z.boolean().optional().describe('true: only tasks waiting for the user. false: only the rest.'),
    wip: z.boolean().optional().describe('true: only tasks an agent is working on. false: only the rest.'),
  },
  annotations: { readOnlyHint: true },
}, tool(async (args) => {
  const { taskList } = await client.read();
  return Operations.list(taskList, args);
}));

server.registerTool('add_task', {
  description: 'Add an open task. Stamps the creation date and by:<you>, and gives it an id. Write the text as todo.txt: description, +project, @context, due:YYYY-MM-DD, (A) priority first. A subtask takes its root task\'s project, so leave +project out.',
  inputSchema: {
    text: z.string().min(1).describe('The task line without the date, id and by:, which are added.'),
    parent: z.string().optional().describe('Id of the task this is a subtask of.'),
    dep: z.string().optional().describe('Id of a task that must be completed before this one.'),
    agent: agentField,
  },
}, tool((args) => client.update((list) => Operations.add(list, args, writeContext(args)))));

server.registerTool('update_task', {
  description: 'Replace a whole open task line, for example to change its text, due date or project. Same rules as editing in the app: keep the id, the creation date and by:. To complete, use complete_task. To change wip: or needs:, use set_wip or flag_needs_human.',
  inputSchema: {
    task: taskField,
    line: z.string().describe('The full new line, starting from the line list_tasks returned.'),
  },
}, tool((args) => client.update((list) => Operations.update(list, args))));

server.registerTool('complete_task', {
  description: 'Complete an open task. Removes its wip: and needs: tags. Refused while it has open subtasks, and while it is blocked by a dep: unless allowBlocked is true.',
  inputSchema: {
    task: taskField,
    allowBlocked: z.boolean().optional().describe('Only when the user said to finish it before its dependency.'),
  },
}, tool((args) => client.update((list) => Operations.complete(list, args, writeContext(args)))));

server.registerTool('set_wip', {
  description: 'Mark that you are working on a task (working: true) or that you stopped (working: false). Only touches your own wip: tag. Refused when another agent holds the task or when it is waiting for the user.',
  inputSchema: {
    task: taskField,
    working: z.boolean(),
    agent: agentField,
  },
}, tool((args) => client.update((list) => Operations.setWip(list, args, writeContext(args)))));

server.registerTool('flag_needs_human', {
  description: 'You are blocked on the user. Adds needs:human, removes your wip:, and with `question` adds it as a subtask the user can complete as the answer. Never clears needs:human: only the user does that.',
  inputSchema: {
    task: taskField,
    question: z.string().optional().describe('What you need from the user, as a short task.'),
    agent: agentField,
  },
}, tool((args) => client.update((list) => Operations.flagNeedsHuman(list, args, writeContext(args)))));

server.registerTool('validate', {
  description: 'Check todo.txt and done.txt as the app does. Returns problems with file, line, severity and code. An empty list means clean.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, tool(async () => {
  const { taskList } = await client.read();
  return Operations.validate(taskList);
}));

await server.connect(new StdioServerTransport());
process.stderr.write('taskflow MCP server ready on stdio\n');
