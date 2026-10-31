import { Task } from './Task.js';

const DATE = /^\d{4}-\d{2}-\d{2}(?= |$)/;
const PRIORITY = /^\(([A-Z])\) /;
const TAG = /^([A-Za-z0-9_-]+):(\S+)$/;

export class TaskParser {
  // Returns a Task, or null for blank lines. `raw` keeps the line as given.
  static parse(line, { file, lineNumber }) {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (text.trim() === '') return null;

    const markers = text.startsWith('x ')
      ? TaskParser.#completeMarkers(text)
      : TaskParser.#activeMarkers(text);
    const body = text.slice(markers.end);

    return new Task({
      raw: line,
      file,
      lineNumber,
      complete: markers.complete,
      completionDate: markers.completionDate,
      creationDate: markers.creationDate,
      priority: markers.priority,
      body,
      ...TaskParser.#tokens(body),
    });
  }

  // `x DATE [CREATION ][(P) ]body`. A missing date still counts as complete.
  static #completeMarkers(text) {
    const m = { complete: true, completionDate: null, creationDate: null, priority: null, end: 2 };
    m.completionDate = TaskParser.#take(text, m, DATE);
    if (m.completionDate) m.creationDate = TaskParser.#take(text, m, DATE);
    m.priority = TaskParser.#takePriority(text, m);
    return m;
  }

  // `[(P) ][CREATION ]body`
  static #activeMarkers(text) {
    const m = { complete: false, completionDate: null, creationDate: null, priority: null, end: 0 };
    m.priority = TaskParser.#takePriority(text, m);
    m.creationDate = TaskParser.#take(text, m, DATE);
    return m;
  }

  // Consumes a date and its single following space, advancing m.end.
  static #take(text, m, pattern) {
    const hit = pattern.exec(text.slice(m.end));
    if (!hit) return null;
    m.end += hit[0].length;
    if (text[m.end] === ' ') m.end += 1;
    return hit[0];
  }

  static #takePriority(text, m) {
    const hit = PRIORITY.exec(text.slice(m.end));
    if (!hit) return null;
    m.end += hit[0].length;
    return hit[1];
  }

  static #tokens(body) {
    const projects = [];
    const contexts = [];
    const tags = {};
    const duplicateKeys = [];

    for (const word of body.split(/\s+/)) {
      if (word.length > 1 && word[0] === '+') projects.push(word.slice(1));
      else if (word.length > 1 && word[0] === '@') contexts.push(word.slice(1));
      else TaskParser.#addTag(word, tags, duplicateKeys);
    }
    return { projects, contexts, tags, duplicateKeys };
  }

  static #addTag(word, tags, duplicateKeys) {
    const m = TAG.exec(word);
    if (!m || m[2].startsWith('/')) return;
    const [, key, value] = m;
    if (!Object.hasOwn(tags, key)) tags[key] = value;
    else if (!duplicateKeys.includes(key)) duplicateKeys.push(key);
  }
}
