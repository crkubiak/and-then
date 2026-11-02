// Pure string functions over a Task's raw line. `body` is never altered, so its
// internal spacing survives. Output never has a trailing \r (TaskList owns line endings).
export class TaskSerializer {
  static complete(task, date) {
    if (task.complete) return TaskSerializer.#line(task);
    // An agent's in-progress and needs-human marks end with the task.
    const body = TaskSerializer.#dropTag(TaskSerializer.#dropTag(task.body, 'wip'), 'needs');
    return TaskSerializer.#join(['x', date, task.creationDate, TaskSerializer.#priority(task)], body);
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

  // The whole line without any `key:value` token of that key. Everything else stays exact.
  static removeTag(task, key) {
    return TaskSerializer.#dropTag(TaskSerializer.#line(task), key);
  }

  // Removes every `key:value` token and one adjacent run of spaces; other spacing is untouched.
  static #dropTag(text, key) {
    const token = `${key.replace(/[^\w-]/g, '')}:\\S+`;
    return text
      .replace(new RegExp(`^${token}(?=\\s|$)\\s*`), '')
      .replace(new RegExp(`\\s+${token}(?=\\s|$)`, 'g'), '');
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
