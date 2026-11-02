const STORAGE_KEY = 'taskflow.hideCompleted';

// The controls row under the add-task input. App owns one instance and re-attaches `element`
// on every render, so a focused control survives (App restores focus by data-key).
export class Toolbar {
  #checkbox;
  #element;

  // `onHideChange()` runs after the toggle changes (read it back with `hideCompleted`).
  constructor({ onHideChange, onExpandAll, onCollapseAll }) {
    this.#element = document.createElement('div');
    this.#element.className = 'toolbar';
    this.#element.setAttribute('role', 'toolbar');
    this.#element.setAttribute('aria-label', 'View options');

    const label = document.createElement('label');
    label.className = 'toolbar-toggle';
    this.#checkbox = document.createElement('input');
    this.#checkbox.type = 'checkbox';
    this.#checkbox.checked = Toolbar.#read();
    this.#checkbox.dataset.key = 'toolbar:hide';
    const text = document.createElement('span');
    text.textContent = 'Hide Completed';
    label.append(this.#checkbox, text);
    this.#checkbox.addEventListener('change', () => {
      Toolbar.#write(this.#checkbox.checked);
      onHideChange();
    });

    this.#element.append(
      label,
      Toolbar.#button('Expand All', 'toolbar:expand', onExpandAll),
      Toolbar.#button('Collapse All', 'toolbar:collapse', onCollapseAll),
    );
  }

  get element() {
    return this.#element;
  }

  get hideCompleted() {
    return this.#checkbox.checked;
  }

  static #button(text, key, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toolbar-button';
    button.textContent = text;
    button.dataset.key = key; // lets App restore focus after a re-render
    button.addEventListener('click', onClick);
    return button;
  }

  // Storage can be blocked or hold junk; fall back to "show everything".
  static #read() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  static #write(value) {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Blocked or full: the toggle still works for this page view.
    }
  }
}
