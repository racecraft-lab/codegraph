/**
 * SPEC-005 Slice 1 read-API tests.
 *
 * Hosts the error-envelope suite (T003, FR-015/FR-015a) and the request-router
 * suite (T004, FR-004a/FR-015a/FR-018) — pure unit tests, no HTTP listener, no
 * daemon, no SQLite. From T005 on this file also hosts integration-style suites
 * that stand up a real per-project daemon over a real fixture index (T005,
 * FR-002/008/015a), the HTTP listener lifecycle (T006, FR-002/026), and the
 * CLI `--web` activation/dormancy (T007, FR-001) — all keyed on `fs.mkdtempSync`
 * fixture temp dirs, never this repo's own daemon.
 */

import { afterEach, afterAll, beforeAll, describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import * as crypto from 'crypto';
import {
  apiError,
  notFound,
  unauthorized,
  unavailable,
  internalError,
  ERROR_STATUS,
  type ErrorCode,
} from '../src/server/errors';
import {
  isApiPath,
  matchRoute,
  handleApiRequest,
  type Route,
  type RouteContext,
  type HandlerResult,
} from '../src/server/routes';
import {
  attachDaemonClient,
  daemonUnavailable,
  DaemonUnavailableError,
  type DaemonReadClient,
} from '../src/server/daemon-client';
import {
  startWebServer,
  WebServerError,
  type WebServerHandle,
} from '../src/server/index';
import { getDaemonPidPath } from '../src/mcp/daemon-paths';
import { listDaemons } from '../src/mcp/daemon-registry';
import {
  buildFixtureIndex,
  startServerFixture,
  type FixtureIndex,
  type ServerFixture,
} from './helpers/server-fixture';

// ---------------------------------------------------------------------------
// Shared fixture helpers for the daemon-backed suites (T005+).
// ---------------------------------------------------------------------------

/** The built CLI a spawned daemon re-invokes (dist must be built for these). */
const CLI_BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');

/** Loosen every wait on CI (cold caches, 4 vCPU) — mirrors mcp-daemon.test.ts. */
const CI_ON = !['', '0', 'false'].includes((process.env.CI ?? '').trim().toLowerCase());
const WAIT_SCALE = CI_ON ? 4 : 1;
const T = (ms: number): number => ms * WAIT_SCALE;

function readDaemonPid(root: string): number | null {
  try {
    const info = JSON.parse(fs.readFileSync(getDaemonPidPath(root), 'utf8'));
    return typeof info.pid === 'number' ? info.pid : null;
  } catch { return null; }
}

async function waitFor<V>(
  predicate: () => V | undefined | null | false,
  timeoutMs: number,
  label = '',
  pollMs = 25,
): Promise<V> {
  const budget = timeoutMs * WAIT_SCALE;
  const started = Date.now();
  for (;;) {
    let v: V | undefined | null | false;
    try { v = predicate(); } catch { v = undefined; }
    if (v) return v as V;
    if (Date.now() - started > budget) {
      throw new Error(`Timed out after ${budget}ms${label ? ` waiting for: ${label}` : ''}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Spawn the detached daemon directly (CODEGRAPH_DAEMON_INTERNAL=1) via the built
 * CLI, keyed on `root`. Injected as `attachDaemonClient`'s `spawnDaemon` so the
 * test drives the REAL attach-or-spawn path (the production default uses
 * `process.argv[1]`, which is the test runner here). Returns the child so the
 * caller can reap it; the recorded daemon.pid is the authoritative reap target.
 */
function spawnDaemonViaDistBin(root: string): ChildProcess {
  const child = spawn(process.execPath, [CLI_BIN, 'serve', '--mcp', '--path', root], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, CODEGRAPH_DAEMON_INTERNAL: '1', CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS: '30000' },
  });
  child.on('error', () => { /* ignore — reaped via pid */ });
  child.unref();
  return child;
}

// ---------------------------------------------------------------------------
// T003 — error envelope (FR-015 / FR-015a)
// ---------------------------------------------------------------------------

describe('SPEC-005 error envelope (T003, FR-015/FR-015a)', () => {
  const codeStatus: Array<[ErrorCode, number]> = [
    ['invalid_request', 400],
    ['unauthorized', 401],
    ['not_found', 404],
    ['conflict', 409],
    ['unavailable', 503],
    ['internal', 500],
  ];

  describe('code → HTTP status', () => {
    it('ERROR_STATUS maps each of the six codes to its fixed status', () => {
      for (const [code, status] of codeStatus) {
        expect(ERROR_STATUS[code]).toBe(status);
      }
    });

    it('the vocabulary is closed at exactly six codes', () => {
      expect(Object.keys(ERROR_STATUS).sort()).toEqual([
        'conflict',
        'internal',
        'invalid_request',
        'not_found',
        'unauthorized',
        'unavailable',
      ]);
    });

    it('apiError(code).status matches the map for every code', () => {
      for (const [code, status] of codeStatus) {
        expect(apiError(code).status).toBe(status);
      }
    });
  });

  describe('envelope shape', () => {
    it('produces { error: { code, message } } with no stray top-level keys', () => {
      const e = apiError('invalid_request');
      expect(Object.keys(e.body)).toEqual(['error']);
      expect(e.body.error.code).toBe('invalid_request');
      expect(typeof e.body.error.message).toBe('string');
      expect(e.body.error.message.length).toBeGreaterThan(0);
    });

    it('omits details entirely when none is supplied', () => {
      const e = apiError('invalid_request');
      expect('details' in e.body.error).toBe(false);
    });

    it('accepts a whitelisted, safe message + param override for invalid_request', () => {
      const e = apiError('invalid_request', {
        message: 'Missing required query parameter: q',
        details: { param: 'q' },
      });
      expect(e.status).toBe(400);
      expect(e.body.error.message).toBe('Missing required query parameter: q');
      expect(e.body.error.details).toEqual({ param: 'q' });
    });
  });

  describe('not_found resource discriminator (node | repo | route)', () => {
    it.each(['node', 'repo', 'route'] as const)(
      'notFound("%s") is 404 carrying details.resource',
      (resource) => {
        const e = notFound(resource);
        expect(e.status).toBe(404);
        expect(e.body.error.code).toBe('not_found');
        expect(e.body.error.details).toEqual({ resource });
      }
    );
  });

  describe('unavailable 503 + Retry-After', () => {
    it('sets a positive-integer Retry-After header by default', () => {
      const e = unavailable();
      expect(e.status).toBe(503);
      expect(e.body.error.code).toBe('unavailable');
      const ra = Number(e.headers['Retry-After']);
      expect(Number.isInteger(ra)).toBe(true);
      expect(ra).toBeGreaterThan(0);
    });

    it('honours an explicit retry-after value', () => {
      const e = unavailable(5);
      expect(e.headers['Retry-After']).toBe('5');
    });
  });

  describe('401 generic, identical body (enumeration prevention)', () => {
    it('unauthorized() is 401 with a generic body and no details', () => {
      const e = unauthorized();
      expect(e.status).toBe(401);
      expect(e.body.error.code).toBe('unauthorized');
      expect('details' in e.body.error).toBe(false);
    });

    it('ignores any supplied message/details so the reason cannot be enumerated', () => {
      const a = apiError('unauthorized', {
        message: 'token expired',
        details: { param: 'Authorization' },
      });
      const b = apiError('unauthorized', { message: 'no token supplied' });
      expect(a.body).toEqual(b.body);
      expect(a.body.error.message).not.toContain('token expired');
      expect('details' in a.body.error).toBe(false);
    });
  });

  describe('whitelist enforcement — never leaks exception internals (FR-015a)', () => {
    it('internalError() is a generic 500 with no fault detail', () => {
      const e = internalError();
      expect(e.status).toBe(500);
      expect(e.body.error.code).toBe('internal');
      expect('details' in e.body.error).toBe(false);
      // Generic message — carries no path separator.
      expect(e.body.error.message).not.toMatch(/\//);
    });

    it('the internal code drops any caller-supplied message/details (no exception text leaks)', () => {
      const e = apiError('internal', {
        message: 'ENOENT: /Users/secret/abs/path at Object.<anonymous> (/x.js:1:1)',
        details: { param: 'stack' },
      });
      const serialized = JSON.stringify(e.body);
      expect(serialized).not.toContain('/Users/secret');
      expect(serialized).not.toContain('ENOENT');
      expect(serialized).not.toContain('Object.<anonymous>');
      expect('details' in e.body.error).toBe(false);
    });

    it('strips non-whitelisted detail keys, keeping only resource/param/header', () => {
      const e = apiError('not_found', {
        // Smuggle disallowed keys through `any` — they must not survive.
        details: { resource: 'node', stack: 'boom', filePath: '/abs/secret', cause: 'x' } as never,
      });
      expect(e.body.error.details).toEqual({ resource: 'node' });
      const serialized = JSON.stringify(e.body);
      expect(serialized).not.toContain('/abs/secret');
      expect(serialized).not.toContain('boom');
    });
  });
});

// ---------------------------------------------------------------------------
// T004 — request router (FR-004a / FR-015a / FR-018)
// ---------------------------------------------------------------------------

/** Build a minimal request context for the dispatcher. */
function ctx(method: string, rawPath: string, query = ''): RouteContext {
  return { method, rawPath, params: {}, query: new URLSearchParams(query), headers: {} };
}

/** A trivial 200 handler. */
const okHandler = () => ({ status: 200, body: { ok: true } });

describe('SPEC-005 request router (T004, FR-004a/FR-015a/FR-018)', () => {
  describe('isApiPath — the /api namespace boundary', () => {
    it('recognizes /api and every /api/* path', () => {
      expect(isApiPath('/api')).toBe(true);
      expect(isApiPath('/api/status')).toBe(true);
      expect(isApiPath('/api/node/x')).toBe(true);
    });

    it('rejects non-/api paths so they fall through to the static mount', () => {
      expect(isApiPath('/')).toBe(false);
      expect(isApiPath('/graph')).toBe(false);
      expect(isApiPath('/static/app.js')).toBe(false);
      // The prefix is exactly '/api/', not merely '/api'.
      expect(isApiPath('/apixyz')).toBe(false);
    });
  });

  describe('matchRoute — matching and param extraction', () => {
    const routes: Route[] = [
      { method: 'GET', pattern: '/api/status', handler: okHandler },
      { method: 'GET', pattern: '/api/node/:id', handler: okHandler },
      { method: 'GET', pattern: '/api/reindex/:repo/events', handler: okHandler },
    ];

    it('matches a static path with no params', () => {
      const m = matchRoute(routes, 'GET', '/api/status');
      expect(m.matched).toBe(true);
      if (m.matched) {
        expect(m.route.pattern).toBe('/api/status');
        expect(m.params).toEqual({});
      }
    });

    it('extracts a single :id param', () => {
      const m = matchRoute(routes, 'GET', '/api/node/function:abcdef');
      expect(m.matched).toBe(true);
      if (m.matched) expect(m.params).toEqual({ id: 'function:abcdef' });
    });

    it('extracts a :repo param from a multi-segment pattern', () => {
      const m = matchRoute(routes, 'GET', '/api/reindex/abcdef0123456789/events');
      expect(m.matched).toBe(true);
      if (m.matched) expect(m.params).toEqual({ repo: 'abcdef0123456789' });
    });
  });

  describe('matchRoute — the single decode chokepoint (FR-004a)', () => {
    const routes: Route[] = [{ method: 'GET', pattern: '/api/node/:id', handler: okHandler }];

    it('decodes an encoded slash in a file: id (one segment round-trips)', () => {
      const m = matchRoute(routes, 'GET', '/api/node/file:src%2Futil.ts');
      expect(m.matched).toBe(true);
      if (m.matched) expect(m.params.id).toBe('file:src/util.ts');
    });

    it('decodes multiple encoded slashes in one id segment', () => {
      const m = matchRoute(routes, 'GET', '/api/node/file:a%2Fb%2Fc');
      expect(m.matched).toBe(true);
      if (m.matched) expect(m.params.id).toBe('file:a/b/c');
    });

    it('does NOT pre-decode the whole path: an unencoded slash fragments and misses', () => {
      // A literal '/' in the id yields more segments than the pattern → miss,
      // proving the raw path is split on '/' BEFORE any decode (FR-004a).
      const m = matchRoute(routes, 'GET', '/api/node/file:src/util.ts');
      expect(m.matched).toBe(false);
    });

    it('decodes exactly once — a double-encoded slash decodes to %2F, not /', () => {
      // %252F --(single decodeURIComponent)--> %2F ; never a second decode.
      const m = matchRoute(routes, 'GET', '/api/node/file:a%252Fb');
      expect(m.matched).toBe(true);
      if (m.matched) expect(m.params.id).toBe('file:a%2Fb');
    });

    it('keeps a traversal-shaped id as one opaque segment (a DB key, never a path)', () => {
      const m = matchRoute(routes, 'GET', '/api/node/..%2F..%2Fetc%2Fpasswd');
      expect(m.matched).toBe(true);
      if (m.matched) expect(m.params.id).toBe('../../etc/passwd');
    });

    it('a malformed percent-encoding does not throw; the raw segment is kept for the handler to 404', () => {
      const m = matchRoute(routes, 'GET', '/api/node/%ZZ');
      expect(m.matched).toBe(true);
      if (m.matched) expect(m.params.id).toBe('%ZZ');
    });
  });

  describe('matchRoute — misses (FR-018: unknown or wrong-method → miss, no 405)', () => {
    const routes: Route[] = [{ method: 'GET', pattern: '/api/status', handler: okHandler }];

    it('misses an unknown /api path', () => {
      expect(matchRoute(routes, 'GET', '/api/nope').matched).toBe(false);
    });

    it('misses an unsupported method on a known path (treated as a miss, not 405)', () => {
      expect(matchRoute(routes, 'POST', '/api/status').matched).toBe(false);
    });

    it('misses a segment-count mismatch', () => {
      expect(matchRoute(routes, 'GET', '/api/status/extra').matched).toBe(false);
    });
  });

  describe('handleApiRequest — dispatch, fallthrough, and the top-level catch', () => {
    const routes: Route[] = [
      { method: 'GET', pattern: '/api/status', handler: () => ({ status: 200, body: { ok: true } }) },
      {
        method: 'GET',
        pattern: '/api/node/:id',
        handler: (c) => ({ status: 200, body: { id: c.params.id } }),
      },
      {
        method: 'GET',
        pattern: '/api/boom',
        handler: () => {
          throw new Error('secret /Users/abs/path\n    at stack (x.js:1:1)');
        },
      },
      {
        method: 'GET',
        pattern: '/api/reject',
        handler: async () => {
          throw new Error('async boom');
        },
      },
    ];

    it('returns null for a non-/api path (caller falls through to static)', async () => {
      expect(await handleApiRequest(routes, ctx('GET', '/graph'))).toBeNull();
    });

    it('runs a matched handler and returns its result', async () => {
      const r = await handleApiRequest(routes, ctx('GET', '/api/status'));
      expect(r).toEqual({ status: 200, body: { ok: true } });
    });

    it('passes decoded path params to the handler', async () => {
      const r = await handleApiRequest(routes, ctx('GET', '/api/node/file:x%2Fy'));
      expect(r).toMatchObject({ status: 200, body: { id: 'file:x/y' } });
    });

    it('an unknown /api path → 404 not_found route', async () => {
      const r = await handleApiRequest(routes, ctx('GET', '/api/nope'));
      expect(r).toMatchObject({
        status: 404,
        body: { error: { code: 'not_found', details: { resource: 'route' } } },
      });
    });

    it('an unsupported method on a known path → 404 route, never 405', async () => {
      const r = await handleApiRequest(routes, ctx('POST', '/api/status'));
      expect(r).not.toBeNull();
      expect(r!.status).toBe(404);
      expect((r as HandlerResult).body).toMatchObject({
        error: { code: 'not_found', details: { resource: 'route' } },
      });
    });

    it('a throwing handler → 500 internal envelope that leaks no fault detail (FR-015a)', async () => {
      const r = await handleApiRequest(routes, ctx('GET', '/api/boom'));
      expect(r).not.toBeNull();
      expect(r!.status).toBe(500);
      expect((r as HandlerResult).body).toMatchObject({ error: { code: 'internal' } });
      const serialized = JSON.stringify((r as HandlerResult).body);
      expect(serialized).not.toContain('/Users/abs/path');
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('x.js');
    });

    it('a rejecting async handler → 500 (the throw is caught through await)', async () => {
      const r = await handleApiRequest(routes, ctx('GET', '/api/reject'));
      expect(r!.status).toBe(500);
      expect((r as HandlerResult).body).toMatchObject({ error: { code: 'internal' } });
    });

    it('F1: a throwing handler logs the cause via ctx.logDiagnostic while the body stays generic', async () => {
      const logs: string[] = [];
      const c: RouteContext = { ...ctx('GET', '/api/boom'), logDiagnostic: (m) => logs.push(m) };
      const r = await handleApiRequest(routes, c);
      // The client body leaks nothing (FR-015a) …
      expect(r!.status).toBe(500);
      expect((r as HandlerResult).body).toMatchObject({ error: { code: 'internal' } });
      expect(JSON.stringify((r as HandlerResult).body)).not.toContain('/Users/abs/path');
      // … but the operator diagnostic captured the underlying cause (F1).
      const joined = logs.join('\n');
      expect(joined).toContain('/Users/abs/path');
      expect(joined.toLowerCase()).not.toContain('authorization');
      expect(joined.toLowerCase()).not.toContain('bearer');
    });
  });
});

// ---------------------------------------------------------------------------
// T005 — daemon client: attach-or-spawn + read round-trip + 503 (FR-002/008/015a)
// ---------------------------------------------------------------------------

describe('SPEC-005 daemon client (T005, FR-002/008/015a)', () => {
  // Every spawned daemon (keyed on a fixture temp dir) is reaped by its recorded
  // pid; every temp dir is removed. Never touches this repo's own daemon.
  const cleanups: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) {
      try { await fn(); } catch { /* best-effort teardown */ }
    }
  });

  /** A real fixture project with a real (node:sqlite) index and a beacon symbol. */
  async function buildFixture(): Promise<string> {
    // Reuse the shared harness (T008): builds the real index + reaps the daemon.
    const fx = await buildFixtureIndex({
      files: { 'fixture.ts': 'export function uniqueBeaconSymbol(): number {\n  return 42;\n}\n' },
    });
    cleanups.push(fx.cleanup);
    return fx.root;
  }

  it('attaches (spawning the daemon) and a read query round-trips (FR-002/008)', async () => {
    const root = await buildFixture();

    const client: DaemonReadClient = await attachDaemonClient(root, {
      spawnDaemon: spawnDaemonViaDistBin,
    });
    cleanups.push(() => client.close());

    // A daemon actually bound its socket for this fixture (proof of attach-or-spawn).
    await waitFor(() => (readDaemonPid(root) ?? 0) > 0, 12000, 'daemon pid recorded');

    // Round-trip a real read over the socket. The default MCP tool surface is
    // `codegraph_explore`; querying the beacon symbol returns its verbatim source,
    // which proves the daemon served THIS fixture's real index (not an error).
    const res = await client.request('codegraph_explore', {
      query: 'uniqueBeaconSymbol',
      projectPath: root,
    });

    expect(res.isError).not.toBe(true);
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content[0]?.type).toBe('text');
    expect(res.content.map((c) => c.text).join('\n')).toContain('uniqueBeaconSymbol');
  }, T(45000));

  it('maps a never-indexed path to the 503 unavailable envelope (FR-015a)', async () => {
    const bogus = path.join(os.tmpdir(), `cg-no-such-project-${Date.now()}`);
    // No .codegraph/ anywhere at/above `bogus` → attach is impossible; must be a
    // transient 503, never a crash. The spawn seam must NOT be reached (would be
    // an infinite spawn of an un-indexable root), so a throwing spawn proves it.
    const rejection = await attachDaemonClient(bogus, {
      spawnDaemon: () => { throw new Error('spawn must not be attempted for a never-indexed path'); },
    }).then(
      () => { throw new Error('expected attachDaemonClient to reject for a bogus path'); },
      (e) => e as unknown,
    );

    expect(rejection).toBeInstanceOf(DaemonUnavailableError);

    const env = daemonUnavailable(rejection);
    expect(env.status).toBe(503);
    expect(env.body.error.code).toBe('unavailable');
    const retryAfter = Number(env.headers['Retry-After']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
  }, T(15000));

  it('F2: a rejected initialize handshake closes the socket (no leak) and still maps to 503', async () => {
    const root = await buildFixture();

    // A fake "daemon" that accepts the connection and answers the FIRST line (the
    // initialize request) with a JSON-RPC ERROR — so initialize rejects while the
    // socket stays OPEN. Only makeReadClient's stop() then closes it, so the
    // socket being destroyed proves the F2 fix ran (without it the socket leaks).
    const srv = net.createServer((s) => {
      s.setEncoding('utf8');
      let buf = '';
      s.on('data', (d: string) => {
        buf += d;
        const nl = buf.indexOf('\n');
        if (nl === -1) return;
        let id: unknown = 0;
        try { id = JSON.parse(buf.slice(0, nl)).id; } catch { /* ignore */ }
        s.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'handshake refused' } })}\n`);
      });
      s.on('error', () => { /* ignore */ });
    });
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
    cleanups.push(() => new Promise<void>((r) => srv.close(() => r())));
    const port = (srv.address() as net.AddressInfo).port;

    let clientSock: net.Socket | null = null;
    const connect = (): Promise<net.Socket> =>
      new Promise((resolve) => {
        const c = net.createConnection(port, '127.0.0.1', () => resolve(c));
        clientSock = c;
        c.on('error', () => { /* ignore */ });
      });

    const rejection = await attachDaemonClient(root, {
      connect,
      spawnDaemon: () => { throw new Error('spawn must not run — a socket was reachable'); },
    }).then(
      () => { throw new Error('expected attach to reject on a refused handshake'); },
      (e) => e as unknown,
    );

    // The handshake error propagates to the 503 mapping …
    expect(daemonUnavailable(rejection).status).toBe(503);
    // … and the socket was CLOSED by makeReadClient's stop() (the F2 fix).
    await waitFor(() => clientSock?.destroyed === true, 5000, 'client socket closed by stop()');
  }, T(30000));

  it('t3: an injected version-mismatch daemon → DaemonUnavailableError (503 path), no spawn', async () => {
    const root = await buildFixture();
    const rejection = await attachDaemonClient(root, {
      connect: async () => 'version-mismatch',
      spawnDaemon: () => { throw new Error('spawn must not run for a version-mismatch'); },
    }).then(
      () => { throw new Error('expected attach to reject on version-mismatch'); },
      (e) => e as unknown,
    );
    expect(rejection).toBeInstanceOf(DaemonUnavailableError);
    expect((rejection as DaemonUnavailableError).message).toMatch(/version mismatch/i);
    expect(daemonUnavailable(rejection).status).toBe(503);
  }, T(15000));

  it('t5: a spawn that fails once then succeeds → first read 503, a later read 200 (pool eviction retry)', async () => {
    const root = await buildFixture();
    let spawnCalls = 0;
    const spawnDaemon = (r: string): void => {
      spawnCalls += 1;
      if (spawnCalls === 1) throw new Error('transient spawn failure');
      spawnDaemonViaDistBin(r); // a real detached daemon on the retry
    };
    const h = await startWebServer({ port: 0, projectPath: root, spawnDaemon });
    cleanups.push(() => h.close());
    const baseURL = `http://${h.host}:${h.port}`;

    // First request: the sole spawn attempt throws → attach fails → the indexed
    // default repo's status maps to 503 (never a crash), and the failed attach is
    // evicted from the pool so a later request retries.
    const first = await fetch(`${baseURL}/api/status`);
    expect(first.status).toBe(503);

    // A later request re-attaches (spawn #2 is the real daemon) → eventually 200.
    const deadline = Date.now() + T(30000);
    let ok = false;
    while (Date.now() < deadline) {
      if ((await fetch(`${baseURL}/api/status`)).status === 200) { ok = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(ok).toBe(true);
    expect(spawnCalls).toBeGreaterThanOrEqual(2); // the pool evicted + retried the spawn
  }, T(45000));
});

