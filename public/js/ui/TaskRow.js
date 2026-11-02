import { ProjectPalette } from './ProjectPalette.js';
import { SortOrder } from '../rules/SortOrder.js';
import { VisibilityRules } from '../rules/VisibilityRules.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HIDDEN_TAG = /^(id|parent|dep|due):\S*$/;
const DUE_SOON_DAYS = 3;

// One task plus, nested beneath it, a container with a TaskRow per child.
// Display only; `today` is passed in so nothing here reads the clock.
export class TaskRow {
  #task;
  #taskList;
  #palette;
  #today;
  #collapsedKeys;
  #node;
  #children = null;
  #toggle = null;
  static #nextId = 0;

  // `collapsedKeys` is the App-owned Set of collapsed task keys (see TaskRow.keyOf).
  constructor({ task, taskList, palette, today, collapsedKeys = new Set() }) {
    this.#task = task;
    this.#collapsedKeys = collapsedKeys;
    this.#taskList = taskList;
    this.#palette = palette;
    this.#today = today;
    this.#node = TaskRow.#el('div', 'task-node');
    this.#node.append(this.#buildRow());
    this.#buildChildren();
  }

  get element() {
    return this.#node;
  }

  #buildRow() {
    const task = this.#task;
    const row = TaskRow.#el('div', task.complete ? 'task-row is-complete' : 'task-row');
    row.append(this.#toggleOrSpacer(), this.#indicator());
    if (task.priority) row.append(TaskRow.priorityBadge(task.priority));

    const main = TaskRow.#el('span', 'task-main');
    main.append(TaskRow.#el('span', 'task-text', this.#visibleText()));
    for (const badge of this.#badges()) main.append(' ', badge);
    row.append(main);

    const tail = TaskRow.#el('span', 'task-tail');
    this.#appendTail(tail);
    row.append(tail);
    return row;
  }

  #toggleOrSpacer() {
    if (this.#taskList.children(this.#task).length === 0) return TaskRow.#el('span', 'task-spacer');
    const button = TaskRow.#el('button', 'task-toggle');
    button.type = 'button';
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-label', 'Toggle subtasks');
    button.dataset.key = `row:${TaskRow.keyOf(this.#task)}`; // lets App restore focus after a re-render
    button.append(TaskRow.#el('span', 'chevron', '▸'));
    button.firstChild.setAttribute('aria-hidden', 'true');
    button.addEventListener('click', () => this.#toggleExpanded(button.getAttribute('aria-expanded') !== 'true'));
    this.#toggle = button;
    return button;
  }

  #setExpanded(expanded) {
    this.#toggle.setAttribute('aria-expanded', String(expanded));
    this.#children.hidden = !expanded;
    this.#node.classList.toggle('is-collapsed', !expanded);
  }

  #toggleExpanded(expanded) {
    this.#setExpanded(expanded);
    const key = TaskRow.keyOf(this.#task);
    if (expanded) this.#collapsedKeys.delete(key);
    else this.#collapsedKeys.add(key);
  }

  // Collapse state is session-only and lives in the App's Set, so it survives re-renders.
  #buildChildren() {
    const kids = this.#taskList.children(this.#task);
    if (kids.length === 0) return;
    this.#children = TaskRow.#el('div', 'task-children');
    this.#children.id = `task-children-${TaskRow.#nextId++}`;
    // First nest level takes the project accent; each deeper level steps through the rotation.
    const accent = this.#palette.accent(this.#taskList.effectiveProject(this.#task));
    const rail = ProjectPalette.rotate(accent, this.#taskList.ancestors(this.#task).length);
    this.#children.style.setProperty('--rail', `var(--${rail})`);
    this.#toggle.setAttribute('aria-controls', this.#children.id);
    for (const kid of SortOrder.sort(kids)) {
      const row = new TaskRow({ task: kid, taskList: this.#taskList, palette: this.#palette, today: this.#today, collapsedKeys: this.#collapsedKeys });
      this.#children.append(row.element);
    }
    this.#node.append(this.#children);
    if (this.#collapsedKeys.has(TaskRow.keyOf(this.#task))) this.#setExpanded(false);
  }

  #indicator() {
    const done = this.#task.complete;
    const box = TaskRow.#el('span', done ? 'task-check is-done' : 'task-check', done ? '✓' : '');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', done ? 'Completed' : 'Open');
    return box;
  }

  // Strips tokens that are shown as badges or hidden; other words stay as written.
  #visibleText() {
    const due = this.#validDue();
    return this.#task.body
      .split(/\s+/)
      .filter((word) => word !== '')
      .filter((word) => !(word.length > 1 && (word[0] === '+' || word[0] === '@')))
      .filter((word) => !(HIDDEN_TAG.test(word) && !(word.startsWith('due:') && due === null)))
      .join(' ');
  }

  #validDue() {
    const due = this.#task.due;
    return due !== null && DATE.test(due) ? due : null;
  }

  #badges() {
    const task = this.#task;
    const badges = [];
    const home = this.#taskList.effectiveProject(task);
    for (const project of new Set(task.projects)) {
      if (project !== home) badges.push(this.#projectBadge(project));
    }
    for (const context of task.contexts) badges.push(TaskRow.#el('span', 'badge badge-context', `@${context}`));
    const due = this.#validDue();
    if (due) badges.push(this.#dueBadge(due));
    return badges;
  }

  #projectBadge(project) {
    const accent = this.#palette.accent(project);
    const badge = TaskRow.#el('span', 'badge badge-project', ProjectPalette.displayName(project));
    badge.dataset.accent = accent;
    badge.style.setProperty('--accent', `var(--${accent === 'muted' ? 'fg-muted' : accent})`);
    return badge;
  }

  #dueBadge(due) {
    const kind = TaskRow.dueKind(due, this.#today);
    const badge = TaskRow.#el('span', `badge badge-due badge-due-${kind}`, TaskRow.#formatDate(due, this.#today));
    badge.title = `Due ${due}`;
    return badge;
  }

  #appendTail(tail) {
    const task = this.#task;
    if (this.#taskList.children(task).length > 0) {
      const { done, total } = VisibilityRules.subtaskProgress(this.#taskList, task);
      tail.append(TaskRow.#el('span', 'task-progress', `${done}/${total}`));
    }
    if (this.#taskList.isBlocked(task)) {
      tail.append(TaskRow.#el('span', 'pill-blocked', `Blocked by #${task.depId}`));
    }
    if (task.id !== null) tail.append(TaskRow.#el('span', 'task-id', `#${task.id}`));
  }

  // Stable across reloads: the id when the task has one, else its exact line.
  static keyOf(task) {
    return task.id !== null ? `id:${task.id}` : `raw:${task.raw}`;
  }

  // 'overdue' | 'soon' | 'later', or null when `due` isn't a YYYY-MM-DD date.
  static dueKind(due, today) {
    if (due === null || !DATE.test(due)) return null;
    const days = TaskRow.#daysBetween(today, due);
    return days < 0 ? 'overdue' : days <= DUE_SOON_DAYS ? 'soon' : 'later';
  }

  static priorityBadge(letter) {
    const group = /^[ABC]$/.test(letter) ? letter.toLowerCase() : 'other';
    return TaskRow.#el('span', `badge badge-priority badge-priority-${group}`, `(${letter})`);
  }

  static #daysBetween(from, to) {
    const parse = (s) => Date.UTC(...DATE.exec(s).slice(1).map(Number).map((n, i) => (i === 1 ? n - 1 : n)));
    return Math.round((parse(to) - parse(from)) / 86400000);
  }

  static #formatDate(date, today) {
    const [y, m, d] = DATE.exec(date).slice(1).map(Number);
    const base = `${MONTHS[m - 1] ?? '???'} ${d}`;
    return y === Number(today.slice(0, 4)) ? base : `${base}, ${y}`;
  }

  static #el(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
}
