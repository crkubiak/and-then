const STORAGE_KEY = 'taskflow.seen';

// Which todo.txt tasks the user has seen: task key (TaskRow.keyOf) to the raw line last seen.
// Persisted in localStorage per origin, best effort; the in-memory map is what the page uses,
// so a blocked or full store only costs persistence across reloads.
export class SeenStore {
  #seen; // Map, or null until the first baseline

  constructor() {
    this.#seen = SeenStore.#read();
  }

  // `entries` is a Map of key to raw for every todo.txt task now. The first ever call records
  // them all (nothing is new). Later calls drop keys that no longer exist.
  sync(entries) {
    if (this.#seen === null) {
      this.#seen = new Map(entries);
      this.#write();
      return;
    }
    let pruned = false;
    for (const key of [...this.#seen.keys()]) {
      if (!entries.has(key)) {
        this.#seen.delete(key);
        pruned = true;
      }
    }
    if (pruned) this.#write();
  }

  isNew(key) {
    return this.#seen !== null && !this.#seen.has(key);
  }

  // The raw line last seen for `key`, or undefined.
  raw(key) {
    return this.#seen?.get(key);
  }

  // `entries` is a Map of key to raw. Records them as seen.
  mark(entries) {
    if (this.#seen === null) return;
    let changed = false;
    for (const [key, raw] of entries) {
      if (this.#seen.get(key) !== raw) {
        this.#seen.set(key, raw);
        changed = true;
      }
    }
    if (changed) this.#write();
  }

  static #read() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return new Map(Object.entries(parsed).filter(([, raw]) => typeof raw === 'string'));
    } catch {
      return null; // missing, junk or blocked: start over with a fresh baseline
    }
  }

  #write() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.#seen)));
    } catch {
      // Blocked or full: the session still tracks what was seen.
    }
  }
}
