const NOTICE = 'The files changed on disk.';
const FOCUSABLE = 'textarea, button';
let nextId = 0;

// Browsers hand textarea values back with LF only, so compare and restore line endings ourselves.
const normalize = (text) => text.replace(/\r\n?/g, '\n');
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

// Slide-over editor for the two raw files (PRD §5.5). Mounted on <body>, outside App's #root,
// so re-renders never touch it. App feeds it the current text through open() and update().
export class RawDrawer {
  #onSave;
  #onClose;
  #root;
  #todo;
  #done;
  #notice;
  #save;
  #base = null; // the text the drafts were started from: { todo, done }
  #latest = null; // newer text that arrived while the drafts were dirty
  #busy = false;

  // `onSave({ todo, done, eols, base })` resolves true when the files were saved.
  // `onClose()` runs after the drawer closes, so App can return focus to its button.
  constructor({ onSave, onClose }) {
    this.#onSave = onSave;
    this.#onClose = onClose;
    this.#root = document.createElement('div');
    this.#root.className = 'raw-drawer';
    this.#root.hidden = true;
    const backdrop = document.createElement('div');
    backdrop.className = 'raw-backdrop';

    const panel = document.createElement('div');
    panel.className = 'raw-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Raw text');
    panel.addEventListener('keydown', (event) => this.#onKey(event));

    const header = document.createElement('div');
    header.className = 'raw-header';
    const title = document.createElement('h2');
    title.className = 'raw-title';
    title.textContent = 'Raw text';
    this.#save = RawDrawer.#button('Save', 'raw-save', () => this.#submit());
    header.append(title, this.#save, RawDrawer.#button('Close', 'raw-close', () => this.#requestClose()));

    this.#notice = document.createElement('div');
    this.#notice.className = 'raw-notice';
    this.#notice.setAttribute('role', 'status');
    this.#notice.hidden = true;
    const text = document.createElement('span');
    text.textContent = NOTICE;
    this.#notice.append(text, RawDrawer.#button('Load latest', 'raw-load', () => this.#loadLatest()));

    const body = document.createElement('div');
    body.className = 'raw-body';
    this.#todo = RawDrawer.#textarea('todo.txt');
    this.#done = RawDrawer.#textarea('done.txt');
    body.append(this.#todo.label, this.#done.label);

    panel.append(header, this.#notice, body);
    this.#root.append(backdrop, panel);
    document.body.append(this.#root);
  }

  get isOpen() {
    return !this.#root.hidden;
  }

  // Fills both textareas from `files` ({ todo, done } exactly as on disk) and moves focus in.
  open(files) {
    this.#fill(files);
    this.#root.hidden = false;
    this.#todo.field.focus();
  }

  // Called with the newest text on every load. A clean drawer follows it; a dirty one keeps
  // its drafts and shows the notice instead.
  update(files) {
    if (!this.isOpen) return;
    if (files.todo === this.#base.todo && files.done === this.#base.done) {
      this.#latest = null;
      this.#notice.hidden = true;
    } else if (this.#isDirty()) {
      this.#latest = files;
      this.#notice.hidden = false;
    } else {
      this.#fill(files);
    }
  }

  close() {
    this.#root.hidden = true;
    this.#onClose();
  }

  #fill(files) {
    this.#base = { todo: files.todo, done: files.done };
    this.#latest = null;
    this.#notice.hidden = true;
    this.#todo.field.value = files.todo;
    this.#done.field.value = files.done;
  }

  #isDirty() {
    return normalize(this.#todo.field.value) !== normalize(this.#base.todo)
      || normalize(this.#done.field.value) !== normalize(this.#base.done);
  }

  #loadLatest() {
    if (this.#latest && window.confirm('Replace your drafts with the latest files?')) this.#fill(this.#latest);
  }

  #requestClose() {
    if (this.#isDirty() && !window.confirm('Discard your unsaved changes?')) return;
    this.close();
  }

  // An untouched file goes back byte for byte; an edited one gets the original line endings back.
  #restore(draft, base) {
    return normalize(draft) === normalize(base) ? base : normalize(draft).replace(/\n/g, eolOf(base));
  }

  async #submit() {
    if (this.#busy) return;
    this.#busy = true;
    this.#save.setAttribute('aria-disabled', 'true');
    const base = this.#base;
    try {
      await this.#onSave({
        todo: this.#restore(this.#todo.field.value, base.todo),
        done: this.#restore(this.#done.field.value, base.done),
        eols: { todo: eolOf(base.todo), done: eolOf(base.done) },
        base,
      });
    } finally {
      this.#busy = false;
      this.#save.setAttribute('aria-disabled', 'false');
    }
  }

  #onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.#requestClose();
    } else if (event.key === 'Tab') {
      this.#wrapTab(event);
    }
  }

  // Keeps Tab inside the dialog.
  #wrapTab(event) {
    const items = [...this.#root.querySelectorAll(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  static #textarea(name) {
    const id = `raw-field-${nextId++}`;
    const label = document.createElement('label');
    label.className = 'raw-label';
    label.htmlFor = id;
    const text = document.createElement('span');
    text.textContent = name;
    const field = document.createElement('textarea');
    field.id = id;
    field.className = 'raw-field';
    field.spellcheck = false;
    field.setAttribute('autocomplete', 'off');
    label.append(text, field);
    return { label, field };
  }

  static #button(text, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `raw-button ${className}`;
    button.textContent = text;
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') !== 'true') onClick();
    });
    return button;
  }
}
