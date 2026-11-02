import { FileStore } from '../io/FileStore.js';
import { LiveSync } from '../io/LiveSync.js';
import { TaskList } from '../model/TaskList.js';
import { IdAllocator } from '../model/IdAllocator.js';
import { TaskSerializer } from '../model/TaskSerializer.js';
import { CompletionRules } from '../rules/CompletionRules.js';
import { ProjectPalette } from './ProjectPalette.js';
import { ProjectSection } from './ProjectSection.js';
import { NewTaskRules } from '../rules/NewTaskRules.js';
import { TaskInput } from './TaskInput.js';
import { TaskRow } from './TaskRow.js';
import { Toast } from './Toast.js';

const FLASH_MS = 1500;
const NEW_ID = 'new'; // placeholder in a + Subtask prefill until the parent's id is allocated
const NEW_ID_TOKEN = new RegExp(`(^|\\s)parent:${NEW_ID}(?=\\s|$)`);

export class App {
  #root;
  #store;
  #taskList = null;
  #collapsedKeys = new Set(); // collapsed task rows, session-only (see TaskRow.keyOf)
  #status = 'reconnecting';
  #dot = null;
  #toast = null;
  #taskInput = new TaskInput({ onSubmit: (text, pending) => this.#addTask(text, pending) });
  #tail = Promise.resolve(); // commits and reloads run one at a time through this chain
  #reloadQueued = false;
  #latestVersion = null;
  #sections = new Map(); // project (null = Inbox) to its ProjectSection, rebuilt each render

  constructor(root, { store = new FileStore() } = {}) {
    this.#root = root;
    this.#store = store;
  }

  // Created on first use, mounted on <body> so #renderShell never removes it.
  get toast() {
    this.#toast ??= new Toast();
    return this.#toast;
  }

  // The one place the UI reads the clock. Local date, not UTC.
  static today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  async start() {
    try {
      const files = await this.#store.load();
      this.setTaskList(new TaskList(files));
    } catch (err) {
      this.#renderError(err);
      return;
    }
    new LiveSync({
      onVersion: (version) => this.#onVersion(version),
      onStatus: (status) => this.#setStatus(status),
    });
  }

