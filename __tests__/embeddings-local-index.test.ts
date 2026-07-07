/**
 * Local embedding index wiring — SPEC-002 T019/T020/T024 (SC-001/007/008 + US3 degrade).
 *
 * Drives `CodeGraph.indexAll()` / `sync()` end-to-end with
 * `CODEGRAPH_EMBEDDING_PROVIDER=local`, through the REAL `LocalProvider` +
 * `runEmbeddingPass` + index wiring — only the provider's two true external seams
 * are stubbed hermetically via `__setLocalProviderOverridesForTests`:
 *   - `createWorker` → an in-process fake worker returning deterministic 384-dim
 *     vectors (no `worker_threads` thread, no ONNX);
 *   - `acquireLocalModel` → a fake returning verified dummy paths (T019) or a typed
 *     `unavailable` (T020) — no 22MB download, no cache directory touched.
 * Real onnxruntime-web inference is validated LATER by the T028 self-repo dogfood.
 *
 * Real SQLite temp projects, no DB mocking (repo convention). `globalThis.fetch`
 * is trip-wired so any accidental network attempt fails the test — SC-001's
 * "no endpoint contacted" is a whole-process guarantee (endpoint-provider.ts is
 * the only `fetch` call site in all of src/).
 *
 * T024 tests (below) reuse this same harness to prove `indexAll`'s
 * `embeddingsProvider` option — what `codegraph index --embeddings <provider>`
 * threads through — overrides `CODEGRAPH_EMBEDDING_PROVIDER` for that one call only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph, __setLocalProviderOverridesForTests } from '../src';
import { DatabaseConnection, getDatabasePath } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import { setLogger, getLogger } from '../src/errors';
import type { LocalEmbedWorker } from '../src/embeddings/local-provider';
import type { LocalModelArtifacts, LocalModelUnavailable } from '../src/embeddings/model-fetch';
import { LOCAL_VECTOR_MODEL } from '../src/embeddings/config';

let HAS_SQLITE = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:sqlite');
  HAS_SQLITE = true;
} catch {
  HAS_SQLITE = false;
}

/** The one pinned local checkpoint — the user-facing display model (node_vectors rows key off LOCAL_VECTOR_MODEL). */
const LOCAL_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const LOCAL_DIMS = 384;

const EMBED_ENV_KEYS = [
  'CODEGRAPH_EMBEDDING_PROVIDER', 'CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL',
  'CODEGRAPH_EMBEDDING_API_KEY', 'CODEGRAPH_EMBEDDING_DIMS', 'CODEGRAPH_EMBEDDING_BATCH_SIZE',
  'CODEGRAPH_EMBEDDING_CONCURRENCY', 'CODEGRAPH_EMBEDDING_TIMEOUT_MS',
  'CODEGRAPH_MODEL_CACHE_DIR', 'CODEGRAPH_MODEL_BASE_URL',
];

/** Acquire override yielding verified (dummy) paths — the fake worker never reads them. */
const okAcquire = async (): Promise<LocalModelArtifacts | LocalModelUnavailable> => ({
  modelPath: '/fake/model_quantized.onnx',
  tokenizerPath: '/fake/tokenizer.json',
});

/** Acquire override that degrades — the US3 offline case (FR-007/019/SC-005). */
const OFFLINE_MESSAGE =
  'Local embedding model unavailable: could not download model_quantized.onnx from https://huggingface.co ' +
  '(override with CODEGRAPH_MODEL_BASE_URL). To use the local embedding provider offline, place a verified copy and re-run.';
const unavailableAcquire = async (): Promise<LocalModelUnavailable> => ({ unavailable: 'offline', message: OFFLINE_MESSAGE });

/**
 * In-process fake of the worker: answers `init` → `ready` and `embed` → 384-dim
 * vectors (one per input), deterministically. No thread, no ONNX. `dims === 384`
 * so the pass's FR-021 enforcement (config.dims = 384) is satisfied from batch one.
 */
