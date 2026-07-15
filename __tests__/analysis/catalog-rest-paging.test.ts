/**
 * SPEC-011 (PR #50 review) — REST catalog paging is COERCED, never a 4xx.
 *
 * `/api/flows` and `/api/clusters` reused the SPEC-005 `parsePaging`, which 400s on
 * a malformed/negative `limit`/`offset`. But the SPEC-011 REST contract
 * (rest-api.md, openapi.yaml) and the MCP tool coerce these params — floor + clamp,
 * missing/non-numeric → default — and never a 4xx (FR-030), so the two surfaces
 * stay in parity (FR-028a). This drives the real HTTP surface (routes → daemon →
 * catalog-store) and asserts a malformed page param yields 200 with the coerced
 * effective envelope, not the old 400.
 *
 * Real fixture server + real daemon on `--port 0` (no mocking); the fixture repo
 * does not opt into the catalogs, so the read is a success-shaped inert envelope
 * that still echoes the coerced `limit`/`offset` (readFlowList echoes them in every
 * state) — exactly what the paging assertion needs.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startServerFixture, type ServerFixture } from '../helpers/server-fixture';
import { startWebServer, type WebServerHandle } from '../../src/server/index';

/** Loosen waits on CI (cold caches, shared vCPUs) — mirrors the server suites. */
const CI = !['', '0', 'false'].includes((process.env.CI ?? '').trim().toLowerCase());
const CT = (ms: number): number => ms * (CI ? 4 : 1);

/** Poll `/api/status` until the forwarding daemon is warm (200), or time out. */
async function waitForStatus200(baseURL: string, budgetMs: number): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      if ((await fetch(`${baseURL}/api/status`)).status === 200) return;
    } catch {
      /* server/daemon not warm yet */
    }
    if (Date.now() - started > budgetMs) throw new Error(`/api/status never reached 200 in ${budgetMs}ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('SPEC-011 REST catalog paging coercion (PR #50 review, FR-028a/030)', () => {
  let fx: ServerFixture | undefined;
  afterEach(async () => {
    if (fx) await fx.teardown();
    fx = undefined;
  });

  async function get(p: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${fx!.baseURL}${p}`);
    return { status: res.status, body: await res.json().catch(() => undefined) };
  }

  it('GET /api/flows coerces malformed/edge paging to 200 (never 400)', async () => {
    fx = await startServerFixture();
    await waitForStatus200(fx.baseURL, CT(40000));

    // Malformed (non-numeric) + negative: the old parsePaging 400'd; now coerced.
    const bad = await get('/api/flows?limit=abc&offset=-1');
    expect(bad.status).toBe(200);
    expect(bad.body.limit).toBe(100); // non-numeric → default 100
    expect(bad.body.offset).toBe(0); // negative → clamp 0

    // Explicit limit=0 clamps to 1 (parity with the MCP tool), not the default.
    const zero = await get('/api/flows?limit=0');
    expect(zero.status).toBe(200);
    expect(zero.body.limit).toBe(1);

    // Over-cap clamps to 500, never errors.
    const over = await get('/api/flows?limit=9999');
    expect(over.status).toBe(200);
    expect(over.body.limit).toBe(500);
  }, CT(60000));

  it('GET /api/clusters coerces malformed limit/offset/minSize to 200 (never 400)', async () => {
    fx = await startServerFixture();
    await waitForStatus200(fx.baseURL, CT(40000));

    const bad = await get('/api/clusters?limit=0&offset=abc&minSize=xyz');
    expect(bad.status).toBe(200);
    expect(bad.body.limit).toBe(1); // 0 → clamp 1
    expect(bad.body.offset).toBe(0); // non-numeric → default 0
    // minSize is coerced to 1 (default) — the read succeeds rather than 400.
  }, CT(60000));
});

/**
 * PR #50 review — an UNINDEXED project's catalog endpoints must return the
 * success-shaped `not_indexed` result (200), NOT a 503. An unindexed root has no
 * daemon to attach to, so the catalog handlers must check `isRepoIndexed` BEFORE
 * the attach (the daemon-side readOnMissingIndex is never reached) — mirroring
 * how /api/status reports an un-indexed startup repo (FR-030).
 */
describe('SPEC-011 REST catalog on an UNINDEXED project (PR #50 review, FR-030)', () => {
  let handle: WebServerHandle | undefined;
  let dir: string | undefined;
  afterEach(async () => {
    if (handle) {
      try {
        await handle.close();
      } catch {
        /* already closed */
      }
    }
    handle = undefined;
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    dir = undefined;
  });

  it('returns 200 not_indexed for /api/flows, /api/clusters, /api/flows/{id} — never 503', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-unindexed-'));
    handle = await startWebServer({ port: 0, projectPath: dir });
    const base = `http://${handle.host}:${handle.port}`;

    const flows = await fetch(`${base}/api/flows`);
    expect(flows.status).toBe(200); // not a 503
    expect((await flows.json()).state).toBe('not_indexed');

    const clusters = await fetch(`${base}/api/clusters`);
    expect(clusters.status).toBe(200);
    expect((await clusters.json()).state).toBe('not_indexed');

    const detail = await fetch(`${base}/api/flows/flow:anything`);
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.found).toBe(false);
    expect(body.state).toBe('not_indexed');
  }, CT(30000));
});
