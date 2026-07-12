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
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { serveStatic, placeholderPage } from '../src/server/static';
import { startWebServer } from '../src/server/index';
import { executeReadOp } from '../src/mcp/read-ops';
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
): CodeGraph {
  return {
    getStats: () => ({ nodeCount, fileCount: nodeCount, edgeCount: 0, lastUpdated: null }),
    getEmbeddingStatus: () => ({ active: false, coverage: { embedded: 0 } }),
    getLspStatus: () => ({ enabled: false }),
    getIndexState: () => persisted,
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
      await fetch(`http://${handle.host}:${handle.port}/api/${encoded}/x`).catch(() => undefined);
      expect(logs.length).toBeGreaterThan(0);
      const joined = logs.join('\n');
      expect(joined).not.toContain(TOKEN); // not the cleartext token
      expect(joined).not.toContain(encoded); // nor the reversible percent-encoded form
      expect(logs.some((l) => l.includes('<redacted>'))).toBe(true);
    } finally {
      await handle.close();
    }
  });
});
