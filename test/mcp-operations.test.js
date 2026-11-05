// Run with: node --test test/
// The pure edits behind the MCP tools, and the client's 409 re-apply, with no server and no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskList } from '../public/js/model/TaskList.js';
import { Validator } from '../public/js/rules/Validator.js';
import { Operations, ToolError } from '../mcp/operations.js';
import { TaskflowClient } from '../mcp/client.js';

const TODAY = '2026-11-05';
const AGENT = 'Opus_5.5';
const context = { agent: AGENT, today: TODAY };

const TODO = [
  '(A) 2026-11-01 Plan rack upgrade +Infra id:1 by:me',
  '2026-11-01 Get quotes parent:1 id:2 by:me',
  '2026-11-01 Order racks parent:1 id:3 dep:2 by:me',
  '2026-11-02 Buy lunch @office',
  '2026-11-02 Buy lunch @office',
  'x 2026-11-03 2026-11-01 Renew license +Ops id:4',
].join('\n') + '\n';

const sample = () => new TaskList({ todo: TODO, done: '' });
const errorsOf = (list) => Validator.validate(list).filter((p) => p.severity === 'error');
const lines = (list) => list.toText().todo.trimEnd().split('\n');
const refused = (fn, pattern) => assert.throws(fn, (err) => err instanceof ToolError && pattern.test(err.message));

test('list filters by status, project, context, wip and needs:human', () => {
  const list = new TaskList({ todo: `${TODO}2026-11-02 Dig @office +Infra id:9 wip:Opus_5.5 needs:human\n`, done: '' });
  assert.equal(Operations.list(list).length, 6);
  assert.deepEqual(Operations.list(list, { status: 'done' }).map((t) => t.id), ['4']);
  assert.equal(Operations.list(list, { status: 'all' }).length, 7);
  assert.deepEqual(Operations.list(list, { project: 'Infra' }).map((t) => t.id), ['1', '2', '3', '9']);
  assert.deepEqual(Operations.list(list, { context: 'office' }).map((t) => t.id), [null, null, '9']);
  assert.deepEqual(Operations.list(list, { wip: true }).map((t) => t.id), ['9']);
  assert.deepEqual(Operations.list(list, { needsHuman: true }).map((t) => t.id), ['9']);
  assert.equal(Operations.list(list, { needsHuman: false }).length, 5);
});

test('add stamps the date, an id after the highest, and by:<agent>', () => {
  const { list, result } = Operations.add(sample(), { text: 'Call vendor +Infra @phone' }, context);
  assert.equal(lines(list).at(-1), '2026-11-05 Call vendor +Infra @phone id:5 by:Opus_5.5');
  assert.equal(result.id, '5');
  assert.deepEqual(errorsOf(list), []);
});

