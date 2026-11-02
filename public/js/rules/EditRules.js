import { TaskParser } from '../model/TaskParser.js';
import { NewTaskRules } from './NewTaskRules.js';

// PRD §5.3, §3.2 and FORMAT.md: checks an inline edit of `task` (a Task in `taskList`)
// to the raw line `line`. Returns an error message, or null when the edit may be saved.
export class EditRules {
  static check(taskList, task, line) {
    if (line.trim() === '') return "Deletion isn't supported yet.";
    const next = TaskParser.parse(line, { file: 'todo', lineNumber: task.lineNumber });
    if (next.complete !== task.complete) return 'Use the checkbox to complete or reopen.';
    return (
      EditRules.#idError(taskList, task, next) ??
      EditRules.#parentError(taskList, task, next) ??
      EditRules.#descendantError(taskList, task, next)
    );
  }

  static #idError(taskList, task, next) {
    if (next.id === task.id) return null;
    if (next.id !== null && taskList.byId(next.id)) return `id:${next.id} already exists.`;
    if (task.id !== null) return `IDs never change. Keep id:${task.id} on this line.`;
    return null; // adding a unique id to a task that had none
  }

  // Only a new or changed parent: or project is checked, so a line that was
  // already mismatched on disk can still have its other text edited.
  static #parentError(taskList, task, next) {
    if (next.parentId === null) return null;
    const parentChanged = next.parentId !== task.parentId;
    if (parentChanged && EditRules.#isCycle(taskList, task, next)) {
      return `parent:${next.parentId} would make a task its own ancestor.`;
    }
    if (parentChanged || next.primaryProject !== task.primaryProject) {
      return NewTaskRules.parentError(taskList, next);
    }
    return null;
  }

  static #isCycle(taskList, task, next) {
    if (next.parentId === next.id) return true;
    const parent = taskList.byId(next.parentId);
    return parent !== null && (parent === task || taskList.descendants(task).includes(parent));
  }

  // Changing the project this task's subtree lives in must not strand a subtask
  // that explicitly names the old project.
  static #descendantError(taskList, task, next) {
    const oldHome = taskList.effectiveProject(task);
    const parent = next.parentId === null ? null : taskList.byId(next.parentId);
    const newHome = parent ? taskList.root(parent).primaryProject : next.primaryProject;
    if (newHome === oldHome || oldHome === null) return null;
    const stranded = taskList.descendants(task).some((d) => d.primaryProject === oldHome);
    return stranded ? `Subtasks still name +${oldHome}. Change them first.` : null;
  }
}
