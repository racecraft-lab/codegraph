/**
 * SPEC-005 slice-1 review-remediation regression tests.
 *
 * Covers behavioral fixes from the PR #41 external review that are cleanly and
 * deterministically testable. The remaining slice-1 remediations are either
 * defense-in-depth on paths without a surgical unit seam (spawn 'error' listener,
 * attach wall-clock budget, initialize-failure socket stop), status internals
 * that need a configured embedding provider / forced partial index, or a
 * daemon-attach identity path that needs a live spawned daemon — all verified by
 * type-check + the existing server suites + adversarial code review rather than a
 * bespoke fixture here.
 *
 * @module __tests__/server-rp-remediation
 */

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { serveStatic, placeholderPage } from '../src/server/static';
import { startWebServer } from '../src/server/index';
import { executeReadOp } from '../src/mcp/read-ops';
import {
  buildReadRoutes,
  handleApiRequest,
  type ReadApiDeps,
  type RepoInfo,
  type RouteContext,
} from '../src/server/routes';
import type { DaemonReadClient } from '../src/server/daemon-client';
import type CodeGraph from '../src/index';

describe('SPEC-005 slice-1 review remediation', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  // 41-A (FR-017b): the SPA shell fallback must route `index.html` through the
  // symlink-aware containment chokepoint, not a raw path.join — a symlinked
  // index.html whose real target escapes the web root must be treated as absent
  // (serve the placeholder), never followed to the out-of-root file.
  it.runIf(process.platform !== 'win32')(
    '41-A: a symlinked index.html escaping the web root serves the placeholder, not the target',
    () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rp-static-'));
      cleanups.push(() => fs.rmSync(base, { recursive: true, force: true }));
      const webRoot = path.join(base, 'web');
      fs.mkdirSync(webRoot, { recursive: true });
      // A secret file OUTSIDE the web root, reachable only by following the symlink.
      const secret = path.join(base, 'secret.html');
      fs.writeFileSync(secret, '<html>TOP_SECRET_OUT_OF_ROOT</html>');
      fs.symlinkSync(secret, path.join(webRoot, 'index.html'));

      const res = serveStatic('/', webRoot);

      // Escaping shell is treated as absent → the data-free placeholder, byte-identical.
      expect(res.status).toBe(200);
      expect(res.body).toBe(placeholderPage());
      expect(String(res.body)).not.toContain('TOP_SECRET');
    },
  );

  // 41-A (companion): a NON-escaping real index.html inside the web root is still
  // served normally — the containment fix must not break the happy path.
  it('41-A: a real in-root index.html is still served for the extensionless route', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rp-static-ok-'));
    cleanups.push(() => fs.rmSync(base, { recursive: true, force: true }));
    const webRoot = path.join(base, 'web');
    fs.mkdirSync(webRoot, { recursive: true });
    fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>ok</title>');

    const res = serveStatic('/', webRoot);

    expect(res.status).toBe(200);
    expect(String(res.body)).toContain('<!doctype html>');
    expect(res.body).not.toBe(placeholderPage());
  });
});

/**
 * A minimal `CodeGraph` stub shaped just for `statusOp` — the four methods it
 * reads, no real DB. `getIndexState` and `getStats().nodeCount` drive the state
 * field under test; the embedding/LSP stubs keep the rest of the status shape well-formed.
 */
function statusStub(
  persisted: 'indexing' | 'complete' | 'partial' | 'failed' | null,
  nodeCount: number,
  lastIndexedAt: number | null = null,
): CodeGraph {
  return {
    // `lastUpdated` is stamped `Date.now()` by the real getStats() on every call —
    // here a fixed FAR-FUTURE sentinel, deliberately distinct from `getLastIndexedAt()`,
    // so S1-C can prove statusOp reports the persisted index time, not this stamp.
    getStats: () => ({ nodeCount, fileCount: nodeCount, edgeCount: 0, lastUpdated: 1_900_000_000_000 }),
    getEmbeddingStatus: () => ({ active: false, coverage: { embedded: 0 } }),
    getLspStatus: () => ({ enabled: false }),
    getIndexState: () => persisted,
    getLastIndexedAt: () => lastIndexedAt,
  } as unknown as CodeGraph;
}

