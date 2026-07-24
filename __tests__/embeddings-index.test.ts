/**
 * Embedding index — SPEC-001 (Embedding Infrastructure & Endpoint Provider).
 *
 * The embedding store persists one vector per symbol in a new `node_vectors`
 * table. That table is defined in TWO places that MUST stay in lockstep
 * (FR-012): `src/db/schema.sql` (the shape a FRESH install gets) and the v8
 * migration in `src/db/migrations.ts` (the shape a database UPGRADED from v7
 * gets). If the two definitions ever drift, a freshly-created DB and an
 * upgraded DB silently end up with different table shapes — a divergence only
 * visible later, when a query built for one shape runs against the other. The
 * schema-convergence suite below pins both paths to an identical
 * `PRAGMA table_info(node_vectors)`.
 *
 * Real SQLite, real temp files — no DB mocking (repo test convention). The
 * suite is skipped where `node:sqlite` is unavailable (Node < 22.5).
 *
 * NOTE: later SPEC-001 tasks append further sections (codec, input-hash,
 * indexer wiring) to this file — keep new `describe` blocks additive.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseConnection, SqliteDatabase, getDatabasePath } from '../src/db';
import { runMigrations, getCurrentVersion, CURRENT_SCHEMA_VERSION } from '../src/db/migrations';
import { QueryBuilder } from '../src/db/queries';
import { Node, NodeKind } from '../src/types';
import * as indexerHook from '../src/embeddings/indexer-hook';
import type { RunEmbeddingPassOptions } from '../src/embeddings/indexer-hook';
import type { EmbeddingProvider } from '../src/embeddings/provider';
import { EndpointProvider } from '../src/embeddings/endpoint-provider';
import type { EmbeddingConfig } from '../src/embeddings/config';
import { CodeGraph } from '../src';
import type { IndexProgress, IndexResult } from '../src';
import { setLogger, getLogger } from '../src/errors';

let HAS_SQLITE = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:sqlite');
  HAS_SQLITE = true;
} catch {
  HAS_SQLITE = false;
}

type ColumnShape = { name: string; type: string; notnull: number; pk: number };

/** The (name, type, notnull, pk) of every `node_vectors` column, in order. */
function nodeVectorsShape(db: SqliteDatabase): ColumnShape[] {
  const rows = db.prepare('PRAGMA table_info(node_vectors)').all() as Array<Record<string, unknown>>;
  return rows.map((c) => ({
    name: c.name as string,
    type: c.type as string,
    notnull: c.notnull as number,
    pk: c.pk as number,
  }));
}

/**
 * The shape BOTH the fresh-install schema and the v8 migration must produce.
 * `node_id` is a `TEXT PRIMARY KEY` — SQLite reports notnull=0 for a PK column
 * that isn't ALSO explicitly declared `NOT NULL`, so it is the one column here
 * with notnull=0. The other four carry an explicit `NOT NULL` (notnull=1).
 */
const EXPECTED_SHAPE: ColumnShape[] = [
  { name: 'node_id', type: 'TEXT', notnull: 0, pk: 1 },
  { name: 'model', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'dims', type: 'INTEGER', notnull: 1, pk: 0 },
  { name: 'vector', type: 'BLOB', notnull: 1, pk: 0 },
  { name: 'input_hash', type: 'TEXT', notnull: 1, pk: 0 },
];

