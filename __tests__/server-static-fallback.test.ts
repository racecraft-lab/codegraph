/**
 * SPEC-005 Slice 1 static-mount + route-fallback tests (T012).
 *
 * Exercises the static mount in BOTH web-root states:
 *   (a) `dist/web/` ABSENT (all of SPEC-005's life) — `/` and every extensionless
 *       browser route return the byte-identical, data-free placeholder pointing at
 *       `/api/status` (FR-017/017a); asset-extension and `/api/*` paths still 404
 *       (FR-018); no response carries CORS headers (FR-018/019).
 *   (b) synthetic `dist/web/` PRESENT (a SPEC-006 dev build) — the probe asset is
 *       served with its content-type and an extensionless route falls back to the
 *       `index.html` shell (FR-017 "serve when present").
 * The path-traversal probe (`GET /..%2f..%2f..%2fetc%2fpasswd`) returns 404 and
 * reads no out-of-root file in BOTH states (FR-017b).
 *
 * Two layers: pure `serveStatic`/`placeholderPage` unit tests over controlled
 * web-roots (the security matrix — decode-once, containment, NUL, double-encode),
 * and HTTP integration over the T008 harness (`startServerFixture`, incl. its
 * injectable synthetic web root) confirming the `index.ts` dispatch wiring.
 *
 * @module __tests__/server-static-fallback
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { serveStatic, placeholderPage } from '../src/server/static';
import { startServerFixture, type ServerFixture } from './helpers/server-fixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The FR-017b traversal probe (single-encoded `%2f`, literal `..`). */
const TRAVERSAL_PROBE = '/..%2f..%2f..%2fetc%2fpasswd';