test('add as a subtask keeps the project of its root and may depend on another task', () => {
  const { list } = Operations.add(sample(), { text: 'Rack the racks', parent: '1', dep: '3' }, context);
  assert.equal(lines(list).at(-1), '2026-11-05 Rack the racks parent:1 dep:3 id:5 by:Opus_5.5');
  assert.deepEqual(errorsOf(list), []);
  refused(() => Operations.add(sample(), { text: 'Thing +Ops', parent: '1' }, context), /root's project/);
  refused(() => Operations.add(sample(), { text: 'Thing', parent: '99' }, context), /not a task in todo.txt/);
  refused(() => Operations.add(sample(), { text: 'Thing', dep: '99' }, context), /dep:99/);
});

test('add refuses a missing agent, a by: or wip: in the text, and a repeated parent', () => {
  refused(() => Operations.add(sample(), { text: 'Thing' }, { agent: undefined, today: TODAY }), /Model_version/);
  refused(() => Operations.add(sample(), { text: 'Thing' }, { agent: 'Opus 5.5', today: TODAY }), /Model_version/);
  refused(() => Operations.add(sample(), { text: 'Thing by:me' }, context), /by:/);
  refused(() => Operations.add(sample(), { text: 'Thing wip:Opus_5.5' }, context), /set_wip/);
  refused(() => Operations.add(sample(), { text: 'Thing parent:1', parent: '1' }, context), /once/);
  refused(() => Operations.add(sample(), { text: '   ' }, context), /description/);
  refused(() => Operations.add(sample(), { text: 'x 2026-11-05 Done already' }, context), /open tasks only/);
});

test('complete strips wip and needs, keeps the priority after the dates and refuses open subtasks', () => {
  const list = new TaskList({ todo: '(B) 2026-11-01 Task id:7 wip:Opus_5.5 needs:human by:me\n', done: '' });
  const done = Operations.complete(list, { task: '7' }, context).list;
  assert.equal(lines(done)[0], 'x 2026-11-05 2026-11-01 (B) Task id:7 by:me');
  refused(() => Operations.complete(sample(), { task: '1' }, context), /subtasks first: 2, 3/);
  refused(() => Operations.complete(sample(), { task: '4' }, context), /already complete/);
});

test('complete refuses a blocked task unless allowBlocked is set', () => {
  refused(() => Operations.complete(sample(), { task: '3' }, context), /Blocked by dep:2/);
  const { list } = Operations.complete(sample(), { task: '3', allowBlocked: true }, context);
  assert.match(lines(list)[2], /^x 2026-11-05 2026-11-01 Order racks/);
});

test('a task without an id is named by its exact line, and identical lines are ambiguous', () => {
  refused(() => Operations.complete(sample(), { task: '2026-11-02 Buy lunch @office' }, context), /identical/);
  const list = new TaskList({ todo: '2026-11-02 Walk dog\n', done: '' });
  const { list: after } = Operations.setWip(list, { task: '2026-11-02 Walk dog', working: true }, context);
  assert.equal(lines(after)[0], '2026-11-02 Walk dog wip:Opus_5.5');
  refused(() => Operations.complete(list, { task: 'nope' }, context), /No open or completed task/);
});

test('set_wip sets, clears and leaves other agents and waiting tasks alone', () => {
  const on = Operations.setWip(sample(), { task: '2', working: true }, context).list;
  assert.match(lines(on)[1], / by:me wip:Opus_5.5$/);
  assert.equal(Operations.setWip(on, { task: '2', working: true }, context).list, on, 'already set is a no-op');
  assert.doesNotMatch(lines(Operations.setWip(on, { task: '2', working: false }, context).list)[1], /wip:/);
  const flash = { ...context, agent: 'Flash_3.1' };
  refused(() => Operations.setWip(on, { task: '2', working: true }, flash), /Another agent/);
  refused(() => Operations.setWip(on, { task: '2', working: false }, flash), /not yours/);
  const waiting = new TaskList({ todo: '2026-11-01 Ask id:8 needs:human\n', done: '' });
  refused(() => Operations.setWip(waiting, { task: '8', working: true }, context), /waiting for the user/);
  refused(() => Operations.setWip(sample(), { task: '4', working: true }, context), /complete/);
});

test('flag_needs_human swaps your wip for needs:human and adds the question as a subtask', () => {
  const working = Operations.setWip(sample(), { task: '2', working: true }, context).list;
  const { list } = Operations.flagNeedsHuman(working, { task: '2', question: 'Which vendor?' }, context);
  assert.equal(lines(list)[1], '2026-11-01 Get quotes parent:1 id:2 by:me needs:human');
  assert.equal(lines(list).at(-1), '2026-11-05 Which vendor? parent:2 by:Opus_5.5');
  assert.deepEqual(errorsOf(list), []);
});

test('flag_needs_human gives an id-less parent an id so the question can point at it', () => {
  const list = new TaskList({ todo: '2026-11-01 Pick region wip:Opus_5.5\n', done: '' });
  const flagged = Operations.flagNeedsHuman(list, { task: '2026-11-01 Pick region wip:Opus_5.5', question: 'East or west?' }, context).list;
  assert.deepEqual(lines(flagged), [
    '2026-11-01 Pick region needs:human id:1',
    '2026-11-05 East or west? parent:1 by:Opus_5.5',
  ]);
  assert.deepEqual(errorsOf(flagged), []);
});

test('flag_needs_human keeps another agent\'s wip and does not repeat needs:human', () => {
  const list = new TaskList({ todo: '2026-11-01 Task id:6 wip:Flash_3.1 needs:human\n', done: '' });
  assert.equal(Operations.flagNeedsHuman(list, { task: '6' }, context).list, list);
});

test('update applies the inline-edit rules', () => {
  const { list } = Operations.update(sample(), { task: '2', line: '2026-11-01 Get three quotes parent:1 id:2 by:me due:2026-11-20' });
  assert.equal(lines(list)[1], '2026-11-01 Get three quotes parent:1 id:2 by:me due:2026-11-20');
  refused(() => Operations.update(sample(), { task: '2', line: '2026-11-01 Get quotes parent:1 id:20 by:me' }), /IDs never change/);
  refused(() => Operations.update(sample(), { task: '2', line: '2026-11-01 Get quotes parent:1 id:2 by:Flash_3.1' }), /author/);
  refused(() => Operations.update(sample(), { task: '2', line: 'x 2026-11-05 Get quotes' }), /checkbox/);
  refused(() => Operations.update(sample(), { task: '4', line: 'Renew' }), /complete/);
});

// ---- the client ----

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift();
    return { status: next.status, ok: next.status < 400, statusText: 'x', json: async () => next.body };
  };
  return { impl, calls };
}

test('after a 409 the client re-runs the edit on the files that won and saves that', async () => {
  const mine = { todo: '2026-11-01 One id:1\n', done: '', version: 'v1' };
  const theirs = { todo: '2026-11-01 One id:1\n2026-11-02 Two id:2\n', done: '', version: 'v2' };
  const { impl, calls } = fakeFetch([
    { status: 200, body: mine },
    { status: 409, body: theirs },
    { status: 200, body: { version: 'v3' } },
  ]);
  const client = new TaskflowClient({ baseUrl: 'http://x', fetchImpl: impl });
  const result = await client.update((list) => Operations.add(list, { text: 'Three' }, context));
  assert.equal(result.id, '3', 'the id is chosen again against the newer files');
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'PUT', 'PUT']);
  assert.equal(calls[1].body.version, 'v1');
  assert.equal(calls[2].body.version, 'v2');
  assert.equal(calls[2].body.todo, `${theirs.todo}2026-11-05 Three id:3 by:Opus_5.5\n`);
});

test('the client refuses a write that would add a validator problem and saves nothing', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: { todo: '2026-11-01 One id:1\n', done: '', version: 'v1' } }]);
  const client = new TaskflowClient({ baseUrl: 'http://x', fetchImpl: impl });
  await assert.rejects(
    client.update((list) => ({ list: list.appendLine('todo', '2026-11-05 Bad parent:99'), result: {} })),
    /Not saved.*parent-missing/,
  );
  assert.deepEqual(calls.map((c) => c.method), ['GET']);
});

test('a no-op edit does not save, and an unreachable app gives a clear message', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: { todo: '2026-11-01 One id:1\n', done: '', version: 'v1' } }]);
  const client = new TaskflowClient({ baseUrl: 'http://x', fetchImpl: impl });
  await client.update((list) => ({ list, result: 'same' }));
  assert.equal(calls.length, 1);
  const down = new TaskflowClient({ baseUrl: 'http://x', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(down.read(), /Cannot reach TaskFlow at http:\/\/x/);
});