class FakeWorker implements LocalEmbedWorker {
  private readonly handlers: Record<string, Array<(arg: unknown) => void>> = {};
  on(event: 'message' | 'error' | 'exit', cb: (arg: never) => void): void {
    (this.handlers[event] ??= []).push(cb as (arg: unknown) => void);
  }
  private emit(event: string, arg?: unknown): void {
    for (const cb of this.handlers[event] ?? []) cb(arg);
  }
  postMessage(msg: unknown): void {
    const m = msg as { type: string; id?: number; texts?: string[] };
    if (m.type === 'init') {
      queueMicrotask(() => this.emit('message', { type: 'ready' }));
    } else if (m.type === 'embed') {
      const vectors = (m.texts ?? []).map((t, k) => {
        const v = new Float32Array(LOCAL_DIMS);
        v[0] = (t.length % 97) + 1; // non-zero, content-derived, bounded
        v[1] = k;
        return v;
      });
      queueMicrotask(() => this.emit('message', { type: 'embed-result', id: m.id, vectors }));
    } else if (m.type === 'shutdown') {
      queueMicrotask(() => this.emit('message', { type: 'shutdown-ack' }));
    }
  }
  terminate(): Promise<number> {
    queueMicrotask(() => this.emit('exit', 0));
    return Promise.resolve(0);
  }
}

/** A real temp project with several embeddable declarations. Content is fixed across calls. */
function makeLocalProject(dirs: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-local-index-'));
  dirs.push(dir);
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);
  fs.writeFileSync(
    path.join(srcDir, 'math.ts'),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n' +
      'export function subtract(a: number, b: number): number {\n  return a - b;\n}\n' +
      'export class Calculator {\n  square(n: number): number {\n    return n * n;\n  }\n}\n',
  );
  fs.writeFileSync(
    path.join(srcDir, 'greet.ts'),
    'export function greet(name: string): string {\n  return `hello ${name}`;\n}\n' +
      'export const VERSION = "1.0.0";\n',
  );
  return dir;
}

interface VecRow { node_id: string; model: string; dims: number }

/** node_vectors rows + the embeddable-symbol count, via a FRESH connection (independent of the indexer). */
function inspect(dir: string): { rows: VecRow[]; embeddable: number } {
  const conn = DatabaseConnection.open(getDatabasePath(dir));
  try {
    const rows = conn
      .getDb()
      .prepare('SELECT node_id, model, dims FROM node_vectors ORDER BY node_id')
      .all() as VecRow[];
    // "Embeddable" is exactly the pass's own definition: symbols with no vector under
    // a never-used model === every embeddable symbol in the graph.
    const q = new QueryBuilder(conn.getDb());
    const embeddable = q.getEmbeddingCoverage('__none__').embeddable;
    return { rows, embeddable };
  } finally {
    conn.close();
  }
}

/** node/edge counts via a FRESH connection — proves embedding mutates neither. */
function graphCounts(dir: string): { nodes: number; edges: number } {
  const conn = DatabaseConnection.open(getDatabasePath(dir));
  try {
    const nodes = (conn.getDb().prepare('SELECT COUNT(*) AS c FROM nodes').get() as { c: number }).c;
    const edges = (conn.getDb().prepare('SELECT COUNT(*) AS c FROM edges').get() as { c: number }).c;
    return { nodes, edges };
  } finally {
    conn.close();
  }
}

/** Seed a vector for every embeddable node under a PRIOR (endpoint) model — the FR-022 switch fixture. */
function seedPriorModelVectors(dir: string, priorModel: string): number {
  const conn = DatabaseConnection.open(getDatabasePath(dir));
  try {
    const q = new QueryBuilder(conn.getDb());
    const nodes = q.selectEmbeddableNodesMissingVector(priorModel); // all embeddable (none embedded yet)
    const dummy = Buffer.alloc(8 * 4); // 8-dim f32 blob — a different dimension than local's 384
    for (const n of nodes) {
      q.upsertNodeVector(n.id, priorModel, 8, dummy, 'prior-hash-0000');
    }
    return nodes.length;
  } finally {
    conn.close();
  }
}

/** Replace `globalThis.fetch` with a spy that FAILS on any call (SC-001 whole-process guard). */
function spyFetch(): { count: () => number; restore: () => void } {
  const real = globalThis.fetch;
  let calls = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = (...args: unknown[]) => {
    calls++;
    throw new Error(`embeddings-local-index: unexpected outbound fetch: ${String(args[0])}`);
  };
  return {
    count: () => calls,
    restore: () => { (globalThis as unknown as { fetch: typeof fetch }).fetch = real; },
  };
}

