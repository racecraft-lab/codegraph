import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { startWebServer, type WebServerHandle } from '../src/server/index';
import {
  buildReadRoutes,
  buildJobRoutes,
  type ReadApiDeps,
  type JobApiDeps,
} from '../src/server/routes';
import { JobRegistry, type JobDeps, type JobDescriptor } from '../src/server/jobs';
import type { SyncResult, IndexResult } from '../src/extraction';
import {
  buildFixtureIndex,
  startServerFixture,
  type FixtureIndex,
  type ServerFixture,
} from './helpers/server-fixture';

/**
 * SPEC-005 T009 — ship-check for the read-slice OpenAPI contract.
 *
 * The committed contract (`src/server/openapi.yaml`) must be copied into
 * `dist/server/` by `copy-assets` (Constitution VII: a static asset that isn't
 * in copy-assets doesn't ship), and the shipped copy must be well-formed YAML
 * documenting the eight read-tagged (Slice 1) paths.
 *
 * Zero-dep by design (FR-025 / plan.md "zero new deps"): the repo ships no YAML
 * parser, so this walks the document structurally rather than importing one.
 * T029 grows this file into the full contract walk against a running fixture.
 */

// The committed source and the shipped copy of the read-slice contract.
const SRC_SPEC = path.resolve(__dirname, '../src/server/openapi.yaml');
const DIST_SPEC = path.resolve(__dirname, '../dist/server/openapi.yaml');

// The eight read-tagged (Slice 1) paths this artifact must document.
const READ_PATHS = [
  '/api/status',
  '/api/repos',
  '/api/search',
  '/api/node/{id}',
  '/api/callers/{id}',
  '/api/callees/{id}',
  '/api/impact/{id}',
  '/api/graph/{id}',
];

// The two jobs-tagged (Slice 2, T041) path templates this artifact must document.
// `/api/reindex/{repo}` carries both POST (start) and GET (latest state); the
// `/events` template is the GET SSE stream.
const JOB_PATHS = ['/api/reindex/{repo}', '/api/reindex/{repo}/events'];

/**
 * Zero-dep structural read of the `paths:` block's child keys (the path
 * templates indented exactly two spaces under it). Throws on tab indentation
 * (YAML forbids tabs) or a missing `paths:` section, so a truncated/corrupt
 * shipped copy is caught. Not a general YAML parser — scoped to the assertion.
 */
function pathKeys(yaml: string): string[] {
  if (yaml.includes('\t')) throw new Error('YAML indentation must not use tabs');
  const lines = yaml.split(/\r?\n/);
  const start = lines.indexOf('paths:');
  if (start === -1) throw new Error('missing top-level `paths:` mapping');
  const keys: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) break; // next top-level key => end of the paths block
    const m = line.match(/^ {2}(\/[^:\s]+):\s*$/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

describe('openapi ship check', () => {
  it('commits the read-slice contract source at src/server/openapi.yaml', () => {
    expect(fs.existsSync(SRC_SPEC)).toBe(true);
  });

  it('ships dist/server/openapi.yaml via copy-assets, byte-identical to source', () => {
    expect(fs.existsSync(DIST_SPEC)).toBe(true);
    expect(fs.readFileSync(DIST_SPEC).equals(fs.readFileSync(SRC_SPEC))).toBe(true);
  });

  it('is well-formed YAML documenting exactly the 8 read + 2 jobs paths', () => {
    expect(fs.existsSync(DIST_SPEC)).toBe(true);
    const yaml = fs.readFileSync(DIST_SPEC, 'utf8');
    expect(yaml).toMatch(/^openapi:\s*3\.1\.0\s*$/m);
    expect(yaml).toMatch(/^components:\s*$/m);
    const keys = pathKeys(yaml);
    for (const p of READ_PATHS) expect(keys).toContain(p);
    for (const p of JOB_PATHS) expect(keys).toContain(p);
    expect(keys).toHaveLength(READ_PATHS.length + JOB_PATHS.length);
  });

  it('constrains Job.reason to the whitelisted enum (R4-REASON-ENUM)', () => {
    expect(fs.existsSync(DIST_SPEC)).toBe(true);
    // The terminal `reason` must be a CLOSED enum of exactly the three documented,
    // whitelisted reasons — never an unconstrained string (FR-015a/021/021a/023).
    const yaml = fs.readFileSync(DIST_SPEC, 'utf8');
    const m = yaml.match(/reason:\s*\n\s*type: string\s*\n\s*enum:\s*\[([^\]]*)\]/);
    expect(m, 'Job.reason enum not found in the shipped contract').toBeTruthy();
    const values = m![1].split(',').map((s) => s.trim()).sort();
    expect(values).toEqual(['aborted', 'index_failed', 'lock_unavailable']);
  });

  it('documents the Slice-2 /api/reindex jobs paths (T041)', () => {
    expect(fs.existsSync(DIST_SPEC)).toBe(true);
    // Assert on parsed path keys (not raw substrings) — the same no-parser
    // discipline as the read paths. Both jobs templates must be present, and
    // exactly those two carry `reindex`.
    const keys = pathKeys(fs.readFileSync(DIST_SPEC, 'utf8'));
    for (const p of JOB_PATHS) expect(keys).toContain(p);
    expect(keys.filter((k) => k.includes('reindex'))).toHaveLength(JOB_PATHS.length);
  });
});

