// PRD §5.2. View-only ordering; nothing here touches the files.
export class SortOrder {
  static compare(a, b) {
    return (
      SortOrder.#byFlag(a.complete, b.complete) ||
      SortOrder.#byText(a.priority, b.priority) ||
      SortOrder.#byText(SortOrder.#validDue(a), SortOrder.#validDue(b)) ||
      SortOrder.#byText(a.creationDate, b.creationDate) ||
      a.lineNumber - b.lineNumber
    );
  }

  static sort(tasks) {
    return [...tasks].sort(SortOrder.compare);
  }

  // false before true.
  static #byFlag(a, b) {
    return Number(a) - Number(b);
  }

  // Earlier string first, null last. Priority letters and ISO dates both sort as text.
  static #byText(a, b) {
    if (a === b) return 0;
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    return a < b ? -1 : 1;
  }

  static #validDue(task) {
    return /^\d{4}-\d{2}-\d{2}$/.test(task.due ?? '') ? task.due : null;
  }
}