describe.skipIf(!HAS_SQLITE)('local embedding index wiring (T019/T020/T024)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];
  const warnings: string[] = [];
  let savedEnv: Record<string, string | undefined> = {};
  let savedLogger: ReturnType<typeof getLogger>;

  beforeEach(() => {
    savedEnv = {};
    for (const k of EMBED_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    warnings.length = 0;
    savedLogger = getLogger();
    setLogger({ debug() {}, warn(m: string) { warnings.push(m); }, error() {} });
    __setLocalProviderOverridesForTests(undefined);
  });

  afterEach(() => {
    setLogger(savedLogger);
    __setLocalProviderOverridesForTests(undefined);
    for (const k of EMBED_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // --- T019 -----------------------------------------------------------------

  it('1. a full local index embeds 100% of symbols at dims 384 under the checkpoint model, contacting NO endpoint (SC-001)', async () => {
    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
    __setLocalProviderOverridesForTests({ acquireLocalModel: okAcquire, createWorker: () => new FakeWorker() });

    const dir = makeLocalProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);

    const fetchSpy = spyFetch();
    let result;
    try {
      result = await cg.indexAll();
    } finally {
      fetchSpy.restore();
    }

    expect(result.success).toBe(true);
    expect(result.filesIndexed).toBeGreaterThan(0);
    expect(fetchSpy.count()).toBe(0); // SC-001: no endpoint contacted

    // Observable via the library status API too: 100% local coverage.
    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.model).toBe(LOCAL_MODEL_ID);
      expect(status.dims).toBe(LOCAL_DIMS);
      expect(status.coverage.percent).toBe(100);
    }

    cg.close();
    const { rows, embeddable } = inspect(dir);
    expect(embeddable).toBeGreaterThan(0);
    expect(rows).toHaveLength(embeddable); // every embeddable symbol carries a vector
    for (const r of rows) {
      expect(r.model).toBe(LOCAL_VECTOR_MODEL);
      expect(r.dims).toBe(LOCAL_DIMS);
    }
  }, 20000);

  it('2. re-indexing identical source leaves node + edge counts UNCHANGED (embedding mutates only vectors) (FR-023/SC-007)', async () => {
    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
    __setLocalProviderOverridesForTests({ acquireLocalModel: okAcquire, createWorker: () => new FakeWorker() });

    const dir = makeLocalProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);

    expect((await cg.indexAll()).success).toBe(true);
    const first = graphCounts(dir);
    expect(first.nodes).toBeGreaterThan(0);

    // Re-index the byte-identical source: structural graph is stable, only vectors are touched.
    expect((await cg.indexAll()).success).toBe(true);
    const second = graphCounts(dir);

    expect(second.nodes).toBe(first.nodes);
    expect(second.edges).toBe(first.edges);
  }, 20000);

  it('3. switching a prior endpoint-embedded project to local re-embeds ALL via model-column mismatch — no manual migration (FR-022/SC-008)', async () => {
    // 1. Structural index with embeddings OFF — nodes exist, no vectors.
    const dir = makeLocalProject(dirs);
    const cg1 = await CodeGraph.init(dir);
    expect((await cg1.indexAll()).success).toBe(true);
    cg1.close();

    // 2. Seed a vector for every embeddable symbol under a PRIOR endpoint model (8-dim).
    const seeded = seedPriorModelVectors(dir, 'prior-endpoint-model');
    expect(seeded).toBeGreaterThan(0);
    for (const r of inspect(dir).rows) expect(r.model).toBe('prior-endpoint-model');

    // 3. Switch to local and sync() — the pass re-selects every symbol (model mismatch)
    //    and re-embeds it, no manual migration step.
    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
    __setLocalProviderOverridesForTests({ acquireLocalModel: okAcquire, createWorker: () => new FakeWorker() });
    const cg2 = await CodeGraph.open(dir);
    graphs.push(cg2);
    await cg2.sync();
    cg2.close();

    // 4. Every vector row now carries the LOCAL model at 384 dims.
    const { rows, embeddable } = inspect(dir);
    expect(rows).toHaveLength(embeddable);
    expect(rows).toHaveLength(seeded); // same symbols, re-embedded in place
    for (const r of rows) {
      expect(r.model).toBe(LOCAL_VECTOR_MODEL);
      expect(r.dims).toBe(LOCAL_DIMS);
    }
  }, 20000);

  // --- T020 -----------------------------------------------------------------

  it('4. an UNAVAILABLE model degrades cleanly: structural index completes, embed skipped, exit 0, reason surfaced, 0% coverage (FR-007/019/SC-005)', async () => {
    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
    __setLocalProviderOverridesForTests({ acquireLocalModel: unavailableAcquire, createWorker: () => new FakeWorker() });

    const dir = makeLocalProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);

    const fetchSpy = spyFetch();
    let result;
    try {
      result = await cg.indexAll();
    } finally {
      fetchSpy.restore();
    }

    // Structural index completed fully — success is the exit-0 semantics (a non-zero exit
    // is reserved for a FAILED structural index, which this is not).
    expect(result.success).toBe(true);
    expect(result.filesIndexed).toBeGreaterThan(0);
    expect(fetchSpy.count()).toBe(0);

    // The actionable degrade reason was surfaced (not swallowed silently).
    expect(warnings.some((w) => w.includes('could not download') || w.includes('unavailable'))).toBe(true);

    // Status reports 0% coverage (the embed pass was skipped) — and does not throw.
    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.coverage.percent).toBe(0);
      expect(status.coverage.embedded).toBe(0);
    }

    cg.close();
    // Zero vectors written — the pass degraded before persisting anything.
    expect(inspect(dir).rows).toHaveLength(0);
  }, 20000);

  // --- T024 (--embeddings flag / IndexOptions.embeddingsProvider override) --

  it('5. embeddingsProvider "local" activates the local pass for one call even with the env fully unset (FR-002)', async () => {
    // beforeEach already stripped every embedding env var — the override alone
    // must be enough to select local, mirroring what `codegraph index --embeddings
    // local` does with no CODEGRAPH_EMBEDDING_PROVIDER set at all.
    __setLocalProviderOverridesForTests({ acquireLocalModel: okAcquire, createWorker: () => new FakeWorker() });

    const dir = makeLocalProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);

    const result = await cg.indexAll({ embeddingsProvider: 'local' });
    expect(result.success).toBe(true);
    expect(result.filesIndexed).toBeGreaterThan(0);

    // getEmbeddingStatus() takes no override and reads the (still-unset) env
    // as-is, so it correctly reports dormant — the override never persists past
    // this one call. The writes that call made are real, though, and visible
    // via the dormant branch's previousRun snapshot (read straight from disk).
    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(false);
    expect('misconfigured' in status).toBe(false);
    if (!status.active && !('misconfigured' in status)) {
      expect(status.previousRun?.model).toBe(LOCAL_MODEL_ID);
      expect(status.previousRun?.coverage.percent).toBe(100);
    }

    cg.close();
    const { rows, embeddable } = inspect(dir);
    expect(embeddable).toBeGreaterThan(0);
    expect(rows).toHaveLength(embeddable); // every embeddable symbol carries a vector
  }, 20000);

  it('6. embeddingsProvider "off" overrides an active CODEGRAPH_EMBEDDING_PROVIDER=local env for that one call only (FR-002)', async () => {
    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
    __setLocalProviderOverridesForTests({ acquireLocalModel: okAcquire, createWorker: () => new FakeWorker() });

    const dir = makeLocalProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);

    // The override wins over the env for THIS invocation — the pass never runs.
    const result = await cg.indexAll({ embeddingsProvider: 'off' });
    expect(result.success).toBe(true);
    expect(result.filesIndexed).toBeGreaterThan(0);

    // Scoped to this one call only: getEmbeddingStatus() takes no override and
    // still resolves the (unchanged) env, which still says `local` — it just
    // observes zero live coverage, since no pass wrote anything under it.
    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.provider).toBe('local');
      expect(status.coverage.percent).toBe(0);
    }

    cg.close();
    expect(inspect(dir).rows).toHaveLength(0); // no vectors — the pass was skipped
  }, 20000);

  it('7. switching to local re-embeds even when the prior endpoint used the SAME model name as the local checkpoint — no silent reuse of endpoint vectors (FR-022)', async () => {
    // 1. Structural index with embeddings OFF — nodes exist, no vectors.
    const dir = makeLocalProject(dirs);
    const cg1 = await CodeGraph.init(dir);
    expect((await cg1.indexAll()).success).toBe(true);
    cg1.close();

    // 2. Seed a vector for every embeddable symbol under the BARE checkpoint name — the
    //    collision case: a user whose endpoint served `Xenova/all-MiniLM-L6-v2` (8-dim
    //    placeholder blobs, a DIFFERENT dimension than local's 384). Without a
    //    provider-qualified local key these would look like current local vectors.
    const seeded = seedPriorModelVectors(dir, 'Xenova/all-MiniLM-L6-v2');
    expect(seeded).toBeGreaterThan(0);

    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
    __setLocalProviderOverridesForTests({ acquireLocalModel: okAcquire, createWorker: () => new FakeWorker() });
    const cg2 = await CodeGraph.open(dir);
    graphs.push(cg2);

    // 3. BEFORE re-embedding: local coverage is 0% — the endpoint vectors under the bare
    //    name are NOT counted as local (local vectors key off the provider-qualified
    //    LOCAL_VECTOR_MODEL). Without the fix they share the key and read as 100% covered.
    const before = cg2.getEmbeddingStatus();
    expect(before.active).toBe(true);
    if (before.active) expect(before.coverage.percent).toBe(0);

    // 4. sync() re-embeds every symbol (local key mismatches the endpoint key), no manual migration.
    await cg2.sync();

    const after = cg2.getEmbeddingStatus();
    expect(after.active).toBe(true);
    if (after.active) {
      expect(after.coverage.percent).toBe(100);
      expect(after.dims).toBe(LOCAL_DIMS);       // 384, not the seeded 8 → a genuine local re-embed
      expect(after.model).toBe(LOCAL_MODEL_ID);  // display stays the unprefixed checkpoint id
    }
    cg2.close();

    // 5. Every vector now carries the provider-qualified LOCAL key at 384 dims; the 8-dim
    //    endpoint rows under the bare name were overwritten in place (node_vectors PK is node_id).
    const { rows, embeddable } = inspect(dir);
    expect(rows).toHaveLength(embeddable);
    expect(rows).toHaveLength(seeded); // same symbols, re-embedded in place
    for (const r of rows) {
      expect(r.model).toBe(LOCAL_VECTOR_MODEL);
      expect(r.dims).toBe(LOCAL_DIMS);
    }
  }, 20000);

  it('8. local super-chunks stay batchSize-sized regardless of CONCURRENCY — the single serial worker gets no parallelism, so the multiplier is not applied', async () => {
    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
    process.env.CODEGRAPH_EMBEDDING_BATCH_SIZE = '2';
    // With the endpoint semantics (super-chunk = batchSize * concurrency) this would send an
    // 8-wide worker message; the local branch folds concurrency to 1, so it must stay <= 2.
    process.env.CODEGRAPH_EMBEDDING_CONCURRENCY = '4';

    const embedSizes: number[] = [];
    class RecordingWorker extends FakeWorker {
      postMessage(msg: unknown): void {
        const m = msg as { type: string; texts?: string[] };
        if (m.type === 'embed') embedSizes.push((m.texts ?? []).length);
        super.postMessage(msg);
      }
    }
    __setLocalProviderOverridesForTests({ acquireLocalModel: okAcquire, createWorker: () => new RecordingWorker() });

    const dir = makeLocalProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    cg.close();

    // Enough symbols that an 8-wide super-chunk WOULD visibly differ from a 2-wide one.
    const { embeddable } = inspect(dir);
    expect(embeddable).toBeGreaterThan(2);
    expect(embedSizes.length).toBeGreaterThan(0);
    expect(Math.max(...embedSizes)).toBeLessThanOrEqual(2);
  }, 20000);

  it('9. sync({ embeddingsProvider: "local" }) activates the local pass for that one sync even with the env unset — what `codegraph sync --embeddings local` threads through (FR-002)', async () => {
    // beforeEach stripped every embedding env var; the override alone selects local for this
    // sync, mirroring what the newly-wired `codegraph sync --embeddings local` passes down.
    __setLocalProviderOverridesForTests({ acquireLocalModel: okAcquire, createWorker: () => new FakeWorker() });

    const dir = makeLocalProject(dirs);
    const cg = await CodeGraph.init(dir); // structural index, embeddings OFF (env unset)
    graphs.push(cg);

    await cg.sync({ embeddingsProvider: 'local' });
    cg.close();

    // The one-invocation override ran the local embed pass during sync: every embeddable symbol
    // now carries a local vector under the provider-qualified key.
    const { rows, embeddable } = inspect(dir);
    expect(embeddable).toBeGreaterThan(0);
    expect(rows).toHaveLength(embeddable);
    for (const r of rows) {
      expect(r.model).toBe(LOCAL_VECTOR_MODEL);
      expect(r.dims).toBe(LOCAL_DIMS);
    }
  }, 20000);
});
