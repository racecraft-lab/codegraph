/**
 * SPEC-005 static mount + route fallback (FR-017/FR-017a/FR-017b/FR-018).
 *
 * Serves assets from `dist/web/` when present (absent for all of SPEC-005's
 * life), confining every resolved path within the web root via the repo's
 * `validatePathWithinRoot` chokepoint (FR-017b). While the web dir is absent,
 * `/` and every extensionless browser route return a byte-identical, data-free
 * placeholder page (FR-017/FR-017a); `/api/*` and missing asset-extension paths
 * never fall back (FR-018).
 *
 * @module server/static
 */

import * as fs from 'fs';
import * as path from 'path';
import { notFound } from './errors';
import { validatePathWithinRoot } from '../utils';

/** A static/placeholder response descriptor. */
export interface StaticResult {
  status: number;
  headers?: Record<string, string>;
  body: string | Buffer;
}

/**
 * Minimal MIME map for the kinds of assets a web build ships. Anything unlisted
 * is served as an opaque octet-stream — the mount never guesses a text type it
 * cannot vouch for.
 */
const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** `text/html` for the app shell and placeholder page. */
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const SPA_EXACT_ROUTES = new Set(['/', '/search', '/reindex', '/chat']);
const SPA_PREFIX_ROUTES = ['/symbol/', '/graph/', '/impact/'];

function contentType(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}

function isSpaRoute(rawPath: string): boolean {
  const normalized = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  if (SPA_EXACT_ROUTES.has(normalized)) return true;
  return SPA_PREFIX_ROUTES.some((prefix) => {
    if (!normalized.startsWith(prefix)) return false;
    const encodedParam = normalized.slice(prefix.length);
    return encodedParam.length > 0 && !encodedParam.includes('/');
  });
}

/**
 * A 404 route miss carrying the standard `not_found`/`route` envelope — the
 * SAME shape any other unmatched path returns, so an escape attempt is
 * indistinguishable from a plain miss (FR-017b/FR-018): never a 403, never the
 * escaping file's contents, no enumeration signal.
 */
function routeMiss(): StaticResult {
  return {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(notFound('route').body),
  };
}

/**
 * The data-free placeholder page pointing at `/api/status` (FR-017/FR-017a).
 *
 * Byte-identical on every call and independent of any repo context — it sits
 * outside the `/api/*` auth boundary (FR-014) and is reachable without a token,
 * so it MUST NOT embed a repo id, root path, name, or the repo list (FR-017a).
 */
export function placeholderPage(): string {
  return PLACEHOLDER_HTML;
}

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CodeGraph</title>
</head>
<body>
<main>
<h1>CodeGraph</h1>
<p>The local CodeGraph API is running. The web interface has not been built yet.</p>
<p>Check server status at <a href="/api/status">/api/status</a>.</p>
</main>
</body>
</html>
`;

/**
 * Resolve a non-`/api` request against the static mount and fallback rules
 * (FR-017/FR-017b/FR-018). Called by the request dispatch for every path the
 * router did not claim.
 *
 * Order matters — containment is enforced BEFORE any present/absent or
 * extension branching, so a traversal attempt 404s identically in both web-root
 * states and never reads an out-of-root file (FR-017b):
 *
 *  1. Decode the request path EXACTLY ONCE (bounded against multiply-encoded
 *     input): a decode-to-fixed-point would collapse `%252e` → `.` and re-open
 *     the very traversal this guards. A malformed encoding or a decoded NUL byte
 *     is an unmatched path → 404.
 *  2. Route the joined path through the repo's content-serving chokepoint
 *     `validatePathWithinRoot` (the #527 lexical-then-symlink-aware guard). Null
 *     (any `..`/absolute/encoded-separator escape) → 404 route miss.
 *  3. Asset-extension path → serve the exact file, else 404 (never a shell
 *     fallback — FR-018). Extensionless browser route (incl. `/`) → the app
 *     shell: `index.html` when the web build is present, else the placeholder.
 */
export function serveStatic(rawPath: string, webRoot: string): StaticResult {
  // (1) Decode ONCE. Never loop to a fixed point (FR-017b).
  const spaRoute = isSpaRoute(rawPath);
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return routeMiss(); // malformed percent-encoding → unmatched
  }
  // A decoded NUL can truncate a path in a downstream syscall — reject outright.
  if (decoded.includes('\0')) return routeMiss();

  // (2) Map onto the web root (request paths are root-relative — strip the
  //     leading slash so `path.resolve` keeps them inside the root) and confine
  //     through the established chokepoint. Any escape → null → route miss.
  const relative = decoded.replace(/^\/+/, '');
  const resolved = validatePathWithinRoot(webRoot, relative);
  if (resolved === null) return routeMiss();

  const ext = path.extname(relative);
  // Resolve the app shell through the SAME symlink-aware chokepoint asset reads
  // use (FR-017b): a null (an `index.html` symlink whose real target escapes the
  // web root) makes the build "absent" so it never serves the out-of-root file.
  const shellPath = validatePathWithinRoot(webRoot, 'index.html');
  const present = shellPath !== null && fs.existsSync(shellPath);

  // (3a) Asset-extension path: serve the exact file, else 404 — NEVER the shell
  //      (FR-018). Known SPA route prefixes are checked against the raw route
  //      shape first because opaque symbol ids can contain encoded slashes and
  //      file-like suffixes such as `src/index.ts`.
  if (ext !== '' && !spaRoute) {
    if (!present) return routeMiss();
    try {
      const body = fs.readFileSync(resolved);
      return { status: 200, headers: { 'Content-Type': contentType(ext) }, body };
    } catch {
      return routeMiss(); // missing / unreadable / a directory → unmatched
    }
  }

  // (3b) Extensionless browser route (incl. `/`): fall back to the app shell —
  //      `index.html` when present, else the data-free placeholder
  //      (FR-017/FR-017a/FR-018).
  if (present) {
    try {
      const body = fs.readFileSync(shellPath!);
      return { status: 200, headers: { 'Content-Type': HTML_CONTENT_TYPE }, body };
    } catch {
      // index.html vanished between the existence check and the read — degrade
      // to the placeholder rather than 500 on a benign race.
    }
  }
  return { status: 200, headers: { 'Content-Type': HTML_CONTENT_TYPE }, body: placeholderPage() };
}
