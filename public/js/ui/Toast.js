// Transient bottom-left messages. The region lives outside App's #root so
// re-renders never remove it.
export class Toast {
  static #DURATION_MS = 4000;
  static #MAX_VISIBLE = 5;

  #region;

  constructor(parent = document.body) {
    this.#region = document.createElement('div');
    this.#region.className = 'toast-region';
    this.#region.setAttribute('role', 'status');
    this.#region.setAttribute('aria-live', 'polite');
    parent.append(this.#region);
  }

  info(message) {
    this.show(message, 'info');
  }

  error(message) {
    this.show(message, 'error');
  }

  show(message, kind = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${kind === 'error' ? 'error' : 'info'}`;
    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';

    const dismiss = () => {
      clearTimeout(timer);
      toast.remove();
    };
    const timer = setTimeout(dismiss, Toast.#DURATION_MS);
    close.addEventListener('click', dismiss);
    toast.append(text, close);

    this.#region.append(toast);
    while (this.#region.children.length > Toast.#MAX_VISIBLE) this.#region.firstElementChild.remove();
  }
}
