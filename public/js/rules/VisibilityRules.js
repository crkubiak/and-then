// PRD §4.3. A completed task with any open descendant stays visible as an "anchor",
// so hiding completed tasks never orphans an open one.
export class VisibilityRules {
  static isAnchor(taskList, task) {
    return task.complete && taskList.descendants(task).some((t) => !t.complete);
  }

  // Only todo.txt tasks are ever rendered.
  static isVisible(taskList, task, { hideCompleted }) {
    if (task.file !== 'todo') return false;
    if (!hideCompleted || !task.complete) return true;
    return VisibilityRules.isAnchor(taskList, task);
  }

  // Counts every descendant, including ones hidden by the toggle.
  static subtaskProgress(taskList, task) {
    const all = taskList.descendants(task);
    return { done: all.filter((t) => t.complete).length, total: all.length };
  }
}
