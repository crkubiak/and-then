// Run with: node --test test/
// The real app server on a scratch copy of samples/demo, and the real MCP server over stdio, driven
// by the SDK's own client. Afterwards the files on disk must pass the validator.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TaskList } from '../public/js/model/TaskList.js';
import { Validator } from '../public/js/rules/Validator.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 4400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

let dataDirectory;
let appServer;
let mcp;

before(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), 'taskflow-mcp-'));
  await cp(path.join(ROOT, 'samples', 'demo'), dataDirectory, { recursive: true });
  appServer = spawn('node', ['server.js', dataDirectory], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(`${BASE}/api/files`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  mcp = new Client({ name: 'test', version: '1' });
  await mcp.connect(new StdioClientTransport({
    command: 'node',
    args: ['mcp/server.js'],
    cwd: ROOT,
    env: { ...process.env, TASKFLOW_URL: BASE, TASKFLOW_AGENT: 'Opus_5.5' },
  }));
});

after(async () => {
  await mcp?.close();
  appServer?.kill();
  await rm(dataDirectory, { recursive: true, force: true });
});

async function call(name, args = {}) {
  const response = await mcp.callTool({ name, arguments: args });
  const text = response.content[0].text;
  return { isError: response.isError === true, text, json: response.isError ? null : JSON.parse(text) };
}

async function filesOnDisk() {
  const [todo, done] = await Promise.all(['todo.txt', 'done.txt'].map((name) => readFile(path.join(dataDirectory, name), 'utf8')));
  return { todo, done };
}

test('the server lists the seven tools', async () => {
  const { tools } = await mcp.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'add_task', 'complete_task', 'flag_needs_human', 'list_tasks', 'set_wip', 'update_task', 'validate',
  ]);
});

test('an agent can add, start, ask, and complete work, and the files stay valid', async () => {
  const before = (await call('validate')).json;
  const added = await call('add_task', { text: 'Draft the rollout plan +Infra @office' });
  assert.equal(added.isError, false, added.text);
  const id = added.json.id;
  assert.match(added.json.line, new RegExp(`^\\d{4}-\\d\\d-\\d\\d Draft the rollout plan \\+Infra @office id:${id} by:Opus_5\\.5$`));

  assert.equal((await call('set_wip', { task: id, working: true })).json.wip, 'Opus_5.5');
  const asked = await call('flag_needs_human', { task: id, question: 'Which region goes first?' });
  assert.equal(asked.json.flagged, id);
  const afterAsk = (await filesOnDisk()).todo;
  assert.match(afterAsk, new RegExp(`Draft the rollout plan .* needs:human$`, 'm'));
  const taskLine = afterAsk.split('\n').find((line) => line.includes(`id:${id} `));
  assert.doesNotMatch(taskLine, /wip:/);
  assert.match(afterAsk, new RegExp(`Which region goes first\\? parent:${id} by:Opus_5\\.5$`, 'm'));

  const waiting = await call('list_tasks', { needsHuman: true });
  assert.ok(waiting.json.some((t) => t.id === id));

  const early = await call('complete_task', { task: id });
  assert.equal(early.isError, true);
  assert.match(early.text, /open subtasks first/);

  const question = asked.json.question;
  assert.equal((await call('complete_task', { task: question.line })).isError, false);
  assert.equal((await call('complete_task', { task: id })).isError, false);
  const finished = (await filesOnDisk()).todo;
  assert.match(finished, new RegExp(`^x \\d{4}-\\d\\d-\\d\\d \\d{4}-\\d\\d-\\d\\d Draft the rollout plan \\+Infra @office id:${id} by:Opus_5\\.5$`, 'm'));

  const { todo, done } = await filesOnDisk();
  const problems = Validator.validate(new TaskList({ todo, done })).filter((p) => p.severity === 'error');
  assert.deepEqual(problems, []);
  assert.deepEqual((await call('validate')).json.filter((p) => p.severity === 'error'), before.filter((p) => p.severity === 'error'));
});

test('a write made outside the tool between its read and save is kept, not overwritten', async () => {
  // The app server rejects a stale save with 409. The MCP client reads fresh files on every call,
  // so an external edit made just before is part of what it reads and must survive its write.
  const { todo } = await filesOnDisk();
  await writeFile(path.join(dataDirectory, 'todo.txt'), `${todo}2026-11-05 Added by hand by:me\n`);
  const added = await call('add_task', { text: 'Added by the agent' });
  assert.equal(added.isError, false, added.text);
  const after = (await filesOnDisk()).todo;
  assert.match(after, /Added by hand by:me\n/);
  assert.match(after, /Added by the agent id:\d+ by:Opus_5\.5\n$/);
});

test('a refusal comes back as a tool error with the reason', async () => {
  const bad = await call('add_task', { text: 'Orphan', parent: '99999' });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /parent:99999 is not a task/);
  const missing = await call('complete_task', { task: 'no-such-id' });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /No open or completed task/);
  const unnamed = await call('set_wip', { task: '1', working: true, agent: 'Opus 5.5' });
  assert.equal(unnamed.isError, true);
  assert.match(unnamed.text, /Model_version/);
});
