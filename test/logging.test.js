// Run with: node --test test/
// Starts the real server on a scratch copy of samples/demo, captures its stdout, and checks the
// log lines. The task text used here is a marker that must never reach the log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Logger, countLines } from '../logger.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET_TASK = 'Call the lawyer about the SECRETMARKER settlement';

let dataDirectory;

async function startServer(extraEnv = {}) {
  const child = spawn('node', ['server.js', dataDirectory], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => (output.stdout += chunk));
  child.stderr.on('data', (chunk) => (output.stderr += chunk));
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(`${BASE}/api/files`);
      return { child, output };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('server did not start');
}

async function stopServer(child) {
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
}

async function waitForLine(output, pattern) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (pattern.test(output.stdout)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`no log line matched ${pattern}\n${output.stdout}`);
}

before(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), 'taskflow-logging-'));
  await cp(path.join(ROOT, 'samples', 'demo'), dataDirectory, { recursive: true });
});

after(async () => {
  await rm(dataDirectory, { recursive: true, force: true });
});

test('the server logs requests, saves, conflicts, external changes and SSE clients, and never task text', async () => {
  const { child, output } = await startServer();
  try {
    const first = await (await fetch(`${BASE}/api/files`)).json();
    const save = await fetch(`${BASE}/api/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todo: `${first.todo}\n2026-11-05 ${SECRET_TASK} +Home\n`, done: first.done, version: first.version }),
    });
    assert.equal(save.status, 200);
    const stale = await fetch(`${BASE}/api/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todo: SECRET_TASK, done: '', version: first.version }),
    });
    assert.equal(stale.status, 409);

    const controller = new AbortController();
    const stream = await fetch(`${BASE}/api/events`, { signal: controller.signal });
    await waitForLine(output, /sse-connect clients=1/);
    controller.abort();
    stream.body?.cancel().catch(() => {});
    await waitForLine(output, /sse-disconnect clients=0/);

    await appendFile(path.join(dataDirectory, 'todo.txt'), `2026-11-05 ${SECRET_TASK} edited outside\n`);
    await waitForLine(output, / external-change /);

    const log = output.stdout;
    assert.match(log, /^\S+ info listening url=http:\/\/127\.0\.0\.1:\d+ /m);
    assert.match(log, /info request method=GET path=\/api\/files status=200 ms=\d+/);
    assert.match(log, /info request method=PUT path=\/api\/files status=200 ms=\d+/);
    assert.match(log, /info request method=PUT path=\/api\/files status=409 ms=\d+/);
    assert.match(log, /info save version=[0-9a-f]{8} todoLines=\d+ doneLines=\d+/);
    assert.match(log, /info conflict sent=[0-9a-f]{8} current=[0-9a-f]{8}/);
    assert.match(log, /info external-change version=[0-9a-f]{8} todoLines=\d+ doneLines=\d+/);
    assert.doesNotMatch(log, /debug/, 'default level hides debug lines');
    assert.doesNotMatch(log, /SECRETMARKER|lawyer|settlement/, 'task text must not be logged');
    for (const line of log.trim().split('\n')) {
      assert.match(line, /^\d{4}-\d\d-\d\dT[\d:.]+Z (debug|info|error) [a-z-]+/, `one event per line: ${line}`);
    }
    assert.equal(output.stderr, '', 'nothing goes to stderr');
  } finally {
    await stopServer(child);
  }
});

test('LOG_LEVEL=debug adds static file requests and LOG_LEVEL=error hides request lines', async () => {
  const debugRun = await startServer({ LOG_LEVEL: 'debug' });
  try {
    await (await fetch(`${BASE}/`)).text();
    await waitForLine(debugRun.output, /debug request method=GET path=\/ status=200/);
  } finally {
    await stopServer(debugRun.child);
  }

  const errorRun = await startServer({ LOG_LEVEL: 'error' });
  try {
    await (await fetch(`${BASE}/api/files`)).json();
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(errorRun.output.stdout, '');
  } finally {
    await stopServer(errorRun.child);
  }
});

test('Logger filters by level, falls back to info on an unknown level and keeps each event on one line', () => {
  const lines = [];
  const now = () => new Date('2026-11-05T12:00:00.000Z');
  const logger = new Logger({ level: 'nonsense', write: (line) => lines.push(line), now });
  logger.debug('hidden');
  logger.info('shown', { count: 3, note: 'two words\nand a newline' });
  logger.error('failed', { code: 'EACCES' });
  assert.deepEqual(lines, [
    '2026-11-05T12:00:00.000Z info shown count=3 note="two words\\nand a newline"',
    '2026-11-05T12:00:00.000Z error failed code=EACCES',
  ]);
});

test('countLines ignores blank lines', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a\n\n  \nb\n'), 2);
});
