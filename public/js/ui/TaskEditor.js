// The inline single-line editor for one task. App creates a new instance on every render
// and carries draft, focus and selection across via snapshot() and restore().
export class TaskEditor {
  #input;
  #dead = false; // set by dispose(): a detached editor must not fire callbacks

  constructor({ draft, onSave, onCancel, onBlur }) {
    this.#input = document.createElement('input');
    this.#input.type = 'text';
    this.#input.className = 'task-edit';
    this.#input.value = draft;
    this.#input.spellcheck = false;
    this.#input.setAttribute('aria-label', 'Edit task (todo.txt line)');
    this.#input.setAttribute('autocomplete', 'off');
    this.#input.addEventListener('keydown', (event) => {
      if (this.#dead || event.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        onSave();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    });
    this.#input.addEventListener('blur', () => {
      if (!this.#dead) onBlur();
    });
  }

  get element() {
    return this.#input;
  }

  get value() {
    return this.#input.value;
  }

  focus() {
    this.#input.focus({ preventScroll: true });
  }

  snapshot() {
    return {
      draft: this.#input.value,
      start: this.#input.selectionStart,
      end: this.#input.selectionEnd,
      focused: document.activeElement === this.#input,
    };
  }

  restore({ start, end, focused }) {
    this.#input.setSelectionRange(start, end);
    if (focused) this.focus();
  }

  dispose() {
    this.#dead = true;
  }

  // Closes in place, without a re-render: the row's normal content was never removed.
  unmount() {
    this.dispose();
    this.#input.closest('.task-row')?.classList.remove('is-editing');
    this.#input.remove();
  }
}
