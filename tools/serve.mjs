// Minimal, concurrency-safe static file server for local dev / verification.
// The Veritix app is static — this just serves the repo root so a browser
// (or the Playwright harness in verify.mjs) can load it over http://.
//
//   node tools/serve.mjs [port]
//
// Why not `python -m http.server`? On Windows + OneDrive it intermittently
// resets concurrent script requests, which made deferred <script> loads fail
// mid-boot. Node's async I/O serves the parallel script fetches reliably.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
export const APP = 'veritix-ndt-inspect-v3_44.html';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

// Start the server; resolves with { server, port, url } once listening.
export function startServer(port = 8000) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent((req.url || '/').split('?')[0]);
      if (rel === '/' || rel === '') rel = '/' + APP;
      const fp = path.normalize(path.join(ROOT, rel));
      if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(fp, (err, buf) => {
        if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + rel); return; }
        res.writeHead(200, { 'content-type': TYPES[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, port, url: `http://127.0.0.1:${port}/${APP}` }));
  });
}

// Run directly: `node tools/serve.mjs [port]`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8000;
  startServer(port).then(({ url }) => console.log('Veritix dev server: ' + url));
}