// ===========================================================================
// T029 — full contract walk against a LIVE fixture server (FR-025, SC-005).
//
// The ship-check above proves the document is well-formed; this proves the
// RUNNING server CONFORMS to it. Stand up a real fixture server on `--port 0`
// and, for EVERY read-tagged path×method×status documented in
// src/server/openapi.yaml, issue a request that should produce that status and
// assert the response matches the documented shape:
//   • a 2xx body carries its schema's REQUIRED fields;
//   • every non-2xx is the closed `{ error: { code, message, details? } }`
//     envelope whose `code` is the documented status↔code.
// Includes the 503 (+Retry-After) on every daemon-forwarding read, the 400 on
// every parameter endpoint, the FR-004a `file:`+`%2F` round-trip, and the
// FR-017b traversal probe. The INVERSE walk enumerates the server's live `/api`
// route table and fails on any route the document omits (no undocumented
// routes). CI tolerates zero mismatches.
//
// Two servers, both `--port 0`, keyed on `fs.mkdtempSync` temp dirs (never this
// repo's own daemon): a "happy" server over a real warm daemon index (200/400/
// 404 + FR-004a/017b), and an "unavailable" server whose daemon-spawn seam
// THROWS so every forwarded read fails attach → the documented 503 — fast (the
// throw short-circuits the connect-poll budget, no multi-second wait).
//
// Zero-dep YAML reading, reusing the ship-check's no-parser discipline
// (`pathKeys`); the document is parsed structurally, never with a new dep.
// ===========================================================================

/** Loosen every wait on CI (cold caches, shared vCPUs) — mirrors the read-api suite. */
const CONTRACT_CI = !['', '0', 'false'].includes((process.env.CI ?? '').trim().toLowerCase());
const CT = (ms: number): number => ms * (CONTRACT_CI ? 4 : 1);

/** Each documented HTTP status → its error-envelope `code` (FR-015a code↔status). */
const CODE_BY_STATUS: Record<number, string> = {
  400: 'invalid_request',
  401: 'unauthorized',
  404: 'not_found',
  409: 'conflict',
  500: 'internal',
  503: 'unavailable',
};

/**
 * Zero-dep structural walk of the `paths:` tree (same no-parser discipline as
 * `pathKeys`): a path template (2-space key) → an HTTP method (4-space key) →
 * the set of documented response status codes (8-space `'NNN':` keys under that
 * method's `responses:`). Throws on tab indentation or a missing `paths:` block
 * so a corrupt/truncated document is caught. Not a general YAML parser — scoped
 * to the read-slice document's shape.
 */
