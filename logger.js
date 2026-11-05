// One line per event on stdout: `<ISO time> <level> <event> key=value ...`. Callers pass counts,
// versions and line numbers, never task text, because the data files hold personal tasks.
const LEVELS = { debug: 0, info: 1, error: 2 };

export class Logger {
  #threshold;
  #write;
  #now;

  // An unknown level falls back to info, so a typo in LOG_LEVEL never silences the server.
  constructor({ level = 'info', write = (line) => process.stdout.write(`${line}\n`), now = () => new Date() } = {}) {
    this.#threshold = LEVELS[level] ?? LEVELS.info;
    this.#write = write;
    this.#now = now;
  }

  debug(event, fields) {
    this.#log('debug', event, fields);
  }

  info(event, fields) {
    this.#log('info', event, fields);
  }

  error(event, fields) {
    this.#log('error', event, fields);
  }

  #log(level, event, fields = {}) {
    if (LEVELS[level] < this.#threshold) return;
    const pairs = Object.entries(fields).map(([key, value]) => `${key}=${Logger.#format(value)}`);
    this.#write([this.#now().toISOString(), level, event, ...pairs].join(' '));
  }

  // Quote anything with spaces, quotes or control characters so a value never breaks the one-line shape.
  static #format(value) {
    const text = String(value);
    return /^[\w.:/@%+-]+$/.test(text) ? text : JSON.stringify(text);
  }
}

// Non-empty lines in a data file: the count that is safe to log in place of its content.
export function countLines(text) {
  return text.split('\n').filter((line) => line.trim() !== '').length;
}