// R2-41M (FR-005/016): a FAILED/partial/indexing index that produced ZERO nodes
// must surface its persisted failure state, not be masked as 'empty'. The
// persisted failure states win FIRST; only a healthy/unknown persisted state
// falls through to the nodeCount===0 → 'empty' heuristic.
describe('SPEC-005 R2-41M: a zero-node non-healthy index is not reported empty', () => {
  it.each(['failed', 'partial', 'indexing'] as const)(
    "reports state='%s' (not 'empty') for a 0-node index in that persisted state",
    async (persisted) => {
      const res = (await executeReadOp(statusStub(persisted, 0), 'status', {})) as {
        index: { state: string };
      };
      expect(res.index.state).toBe(persisted);
    },
  );

  it("still reports 'empty' for a genuinely empty index (complete/null persisted state)", async () => {
    for (const persisted of ['complete', null] as const) {
      const res = (await executeReadOp(statusStub(persisted, 0), 'status', {})) as {
        index: { state: string };
      };
      expect(res.index.state).toBe('empty');
    }
  });

  it("reports 'indexed' for a healthy non-empty index", async () => {
    const res = (await executeReadOp(statusStub('complete', 42), 'status', {})) as {
      index: { state: string };
    };
    expect(res.index.state).toBe('indexed');
  });
});

// R2-DEPTH (FR-004/006/007): the HTTP routes clamp depth (max 3) / limit (max
// 500), but `codegraph/read` is directly callable — so the read-ops defensively
// re-clamp any over-cap depth/limit BEFORE the library call (clamp, never error).
describe('SPEC-005 R2-DEPTH: read-ops defensively clamp over-cap depth/limit', () => {
  it('clamps an over-cap impact depth to 3 before the library call', async () => {
    let capturedDepth: number | undefined;
    const cg = {
      getNode: () => ({ id: 'x', kind: 'function', name: 'x' }),
      getImpactRadius: (_id: string, depth: number) => {
        capturedDepth = depth;
        return { nodes: new Map(), edges: [] };
      },
    } as unknown as CodeGraph;
    await executeReadOp(cg, 'impact', { id: 'x', depth: 99 });
    expect(capturedDepth).toBe(3);
  });

  it('clamps an over-cap callers limit to 500', async () => {
    const callers = Array.from({ length: 600 }, (_, i) => ({
      node: { id: `c${i}`, kind: 'function', name: `c${i}` },
    }));
    const cg = {
      getNode: () => ({ id: 'target', kind: 'function', name: 'target' }),
      getCallers: () => callers,
    } as unknown as CodeGraph;
    const res = (await executeReadOp(cg, 'callers', { id: 'target', limit: 9999 })) as {
      items: unknown[];
      total: number;
    };
    expect(res.items.length).toBe(500);
    expect(res.total).toBe(600);
  });
});

// R3-LOG (FR-014a): the redacted request-log line must never contain the
// configured token — including the rare case where a client puts the token in
// the request PATH (`/api/<token>`). The configured token is carried even on a
// loopback bind (requireToken=false), so the redaction applies there too.
describe('SPEC-005 R3: request logger redacts the configured token in the path (FR-014a)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('a token appearing in the request path is redacted, never logged verbatim', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rp-tok-'));
    dirs.push(dir);
    const TOKEN = 'super-secret-token-abc123';
    const logs: string[] = [];
    const handle = await startWebServer({
      port: 0,
      projectPath: dir,
      token: TOKEN, // loopback bind: gate off, but the token is carried → redaction active
      logger: (line) => logs.push(line),
    });
    try {
      // A 404 route whose PATH embeds the token verbatim (no daemon needed).
      await fetch(`http://${handle.host}:${handle.port}/api/${TOKEN}/x`).catch(() => undefined);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join('\n')).not.toContain(TOKEN); // never the secret
      expect(logs.some((l) => l.includes('<redacted>'))).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('a percent-ENCODED token in the path is also redacted — no reversible form (FR-014a)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rp-tok-enc-'));
    dirs.push(dir);
    const TOKEN = 'sec/ret tok+en'; // contains chars that URL-encode (/ space +)
    const encoded = encodeURIComponent(TOKEN); // e.g. sec%2Fret%20tok%2Ben
    const logs: string[] = [];
    const handle = await startWebServer({
      port: 0,
      projectPath: dir,
      token: TOKEN,
      logger: (line) => logs.push(line),
    });
    try {
      const doubleEncoded = encodeURIComponent(encoded); // e.g. sec%252Fret%2520tok%252Ben
      await fetch(`http://${handle.host}:${handle.port}/api/${encoded}/x`).catch(() => undefined);
      await fetch(`http://${handle.host}:${handle.port}/api/${doubleEncoded}/y`).catch(() => undefined);
      expect(logs.length).toBeGreaterThan(0);
      const joined = logs.join('\n');
      expect(joined).not.toContain(TOKEN); // not the cleartext token
      expect(joined).not.toContain(encoded); // nor the singly percent-encoded reversible form
      expect(joined).not.toContain(doubleEncoded); // nor the MULTIPLY-encoded form
      expect(logs.some((l) => l.includes('<redacted>'))).toBe(true);
    } finally {
      await handle.close();
    }
  });
});

