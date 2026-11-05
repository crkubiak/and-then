import http from 'node:http';
import { watch as fsWatch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Logger, countLines } from './logger.js';

const ROOT = import.meta.dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', // browsers reject module scripts with other types
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const MAX_BODY = 5 * 1024 * 1024; // 5 MB cap on PUT bodies
const FILES = ['todo.txt', 'done.txt']; // the only files the API ever touches
const DEBOUNCE_MS = 100; // collapse a burst of fs events into one check
const HEARTBEAT_MS = 25000; // SSE comment to keep idle connections open through proxies

// An error that maps straight to an HTTP status.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class Server {
  constructor({ port = 3000, dataDir = path.join(ROOT, 'data'), logger = new Logger() } = {}) {
    this.logger = logger;
    this.port = port;
    this.dataDir = dataDir;
    this.putQueue = Promise.resolve(); // serializes PUTs so the version check and write are atomic
    this.publicDir = path.join(ROOT, 'public');
    this.lastVersion = null; // hash of the files as last announced or written by this server
    this.onChange = new Set(); // callbacks invoked with { version } on external changes
    this.watcher = null;
    this.debounceTimer = null;
    this.retried = false;
    this.clients = new Set(); // open SSE responses
    this.heartbeat = null;
    this.http = http.createServer((req, res) => this.handle(req, res));
  }

  async start() {
    await this.ensureFiles();
    this.lastVersion = (await this.readFiles()).version;
    this.watch();
    this.http.listen(this.port, '127.0.0.1', () => {
      this.logger.info('listening', { url: `http://127.0.0.1:${this.port}`, data: this.dataDir });
    });
  }

  // Create the data dir and empty files if missing. Never truncates: 'a' only creates.
  async ensureFiles() {
    await fs.mkdir(this.dataDir, { recursive: true });
    for (const name of FILES) {
      await (await fs.open(path.join(this.dataDir, name), 'a')).close();
    }
  }

  // Watch the directory, not the files: atomic replaces (write temp, rename) break file watches.
  watch() {
    try {
      this.watcher = fsWatch(this.dataDir, (_event, filename) => {
        if (filename == null || FILES.includes(String(filename))) this.schedule();
      });
      this.watcher.on('error', (err) => this.logger.error('watcher-error', errorFields(err)));
    } catch (err) {
      this.logger.error('watcher-failed', errorFields(err));
    }
  }

  schedule() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.check(), DEBOUNCE_MS);
  }

  // Notify only when content differs from what this server last announced or wrote.
  async check() {
    let current;
    try {
      current = await this.readFiles();
      this.retried = false;
    } catch (err) {
      // A file may be briefly missing mid-replace: retry once on the next debounce.
      if (!this.retried) {
        this.retried = true;
        this.schedule();
      } else {
        this.retried = false;
        this.logger.error('watch-read-failed', errorFields(err));
      }
      return;
    }
    const { version } = current;
    if (version === this.lastVersion) return;
    this.lastVersion = version;
    this.logger.info('external-change', {
      version: shortVersion(version),
      todoLines: countLines(current.todo),
      doneLines: countLines(current.done),
    });
    for (const fn of this.onChange) fn({ version });
  }

  // One request line when the response closes, so an SSE stream is logged with its full duration.
  // The query string is left out. Static files log at debug so page loads do not bury the API lines.
  logRequest(req, res, startedAt) {
    res.on('close', () => {
      const pathname = req.url.split(/[?#]/)[0];
      const fields = { method: req.method, path: pathname, status: res.statusCode, ms: Math.round(performance.now() - startedAt) };
      if (res.statusCode >= 500) this.logger.error('request', fields);
      else if (pathnameIsApi(req.url)) this.logger.info('request', fields);
      else this.logger.debug('request', fields);
    });
  }

  async handle(req, res) {
    this.logRequest(req, res, performance.now());
    try {
      const pathname = req.url.split(/[?#]/)[0];
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        await this.handleApi(req, res, pathname);
      } else {
        await this.serveStatic(req, res);
      }
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (pathnameIsApi(req.url) && err instanceof HttpError) {
        return this.sendJson(res, err.status, { error: err.message });
      }
      this.logger.error('unhandled-error', errorFields(err));
      if (pathnameIsApi(req.url)) return this.sendJson(res, 500, { error: 'Internal Server Error' });
      this.send(res, 500, 'Internal Server Error');
    }
  }

  async handleApi(req, res, pathname) {
    // Reject foreign Host headers to block DNS rebinding from other sites.
    const allowedHosts = [`127.0.0.1:${this.port}`, `localhost:${this.port}`];
    if (!allowedHosts.includes(req.headers.host)) throw new HttpError(403, 'Forbidden host');
    if (pathname === '/api/events') return this.handleEvents(req, res);
    if (pathname !== '/api/files') throw new HttpError(404, 'Not Found');
    // GET leaves lastVersion alone so an external edit is still announced to other tabs.
    if (req.method === 'GET') return this.sendJson(res, 200, await this.readFiles());
    if (req.method === 'PUT') return this.putFiles(req, res);
    res.setHeader('Allow', 'GET, PUT');
    throw new HttpError(405, 'Method Not Allowed');
  }

  // Server-Sent Events stream: pushes `changed` when the files change outside this server.
  async handleEvents(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new HttpError(405, 'Method Not Allowed');
    }
    const { version } = await this.readFiles();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({ version })}\n\n`);
    this.clients.add(res);
    this.startHeartbeat();
    this.logger.info('sse-connect', { clients: this.clients.size });
    res.on('close', () => {
      this.clients.delete(res);
      this.logger.info('sse-disconnect', { clients: this.clients.size });
      if (this.clients.size === 0) this.stopHeartbeat();
    });
    res.on('error', () => {}); // a dead socket is cleaned up by 'close'
  }

  // Write to every client; a failure on one never affects the rest.
  broadcast(text) {
    for (const res of this.clients) {
      try {
        res.write(text);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  startHeartbeat() {
    this.heartbeat ??= setInterval(() => this.broadcast(': ping\n\n'), HEARTBEAT_MS);
  }

  stopHeartbeat() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  // Paths are built only from the fixed FILES names, never from the request.
  async readFiles() {
    const [todo, done] = await Promise.all(
      FILES.map((name) => fs.readFile(path.join(this.dataDir, name), 'utf8')),
    );
    return { todo, done, version: this.hash(todo, done) };
  }

  // Hash with a \0 separator so (a, bc) and (ab, c) differ.
  hash(todo, done) {
    return crypto.createHash('sha256').update(todo).update('\0').update(done).digest('hex');
  }

  async putFiles(req, res) {
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json');
    const body = this.parseBody(await this.readBody(req, res));

    // Chain onto the queue so concurrent PUTs run one at a time.
    const run = this.putQueue.then(() => this.applyPut(body));
    this.putQueue = run.catch(() => {});
    const { status, payload } = await run;
    this.sendJson(res, status, payload);
    // Tell every tab, after the saving tab has its response. The saving tab already holds this
    // version and ignores the event; the other tabs reload. The watcher stays quiet for our own
    // writes (lastVersion), so without this broadcast no other tab would ever hear about a save.
    if (status === 200) this.broadcast(`event: changed\ndata: ${JSON.stringify({ version: payload.version })}\n\n`);
  }

  async applyPut({ todo, done, version }) {
    const current = await this.readFiles();
    if (version !== current.version) {
      this.logger.info('conflict', { sent: shortVersion(version), current: shortVersion(current.version) });
      return { status: 409, payload: current };
    }
    // done.txt first: a failure in between duplicates lines rather than losing them.
    await this.writeAtomic('done.txt', done);
    await this.writeAtomic('todo.txt', todo);
    const next = this.hash(todo, done);
    this.lastVersion = next; // the watcher's check will see this and stay quiet; putFiles broadcasts instead
    this.logger.info('save', { version: shortVersion(next), todoLines: countLines(todo), doneLines: countLines(done) });
    return { status: 200, payload: { version: next } };
  }

  async writeAtomic(name, content) {
    const target = path.join(this.dataDir, name);
    const tmp = path.join(this.dataDir, `.${name}.${process.pid}.tmp`);
    try {
      await fs.writeFile(tmp, content, 'utf8');
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  async readBody(req, res) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.setHeader('Connection', 'close'); // the rest of the body is never read
        throw new HttpError(413, 'Payload Too Large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  parseBody(text) {
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'Body must be valid JSON');
    }
    for (const key of ['todo', 'done', 'version']) {
      if (typeof body?.[key] !== 'string') throw new HttpError(400, `"${key}" must be a string`);
    }
    return body;
  }

  sendJson(res, status, payload) {
    const text = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
    });
    res.end(text);
  }

  async serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return this.send(res, 405, 'Method Not Allowed');
    }

    let pathname;
    try {
      // Decode manually: URL parsing would silently normalize %2e%2e away.
      pathname = decodeURIComponent(req.url.split(/[?#]/)[0]);
    } catch {
      return this.send(res, 400, 'Bad Request');
    }
    if (pathname.includes('\0')) return this.send(res, 400, 'Bad Request');
    if (pathname.endsWith('/')) pathname += 'index.html';

    const file = path.resolve(this.publicDir, '.' + pathname);
    if (!file.startsWith(this.publicDir + path.sep)) {
      return this.send(res, 403, 'Forbidden');
    }

    let body;
    try {
      body = await fs.readFile(file);
    } catch {
      return this.send(res, 404, 'Not Found');
    }
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  send(res, status, text) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  }
}

// The first 8 hex characters identify a version well enough to follow it across log lines.
function shortVersion(version) {
  return version.slice(0, 8);
}

// Error name, code and message only. Never the stack or the error object, which can carry file content.
function errorFields(err) {
  return { name: err?.name ?? 'Error', code: err?.code ?? '', message: err?.message ?? String(err) };
}

function pathnameIsApi(url) {
  const p = url.split(/[?#]/)[0];
  return p === '/api' || p.startsWith('/api/');
}

const [, , dataDirArg] = process.argv;
const server = new Server({
  port: Number(process.env.PORT) || 3000,
  logger: new Logger({ level: process.env.LOG_LEVEL }),
  dataDir: dataDirArg ? path.resolve(dataDirArg) : path.join(ROOT, 'data'), // explicit folder is relative to the cwd
});
server.onChange.add(({ version }) => {
  server.broadcast(`event: changed\ndata: ${JSON.stringify({ version })}\n\n`);
});
server.start();
