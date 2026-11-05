import { TaskList } from '../public/js/model/TaskList.js';
import { Operations, ToolError } from './operations.js';

const MAX_ATTEMPTS = 5; // read, edit, save; a 409 means someone saved first, so go again on their version

// Talks to the running TaskFlow server over HTTP, so every write gets the server's version check,
// atomic file writes and `changed` broadcast. The MCP server never touches the data files itself.
export class TaskflowClient {
  #baseUrl;
  #fetch;

  constructor({ baseUrl = 'http://127.0.0.1:3000', fetchImpl = fetch } = {}) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#fetch = fetchImpl;
  }

  async read() {
    const body = await this.#request('GET');
    return { taskList: new TaskList({ todo: body.todo, done: body.done }), version: body.version };
  }

  // Runs `edit(taskList)` against the current files and saves the result. After a 409 the edit runs
  // again on the files that won, so an id or line that moved is found again and a task that
  // disappeared is reported. Returns whatever `edit` returned as its result.
  async update(edit) {
    let { taskList, version } = await this.read();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { list, result } = edit(taskList);
      if (list === taskList) return result; // nothing to change, nothing to save
      TaskflowClient.#refuseNewProblems(taskList, list);
      const text = list.toText();
      const saved = await this.#request('PUT', { todo: text.todo, done: text.done, version });
      if (saved.status === 200) return result;
      taskList = new TaskList({ todo: saved.body.todo, done: saved.body.done });
      version = saved.body.version;
    }
    throw new ToolError('The files kept changing under this edit. Try again.');
  }

  // A write must not leave the files worse than it found them (FORMAT.md golden rule).
  static #refuseNewProblems(before, after) {
    const key = (p) => `${p.code}|${p.file}|${p.line}`;
    const existing = new Set(Operations.validate(before).map(key));
    const introduced = Operations.validate(after).filter((p) => !existing.has(key(p)));
    if (introduced.length > 0) {
      throw new ToolError(`Not saved. It would add: ${introduced.map((p) => `${p.code} (${p.message})`).join('; ')}.`);
    }
  }

  // GET returns the body. PUT returns { status, body } for 200 and 409 and throws on anything else.
  async #request(method, payload) {
    let res;
    try {
      res = await this.#fetch(`${this.#baseUrl}/api/files`, {
        method,
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      });
    } catch {
      throw new ToolError(`Cannot reach TaskFlow at ${this.#baseUrl}. Start the app (node server.js) or set TASKFLOW_URL.`);
    }
    if (method === 'PUT' && (res.status === 200 || res.status === 409)) return { status: res.status, body: await res.json() };
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = (await res.json()).error ?? message;
      } catch {
        // Not JSON: keep the status text.
      }
      throw new ToolError(`TaskFlow answered ${res.status}: ${message}`);
    }
    return res.json();
  }
}