  #onVersion(version) {
    this.#latestVersion = version;
    if (version === this.#store.version || this.#reloadQueued) return;
    this.#reloadQueued = true; // a reload that hasn't started yet will see the newest version anyway
    this.#enqueue(() => {
      this.#reloadQueued = false;
      return this.#latestVersion === this.#store.version ? undefined : this.#reload();
    });
  }

  #enqueue(job) {
    const run = this.#tail.then(job);
    this.#tail = run.catch(() => {});
    return run;
  }

  async #reload() {
    try {
      // Phase 8.5: defer this re-render while an inline editor is open.
      this.setTaskList(new TaskList(await this.#store.load()));
    } catch (err) {
      this.#showReloadError(err); // keep the current view
    }
  }

  // The one write path. `transform(taskList)` returns the new TaskList, or a string
  // (the reason it can't apply). It must find its target with taskList.locate(), never
  // hold a Task from an earlier list, so it can be re-run on fresh content after a 409.
  #commit(transform) {
    return this.#enqueue(() => this.#runCommit(transform));
  }

  async #runCommit(transform) {
    try {
      const next = transform(this.#taskList);
      if (typeof next === 'string') {
        this.toast.error(next);
        return false;
      }
      const result = await this.#store.save(next.toText());
      if (result.ok) {
        this.setTaskList(next);
        return true;
      }
      // Conflict. Phase 8.6 re-applies the transform here instead.
      this.setTaskList(new TaskList(result.current));
      this.toast.info('The files changed on disk. Your change was not saved. Please retry.');
      return false;
    } catch (err) {
      this.toast.error(`Could not save: ${err.message}`);
      return false;
    }
  }

  #complete(task) {
    const check = CompletionRules.check(this.#taskList, task);
    if (check.needsConfirm && !window.confirm(`#${task.depId} is not complete. Complete anyway?`)) return;
    return this.#commit((list) => {
      const target = list.locate(task);
      if (!target) return 'That task no longer exists.';
      if (target.complete) return 'That task is already complete.';
      if (!CompletionRules.check(list, target).allowed) return 'That task has open subtasks.';
      return CompletionRules.complete(list, target, App.today());
    });
  }

  // `pending` ({ parent }) is set by + Subtask when the parent had no id. If the typed text still
  // has the placeholder, the id is allocated and written to the parent in this same commit.
  #addTask(text, pending = null) {
    return this.#commit((list) => {
      let base = list;
      let typed = text;
      if (pending && NEW_ID_TOKEN.test(text)) {
        const parent = list.locate(pending.parent);
        if (!parent) return 'The parent task no longer exists.';
        const id = parent.id ?? IdAllocator.next(list);
        typed = text.replace(NEW_ID_TOKEN, `$1parent:${id}`);
        if (parent.id === null) base = list.replaceLine(parent, TaskSerializer.setTag(parent, 'id', id));
      }
      const { line, error } = NewTaskRules.prepare(base, typed, App.today());
      return error ?? base.appendLine('todo', line); // on error nothing is returned, so no id is written
    });
  }

  // + Subtask: pre-fill the input. Nothing is written until the subtask is submitted.
  #addSubtask(task) {
    const parent = this.#taskList.locate(task);
    if (!parent) return;
    const project = this.#taskList.effectiveProject(parent);
    const text = ` ${project ? `+${project} ` : ''}parent:${parent.id ?? NEW_ID}`;
    this.#taskInput.prefill(text, { caretAt: 'start', pending: parent.id === null ? { parent } : null });
  }

  #reopen(task) {
    return this.#commit((list) => {
      const target = list.locate(task);
      if (!target) return 'That task no longer exists.';
      return CompletionRules.reopen(list, target);
    });
  }

  // Locked checkbox: expand down to the open descendants, then flash them.
  #highlightOpen(task) {
    const target = this.#taskList.locate(task);
    if (!target) return;
    const open = CompletionRules.check(this.#taskList, target).openDescendants;
    this.#expandTo(open, target);
    this.#flash(open);
  }

  // Blocked-by pill: reveal the blocking task, scroll to it, flash it, focus its checkbox.
  #showTask(id) {
    const target = this.#taskList.byId(id);
    if (target?.file === 'todo') {
      this.#expandTo([target]);
      const row = this.#rowsFor([target])[0];
      if (row) {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        row.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        this.#flash([target]);
        const focusable = row.querySelector('.task-check') ?? row;
        if (focusable === row) row.tabIndex = -1;
        focusable.focus({ preventScroll: true });
        return;
      }
    }
    this.toast.info(`#${id} is not on this page.`);
  }

  // Un-collapses what hides each task: its section (unless `stopAt` is given) and its
  // collapsed ancestors, up to and including `stopAt`. Re-renders once if ancestors changed.
  #expandTo(tasks, stopAt = null) {
    const list = this.#taskList;
    let changed = false;
    for (const task of tasks) {
      const section = stopAt ? null : this.#sections.get(list.effectiveProject(task));
      if (section?.isCollapsed) section.setCollapsed(false); // updates the DOM in place
      for (let p = list.parent(task); p; p = list.parent(p)) {
        if (this.#collapsedKeys.delete(TaskRow.keyOf(p))) changed = true;
        if (p === stopAt) break;
      }
    }
    if (changed) this.setTaskList(list);
  }

  #rowsFor(tasks) {
    const keys = new Set(tasks.map((t) => TaskRow.keyOf(t)));
    return [...this.#root.querySelectorAll('.task-row')].filter((r) => keys.has(r.dataset.taskKey));
  }

  #flash(tasks) {
    const rows = this.#rowsFor(tasks);
    for (const row of rows) row.classList.add('is-flash');
    setTimeout(() => rows.forEach((row) => row.classList.remove('is-flash')), FLASH_MS);
  }

  #showReloadError(err) {
    const main = this.#root.querySelector('.app-main');
    if (!main) return this.#renderError(err);
    main.querySelector('.error-badge')?.remove();
    main.prepend(this.#errorBadge(err));
  }

  #setStatus(status) {
    this.#status = status;
    this.#applyStatus();
  }

  #applyStatus() {
    if (!this.#dot) return;
    const label = this.#status === 'live' ? 'Live' : 'Reconnecting';
    this.#dot.className = `live-dot is-${this.#status}`;
    this.#dot.title = label;
    this.#dot.setAttribute('aria-label', label);
  }

  // All rendering goes through here (initial load, live reload, actions).
  setTaskList(taskList) {
    this.#taskList = taskList;
    const scrollY = window.scrollY;
    const focusKey = this.#focusedKey();
    const inputState = this.#taskInput.snapshot(); // the input is detached and re-attached by #render
    this.#render();
    window.scrollTo(0, scrollY);
    this.#restoreFocus(focusKey);
    this.#taskInput.restore(inputState);
  }

  // Only section headers and row toggles carry a data-key.
  #focusedKey() {
    const active = document.activeElement;
    return active && this.#root.contains(active) ? (active.dataset?.key ?? null) : null;
  }

  #restoreFocus(key) {
    if (key === null) return;
    const el = [...this.#root.querySelectorAll('[data-key]')].find((e) => e.dataset.key === key);
    el?.focus({ preventScroll: true });
  }

  #render() {
    const empty = this.#taskList.todoTasks.length === 0;
    const main = this.#renderShell(empty ? null : this.#buildSummary());
    if (empty) main.append(this.#buildEmptyState());
    else this.#renderSections(main);
  }

  #renderShell(summary = null, { withInput = true } = {}) {
    const header = document.createElement('header');
    header.className = 'app-header';
    const titleRow = this.#el('div', 'title-row');
    const title = document.createElement('h1');
    title.textContent = 'TaskFlow';
    this.#dot = document.createElement('span');
    this.#dot.setAttribute('role', 'img');
    this.#applyStatus();
    titleRow.append(title, this.#dot);
    const strip = document.createElement('div');
    strip.className = 'accent-strip';
    strip.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i++) strip.append(document.createElement('span'));
    header.append(titleRow);
    if (summary) header.append(summary);
    header.append(strip);

    const main = document.createElement('main');
    main.className = 'app-main';
    this.#root.replaceChildren(header, ...(withInput ? [this.#taskInput.element] : []), main);
    return main;
  }

  // Open, overdue, due-soon and blocked counts across all of todo.txt.
  #buildSummary() {
    const today = App.today();
    const open = this.#taskList.todoTasks.filter((t) => !t.complete);
    const kinds = open.map((t) => TaskRow.dueKind(t.due, today));
    const overdue = kinds.filter((k) => k === 'overdue').length;
    const soon = kinds.filter((k) => k === 'soon').length;
    const blocked = open.filter((t) => this.#taskList.isBlocked(t)).length;

    const summary = this.#el('p', 'summary');
    const count = this.#el('span', 'summary-open');
    count.append(this.#el('strong', '', String(open.length)), ' open');
    summary.append(count);
    if (overdue > 0) summary.append(this.#el('span', 'badge badge-due-overdue', `${overdue} overdue`));
    if (soon > 0) summary.append(this.#el('span', 'badge badge-due-soon', `${soon} due soon`));
    if (blocked > 0) summary.append(this.#el('span', 'pill-blocked', `${blocked} blocked`));
    return summary;
  }

  #buildEmptyState() {
    const box = this.#el('div', 'empty-state');
    box.append(
      this.#el('p', 'empty-title', 'No tasks yet'),
      this.#el('p', 'empty-hint', 'Add lines to data/todo.txt, or see docs/FORMAT.md.'),
    );
    return box;
  }

  #el(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  #renderSections(main) {
    const palette = new ProjectPalette(this.#taskList);
    const today = App.today();
    this.#sections.clear();
    for (const [project, { roots, tasks }] of this.#groupByProject()) {
      const section = new ProjectSection({
        project,
        accent: palette.accent(project),
        roots,
        tasks,
        taskList: this.#taskList,
        palette,
        today,
        collapsedKeys: this.#collapsedKeys,
        actions: {
          complete: (task) => this.#complete(task),
          reopen: (task) => this.#reopen(task),
          highlightOpen: (task) => this.#highlightOpen(task),
          showTask: (id) => this.#showTask(id),
          addSubtask: (task) => this.#addSubtask(task),
        },
      });
      this.#sections.set(project, section);
      main.append(section.element);
    }
  }

  // Inbox (null) first, then projects in order of first appearance.
  // A section holds its roots and all their descendants.
  #groupByProject() {
    const groups = new Map([[null, { roots: [], tasks: [] }]]);
    for (const root of this.#taskList.roots()) {
      const project = this.#taskList.effectiveProject(root);
      if (!groups.has(project)) groups.set(project, { roots: [], tasks: [] });
      const group = groups.get(project);
      group.roots.push(root);
      group.tasks.push(root, ...this.#taskList.descendants(root));
    }
    if (groups.get(null).tasks.length === 0) groups.delete(null);
    return groups;
  }

  #renderError(err) {
    const main = this.#renderShell(null, { withInput: false });
    main.append(this.#errorBadge(err));
  }

  #errorBadge(err) {
    const badge = this.#el('p', 'error-badge', `Could not load tasks: ${err.message}`);
    badge.setAttribute('role', 'alert');
    return badge;
  }
}