function parseDocumentedResponses(yaml: string): Map<string, Map<string, Set<number>>> {
  if (yaml.includes('\t')) throw new Error('YAML indentation must not use tabs');
  const lines = yaml.split(/\r?\n/);
  const start = lines.indexOf('paths:');
  if (start === -1) throw new Error('missing top-level `paths:` mapping');
  const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);
  const out = new Map<string, Map<string, Set<number>>>();
  let curPath: string | null = null;
  let curMethod: string | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) break; // next top-level key => end of the paths block
    const pathM = line.match(/^ {2}(\/[^:\s]+):\s*$/);
    if (pathM) {
      curPath = pathM[1];
      curMethod = null;
      out.set(curPath, new Map());
      continue;
    }
    const methodM = line.match(/^ {4}([a-z]+):\s*$/);
    if (methodM && METHODS.has(methodM[1]) && curPath) {
      curMethod = methodM[1].toUpperCase();
      out.get(curPath)!.set(curMethod, new Set());
      continue;
    }
    const statusM = line.match(/^ {8}'(\d{3})':/);
    if (statusM && curPath && curMethod) out.get(curPath)!.get(curMethod)!.add(Number(statusM[1]));
  }
  return out;
}

/** The `ErrorEnvelope.code` enum read straight from the document (closed vocab). */
function parseErrorCodeEnum(yaml: string): string[] {
  const line = yaml
    .split(/\r?\n/)
    .find((l) => /enum:\s*\[[^\]]*invalid_request[^\]]*\]/.test(l));
  if (!line) throw new Error('ErrorEnvelope code enum not found in the document');
  return line.replace(/^.*\[/, '').replace(/\].*$/, '').split(',').map((s) => s.trim());
}

// Parsed once from the COMMITTED source (available before the build, so the
// it.each rows are known at collection time).
const CONTRACT_YAML = fs.readFileSync(SRC_SPEC, 'utf8');
const DOCUMENTED = parseDocumentedResponses(CONTRACT_YAML);
const ERROR_CODE_ENUM = new Set(parseErrorCodeEnum(CONTRACT_YAML));

/** Flattened `[path, method, status]` rows — the forward walk's row set. */
const TUPLES: Array<[string, string, number]> = [];
for (const [p, methods] of DOCUMENTED)
  for (const [m, statuses] of methods) for (const s of statuses) TUPLES.push([p, m, s]);

// Partition the documented tuples by slice: the read walk (GET-only, JSON body
// walk against the happy/unavailable fixtures) and the jobs walk (POST/GET +
// SSE, exercised against a controllable-job fixture). Both are derived from the
// SAME committed document, so a tuple can never fall through a gap between them.
const READ_PATH_SET = new Set(READ_PATHS);
const JOB_PATH_SET = new Set(JOB_PATHS);
const READ_TUPLES = TUPLES.filter(([p]) => READ_PATH_SET.has(p));
const JOB_TUPLES = TUPLES.filter(([p]) => JOB_PATH_SET.has(p));

/**
 * The jobs contract as the implementation actually behaves (T041). Hardcoded so
 * this fails LOUDLY while the document still omits the jobs surface (RED), and
 * pins the adaptation from the design source: the jobs POST/GET run wholly in
 * the serve process against the in-memory registry (no daemon forwarding at
 * request time), so — unlike every read path — they carry NO 503 `unavailable`.
 */
const EXPECTED_JOB_TUPLES = [
  '/api/reindex/{repo} GET 200',
  '/api/reindex/{repo} GET 404',
  '/api/reindex/{repo} POST 202',
  '/api/reindex/{repo} POST 404',
  '/api/reindex/{repo} POST 409',
  '/api/reindex/{repo}/events GET 200',
  '/api/reindex/{repo}/events GET 404',
].sort();

/** One fetched response, reduced to what the contract assertions need. */
interface Fetched {
  status: number;
  body: any;
  ct: string | null;
  retryAfter: string | null;
}

async function httpGet(baseURL: string, p: string): Promise<Fetched> {
  const res = await fetch(`${baseURL}${p}`);
  const ct = res.headers.get('content-type');
  const retryAfter = res.headers.get('retry-after');
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body, ct, retryAfter };
}

