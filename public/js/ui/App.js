import { FileStore } from '../io/FileStore.js';
import { LiveSync } from '../io/LiveSync.js';
import { TaskList } from '../model/TaskList.js';
import { ProjectPalette } from './ProjectPalette.js';
import { ProjectSection } from './ProjectSection.js';
import { TaskRow } from './TaskRow.js';
import { Toast } from './Toast.js';

export class App {
  #root;
  #store;
  #taskList = null;
  #collapsedKeys = new Set(); // collapsed task rows, session-only (see TaskRow.keyOf)
  #status = 'reconnecting';
  #dot = null;
  #reloading = false;
  #reloadAgain = false;
  #toast = null;

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
    if (version === this.#store.version) return;
    if (this.#reloading) {
      this.#reloadAgain = true; // run exactly one more reload when this one finishes
      return;
    }
    this.#reload();
  }

  async #reload() {
    this.#reloading = true;
    try {
      do {
        this.#reloadAgain = false;
        try {
          // Phase 8: skip or defer this re-render while an inline editor is open.
          this.setTaskList(new TaskList(await this.#store.load()));
        } catch (err) {
          this.#showReloadError(err); // keep the current view
        }
      } while (this.#reloadAgain);
    } finally {
      this.#reloading = false;
    }
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
    this.#render();
    window.scrollTo(0, scrollY);
    this.#restoreFocus(focusKey);
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

  #renderShell(summary = null) {
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
    this.#root.replaceChildren(header, main);
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
      });
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
    const main = this.#renderShell();
    main.append(this.#errorBadge(err));
  }

  #errorBadge(err) {
    const badge = this.#el('p', 'error-badge', `Could not load tasks: ${err.message}`);
    badge.setAttribute('role', 'alert');
    return badge;
  }
}