describe.skipIf(!HAS_SQLITE)('node_vectors schema convergence (FR-012)', () => {
  const conns: DatabaseConnection[] = [];
  const dirs: string[] = [];

  /** A fresh DB built straight from `schema.sql` (the real fresh-install path). */
  function freshDb(prefix: string): DatabaseConnection {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    const conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
    conns.push(conn);
    return conn;
  }

  /**
   * Rewind a freshly-initialized DB into a genuine pre-embedding v7 database:
   * drop the `node_vectors` table and re-stamp `schema_versions` so
   * `getCurrentVersion` reads exactly 7 with no v8 row — indistinguishable from
   * a DB created before this table existed. (`initialize` stamps only
   * {1, CURRENT_SCHEMA_VERSION}, so an explicit v7 stamp is required.)
   */
  function rewindToV7(db: SqliteDatabase): void {
    db.exec('DROP TABLE IF EXISTS node_vectors');
    db.prepare('DELETE FROM schema_versions WHERE version >= 8').run();
    db.prepare(
      'INSERT OR IGNORE INTO schema_versions (version, applied_at, description) VALUES (7, ?, ?)'
    ).run(Date.now(), 'test: simulate a pre-embedding v7 database');
  }

  afterEach(() => {
    while (conns.length) conns.pop()!.close();
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CURRENT_SCHEMA_VERSION is 10 (v10 = SPEC-011 catalogs; SPEC-009 adds no migration)', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(10);
  });

  it('a fresh schema.sql DB and a v7→current upgraded DB yield an identical node_vectors shape', () => {
    // Path A — fresh install straight from schema.sql.
    const freshShape = nodeVectorsShape(freshDb('cg-nv-fresh-').getDb());

    // Path B — a genuine v7 database, upgraded through the migration runner
    // exactly as `DatabaseConnection.open` does (read the version, then run).
    const raw = freshDb('cg-nv-upgrade-').getDb();
    rewindToV7(raw);
    expect(getCurrentVersion(raw)).toBe(7); // genuinely a v7 DB...
    expect(nodeVectorsShape(raw)).toEqual([]); // ...with no node_vectors table yet

    runMigrations(raw, getCurrentVersion(raw));
    const upgradedShape = nodeVectorsShape(raw);

    // Guard against an empty-vs-empty false match: both paths really built it.
    expect(freshShape).toEqual(EXPECTED_SHAPE);
    // FR-012 convergence: the two independent definitions produce an identical
    // table shape, row-for-row (name, type, notnull, pk).
    expect(upgradedShape).toEqual(freshShape);
    expect(getCurrentVersion(raw)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('the node_vectors migration (v9 since the v1.4.0 sync) is DDL-only and idempotent — a re-open is a safe no-op', () => {
    const raw = freshDb('cg-nv-idem-').getDb();
    rewindToV7(raw);
    runMigrations(raw, getCurrentVersion(raw));

    const shape = nodeVectorsShape(raw);
    expect(shape).toEqual(EXPECTED_SHAPE); // built on the first upgrade

    // (a) A normal re-open re-runs the runner from the recorded version. At the
    // latest version nothing is pending, so it is a version-gated no-op — no
    // throw, no change.
    expect(() => runMigrations(raw, getCurrentVersion(raw))).not.toThrow();
    expect(getCurrentVersion(raw)).toBe(CURRENT_SCHEMA_VERSION);
    expect(nodeVectorsShape(raw)).toEqual(shape);

    // (b) Even forced to EXECUTE a second time over the now-existing table, the
    // v8/v9 DDL is guarded (`IF NOT EXISTS` / PRAGMA column checks) — a no-op,
    // never a throw.
    raw.prepare('DELETE FROM schema_versions WHERE version >= 8').run();
    expect(() => runMigrations(raw, 7)).not.toThrow();
    expect(nodeVectorsShape(raw)).toEqual(shape);
    expect(getCurrentVersion(raw)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('rechecks the recorded version after acquiring the migration write lock', () => {
    const raw = freshDb('cg-migration-stale-read-').getDb();
    expect(getCurrentVersion(raw)).toBe(CURRENT_SCHEMA_VERSION);

    expect(() => runMigrations(raw, CURRENT_SCHEMA_VERSION - 1)).not.toThrow();

    expect(getCurrentVersion(raw)).toBe(CURRENT_SCHEMA_VERSION);
    expect(Number(raw.pragma('busy_timeout', { simple: true }))).toBe(5_000);
  });
});

// =============================================================================
// Slice-A query helpers — the three read/write methods the embed pass drives:
// upsert a symbol's vector, select the symbols still needing one, and report
// coverage. SPEC-001 FR-005/FR-006 (the embeddable kind set), FR-009/FR-010
// (upsert + model-staleness), FR-022 (coverage). Real SQLite, real temp files.
// =============================================================================
describe.skipIf(!HAS_SQLITE)('node_vectors — Slice-A query helpers (FR-005/006/009/010/022)', () => {
  const conns: DatabaseConnection[] = [];
  const dirs: string[] = [];

  /** A fresh schema.sql DB (node_vectors present) plus its QueryBuilder. */
  function open(): { db: DatabaseConnection; q: QueryBuilder } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-nv-slicea-'));
    dirs.push(dir);
    const db = DatabaseConnection.initialize(path.join(dir, 'test.db'));
    conns.push(db);
    return { db, q: new QueryBuilder(db.getDb()) };
  }

  /** Minimal valid node of a given kind (only the fields insertNode needs). */
  function mkNode(id: string, kind: NodeKind): Node {
    return {
      id,
      kind,
      name: id,
      qualifiedName: id,
      filePath: 'a.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    };
  }

  /** Raw little-endian f32 BLOB — the on-disk `vector` column shape. */
  function f32Blob(values: number[]): Uint8Array {
    return new Uint8Array(new Float32Array(values).buffer);
  }

  type VecRow = { node_id: string; model: string; dims: number; vector: Uint8Array; input_hash: string };
  /** Every node_vectors row, read via a path independent of the method under test. */
  function allVectors(db: DatabaseConnection): VecRow[] {
    return db
      .getDb()
      .prepare('SELECT node_id, model, dims, vector, input_hash FROM node_vectors')
      .all() as VecRow[];
  }

  // The exact FR-005 declaration set and the FR-006 noise complement — together
  // they are all 22 NodeKinds, partitioned.
  const EMBEDDABLE: NodeKind[] = [
    'function', 'method', 'class', 'struct', 'interface', 'trait', 'protocol',
    'enum', 'type_alias', 'module', 'namespace', 'component', 'route',
    'constant', 'variable',
  ];
  const NOISE: NodeKind[] = ['parameter', 'import', 'export', 'enum_member', 'field', 'property', 'file'];

  afterEach(() => {
    while (conns.length) conns.pop()!.close();
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upsertNodeVector inserts a row, then REPLACES it on the same node_id (FR-009)', () => {
    const { db, q } = open();
    q.insertNode(mkNode('n1', 'function'));

    // First write persists exactly one row with its metadata.
    q.upsertNodeVector('n1', 'nomic', 3, f32Blob([1, 2, 3]), 'hash-a');
    let rows = allVectors(db);
    expect(rows.length).toBe(1);
    expect(rows[0]!.model).toBe('nomic');
    expect(rows[0]!.dims).toBe(3);
    expect(rows[0]!.input_hash).toBe('hash-a');

    // A second write on the SAME node_id must REPLACE (ON CONFLICT DO UPDATE),
    // never duplicate — model, dims, vector, and input_hash all take the new value.
    q.upsertNodeVector('n1', 'voyage', 4, f32Blob([9, 8, 7, 6]), 'hash-b');
    rows = allVectors(db);
    expect(rows.length).toBe(1); // still exactly one row
    expect(rows[0]!.node_id).toBe('n1');
    expect(rows[0]!.model).toBe('voyage');
    expect(rows[0]!.dims).toBe(4);
    expect(rows[0]!.input_hash).toBe('hash-b');
    expect(Array.from(rows[0]!.vector)).toEqual(Array.from(f32Blob([9, 8, 7, 6])));
  });

  it('selectEmbeddableNodesMissingVector returns exactly the FR-005 kinds, never the FR-006 noise (FR-005/FR-006)', () => {
    const { q } = open();
    q.insertNodes([...EMBEDDABLE, ...NOISE].map((k, i) => mkNode(`n-${i}-${k}`, k)));

    const gotKinds = new Set(q.selectEmbeddableNodesMissingVector('nomic').map((n) => n.kind));
    for (const k of EMBEDDABLE) expect(gotKinds.has(k)).toBe(true);
    for (const k of NOISE) expect(gotKinds.has(k)).toBe(false);
    expect(gotKinds.size).toBe(EMBEDDABLE.length);
  });

  it('selectEmbeddableNodesMissingVector treats no-vector and different-model rows as needing embedding; model match is exact & case-sensitive (FR-010)', () => {
    const { q } = open();
    q.insertNodes([
      mkNode('current', 'function'), // up-to-date active-model vector → excluded
      mkNode('novec', 'function'),   // no vector at all → returned
      mkNode('stale', 'function'),   // vector under a different model → stale → returned
      mkNode('cased', 'function'),   // model 'Nomic' vs active 'nomic' → case-sensitive stale → returned
    ]);
    q.upsertNodeVector('current', 'nomic', 1, f32Blob([1]), 'h');
    q.upsertNodeVector('stale', 'voyage', 1, f32Blob([1]), 'h');
    q.upsertNodeVector('cased', 'Nomic', 1, f32Blob([1]), 'h');

    const ids = new Set(q.selectEmbeddableNodesMissingVector('nomic').map((n) => n.id));
    expect(ids.has('current')).toBe(false);
    expect(ids.has('novec')).toBe(true);
    expect(ids.has('stale')).toBe(true);
    expect(ids.has('cased')).toBe(true);
  });

  it('getEmbeddingCoverage counts embeddable live nodes vs active-model vectors, excluding orphans and other-model rows (FR-022)', () => {
    const { q } = open();
    q.insertNodes([
      mkNode('a', 'function'),
      mkNode('b', 'class'),
      mkNode('c', 'method'),
      mkNode('p', 'parameter'), // noise → never embeddable
    ]);
    q.upsertNodeVector('a', 'nomic', 1, f32Blob([1]), 'h');     // embedded
    q.upsertNodeVector('b', 'nomic', 1, f32Blob([1]), 'h');     // embedded
    q.upsertNodeVector('c', 'voyage', 1, f32Blob([1]), 'h');    // wrong model → not embedded for 'nomic'
    q.upsertNodeVector('ghost', 'nomic', 1, f32Blob([1]), 'h'); // ORPHAN (no such node) → excluded

    const cov = q.getEmbeddingCoverage('nomic');
    expect(cov.embeddable).toBe(3); // a, b, c (not p, not ghost)
    expect(cov.embedded).toBe(2);   // a, b only
  });

  it('getEmbeddingCoverage returns {embeddable:0, embedded:0} on an empty graph (caller derives percent=100) (FR-022)', () => {
    const { q } = open();
    const cov = q.getEmbeddingCoverage('nomic');
    expect(cov.embeddable).toBe(0);
    expect(cov.embedded).toBe(0);
  });
});

// =============================================================================
// T016 — the full-index embed pass (runEmbeddingPass). Streams eligible symbols in
// batchSize chunks; per chunk it composes each symbol's input, embeds the chunk via
// the provider, and persists that chunk's vectors in ONE transaction (FR-029). It
// infers the vector dimension from the first successful batch and persists it with
// the active model to the project_metadata scalars, or enforces a pre-set dimension
// and aborts advisorily on a mismatch that names CODEGRAPH_EMBEDDING_DIMS
// (FR-004/021). Any provider failure STOPS the pass without throwing — committed
// batches stay durable (FR-014/019) — and the abort reason never echoes source
// (FR-025a). Real SQLite + a FAKE provider; the HTTP wire behavior is covered by
// embeddings-endpoint.test.ts. FR-004/014/019/021/025a/028/029/030/031.
// =============================================================================
describe.skipIf(!HAS_SQLITE)('full-index embed pass — runEmbeddingPass (T016)', () => {
  const { runEmbeddingPass, decodeVector, composeEmbeddingInput, computeInputHash } = indexerHook;

  const conns: DatabaseConnection[] = [];
  const dirs: string[] = [];

  /** A fresh schema.sql DB (node_vectors + project_metadata present) plus its QueryBuilder. */
  function open(): { db: DatabaseConnection; q: QueryBuilder } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-embed-pass-'));
    dirs.push(dir);
    const db = DatabaseConnection.initialize(path.join(dir, 'test.db'));
    conns.push(db);
    return { db, q: new QueryBuilder(db.getDb()) };
  }

  /** Minimal valid node; `extra` overrides fields the composition reads (docstring…). */
  function mkNode(id: string, kind: NodeKind, extra: Partial<Node> = {}): Node {
    return {
      id, kind, name: id, qualifiedName: id, filePath: 'a.ts', language: 'typescript',
      startLine: 1, endLine: 1, startColumn: 0, endColumn: 0, updatedAt: Date.now(), ...extra,
    };
  }

  type VecRow = { node_id: string; model: string; dims: number; vector: Uint8Array; input_hash: string };
  /** Every node_vectors row, read via a path independent of the pass under test. */
  function allVectors(db: DatabaseConnection): VecRow[] {
    return db.getDb()
      .prepare('SELECT node_id, model, dims, vector, input_hash FROM node_vectors ORDER BY node_id')
      .all() as VecRow[];
  }

  // A deterministic in-test EmbeddingProvider. Records every batch it is handed,
  // returns `vectorDims`-length vectors, and can be scripted to throw on the Nth
  // embed() call (1-indexed) to drive the advisory-abort paths — no HTTP involved.
  class FakeProvider implements EmbeddingProvider {
    readonly id: string;
    readonly calls: string[][] = [];
    private _dims = 0;
    private readonly vectorDims: number;
    private readonly failOnCall: number | undefined;
    private readonly failWith: Error;
    constructor(opts: { id: string; vectorDims: number; failOnCall?: number; failWith?: Error }) {
      this.id = opts.id;
      this.vectorDims = opts.vectorDims;
      this.failOnCall = opts.failOnCall;
      this.failWith = opts.failWith
        ?? new Error('embedding request to http://localhost:1234 failed: endpoint returned HTTP 500');
    }
    get dims(): number { return this._dims; }
    async embed(texts: string[]): Promise<Float32Array[]> {
      this.calls.push([...texts]);
      if (this.failOnCall === this.calls.length) throw this.failWith;
      if (this._dims === 0) this._dims = this.vectorDims;
      return texts.map((_t, i) => Float32Array.from({ length: this.vectorDims }, (_v, d) => i * 100 + d));
    }
  }

  // concurrency 1 by default so the super-chunk (batchSize × concurrency) equals batchSize
  // — these FakeProvider cases assert the PER-BATCH cadence (one embed() call, txn, and
  // progress ping per batchSize chunk), which is the concurrency=1 shape. Genuine
  // concurrency (super-chunk > batch) is exercised separately by the FIX 2 test with a
  // real EndpointProvider; a case that wants it overrides `concurrency` explicitly.
  function baseConfig(over: Partial<EmbeddingConfig> = {}): EmbeddingConfig {
    return {
      url: 'http://localhost:1234/v1/embeddings', model: 'nomic',
      batchSize: 2, concurrency: 1, timeoutMs: 30_000, ...over,
    };
  }

  // Wire the pass to REAL SQLite (transaction + WAL checkpoint) while counting every
  // seam call, so a test can assert both durable side effects AND the call cadence.
  function harness(
    db: DatabaseConnection, q: QueryBuilder, provider: EmbeddingProvider,
    config: EmbeddingConfig, extra: Partial<RunEmbeddingPassOptions> = {},
  ) {
    const progress: Array<[number, number]> = [];
    const counters = { transaction: 0, maintenance: 0, refresh: 0 };
    const opts: RunEmbeddingPassOptions = {
      queries: q, provider, config,
      transaction: <T>(fn: () => T): T => { counters.transaction++; return db.transaction(fn); },
      runMaintenance: () => { counters.maintenance++; return db.runMaintenance(); },
      onProgress: (c, t) => { progress.push([c, t]); },
      refreshLock: () => { counters.refresh++; },
      ...extra,
    };
    return { opts, progress, counters };
  }

  afterEach(() => {
    while (conns.length) conns.pop()!.close();
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('embeds every eligible symbol to 100% coverage: batch-sized txns, inferred dims persisted, progress + one checkpoint (FR-004/028/029/030)', async () => {
    const { db, q } = open();
    const ids = ['n0', 'n1', 'n2', 'n3', 'n4'];
    q.insertNodes(ids.map((id) => mkNode(id, 'function')));

    const provider = new FakeProvider({ id: 'nomic', vectorDims: 4 });
    const { opts, progress, counters } = harness(db, q, provider, baseConfig({ batchSize: 2 }));

    const result = await runEmbeddingPass(opts);

    // Result: full coverage, no abort.
    expect(result).toEqual({ attempted: 5, embedded: 5, aborted: false });

    // Every eligible symbol now carries an active-model vector of the inferred dims.
    const rows = allVectors(db);
    expect(rows.map((r) => r.node_id)).toEqual(ids);
    expect(rows.every((r) => r.model === 'nomic')).toBe(true);
    expect(rows.every((r) => r.dims === 4)).toBe(true);
    // Each stored vector round-trips and its hash is the composed input's sha256.
    for (const r of rows) {
      expect(decodeVector(Buffer.from(r.vector), 4)).toHaveLength(4);
      expect(r.input_hash).toBe(computeInputHash(composeEmbeddingInput({ kind: 'function', name: r.node_id })));
    }
    // Coverage query agrees: nothing left to embed.
    expect(q.getEmbeddingCoverage('nomic')).toEqual({ embeddable: 5, embedded: 5 });
    expect(q.selectEmbeddableNodesMissingVector('nomic')).toHaveLength(0);

    // Dimension inferred from the first batch and persisted with the active model.
    expect(q.getMetadata('embedding_dims')).toBe('4');
    expect(q.getMetadata('embedding_model')).toBe('nomic');

    // Streaming: 3 batches (2+2+1); one transaction per batch; progress is cumulative;
    // exactly one WAL checkpoint after all writes. Lock refresh is now driven by a ~30s
    // wall-clock timer (FR-031), NOT batch boundaries, so a sub-second pass fires it zero
    // times — the interval behavior is pinned by the FIX 4 timer test in this file.
    expect(provider.calls).toHaveLength(3);
    expect(provider.calls.flat()).toHaveLength(5);
    expect(counters.transaction).toBe(3);
    expect(counters.refresh).toBe(0);
    expect(counters.maintenance).toBe(1);
    expect(progress).toEqual([[2, 5], [4, 5], [5, 5]]);
  });

  it('honors a caller AbortSignal (P1-b): a pre-aborted pass embeds nothing, runs no inference, and reports an advisory `cancelled` abort', async () => {
    const { db, q } = open();
    const ids = ['n0', 'n1', 'n2', 'n3', 'n4'];
    q.insertNodes(ids.map((id) => mkNode(id, 'function')));

    const provider = new FakeProvider({ id: 'nomic', vectorDims: 4 });
    const controller = new AbortController();
    controller.abort(); // caller cancelled (e.g. after extraction) before the embed pass runs
    const { opts } = harness(db, q, provider, baseConfig({ batchSize: 2 }), { signal: controller.signal });

    const result = await runEmbeddingPass(opts);

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe('cancelled');
    expect(result.embedded).toBe(0);
    expect(provider.calls).toHaveLength(0); // no worker/endpoint inference ran
    expect(allVectors(db)).toEqual([]);     // nothing persisted
  });

  it('honors an AbortSignal that fires DURING provider.embed() (iter-39 P1): the resolved vectors are discarded, not persisted', async () => {
    const { db, q } = open();
    const ids = ['n0', 'n1', 'n2'];
    q.insertNodes(ids.map((id) => mkNode(id, 'function')));

    const controller = new AbortController();
    // An in-flight (endpoint) request isn't interrupted; it resolves AFTER the caller cancels.
    class AbortDuringEmbed extends FakeProvider {
      override async embed(texts: string[]): Promise<Float32Array[]> {
        const v = await super.embed(texts);
        controller.abort(); // caller cancelled while the request was in flight
        return v;
      }
    }
    const provider = new AbortDuringEmbed({ id: 'nomic', vectorDims: 4 });
    const { opts } = harness(db, q, provider, baseConfig({ batchSize: 4 }), { signal: controller.signal });

    const result = await runEmbeddingPass(opts);

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe('cancelled');
    expect(result.embedded).toBe(0);
    expect(provider.calls).toHaveLength(1); // embed WAS called (in-flight)…
    expect(allVectors(db)).toEqual([]);     // …but nothing was validated/persisted after the cancel
  });

  it('commits per batch: a provider failure on batch 2 keeps batch 1 durable, writes no partial batch-2 rows, and aborts without throwing (FR-014/019/029)', async () => {
    const { db, q } = open();
    const ids = ['a0', 'a1', 'a2', 'a3'];
    q.insertNodes(ids.map((id) => mkNode(id, 'function')));

    const provider = new FakeProvider({ id: 'nomic', vectorDims: 4, failOnCall: 2 });
    const { opts, progress, counters } = harness(db, q, provider, baseConfig({ batchSize: 2 }));

    const result = await runEmbeddingPass(opts);

    expect(result.aborted).toBe(true);
    expect(result.attempted).toBe(4);
    expect(result.embedded).toBe(2);
    expect(result.abortReason).toBeDefined();

    // Batch 1's two rows committed; batch 2 rolled back to nothing (no partial rows).
    expect(allVectors(db).map((r) => r.node_id)).toEqual(['a0', 'a1']);

    // One committed batch → one txn and one progress ping; the checkpoint still runs
    // because ≥1 batch was written (FR-030). Lock refresh is timer-driven now, so a fast
    // pass records zero refreshes (the interval is covered by the FIX 4 timer test).
    expect(provider.calls).toHaveLength(2);
    expect(counters.transaction).toBe(1);
    expect(counters.refresh).toBe(0);
    expect(counters.maintenance).toBe(1);
    expect(progress).toEqual([[2, 4]]);
  });

  it('aborts advisorily and persists NOTHING when the provider returns a ragged vector (length ≠ established dims)', async () => {
    const { db, q } = open();
    q.insertNodes(['r0', 'r1', 'r2'].map((id) => mkNode(id, 'function')));

    // First vector establishes dims=4; the second is short (length 2). A per-vector check
    // must abort before any write — persisting it would store a blob whose byte length
    // disagrees with the stored dims.
    const provider: EmbeddingProvider = {
      id: 'ragged',
      get dims() { return 4; },
      async embed(texts: string[]): Promise<Float32Array[]> {
        return texts.map((_t, i) => (i === 1 ? Float32Array.from([1, 2]) : Float32Array.from({ length: 4 }, (_v, d) => d)));
      },
    };
    const { opts } = harness(db, q, provider, baseConfig({ batchSize: 3 }));
    const result = await runEmbeddingPass(opts);

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toMatch(/2-dimension vector where 4/);
    expect(result.embedded).toBe(0);
    expect(allVectors(db)).toHaveLength(0); // nothing persisted
    // No orphan scalars: the whole batch is validated BEFORE embedding_dims/model are written.
    expect(q.getMetadata('embedding_model')).toBeNull();
    expect(q.getMetadata('embedding_dims')).toBeNull();
  });

  it('aborts (persists nothing, writes no scalars) when the provider returns a zero-dimension vector', async () => {
    const { db, q } = open();
    q.insertNodes(['z0', 'z1'].map((id) => mkNode(id, 'function')));

    // An empty Float32Array would otherwise establish dims=0 and persist zero-byte vectors.
    const provider: EmbeddingProvider = {
      id: 'zerodim',
      get dims() { return 0; },
      async embed(texts: string[]): Promise<Float32Array[]> { return texts.map(() => new Float32Array(0)); },
    };
    const { opts } = harness(db, q, provider, baseConfig({ batchSize: 2 }));
    const result = await runEmbeddingPass(opts);

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toMatch(/zero-dimension/);
    expect(allVectors(db)).toHaveLength(0);
    expect(q.getMetadata('embedding_model')).toBeNull();
    expect(q.getMetadata('embedding_dims')).toBeNull();
  });

  it('aborts advisorily and persists NOTHING when the provider returns a non-finite value (NaN/Infinity)', async () => {
    const { db, q } = open();
    q.insertNodes(['f0', 'f1'].map((id) => mkNode(id, 'function')));

    const provider: EmbeddingProvider = {
      id: 'nonfinite',
      get dims() { return 4; },
      async embed(texts: string[]): Promise<Float32Array[]> {
        return texts.map((_t, i) => {
          const v = Float32Array.from({ length: 4 }, (_v, d) => d);
          if (i === 1) v[2] = NaN;
          return v;
        });
      },
    };
    const { opts } = harness(db, q, provider, baseConfig({ batchSize: 2 }));
    const result = await runEmbeddingPass(opts);

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toMatch(/non-finite/);
    expect(allVectors(db)).toHaveLength(0);
  });

  it('enforces a configured CODEGRAPH_EMBEDDING_DIMS: a provider-dim mismatch aborts before any write, names the variable, and leaves the scalars untouched (FR-021)', async () => {
    const { db, q } = open();
    q.insertNodes(['e0', 'e1', 'e2'].map((id) => mkNode(id, 'function')));

    // Configured dims 8, but the provider yields 4-dim vectors.
    const provider = new FakeProvider({ id: 'nomic', vectorDims: 4 });
    const { opts, counters } = harness(db, q, provider, baseConfig({ dims: 8 }));

    const result = await runEmbeddingPass(opts);

    expect(result.aborted).toBe(true);
    expect(result.embedded).toBe(0);
    expect(result.abortReason).toContain('CODEGRAPH_EMBEDDING_DIMS');
    expect(result.abortReason).toContain('8');
    expect(result.abortReason).toContain('4');

    // Nothing written; a rejected pass does not corrupt the enforcement scalars.
    expect(allVectors(db)).toHaveLength(0);
    expect(q.getMetadata('embedding_dims')).toBeNull();
    expect(q.getMetadata('embedding_model')).toBeNull();
    // No batch was written → no checkpoint (FR-030 condition).
    expect(counters.maintenance).toBe(0);
  });

  it('enforces a dimension already persisted for the SAME model across passes: a later provider-dim change aborts naming CODEGRAPH_EMBEDDING_DIMS (FR-004/010/021)', async () => {
    const { db, q } = open();
    q.insertNodes(['s0', 's1'].map((id) => mkNode(id, 'function')));
    // A prior pass established dims 7 for 'nomic'.
    q.setMetadata('embedding_dims', '7');
    q.setMetadata('embedding_model', 'nomic');

    // This pass's provider now yields 4-dim vectors under the same model.
    const provider = new FakeProvider({ id: 'nomic', vectorDims: 4 });
    const { opts } = harness(db, q, provider, baseConfig()); // no configured dims

    const result = await runEmbeddingPass(opts);

    expect(result.aborted).toBe(true);
    expect(result.embedded).toBe(0);
    expect(result.abortReason).toContain('CODEGRAPH_EMBEDDING_DIMS');
    expect(allVectors(db)).toHaveLength(0);
    // The established scalar is left intact — not overwritten by the rejected run.
    expect(q.getMetadata('embedding_dims')).toBe('7');
  });

  it('does NOT enforce a dimension persisted under a DIFFERENT model: the model changed, so the pass re-infers and overwrites the scalars (FR-010)', async () => {
    const { db, q } = open();
    q.insertNodes(['m0', 'm1'].map((id) => mkNode(id, 'function')));
    // A stale scalar from another model must not enforce against the new one.
    q.setMetadata('embedding_dims', '7');
    q.setMetadata('embedding_model', 'voyage');

    const provider = new FakeProvider({ id: 'nomic', vectorDims: 4 });
    const { opts } = harness(db, q, provider, baseConfig({ model: 'nomic' }));

    const result = await runEmbeddingPass(opts);

    expect(result.aborted).toBe(false);
    expect(result.embedded).toBe(2);
    expect(allVectors(db)).toHaveLength(2);
    // Scalars re-inferred and rewritten for the now-active model.
    expect(q.getMetadata('embedding_dims')).toBe('4');
    expect(q.getMetadata('embedding_model')).toBe('nomic');
  });

  it('aborts advisorily when a provider returns fewer vectors than inputs — never misaligns vectors to symbols (Copilot review)', async () => {
    // The EndpointProvider enforces count-match internally (FR-021a), but the pass accepts
    // ANY EmbeddingProvider — a short batch from a future provider must abort, not persist
    // misaligned rows.
    class ShortProvider extends FakeProvider {
      override async embed(texts: string[]): Promise<Float32Array[]> {
        const full = await super.embed(texts);
        return full.slice(0, Math.max(0, full.length - 1)); // one vector short
      }
    }
    const { db, q } = open();
    q.insertNodes([mkNode('s0', 'function'), mkNode('s1', 'function')]);
    const provider = new ShortProvider({ id: 'nomic', vectorDims: 4 });
    const { opts } = harness(db, q, provider, baseConfig({ batchSize: 2 }));

    const result = await runEmbeddingPass(opts);

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toContain('vectors');
    expect(result.embedded).toBe(0);
    expect(q.getEmbeddingCoverage('nomic').embedded).toBe(0); // nothing persisted from the short batch
  });

  it('never echoes a symbol source or composed input into the abort reason — only the redacted provider reason (FR-025a)', async () => {
    const { db, q } = open();
    const SECRET_SOURCE = 'SECRET_SOURCE_9f3a_do_not_leak';
    const SECRET_DOC = 'SECRET_DOC_9f3a_do_not_leak';
    q.insertNodes([
      mkNode('c0', 'function', { docstring: SECRET_DOC }),
      mkNode('c1', 'function'),
    ]);

    // A source resolver feeds real code text into composition; the provider then fails.
    const provider = new FakeProvider({ id: 'nomic', vectorDims: 4, failOnCall: 1 });
    const { opts } = harness(db, q, provider, baseConfig({ batchSize: 2 }), {
      readSource: () => SECRET_SOURCE,
    });

    const result = await runEmbeddingPass(opts);

    // The source WAS composed into the batch handed to the provider...
    expect(provider.calls[0]![0]).toContain(SECRET_SOURCE);
    // ...but the abort reason exposes neither the source nor the docstring.
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBeDefined();
    expect(result.abortReason).not.toContain(SECRET_SOURCE);
    expect(result.abortReason).not.toContain(SECRET_DOC);
    expect(result.abortReason).not.toContain('SECRET');
    expect(allVectors(db)).toHaveLength(0);
  });

  // ===========================================================================
  // FIX 2 (concurrency) + FIX 4 (lock-refresh timer). The pass must feed the
  // provider a super-chunk (batchSize × concurrency) so the provider's bounded
  // pool actually runs batches concurrently, and must refresh the held lock on a
  // wall-clock interval spanning the whole pass rather than only at batch
  // boundaries (so one batch's full retry ladder can't starve the refresh).
  // FIX 2 uses a REAL EndpointProvider (the pool lives there) + an in-flight-
  // tracking node:http mock; FIX 4 uses fake timers + a parked provider.
  // ===========================================================================
  describe('concurrency super-chunking & lock-refresh timer (FIX 2 / FIX 4)', () => {
    interface InFlightMock {
      origin: string;
      getMaxInFlight: () => number;
      close: () => Promise<void>;
    }
    const servers: InFlightMock[] = [];

    /** A local endpoint that returns valid 4-dim vectors after `delayMs`, tracking peak in-flight. */
    async function startInFlightMock(delayMs: number): Promise<InFlightMock> {
      let inFlight = 0;
      let maxInFlight = 0;
      const server = createServer((req, res) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          let inputs: string[] = [];
          try {
            inputs = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { input?: string[] }).input ?? [];
          } catch { /* leave empty */ }
          const data = inputs.map((_t, index) => ({
            index,
            embedding: Array.from({ length: 4 }, (_v, k) => k + index * 0.5),
          }));
          setTimeout(() => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ data, model: 'nomic' }), () => { inFlight--; });
          }, delayMs);
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      const mock: InFlightMock = {
        origin: `http://127.0.0.1:${port}`,
        getMaxInFlight: () => maxInFlight,
        close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
      };
      servers.push(mock);
      return mock;
    }

    afterEach(async () => {
      await Promise.all(servers.splice(0).map((s) => s.close()));
    });

    it('feeds the provider a super-chunk (batchSize × concurrency) so its pool runs batches concurrently — not one batch at a time (FIX 2)', async () => {
      const { db, q } = open();
      const ids = Array.from({ length: 12 }, (_v, i) => `c${i}`);
      q.insertNodes(ids.map((id) => mkNode(id, 'function')));

      const mock = await startInFlightMock(40); // slow enough that concurrent requests overlap
      const config = baseConfig({ url: `${mock.origin}/v1/embeddings`, batchSize: 2, concurrency: 3 });
      const provider = new EndpointProvider(config, { baseDelayMs: 1, maxDelayMs: 2 });
      const { opts } = harness(db, q, provider, config);

      const result = await runEmbeddingPass(opts);

      // Full coverage — the super-chunking neither drops nor duplicates any symbol.
      expect(result).toEqual({ attempted: 12, embedded: 12, aborted: false });
      expect(allVectors(db)).toHaveLength(12);

      // The mock saw MORE than one request in flight at once: a super-chunk fed the pool
      // several batches. Pre-fix the pass awaited each batchSize chunk serially, so the
      // pool never received >1 batch and peak in-flight stayed pinned at 1.
      expect(mock.getMaxInFlight()).toBeGreaterThan(1);
    });

    it('refreshes the held lock on a wall-clock interval spanning the whole pass, not at batch boundaries (FIX 4 / FR-031)', async () => {
      vi.useFakeTimers();
      try {
        const { db, q } = open();
        q.insertNodes(['r0', 'r1'].map((id) => mkNode(id, 'function')));

        // A provider whose only embed() call parks until released — so the pass sits
        // mid-embed (no batch committed, no boundary crossed) while the clock advances.
        let release!: () => void;
        const parked = new Promise<void>((r) => { release = r; });
        const provider: EmbeddingProvider = {
          id: 'nomic',
          get dims() { return 4; },
          async embed(texts: string[]): Promise<Float32Array[]> {
            await parked;
            return texts.map(() => Float32Array.from([1, 2, 3, 4]));
          },
        };
        const { opts, counters } = harness(db, q, provider, baseConfig({ batchSize: 2 }));

        const passPromise = runEmbeddingPass(opts);
        await vi.advanceTimersByTimeAsync(0);       // let the pass reach `await provider.embed`
        expect(counters.refresh).toBe(0);           // nothing committed yet — NOT a per-batch call

        // Cross two ~30s intervals while the pass is parked mid-embed: the timer must fire
        // even though no batch boundary was reached.
        await vi.advanceTimersByTimeAsync(65_000);
        expect(counters.refresh).toBeGreaterThanOrEqual(2);

        release();
        await passPromise;                          // finishes and clears the interval in finally
      } finally {
        vi.useRealTimers();
      }
    });

    it('refreshes the lock INLINE during the synchronous staleness scan, which the interval timer cannot preempt (FR-031)', async () => {
      const { db, q } = open();
      const ids = ['h0', 'h1', 'h2'];
      q.insertNodes(ids.map((id) => mkNode(id, 'function')));
      // Pre-embed each node with its CURRENT correct input hash, so the O(embeddable)
      // staleness scan finds every one FRESH — the pass's only work is that synchronous
      // scan (nothing eligible, no embed() call). On a huge repo the scan alone can
      // outlast the 30s stale-lock window; the setInterval refresh CANNOT fire while the
      // scan blocks the event loop, so the refresh must be driven INLINE by elapsed time.
      for (const id of ids) {
        const hash = computeInputHash(composeEmbeddingInput({ kind: 'function', name: id }));
        q.upsertNodeVector(id, 'nomic', 4, Buffer.alloc(16), hash);
      }
      q.setMetadata('embedding_dims', '4');
      q.setMetadata('embedding_model', 'nomic');

      // Make each Date.now() reading jump a full interval so the inline elapsed-time
      // check trips on every scanned node. The interval is a REAL setInterval (real
      // timers here) that cannot fire during the synchronous scan — so every refresh
      // counted below can ONLY have come from the inline path.
      let wallClock = 0;
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => (wallClock += 31_000));
      try {
        const provider = new FakeProvider({ id: 'nomic', vectorDims: 4 });
        const { opts, counters } = harness(db, q, provider, baseConfig());

        const result = await runEmbeddingPass(opts);

        expect(result).toEqual({ attempted: 0, embedded: 0, aborted: false }); // scan found nothing stale
        expect(provider.calls).toHaveLength(0);                                 // no embed() — scan only
        expect(counters.refresh).toBeGreaterThanOrEqual(3);                     // inline refresh fired per scanned node
      } finally {
        nowSpy.mockRestore();
      }
    });
  });
});

// =============================================================================
// T019 — wiring the embed pass into CodeGraph.indexAll(). Real temp-dir project +
// CodeGraph.init/indexAll drive the WHOLE stack (extraction → resolution → embed)
// against a local node:http mock endpoint (the same integration shape as
// embeddings-endpoint.test.ts). Covers the four activation states: configured
// (vectors written + an 'embedding' progress phase), fully unconfigured (byte-
// dormant — no traffic, no writes, no log line), half-config (one advisory line,
// no network), and endpoint-down (the pass aborts advisorily; the index STILL
// succeeds and never throws). Embedding is advisory: it must never fail the
// surrounding index (FR-002/014/019/001a). Real SQLite; skipped without node:sqlite.
// =============================================================================
describe.skipIf(!HAS_SQLITE)('indexAll wiring (T019)', () => {
  const MOCK_DIMS = 4;
  const EMBED_ENV_KEYS = [
    'CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL', 'CODEGRAPH_EMBEDDING_API_KEY',
    'CODEGRAPH_EMBEDDING_DIMS', 'CODEGRAPH_EMBEDDING_BATCH_SIZE', 'CODEGRAPH_EMBEDDING_CONCURRENCY',
    'CODEGRAPH_EMBEDDING_TIMEOUT_MS',
  ];

  interface EmbedMock {
    origin: string;
    requestCount: () => number;
    close: () => Promise<void>;
  }

  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];
  const inspectConns: DatabaseConnection[] = [];
  const mocks: EmbedMock[] = [];
  const warnings: string[] = [];
  let savedEnv: Record<string, string | undefined> = {};
  let savedLogger: ReturnType<typeof getLogger>;

  /** A local OpenAI-compatible embeddings endpoint; `reply` maps request inputs → HTTP result. */
  async function startEmbedMock(
    reply: (inputs: string[], count: number) => { status: number; body?: string },
  ): Promise<EmbedMock> {
    let count = 0;
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        count++;
        let inputs: string[] = [];
        try {
          inputs = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { input?: string[] }).input ?? [];
        } catch {
          /* leave inputs empty — the reply decides what to send */
        }
        const r = reply(inputs, count);
        res.writeHead(r.status, { 'content-type': 'application/json' });
        res.end(r.body ?? '');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const mock: EmbedMock = {
      origin: `http://127.0.0.1:${port}`,
      requestCount: () => count,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    };
    mocks.push(mock);
    return mock;
  }

  /** 200 with exactly one MOCK_DIMS-length vector per input (count MUST match, FR-021a). */
  function embedOk(inputs: string[]): { status: number; body: string } {
    const data = inputs.map((_t, index) => ({
      index,
      embedding: Array.from({ length: MOCK_DIMS }, (_v, k) => k + index * 0.5),
    }));
    return { status: 200, body: JSON.stringify({ data, model: 'test-model' }) };
  }

  /** A fresh temp project with two TS files carrying embeddable declarations. */
  function makeProject(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-embed-index-'));
    dirs.push(dir);
    const srcDir = path.join(dir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'math.ts'),
      'export function add(a: number, b: number): number {\n  return a + b;\n}\n' +
        'export function subtract(a: number, b: number): number {\n  return a - b;\n}\n' +
        'export const PI = 3.14159;\n',
    );
    fs.writeFileSync(
      path.join(srcDir, 'shapes.ts'),
      'export interface Shape {\n  area(): number;\n}\n' +
        'export class Circle implements Shape {\n' +
        '  constructor(public radius: number) {}\n' +
        '  area(): number {\n    return Math.PI * this.radius * this.radius;\n  }\n}\n' +
        'export function describeShape(s: Shape): string {\n  return `area=${s.area()}`;\n}\n',
    );
    return dir;
  }

  /** All node_vectors rows, read via a FRESH connection independent of the indexer. */
  function readVectors(dir: string): { rows: Array<{ node_id: string; model: string; dims: number }>; q: QueryBuilder } {
    const conn = DatabaseConnection.open(getDatabasePath(dir));
    inspectConns.push(conn);
    const rows = conn
      .getDb()
      .prepare('SELECT node_id, model, dims FROM node_vectors ORDER BY node_id')
      .all() as Array<{ node_id: string; model: string; dims: number }>;
    return { rows, q: new QueryBuilder(conn.getDb()) };
  }

  beforeEach(() => {
    savedEnv = {};
    for (const k of EMBED_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    warnings.length = 0;
    savedLogger = getLogger();
    setLogger({ debug() {}, warn(m: string) { warnings.push(m); }, error() {} });
  });

  afterEach(async () => {
    setLogger(savedLogger);
    for (const k of EMBED_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    while (graphs.length) {
      try { graphs.pop()!.close(); } catch { /* may already be closed by the test */ }
    }
    while (inspectConns.length) {
      try { inspectConns.pop()!.close(); } catch { /* already closed */ }
    }
    await Promise.all(mocks.splice(0).map((m) => m.close()));
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(a) configured endpoint: indexAll succeeds AND writes an active-model vector per declaration at the inferred dims; progress reports the embedding phase', async () => {
    const mock = await startEmbedMock((inputs) => embedOk(inputs));
    process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings`;
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'test-model';

    const dir = makeProject();
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    const progress: IndexProgress[] = [];
    const result = await cg.indexAll({ onProgress: (p) => progress.push(p) });

    // The index itself succeeds and actually indexed the two files.
    expect(result.success).toBe(true);
    expect(result.filesIndexed).toBeGreaterThan(0);
    // The endpoint was actually driven.
    expect(mock.requestCount()).toBeGreaterThanOrEqual(1);

    cg.close(); // flush + release before reading via a fresh connection
    const { rows, q } = readVectors(dir);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.model === 'test-model')).toBe(true);
    expect(rows.every((r) => r.dims === MOCK_DIMS)).toBe(true);

    // Coverage agrees: every eligible symbol embedded (100%).
    const cov = q.getEmbeddingCoverage('test-model');
    expect(cov.embeddable).toBe(rows.length);
    expect(cov.embedded).toBe(rows.length);

    // Progress surfaced the embedding phase, cumulative to full coverage.
    const embedEvents = progress.filter((p) => p.phase === 'embedding');
    expect(embedEvents.length).toBeGreaterThan(0);
    const last = embedEvents[embedEvents.length - 1]!;
    expect(last.current).toBe(last.total);
    expect(last.total).toBe(rows.length);
  });

  it('(b) fully unconfigured: indexAll is unchanged and byte-dormant — no vectors, no endpoint traffic, no advisory line', async () => {
    const mock = await startEmbedMock((inputs) => embedOk(inputs)); // present but must stay untouched
    // No CODEGRAPH_EMBEDDING_* set at all (beforeEach cleared them).

    const dir = makeProject();
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    const result = await cg.indexAll();

    expect(result.success).toBe(true);
    expect(result.filesIndexed).toBeGreaterThan(0);
    expect(mock.requestCount()).toBe(0);
    expect(warnings.some((w) => w.includes('CODEGRAPH_EMBEDDING'))).toBe(false);

    cg.close();
    expect(readVectors(dir).rows).toHaveLength(0);
  });

  it('(c) half-configured (URL only): indexAll succeeds, makes zero requests and writes zero vectors, and emits one advisory naming the missing variable', async () => {
    const mock = await startEmbedMock((inputs) => embedOk(inputs));
    process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings`;
    // CODEGRAPH_EMBEDDING_MODEL deliberately unset → half configuration.

    const dir = makeProject();
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    const result = await cg.indexAll();

    expect(result.success).toBe(true);
    expect(mock.requestCount()).toBe(0); // never constructs a provider
    expect(warnings.some((w) => w.includes('CODEGRAPH_EMBEDDING_MODEL'))).toBe(true);

    cg.close();
    expect(readVectors(dir).rows).toHaveLength(0);
  });

  it('(d) endpoint down (HTTP 500): the embed pass aborts advisorily — indexAll STILL succeeds and never throws, though no vectors land', async () => {
    const mock = await startEmbedMock(() => ({ status: 500, body: '{"error":"down"}' }));
    process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings`;
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'test-model';

    const dir = makeProject();
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);

    // Must not throw — embedding is advisory even when the endpoint is unreachable.
    const result = await cg.indexAll();
    expect(result.success).toBe(true);
    expect(result.filesIndexed).toBeGreaterThan(0);
    // The pass reached out (proving it was wired) but the down endpoint yielded nothing.
    expect(mock.requestCount()).toBeGreaterThanOrEqual(1);

    cg.close();
    expect(readVectors(dir).rows).toHaveLength(0);
  }, 20000);

  it('(e) a mid-pass dimension conflict aborts advisorily AND surfaces the CODEGRAPH_EMBEDDING_DIMS guidance to the log, rather than discarding it (FIX 1 / FR-021)', async () => {
    // The endpoint establishes 4-dim vectors on the first batch, then switches to 5-dim;
    // the provider rejects the change with a reason naming CODEGRAPH_EMBEDDING_DIMS.
    // Serial batches (concurrency 1, batchSize 2) make the switch deterministic — the
    // first request establishes the dimension, a later request conflicts.
    const mock = await startEmbedMock((inputs, count) => {
      const dims = count === 1 ? 4 : 5;
      const data = inputs.map((_t, index) => ({
        index,
        embedding: Array.from({ length: dims }, (_v, k) => k + index * 0.5),
      }));
      return { status: 200, body: JSON.stringify({ data, model: 'test-model' }) };
    });
    process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings`;
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'test-model';
    process.env.CODEGRAPH_EMBEDDING_BATCH_SIZE = '2';
    process.env.CODEGRAPH_EMBEDDING_CONCURRENCY = '1';

    const dir = makeProject();
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);

    // Advisory: the dimension conflict never fails the index.
    const result = await cg.indexAll();
    expect(result.success).toBe(true);
    expect(mock.requestCount()).toBeGreaterThanOrEqual(2); // established dims, then conflicted

    // The wiring must NOT silently swallow the pass result: the already-redacted abort
    // reason (carrying the actionable CODEGRAPH_EMBEDDING_DIMS message) reaches the log.
    expect(warnings.some((w) => w.includes('CODEGRAPH_EMBEDDING_DIMS'))).toBe(true);

    cg.close();
  }, 20000);
});