// ---- schema validators: the REQUIRED fields of each documented schema --------
function isNode(n: any): void {
  expect(n === null || typeof n !== 'object').toBe(false);
  expect(typeof n.id).toBe('string');
  expect(typeof n.kind).toBe('string');
  expect(typeof n.name).toBe('string');
}
function isEdge(e: any): void {
  expect(typeof e.source).toBe('string');
  expect(typeof e.target).toBe('string');
  expect(typeof e.kind).toBe('string');
}
function assertListResult(b: any): void {
  expect(Array.isArray(b.items)).toBe(true);
  (b.items as any[]).forEach(isNode);
  expect(typeof b.total).toBe('number');
  expect(typeof b.limit).toBe('number');
  expect(typeof b.offset).toBe('number');
}
function assertGraphResult(b: any): void {
  expect(Array.isArray(b.nodes)).toBe(true);
  (b.nodes as any[]).forEach(isNode);
  expect(Array.isArray(b.edges)).toBe(true);
  (b.edges as any[]).forEach(isEdge);
  expect(typeof b.truncated).toBe('boolean');
}
function assertStatus(b: any): void {
  expect(typeof b.version).toBe('string');
  expect(b.version.length).toBeGreaterThan(0);
  expect(typeof b.repo).toBe('object');
  expect(b.repo).not.toBeNull();
  expect(typeof b.repo.id).toBe('string');
  expect(typeof b.repo.root).toBe('string');
  expect(typeof b.repo.name).toBe('string');
  expect(typeof b.index).toBe('object');
  expect(b.index).not.toBeNull();
  expect(typeof b.index.state).toBe('string');
  expect(typeof b.index.fileCount).toBe('number');
  expect(typeof b.index.nodeCount).toBe('number');
  expect(typeof b.index.edgeCount).toBe('number');
}
function assertRepoArray(b: any): void {
  expect(Array.isArray(b)).toBe(true);
  expect(b.length).toBeGreaterThanOrEqual(1);
  for (const r of b as any[]) {
    expect(typeof r.id).toBe('string');
    expect(typeof r.root).toBe('string');
    expect(typeof r.name).toBe('string');
    expect(typeof r.default).toBe('boolean');
  }
}

/** Validate a documented 2xx body against its schema's REQUIRED fields. */
function assert2xxBody(pathKey: string, b: any): void {
  switch (pathKey) {
    case '/api/status':
      return assertStatus(b);
    case '/api/repos':
      return assertRepoArray(b);
    case '/api/search':
      assertListResult(b);
      if ('degraded' in b) expect(typeof b.degraded).toBe('boolean');
      return;
    case '/api/node/{id}':
      return isNode(b);
    case '/api/callers/{id}':
    case '/api/callees/{id}':
      return assertListResult(b);
    case '/api/impact/{id}':
    case '/api/graph/{id}':
      return assertGraphResult(b);
    default:
      throw new Error(`no 2xx validator wired for ${pathKey}`);
  }
}

/** Validate a documented non-2xx as the closed error envelope with the right code. */
function assertErrorEnvelope(status: number, f: Fetched): void {
  const b = f.body;
  expect(typeof b).toBe('object');
  expect(b).not.toBeNull();
  // Exactly `{ error }` — no stray top-level keys.
  expect(Object.keys(b)).toEqual(['error']);
  expect(typeof b.error.code).toBe('string');
  expect(ERROR_CODE_ENUM.has(b.error.code)).toBe(true); // in the documented enum
  expect(b.error.code).toBe(CODE_BY_STATUS[status]); // status↔code
  expect(typeof b.error.message).toBe('string');
  expect(b.error.message.length).toBeGreaterThan(0);
  if ('details' in b.error) {
    expect(typeof b.error.details).toBe('object');
    expect(b.error.details).not.toBeNull();
  }
  // Every documented 503 carries a positive-integer Retry-After (FR-015a).
  if (status === 503) {
    const ra = Number(f.retryAfter);
    expect(Number.isInteger(ra)).toBe(true);
    expect(ra).toBeGreaterThan(0);
  }
}

