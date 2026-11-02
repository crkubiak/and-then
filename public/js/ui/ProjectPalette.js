const ROTATION = ['green', 'yellow', 'teal', 'red'];

// Accents follow first appearance of each primary project across ALL todo
// tasks in file order, so colors stay put when tasks complete.
export class ProjectPalette {
  #accents = new Map();

  constructor(taskList) {
    for (const task of taskList.todoTasks) {
      const project = task.primaryProject;
      if (project === null || this.#accents.has(project)) continue;
      this.#accents.set(project, ROTATION[this.#accents.size % ROTATION.length]);
    }
  }

  // Inbox (null) and unknown projects get 'muted'.
  accent(project) {
    return this.#accents.get(project) ?? 'muted';
  }

  static displayName(project) {
    return project === null ? 'Inbox' : project.replaceAll('_', ' ');
  }
}
