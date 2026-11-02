// Subscribes to the server's event stream. The browser reconnects on its own and the
// server sends `hello` on every connect, so a missed change shows up as a new version.
export class LiveSync {
  #source;

  constructor({ url = '/api/events', onVersion, onStatus }) {
    this.#source = new EventSource(url);
    this.#source.addEventListener('open', () => onStatus('live'));
    this.#source.addEventListener('error', () => onStatus('reconnecting'));
    for (const type of ['hello', 'changed']) {
      this.#source.addEventListener(type, (event) => {
        let version;
        try {
          version = JSON.parse(event.data).version;
        } catch {
          return; // malformed event: ignore
        }
        if (typeof version === 'string') onVersion(version);
      });
    }
  }

  close() {
    this.#source.close();
  }
}