async function waitForStatus200(baseURL: string, budgetMs: number): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      if ((await fetch(`${baseURL}/api/status`)).status === 200) return;
    } catch {
      /* server/daemon not warm yet */
    }
    if (Date.now() - started > budgetMs) {
      throw new Error(`/api/status never reached 200 within ${budgetMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Look up a symbol's opaque node id via the search endpoint (a realistic flow). */
async function idOf(baseURL: string, name: string): Promise<string> {
  const f = await httpGet(baseURL, `/api/search?q=${encodeURIComponent(name)}&limit=50`);
  const hit = (f.body.items as Array<{ id: string; name: string; kind: string }>).find(
    (n) => n.name === name && n.kind !== 'import',
  );
  if (!hit) throw new Error(`no search hit for ${name}: ${JSON.stringify(f.body?.items)}`);
  return hit.id;
}

describe('SPEC-005 OpenAPI contract walk (T029, FR-025/SC-005)', () => {
  /**
   * A fixture with a known call graph: `subHelper` (in a subdir, so its file
   * node id `file:src/util.ts` carries a slash for the %2F round-trip) is called
   * by `helper` and `useSub`; `helper` is called by `caller`.
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

  let happy: ServerFixture;
  let happyBase: string;
  let unavailIndex: FixtureIndex;
  let unavailHandle: WebServerHandle;
  let unavailBase: string;
  const matrix = new Map<string, () => Promise<Fetched>>();

  beforeAll(async () => {
    // Happy path: a real warm daemon index over the known call graph.
    happy = await startServerFixture({ files: READ_FIXTURE_FILES });
    happyBase = happy.baseURL;
    await waitForStatus200(happyBase, CT(40000));

    // Unavailable path: a real index whose daemon-spawn seam THROWS, so every
    // forwarded read fails attach and maps to the documented 503 — the throw
    // short-circuits the connect-poll budget, so this is fast, not a 6s wait.
    unavailIndex = await buildFixtureIndex();
    unavailHandle = await startWebServer({
      port: 0,
      projectPath: unavailIndex.root,
      spawnDaemon: () => {
        throw new Error('contract fixture: daemon spawn disabled (503 probe)');
      },
    });
    unavailBase = `http://${unavailHandle.host}:${unavailHandle.port}`;

    const subId = await idOf(happyBase, 'subHelper');
    const helperId = await idOf(happyBase, 'helper');

    // The request matrix: exactly one crafted request per documented (path,
    // status). `H` hits the happy server; `U` the unavailable one (503 probe).
    const H = (p: string) => (): Promise<Fetched> => httpGet(happyBase, p);
    const U = (p: string) => (): Promise<Fetched> => httpGet(unavailBase, p);
    const enc = encodeURIComponent;
    const UNKNOWN = 'function:00000000000000000000000000000000'; // well-formed, absent
    const BAD_REPO = 'zzzzzzzzzzzzzzzz'; // fails ^[0-9a-f]{16}$ → 404 repo (FR-011)

    matrix.set('/api/status 200', H('/api/status'));
    matrix.set('/api/status 503', U('/api/status'));
    matrix.set('/api/repos 200', H('/api/repos'));
    matrix.set('/api/search 200', H('/api/search?q=subHelper'));
    matrix.set('/api/search 400', H('/api/search')); // absent required q
    matrix.set('/api/search 404', H(`/api/search?q=subHelper&repo=${BAD_REPO}`));
    matrix.set('/api/search 503', U('/api/search?q=subHelper'));
    matrix.set('/api/node/{id} 200', H(`/api/node/${enc(subId)}`));
    matrix.set('/api/node/{id} 404', H(`/api/node/${UNKNOWN}`));
    matrix.set('/api/node/{id} 503', U(`/api/node/${UNKNOWN}`));
    matrix.set('/api/callers/{id} 200', H(`/api/callers/${enc(subId)}`));
    matrix.set('/api/callers/{id} 400', H(`/api/callers/${enc(subId)}?limit=-1`)); // negative limit
    matrix.set('/api/callers/{id} 404', H(`/api/callers/${UNKNOWN}`));
    matrix.set('/api/callers/{id} 503', U(`/api/callers/${UNKNOWN}`));
    matrix.set('/api/callees/{id} 200', H(`/api/callees/${enc(helperId)}`));
    matrix.set('/api/callees/{id} 400', H(`/api/callees/${enc(helperId)}?limit=abc`)); // malformed limit
    matrix.set('/api/callees/{id} 404', H(`/api/callees/${UNKNOWN}`));
    matrix.set('/api/callees/{id} 503', U(`/api/callees/${UNKNOWN}`));
    matrix.set('/api/impact/{id} 200', H(`/api/impact/${enc(subId)}`));
    matrix.set('/api/impact/{id} 400', H(`/api/impact/${enc(subId)}?depth=-1`)); // negative depth
    matrix.set('/api/impact/{id} 404', H(`/api/impact/${UNKNOWN}`));
    matrix.set('/api/impact/{id} 503', U(`/api/impact/${UNKNOWN}`));
    matrix.set('/api/graph/{id} 200', H(`/api/graph/${enc(subId)}`));
    matrix.set('/api/graph/{id} 400', H(`/api/graph/${enc(subId)}?depth=abc`)); // malformed depth
    matrix.set('/api/graph/{id} 404', H(`/api/graph/${UNKNOWN}`));
    matrix.set('/api/graph/{id} 503', U(`/api/graph/${UNKNOWN}`));
  }, CT(90000));

  afterAll(async () => {
    if (happy) await happy.teardown();
    if (unavailHandle) {
      try {
        await unavailHandle.close();
      } catch {
        /* already closed */
      }
    }
    if (unavailIndex) unavailIndex.cleanup();
  });

  // ---- forward walk: every documented READ tuple → correct live status + shape ----
  it.each(READ_TUPLES)(
    'conforms: GET %s → documented %s (live status + response schema)',
    async (pathKey, method, status) => {
      expect(method).toBe('GET'); // the read slice is GET-only
      const req = matrix.get(`${pathKey} ${status}`);
      expect(req, `no request crafted for ${method} ${pathKey} ${status}`).toBeTruthy();
      const f = await req!();
      expect(f.status, `${method} ${pathKey} should produce ${status}`).toBe(status);
      expect(f.ct).toContain('application/json'); // every /api response is JSON
      if (status < 300) assert2xxBody(pathKey, f.body);
      else assertErrorEnvelope(status, f);
    },
    CT(30000),
  );

  // ---- completeness: the crafted matrix EQUALS the documented tuple set ----
  // Removing a documented status (or adding an undocumented probe) fails here,
  // so the forward walk can never silently skip a documented behavior.
  it('crafts exactly the documented READ tuples — no gap, no undocumented probe', () => {
    const documentedKeys = READ_TUPLES.map(([p, , s]) => `${p} ${s}`).sort();
    const matrixKeys = [...matrix.keys()].sort();
    expect(matrixKeys).toEqual(documentedKeys);
  });

  it('documents every read path as GET-only', () => {
    for (const [p, methods] of DOCUMENTED) {
      if (!READ_PATH_SET.has(p)) continue; // jobs paths carry POST — asserted below
      expect([...methods.keys()], `methods for ${p}`).toEqual(['GET']);
    }
  });

  // ---- inverse walk: every LIVE /api route is documented, read + jobs (no undocumented routes) ----
  it('every live /api route (read + jobs) is documented, and every documented (path,method) is live', () => {
    const readStub: ReadApiDeps = {
      version: '0.0.0',
      defaultRepo: { id: '0'.repeat(16), root: '/does/not/exist', name: 'x' },
      resolveRepo: () => null,
      getClient: () => Promise.reject(new Error('stub — never invoked by route enumeration')),
      evictClient: () => {}, // never invoked by route enumeration
      isRepoIndexed: () => false,
    };
    const jobStub: JobApiDeps = { resolveRepo: () => null, registry: new JobRegistry() };
    const live = [...buildReadRoutes(readStub), ...buildJobRoutes(jobStub)].map((r) => ({
      // `/api/node/:id` → `/api/node/{id}` (the OpenAPI path-template form).
      key: `${r.method} ${r.pattern.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`,
    }));
    const liveKeys = new Set(live.map((r) => r.key));

    // Every documented (path, method) pair, flattened.
    const documentedKeys = new Set<string>();
    for (const [p, methods] of DOCUMENTED) for (const m of methods.keys()) documentedKeys.add(`${m} ${p}`);

    // (a) no undocumented live route.
    for (const k of liveKeys) {
      expect(documentedKeys.has(k), `live route ${k} is undocumented`).toBe(true);
    }
    // (b) no documented-but-unimplemented (path, method).
    for (const k of documentedKeys) {
      expect(liveKeys.has(k), `documented ${k} has no live route`).toBe(true);
    }
    // Full (path, method) bijection across read + jobs.
    expect([...liveKeys].sort()).toEqual([...documentedKeys].sort());
  });

  // ---- FR-004a: percent-encoded slash in a file: id round-trips ----
  it('FR-004a: a file: node id with a %2F-encoded slash round-trips to the right node', async () => {
    const f = await httpGet(happyBase, '/api/node/file:src%2Futil.ts');
    expect(f.status).toBe(200);
    expect(f.body.id).toBe('file:src/util.ts');
    expect(f.body.kind).toBe('file');
    isNode(f.body);
  }, CT(20000));

  // ---- FR-017b: a static-mount traversal probe never escapes the web root ----
  it('FR-017b: a path-traversal probe is the 404 route envelope, never out-of-root file bytes', async () => {
    // `%2e%2e%2f…` decodes to `../../etc/passwd`; the static mount confines it
    // and 404s identically to any other miss — never the target file's contents.
    const f = await httpGet(happyBase, '/%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    expect(f.status).toBe(404);
    expect(f.ct).toContain('application/json');
    assertErrorEnvelope(404, f);
    expect(f.body.error.details?.resource).toBe('route');
    // A leaked /etc/passwd would contain a `root:` line; the envelope never does.
    expect(JSON.stringify(f.body)).not.toContain('root:');
  }, CT(20000));
});

