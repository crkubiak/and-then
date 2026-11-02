const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOOSE_DATE = /^\d{4}-\d{1,2}-\d{1,2}(?=\s|$)/;
const FILE_NAMES = { todo: 'todo.txt', done: 'done.txt' };

export class Validator {
  // Returns [{ file, line, severity, code, message }] sorted for display.
  static validate(taskList) {
    const problems = [];
    const add = (task, severity, code, message) =>
      problems.push({ file: FILE_NAMES[task.file], line: task.lineNumber, severity, code, message });

    for (const task of [...taskList.todoTasks, ...taskList.doneTasks]) {
      Validator.#checkLine(task, add);
    }
    Validator.#checkDuplicateIds(taskList, add);
    for (const task of taskList.todoTasks) {
      Validator.#checkReferences(taskList, task, add);
    }
    Validator.#checkCycles(taskList, add);
    return problems.sort(Validator.#compare);
  }

  // Checks that need only the line itself.
  static #checkLine(task, add) {
    for (const key of task.duplicateKeys) {
      if (key === 'parent') add(task, 'error', 'second-parent', 'second parent: token (the first one wins)');
      else add(task, 'error', 'duplicate-key', `${key}: appears more than once`);
    }
    if (task.complete && !task.completionDate) {
      add(task, 'warning', 'missing-completion-date', 'completed task has no completion date');
    }
    for (const [label, value] of [
      ['completion date', task.completionDate],
      ['creation date', task.creationDate],
      ['due:', task.due],
    ]) {
      if (value !== null && !Validator.#isRealDate(value)) {
        const shown = label === 'due:' ? `due:${value}` : `${label} ${value}`;
        add(task, 'error', 'bad-date', `${shown} is not a valid YYYY-MM-DD date`);
      }
    }
    // A leading date the parser couldn't read silently becomes description text.
    const loose = task.creationDate === null && LOOSE_DATE.exec(task.body);
    if (loose) {
      add(task, 'warning', 'loose-date', `"${loose[0]}" looks like a date but is not YYYY-MM-DD`);
    }
  }

  static #isRealDate(text) {
    const m = DATE_FORMAT.exec(text);
    if (!m) return false;
    const [year, month, day] = m.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  static #checkDuplicateIds(taskList, add) {
    for (const [id, tasks] of taskList.duplicateIds()) {
      for (const task of tasks) add(task, 'error', 'duplicate-id', `id:${id} is used by ${tasks.length} tasks`);
    }
  }

  // Todo-only checks on parent:, dep:, project, and open children.
  static #checkReferences(taskList, task, add) {
    const parentStatus = taskList.parentStatus(task);
    if (parentStatus === 'missing') {
      add(task, 'error', 'parent-missing', `parent:${task.parentId} does not match any task`);
    } else if (parentStatus === 'archived') {
      add(task, 'error', 'parent-archived', `parent:${task.parentId} points at a task archived in done.txt`);
    }
    if (taskList.depStatus(task) === 'missing') {
      add(task, 'error', 'dep-missing', `dep:${task.depId} does not match any task`);
    }
    if (taskList.projectMismatch(task)) {
      const rootProject = taskList.effectiveProject(task);
      const root = rootProject === null ? 'root task in Inbox (no project)' : `root project +${rootProject}`;
      add(task, 'error', 'project-mismatch', `subtask project +${task.primaryProject} differs from ${root}`);
    }
    Validator.#checkOpenChildren(taskList, task, add);
  }

  static #checkOpenChildren(taskList, task, add) {
    if (!task.complete) return;
    const open = taskList.descendants(task).filter((t) => !t.complete).length;
    if (open > 0) {
      add(task, 'warning', 'completed-parent-open-children',
        `completed parent has ${open} open ${open === 1 ? 'subtask' : 'subtasks'}`);
    }
  }

  static #checkCycles(taskList, add) {
    for (const cycle of taskList.parentCycles()) {
      for (const task of cycle) add(task, 'error', 'parent-cycle', `parent:${task.parentId} is part of a parent cycle`);
    }
    for (const cycle of taskList.depCycles()) {
      for (const task of cycle) add(task, 'error', 'dep-cycle', `dep:${task.depId} is part of a dependency cycle`);
    }
  }

  static #compare(a, b) {
    const rank = (p) => (p.severity === 'error' ? 0 : 1);
    return (a.file === b.file ? 0 : a.file === 'todo.txt' ? -1 : 1)
      || a.line - b.line
      || rank(a) - rank(b)
      || a.code.localeCompare(b.code);
  }
}