// S1-C (FR-005): `index.lastIndexed` must report the PERSISTED index-completion time
// (getLastIndexedAt → MAX(files.indexed_at)), NEVER `getStats().lastUpdated` — which
// the real QueryBuilder stamps `Date.now()` on every call, making a stale index look
// freshly indexed on every status request.
describe('SPEC-005 S1-C: status.index.lastIndexed reflects the persisted index time', () => {
  it('reports getLastIndexedAt(), not the per-call getStats().lastUpdated', async () => {
    const OLD = 1_600_000_000_000; // 2020 — the real last-index time
    const res = (await executeReadOp(statusStub('complete', 42, OLD), 'status', {})) as {
      index: { lastIndexed: string | null };
    };
    // The stub's getStats().lastUpdated is a far-FUTURE sentinel (2030); reporting the
    // 2020 persisted time proves lastUpdated is not the source.
    expect(res.index.lastIndexed).toBe(new Date(OLD).toISOString());
  });

  it('reports null when nothing has been indexed (getLastIndexedAt() === null)', async () => {
    const res = (await executeReadOp(statusStub('complete', 42, null), 'status', {})) as {
      index: { lastIndexed: string | null };
    };
    expect(res.index.lastIndexed).toBeNull();
  });
});

// S1-A (FR-002/015a): a daemon client that dies AFTER a successful attach makes its
// pooled read reject. Before, that rejection escaped withClient (which guarded only
// the attach) and became a 500, and the dead client stayed pooled so every later read
// failed forever. Now withClient catches it: evict the client and return a transient
// 503, so the next request re-attaches.
describe('SPEC-005 S1-A: a mid-session daemon read failure evicts the client, returns 503', () => {
  it('returns 503 (not 500), evicts+closes the dead client, and re-attaches next request', async () => {
    const defaultRepo: RepoInfo = { id: 'a'.repeat(16), root: '/x', name: 'x' };
    let attachCount = 0;
    let closeCount = 0;
    const pool = new Map<string, DaemonReadClient>();
    const makeDeadClient = (): DaemonReadClient =>
      ({
        // A recoverable condition RETURNS a result; a throw means the round-trip failed.
        read: async () => {
          throw new Error('socket closed');
        },
        close: () => {
          closeCount += 1;
        },
      }) as unknown as DaemonReadClient;
    const deps: ReadApiDeps = {
      version: 'test',
      defaultRepo,
      resolveRepo: () => defaultRepo,
      getClient: async (repo) => {
        const cached = pool.get(repo.id);
        if (cached) return cached;
        attachCount += 1;
        const c = makeDeadClient();
        pool.set(repo.id, c);
        return c;
      },
      evictClient: (repo, client) => {
        // Identity-aware, mirroring production: only evict if the pool still holds
        // THIS client (a concurrent failure must not close a healthy replacement).
        if (pool.get(repo.id) === client) {
          pool.delete(repo.id);
          client.close();
        }
      },
      isRepoIndexed: () => true,
    };
    const routes = buildReadRoutes(deps);
    const ctx = (): RouteContext => ({
      method: 'GET',
      rawPath: '/api/node/n1',
      params: {},
      query: new URLSearchParams(),
      headers: {},
    });

    const first = await handleApiRequest(routes, ctx());
    expect(first?.status).toBe(503); // transient daemonUnavailable, NOT a 500
    expect(attachCount).toBe(1);
    expect(closeCount).toBe(1); // the dead client was closed
    expect(pool.size).toBe(0); // ...and evicted from the pool

    const second = await handleApiRequest(routes, ctx());
    expect(second?.status).toBe(503);
    expect(attachCount).toBe(2); // re-attached, never reused the dead client
  });
});

