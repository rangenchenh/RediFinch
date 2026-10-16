import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from './logger';

const log = createLogger('server');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StaticServer {
  origin: string;
  close(): Promise<void>;
}

/**
 * Serve the exported Next.js `out/` directory over loopback HTTP.
 *
 * Why not `file://`? The app router's client-side navigation, `fetch`ed JSON
 * and the AudioWorklet `addModule()` call all assume an http origin. Loading
 * from disk breaks them in ways that are tedious to patch individually.
 *
 * Binding to 127.0.0.1 with a port of 0 means the OS picks a free port and
 * nothing is reachable from off-machine.
 */
export async function startStaticServer(root: string): Promise<StaticServer> {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const file = resolveFile(root, decodeURIComponent(url.pathname));
      if (!file) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const body = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        // The renderer only ever talks to this origin; deny framing outright.
        'x-content-type-options': 'nosniff',
      });
      res.end(body);
    } catch (err) {
      log.error('static request failed:', err);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('static server has no port');
  const origin = `http://127.0.0.1:${addr.port}`;
  log.info(`serving ${root} at ${origin}`);

  return {
    origin,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * Map a URL path to a file inside `root`, refusing anything that escapes it.
 * `trailingSlash: true` in next.config means every route is a directory with an
 * `index.html`.
 */
function resolveFile(root: string, pathname: string): string | null {
  const clean = pathname.replace(/^\/+/, '');
  const candidates = [
    path.join(root, clean),
    path.join(root, clean, 'index.html'),
    path.join(root, `${clean}.html`),
  ];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    // Containment check: `path.relative` yields a `..` prefix when escaping.
    const rel = path.relative(path.resolve(root), resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    try {
      if (fs.statSync(resolved).isFile()) return resolved;
    } catch {
      /* try next */
    }
  }
  return null;
}