// ---------------------------------------------------------------------------
// T006 — HTTP server bootstrap + lifecycle (FR-002/026)
// ---------------------------------------------------------------------------

describe('SPEC-005 web server lifecycle (T006, FR-002/026)', () => {
  const handles: WebServerHandle[] = [];

  afterEach(async () => {
    for (const h of handles.splice(0)) {
      try { await h.close(); } catch { /* already closed */ }
    }
  });

  async function start(opts: Parameters<typeof startWebServer>[0] = {}): Promise<WebServerHandle> {
    const h = await startWebServer({ port: 0, ...opts });
    handles.push(h);
    return h;
  }

  it('binds an ephemeral port (--port 0) and reports the actual bound port', async () => {
    const h = await start();
    expect(Number.isInteger(h.port)).toBe(true);
    expect(h.port).toBeGreaterThan(0);
    expect(h.host).toBe('127.0.0.1');
  });

  it('serves the 404 not_found route envelope for an unknown /api path', async () => {
    const h = await start();
    // An UNMATCHED /api path is a route miss (404) before any daemon attach —
    // distinct from the now-wired read routes (/api/status etc.), which the
    // T011 suite covers. Kept unmatched so this lifecycle test never touches a
    // daemon (this cwd's own, in particular — the dogfood hazard).
    const res = await fetch(`http://127.0.0.1:${h.port}/api/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({
      error: { code: 'not_found', details: { resource: 'route' } },
    });
  });

  it('releases the port on close so a subsequent start can re-bind it', async () => {
    const first = await startWebServer({ port: 0 });
    const port = first.port;
    await first.close();

    // Re-bind the very same port — proves close() fully released it (FR-026).
    const second = await startWebServer({ port });
    handles.push(second);
    expect(second.port).toBe(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/x`);
    expect(res.status).toBe(404);
  });

  // R4-CLOSE-AWAIT (FR-026): close() must await the REAL server.close() callback,
  // not merely a grace timer — otherwise it can resolve while the listening socket
  // is still open (a rebind race). With a live keep-alive connection still open,
  // close() ends the socket, awaits the real listener close (backstop destroys any
  // straggler), and only then resolves — so the very same port re-binds.
  it('R4-CLOSE-AWAIT: close() with a live keep-alive connection frees the port to re-bind', async () => {
    const first = await startWebServer({ port: 0 });
    const port = first.port;

    // A real, idle keep-alive connection the client does NOT close — so close()
    // cannot resolve until it awaits the actual listener close.
    const sock = net.connect(port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      sock.once('error', reject);
      sock.on('data', () => resolve()); // first response bytes → connection established
      sock.on('connect', () => {
        sock.write(
          'GET /api/x HTTP/1.1\r\n' +
          `Host: 127.0.0.1:${port}\r\n` +
          'Connection: keep-alive\r\n\r\n',
        );
      });
    });

    await first.close();                 // must resolve despite the live connection
    try { sock.destroy(); } catch { /* already gone */ }

    // The listening socket is fully closed → the same port re-binds (no race).
    const second = await startWebServer({ port });
    handles.push(second);
    expect(second.port).toBe(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/x`);
    expect(res.status).toBe(404);
  }, 20000);

  it('EADDRINUSE → a clear error naming the port, suggesting --port, and no half-open listener', async () => {
    const h = await start();
    const port = h.port;

    const err = await startWebServer({ port }).then(
      (leaked) => { handles.push(leaked); throw new Error('expected a bind failure'); },
      (e) => e as unknown,
    );

    expect(err).toBeInstanceOf(WebServerError);
    const we = err as WebServerError;
    expect(we.code).toBe('EADDRINUSE');
    expect(we.port).toBe(port);
    expect(we.message).toContain(String(port));
    expect(we.message).toContain('--port');

    // The original server is untouched — the failed bind left no half-open listener.
    const res = await fetch(`http://127.0.0.1:${port}/api/x`);
    expect(res.status).toBe(404);
  });

  it('ordered shutdown closes tracked daemon clients and never kills a shared daemon (FR-026)', async () => {
    const h = await startWebServer({ port: 0 });
    let closed = 0;
    const fakeClient: DaemonReadClient = {
      request: async () => ({ content: [{ type: 'text', text: '' }] }),
      read: async () => ({}),
      close: () => { closed += 1; },
    };
    h.trackDaemonClient(fakeClient);

    await h.close();
    // close() (decrement refcount), exactly once — the only shutdown lever a
    // client has; it must never signal/kill the shared daemon process.
    expect(closed).toBe(1);
  });

  it('exposes the reserved upgrade attach point wired to nothing (SPEC-009)', async () => {
    const h = await start();
    // A raw WebSocket-style upgrade must not get 101 Switching Protocols; the
    // reserved handler destroys the socket (nothing is wired yet).
    const received = await new Promise<string>((resolve) => {
      const sock = net.connect(h.port, '127.0.0.1', () => {
        sock.write(
          'GET /ws HTTP/1.1\r\n' +
          `Host: 127.0.0.1:${h.port}\r\n` +
          'Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
        );
      });
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('data', (d) => { buf += d; });
      const done = () => resolve(buf);
      sock.on('close', done);
      sock.on('error', done);
      setTimeout(() => { try { sock.destroy(); } catch { /* ignore */ } done(); }, 1000);
    });
    expect(received).not.toContain('101');
  });
});

