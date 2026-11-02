import { TaskParser } from './TaskParser.js';

// Immutable view of todo.txt + done.txt. Every original line is kept (blanks
// included) so toText() reproduces untouched input exactly. Edits return a new list.
export class TaskList {
  #files;
  #byId = new Map();
  #duplicateIds = new Map();
  #parentStatus = new Map();
  #parentOf = new Map();
  #childrenOf = new Map();
  #parentCycles = [];
  #depCycles = [];
  #roots = [];

  // `eols` is internal: edits pass it on so an emptied CRLF file keeps its EOL.
  constructor({ todo = '', done = '', eols = {} } = {}) {
    this.#files = {
      todo: TaskList.#readFile(todo, 'todo', eols.todo),
      done: TaskList.#readFile(done, 'done', eols.done),
    };
    this.todoTasks = Object.freeze(this.#files.todo.tasks);
    this.doneTasks = Object.freeze(this.#files.done.tasks);
    this.#indexIds();
    this.#buildTree();
    this.#depCycles = TaskList.#findCycles(this.todoTasks, this.#depEdges());
  }

  // ---- text ----

  toText() {
    return { todo: TaskList.#writeFile(this.#files.todo), done: TaskList.#writeFile(this.#files.done) };
  }

  static #readFile(text, file, eolOverride) {
    const eol = eolOverride ?? (text.includes('\r\n') ? '\r\n' : '\n');
    const endsWithNewline = text !== '' && text.endsWith(eol);
    const body = endsWithNewline ? text.slice(0, -eol.length) : text;
    const lines = text === '' ? [] : body.split(eol);
    const tasks = [];
    lines.forEach((line, i) => {
      const task = TaskParser.parse(line, { file, lineNumber: i + 1 });
      if (task) tasks.push(task);
    });
    return { lines, eol, endsWithNewline, tasks };
  }

  static #writeFile({ lines, eol, endsWithNewline }) {
    return lines.join(eol) + (endsWithNewline && lines.length ? eol : '');
  }

  // ---- ids ----

  #indexIds() {
    const groups = new Map();
    for (const task of [...this.todoTasks, ...this.doneTasks]) {
      if (task.id === null) continue;
      if (!this.#byId.has(task.id)) this.#byId.set(task.id, task);
      if (!groups.has(task.id)) groups.set(task.id, []);
      groups.get(task.id).push(task);
    }
    for (const [id, tasks] of groups) if (tasks.length > 1) this.#duplicateIds.set(id, tasks);
  }

  byId(id) {
    return this.#byId.get(id) ?? null;
  }

  duplicateIds() {
    return this.#duplicateIds;
  }

  // ---- tree (todo tasks only) ----

  #buildTree() {
    const candidates = new Map();
    for (const task of this.todoTasks) {
      const status = this.#initialParentStatus(task);
      this.#parentStatus.set(task, status);
      if (status === 'ok') candidates.set(task, this.byId(task.parentId));
    }
    this.#breakParentCycles(candidates);
    for (const task of this.todoTasks) {
      if (this.#parentStatus.get(task) !== 'ok') {
        this.#roots.push(task);
        continue;
      }
      const parent = candidates.get(task);
      this.#parentOf.set(task, parent);
      if (!this.#childrenOf.has(parent)) this.#childrenOf.set(parent, []);
      this.#childrenOf.get(parent).push(task);
    }
  }

