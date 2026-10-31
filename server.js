import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

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

class Server {
  constructor({ port = 3000, dataDir = path.join(ROOT, 'data') } = {}) {
    this.port = port;
    this.dataDir = dataDir; // used by the /api routes in Phase 2
    this.publicDir = path.join(ROOT, 'public');
    this.http = http.createServer((req, res) => this.handle(req, res));
  }

  start() {
    this.http.listen(this.port, '127.0.0.1', () => {
      console.log(`Listening on http://127.0.0.1:${this.port}`);
    });
  }

  // Phase 2: dispatch /api/... here before falling through to static files.
  async handle(req, res) {
    try {
      await this.serveStatic(req, res);
    } catch (err) {
      console.error(err);
      this.send(res, 500, 'Internal Server Error');
    }
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

const [, , dataDirArg] = process.argv;
new Server({
  port: Number(process.env.PORT) || 3000,
  dataDir: path.resolve(ROOT, dataDirArg ?? 'data'),
}).start();
