// Run with: node --test test/
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TaskList } from '../public/js/model/TaskList.js';
import { CollapseRules } from '../public/js/rules/CollapseRules.js';
import { CollapseStore } from '../public/js/io/CollapseStore.js';

function taskListFrom(todoLines) {
  return new TaskList({ todo: `${todoLines.join('\n')}\n`, done: '' });
}

function taskWithId(taskList, id) {
  const found = taskList.byId(id);
  assert.ok(found, `task id:${id} should exist`);
  return found;
}

test('a completed parent with subtasks starts collapsed', () => {
  const taskList = taskListFrom([
    'x 2026-11-04 2026-11-04 Finished phase id:1',
    'x 2026-11-04 2026-11-04 Finished child parent:1',
  ]);
  assert.equal(CollapseRules.startsCollapsed(taskList, taskWithId(taskList, '1')), true);
});

test('a completed parent still starts collapsed when a subtask was added to it later and is open', () => {
  const taskList = taskListFrom([
    'x 2026-11-04 2026-11-04 Finished phase id:1',
    'x 2026-11-04 2026-11-04 Finished child parent:1',
    '2026-11-05 Documentation an agent added later parent:1',
  ]);
  assert.equal(CollapseRules.startsCollapsed(taskList, taskWithId(taskList, '1')), true);
});

test('an open parent starts expanded even when every subtask is complete', () => {
  const taskList = taskListFrom([
    '2026-11-04 Open parent id:1',
    'x 2026-11-04 2026-11-04 Finished child parent:1',
  ]);
  assert.equal(CollapseRules.startsCollapsed(taskList, taskWithId(taskList, '1')), false);
});

test('a completed task with no subtasks has nothing to collapse', () => {
  const taskList = taskListFrom(['x 2026-11-04 2026-11-04 Lone finished task id:1']);
  assert.equal(CollapseRules.startsCollapsed(taskList, taskWithId(taskList, '1')), false);
});

test('a saved choice wins over the default in both directions', () => {
  const taskList = taskListFrom([
    'x 2026-11-04 2026-11-04 Finished phase id:1',
    'x 2026-11-04 2026-11-04 Finished child parent:1',
    '2026-11-04 Open parent id:2',
    '2026-11-04 Open child parent:2',
  ]);
  const completedParent = taskWithId(taskList, '1');
  const openParent = taskWithId(taskList, '2');
  assert.equal(CollapseRules.initiallyCollapsed(taskList, completedParent, undefined), true);
  assert.equal(CollapseRules.initiallyCollapsed(taskList, completedParent, false), false); // user opened it
  assert.equal(CollapseRules.initiallyCollapsed(taskList, openParent, undefined), false);
  assert.equal(CollapseRules.initiallyCollapsed(taskList, openParent, true), true); // user collapsed it
});

// A tiny stand-in for the browser's localStorage.
function installFakeLocalStorage() {
  const backing = new Map();
  globalThis.localStorage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
  };
  return backing;
}

let backing;
beforeEach(() => {
  backing = installFakeLocalStorage();
});

test('the store remembers choices across a reload', () => {
  const firstVisit = new CollapseStore();
  firstVisit.record(new Map([['id:1', false], ['id:2', true]]));
  const nextVisit = new CollapseStore();
  assert.equal(nextVisit.choiceFor('id:1'), false);
  assert.equal(nextVisit.choiceFor('id:2'), true);
  assert.equal(nextVisit.choiceFor('id:3'), undefined);
});

test('the store forgets choices for tasks that no longer exist', () => {
  const store = new CollapseStore();
  store.record(new Map([['id:1', true], ['id:2', true]]));
  store.prune(new Set(['id:1']));
  const reloaded = new CollapseStore();
  assert.equal(reloaded.choiceFor('id:1'), true);
  assert.equal(reloaded.choiceFor('id:2'), undefined);
});

test('the store starts empty when the saved value is junk or storage throws', () => {
  backing.set('taskflow.rowCollapse', '{not json');
  assert.equal(new CollapseStore().choiceFor('id:1'), undefined);
  backing.set('taskflow.rowCollapse', '["id:1"]');
  assert.equal(new CollapseStore().choiceFor('id:1'), undefined);
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const blocked = new CollapseStore();
  blocked.record(new Map([['id:1', true]])); // must not throw
  assert.equal(blocked.choiceFor('id:1'), true); // still served from memory
});
