// Plain data for one parsed todo.txt line. Parsing lives in TaskParser.
export class Task {
  constructor({
    raw,
    file,
    lineNumber,
    complete = false,
    completionDate = null,
    creationDate = null,
    priority = null,
    body = '',
    projects = [],
    contexts = [],
    tags = {},
    duplicateKeys = [],
  }) {
    this.raw = raw;
    this.file = file;
    this.lineNumber = lineNumber;
    this.complete = complete;
    this.completionDate = completionDate;
    this.creationDate = creationDate;
    this.priority = priority;
    this.body = body;
    this.projects = projects;
    this.contexts = contexts;
    this.tags = tags;
    this.duplicateKeys = duplicateKeys;
  }

  get id() {
    return this.#tag('id');
  }

  get parentId() {
    return this.#tag('parent');
  }

  get depId() {
    return this.#tag('dep');
  }

  get due() {
    return this.#tag('due');
  }

  // The body without +project, @context and key:value tags. Empty means the line has no words to show.
  get description() {
    return this.body
      .split(/\s+/)
      .filter((word) => word !== '')
      .filter((word) => !(word.length > 1 && (word[0] === '+' || word[0] === '@')))
      .filter((word) => !(word.includes(':') && Object.hasOwn(this.tags, word.slice(0, word.indexOf(':')))))
      .join(' ');
  }

  get primaryProject() {
    return this.projects[0] ?? null;
  }

  #tag(key) {
    return Object.hasOwn(this.tags, key) ? this.tags[key] : null;
  }
}
