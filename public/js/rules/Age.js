const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86400000;

// PRD §5.1. Age badge text from a creation date and today (both YYYY-MM-DD). Pure:
// nothing here reads the clock. Under 30 days shows days; after that whole calendar months,
// then whole years from 12 months. A month-end start counts its anniversary on the last day of a
// shorter month (31 Jan to 28 Feb is a full month, 29 Feb 2024 to 28 Feb 2025 a full year).
export class Age {
  // Returns "12D", "5M", "2Y", or null for an unreadable date or one after today.
  static label(creationDate, today) {
    const start = Age.#parse(creationDate);
    const end = Age.#parse(today);
    if (!start || !end) return null;
    const days = Math.round((Date.UTC(...end) - Date.UTC(...start)) / MS_PER_DAY);
    if (days < 0) return null;
    if (days < 30) return `${days}D`;
    const months = Math.max(1, Age.#wholeMonths(start, end));
    return months < 12 ? `${months}M` : `${Math.floor(months / 12)}Y`;
  }

  static #wholeMonths([y1, m1, d1], [y2, m2, d2]) {
    const months = (y2 - y1) * 12 + (m2 - m1);
    const anniversary = Math.min(d1, new Date(Date.UTC(y2, m2 + 1, 0)).getUTCDate());
    return d2 >= anniversary ? months : months - 1;
  }

  // [year, monthIndex, day], or null when not a real YYYY-MM-DD date.
  static #parse(text) {
    const m = typeof text === 'string' ? DATE.exec(text) : null;
    if (!m) return null;
    const [year, month, day] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    const check = new Date(Date.UTC(year, month, day));
    const real = check.getUTCFullYear() === year && check.getUTCMonth() === month && check.getUTCDate() === day;
    return real ? [year, month, day] : null;
  }
}
