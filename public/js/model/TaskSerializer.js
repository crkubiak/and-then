// Pure string functions over a Task's raw line. `body` is never altered, so its
// internal spacing survives. Output never has a trailing \r (TaskList owns line endings).
export class TaskSerializer {
  static complete(task, date) {
    if (task.complete) return TaskSerializer.#line(task);
    return TaskSerializer.#join(['x', date, task.creationDate, TaskSerializer.#priority(task)], task.body);
  }

  static reopen(task) {
    if (!task.complete) return TaskSerializer.#line(task);
    return TaskSerializer.#join([TaskSerializer.#priority(task), task.creationDate], task.body);
  }

  static setTag(task, key, value) {
    const line = TaskSerializer.#line(task);
    if (Object.hasOwn(task.tags, key)) return line;
    const gap = /\s$/.test(line) ? '' : ' ';
    return `${line}${gap}${key}:${value}`;
  }

  static #line(task) {
    return task.raw.endsWith('\r') ? task.raw.slice(0, -1) : task.raw;
  }

  static #priority(task) {
    return task.priority ? `(${task.priority})` : null;
  }

  // Each present marker is followed by one space, then the untouched body.
  static #join(markers, body) {
    return markers.filter(Boolean).map((m) => `${m} `).join('') + body;
  }
}