// ---------------------------------------------------------------------------
// T007 — CLI `serve --web` activation + dormancy (FR-001, SC-006)
// ---------------------------------------------------------------------------

interface CliRun { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; }

/** Run the built CLI to completion (killed if it overruns), capturing output. */
function runCliToExit(args: string[], timeoutMs = T(15000)): Promise<CliRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    timer.unref?.();
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    child.on('error', () => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr }); });
  });
}

describe('SPEC-005 CLI serve --web activation + dormancy (T007, FR-001/SC-006)', () => {
  const children: ChildProcess[] = [];

  /** Signal a spawned CLI's whole process group (the CLI re-execs once for the
   *  `--liftoff-only` wasm flag, so the real server is a grandchild — a bare
   *  `child.kill` hits only the launcher). Mirrors a terminal Ctrl+C. */
  function signalGroup(child: ChildProcess, sig: NodeJS.Signals): void {
    if (!child.pid) return;
    try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } }
  }

  afterEach(() => {
    for (const c of children.splice(0)) {
      if (c.pid && !c.killed) signalGroup(c, 'SIGKILL');
    }
  });

  it('serve --web --mcp fails startup with a choose-one-mode error (FR-001)', async () => {
    const r = await runCliToExit(['serve', '--web', '--mcp']);
    expect(r.code).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/one server mode/i);
  }, T(20000));

  it('serve --web --port 0 binds and prints the actual bound port; SIGTERM stops it (FR-026)', async () => {
    // Own process group so the SIGTERM reaches the re-exec'd server grandchild.
    const child = spawn(process.execPath, [CLI_BIN, 'serve', '--web', '--port', '0'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    children.push(child);
    let stderr = '';

    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no listening line within budget; stderr:\n${stderr}`)),
        T(15000),
      );
      child.stderr?.on('data', (d) => {
        stderr += d;
        const m = stderr.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/i);
        if (m) { clearTimeout(timer); resolve(Number(m[1])); }
      });
      child.on('error', reject);
    });
    expect(port).toBeGreaterThan(0);

    const exited = new Promise<void>((resolve) => child.on('close', () => resolve()));
    signalGroup(child, 'SIGTERM'); // like a terminal Ctrl+C → the server shuts down
    await Promise.race([
      exited,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('did not exit on SIGTERM')), T(8000)),
      ),
    ]);
  }, T(30000));

  it('dormancy: top-level --help hides serve and never surfaces --web (FR-001/SC-006)', async () => {
    const r = await runCliToExit(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain('--web');
    // `serve` is a hidden command — it must not appear in the command listing.
    expect(r.stdout).not.toMatch(/^\s*serve\b/m);
  }, T(20000));

  it('dormancy: bare serve prints the unchanged info block and does not bind (FR-001)', async () => {
    const r = await runCliToExit(['serve']);
    expect(r.code).toBe(0);
    // The pre-existing info block — unchanged by the --web addition.
    expect(r.stderr).toContain('Use --mcp flag to start the MCP server');
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/listening on http/i);
  }, T(20000));
});

// ---------------------------------------------------------------------------
// T008 — shared fixture harness (real index + running server + synthetic web root)
// ---------------------------------------------------------------------------

describe('SPEC-005 server fixture harness (T008)', () => {
  const fixtures: ServerFixture[] = [];
  const cleanups: Array<() => void> = [];

  afterEach(async () => {
    for (const fx of fixtures.splice(0)) {
      try { await fx.teardown(); } catch { /* best-effort */ }
    }
    for (const fn of cleanups.splice(0)) {
      try { fn(); } catch { /* best-effort */ }
    }
  });

  it('buildFixtureIndex builds a real indexed project and cleans it up', async () => {
    const fx = await buildFixtureIndex();
    cleanups.push(fx.cleanup);
    // A real .codegraph index exists at the canonical root.
    expect(fs.existsSync(path.join(fx.root, '.codegraph'))).toBe(true);
    expect(fs.existsSync(fx.dir)).toBe(true);

    fx.cleanup();
    expect(fs.existsSync(fx.dir)).toBe(false);
  }, T(20000));

  it('startServerFixture serves over a real index on port 0 (unknown /api path → 404 route)', async () => {
    const fx = await startServerFixture();
    fixtures.push(fx);

    expect(fx.baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(fx.handle.port).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(fx.root, '.codegraph'))).toBe(true);

    // An unmatched /api path still 404s as the route envelope (the wired read
    // routes are covered by the T011 suite); this harness test stays a pure
    // routing check that never spawns the fixture's daemon.
    const res = await fetch(`${fx.baseURL}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: 'not_found', details: { resource: 'route' } },
    });
  }, T(20000));

  it('startServerFixture({ withWebRoot }) seeds + injects a synthetic dist/web/ (index.html + probe asset)', async () => {
    const fx = await startServerFixture({ withWebRoot: true });
    fixtures.push(fx);

    expect(fx.webRoot).toBeTruthy();
    const webRoot = fx.webRoot!;
    // The synthetic build the later static tests exercise: a shell + a probe asset.
    expect(fs.existsSync(path.join(webRoot, 'index.html'))).toBe(true);
    expect(fs.readdirSync(webRoot).length).toBeGreaterThanOrEqual(2);
    // The server is live over that web root (the /api boundary still 404s).
    const res = await fetch(`${fx.baseURL}/api/x`);
    expect(res.status).toBe(404);
  }, T(20000));

  it('teardown removes every temp dir it created', async () => {
    const fx = await startServerFixture({ withWebRoot: true });
    const { root, webRoot } = fx;
    await fx.teardown();
    expect(fs.existsSync(root)).toBe(false);
    expect(fs.existsSync(webRoot!)).toBe(false);
  }, T(20000));
});

