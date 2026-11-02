const MAX = 140;

// A compact token diff of two raw lines, for the Edited marker's tooltip.
// `key:value` tokens whose value changed read as "due 2026-11-05 → 2026-11-12".
export class LineDiff {
  static summary(oldRaw, newRaw) {
    const removed = LineDiff.#minus(LineDiff.#tokens(oldRaw), LineDiff.#tokens(newRaw));
    const added = LineDiff.#minus(LineDiff.#tokens(newRaw), LineDiff.#tokens(oldRaw));
    const parts = [];
    for (const old of [...removed]) {
      const key = LineDiff.#key(old);
      const at = key === null ? -1 : added.findIndex((t) => LineDiff.#key(t) === key);
      if (at === -1) continue;
      parts.push(`${key} ${old.slice(key.length + 1)} → ${added[at].slice(key.length + 1)}`);
      removed.splice(removed.indexOf(old), 1);
      added.splice(at, 1);
    }
    for (const t of removed) parts.push(`removed ${t}`);
    for (const t of added) parts.push(`added ${t}`);
    const text = parts.join('; ');
    if (text === '') return 'Edited';
    return `Edited: ${text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text}`;
  }

  static #tokens(raw) {
    return raw.split(/\s+/).filter((t) => t !== '');
  }

  // Multiset difference: tokens of `a` not matched by a token of `b`.
  static #minus(a, b) {
    const rest = [...b];
    return a.filter((t) => {
      const at = rest.indexOf(t);
      if (at === -1) return true;
      rest.splice(at, 1);
      return false;
    });
  }

  static #key(token) {
    const m = /^([A-Za-z][\w-]*):\S/.exec(token);
    return m ? m[1] : null;
  }
}