// =============================================================================
// T020 — the library observability method CodeGraph.getEmbeddingStatus(), the
// single source the `codegraph status` human section + `--json` embedding object
// both render from (contract: status-embedding-json.md / FR-022). It reads the
// activation config from process.env and the model/dims scalars + coverage counts
// from the on-disk index; it is NETWORK-FREE in every state (dormancy is never
// broken, FR-023) and the endpoint it reports is redacted to scheme+host+port
// (FR-023/SC-007). Real SQLite temp-dir DBs, seeded through a throwaway connection
// then read back through a freshly-opened CodeGraph; env is saved/restored.
// =============================================================================
describe.skipIf(!HAS_SQLITE)('getEmbeddingStatus (T020)', () => {
  const EMBED_ENV_KEYS = [
    'CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL', 'CODEGRAPH_EMBEDDING_API_KEY',
    'CODEGRAPH_EMBEDDING_DIMS', 'CODEGRAPH_EMBEDDING_BATCH_SIZE', 'CODEGRAPH_EMBEDDING_CONCURRENCY',
    'CODEGRAPH_EMBEDDING_TIMEOUT_MS',
  ];

  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];
  let savedEnv: Record<string, string | undefined> = {};

  /** Minimal valid node of a given kind (only the fields insertNode needs). */
  function mkNode(id: string, kind: NodeKind): Node {
    return {
      id, kind, name: id, qualifiedName: id, filePath: 'a.ts', language: 'typescript',
      startLine: 1, endLine: 1, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
    };
  }

  /** Raw little-endian f32 BLOB — the on-disk `vector` column shape. */
  function f32Blob(values: number[]): Uint8Array {
    return new Uint8Array(new Float32Array(values).buffer);
  }

  /**
   * A fresh v8-schema project (no indexing, no network), optionally seeded via a
   * throwaway connection that is CLOSED before we read — so the CodeGraph opened
   * over it observes exactly the seeded nodes/vectors/scalars.
   */
  function seededProject(seed?: (q: QueryBuilder) => void): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-embed-status-'));
    dirs.push(dir);
    CodeGraph.initSync(dir).close(); // create .codegraph + node_vectors/project_metadata, then release
    if (seed) {
      const conn = DatabaseConnection.open(getDatabasePath(dir));
      try { seed(new QueryBuilder(conn.getDb())); } finally { conn.close(); }
    }
    return dir;
  }

  /** Open the seeded project and return its embedding status (a network-free read). */
  function statusOf(dir: string) {
    const cg = CodeGraph.openSync(dir);
    graphs.push(cg);
    return cg.getEmbeddingStatus();
  }

  /** Run `fn` with `globalThis.fetch` trip-wired — any network attempt fails the test. */
  function withNoNetwork<T>(fn: () => T): T {
    const realFetch = globalThis.fetch;
    let attempted = false;
    (globalThis as unknown as { fetch: unknown }).fetch = () => {
      attempted = true;
      throw new Error('network call attempted during getEmbeddingStatus');
    };
    try {
      const out = fn();
      expect(attempted).toBe(false);
      return out;
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
  }

  beforeEach(() => {
    savedEnv = {};
    for (const k of EMBED_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of EMBED_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    while (graphs.length) {
      try { graphs.pop()!.close(); } catch { /* may already be closed */ }
    }
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(a) active — reports redacted endpoint + scalars + 100% coverage; userinfo/path/query never leak (FR-023/SC-007)', () => {
    const dir = seededProject((q) => {
      q.insertNodes([mkNode('a', 'function'), mkNode('b', 'class')]);
      q.upsertNodeVector('a', 'nomic', 4, f32Blob([1, 2, 3, 4]), 'ha');
      q.upsertNodeVector('b', 'nomic', 4, f32Blob([5, 6, 7, 8]), 'hb');
      q.setMetadata('embedding_model', 'nomic');
      q.setMetadata('embedding_dims', '4');
    });

    // A URL carrying userinfo, a path, and a query string — all must be stripped.
    process.env.CODEGRAPH_EMBEDDING_URL = 'https://user:s3cr3t@api.example.com:8443/v1/embeddings?key=leakme';
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'nomic';

    const status = statusOf(dir);

    // Whole-object equality proves BOTH the values AND the absence of extra keys.
    expect(status).toEqual({
      active: true,
      provider: 'endpoint',
      endpoint: 'https://api.example.com:8443',
      model: 'nomic',
      dims: 4,
      coverage: { embedded: 2, embeddable: 2, percent: 100 },
    });
    // Explicit SC-007: no credential/path/query fragment survives into the endpoint.
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.endpoint).not.toContain('s3cr3t');
      expect(status.endpoint).not.toContain('leakme');
      expect(status.endpoint).not.toContain('/v1');
    }
  });

  it('(a) active — partial coverage rounds embedded/embeddable to a percent', () => {
    const dir = seededProject((q) => {
      q.insertNodes([mkNode('a', 'function'), mkNode('b', 'function'), mkNode('c', 'function')]);
      q.upsertNodeVector('a', 'nomic', 4, f32Blob([1, 2, 3, 4]), 'ha'); // 1 of 3 embedded
      q.setMetadata('embedding_model', 'nomic');
      q.setMetadata('embedding_dims', '4');
    });
    process.env.CODEGRAPH_EMBEDDING_URL = 'https://api.example.com:8443';
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'nomic';

    const status = statusOf(dir);

    expect(status).toEqual({
      active: true,
      provider: 'endpoint',
      endpoint: 'https://api.example.com:8443',
      model: 'nomic',
      dims: 4,
      coverage: { embedded: 1, embeddable: 3, percent: 33 }, // round(33.33)
    });
  });

  it('(b) fully dormant, no prior data — only activationVars; no endpoint/model/previousRun keys', () => {
    // Nodes but no vectors and no scalars — nothing a prior run left behind.
    const dir = seededProject((q) => {
      q.insertNodes([mkNode('a', 'function'), mkNode('b', 'function')]);
    });
    // Env cleared in beforeEach → neither URL nor MODEL set.

    const status = statusOf(dir);

    expect(status).toEqual({
      active: false,
      activationVars: ['CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL'],
    });
    // The active-only fields must be genuinely absent, not just falsy.
    expect(status).not.toHaveProperty('endpoint');
    expect(status).not.toHaveProperty('model');
    expect(status).not.toHaveProperty('previousRun');
    expect(status).not.toHaveProperty('misconfigured');
  });

  it('(c) dormant WITH prior-run data on disk — previousRun populated from disk, no network touched', () => {
    const dir = seededProject((q) => {
      q.insertNodes([
        mkNode('a', 'function'), mkNode('b', 'function'),
        mkNode('c', 'function'), mkNode('d', 'function'),
      ]);
      // 3 of 4 embeddable symbols carry a 'nomic' vector → prior coverage 75%.
      q.upsertNodeVector('a', 'nomic', 8, f32Blob([1, 2, 3, 4, 5, 6, 7, 8]), 'ha');
      q.upsertNodeVector('b', 'nomic', 8, f32Blob([1, 2, 3, 4, 5, 6, 7, 8]), 'hb');
      q.upsertNodeVector('c', 'nomic', 8, f32Blob([1, 2, 3, 4, 5, 6, 7, 8]), 'hc');
      q.setMetadata('embedding_model', 'nomic');
      q.setMetadata('embedding_dims', '8');
    });
    // Env dormant. Prove the read never reaches out: any fetch is a test failure.
    const status = withNoNetwork(() => statusOf(dir));

    expect(status).toEqual({
      active: false,
      activationVars: ['CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL'],
      previousRun: { model: 'nomic', dims: 8, coverage: { embedded: 3, embeddable: 4, percent: 75 } },
    });
  });

  it('(c) dormant with scalars but NO live vectors — previousRun omitted (the embedded>0 gate)', () => {
    const dir = seededProject((q) => {
      q.insertNodes([mkNode('a', 'function'), mkNode('b', 'function')]);
      // Only an ORPHAN vector (no such live node) plus a different-model vector —
      // neither counts toward 'nomic' coverage, so no live prior run exists.
      q.upsertNodeVector('ghost', 'nomic', 4, f32Blob([1, 2, 3, 4]), 'hg'); // orphan node_id
      q.upsertNodeVector('a', 'voyage', 4, f32Blob([1, 2, 3, 4]), 'hv');    // other model
      q.setMetadata('embedding_model', 'nomic');
      q.setMetadata('embedding_dims', '4');
    });

    const status = statusOf(dir);

    // Scalars alone don't manufacture a prior run — a live 'nomic' vector must exist.
    expect(status).toEqual({
      active: false,
      activationVars: ['CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL'],
    });
    expect(status).not.toHaveProperty('previousRun');
  });

  it('(d) half-config, URL only — misconfigured names the missing MODEL; no previousRun even with prior data', () => {
    // Seed prior-run data to prove a half-config NEVER surfaces previousRun.
    const dir = seededProject((q) => {
      q.insertNodes([mkNode('a', 'function')]);
      q.upsertNodeVector('a', 'nomic', 4, f32Blob([1, 2, 3, 4]), 'ha');
      q.setMetadata('embedding_model', 'nomic');
      q.setMetadata('embedding_dims', '4');
    });
    process.env.CODEGRAPH_EMBEDDING_URL = 'https://api.example.com:8443';
    // MODEL deliberately unset.

    const status = statusOf(dir);

    expect(status).toEqual({
      active: false,
      misconfigured: true,
      missingVariable: 'CODEGRAPH_EMBEDDING_MODEL',
      activationVars: ['CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL'],
    });
    expect(status).not.toHaveProperty('previousRun');
    expect(status).not.toHaveProperty('endpoint');
  });

  it('(d) half-config, MODEL only — misconfigured names the missing URL', () => {
    const dir = seededProject();
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'nomic';
    // URL deliberately unset.

    const status = statusOf(dir);

    expect(status).toEqual({
      active: false,
      misconfigured: true,
      missingVariable: 'CODEGRAPH_EMBEDDING_URL',
      activationVars: ['CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL'],
    });
  });

  it('(e) active on an empty graph — embeddable 0 ⇒ percent 100; model/dims fall back to config when no scalar', () => {
    const dir = seededProject(); // no nodes, no vectors, no scalars
    process.env.CODEGRAPH_EMBEDDING_URL = 'https://api.example.com:8443';
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'nomic';

    const status = statusOf(dir);

    expect(status).toEqual({
      active: true,
      provider: 'endpoint',
      endpoint: 'https://api.example.com:8443',
      model: 'nomic', // no scalar → falls back to the active config's model
      dims: null,      // no scalar and no CODEGRAPH_EMBEDDING_DIMS → null
      coverage: { embedded: 0, embeddable: 0, percent: 100 }, // trivially complete
    });
  });
});

