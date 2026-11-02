// The add-task line. App owns one instance and re-attaches `element` on every render,
// calling snapshot() before and restore() after so draft, focus and caret survive.
export class TaskInput {
  #onSubmit;
  #form;
  #input;
  #pending = null; // 8.4: a step to run with the next submit, set via prefill()
  #busy = false;

  // `onSubmit(text, pending)` resolves true when the task was saved.
  constructor({ onSubmit }) {
    this.#onSubmit = onSubmit;
    this.#form = document.createElement('form');
    this.#form.className = 'task-input';
    this.#input = document.createElement('input');
    this.#input.type = 'text';
    this.#input.className = 'task-input-field';
    this.#input.placeholder = '(A) Call vendor +Infra @phone due:2026-11-10';
    this.#input.setAttribute('aria-label', 'Add a task (todo.txt line)');
    this.#input.setAttribute('autocomplete', 'off');
    this.#input.spellcheck = false;
    const add = document.createElement('button');
    add.type = 'submit';
    add.className = 'task-input-add';
    add.textContent = 'Add';
    this.#form.append(this.#input, add);
    this.#input.addEventListener('input', () => {
      if (this.#input.value === '') this.#pending = null; // emptied by hand: drop the pending step
    });
    this.#form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#submit();
    });
  }

  get element() {
    return this.#form;
  }

  // Fills the input, focuses it, and places the caret ('start' or 'end').
  prefill(text, { caretAt = 'end', pending = null } = {}) {
    this.#input.value = text;
    this.#pending = pending;
    this.#input.focus({ preventScroll: true });
    const at = caretAt === 'start' ? 0 : text.length;
    this.#input.setSelectionRange(at, at);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.#form.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }

  snapshot() {
    if (document.activeElement !== this.#input) return null;
    return { start: this.#input.selectionStart, end: this.#input.selectionEnd, direction: this.#input.selectionDirection };
  }

  restore(snapshot) {
    if (!snapshot) return;
    this.#input.focus({ preventScroll: true });
    this.#input.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction ?? undefined);
  }

  async #submit() {
    const text = this.#input.value;
    if (text.trim() === '' || this.#busy) return;
    this.#busy = true;
    try {
      const saved = await this.#onSubmit(text, this.#pending);
      if (!saved) return; // keep the text so it can be fixed
      this.#pending = null;
      if (this.#input.value === text) this.#input.value = ''; // not if typing continued meanwhile
      this.#input.focus({ preventScroll: true });
    } finally {
      this.#busy = false;
    }
  }
}
