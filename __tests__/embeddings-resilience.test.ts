/**
 * Embedding backfill & abort/resume resilience — SPEC-001 Slice B / User Story 3
 * (T028/T029 late-config backfill, T030/T031 abort & resume).
 *
 * Slice A embeds on a full index; Slice B (embeddings-sync.test.ts) keeps the
 * vector layer current on every incremental sync. This suite pins the LAST two
 * User-Story-3 guarantees, both of which fall out of the SAME unified pass +
 * unconditional sync() slot rather than any bespoke machinery:
 *
 *   • Late-config backfill (T028/T029, US3-AS1): a project indexed with the
 *     feature OFF carries zero vectors; the moment the endpoint is configured, a
 *     single ORDINARY `cg.sync()` — the exact call the CLI, watcher, and daemon
 *     already make — heals it to 100% coverage. No `codegraph embed --backfill`
 *     command exists or is needed (SC-004/FR-018).
 *
 *   • Abort & resume (T030/T031, US3 resilience): an endpoint that dies mid-pass
 *     never fails the enclosing index/sync (advisory abort, FR-014/019/020); the
 *     batches that DID complete are durable; and a later plain `cg.sync()` resumes
 *     to 100% by re-selecting only the still-missing symbols — there is NO
 *     persisted checkpoint/cursor anywhere, so "resume" is just the ordinary
 *     missing-vector selection running again (SC-005/FR-021, T031). A dimension
 *     that changes on a later batch aborts naming CODEGRAPH_EMBEDDING_DIMS while
 *     the earlier batch's vectors survive (FR-021).
 *
 * Library-level tests drive the WHOLE stack (real temp project + CodeGraph.init/
 * open + indexAll/sync against a local node:http mock) exactly like the T019/T024/
 * T026 harnesses. The bounded-abort and later-batch-dimension tests drive
 * `runEmbeddingPass` directly against a REAL EndpointProvider (with tiny test-only
 * backoff overrides) + a scripted mock — the only way to observe the abort reason
 * and to prove the retry budget is bounded without paying production backoff.
 *
 * Real SQLite, real temp files, real HTTP — no DB mocking (repo convention).
 * Skipped where `node:sqlite` is unavailable (Node < 22.5).
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseConnection, getDatabasePath } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import { CodeGraph } from '../src';
import type { Node, NodeKind } from '../src/types';
import type { EmbeddingConfig } from '../src/embeddings/config';
import { runEmbeddingPass } from '../src/embeddings/indexer-hook';
import type { RunEmbeddingPassOptions } from '../src/embeddings/indexer-hook';
import { EndpointProvider } from '../src/embeddings/endpoint-provider';
import { setLogger, getLogger } from '../src/errors';

let HAS_SQLITE = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:sqlite');
  HAS_SQLITE = true;
} catch {
  HAS_SQLITE = false;
}

// --- Shared mock + env constants (file scope; each describe owns its own state) ---

/** Vector length the mock returns by default; also the inferred dims when DIMS is unset. */
const MOCK_DIMS = 4;

const EMBED_ENV_KEYS = [
  'CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL', 'CODEGRAPH_EMBEDDING_API_KEY',
  'CODEGRAPH_EMBEDDING_DIMS', 'CODEGRAPH_EMBEDDING_BATCH_SIZE', 'CODEGRAPH_EMBEDDING_CONCURRENCY',
  'CODEGRAPH_EMBEDDING_TIMEOUT_MS',
];

interface EmbedReply {
  status: number;
  body?: string;
}
interface EmbedMock {
  origin: string;
  /** Every request's raw JSON body (for symbol-name extraction). */
  requests: Array<{ body: string }>;
  requestCount: () => number;
  close: () => Promise<void>;
}

/**
 * A local OpenAI-compatible embeddings endpoint that RECORDS every request body and
 * maps the decoded `input[]` + 1-based request count to an HTTP result via `reply`.
 * The `reply` closure holds the test's mutable script (heal a dead endpoint, switch
 * the returned dimension on a later batch, …). Registered into `mocks` for teardown.
 */
async function startEmbedMock(
  mocks: EmbedMock[],
  reply: (inputs: string[], count: number) => EmbedReply,
): Promise<EmbedMock> {
  const requests: Array<{ body: string }> = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ body });
      let inputs: string[] = [];
      try {
        inputs = (JSON.parse(body) as { input?: string[] }).input ?? [];
      } catch {
        /* leave inputs empty — the reply decides what to send */
      }
      const r = reply(inputs, requests.length);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(r.body ?? '');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const mock: EmbedMock = {
    origin: `http://127.0.0.1:${port}`,
    requests,
    requestCount: () => requests.length,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
  mocks.push(mock);
  return mock;
}

