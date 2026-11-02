const STORAGE_KEY = 'taskflow.hideCompleted';

// The controls row under the add-task input. App owns one instance and re-attaches `element`
// on every render, so a focused control survives (App restores focus by data-key).
export class Toolbar {
  #checkbox;
  #problems;
  #sweep;
  #sweepCount;
  #raw;
  #element;

  // `onHideChange()` runs after the toggle changes (read it back with `hideCompleted`).
  constructor({ onHideChange, onExpandAll, onCollapseAll, onProblemsToggle, onSweep, onRaw }) {
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
    this.#sweep = Toolbar.#button('Sweep (30d+)', 'toolbar:sweep', () => {
      if (this.#sweep.getAttribute('aria-disabled') !== 'true') onSweep();
    });
    this.#sweepCount = document.createElement('span');
    this.#sweepCount.className = 'badge toolbar-count';
    this.#sweep.append(' ', this.#sweepCount);
    this.#element.append(this.#sweep);
    this.#raw = Toolbar.#button('Raw text', 'toolbar:raw', onRaw);
    this.#element.append(this.#raw);
    this.#problems = Toolbar.#button('', 'toolbar:problems', onProblemsToggle);
    this.#problems.setAttribute('aria-controls', 'problems-panel');
    this.#problems.setAttribute('aria-expanded', 'false');
    this.#problems.hidden = true;
    this.#element.append(this.#problems);
  }

  get element() {
    return this.#element;
  }

  // Shows the problem count (red when any error, yellow when warnings only); hidden at 0.
  setProblems({ errors, warnings, open }) {
    const count = errors + warnings;
    this.#problems.hidden = count === 0;
    this.#problems.className = `toolbar-button toolbar-problems ${errors > 0 ? 'is-error' : 'is-warning'}`;
    this.#problems.textContent = `${count} ${count === 1 ? 'problem' : 'problems'}`;
    this.#problems.setAttribute('aria-expanded', String(open));
  }

  // aria-disabled (not disabled) at 0 so the button keeps focus and its tooltip.
  setSweep(count) {
    this.#sweepCount.textContent = String(count);
    this.#sweepCount.hidden = count === 0;
    this.#sweep.setAttribute('aria-disabled', String(count === 0));
    this.#sweep.title = count === 0 ? 'Nothing is old enough to sweep' : '';
  }

  // The raw drawer returns focus here when it closes.
  focusRaw() {
    this.#raw.focus();
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
