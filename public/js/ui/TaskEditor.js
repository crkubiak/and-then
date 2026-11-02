// The inline single-line editor for one task, or, with `create`, the new-subtask input under a
// parent. App creates a new instance on every render and carries draft, focus and selection
// across via snapshot() and restore().
export class TaskEditor {
  #input;
  #create;
  #dead = false; // set by dispose(): a detached editor must not fire callbacks

  constructor({ draft, create = false, onSave, onCancel, onBlur }) {
    this.#create = create;
    this.#input = document.createElement('input');
    this.#input.type = 'text';
    this.#input.className = 'task-edit';
    this.#input.value = draft;
    this.#input.spellcheck = false;
    this.#input.setAttribute('aria-label', create ? 'New subtask description' : 'Edit task (todo.txt line)');
    if (create) this.#input.placeholder = 'New subtask (Enter adds, Esc closes)';
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

  clear() {
    this.#input.value = '';
    this.#input.setSelectionRange(0, 0);
  }

  dispose() {
    this.#dead = true;
  }

  // Closes in place, without a re-render: the row's normal content was never removed.
  unmount() {
    this.dispose();
    if (!this.#create) {
      this.#input.closest('.task-row')?.classList.remove('is-editing');
      this.#input.remove();
      return;
    }
    const box = this.#input.closest('.task-new');
    const kids = box?.closest('.task-children');
    box?.remove();
    if (kids && !kids.querySelector('.task-node')) kids.remove(); // the container only existed for this input
  }
}
