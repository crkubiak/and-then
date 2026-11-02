import { ProjectPalette } from './ProjectPalette.js';
import { SortOrder } from '../rules/SortOrder.js';
import { TaskRow } from './TaskRow.js';

const STORAGE_KEY = 'taskflow.collapsed';

export class ProjectSection {
  #key;
  #button;
  #pill = null; // rollup pill in the header, shown only while collapsed
  #body;
  #section;
  static #nextId = 0;

  // `project` is null for Inbox. `tasks` is the section's roots and all descendants;
  // `roots` are the top-level tasks the tree renders from.
  constructor({ project, accent, roots, tasks, taskList, palette, today, collapsedKeys, actions, editor = null, hideCompleted = false, isVisible = () => true, problems = new Map(), newKeys = new Set(), editedKeys = new Map() }) {
    this.#key = project ?? '';
    this.#section = document.createElement('section');
    this.#section.className = 'project-section';
    this.#section.style.setProperty('--accent', `var(--${accent === 'muted' ? 'fg-muted' : accent})`);

    const bodyId = `project-body-${ProjectSection.#nextId++}`;
    this.#button = this.#buildHeader(project, tasks, bodyId, isVisible, newKeys, editedKeys);
    this.#body = this.#buildBody(roots, taskList, palette, today, bodyId, collapsedKeys, actions, editor, hideCompleted, isVisible, problems, newKeys, editedKeys);
    this.#section.append(this.#button, this.#body);

    this.#button.addEventListener('click', () => this.setCollapsed(!this.isCollapsed));
    this.#apply(ProjectSection.#readCollapsed().has(this.#key));
  }

  get element() {
    return this.#section;
  }

  get isCollapsed() {
    return this.#button.getAttribute('aria-expanded') === 'false';
  }

  setCollapsed(collapsed) {
    this.#apply(collapsed);
    const keys = ProjectSection.#readCollapsed();
    if (collapsed) keys.add(this.#key);
    else keys.delete(this.#key);
    ProjectSection.#writeCollapsed(keys);
  }

  #apply(collapsed) {
    this.#button.setAttribute('aria-expanded', String(!collapsed));
    this.#body.hidden = collapsed;
    if (this.#pill) this.#pill.hidden = !collapsed;
    this.#section.classList.toggle('is-collapsed', collapsed);
  }

  #buildHeader(project, tasks, bodyId, isVisible, newKeys, editedKeys) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'project-header';
    button.setAttribute('aria-controls', bodyId);
    button.dataset.key = `section:${this.#key}`; // lets App restore focus after a re-render

    const chevron = this.#el('span', 'chevron', '▸');
    chevron.setAttribute('aria-hidden', 'true');
    const title = this.#el('span', 'project-title', ProjectPalette.displayName(project));

    const total = tasks.length;
    const done = tasks.filter((t) => t.complete).length;
    const counts = this.#el('span', 'project-counts', `${total - done} active / ${total} total`);

    button.append(chevron, title, counts);
    this.#pill = TaskRow.rollupPill(tasks.filter(isVisible).map((t) => TaskRow.keyOf(t)), newKeys, editedKeys);
    if (this.#pill) button.append(this.#pill);
    const priority = ProjectSection.#highestOpenPriority(tasks);
    if (priority) button.append(TaskRow.priorityBadge(priority));
    button.append(this.#progressBar(done, total));
    return button;
  }

  #progressBar(done, total) {
    const bar = this.#el('span', 'progress');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Completed');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(done));
    const fill = this.#el('span', 'progress-fill');
    fill.style.width = total === 0 ? '0%' : `${(done / total) * 100}%`;
    bar.append(fill);
    return bar;
  }

  #buildBody(roots, taskList, palette, today, bodyId, collapsedKeys, actions, editor, hideCompleted, isVisible, problems, newKeys, editedKeys) {
    const body = this.#el('div', 'project-body');
    body.id = bodyId;
    const shown = roots.filter(isVisible);
    // Header counts still include hidden tasks; only the rows are filtered.
    if (shown.length === 0) body.append(this.#el('p', 'project-empty', 'All done'));
    for (const task of SortOrder.sort(shown)) {
      body.append(new TaskRow({ task, taskList, palette, today, collapsedKeys, actions, editor, hideCompleted, isVisible, problems, newKeys, editedKeys }).element);
    }
    return body;
  }

  #el(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  static #highestOpenPriority(tasks) {
    const letters = tasks.filter((t) => !t.complete && t.priority).map((t) => t.priority);
    return letters.length ? letters.reduce((a, b) => (a < b ? a : b)) : null;
  }

  // Storage can be blocked or hold junk; fall back to "nothing collapsed".
  static #readCollapsed() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : []);
    } catch {
      return new Set();
    }
  }

  static #writeCollapsed(keys) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
    } catch {
      // Blocked or full: collapse still works for this page view.
    }
  }
}