// ---------------------------------------------------------------------------
// T011 — read endpoints over a real fixture index, end-to-end through the
// daemon `codegraph/read` transport (FR-004/004a/005/006/006a/007/016).
//
// One shared server + daemon over a rich fixture (amortizes the daemon spawn);
// every read is a real HTTP round-trip that forwards to the daemon and maps the
// library result to the wire shape. Node ids are looked up via /api/search so
// no opaque hash is hard-coded (a realistic client flow).
// ---------------------------------------------------------------------------

/**
 * A fixture whose call graph is known: `subHelper` (in a subdir, so its file
 * node id `file:src/util.ts` carries a slash for the %2F round-trip) is called
 * by `helper`, `useSub`, and imported by `a.ts`; `helper` calls `subHelper` and
 * is called by `caller`.
 */
const READ_FIXTURE_FILES: Record<string, string> = {
  'a.ts':
    'import { subHelper } from "./src/util";\n' +
    'export function helper(): number { return subHelper() + 1; }\n' +
    'export function caller(): number { return helper(); }\n',
  'src/util.ts':
    'export function subHelper(): number { return 2; }\n' +
    'export function useSub(): number { return subHelper(); }\n',
};

describe('SPEC-005 read endpoints (T011, FR-004/004a/005/006/006a/007/016)', () => {
  let fx: ServerFixture;
  let baseURL: string;

  beforeAll(async () => {
    fx = await startServerFixture({ files: READ_FIXTURE_FILES });
    baseURL = fx.baseURL;
    // Warm the daemon: the first read lazily spawns + attaches it (cold-start
    // budget). Poll /api/status until it serves 200 so per-test reads are fast.
    await waitFor(async () => (await fetch(`${baseURL}/api/status`)).status === 200, 40000, 'status 200');
  }, T(60000));

  afterAll(async () => {
    if (fx) await fx.teardown();
  });

  const getJson = async (p: string): Promise<{ status: number; body: any; ct: string | null }> => {
    const res = await fetch(`${baseURL}${p}`);
    const ct = res.headers.get('content-type');
    const body = await res.json().catch(() => undefined);
    return { status: res.status, body, ct };
  };

  /** Look up a symbol's opaque node id via the search endpoint. */
  const idOf = async (name: string): Promise<string> => {
    const { body } = await getJson(`/api/search?q=${encodeURIComponent(name)}&limit=50`);
    const hit = (body.items as Array<{ id: string; name: string; kind: string }>).find(
      (n) => n.name === name && n.kind !== 'import',
    );
    if (!hit) throw new Error(`no search hit for ${name}: ${JSON.stringify(body.items)}`);
    return hit.id;
  };

  // ---- GET /api/status (FR-005/016) ----
  describe('GET /api/status', () => {
    it('reports version, default repo, index health, hybrid + lsp availability', async () => {
      const { status, body, ct } = await getJson('/api/status');
      expect(status).toBe(200);
      expect(ct).toContain('application/json');

      expect(typeof body.version).toBe('string');
      expect(body.version.length).toBeGreaterThan(0);

      expect(body.repo.id).toMatch(/^[0-9a-f]{16}$/);
      expect(typeof body.repo.root).toBe('string');
      expect(typeof body.repo.name).toBe('string');

      expect(body.index.state).toBe('indexed');
      expect(body.index.fileCount).toBeGreaterThanOrEqual(2);
      expect(body.index.nodeCount).toBeGreaterThan(0);
      expect(typeof body.index.edgeCount).toBe('number');
      expect('lastIndexed' in body.index).toBe(true);

      expect(typeof body.hybridSearch.available).toBe('boolean');
      expect(typeof body.lsp.available).toBe('boolean');
      // Unit-test env strips embedding vars and installs no language server.
      expect(body.hybridSearch.available).toBe(false);
      expect(body.lsp.available).toBe(false);
    }, T(20000));

    it('is not repo-scoped: does not carry the full repo list', async () => {
      const { body } = await getJson('/api/status');
      expect(Array.isArray(body.repos)).toBe(false);
    }, T(15000));
  });

  // ---- GET /api/search (FR-006/006a) ----
  describe('GET /api/search', () => {
    it('returns a paged { items, total, limit, offset } list of nodes', async () => {
      const { status, body } = await getJson('/api/search?q=subHelper');
      expect(status).toBe(200);
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.total).toBe('number');
      expect(body.limit).toBe(100);
      expect(body.offset).toBe(0);
      const hit = (body.items as Array<any>).find((n) => n.name === 'subHelper');
      expect(hit).toBeTruthy();
      expect(typeof hit.id).toBe('string');
      expect(typeof hit.kind).toBe('string');
    }, T(20000));

    it('rejects an absent q with 400 invalid_request (details.param q)', async () => {
      const { status, body } = await getJson('/api/search');
      expect(status).toBe(400);
      expect(body.error.code).toBe('invalid_request');
      expect(body.error.details.param).toBe('q');
    }, T(15000));

    it('rejects an empty q with 400', async () => {
      const { status, body } = await getJson('/api/search?q=');
      expect(status).toBe(400);
      expect(body.error.code).toBe('invalid_request');
    }, T(15000));

    it('accepts an omitted mode (defaults to auto) → 200', async () => {
      const { status } = await getJson('/api/search?q=subHelper');
      expect(status).toBe(200);
    }, T(15000));

    it('accepts each valid mode → 200', async () => {
      for (const mode of ['keyword', 'semantic', 'hybrid', 'auto']) {
        const { status } = await getJson(`/api/search?q=subHelper&mode=${mode}`);
        expect(status).toBe(200);
      }
    }, T(20000));

    it('rejects an invalid mode with 400 (diverges from MCP/CLI coercion)', async () => {
      const { status, body } = await getJson('/api/search?q=subHelper&mode=fuzzy');
      expect(status).toBe(400);
      expect(body.error.code).toBe('invalid_request');
    }, T(15000));

    it('clamps an over-cap limit to 500 (echoes the effective value, not an error)', async () => {
      const { status, body } = await getJson('/api/search?q=subHelper&limit=9999');
      expect(status).toBe(200);
      expect(body.limit).toBe(500);
    }, T(15000));

    it('rejects a negative limit and a malformed offset with 400', async () => {
      expect((await getJson('/api/search?q=subHelper&limit=-1')).status).toBe(400);
      expect((await getJson('/api/search?q=subHelper&offset=abc')).status).toBe(400);
    }, T(15000));

    it('degradation (semantic w/o embeddings) → 200 with degraded:true + reason, never an error', async () => {
      const { status, body } = await getJson('/api/search?q=subHelper&mode=semantic');
      expect(status).toBe(200);
      expect(body.degraded).toBe(true);
      expect(typeof body.degradationReason).toBe('string');
    }, T(15000));
  });

  // ---- GET /api/node/:id (FR-004/004a) ----
  describe('GET /api/node/:id', () => {
    it('returns the node OWN fields only (no relationships embedded)', async () => {
      const id = await idOf('subHelper');
      const { status, body } = await getJson(`/api/node/${encodeURIComponent(id)}`);
      expect(status).toBe(200);
      expect(body.id).toBe(id);
      expect(body.kind).toBe('function');
      expect(body.name).toBe('subHelper');
      expect(body.file).toBe('src/util.ts');
      expect(typeof body.line).toBe('number');
      // Bounded: relationships are the separate endpoints, never inlined here.
      expect('callers' in body).toBe(false);
      expect('callees' in body).toBe(false);
      expect('edges' in body).toBe(false);
      expect('nodes' in body).toBe(false);
    }, T(20000));

    it('round-trips a file: id whose %2F-encoded slash resolves to the right node (FR-004a)', async () => {
      const { status, body } = await getJson('/api/node/file:src%2Futil.ts');
      expect(status).toBe(200);
      expect(body.id).toBe('file:src/util.ts');
      expect(body.kind).toBe('file');
    }, T(20000));

    it('an unknown node id → 404 not_found (details.resource node)', async () => {
      const { status, body } = await getJson('/api/node/function:00000000000000000000000000000000');
      expect(status).toBe(404);
      expect(body.error.code).toBe('not_found');
      expect(body.error.details.resource).toBe('node');
    }, T(15000));

    it('a malformed id → 404 not_found node (indistinguishable from unknown)', async () => {
      const { status, body } = await getJson('/api/node/%ZZ');
      expect(status).toBe(404);
      expect(body.error.details.resource).toBe('node');
    }, T(15000));
  });

  // ---- GET /api/callers|callees/:id (FR-004/006) ----
  describe('GET /api/callers|callees/:id', () => {
    it('callers returns a paged node list including the real callers', async () => {
      const id = await idOf('subHelper');
      const { status, body } = await getJson(`/api/callers/${encodeURIComponent(id)}`);
      expect(status).toBe(200);
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.limit).toBe(100);
      expect(body.offset).toBe(0);
      const names = (body.items as Array<any>).map((n) => n.name);
      expect(names).toContain('helper');
      expect(names).toContain('useSub');
      expect(body.total).toBeGreaterThanOrEqual(2);
    }, T(20000));

    it('callees returns the symbols a function calls', async () => {
      const id = await idOf('helper');
      const { status, body } = await getJson(`/api/callees/${encodeURIComponent(id)}`);
      expect(status).toBe(200);
      const names = (body.items as Array<any>).map((n) => n.name);
      expect(names).toContain('subHelper');
    }, T(20000));

    it('honours limit/offset paging (over-cap clamps, total is the full count)', async () => {
      const id = await idOf('subHelper');
      const page = await getJson(`/api/callers/${encodeURIComponent(id)}?limit=1`);
      expect(page.status).toBe(200);
      expect(page.body.items.length).toBe(1);
      expect(page.body.limit).toBe(1);
      expect(page.body.total).toBeGreaterThanOrEqual(2);

      const clamped = await getJson(`/api/callers/${encodeURIComponent(id)}?limit=9999`);
      expect(clamped.body.limit).toBe(500);
    }, T(20000));

    it('a negative limit → 400; an unknown id → 404 node', async () => {
      const id = await idOf('subHelper');
      expect((await getJson(`/api/callers/${encodeURIComponent(id)}?limit=-1`)).status).toBe(400);
      const unknown = await getJson('/api/callers/function:00000000000000000000000000000000');
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.details.resource).toBe('node');
    }, T(20000));
  });

  // ---- GET /api/impact/:id + /api/graph/:id (FR-004/007) ----
  describe('GET /api/impact|graph/:id', () => {
    it('impact returns a { nodes, edges, truncated } subgraph, NOT a paged list', async () => {
      const id = await idOf('subHelper');
      const { status, body } = await getJson(`/api/impact/${encodeURIComponent(id)}`);
      expect(status).toBe(200);
      expect(Array.isArray(body.nodes)).toBe(true);
      expect(Array.isArray(body.edges)).toBe(true);
      expect(typeof body.truncated).toBe('boolean');
      expect('items' in body).toBe(false);
      expect(body.nodes.length).toBeGreaterThanOrEqual(1);
      const nodeNames = (body.nodes as Array<any>).map((n) => n.name);
      expect(nodeNames).toContain('subHelper');
      if (body.edges.length > 0) {
        expect(body.edges[0]).toMatchObject({
          source: expect.any(String),
          target: expect.any(String),
          kind: expect.any(String),
        });
      }
    }, T(20000));

    it('graph returns the same subgraph shape and includes the focal node', async () => {
      const id = await idOf('subHelper');
      const { status, body } = await getJson(`/api/graph/${encodeURIComponent(id)}`);
      expect(status).toBe(200);
      expect(Array.isArray(body.nodes)).toBe(true);
      expect(Array.isArray(body.edges)).toBe(true);
      expect(typeof body.truncated).toBe('boolean');
      expect((body.nodes as Array<any>).map((n) => n.id)).toContain(id);
    }, T(20000));

    it('impact defaults to depth 3 and graph to depth 1; both clamp an over-max depth (no error)', async () => {
      const id = await idOf('subHelper');
      // No-depth calls succeed (their own divergent defaults) …
      expect((await getJson(`/api/impact/${encodeURIComponent(id)}`)).status).toBe(200);
      expect((await getJson(`/api/graph/${encodeURIComponent(id)}`)).status).toBe(200);
      // … an over-max depth clamps rather than 400.
      expect((await getJson(`/api/impact/${encodeURIComponent(id)}?depth=99`)).status).toBe(200);
      expect((await getJson(`/api/graph/${encodeURIComponent(id)}?depth=99`)).status).toBe(200);
    }, T(20000));

    it('a malformed/negative depth → 400 on both', async () => {
      const id = await idOf('subHelper');
      expect((await getJson(`/api/impact/${encodeURIComponent(id)}?depth=-1`)).status).toBe(400);
      expect((await getJson(`/api/graph/${encodeURIComponent(id)}?depth=abc`)).status).toBe(400);
    }, T(20000));

    it('an unknown id → 404 node on both', async () => {
      const unknownImpact = await getJson('/api/impact/function:00000000000000000000000000000000');
      expect(unknownImpact.status).toBe(404);
      expect(unknownImpact.body.error.details.resource).toBe('node');
      const unknownGraph = await getJson('/api/graph/function:00000000000000000000000000000000');
      expect(unknownGraph.status).toBe(404);
    }, T(20000));
  });
});