// =============================================================================
// T021 + T022 — Slice-A end-to-end invariant & behavior suites.
//
// These are EMERGENT-invariant suites: config/provider/pass/wiring/status are all
// already implemented (and green in the sections above). Every test here drives the
// WHOLE stack — a real temp project + real CodeGraph.init/indexAll against a local
// node:http mock endpoint that RECORDS every request (method, url, headers, body) —
// and pins a property that MUST already hold. A failure would mean a real production
// gap in src/embeddings/* (or the embedding wiring in src/index.ts). T021 pins the
// security invariants (no secret ever reaches disk or logs; egress goes only to the
// configured endpoint; no new runtime dependency). T022 pins the observable behavior
// (100% coverage; byte-dormancy when off; keyless requests; node/edge parity; status
// shapes).
//
// Platform note (de-risked empirically before writing): Node's built-in fetch REJECTS
// a URL that embeds userinfo credentials with a TypeError whose OWN message contains
// those credentials verbatim. The endpoint provider reads only that error's `.name`
// and rethrows a redacted error, so a userinfo endpoint aborts the (advisory) embed
// pass BEFORE one byte leaves the process — the harshest possible redaction input,
// exercised by the first T021 test. Egress/behavior tests use a credential-free URL so
// the request actually reaches the mock. (`src/embeddings/endpoint-provider.ts` is the
// ONLY `fetch(` call site in all of src/, so the fetch trip-wire in the egress test
// captures the entire codebase's outbound network surface.)
// =============================================================================

