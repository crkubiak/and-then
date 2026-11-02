import { ProjectPalette } from './ProjectPalette.js';
import { Age } from '../rules/Age.js';
import { CompletionRules } from '../rules/CompletionRules.js';
import { SortOrder } from '../rules/SortOrder.js';
import { VisibilityRules } from '../rules/VisibilityRules.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HIDDEN_TAG = /^(id|parent|dep|due|by|wip|needs):\S*$/;
const DUE_SOON_DAYS = 3;

// One task plus, nested beneath it, a container with a TaskRow per child.
// Display only; `today` is passed in so nothing here reads the clock.
export class TaskRow {
  #task;
  #taskList;
  #palette;
  #today;
  #collapsedKeys;
  #actions;
  #editor;
  #hideCompleted;
  #isVisible;
  #problems;
  #newKeys;
  #node;
  #children = null;
  #toggle = null;
  static #nextId = 0;

  // `collapsedKeys` is the App-owned Set of collapsed task keys (see TaskRow.keyOf).
  // `actions` are App callbacks: complete(task), reopen(task), highlightOpen(task), showTask(id), addSubtask(task), edit(task).
  // `hideCompleted` only drives the anchor badge (§4.3); `isVisible(task)` decides which children render.
  // `newKeys` holds the keys of unseen tasks; those rows get a dot and bold text until actions.seen(task) fires on click or focus.
  // `problems` maps a task to its validator problems, shown as a badge in the tail.
  // `editor` is { key, element, create }: the open inline editor. Shown in place of the description on the
  // row with that key, or, when `create`, as a new-subtask input at the top of that row's children.
  constructor({ task, taskList, palette, today, collapsedKeys = new Set(), actions = {}, editor = null, hideCompleted = false, isVisible = () => true, problems = new Map(), newKeys = new Set() }) {
    this.#newKeys = newKeys;
    this.#hideCompleted = hideCompleted;
    this.#isVisible = isVisible;
    this.#problems = problems;
    this.#task = task;
    this.#editor = editor;
    this.#actions = actions;
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
    row.dataset.taskKey = TaskRow.keyOf(task);
    row.append(this.#toggleOrSpacer(), this.#indicator());
    if (task.priority) row.append(TaskRow.priorityBadge(task.priority));

    const main = TaskRow.#el('span', 'task-main');
    if (this.#newKeys.has(TaskRow.keyOf(task))) this.#markNew(row, main);
    main.append(this.#description());
    for (const badge of this.#badges()) main.append(' ', badge);
    if (this.#editsThis() && !this.#editor.create) {
      row.classList.add('is-editing'); // CSS hides the text and badges behind the editor
      main.append(this.#editor.element);
    }
    row.append(main);

    const tail = TaskRow.#el('span', 'task-tail');
    this.#appendTail(tail);
    row.append(tail);
    return row;
  }

  // A yellow dot for sighted users and a hidden "New" for screen readers.
  #markNew(row, main) {
    row.classList.add('is-new');
    const dot = TaskRow.#el('span', 'new-mark new-dot');
    dot.setAttribute('aria-hidden', 'true');
    main.append(dot, TaskRow.#el('span', 'new-mark sr-only', 'New'), ' ');
    const seen = () => this.#actions.seen?.(this.#task);
    row.addEventListener('click', seen);
    row.addEventListener('focusin', seen);
  }

  #editsThis() {
    return this.#editor?.key === TaskRow.keyOf(this.#task);
  }

  // A todo.txt description is a button that opens the inline editor.
  #description() {
    // A line with only tags has no words; show a placeholder so it can still be clicked.
    const text = this.#visibleText();
    const empty = text === '';
    const label = empty ? '(no description)' : text;
    if (this.#task.file !== 'todo') return TaskRow.#el('span', empty ? 'task-text is-empty' : 'task-text', label);
    const button = TaskRow.#el('button', empty ? 'task-text task-text-edit is-empty' : 'task-text task-text-edit', label);
    button.type = 'button';
    button.title = 'Edit task';
    button.dataset.key = `text:${TaskRow.keyOf(this.#task)}`; // lets App restore focus after a re-render
    button.addEventListener('click', () => this.#actions.edit?.(this.#task));
    return button;
  }

  #toggleOrSpacer() {
    if (this.#visibleChildren().length === 0) return TaskRow.#el('span', 'task-spacer');
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

  // Children left after Hide Completed (all of them when it is off).
  #visibleChildren() {
    return this.#taskList.children(this.#task).filter((t) => this.#isVisible(t));
  }

  // Collapse state is session-only and lives in the App's Set, so it survives re-renders.
  #buildChildren() {
    const kids = this.#visibleChildren();
    const adding = this.#editsThis() && this.#editor.create;
    if (kids.length === 0 && !adding) return;
    this.#children = TaskRow.#el('div', 'task-children');
    this.#children.id = `task-children-${TaskRow.#nextId++}`;
    // First nest level takes the project accent; each deeper level steps through the rotation.
    const accent = this.#palette.accent(this.#taskList.effectiveProject(this.#task));
    const rail = ProjectPalette.rotate(accent, this.#taskList.ancestors(this.#task).length);
    this.#children.style.setProperty('--rail', `var(--${rail})`);
    this.#toggle?.setAttribute('aria-controls', this.#children.id);
    if (adding) {
      const box = TaskRow.#el('div', 'task-new');
      box.append(this.#editor.element);
      this.#children.append(box);
    }
    for (const kid of SortOrder.sort(kids)) {
      const row = new TaskRow({ task: kid, taskList: this.#taskList, palette: this.#palette, today: this.#today, collapsedKeys: this.#collapsedKeys, actions: this.#actions, editor: this.#editor, hideCompleted: this.#hideCompleted, isVisible: this.#isVisible, problems: this.#problems, newKeys: this.#newKeys });
      this.#children.append(row.element);
    }
    this.#node.append(this.#children);
    if (this.#toggle && this.#collapsedKeys.has(TaskRow.keyOf(this.#task))) this.#setExpanded(false);
  }

  // todo.txt tasks get a real checkbox button; done.txt tasks stay a static mark.
  #indicator() {
    const task = this.#task;
    const done = task.complete;
    if (task.file !== 'todo') {
      const box = TaskRow.#el('span', 'task-check is-done', '✓');
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', 'Archived');
      return box;
    }
    const button = TaskRow.#el('button', done ? 'task-check is-done' : 'task-check');
    button.type = 'button';
    button.dataset.key = `check:${TaskRow.keyOf(task)}`; // lets App restore focus after a re-render
    const text = this.#visibleText();
    if (done) {
      button.textContent = '✓';
      button.setAttribute('aria-label', `Reopen: ${text}`);
      button.addEventListener('click', () => this.#actions.reopen?.(task));
      return button;
    }
    const { allowed, openDescendants } = CompletionRules.check(this.#taskList, task);
    if (allowed) {
      button.setAttribute('aria-label', `Complete: ${text}`);
      button.addEventListener('click', () => this.#actions.complete?.(task));
      return button;
    }
    // Locked: aria-disabled (not disabled) so the click can still highlight the open subtasks.
    const n = openDescendants.length;
    const reason = `Complete ${n} remaining ${n === 1 ? 'subtask' : 'subtasks'} first`;
    button.classList.add('is-locked');
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-label', `${reason}: ${text}`);
    button.title = reason;
    button.append(TaskRow.#lockIcon());
    button.addEventListener('click', () => this.#actions.highlightOpen?.(task));
    return button;
  }

  static #lockIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('width', '10');
    svg.setAttribute('height', '10');
    svg.setAttribute('aria-hidden', 'true');
    const body = document.createElementNS(ns, 'rect');
    for (const [k, v] of Object.entries({ x: 2, y: 5.5, width: 8, height: 5.5, rx: 1, fill: 'currentColor' })) body.setAttribute(k, v);
    const shackle = document.createElementNS(ns, 'path');
    for (const [k, v] of Object.entries({ d: 'M3.75 5.5V4a2.25 2.25 0 0 1 4.5 0v1.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 })) shackle.setAttribute(k, v);
    svg.append(body, shackle);
    return svg;
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
    // §4.3: a completed task kept visible only because something under it is still open.
    if (this.#hideCompleted && VisibilityRules.isAnchor(this.#taskList, task)) badges.push(TaskRow.#el('span', 'badge badge-anchor', 'Open subtasks'));
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
    if (task.needs === 'human' && task.file === 'todo' && !task.complete) {
      const pill = TaskRow.#el('button', 'pill-human', 'Human');
      pill.type = 'button';
      pill.title = 'Waiting on you';
      pill.setAttribute('aria-label', `Waiting on you: ${this.#visibleText()}. Mark as handled`);
      pill.addEventListener('click', () => this.#actions.clearNeeds?.(task));
      tail.append(pill);
    }
    if (task.file === 'todo' && !task.complete) {
      const add = TaskRow.#el('button', 'task-add-sub', '+ Subtask');
      add.type = 'button';
      add.setAttribute('aria-label', `Add subtask to: ${this.#visibleText()}`);
      add.addEventListener('click', () => this.#actions.addSubtask?.(task));
      tail.append(add);
    }
    if (this.#taskList.children(task).length > 0) {
      const { done, total } = VisibilityRules.subtaskProgress(this.#taskList, task);
      tail.append(TaskRow.#el('span', 'task-progress', `${done}/${total}`));
    }
    const problems = this.#problems.get(task);
    if (problems) tail.append(TaskRow.#problemBadge(problems));
    if (this.#taskList.isBlocked(task)) {
      const pill = TaskRow.#el('button', 'pill-blocked', `Blocked by #${task.depId}`);
      pill.type = 'button';
      pill.setAttribute('aria-label', `Show blocking task #${task.depId}`);
      pill.addEventListener('click', () => this.#actions.showTask?.(task.depId));
      tail.append(pill);
    }
    if (task.wip !== null && task.file === 'todo' && !task.complete) {
      const name = ProjectPalette.displayName(task.wip);
      const pill = TaskRow.#el('span', 'pill-wip', `${name} working`);
      pill.title = `${name} is working on this`;
      tail.append(pill);
    }
    const age = task.file === 'todo' && !task.complete && task.creationDate ? Age.label(task.creationDate, this.#today) : null;
    if (age !== null) {
      const badge = TaskRow.#el('span', 'task-age', age);
      badge.title = `Created ${task.creationDate}`;
      tail.append(badge);
    }
    if (task.by !== null) tail.append(TaskRow.#authorBadge(task.by));
    if (task.id !== null) tail.append(TaskRow.#el('span', 'task-id', `#${task.id}`));
  }

  // `by:me` is plain muted text; any other value is an agent and gets a teal fill.
  static #authorBadge(by) {
    const name = ProjectPalette.displayName(by);
    const badge = TaskRow.#el('span', by === 'me' ? 'badge badge-author' : 'badge badge-author badge-author-agent', name);
    badge.title = `Added by ${name}`;
    return badge;
  }

  static #problemBadge(problems) {
    const error = problems.some((p) => p.severity === 'error');
    const badge = TaskRow.#el('span', `badge badge-problem-${error ? 'error' : 'warning'}`, error ? 'Error' : 'Warning');
    const messages = problems.map((p) => p.message).join('; ');
    badge.title = messages;
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', `${error ? 'Error' : 'Warning'}: ${messages}`);
    return badge;
  }

  // Stable across reloads: the id when the task has one, else its exact line.
  static keyOf(task) {
    return task.id !== null ? `id:${task.id}` : `raw:${task.raw}#${task.occurrence}`;
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
