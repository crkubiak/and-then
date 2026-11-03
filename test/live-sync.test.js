// Run with: node --test test/
// Starts the real server on a scratch copy of samples/demo and talks to it over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

let serverProcess;
let dataDirectory;

before(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), 'taskflow-live-sync-'));
  await cp(path.join(ROOT, 'samples', 'demo'), dataDirectory, { recursive: true });
  serverProcess = spawn('node', ['server.js', dataDirectory], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(`${BASE}/api/files`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('server did not start');
});

after(async () => {
  serverProcess?.kill();
  await rm(dataDirectory, { recursive: true, force: true });
});

// Opens an event stream and collects the parsed events until closed.
async function openEventStream() {
  const controller = new AbortController();
  const response = await fetch(`${BASE}/api/events`, { signal: controller.signal });
  const events = [];
  const decoder = new TextDecoder();
  let buffered = '';
  (async () => {
    try {
      for await (const chunk of response.body) {
        buffered += decoder.decode(chunk, { stream: true });
        let boundary;
        while ((boundary = buffered.indexOf('\n\n')) !== -1) {
          const block = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          const type = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (type && data) events.push({ type, ...JSON.parse(data) });
        }
      }
    } catch {
      // aborted on close
    }
  })();
  return { events, close: () => controller.abort() };
}

async function waitFor(predicate, description) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${description}`);
}

test('a save from one client sends changed to every open event stream, including the saver', async () => {
  const otherTab = await openEventStream();
  const savingTab = await openEventStream();
  await waitFor(() => otherTab.events.length > 0 && savingTab.events.length > 0, 'hello events');

  const current = await (await fetch(`${BASE}/api/files`)).json();
  const response = await fetch(`${BASE}/api/files`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ todo: `${current.todo}2026-11-03 Live sync test by:me\n`, done: current.done, version: current.version }),
  });
  assert.equal(response.status, 200);
  const { version: savedVersion } = await response.json();

  await waitFor(() => otherTab.events.some((event) => event.type === 'changed'), 'changed on the other tab');
  assert.equal(otherTab.events.find((event) => event.type === 'changed').version, savedVersion);
  // The saving tab gets the same event. The client ignores it because it already holds that version.
  await waitFor(() => savingTab.events.some((event) => event.type === 'changed'), 'changed on the saving tab');

  otherTab.close();
  savingTab.close();
});

test('a rejected save (409) sends no changed event', async () => {
  const stream = await openEventStream();
  await waitFor(() => stream.events.length > 0, 'hello event');
  const eventCountBefore = stream.events.length;

  const current = await (await fetch(`${BASE}/api/files`)).json();
  const response = await fetch(`${BASE}/api/files`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ todo: current.todo, done: current.done, version: 'stale-version' }),
  });
  assert.equal(response.status, 409);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(stream.events.length, eventCountBefore);

  stream.close();
});
