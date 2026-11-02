// Client for the /api/files endpoint. Tracks the server's version so saves
// can be rejected when another writer (an agent) changed the files.
export class FileStore {
  #baseUrl;
  #version = null;

  constructor({ baseUrl = '' } = {}) {
    this.#baseUrl = baseUrl;
  }

  get version() {
    return this.#version;
  }

  async load() {
    const res = await fetch(`${this.#baseUrl}/api/files`);
    if (!res.ok) throw await this.#errorFrom(res);
    const { todo, done, version } = await res.json();
    this.#version = version;
    return { todo, done };
  }

  async save({ todo, done }) {
    const res = await fetch(`${this.#baseUrl}/api/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todo, done, version: this.#version }),
    });
    if (res.status === 200) {
      this.#version = (await res.json()).version;
      return { ok: true };
    }
    if (res.status === 409) {
      const current = await res.json();
      this.#version = current.version;
      return { ok: false, conflict: true, current: { todo: current.todo, done: current.done } };
    }
    throw await this.#errorFrom(res);
  }

  async #errorFrom(res) {
    let message = res.statusText;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      // Non-JSON body: keep the status text.
    }
    const err = new Error(message || `HTTP ${res.status}`);
    err.status = res.status;
    return err;
  }
}
