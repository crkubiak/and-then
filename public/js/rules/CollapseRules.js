// PRD §5.3. Which parent rows start out collapsed. Pure: the caller owns the collapse state.
export class CollapseRules {
  // A completed parent that has subtasks starts collapsed, even when a subtask was added to it later
  // (an agent documenting finished work). An open parent starts expanded, and a task with no subtasks
  // has nothing to collapse.
  static startsCollapsed(taskList, task) {
    return task.complete && taskList.children(task).length > 0;
  }

  // The state a parent row starts in: the choice the user saved if there is one, else the default.
  static initiallyCollapsed(taskList, task, savedChoice) {
    return savedChoice === undefined ? CollapseRules.startsCollapsed(taskList, task) : savedChoice;
  }
}
