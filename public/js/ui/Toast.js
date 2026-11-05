// Transient top-center messages. The region lives outside App's #root so
// re-renders never remove it.
export class Toast {
  static #INFO_MS = 4000;
  static #ERROR_MS = 8000;
  static #MAX_VISIBLE = 5;

  #region;
  #live = new Map(); // "kind\nmessage" to { toast, repeat } for the toast showing it

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
    const type = kind === 'error' ? 'error' : 'info';
    // The same message and kind as a toast still on screen: count it, do not stack another.
    const id = `${type}\n${message}`;
    const showing = this.#live.get(id);
    if (showing?.toast.isConnected) {
      showing.repeat();
      return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
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
    const duration = type === 'error' ? Toast.#ERROR_MS : Toast.#INFO_MS;
    let remaining = duration;
    let timer = null;
    let startedAt = 0;
    let hovered = false;
    let focused = false;
    const dismiss = () => {
      clearTimeout(timer);
      toast.remove();
      if (this.#live.get(id)?.toast === toast) this.#live.delete(id);
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
    // A repeat shows a count and restarts the full timer. While the pointer or focus is on the
    // toast the timer stays paused, and the full time starts when it leaves.
    let count = 1;
    let badge = null;
    const repeat = () => {
      count += 1;
      if (badge === null) {
        badge = document.createElement('span');
        badge.className = 'toast-count';
        text.after(badge);
      }
      badge.textContent = `×${count}`;
      badge.title = `Shown ${count} times`;
      clearTimeout(timer);
      timer = null;
      remaining = duration;
      resume();
    };
    this.#live.set(id, { toast, repeat });
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
