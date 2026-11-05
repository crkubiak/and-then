// Run with: node --test test/
// Toast needs only a few DOM calls, so a tiny fake document is enough. No dependency.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Toast } from '../public/js/ui/Toast.js';

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.className = '';
    this.textContent = '';
    this.title = '';
    this.parent = null;
    this.childNodes = [];
    this.listeners = new Map();
  }

  get children() {
    return this.childNodes;
  }

  get firstElementChild() {
    return this.childNodes[0] ?? null;
  }

  get isConnected() {
    let node = this;
    while (node.parent) node = node.parent;
    return node.tag === 'body';
  }

  setAttribute() {}

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.childNodes.push(node);
    }
  }

  after(node) {
    const siblings = this.parent.childNodes;
    node.parent = this.parent;
    siblings.splice(siblings.indexOf(this) + 1, 0, node);
  }

  remove() {
    if (!this.parent) return;
    const siblings = this.parent.childNodes;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  find(className) {
    return this.childNodes.find((node) => node.className.split(' ').includes(className)) ?? null;
  }
}

let body;
let toast;
let region;

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  body = new FakeElement('body');
  toast = new Toast(body);
  region = body.childNodes[0];
});

afterEach(() => {
  mock.timers.reset();
  delete globalThis.document;
});

test('the same error shown again keeps one toast and shows a count', () => {
  toast.error('Could not save');
  toast.error('Could not save');
  toast.error('Could not save');
  assert.equal(region.children.length, 1);
  assert.equal(region.children[0].find('toast-count').textContent, '×3');
});

test('different messages stack, and the cap of five stays', () => {
  for (let n = 1; n <= 6; n++) toast.error(`Problem ${n}`);
  assert.equal(region.children.length, 5);
  assert.equal(region.children[0].find('toast-text').textContent, 'Problem 2');
});

test('the same text as an info and an error are two toasts', () => {
  toast.info('Same words');
  toast.error('Same words');
  assert.equal(region.children.length, 2);
});

test('a repeat restarts the full timer', () => {
  toast.error('Could not save'); // 8000 ms
  mock.timers.tick(6000);
  toast.error('Could not save'); // restarts to the full 8000 ms
  mock.timers.tick(6000); // 12 s after the first, only 6 s after the repeat
  assert.equal(region.children.length, 1);
  mock.timers.tick(2000);
  assert.equal(region.children.length, 0);
});

test('after a toast is dismissed the same message shows fresh, without a count', () => {
  toast.info('Swept 1 task to done.txt.');
  mock.timers.tick(4000);
  assert.equal(region.children.length, 0);
  toast.info('Swept 1 task to done.txt.');
  assert.equal(region.children.length, 1);
  assert.equal(region.children[0].find('toast-count'), null);
});