// ---------------------------------------------------------------------------
// T014 — un-indexed startup repo: /api/status reports state via index.state and
// MUST NOT refuse startup or 503 (FR-005/016 Edge Case). No daemon needed — the
// attach fails fast for a root with no .codegraph/ and the handler synthesizes
// an un-indexed status.
// ---------------------------------------------------------------------------

describe('SPEC-005 /api/status on an un-indexed startup repo (T014, FR-005/016)', () => {
  const dirs: string[] = [];
  const handles: WebServerHandle[] = [];

  afterEach(async () => {
    for (const h of handles.splice(0)) { try { await h.close(); } catch { /* closed */ } }
    for (const d of dirs.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
  });

  it('binds and reports index.state for a repo with no .codegraph/ (never 503)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-unindexed-'));
    dirs.push(dir);
    const h = await startWebServer({ port: 0, projectPath: dir });
    handles.push(h);
    const res = await fetch(`http://${h.host}:${h.port}/api/status`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.index.state).toBe('unindexed');
    expect(body.index.nodeCount).toBe(0);
    expect(body.hybridSearch.available).toBe(false);
    expect(body.lsp.available).toBe(false);
  }, T(20000));
});

// ---------------------------------------------------------------------------
// T026 — multi-repo discovery + addressing (US2, FR-009/010/010a/011).
//
// `/api/repos` lists the registered projects (startup repo `default:true`,
// FR-009); a repo-scoped read with `?repo=<16hex>` against a SECOND registered
// repo attaches that repo's daemon LAZILY on first access (not eagerly at
// startup) and returns ITS data (FR-010/010a); an unregistered OR malformed
// `?repo` → 404 `not_found` (`details.resource: repo`), NEVER 400 (FR-011).
//
// `/api/status` and `/api/repos` are deliberately NOT repo-scoped: they IGNORE a
// stray `?repo` (→ 200), never 400. The shipped contract (openapi.yaml) lists no
// `repo` parameter and no 400 response for either path, and FR-025's contract
// test fails on any status an endpoint emits that the document omits — so a 400
// here would be a contract violation. "Ignore unknown params consistently" is
// the resolved reading of FR-010a's "do not accept `repo`" (matches how every
// other endpoint already ignores unrecognized query params).
//
// TWO real fixture indexes, each with its own running (registered) daemon, keyed
// on temp dirs — never this repo's own daemon (dogfood hazard). The global
// daemon registry may also hold OTHER machine daemons, so every listing
// assertion is `contains`, never `equals`.
// ---------------------------------------------------------------------------

