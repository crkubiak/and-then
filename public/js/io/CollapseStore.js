const STORAGE_KEY = 'taskflow.rowCollapse';

// The expand or collapse choices the user made on parent rows, kept per browser so a reload keeps
// them: task key (TaskRow.keyOf) to true (collapsed) or false (expanded). A row with no entry has no
// choice yet and falls back to the default in CollapseRules. Best effort: when localStorage is blocked
// or full, the in-memory map still serves the session.
export class CollapseStore {
  #choices; // Map of task key to collapsed (boolean)

  constructor() {
    this.#choices = CollapseStore.#read();
  }

  // true (the user collapsed it), false (the user expanded it), or undefined (no choice yet).
  choiceFor(key) {
    return this.#choices.get(key);
  }

  record(collapsedByKey) {
    let changed = false;
    for (const [key, collapsed] of collapsedByKey) {
      if (this.#choices.get(key) !== collapsed) {
        this.#choices.set(key, collapsed);
        changed = true;
      }
    }
    if (changed) this.#write();
  }

  // Forget choices for tasks that no longer exist, so the stored map does not grow without bound.
  prune(existingKeys) {
    let pruned = false;
    for (const key of [...this.#choices.keys()]) {
      if (!existingKeys.has(key)) {
        this.#choices.delete(key);
        pruned = true;
      }
    }
    if (pruned) this.#write();
  }

  static #read() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
      return new Map(Object.entries(parsed).filter(([, collapsed]) => typeof collapsed === 'boolean'));
    } catch {
      return new Map(); // missing, junk or blocked: no saved choices
    }
  }

  #write() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.#choices)));
    } catch {
      // Blocked or full: the session still keeps the choices in memory.
    }
  }
}
