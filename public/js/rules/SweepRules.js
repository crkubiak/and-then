const MS_PER_DAY = 86_400_000;

// PRD §6. The caller supplies `today` (local, YYYY-MM-DD); nothing here reads the clock.
export class SweepRules {
  static SWEEP_AGE_DAYS = 30;

  // Union of every completed subtree that qualifies, in file order.
  static eligible(taskList, today) {
    const swept = new Set();
    for (const task of taskList.todoTasks) {
      if (!task.complete) continue;
      const subtree = [task, ...taskList.descendants(task)];
      if (SweepRules.#qualifies(taskList, subtree, today)) subtree.forEach((t) => swept.add(t));
    }
    return taskList.todoTasks.filter((t) => swept.has(t));
  }

  // Appends the lines to done.txt unchanged, then removes them from todo.txt.
  static sweep(taskList, today) {
    const tasks = SweepRules.eligible(taskList, today);
    const appended = tasks.reduce((list, t) => list.appendLine('done', t.raw), taskList);
    // Appending to done.txt leaves todo.txt line numbers alone, so `tasks` still match.
    return { taskList: appended.removeTasks(tasks), count: tasks.length };
  }

  static #qualifies(taskList, subtree, today) {
    return SweepRules.#allDatedAndOldEnough(subtree, today) && !SweepRules.#hasOpenDependent(taskList, subtree);
  }

  // Every task needs a completion date; the newest one sets the age.
  static #allDatedAndOldEnough(subtree, today) {
    if (!subtree.every((t) => t.complete && t.completionDate)) return false;
    const latest = subtree.map((t) => t.completionDate).reduce((a, b) => (a > b ? a : b));
    return SweepRules.#daysBetween(latest, today) >= SweepRules.SWEEP_AGE_DAYS;
  }

  static #hasOpenDependent(taskList, subtree) {
    const members = new Set(subtree);
    return taskList.todoTasks.some((t) => !t.complete && members.has(taskList.depTarget(t)));
  }

  static #daysBetween(from, to) {
    return Math.round((SweepRules.#utc(to) - SweepRules.#utc(from)) / MS_PER_DAY);
  }

  static #utc(date) {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
}