// S1-D (FR-014a): the token-redaction scan must not be defeated by a MALFORMED
// percent escape earlier in the path that used to abort the decode loop and let an
// encoded token through. A raw socket sends the exact request bytes so a client
// library can't normalize `%ZZ` before it reaches the server. (The reviewer also
// flagged the HTTP method as un-redacted, but that vector is unreachable: node:http's
// strict parser rejects a nonstandard method with HPE_INVALID_METHOD before the
// handler runs — verified — so `method` is always a validated standard verb.)
describe('SPEC-005 S1-D: redaction survives a malformed escape in the path (FR-014a)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  const rawRequest = (host: string, port: number, requestLine: string): Promise<void> =>
    new Promise((resolve) => {
      const sock = net.connect(port, host, () => {
        sock.write(`${requestLine}\r\nHost: ${host}:${port}\r\nConnection: close\r\n\r\n`);
      });
      sock.on('data', () => {
        /* drain */
      });
      sock.on('close', () => resolve());
      sock.on('error', () => resolve());
    });

  it('a malformed %ZZ before an ENCODED token does not bypass redaction', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rp-tok-bad-'));
    dirs.push(dir);
    const TOKEN = 'sec/ret';
    const encoded = encodeURIComponent(TOKEN); // sec%2Fret
    const logs: string[] = [];
    const handle = await startWebServer({
      port: 0,
      projectPath: dir,
      token: TOKEN,
      logger: (line) => logs.push(line),
    });
    try {
      // `%ZZ` (invalid) precedes the encoded token: the old scan threw on it and
      // stopped, logging the still-encoded token. The tolerant scan must catch it.
      await rawRequest(handle.host, handle.port, `GET /api/bad%ZZ/${encoded} HTTP/1.1`);
      const joined = logs.join('\n');
      expect(logs.length).toBeGreaterThan(0);
      expect(joined).not.toContain(TOKEN); // not the cleartext token
      expect(joined).not.toContain(encoded); // nor its reversible encoded form
      expect(logs.some((l) => l.includes('<redacted>'))).toBe(true);
    } finally {
      await handle.close();
    }
  });
});

// R7-A (FR-002/015a): statusHandler has its OWN attach path — it does NOT go through
// withClient. A daemon that dies AFTER a successful attach makes readStatusHealth
// reject; before, that reached the router as a 500 and the dead client stayed pooled,
// so every later /api/status repeated the 500. Now the health read is guarded: evict
// the dead client (identity-aware) and return a transient 503, so the next status
// re-attaches. (The identity check itself lives in the closure-private pool in
// index.ts — no unit seam without a live daemon; the wiring that passes the failed
// client is exercised here and in the S1-A test above.)
describe('SPEC-005 R7-A: /api/status evicts a dead client on a mid-session read failure', () => {
  it('a health-read failure after a successful attach → 503 (not 500), evicts+closes, re-attaches', async () => {
    const defaultRepo: RepoInfo = { id: 'a'.repeat(16), root: '/x', name: 'x' };
    let attachCount = 0;
    let closeCount = 0;
    const pool = new Map<string, DaemonReadClient>();
    const makeDeadClient = (): DaemonReadClient =>
      ({
        // The health read (client.read('status', {})) rejects — a dead socket.
        read: async () => {
          throw new Error('socket closed');
        },
        close: () => {
          closeCount += 1;
        },
      }) as unknown as DaemonReadClient;
    const deps: ReadApiDeps = {
      version: 'test',
      defaultRepo,
      resolveRepo: () => defaultRepo,
      getClient: async (repo) => {
        const cached = pool.get(repo.id);
        if (cached) return cached;
        attachCount += 1;
        const c = makeDeadClient();
        pool.set(repo.id, c);
        return c;
      },
      evictClient: (repo, client) => {
        if (pool.get(repo.id) === client) {
          pool.delete(repo.id);
          client.close();
        }
      },
      isRepoIndexed: () => true, // indexed → NOT the un-indexed 200 path; a read failure is 503
    };
    const routes = buildReadRoutes(deps);
    const ctx = (): RouteContext => ({
      method: 'GET',
      rawPath: '/api/status',
      params: {},
      query: new URLSearchParams(),
      headers: {},
    });

    const first = await handleApiRequest(routes, ctx());
    expect(first?.status).toBe(503); // transient daemonUnavailable, NOT a 500
    expect(closeCount).toBe(1); // the dead client was closed
    expect(pool.size).toBe(0); // ...and evicted from the pool

    const second = await handleApiRequest(routes, ctx());
    expect(second?.status).toBe(503);
    expect(attachCount).toBe(2); // re-attached, never reused the dead client
  });
});