  #initialParentStatus(task) {
    if (task.parentId === null) return 'none';
    const target = this.byId(task.parentId);
    if (!target) return 'missing';
    return target.file === 'done' ? 'archived' : 'ok';
  }

  // Break each cycle at its first task in file order; that task becomes a root.
  #breakParentCycles(candidates) {
    this.#parentCycles = TaskList.#findCycles(this.todoTasks, candidates);
    for (const cycle of this.#parentCycles) {
      this.#parentStatus.set(cycle[0], 'cycle');
      candidates.delete(cycle[0]);
    }
  }

  // Each task has at most one outgoing edge, so walk edges and report loops.
  // Members of a cycle are returned in file order.
  static #findCycles(tasks, next) {
    const state = new Map(); // 1 = on current path, 2 = finished
    const cycles = [];
    for (const start of tasks) {
      const path = [];
      let node = start;
      while (node && !state.has(node)) {
        state.set(node, 1);
        path.push(node);
        node = next.get(node);
      }
      if (node && state.get(node) === 1) {
        cycles.push(path.slice(path.indexOf(node)).sort((a, b) => a.lineNumber - b.lineNumber));
      }
      for (const visited of path) state.set(visited, 2);
    }
    return cycles;
  }

  parentStatus(task) {
    return this.#parentStatus.get(task) ?? 'none';
  }

  parentCycles() {
    return this.#parentCycles;
  }

  roots() {
    return this.#roots;
  }

  parent(task) {
    return this.#parentOf.get(task) ?? null;
  }

  children(task) {
    return this.#childrenOf.get(task) ?? [];
  }

  ancestors(task) {
    const result = [];
    for (let p = this.parent(task); p; p = this.parent(p)) result.push(p);
    return result;
  }

  descendants(task) {
    return this.children(task).flatMap((child) => [child, ...this.descendants(child)]);
  }

  root(task) {
    return this.ancestors(task).at(-1) ?? task;
  }

  // PRD §3.2: a subtask belongs to its root ancestor's primary project.
  effectiveProject(task) {
    return this.root(task).primaryProject;
  }

  projectMismatch(task) {
    if (this.parent(task) === null || task.primaryProject === null) return false;
    return task.primaryProject !== this.effectiveProject(task);
  }

  // ---- dependencies ----

  depTarget(task) {
    return task.depId === null ? null : this.byId(task.depId);
  }

  depStatus(task) {
    if (task.depId === null) return 'none';
    return this.depTarget(task) ? 'ok' : 'missing';
  }

  // Only open tasks are blocked. A target archived to done.txt counts as satisfied; a missing one is ignored.
  isBlocked(task) {
    if (task.complete) return false;
    const target = this.depTarget(task);
    return Boolean(target) && target.file === 'todo' && !target.complete;
  }

  depCycles() {
    return this.#depCycles;
  }

  #depEdges() {
    const edges = new Map();
    for (const task of this.todoTasks) {
      const target = this.depTarget(task);
      if (target && target.file === 'todo') edges.set(task, target);
    }
    return edges;
  }

  // ---- edits (each returns a new TaskList) ----

  replaceLine(task, raw) {
    const state = this.#copyState();
    state[task.file].lines[task.lineNumber - 1] = raw;
    return TaskList.#fromState(state);
  }

  appendLine(file, raw) {
    const state = this.#copyState();
    state[file].lines.push(raw);
    state[file].endsWithNewline = true;
    return TaskList.#fromState(state);
  }

  removeTasks(tasks) {
    const state = this.#copyState();
    for (const file of ['todo', 'done']) {
      const drop = new Set(tasks.filter((t) => t.file === file).map((t) => t.lineNumber - 1));
      state[file].lines = state[file].lines.filter((_, i) => !drop.has(i));
    }
    return TaskList.#fromState(state);
  }

  // Finds the same task in this list: by id within the file, else by identical raw line.
  locate(task) {
    const tasks = task.file === 'todo' ? this.todoTasks : this.doneTasks;
    const match = task.id !== null
      ? tasks.find((t) => t.id === task.id)
      : tasks.find((t) => t.raw === task.raw);
    return match ?? null;
  }

  #copyState() {
    const copy = (f) => ({ lines: [...f.lines], eol: f.eol, endsWithNewline: f.endsWithNewline });
    return { todo: copy(this.#files.todo), done: copy(this.#files.done) };
  }

  static #fromState(state) {
    return new TaskList({
      todo: TaskList.#writeFile(state.todo),
      done: TaskList.#writeFile(state.done),
      eols: { todo: state.todo.eol, done: state.done.eol },
    });
  }
}