/** 200 with exactly one `dims`-length vector per input (count MUST match, FR-021a). */
function embedOk(inputs: string[], dims = MOCK_DIMS): EmbedReply {
  const data = inputs.map((_t, index) => ({
    index,
    embedding: Array.from({ length: dims }, (_v, k) => k + index * 0.5),
  }));
  return { status: 200, body: JSON.stringify({ data, model: 'test-model' }) };
}

/** The `name:` field composed into a symbol's embedding input (its 2nd line). */
function nameOfInput(composed: string): string {
  const m = /^name: (.+)$/m.exec(composed);
  return m ? m[1]! : '<unknown>';
}

/** Symbol names carried by every request body recorded AT/AFTER `since` (a request index). */
function embeddedNamesSince(mock: EmbedMock, since: number): string[] {
  const names: string[] = [];
  for (const req of mock.requests.slice(since)) {
    let inputs: string[] = [];
    try {
      inputs = (JSON.parse(req.body) as { input?: string[] }).input ?? [];
    } catch {
      /* a malformed body carries no symbols */
    }
    for (const composed of inputs) names.push(nameOfInput(composed));
  }
  return names;
}

// =============================================================================
// Library-level backfill & resume (T028/T029/T030/T031). Real temp project +
// CodeGraph.init/open + indexAll/sync against the recording mock. The base
// project defines exactly the six embeddable declarations pinned in EXPECTED_NAMES.
// =============================================================================
describe.skipIf(!HAS_SQLITE)('embedding backfill & resume — library level (T028/T029/T030/T031)', () => {
  /** The six embeddable declarations (four functions + two consts) the base project defines. */
  const EXPECTED_NAMES = ['add', 'mul', 'greet', 'shout', 'PI', 'E'];

  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];
  const inspectConns: DatabaseConnection[] = [];
  const mocks: EmbedMock[] = [];
  let savedEnv: Record<string, string | undefined> = {};
  let savedLogger: ReturnType<typeof getLogger>;

  /** Point the embedding config at the mock under a given active model. */
  function configureEndpoint(mock: EmbedMock, model = 'test-model'): void {
    process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings`;
    process.env.CODEGRAPH_EMBEDDING_MODEL = model;
  }

  /** The base project: two multi-symbol files + one control file, all with unique names. */
  function baseFiles(): Record<string, string> {
    return {
      'calc.ts':
        'export function add(a: number, b: number): number {\n  return a + b;\n}\n' +
        'export function mul(a: number, b: number): number {\n  return a * b;\n}\n',
      'text.ts':
        'export function greet(name: string): string {\n  return "hi " + name;\n}\n' +
        'export function shout(msg: string): string {\n  return msg.toUpperCase();\n}\n',
      'consts.ts':
        'export const PI = 3.14159;\n' +
        'export const E = 2.71828;\n',
    };
  }

  function makeProject(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-embed-resilience-'));
    dirs.push(dir);
    const srcDir = path.join(dir, 'src');
    fs.mkdirSync(srcDir);
    for (const [rel, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(srcDir, rel), content);
    }
    return dir;
  }

  /** open + a single incremental sync (which runs the advisory embed pass) + close. */
  async function syncOnce(dir: string): Promise<void> {
    const cg = await CodeGraph.open(dir);
    graphs.push(cg);
    await cg.sync();
    cg.close();
  }

  interface VecByName {
    nodeId: string;
    model: string;
    inputHash: string;
    vector: Buffer;
  }
  /** Live-node vectors keyed by symbol name (JOIN drops orphan rows), via a fresh connection. */
  function readVectorsByName(dir: string): Map<string, VecByName> {
    const conn = DatabaseConnection.open(getDatabasePath(dir));
    inspectConns.push(conn);
    const rows = conn.getDb().prepare(
      `SELECT n.name AS name, v.node_id AS node_id, v.model AS model,
              v.input_hash AS input_hash, v.vector AS vector
       FROM node_vectors v JOIN nodes n ON n.id = v.node_id`,
    ).all() as Array<{ name: string; node_id: string; model: string; input_hash: string; vector: Uint8Array }>;
    const map = new Map<string, VecByName>();
    for (const r of rows) {
      map.set(r.name, { nodeId: r.node_id, model: r.model, inputHash: r.input_hash, vector: Buffer.from(r.vector) });
    }
    return map;
  }

  /** EVERY node_vectors row (incl. any orphan), via a fresh connection. */
  function readAllVectorRows(dir: string): Array<{ node_id: string; model: string }> {
    const conn = DatabaseConnection.open(getDatabasePath(dir));
    inspectConns.push(conn);
    return conn.getDb()
      .prepare('SELECT node_id, model FROM node_vectors')
      .all() as Array<{ node_id: string; model: string }>;
  }

  /** Every project_metadata key, via a fresh connection — for the "no persisted state" proof. */
  function readMetadataKeys(dir: string): string[] {
    const conn = DatabaseConnection.open(getDatabasePath(dir));
    inspectConns.push(conn);
    return (conn.getDb().prepare('SELECT key FROM project_metadata').all() as Array<{ key: string }>)
      .map((r) => r.key);
  }

  /** Basenames of every regular file under `.codegraph/` — for the "no checkpoint file" proof. */
  function codegraphFileBasenames(dir: string): string[] {
    const out: string[] = [];
    const stack = [path.join(dir, '.codegraph')];
    while (stack.length) {
      const cur = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory()) stack.push(path.join(cur, e.name));
        else out.push(e.name);
      }
    }
    return out;
  }

  beforeEach(() => {
    savedEnv = {};
    for (const k of EMBED_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    savedLogger = getLogger();
    setLogger({ debug() {}, warn() {}, error() {} });
  });

  afterEach(async () => {
    setLogger(savedLogger);
    for (const k of EMBED_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    while (graphs.length) {
      try { graphs.pop()!.close(); } catch { /* may already be closed inline */ }
    }
    while (inspectConns.length) {
      try { inspectConns.pop()!.close(); } catch { /* already closed */ }
    }
    await Promise.all(mocks.splice(0).map((m) => m.close()));
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // T028/T029 — late-config backfill (US3-AS1 / SC-004 / FR-018).
  // ===========================================================================
  it('a single plain sync() backfills a pre-indexed project to 100% coverage — no special command (US3-AS1/SC-004/FR-018)', async () => {
    const mock = await startEmbedMock(mocks, (inputs) => embedOk(inputs));
    const dir = makeProject(baseFiles());

    // Index with the feature OFF (env unset by beforeEach): nodes exist, ZERO vectors.
    const cgOff = await CodeGraph.init(dir);
    graphs.push(cgOff);
    expect((await cgOff.indexAll()).success).toBe(true);
    const statusOff = cgOff.getEmbeddingStatus();
    cgOff.close();
    // Dormant before configuration — genuinely nothing embedded yet.
    expect(statusOff.active).toBe(false);
    expect(readAllVectorRows(dir)).toHaveLength(0);

    // Configure the endpoint and run EXACTLY ONE ordinary sync — the same call the CLI,
    // watcher, and daemon make. No file changed; the unconditional advisory slot must
    // still backfill every missing vector (the FR-018 heal).
    configureEndpoint(mock);
    await syncOnce(dir);

    // Coverage reaches 100% as reported by the observable status API.
    const cg = await CodeGraph.open(dir);
    graphs.push(cg);
    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.coverage).toEqual({ embedded: 6, embeddable: 6, percent: 100 });
    }
    expect(mock.requestCount()).toBeGreaterThan(0); // the heal actually hit the endpoint
    expect(new Set(readVectorsByName(dir).keys())).toEqual(new Set(EXPECTED_NAMES));

    // "No special command": backfill rides sync() — the public surface offers no
    // dedicated embed/backfill entrypoint a user would have to discover and call.
    for (const method of ['backfillEmbeddings', 'embedAll', 'reembed', 'runBackfill', 'embed']) {
      expect((cg as unknown as Record<string, unknown>)[method]).toBeUndefined();
    }
  }, 20000);

  // ===========================================================================
  // T030/T031 — mid-pass outage → advisory abort → resume (SC-005/FR-014/019/020/021).
  // ===========================================================================
  it('a mid-pass outage keeps completed batches durable and never fails the index; a later plain sync() resumes to 100%, re-embedding ONLY the missing symbols with no persisted checkpoint (SC-005/FR-014/019/020, T031)', async () => {
    // Endpoint script: serve 2 successful batches, then hard-fail every request with a
    // retryable 500 (a genuine mid-pass outage) until healed. batchSize 2 over 6 symbols
    // forces 3 batches, so batch 3 hits the outage.
    let okServed = 0;
    let healthy = false;
    const mock = await startEmbedMock(mocks, (inputs) => {
      if (healthy) return embedOk(inputs);
      if (okServed < 2) { okServed++; return embedOk(inputs); }
      return { status: 500, body: '{"error":"endpoint down"}' };
    });
    configureEndpoint(mock);
    process.env.CODEGRAPH_EMBEDDING_BATCH_SIZE = '2';

    const dir = makeProject(baseFiles());

    // --- Phase 1: the outage. indexAll drives the advisory embed pass; batch 3's 500
    // exhausts the retry budget and aborts the pass — but the index itself SUCCEEDS. ---
    const cgP = await CodeGraph.init(dir);
    graphs.push(cgP);
    const result = await cgP.indexAll();
    expect(result.success).toBe(true);              // advisory abort never fails the index (FR-014/019)
    expect(result.filesIndexed).toBeGreaterThan(0);
    const partialStatus = cgP.getEmbeddingStatus();
    cgP.close();

    // Two batches (4 symbols) committed durably; batch 3 rolled back to nothing.
    const partial = readVectorsByName(dir);
    expect(partial.size).toBe(4);                   // > 0 and < 6 — a genuine partial
    expect(partialStatus.active).toBe(true);
    if (partialStatus.active) {
      expect(partialStatus.coverage).toEqual({ embedded: 4, embeddable: 6, percent: 67 });
    }
    const embeddedBefore = new Set(partial.keys());
    const stillMissing = EXPECTED_NAMES.filter((n) => !embeddedBefore.has(n));
    expect(stillMissing).toHaveLength(2);
    const afterOutage = mock.requestCount();        // 2 OK + (1 + 3 retries) failed = 6

    // --- Phase 2: resume. Heal the endpoint and run ONE ordinary sync — no manual
    // intervention, no bespoke command. Missing-vector selection IS the resume. ---
    healthy = true;
    await syncOnce(dir);

    // 100% coverage, and the resume touched the endpoint ONLY for the still-missing
    // symbols — never the 4 already embedded (SC-005: cost proportional to what's left).
    const resumeRequestNames = new Set(embeddedNamesSince(mock, afterOutage));
    expect(resumeRequestNames).toEqual(new Set(stillMissing));
    expect(new Set(readVectorsByName(dir).keys())).toEqual(new Set(EXPECTED_NAMES));

    const cgF = await CodeGraph.open(dir);
    graphs.push(cgF);
    const finalStatus = cgF.getEmbeddingStatus();
    cgF.close();
    expect(finalStatus.active).toBe(true);
    if (finalStatus.active) {
      expect(finalStatus.coverage).toEqual({ embedded: 6, embeddable: 6, percent: 100 });
    }

    // --- T031: resume carries NO persisted checkpoint state. The only embedding
    // persistence is the node_vectors table + the two dims/model scalars — no cursor,
    // offset, queue, or checkpoint row/file anywhere. ---
    const keys = readMetadataKeys(dir);
    expect(keys.filter((k) => k.startsWith('embedding_')).sort()).toEqual(['embedding_dims', 'embedding_model']);
    expect(keys.some((k) => /checkpoint|resume|cursor|offset|queue|pending|progress/i.test(k))).toBe(false);
    expect(codegraphFileBasenames(dir).some((f) => /checkpoint|resume|cursor|offset|queue|pending/i.test(f))).toBe(false);
  }, 30000);
});

// =============================================================================
// T030 (direct pass) — the abort paths that must be observed on runEmbeddingPass's
// RESULT (its abort reason) and proven BOUNDED. Driven against a REAL EndpointProvider
// (tiny test-only backoff overrides) + a scripted node:http mock, wired to real SQLite
// via the T016 harness. FR-020 (bounded abort) and FR-021 (later-batch dimension change).
// =============================================================================
describe.skipIf(!HAS_SQLITE)('embedding pass resilience — direct pass (T030 FR-020/FR-021)', () => {
  const conns: DatabaseConnection[] = [];
  const dirs: string[] = [];
  const mocks: EmbedMock[] = [];

  /** A fresh schema.sql DB (node_vectors + project_metadata present) plus its QueryBuilder. */
  function open(): { db: DatabaseConnection; q: QueryBuilder } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-embed-resilience-direct-'));
    dirs.push(dir);
    const db = DatabaseConnection.initialize(path.join(dir, 'test.db'));
    conns.push(db);
    return { db, q: new QueryBuilder(db.getDb()) };
  }

  /** Minimal valid embeddable node (only the fields insertNode needs). */
  function mkNode(id: string, kind: NodeKind): Node {
    return {
      id, kind, name: id, qualifiedName: id, filePath: 'a.ts', language: 'typescript',
      startLine: 1, endLine: 1, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
    };
  }

  type VecRow = { node_id: string; model: string; dims: number };
  /** Every node_vectors row, read via a path independent of the pass under test. */
  function allVectors(db: DatabaseConnection): VecRow[] {
    return db.getDb()
      .prepare('SELECT node_id, model, dims FROM node_vectors ORDER BY node_id')
      .all() as VecRow[];
  }

  /** Active config pointed at `mock`, with tiny batches; `over` tweaks per test. */
  function baseConfig(mock: EmbedMock, over: Partial<EmbeddingConfig> = {}): EmbeddingConfig {
    return {
      url: `${mock.origin}/v1/embeddings`, model: 'test-model',
      batchSize: 2, concurrency: 4, timeoutMs: 30_000, ...over,
    };
  }

  /** Wire runEmbeddingPass to REAL SQLite while counting seam calls (the T016 harness). */
  function harness(
    db: DatabaseConnection, q: QueryBuilder, provider: EndpointProvider,
    config: EmbeddingConfig, extra: Partial<RunEmbeddingPassOptions> = {},
  ) {
    const opts: RunEmbeddingPassOptions = {
      queries: q, provider, config,
      transaction: <T>(fn: () => T): T => db.transaction(fn),
      runMaintenance: () => db.runMaintenance(),
      ...extra,
    };
    return { opts };
  }

  afterEach(async () => {
    while (conns.length) conns.pop()!.close();
    await Promise.all(mocks.splice(0).map((m) => m.close()));
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a dimension change on a LATER batch aborts naming CODEGRAPH_EMBEDDING_DIMS; the first batch survives and the pass never throws (FR-021)', async () => {
    const { db, q } = open();
    q.insertNodes(['n0', 'n1', 'n2', 'n3'].map((id) => mkNode(id, 'function')));

    // Batch 1 returns 4-dim vectors (establishes the dimension); every later batch
    // returns 8-dim vectors → the provider rejects the change across embed() calls.
    let okServed = 0;
    const mock = await startEmbedMock(mocks, (inputs) => embedOk(inputs, okServed++ < 1 ? 4 : 8));

    const provider = new EndpointProvider(
      baseConfig(mock), { baseDelayMs: 1, maxDelayMs: 2, retryAfterCapMs: 5, maxRetries: 3 },
    );
    const { opts } = harness(db, q, provider, baseConfig(mock));

    // Never throws — an advisory abort is a returned result, not an exception (FR-019).
    const result = await runEmbeddingPass(opts);

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBeDefined();
    expect(result.abortReason).toContain('CODEGRAPH_EMBEDDING_DIMS');
    expect(result.embedded).toBe(2); // only batch 1 landed

    // Batch 1's two vectors survive at the established dimension — a later conflict
    // never corrupts or rolls back what already committed (FR-021).
    const rows = allVectors(db);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.dims === 4)).toBe(true);
    expect(rows.every((r) => r.model === 'test-model')).toBe(true);
    // The dimension scalar reflects the first (successful) batch, not the rejected one.
    expect(q.getMetadata('embedding_dims')).toBe('4');
    expect(q.getMetadata('embedding_model')).toBe('test-model');
  }, 20000);

  it('a fully-down endpoint aborts within a BOUNDED retry budget (maxRetries+1 requests for the one failing batch) and never throws (FR-020)', async () => {
    const { db, q } = open();
    q.insertNodes(['n0', 'n1', 'n2', 'n3', 'n4', 'n5'].map((id) => mkNode(id, 'function')));

    // Every request fails (retryable 500). With tiny backoff overrides the whole thing
    // resolves in milliseconds, so the boundedness is proven by the request COUNT.
    const mock = await startEmbedMock(mocks, () => ({ status: 500, body: '{"error":"down"}' }));

    const provider = new EndpointProvider(
      baseConfig(mock), { baseDelayMs: 1, maxDelayMs: 2, retryAfterCapMs: 5, maxRetries: 3 },
    );
    const { opts } = harness(db, q, provider, baseConfig(mock));

    const result = await runEmbeddingPass(opts);

    // Advisory abort with nothing embedded — and it did not throw.
    expect(result.aborted).toBe(true);
    expect(result.attempted).toBe(6);
    expect(result.embedded).toBe(0);
    expect(allVectors(db)).toHaveLength(0);

    // BOUNDED: the pass aborts on the FIRST failing batch, and that batch makes exactly
    // maxRetries+1 = 4 HTTP attempts — never an unbounded storm. Batches 2 and 3 are
    // never sent (the pass stopped), so the total request count is exactly 4 (FR-020).
    expect(mock.requestCount()).toBe(4);
  }, 20000);
});