// ===========================================================================
// T041 — jobs (Slice 2) contract walk against a LIVE fixture server.
//
// The read walk above proves the running server conforms to the read-tagged
// paths; this proves it conforms to the jobs-tagged surface the document now
// documents (POST/GET /api/reindex/{repo}, GET /api/reindex/{repo}/events).
// Unlike the read paths, the jobs handlers run wholly in the serve process
// against the in-memory job registry — no daemon forwarding at request time —
// so there is NO 503 to walk. A controllable `runIndex` seam keeps the job in
// `running` so 202 / 409 / SSE-200 are all observable deterministically.
// ===========================================================================

/** A `runIndex` that stays running until released (or the abort signal fires). */
function controllableJobDeps(): { deps: Partial<JobDeps>; release: () => void } {
  let releaseFn: (v: SyncResult | IndexResult) => void = () => undefined;
  const released = new Promise<SyncResult | IndexResult>((res) => { releaseFn = res; });
  const deps: Partial<JobDeps> = {
    runIndex: (_root, _mode, _onProgress, signal) =>
      Promise.race([
        released,
        new Promise<SyncResult | IndexResult>((_res, rej) =>
          signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true }),
        ),
      ]),
    isLockHeld: () => false,
    rearmWatcher: () => undefined,
  };
  const syncResult: SyncResult = {
    filesChecked: 1, filesAdded: 0, filesModified: 0, filesRemoved: 0, nodesUpdated: 0, durationMs: 5,
  };
  return { deps, release: () => releaseFn(syncResult) };
}

