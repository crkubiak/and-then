// The list under the toolbar (§5.6). App owns one instance and re-attaches `element` on every
// render. Open state lives in App; this only draws what it is given.
export class ProblemsPanel {
  #onSelect;
  #element;

  // `onSelect(task)` runs when a problem that maps to a todo.txt task is clicked.
  constructor({ onSelect }) {
    this.#onSelect = onSelect;
    this.#element = document.createElement('ul');
    this.#element.className = 'problems';
    this.#element.id = 'problems-panel';
    this.#element.setAttribute('aria-label', 'Problems');
  }

  get element() {
    return this.#element;
  }

  // `entries` are validator problems plus `task` (the todo.txt task on that line, or null).
  // Errors come first; the validator already put each group in file order.
  update(entries, open) {
    this.#element.hidden = !open;
    const rank = (e) => (e.severity === 'error' ? 0 : 1);
    this.#element.replaceChildren(...[...entries].sort((a, b) => rank(a) - rank(b)).map((e) => this.#item(e)));
  }

  #item(entry) {
    const li = document.createElement('li');
    const clickable = entry.task !== null;
    const row = document.createElement(clickable ? 'button' : 'div');
    row.className = clickable ? 'problem-item' : 'problem-item is-static';
    if (clickable) {
      row.type = 'button';
      row.dataset.key = `problem:${entry.file}:${entry.line}:${entry.code}`; // lets App restore focus after a re-render
      row.addEventListener('click', () => this.#onSelect(entry.task));
    }
    const severity = document.createElement('span');
    severity.className = `badge badge-problem-${entry.severity}`;
    severity.textContent = entry.severity === 'error' ? 'Error' : 'Warning';
    const where = document.createElement('span');
    where.className = 'problem-where';
    where.textContent = `${entry.file}:${entry.line}`;
    const message = document.createElement('span');
    message.className = 'problem-message';
    message.textContent = entry.message;
    row.append(severity, where, message);
    li.append(row);
    return li;
  }
}
