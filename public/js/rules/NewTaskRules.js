import { TaskParser } from '../model/TaskParser.js';

// PRD §5.4 and §3.2: validates a raw line typed into the add input and stamps
// the creation date. Returns { line } or { error }.
export class NewTaskRules {
  static prepare(taskList, text, date) {
    const typed = text.trim();
    if (typed.startsWith('x ')) return { error: 'Add open tasks only.' };
    const task = TaskParser.parse(typed, { file: 'todo', lineNumber: 0 });
    if (!task || task.body.trim() === '') return { error: 'Enter a task description.' };

    if (task.id !== null && taskList.byId(task.id)) return { error: `id:${task.id} already exists.` };
    const mismatch = NewTaskRules.#parentError(taskList, task);
    if (mismatch) return { error: mismatch };

    if (task.creationDate) return { line: typed };
    const priority = task.priority ? `(${task.priority}) ` : '';
    return { line: `${priority}${date} ${task.body}` };
  }

  static #parentError(taskList, task) {
    if (task.parentId === null) return null;
    const parent = taskList.byId(task.parentId);
    if (!parent || parent.file !== 'todo') return `parent:${task.parentId} is not a task in todo.txt.`;
    const rootProject = taskList.root(parent).primaryProject;
    if (task.primaryProject !== null && task.primaryProject !== rootProject) {
      const home = rootProject ? `+${rootProject}` : 'no project';
      return `A subtask belongs to its root's project (${home}). Use that project or leave it out.`;
    }
    return null;
  }
}