/** Validate a documented job descriptor (Job schema REQUIRED fields). */
function assertJob(b: any): void {
  expect(typeof b).toBe('object');
  expect(b).not.toBeNull();
  expect(typeof b.id).toBe('string');
  expect(b.id.length).toBeGreaterThan(0);
  expect(typeof b.repo).toBe('string');
  expect(['sync', 'full']).toContain(b.mode);
  expect(['running', 'done', 'error']).toContain(b.status);
  expect(typeof b.startedAt).toBe('string');
  expect(Number.isNaN(Date.parse(b.startedAt))).toBe(false);
}

const UNREGISTERED_REPO = 'ffffffffffffffff'; // well-formed 16-hex, not in the registry

describe('SPEC-005 OpenAPI jobs contract walk (T041, FR-020/022/023/024)', () => {
  const jobFixtures: ServerFixture[] = [];
  async function jobServer(): Promise<{ fx: ServerFixture; release: () => void }> {
    const ctl = controllableJobDeps();
    const fx = await startServerFixture({ jobDeps: ctl.deps });
    jobFixtures.push(fx);
    return { fx, release: ctl.release };
  }
  afterEach(async () => {
    while (jobFixtures.length) {
      const fx = jobFixtures.pop()!;
      try {
        await fx.teardown();
      } catch {
        /* already gone */
      }
    }
  });

  // ---- completeness: the documented jobs tuples EQUAL the adapted design set ----
  // Fails LOUDLY while the document still omits the jobs surface (RED), and pins
  // the no-503 adaptation from the design source.
  it('documents exactly the adapted jobs tuples (no 503 on the in-process jobs surface)', () => {
    const documentedJobKeys = JOB_TUPLES.map(([p, m, s]) => `${p} ${m} ${s}`).sort();
    expect(documentedJobKeys).toEqual(EXPECTED_JOB_TUPLES);
  });

  it('POST /api/reindex/{repo} → 202 running descriptor (default mode sync)', async () => {
    const { fx, release } = await jobServer();
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as JobDescriptor;
    assertJob(body);
    expect(body.repo).toBe(fx.repoId);
    expect(body.mode).toBe('sync');
    expect(body.status).toBe('running');
    release();
  }, CT(30000));

  it('POST /api/reindex/{repo} → 409 conflict while a job is active', async () => {
    const { fx, release } = await jobServer();
    const first = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    expect(first.status).toBe(202);
    const second = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    expect(second.status).toBe(409);
    expect(second.headers.get('content-type')).toContain('application/json');
    const f: Fetched = {
      status: second.status,
      body: await second.json(),
      ct: second.headers.get('content-type'),
      retryAfter: second.headers.get('retry-after'),
    };
    assertErrorEnvelope(409, f);
    release();
  }, CT(30000));

  it('POST /api/reindex/{repo} → 404 not_found (resource:repo) for an unregistered repo', async () => {
    const { fx } = await jobServer();
    const res = await fetch(`${fx.baseURL}/api/reindex/${UNREGISTERED_REPO}`, { method: 'POST' });
    expect(res.status).toBe(404);
    const f: Fetched = {
      status: res.status,
      body: await res.json(),
      ct: res.headers.get('content-type'),
      retryAfter: res.headers.get('retry-after'),
    };
    assertErrorEnvelope(404, f);
    expect(f.body.error.details?.resource).toBe('repo');
  }, CT(30000));

  it('GET /api/reindex/{repo} → 200 latest job state', async () => {
    const { fx, release } = await jobServer();
    await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    assertJob(await res.json());
    release();
  }, CT(30000));

  it('GET /api/reindex/{repo} → 404 for a registered repo with no job, and for an unregistered repo', async () => {
    const { fx } = await jobServer();
    // Registered repo, no job on record yet → 404 resource:repo (deliberately
    // indistinguishable from unregistered, FR-024).
    const noJob = await httpGet(fx.baseURL, `/api/reindex/${fx.repoId}`);
    expect(noJob.status).toBe(404);
    assertErrorEnvelope(404, noJob);
    expect(noJob.body.error.details?.resource).toBe('repo');
    // Unregistered repo → the same 404 resource:repo.
    const unknown = await httpGet(fx.baseURL, `/api/reindex/${UNREGISTERED_REPO}`);
    expect(unknown.status).toBe(404);
    assertErrorEnvelope(404, unknown);
    expect(unknown.body.error.details?.resource).toBe('repo');
  }, CT(30000));

  it('GET /api/reindex/{repo}/events → 200 with the documented SSE headers', async () => {
    const { fx, release } = await jobServer();
    await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    // Read only the headers, then abort the long-lived stream.
    const ac = new AbortController();
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}/events`, { signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(String(res.headers.get('connection')).toLowerCase()).toContain('keep-alive');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    ac.abort();
    release();
  }, CT(30000));

  it('GET /api/reindex/{repo}/events → 404 (resource:repo) for an unregistered repo', async () => {
    const { fx } = await jobServer();
    const f = await httpGet(fx.baseURL, `/api/reindex/${UNREGISTERED_REPO}/events`);
    expect(f.status).toBe(404);
    expect(f.ct).toContain('application/json');
    assertErrorEnvelope(404, f);
    expect(f.body.error.details?.resource).toBe('repo');
  }, CT(30000));
});