const SLICE_A_ENV_KEYS = [
  'CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL', 'CODEGRAPH_EMBEDDING_API_KEY',
  'CODEGRAPH_EMBEDDING_DIMS', 'CODEGRAPH_EMBEDDING_BATCH_SIZE', 'CODEGRAPH_EMBEDDING_CONCURRENCY',
  'CODEGRAPH_EMBEDDING_TIMEOUT_MS',
] as const;

/** Vector length the mock returns; also the inferred `dims` when DIMS is unset. */
const SLICE_A_MOCK_DIMS = 4;

interface SliceARecordedRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
type SliceAReply = { status: number; headers?: Record<string, string>; body?: string } | 'hang';
interface SliceAMock {
  origin: string;
  /** `127.0.0.1:<port>` — the redacted endpoint AND the expected fetch destination host. */
  host: string;
  requests: SliceARecordedRequest[];
  requestCount: () => number;
  close: () => Promise<void>;
}

/**
 * A local OpenAI-compatible embeddings endpoint that RECORDS every request (method,
 * url, headers, body). `reply` maps the decoded `input[]` + 1-based call count to an
 * HTTP result, or `'hang'` to receive-but-never-answer (drives the per-request timeout
 * path). Registered into `mocks` for afterEach teardown.
 */
async function startSliceAMock(
  mocks: SliceAMock[],
  reply: (inputs: string[], count: number) => SliceAReply,
): Promise<SliceAMock> {
  const requests: SliceARecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      let inputs: string[] = [];
      try {
        inputs = (JSON.parse(body) as { input?: string[] }).input ?? [];
      } catch {
        /* leave inputs empty — the reply decides what to send */
      }
      const r = reply(inputs, requests.length);
      if (r === 'hang') return; // received, deliberately never answered
      res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers ?? {}) });
      res.end(r.body ?? '');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const mock: SliceAMock = {
    origin: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
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

/** 200 with exactly one SLICE_A_MOCK_DIMS-length vector per input (count MUST match, FR-021a). */
function sliceAEmbedOk(inputs: string[]): SliceAReply {
  const data = inputs.map((_t, index) => ({
    index,
    embedding: Array.from({ length: SLICE_A_MOCK_DIMS }, (_v, k) => k + index * 0.5),
  }));
  return { status: 200, body: JSON.stringify({ data, model: 'test-model' }) };
}

/**
 * A fresh temp project with two deterministic TS files carrying embeddable
 * declarations; `extraFiles` (keyed by a name relative to `src/`) seeds additional
 * sources — the egress test injects a marker file. Content is byte-identical across
 * calls so two roots index to identical graphs (the T022 byte-identity assertion).
 */
function makeSliceAProject(dirs: string[], extraFiles: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-slicea-'));
  dirs.push(dir);
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);
  fs.writeFileSync(
    path.join(srcDir, 'math.ts'),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n' +
      'export function subtract(a: number, b: number): number {\n  return a - b;\n}\n' +
      'export const PI = 3.14159;\n',
  );
  fs.writeFileSync(
    path.join(srcDir, 'shapes.ts'),
    'export interface Shape {\n  area(): number;\n}\n' +
      'export class Circle implements Shape {\n' +
      '  constructor(public radius: number) {}\n' +
      '  area(): number {\n    return Math.PI * this.radius * this.radius;\n  }\n}\n',
  );
  for (const [rel, content] of Object.entries(extraFiles)) {
    fs.writeFileSync(path.join(srcDir, rel), content);
  }
  return dir;
}

