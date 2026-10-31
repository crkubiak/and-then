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

  get primaryProject() {
    return this.projects[0] ?? null;
  }

  #tag(key) {
    return Object.hasOwn(this.tags, key) ? this.tags[key] : null;
  }
}