/** Text of a `StaticResult`/response body regardless of string-vs-Buffer. */
function text(body: string | Buffer): string {
  return Buffer.isBuffer(body) ? body.toString('utf8') : body;
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * GET `rawPath` VERBATIM over `node:http` — the request-line path is sent
 * exactly as given, so an encoded-separator/`..` traversal probe reaches the
 * server un-normalized (a WHATWG-URL client such as `fetch` may fold it).
 */
function rawGet(baseURL: string, rawPath: string): Promise<RawResponse> {
  const u = new URL(baseURL);
  return new Promise<RawResponse>((resolve, reject) => {
    const req = http.request(
      { hostname: u.hostname, port: u.port, method: 'GET', path: rawPath },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Names of any `Access-Control-*` (CORS) response headers present. */
function corsHeaderNames(headers: http.IncomingHttpHeaders | Record<string, string>): string[] {
  return Object.keys(headers).filter((k) => k.toLowerCase().startsWith('access-control-'));
}

/** Assert a body is the `not_found`/`route` envelope (FR-017b/FR-018), not file bytes. */
function expectRouteMissEnvelope(body: string): void {
  const parsed = JSON.parse(body) as {
    error: { code: string; message: string; details?: { resource?: string } };
  };
  expect(parsed.error.code).toBe('not_found');
  expect(parsed.error.details?.resource).toBe('route');
}

/** A marker every SPEC-005 placeholder must carry (points visitors at status). */
const STATUS_LINK = '/api/status';
/** Distinctive placeholder prose — absent from a real `index.html` shell. */
const PLACEHOLDER_MARKER = 'The local CodeGraph API is running';

// ===========================================================================
// Unit — placeholderPage (T019, FR-017/017a)
// ===========================================================================

describe('placeholderPage — data-free app-shell stand-in (T019, FR-017/017a)', () => {
  it('returns a byte-identical HTML page pointing at /api/status', () => {
    const page = placeholderPage();
    expect(page.length).toBeGreaterThan(0);
    expect(page).toMatch(/<!doctype html>/i);
    expect(page).toContain(STATUS_LINK);
    // Byte-identical across calls — no interpolation, no per-request state.
    expect(placeholderPage()).toBe(page);
  });
});

// ===========================================================================
// Unit — serveStatic, dist/web ABSENT (T019/T020, FR-017/017b/018)
// ===========================================================================

describe('serveStatic — dist/web absent (T019/T020, FR-017/017b/018)', () => {
  // A web root that is guaranteed never to exist on disk.
  const absentRoot = path.join(os.tmpdir(), `cg-static-absent-${process.pid}-DOES-NOT-EXIST`);

  it('serves the placeholder for / (200 text/html)', () => {
    const r = serveStatic('/', absentRoot);
    expect(r.status).toBe(200);
    expect(r.headers?.['Content-Type']).toContain('text/html');
    expect(text(r.body)).toBe(placeholderPage());
  });

  it('serves the SAME placeholder for an extensionless route (/graph), not 404', () => {
    const r = serveStatic('/graph', absentRoot);
    expect(r.status).toBe(200);
    expect(text(r.body)).toBe(placeholderPage());
  });

  it('returns the 404 route envelope for a missing .js asset (no shell fallback)', () => {
    const r = serveStatic('/assets/app.js', absentRoot);
    expect(r.status).toBe(404);
    expect(r.headers?.['Content-Type']).toContain('application/json');
    expectRouteMissEnvelope(text(r.body));
  });

  it('placeholder bytes are identical for two different (absent) web roots (FR-017a)', () => {
    const a = serveStatic('/', path.join(os.tmpdir(), `cg-abs-A-${process.pid}`));
    const b = serveStatic('/', path.join(os.tmpdir(), `cg-abs-B-${process.pid}`));
    expect(text(a.body)).toBe(text(b.body));
  });

  it('rejects the encoded ../ traversal probe with a 404 route miss (FR-017b)', () => {
    const r = serveStatic(TRAVERSAL_PROBE, absentRoot);
    expect(r.status).toBe(404);
    expectRouteMissEnvelope(text(r.body));
    expect(text(r.body)).not.toContain('root:');
  });

  it('rejects a NUL-byte path with a 404 route miss (FR-017b)', () => {
    const r = serveStatic('/app%00.js', absentRoot);
    expect(r.status).toBe(404);
    expectRouteMissEnvelope(text(r.body));
  });

  it('never emits CORS headers (FR-019)', () => {
    for (const p of ['/', '/graph', '/assets/app.js', TRAVERSAL_PROBE]) {
      const r = serveStatic(p, absentRoot);
      expect(corsHeaderNames(r.headers ?? {})).toEqual([]);
    }
  });
});

// ===========================================================================
// Unit — serveStatic, dist/web PRESENT (T019/T020, FR-017/017b)
// ===========================================================================

describe('serveStatic — dist/web present (T019/T020, FR-017/017b)', () => {
  let baseDir: string;
  let webRoot: string;
  const OUTSIDE_MARKER = 'SECRET_OUTSIDE_WEBROOT_DO_NOT_LEAK';
  const INDEX_MARKER = 'codegraph shell index';
  const PROBE_MARKER = 'PROBE_ASSET_BODY';

  beforeAll(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-static-present-'));
    // A secret file OUTSIDE the web root — a successful escape would leak it.
    fs.writeFileSync(path.join(baseDir, 'outside-secret.txt'), `${OUTSIDE_MARKER}\n`);
    webRoot = path.join(baseDir, 'web');
    fs.mkdirSync(webRoot, { recursive: true });
    fs.writeFileSync(
      path.join(webRoot, 'index.html'),
      `<!doctype html><title>${INDEX_MARKER}</title><body>ok</body>\n`,
    );
    fs.writeFileSync(path.join(webRoot, 'probe.txt'), `${PROBE_MARKER}\n`);
  });

  afterAll(() => {
    try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('serves an asset with the right content-type (probe.txt -> text/plain)', () => {
    const r = serveStatic('/probe.txt', webRoot);
    expect(r.status).toBe(200);
    expect(r.headers?.['Content-Type']).toContain('text/plain');
    expect(text(r.body)).toContain(PROBE_MARKER);
  });

  it('serves index.html for / (text/html)', () => {
    const r = serveStatic('/', webRoot);
    expect(r.status).toBe(200);
    expect(r.headers?.['Content-Type']).toContain('text/html');
    expect(text(r.body)).toContain(INDEX_MARKER);
    // The shell is the real index.html, NOT the placeholder stand-in.
    expect(text(r.body)).not.toContain(PLACEHOLDER_MARKER);
  });

  it('falls back to the index.html shell for an extensionless route (/graph)', () => {
    const r = serveStatic('/graph', webRoot);
    expect(r.status).toBe(200);
    expect(text(r.body)).toContain(INDEX_MARKER);
  });

  it('returns 404 for a missing asset — no shell fallback (FR-018)', () => {
    const r = serveStatic('/assets/missing.js', webRoot);
    expect(r.status).toBe(404);
    expectRouteMissEnvelope(text(r.body));
  });

  it('rejects the encoded ../ traversal probe with 404 and reads no outside file (FR-017b)', () => {
    const r = serveStatic('/..%2foutside-secret.txt', webRoot);
    expect(r.status).toBe(404);
    expectRouteMissEnvelope(text(r.body));
    expect(text(r.body)).not.toContain(OUTSIDE_MARKER);
  });

  it('neutralizes a DOUBLE-encoded ../ payload with a single decode (FR-017b)', () => {
    // `%252e%252e%252f` decodes ONCE to the literal `%2e%2e%2f` (not `../`) — a
    // decode-to-fixed-point would re-open the escape; a single decode must not.
    const r = serveStatic('/%252e%252e%252foutside-secret.txt', webRoot);
    expect(r.status).toBe(404);
    expect(text(r.body)).not.toContain(OUTSIDE_MARKER);
  });

  it('rejects a NUL-byte path with a 404 route miss (FR-017b)', () => {
    const r = serveStatic('/probe%00.txt', webRoot);
    expect(r.status).toBe(404);
    expectRouteMissEnvelope(text(r.body));
  });
});

// ===========================================================================
// Integration — HTTP, dist/web ABSENT (T019/T020, FR-017/017a/018/019)
// ===========================================================================

describe('static mount over HTTP — dist/web absent (T019/T020, FR-017/017a/018/019)', () => {
  let fx: ServerFixture;

  beforeAll(async () => {
    // No withWebRoot -> the server uses its default (src/web, absent in tests).
    fx = await startServerFixture();
  });

  afterAll(async () => {
    await fx.teardown();
  });

  it('GET / -> placeholder (text/html, points at /api/status), no CORS', async () => {
    const res = await rawGet(fx.baseURL, '/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(STATUS_LINK);
    // Data-free: never embeds the registered repo's root path (FR-017a).
    expect(res.body).not.toContain(fx.root);
    expect(corsHeaderNames(res.headers)).toEqual([]);
  });

  it('GET /graph -> the SAME placeholder (app-shell stand-in), not 404', async () => {
    const root = await rawGet(fx.baseURL, '/');
    const route = await rawGet(fx.baseURL, '/graph');
    expect(route.status).toBe(200);
    expect(route.body).toBe(root.body);
  });

  it('GET /api/<unknown> -> 404 JSON envelope (route), no static fallback', async () => {
    const res = await rawGet(fx.baseURL, '/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expectRouteMissEnvelope(res.body);
  });

  it('GET /app.js -> 404 (missing asset, no shell fallback), no CORS', async () => {
    const res = await rawGet(fx.baseURL, '/app.js');
    expect(res.status).toBe(404);
    expectRouteMissEnvelope(res.body);
    expect(corsHeaderNames(res.headers)).toEqual([]);
  });

  it('GET the traversal probe -> 404 envelope, leaks no out-of-root file (FR-017b)', async () => {
    const res = await rawGet(fx.baseURL, TRAVERSAL_PROBE);
    expect(res.status).toBe(404);
    expectRouteMissEnvelope(res.body);
    expect(res.body).not.toContain('root:');
  });
});

// ===========================================================================
// Integration — placeholder byte-identical regardless of registered repos
// ===========================================================================

describe('placeholder is byte-identical regardless of registered repos (FR-017a)', () => {
  it('two different indexed repos serve identical, root-free placeholder bytes', async () => {
    const a = await startServerFixture({ files: { 'alpha.ts': 'export const alpha = 1;\n' } });
    const b = await startServerFixture({ files: { 'beta.ts': 'export function beta(): void {}\n' } });
    try {
      const ra = await rawGet(a.baseURL, '/');
      const rb = await rawGet(b.baseURL, '/');
      expect(ra.status).toBe(200);
      expect(rb.status).toBe(200);
      expect(ra.body).toBe(rb.body); // byte-identical across distinct repos
      expect(ra.body).not.toContain(a.root);
      expect(rb.body).not.toContain(b.root);
    } finally {
      await a.teardown();
      await b.teardown();
    }
  });
});

// ===========================================================================
// Integration — HTTP, dist/web PRESENT (T019, FR-017/017b)
// ===========================================================================

describe('static mount over HTTP — dist/web present (T019, FR-017/017b)', () => {
  let fx: ServerFixture;

  beforeAll(async () => {
    // Seeds a synthetic web root (index.html "codegraph fixture" + probe.txt).
    fx = await startServerFixture({ withWebRoot: true });
  });

  afterAll(async () => {
    await fx.teardown();
  });

  it('GET /probe.txt -> the probe asset served with a text/plain content-type', async () => {
    const res = await rawGet(fx.baseURL, '/probe.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('CODEGRAPH_PROBE_ASSET');
    expect(corsHeaderNames(res.headers)).toEqual([]);
  });

  it('GET /graph -> the index.html shell (not the placeholder)', async () => {
    const res = await rawGet(fx.baseURL, '/graph');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('codegraph fixture'); // marker from the harness index.html
    expect(res.body).not.toContain(PLACEHOLDER_MARKER);
  });

  it('GET / -> the index.html shell', async () => {
    const res = await rawGet(fx.baseURL, '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('codegraph fixture');
  });

  it('GET the traversal probe -> 404, leaks no out-of-root file (FR-017b)', async () => {
    const res = await rawGet(fx.baseURL, TRAVERSAL_PROBE);
    expect(res.status).toBe(404);
    expectRouteMissEnvelope(res.body);
    expect(res.body).not.toContain('root:');
  });
});