/** Every regular file under `.codegraph/`, read as raw bytes (SQLite db + WAL + lock…). */
function walkCodegraphFiles(projectRoot: string): Array<{ path: string; buf: Buffer }> {
  const out: Array<{ path: string; buf: Buffer }> = [];
  const stack = [path.join(projectRoot, '.codegraph')];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue; // directory vanished / unreadable — nothing to search here
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          out.push({ path: p, buf: fs.readFileSync(p) });
        } catch {
          /* skip an unreadable file (e.g. a held lock) — never itself a source of a secret */
        }
      }
      // non-regular entries (sockets/fifos/symlinks) can't carry a persisted secret — skip
    }
  }
  return out;
}

/** Absolute paths of files whose raw bytes contain `needle` (utf-8/ASCII substring search). */
function filesContainingSecret(files: Array<{ path: string; buf: Buffer }>, needle: string): string[] {
  return files.filter((f) => f.buf.includes(needle)).map((f) => f.path);
}

interface NodeVectorRow { node_id: string; model: string; dims: number; input_hash: string }
/** All node_vectors rows via a FRESH connection (independent of the indexer under test). */
function readNodeVectorRows(projectRoot: string, inspectConns: DatabaseConnection[]): NodeVectorRow[] {
  const conn = DatabaseConnection.open(getDatabasePath(projectRoot));
  inspectConns.push(conn);
  return conn
    .getDb()
    .prepare('SELECT node_id, model, dims, input_hash FROM node_vectors ORDER BY node_id')
    .all() as NodeVectorRow[];
}

