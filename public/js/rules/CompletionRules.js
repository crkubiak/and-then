import { TaskSerializer } from '../model/TaskSerializer.js';

// PRD §4.1 and §4.2. The caller supplies `date` (local today, YYYY-MM-DD).
export class CompletionRules {
  // Open descendants lock completion (hard). A blocker only asks for confirmation (soft).
  static check(taskList, task) {
    if (task.complete) return { allowed: false, needsConfirm: false, openDescendants: [], blocker: null };
    const openDescendants = taskList.descendants(task).filter((t) => !t.complete);
    const blocker = taskList.isBlocked(task) ? taskList.depTarget(task) : null;
    return {
      allowed: openDescendants.length === 0,
      needsConfirm: blocker !== null,
      openDescendants,
      blocker,
    };
  }

  static complete(taskList, task, date) {
    CompletionRules.#requireTodo(task);
    if (!CompletionRules.check(taskList, task).allowed) {
      throw new Error(`Cannot complete line ${task.lineNumber}: already complete or has open subtasks`);
    }
    return taskList.replaceLine(task, TaskSerializer.complete(task, date));
  }

  // Reopens the task and every completed ancestor. Line numbers are stable across
  // replaceLine, so the original Task objects stay valid for each replacement.
  static reopen(taskList, task) {
    CompletionRules.#requireTodo(task);
    const chain = [task, ...taskList.ancestors(task)].filter((t) => t.complete);
    return chain.reduce((list, t) => list.replaceLine(t, TaskSerializer.reopen(t)), taskList);
  }

  static #requireTodo(task) {
    if (task.file !== 'todo') throw new Error('Only tasks in todo.txt can be changed');
  }
}