/** Repo A (startup/default) beacon — present ONLY in repo A. */
const ALPHA_FILES: Record<string, string> = {
  'alpha.ts': 'export function alphaBeaconSymbol(): number {\n  return 11;\n}\n',
};
/** Repo B (second) beacon — present ONLY in repo B. */
const BETA_FILES: Record<string, string> = {
  'beta.ts': 'export function betaBeaconSymbol(): number {\n  return 22;\n}\n',
};

/**
 * Canonical 16-hex repo id — the SHA-256 prefix of the realpath'd root. This is
 * the daemon-registry record key AND the `/api/repos` id by construction
 * (FR-010), so recomputing it here is the drift-proof source of truth the wire
 * ids must equal.
 */
function repoIdOf(root: string): string {
  return crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
}

describe('SPEC-005 multi-repo /api/repos + ?repo (T026, FR-009/010/010a/011)', () => {
  let fx: ServerFixture; // repo A = startup (default) repo + the web server over it
  let baseURL: string;
  let repoB: FixtureIndex; // repo B = a second registered repo (its own daemon)
  let idA: string;
  let idB: string;

  beforeAll(async () => {
    // Repo A: the startup repo, with the web server bound over it (port 0). Its
    // daemon is spawned lazily by the first read (spawnDaemon injected by the
    // harness so the built dist CLI is re-invoked, not the vitest runner).
    fx = await startServerFixture({ files: ALPHA_FILES });
    baseURL = fx.baseURL;
    idA = repoIdOf(fx.root);

    // Repo B: a second real index whose daemon we START so it REGISTERS in the
    // global registry — the precondition for it to be listable/addressable
    // (listDaemons reports only live, registered daemons; a freshly-indexed repo
    // with no running daemon is invisible). Reaped via B's recorded pid.
    repoB = await buildFixtureIndex({ files: BETA_FILES });
    idB = repoIdOf(repoB.root);
    spawnDaemonViaDistBin(repoB.root);

    // Warm A (the first /api/status lazily spawns+attaches+registers A's daemon).
    await waitFor(
      async () => (await fetch(`${baseURL}/api/status`)).status === 200,
      40000,
      'A status 200',
    );
    // Then wait until BOTH daemons are live in the registry — the source
    // `/api/repos` reads. Polled DIRECTLY (not via the under-test `/api/repos`)
    // so the RED run observes per-test assertion failures, not a beforeAll
    // timeout before the assertions run.
    await waitFor(() => {
      const roots = listDaemons({ prune: true }).map((r) => path.resolve(r.root));
      return roots.includes(path.resolve(fx.root)) && roots.includes(path.resolve(repoB.root));
    }, 40000, 'both daemons registered');
  }, T(90000));

  afterAll(async () => {
    if (fx) await fx.teardown(); // stop server, reap A's daemon, rm A temp dir
    if (repoB) repoB.cleanup(); // reap B's daemon, rm B temp dir
  });

  const getJson = async (p: string): Promise<{ status: number; body: any; ct: string | null }> => {
    const res = await fetch(`${baseURL}${p}`);
    const ct = res.headers.get('content-type');
    const body = await res.json().catch(() => undefined);
    return { status: res.status, body, ct };
  };

  // ---- /api/repos listing (FR-009/010) ----
  describe('GET /api/repos', () => {
    it('returns a JSON array of {id,root,name,default} repo descriptors', async () => {
      const { status, body, ct } = await getJson('/api/repos');
      expect(status).toBe(200);
      expect(ct).toContain('application/json');
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(2);
      for (const r of body as Array<any>) {
        expect(r.id).toMatch(/^[0-9a-f]{16}$/);
        expect(typeof r.root).toBe('string');
        expect(typeof r.name).toBe('string');
        expect(typeof r.default).toBe('boolean');
      }
    }, T(20000));

    it('lists the startup repo with default:true (id/root/name match the startup repo)', async () => {
      const { body } = await getJson('/api/repos');
      const a = (body as Array<any>).find((r) => r.id === idA);
      expect(a).toBeTruthy();
      expect(a.default).toBe(true);
      expect(path.resolve(a.root)).toBe(path.resolve(fx.root));
      expect(a.name).toBe(path.basename(fx.root));
    }, T(20000));

    it('lists the second registered repo with default:false', async () => {
      const { body } = await getJson('/api/repos');
      const b = (body as Array<any>).find((r) => r.id === idB);
      expect(b).toBeTruthy();
      expect(b.default).toBe(false);
      expect(path.resolve(b.root)).toBe(path.resolve(repoB.root));
      expect(b.name).toBe(path.basename(repoB.root));
    }, T(20000));

    it('marks exactly one listed repo as the default (the startup repo)', async () => {
      const { body } = await getJson('/api/repos');
      const defaults = (body as Array<any>).filter((r) => r.default === true);
      expect(defaults.length).toBe(1);
      expect(defaults[0].id).toBe(idA);
    }, T(20000));
  });

  // ---- ?repo resolution + lazy multi-repo attach (FR-010/010a) ----
  describe('repo-scoped reads with ?repo', () => {
    it('a ?repo=<second repo> read attaches that repo lazily and returns ITS data', async () => {
      const { status, body } = await getJson(`/api/search?q=betaBeaconSymbol&repo=${idB}`);
      expect(status).toBe(200);
      const names = (body.items as Array<any>).map((n) => n.name);
      expect(names).toContain('betaBeaconSymbol');
    }, T(25000));

    it('an omitted repo resolves against the default (startup) repo, not the second', async () => {
      // Default routing hits A: A has alphaBeaconSymbol and NOT betaBeaconSymbol —
      // proof the server routes an omitted ?repo to A and did not eagerly switch
      // to (or attach) repo B.
      const alpha = await getJson('/api/search?q=alphaBeaconSymbol');
      expect(alpha.status).toBe(200);
      expect((alpha.body.items as Array<any>).map((n) => n.name)).toContain('alphaBeaconSymbol');

      const beta = await getJson('/api/search?q=betaBeaconSymbol');
      expect(beta.status).toBe(200);
      expect((beta.body.items as Array<any>).map((n) => n.name)).not.toContain('betaBeaconSymbol');
    }, T(25000));

    it('?repo=<startup id> resolves to the startup repo (explicit default addressing)', async () => {
      const { status, body } = await getJson(`/api/search?q=alphaBeaconSymbol&repo=${idA}`);
      expect(status).toBe(200);
      expect((body.items as Array<any>).map((n) => n.name)).toContain('alphaBeaconSymbol');
    }, T(20000));
  });

  // ---- malformed / unregistered ?repo → 404 resource:repo, never 400 (FR-011) ----
  describe('invalid ?repo → 404 not_found (details.resource repo), never 400', () => {
    it('a malformed repo id (fails ^[0-9a-f]{16}$) → 404 repo, never 400', async () => {
      // uppercase-hex, too-short, too-long, and non-hex all fail the pattern.
      for (const bad of ['nothexnothexnoth', 'ABCDEF0123456789', 'abc', 'abcdef012345678', 'abcdef01234567890']) {
        const { status, body } = await getJson(`/api/search?q=alphaBeaconSymbol&repo=${bad}`);
        expect(status).toBe(404);
        expect(body.error.code).toBe('not_found');
        expect(body.error.details.resource).toBe('repo');
      }
    }, T(20000));

    it('a well-formed but unregistered repo id → 404 repo', async () => {
      const { status, body } = await getJson('/api/node/file:alpha.ts?repo=0123456789abcdef');
      expect(status).toBe(404);
      expect(body.error.code).toBe('not_found');
      expect(body.error.details.resource).toBe('repo');
    }, T(20000));

    it('applies on every repo-scoped read endpoint (repo resolved before node/paging)', async () => {
      const bad = 'zzzzzzzzzzzzzzzz'; // malformed (not hex) — same treatment as unregistered
      for (const p of [
        `/api/search?q=x&repo=${bad}`,
        `/api/node/file:alpha.ts?repo=${bad}`,
        `/api/callers/file:alpha.ts?repo=${bad}`,
        `/api/callees/file:alpha.ts?repo=${bad}`,
        `/api/impact/file:alpha.ts?repo=${bad}`,
        `/api/graph/file:alpha.ts?repo=${bad}`,
      ]) {
        const { status, body } = await getJson(p);
        expect(status).toBe(404);
        expect(body.error.details.resource).toBe('repo');
      }
    }, T(25000));
  });

  // ---- /api/status + /api/repos are NOT repo-scoped: ignore ?repo (no 400) ----
  describe('/api/status and /api/repos ignore ?repo (not repo-scoped, FR-010a)', () => {
    it('GET /api/status?repo=<second repo> → 200 reporting the DEFAULT repo (param ignored)', async () => {
      const { status, body } = await getJson(`/api/status?repo=${idB}`);
      expect(status).toBe(200);
      // Reports the startup/default repo regardless of the stray ?repo (status is
      // not repo-scoped); never 400 (the contract documents no 400 here).
      expect(body.repo.id).toBe(idA);
    }, T(20000));

    it('GET /api/repos?repo=<second repo> → 200 still listing repos (param ignored)', async () => {
      const { status, body } = await getJson(`/api/repos?repo=${idB}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect((body as Array<any>).some((r) => r.id === idA && r.default === true)).toBe(true);
    }, T(20000));
  });
});