/** Node/edge counts via a FRESH connection — the graph the index actually produced. */
function readGraphCounts(
  projectRoot: string,
  inspectConns: DatabaseConnection[],
): { nodes: number; edges: number } {
  const conn = DatabaseConnection.open(getDatabasePath(projectRoot));
  inspectConns.push(conn);
  return new QueryBuilder(conn.getDb()).getNodeAndEdgeCount();
}

describe.skipIf(!HAS_SQLITE)('Slice A security invariants (T021)', () => {
  // The three configured secrets that must never touch disk or a log line (SC-007/FR-023):
  // the bearer key, the URL userinfo password, and the URL query credential.
  const SECRETS = ['sk-secret-T021', 'urlpass', 'qs-secret'];

  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];
  const inspectConns: DatabaseConnection[] = [];
  const mocks: SliceAMock[] = [];
  const logs: string[] = [];
  let savedEnv: Record<string, string | undefined> = {};
  let savedLogger: ReturnType<typeof getLogger>;

  beforeEach(() => {
    savedEnv = {};
    for (const k of SLICE_A_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    logs.length = 0;
    // Record EVERY level (debug/warn/error) AND any context object, so a secret leaked
    // to ANY log channel is caught — not just warn (as T019 recorded).
    savedLogger = getLogger();
    const rec = (message: string, context?: Record<string, unknown>): void => {
      let ctx = '';
      if (context !== undefined) {
        try { ctx = ' ' + JSON.stringify(context); } catch { ctx = ' ' + String(context); }
      }
      logs.push(message + ctx);
    };
    setLogger({ debug: rec, warn: rec, error: rec });
  });

  afterEach(async () => {
    setLogger(savedLogger);
    for (const k of SLICE_A_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (inspectConns.length) { try { inspectConns.pop()!.close(); } catch { /* already closed */ } }
    await Promise.all(mocks.splice(0).map((m) => m.close()));
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('1. credentials in the API key AND the endpoint URL never reach disk or logs after indexAll (SC-007/FR-023)', async () => {
    // A mock that WOULD answer 200 if reached — present precisely to prove it is NOT reached.
    const mock = await startSliceAMock(mocks, (inputs) => sliceAEmbedOk(inputs));
    // Userinfo (user:urlpass) + query credential (qs-secret) embedded in the URL, plus a
    // bearer key. Node's fetch rejects a userinfo URL (a TypeError whose message embeds the
    // creds); the provider reads only `.name` and rethrows a redacted error, so the advisory
    // pass aborts and NOT ONE credential byte leaves the process.
    process.env.CODEGRAPH_EMBEDDING_URL = `http://user:urlpass@${mock.host}/v1/embeddings?api_key=qs-secret`;
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'test-model';
    process.env.CODEGRAPH_EMBEDDING_API_KEY = 'sk-secret-T021';

    const dir = makeSliceAProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    const result = await cg.indexAll();

    // The advisory embed abort never fails the index; the userinfo URL means zero egress.
    expect(result.success).toBe(true);
    expect(result.filesIndexed).toBeGreaterThan(0);
    expect(mock.requestCount()).toBe(0); // fetch refused the credentialed URL BEFORE sending

    cg.close(); // flush WAL before reading raw bytes off disk

    const files = walkCodegraphFiles(dir);
    // Non-vacuous: we actually searched a populated .codegraph, incl. the SQLite db file.
    expect(files.length).toBeGreaterThan(0);
    const dbFile = files.find((f) => f.path.endsWith('codegraph.db'));
    expect(dbFile).toBeDefined();
    expect(dbFile!.buf.length).toBeGreaterThan(0);

    for (const secret of SECRETS) {
      expect(filesContainingSecret(files, secret)).toEqual([]);
      expect(logs.filter((l) => l.includes(secret))).toEqual([]);
    }
    // The advisory abort persisted no vectors (consistent with zero egress).
    expect(readNodeVectorRows(dir, inspectConns)).toHaveLength(0);
  }, 30000);

  it('2. failure paths (401 echoing the key / timeout / malformed 200) still succeed and never surface a secret (FR-014/019/023)', async () => {
    const scenarios: Array<{ name: string; reply: (inputs: string[], count: number) => SliceAReply; timeoutMs?: string }> = [
      {
        name: '401 with a body echoing all three secrets',
        reply: (): SliceAReply => ({
          status: 401,
          body: JSON.stringify({ error: 'invalid credentials: key=sk-secret-T021 user:urlpass api_key=qs-secret' }),
        }),
      },
      { name: 'timeout (endpoint receives but never answers)', reply: (): SliceAReply => 'hang', timeoutMs: '50' },
      {
        name: 'malformed 200 (body is not valid JSON, and it too echoes a secret)',
        reply: (): SliceAReply => ({ status: 200, body: 'not-json{{{ sk-secret-T021' }),
      },
    ];

    for (const sc of scenarios) {
      const mock = await startSliceAMock(mocks, sc.reply);
      // Credential-free URL so the request actually REACHES the mock and the failure mode
      // fires; the query credential still exercises URL redaction on the working path.
      process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings?api_key=qs-secret`;
      process.env.CODEGRAPH_EMBEDDING_MODEL = 'test-model';
      process.env.CODEGRAPH_EMBEDDING_API_KEY = 'sk-secret-T021';
      if (sc.timeoutMs) process.env.CODEGRAPH_EMBEDDING_TIMEOUT_MS = sc.timeoutMs;
      else delete process.env.CODEGRAPH_EMBEDDING_TIMEOUT_MS;

      const dir = makeSliceAProject(dirs);
      const cg = await CodeGraph.init(dir);
      graphs.push(cg);

      let threw: unknown;
      let result: IndexResult | undefined;
      try {
        result = await cg.indexAll();
      } catch (e) {
        threw = e; // must NOT happen — embedding is advisory (FR-014/019)
      }
      expect(threw).toBeUndefined();
      expect(result!.success).toBe(true);
      expect(mock.requestCount()).toBeGreaterThanOrEqual(1); // the failure path genuinely fired

      cg.close();
      const files = walkCodegraphFiles(dir);
      for (const secret of SECRETS) {
        // The scenario name is folded in so a failure identifies which mode leaked.
        expect({ scenario: sc.name, offenders: filesContainingSecret(files, secret) })
          .toEqual({ scenario: sc.name, offenders: [] });
        expect(logs.filter((l) => l.includes(secret))).toEqual([]);
        expect(String(threw ?? '')).not.toContain(secret); // no thrown-error text either
      }
    }
  }, 30000);

  it('3. code egress goes ONLY to the configured endpoint; only the input hash — never the source — is persisted (SC-011/FR-024/FR-025a)', async () => {
    const MARKER = 'UNIQUE_EGRESS_MARKER_98765';
    const mock = await startSliceAMock(mocks, (inputs) => sliceAEmbedOk(inputs));
    process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings?api_key=qs-secret`;
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'test-model';
    process.env.CODEGRAPH_EMBEDDING_API_KEY = 'sk-secret-T021';

    // A symbol whose SOURCE (comment + return value) carries the distinctive marker.
    const dir = makeSliceAProject(dirs, {
      'marker.ts':
        'export function egressMarkerFn(): string {\n' +
        `  // ${MARKER} lives inside this function body\n` +
        `  return '${MARKER}';\n` +
        '}\n',
    });

    // Trip-wire the global fetch (the codebase's ONLY fetch call site) to record EVERY
    // outbound destination host:port, then delegate to the real fetch.
    const realFetch = globalThis.fetch;
    const fetchHosts: string[] = [];
    (globalThis as unknown as { fetch: typeof fetch }).fetch = ((input: unknown, init?: unknown) => {
      try {
        const u = typeof input === 'string' ? input
          : input instanceof URL ? input.href
          : (input as { url?: string })?.url ?? String(input);
        fetchHosts.push(new URL(u).host);
      } catch { /* ignore a non-URL fetch input */ }
      return (realFetch as (i: unknown, ii?: unknown) => Promise<Response>)(input, init);
    }) as typeof fetch;

    let cg: CodeGraph | undefined;
    let result: IndexResult | undefined;
    try {
      cg = await CodeGraph.init(dir);
      graphs.push(cg);
      result = await cg.indexAll();
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = realFetch;
    }

    expect(result!.success).toBe(true);
    expect(mock.requestCount()).toBeGreaterThanOrEqual(1);

    // (a) Egress destination: EXACTLY one host:port, and it is the configured mock. This
    //     pins SC-011 across the whole codebase (no telemetry / phone-home fetch).
    expect([...new Set(fetchHosts)]).toEqual([mock.host]);

    // (b) Every request body is exactly { model, input } — no extra keys smuggled in — and
    //     the source marker was actually SENT to the endpoint.
    let markerSent = false;
    for (const req of mock.requests) {
      const parsed = JSON.parse(req.body) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(['input', 'model']);
      expect(typeof parsed.model).toBe('string');
      expect(Array.isArray(parsed.input)).toBe(true);
      if (req.body.includes(MARKER)) markerSent = true;
    }
    expect(markerSent).toBe(true);

    cg!.close();

    // (c) The source marker reached the endpoint but is NOWHERE on disk or in a log line —
    //     only its 64-hex input_hash is persisted.
    const files = walkCodegraphFiles(dir);
    expect(filesContainingSecret(files, MARKER)).toEqual([]);
    expect(logs.filter((l) => l.includes(MARKER))).toEqual([]);
    // The two configured credentials, though legitimately sent to the endpoint, likewise
    // never hit disk or logs (redaction holds on the working path too).
    expect(filesContainingSecret(files, 'sk-secret-T021')).toEqual([]);
    expect(filesContainingSecret(files, 'qs-secret')).toEqual([]);
    expect(logs.filter((l) => l.includes('sk-secret-T021') || l.includes('qs-secret'))).toEqual([]);

    const rows = readNodeVectorRows(dir, inspectConns);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.input_hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex — the source's hash, not the source
      expect(r.input_hash).not.toContain(MARKER);
      expect(r.model).toBe('test-model');
    }
  }, 30000);

  it('4. embedding adds NO unplanned runtime dependency — package.json deps include only planned feature additions; peerDeps unchanged (FR-025/SC-008)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    // The exact runtime dependency set — the SPEC-001 endpoint provider rides on the
    // built-in fetch + node:crypto alone (no telemetry SDK, no HTTP client). SPEC-002
    // (T002) adds onnxruntime-web for the local ONNX embedding fallback. SPEC-009
    // adds ws for the local LSP browser transport. Any OTHER new entry here means
    // an unplanned runtime dependency slipped in with either feature.
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual([
      '@clack/prompts',
      'commander',
      'fast-string-width',
      'fast-wrap-ansi',
      'ignore',
      'jsonc-parser',
      'onnxruntime-web',
      'picomatch',
      'sisteransi',
      'tree-sitter-wasms',
      'web-tree-sitter',
      'ws',
    ]);
    // No peer dependencies at all (embeddings introduced none).
    expect(pkg.peerDependencies).toBeUndefined();
  });
});

describe.skipIf(!HAS_SQLITE)('Slice A behavior (T022)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];
  const inspectConns: DatabaseConnection[] = [];
  const mocks: SliceAMock[] = [];
  const warnings: string[] = [];
  let savedEnv: Record<string, string | undefined> = {};
  let savedLogger: ReturnType<typeof getLogger>;

  beforeEach(() => {
    savedEnv = {};
    for (const k of SLICE_A_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    warnings.length = 0;
    savedLogger = getLogger();
    setLogger({ debug() {}, warn(m: string) { warnings.push(m); }, error() {} });
  });

  afterEach(async () => {
    setLogger(savedLogger);
    for (const k of SLICE_A_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (inspectConns.length) { try { inspectConns.pop()!.close(); } catch { /* already closed */ } }
    await Promise.all(mocks.splice(0).map((m) => m.close()));
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('1. a full active index reaches 100% coverage at the inferred dims and the configured model (SC-001/US1-AS1/AS4)', async () => {
    const mock = await startSliceAMock(mocks, (inputs) => sliceAEmbedOk(inputs));
    process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings`;
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'test-model';
    // CODEGRAPH_EMBEDDING_DIMS deliberately unset → dims inferred from the mock's vectors.

    const dir = makeSliceAProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    const result = await cg.indexAll();
    expect(result.success).toBe(true);

    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.endpoint).toBe(mock.origin); // redacted to scheme + host + port
      expect(status.model).toBe('test-model');
      expect(status.dims).toBe(SLICE_A_MOCK_DIMS); // inferred, not configured
      expect(status.coverage.percent).toBe(100);
      expect(status.coverage.embedded).toBe(status.coverage.embeddable);
      expect(status.coverage.embedded).toBeGreaterThan(0);
    }
  }, 20000);

  it('2. fully unconfigured: byte-dormant and deterministic — no traffic, no vectors, no advisory line, identical IndexResult across two roots (SC-002/US1-AS2)', async () => {
    // A mock that is listening but NEVER referenced by any env var.
    const mock = await startSliceAMock(mocks, (inputs) => sliceAEmbedOk(inputs));
    // No CODEGRAPH_EMBEDDING_* set at all (beforeEach cleared them).

    const dirA = makeSliceAProject(dirs);
    const cgA = await CodeGraph.init(dirA);
    graphs.push(cgA);
    const resultA = await cgA.indexAll();
    cgA.close();

    const dirB = makeSliceAProject(dirs);
    const cgB = await CodeGraph.init(dirB);
    graphs.push(cgB);
    const resultB = await cgB.indexAll();
    cgB.close();

    // Dormant: the unconfigured mock saw nothing; no advisory line; no vectors either side.
    expect(mock.requestCount()).toBe(0);
    expect(warnings.some((w) => /embedding/i.test(w))).toBe(false);
    expect(readNodeVectorRows(dirA, inspectConns)).toHaveLength(0);
    expect(readNodeVectorRows(dirB, inspectConns)).toHaveLength(0);

    // Practical byte-identity: same fixture ⇒ identical IndexResult (minus wall-clock) and
    // identical node/edge counts. Dormant indexing is byte-for-byte unchanged by the feature.
    const omitTiming = (r: IndexResult): Omit<IndexResult, 'durationMs'> => ({
      success: r.success,
      filesIndexed: r.filesIndexed,
      filesSkipped: r.filesSkipped,
      filesErrored: r.filesErrored,
      nodesCreated: r.nodesCreated,
      edgesCreated: r.edgesCreated,
      errors: r.errors,
    });
    expect(resultA.success).toBe(true);
    expect(resultA.errors).toEqual([]);
    expect(omitTiming(resultA)).toEqual(omitTiming(resultB));
    expect(readGraphCounts(dirA, inspectConns)).toEqual(readGraphCounts(dirB, inspectConns));
  }, 20000);

  it('3. a keyless endpoint sends no Authorization header and still embeds (US1-AS3)', async () => {
    const mock = await startSliceAMock(mocks, (inputs) => sliceAEmbedOk(inputs));
    process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings`;
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'test-model';
    // No CODEGRAPH_EMBEDDING_API_KEY → keyless.

    const dir = makeSliceAProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    const result = await cg.indexAll();

    expect(result.success).toBe(true);
    expect(mock.requestCount()).toBeGreaterThanOrEqual(1);
    // Every request omitted the Authorization header entirely.
    for (const req of mock.requests) {
      expect(req.headers['authorization']).toBeUndefined();
    }

    cg.close();
    expect(readNodeVectorRows(dir, inspectConns).length).toBeGreaterThan(0); // the pass still succeeded
  }, 20000);

  it('4. node/edge counts are identical with embeddings ON vs OFF (SC-006/FR-024)', async () => {
    // ON
    const mock = await startSliceAMock(mocks, (inputs) => sliceAEmbedOk(inputs));
    process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings`;
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'test-model';
    const dirOn = makeSliceAProject(dirs);
    const cgOn = await CodeGraph.init(dirOn);
    graphs.push(cgOn);
    expect((await cgOn.indexAll()).success).toBe(true);
    cgOn.close();

    // OFF
    delete process.env.CODEGRAPH_EMBEDDING_URL;
    delete process.env.CODEGRAPH_EMBEDDING_MODEL;
    const dirOff = makeSliceAProject(dirs);
    const cgOff = await CodeGraph.init(dirOff);
    graphs.push(cgOff);
    expect((await cgOff.indexAll()).success).toBe(true);
    cgOff.close();

    const countsOn = readGraphCounts(dirOn, inspectConns);
    const countsOff = readGraphCounts(dirOff, inspectConns);
    // The graph itself is untouched by embedding — vectors live in a side table (node_vectors).
    expect(countsOn).toEqual(countsOff);
    expect(countsOn.nodes).toBeGreaterThan(0);
    expect(countsOn.edges).toBeGreaterThan(0);
    // Non-vacuous: the ON run really embedded (side table populated); the OFF run did not.
    expect(readNodeVectorRows(dirOn, inspectConns).length).toBeGreaterThan(0);
    expect(readNodeVectorRows(dirOff, inspectConns)).toHaveLength(0);
  }, 20000);

  it('5. getEmbeddingStatus reports active → dormant(+previousRun) → misconfigured end-to-end after a real pass (SC-001)', async () => {
    const mock = await startSliceAMock(mocks, (inputs) => sliceAEmbedOk(inputs));
    process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings`;
    process.env.CODEGRAPH_EMBEDDING_MODEL = 'test-model';

    const dir = makeSliceAProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);

    // ACTIVE — both vars set, a real pass has run (getEmbeddingStatus re-reads env live).
    const active = cg.getEmbeddingStatus();
    expect(active.active).toBe(true);
    if (active.active) {
      expect(active.model).toBe('test-model');
      expect(active.dims).toBe(SLICE_A_MOCK_DIMS);
      expect(active.coverage.percent).toBe(100);
    }

    // DORMANT — clear both vars; the on-disk prior run surfaces as previousRun (from disk,
    // no network).
    delete process.env.CODEGRAPH_EMBEDDING_URL;
    delete process.env.CODEGRAPH_EMBEDDING_MODEL;
    const dormant = cg.getEmbeddingStatus();
    expect(dormant.active).toBe(false);
    if (!dormant.active && !('misconfigured' in dormant)) {
      expect(dormant.activationVars).toEqual(['CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL']);
      expect(dormant.previousRun).toBeDefined();
      expect(dormant.previousRun!.model).toBe('test-model');
      expect(dormant.previousRun!.dims).toBe(SLICE_A_MOCK_DIMS);
      expect(dormant.previousRun!.coverage.embedded).toBeGreaterThan(0);
      expect(dormant.previousRun!.coverage.percent).toBe(100);
    }

    // MISCONFIGURED — exactly one var set names the single missing one.
    process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings`;
    const misconfigured = cg.getEmbeddingStatus();
    expect(misconfigured.active).toBe(false);
    if (!misconfigured.active && 'misconfigured' in misconfigured) {
      expect(misconfigured.misconfigured).toBe(true);
      expect(misconfigured.missingVariable).toBe('CODEGRAPH_EMBEDDING_MODEL');
    } else {
      throw new Error('expected a misconfigured status when only CODEGRAPH_EMBEDDING_URL is set');
    }
  }, 20000);
});
