// Transient bottom-left messages. The region lives outside App's #root so
// re-renders never remove it.
export class Toast {
  static #INFO_MS = 4000;
  static #ERROR_MS = 8000;
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

    // The timer pauses while the pointer is over the toast or focus is inside it,
    // then resumes with the time that was left.
    let remaining = kind === 'error' ? Toast.#ERROR_MS : Toast.#INFO_MS;
    let timer = null;
    let startedAt = 0;
    let hovered = false;
    let focused = false;
    const dismiss = () => {
      clearTimeout(timer);
      toast.remove();
    };
    const resume = () => {
      if (hovered || focused || timer !== null) return;
      startedAt = Date.now();
      timer = setTimeout(dismiss, remaining);
    };
    const pause = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
    const hold = (isHover, on) => {
      if (isHover) hovered = on;
      else focused = on;
      if (hovered || focused) pause();
      else resume();
    };
    toast.addEventListener('mouseenter', () => hold(true, true));
    toast.addEventListener('mouseleave', () => hold(true, false));
    toast.addEventListener('focusin', () => hold(false, true));
    toast.addEventListener('focusout', () => hold(false, false));
    close.addEventListener('click', dismiss);
    resume();
    toast.append(text, close);

    this.#region.append(toast);
    while (this.#region.children.length > Toast.#MAX_VISIBLE) this.#region.firstElementChild.remove();
  }
}
