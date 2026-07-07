/**
 * Local-provider status observability — SPEC-002 Phase 5 (T021).
 *
 * `codegraph status` / `CodeGraph.getEmbeddingStatus()` must show the active
 * LOCAL provider (not the SPEC-001 endpoint) via a `provider` discriminant —
 * never by overloading `endpoint` with the sentinel string `'local'` — plus
 * the model, dims (384), and live coverage (FR-021/SC-006).
 *
 * When there was something to embed but nothing carries a vector under the
 * active model, status names the DISTINCT, best-effort 0%-coverage reason
 * (FR-020): `offline`, `cache` (unwritable/invalid cache dir), or
 * `session-init-timeout` — derived AT STATUS TIME from a network-free
 * filesystem probe of the model cache, never from a persisted record of a
 * past pass's actual abort (none is kept: `keys.filter(k =>
 * k.startsWith('embedding_'))` is pinned to exactly `['embedding_dims',
 * 'embedding_model']` by embeddings-resilience.test.ts, so a new persisted
 * reason key would be a regression). The verify-before-use/atomic-rename
 * acquisition design (model-fetch.ts) means a discarded checksum mismatch
 * leaves the identical on-disk footprint as "never attempted" — both fold
 * into `offline` per FR-020's own allowance for a generic reason when the
 * transient one isn't persisted. `misconfig` (an unrecognized provider
 * selection) is pre-existing SPEC-001 behavior, unchanged; exercised here
 * only as a regression anchor closing out FR-020's full reason list.
 *
 * Hermetic: real SQLite temp-dir projects (repo convention — no DB mocking).
 * Cache-directory fixtures nest under a validated, writable parent (see
 * setup/model-cache-fixture.ts), NOT os.tmpdir(): on macOS os.tmpdir() resolves
 * under /var, which is ITSELF a SENSITIVE_PATHS entry, so a tmpdir-based scratch
 * dir would be (correctly) rejected as sensitive. No real network, no real ~22MB
 * model.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'node:crypto';
import { CodeGraph, __setLocalProviderOverridesForTests, __setLocalModelCacheProbeOverridesForTests } from '../src';
import type { LocalEmbedWorker } from '../src/embeddings/local-provider';
import type { LocalModelArtifacts, LocalModelUnavailable, PinnedArtifact } from '../src/embeddings/model-fetch';
import { modelCacheFixtureParent } from './setup/model-cache-fixture';
import { LOCAL_VECTOR_MODEL } from '../src/embeddings/config';

let HAS_SQLITE = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:sqlite');
  HAS_SQLITE = true;
} catch {
  HAS_SQLITE = false;
}

/** The one pinned local checkpoint — mirrors config.ts's LOCAL_MODEL_ID/LOCAL_DIMS. */
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

/**
 * In-process fake of the worker: answers `init` -> `ready` and `embed` ->
 * 384-dim vectors (one per input), deterministically. No thread, no ONNX.
 * Mirrors embeddings-local-index.test.ts's FakeWorker.
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
    }
  }
  terminate(): Promise<number> {
    queueMicrotask(() => this.emit('exit', 0));
    return Promise.resolve(0);
  }
}

/** A real temp project with a couple of embeddable declarations. */
function makeProject(dirs: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-local-status-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'math.ts'),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n' +
      'export function subtract(a: number, b: number): number {\n  return a - b;\n}\n',
  );
  return dir;
}

/**
 * Homedir-nested scratch dir for a model-cache fixture — NOT os.tmpdir()
 * (see file header). Distinct helper from `makeProject` because a project
 * root has no SENSITIVE_PATHS concern; a model cache dir does.
 */
function createCacheDir(dirs: string[]): string {
  // A model cache dir must pass validateModelCacheDir (non-sensitive + writable); see
  // modelCacheFixtureParent for the root/Docker rationale.
  const dir = fs.mkdtempSync(path.join(modelCacheFixtureParent(), '.cg-local-status-test-'));
  dirs.push(dir);
  return dir;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A small, test-only artifact pair — never the real ~22MB production pin (SHA-256 preimage resistance). */
function fakeArtifacts(content: Buffer): { model: PinnedArtifact; tokenizer: PinnedArtifact } {
  const sha256 = sha256Hex(content);
  return {
    model: { relPath: 'fake-model.bin', size: content.length, sha256 },
    tokenizer: { relPath: 'fake-tokenizer.bin', size: content.length, sha256 },
  };
}

/** Writes verified (matching) bytes at the module's on-disk layout: <cacheDir>/all-MiniLM-L6-v2/<basename>. */
function seedVerifiedCache(cacheDir: string, artifacts: { model: PinnedArtifact; tokenizer: PinnedArtifact }, content: Buffer): void {
  const modelDir = path.join(cacheDir, 'all-MiniLM-L6-v2');
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, path.basename(artifacts.model.relPath)), content);
  fs.writeFileSync(path.join(modelDir, path.basename(artifacts.tokenizer.relPath)), content);
}

describe.skipIf(!HAS_SQLITE)('local-provider status observability (T021)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv = {};
    for (const k of EMBED_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    __setLocalProviderOverridesForTests(undefined);
    __setLocalModelCacheProbeOverridesForTests(undefined);
  });

  afterEach(() => {
    __setLocalProviderOverridesForTests(undefined);
    __setLocalModelCacheProbeOverridesForTests(undefined);
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

  it('1. active local status reports provider "local", model, dims 384, full coverage, and no endpoint field (FR-021/SC-006)', async () => {
    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
    __setLocalProviderOverridesForTests({ acquireLocalModel: okAcquire, createWorker: () => new FakeWorker() });

    const dir = makeProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);

    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.provider).toBe('local');
      expect(status.model).toBe(LOCAL_MODEL_ID);
      expect(status.dims).toBe(LOCAL_DIMS);
      expect(status.coverage.percent).toBe(100);
      expect(status.coverage.embedded).toBeGreaterThan(0);
      expect(status.endpoint).toBeUndefined(); // never overloaded with the 'local' sentinel
      expect(status.skipReason).toBeUndefined(); // nothing to explain — it succeeded
    }
  }, 20000);

  it('2. 0%-coverage local status: valid but empty cache -> reason "offline" (FR-020)', async () => {
    const dir = makeProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    // Structural-only index (no embedding env set yet): embeddable nodes exist,
    // none embedded under ANY model.
    expect((await cg.indexAll()).success).toBe(true);

    const cacheDir = createCacheDir(dirs);
    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
    process.env.CODEGRAPH_MODEL_CACHE_DIR = cacheDir; // valid dir, nothing acquired yet

    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.provider).toBe('local');
      expect(status.coverage.embeddable).toBeGreaterThan(0);
      expect(status.coverage.embedded).toBe(0);
      expect(status.skipReason).toBe('offline');
    }
  });

  it('3. 0%-coverage local status: cache directory itself invalid -> reason "cache" (FR-017a/FR-020)', async () => {
    const dir = makeProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);

    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
    // Same sensitive-path fixture embeddings-model-fetch.test.ts uses for validateModelCacheDir.
    process.env.CODEGRAPH_MODEL_CACHE_DIR = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\cg-models-status-test'
      : '/opt/cg-models-status-test-should-not-exist';

    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.coverage.embedded).toBe(0);
      expect(status.skipReason).toBe('cache');
    }
  });

  it('4. 0%-coverage local status: model verified in cache but still unembedded -> reason "session-init-timeout" (FR-019b/FR-020)', async () => {
    const dir = makeProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);

    const cacheDir = createCacheDir(dirs);
    const content = Buffer.from('verified-status-probe-fixture-bytes');
    const artifacts = fakeArtifacts(content);
    seedVerifiedCache(cacheDir, artifacts, content);
    __setLocalModelCacheProbeOverridesForTests({ artifacts });

    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
    process.env.CODEGRAPH_MODEL_CACHE_DIR = cacheDir;

    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.coverage.embedded).toBe(0);
      expect(status.skipReason).toBe('session-init-timeout');
    }
  });

  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)('4b. 0%-coverage local status: an existing but UNWRITABLE (read-only) cache dir -> reason "cache", not "offline" (P2-a/FR-020)', async () => {
    const dir = makeProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);

    // A valid (non-sensitive), existing cache dir the model was never downloaded into
    // because it is not writable — a permissions problem, NOT "offline/not downloaded".
    const cacheDir = createCacheDir(dirs);
    fs.chmodSync(cacheDir, 0o500); // read + execute, no write
    try {
      process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
      process.env.CODEGRAPH_MODEL_CACHE_DIR = cacheDir;

      const status = cg.getEmbeddingStatus();
      expect(status.active).toBe(true);
      if (status.active) {
        expect(status.coverage.embedded).toBe(0);
        expect(status.skipReason).toBe('cache'); // permissions, not offline
      }
    } finally {
      fs.chmodSync(cacheDir, 0o700); // restore so afterEach can remove it
    }
  });

  it('5. an unrecognized CODEGRAPH_EMBEDDING_PROVIDER value still reports the pre-existing "misconfig" shape, not a local skipReason (FR-020 regression anchor)', async () => {
    const dir = makeProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);

    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'bogus-value';

    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(false);
    if (!status.active && 'misconfigured' in status) {
      expect(status.misconfigured).toBe(true);
      expect(status.missingVariable).toBe('CODEGRAPH_EMBEDDING_PROVIDER');
    } else {
      throw new Error('expected a misconfigured status for an unrecognized provider value');
    }
  });

  it('5b. explicit CODEGRAPH_EMBEDDING_PROVIDER=endpoint with BOTH URL and MODEL unset reports missingVariables=[URL, MODEL] (so status text never claims the counterpart is set)', async () => {
    const dir = makeProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);

    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'endpoint';
    // Neither CODEGRAPH_EMBEDDING_URL nor CODEGRAPH_EMBEDDING_MODEL is set (cleared in beforeEach).

    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(false);
    if (!status.active && 'misconfigured' in status) {
      expect(status.misconfigured).toBe(true);
      // Both are unset — the status must name BOTH, not imply one is already set.
      expect(status.missingVariables).toEqual(['CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL']);
    } else {
      throw new Error('expected a misconfigured status for endpoint with neither var set');
    }
  });

  it('5c. explicit CODEGRAPH_EMBEDDING_PROVIDER=off reports dormant WITH disabledByProvider=true, distinct from an unset dormancy', async () => {
    const dir = makeProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);

    // Explicit off: config collapses to null (FR-003), but status must flag the deliberate
    // disable so the CLI gives accurate guidance instead of "set URL and MODEL to enable".
    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'off';
    const offStatus = cg.getEmbeddingStatus();
    expect(offStatus.active).toBe(false);
    if (!offStatus.active && !('misconfigured' in offStatus)) {
      expect(offStatus.disabledByProvider).toBe(true);
    } else {
      throw new Error('expected a dormant (non-misconfigured) status for PROVIDER=off');
    }

    // An unset environment is dormant too, but NOT disabledByProvider — the two must differ.
    delete process.env.CODEGRAPH_EMBEDDING_PROVIDER;
    const unsetStatus = cg.getEmbeddingStatus();
    expect(unsetStatus.active).toBe(false);
    if (!unsetStatus.active && !('misconfigured' in unsetStatus)) {
      expect(unsetStatus.disabledByProvider).toBeUndefined();
    } else {
      throw new Error('expected a plain dormant status when nothing is set');
    }
  });

  it('6. prior ENDPOINT model persisted, then PROVIDER=local without re-embedding -> status reports the LOCAL model + dims 384 + 0% coverage, NEVER the stale endpoint model/dims/coverage (P1-1)', async () => {
    const dir = makeProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);

    // Simulate a project previously embedded via an ENDPOINT provider under a
    // different model + dimension: seed a vector for every embeddable node and
    // persist that model's scalars — exactly the on-disk state a completed
    // endpoint pass leaves behind.
    const ENDPOINT_MODEL = 'text-embedding-3-small';
    const ENDPOINT_DIMS = 1536;
    const q = (cg as unknown as {
      queries: {
        selectEmbeddableNodesMissingVector(model: string): Array<{ id: string }>;
        upsertNodeVector(id: string, model: string, dims: number, blob: Buffer, hash: string): void;
        setMetadata(key: string, value: string): void;
        getEmbeddingCoverage(model: string): { embeddable: number; embedded: number };
      };
    }).queries;
    for (const node of q.selectEmbeddableNodesMissingVector(ENDPOINT_MODEL)) {
      q.upsertNodeVector(node.id, ENDPOINT_MODEL, ENDPOINT_DIMS, Buffer.alloc(ENDPOINT_DIMS * 4), 'h-endpoint');
    }
    q.setMetadata('embedding_model', ENDPOINT_MODEL);
    q.setMetadata('embedding_dims', String(ENDPOINT_DIMS));
    // The endpoint model IS fully covered on disk — the exact state that used to
    // leak into a `provider:local` status as a stale model + stale 100% coverage.
    expect(q.getEmbeddingCoverage(ENDPOINT_MODEL).embedded).toBeGreaterThan(0);

    // The user switches to local but has NOT re-embedded yet. Pin the cache dir to
    // a fresh, empty (valid) one so the skip-reason probe is hermetic, not a read of
    // the real ~/.codegraph/models.
    const cacheDir = createCacheDir(dirs);
    process.env.CODEGRAPH_EMBEDDING_PROVIDER = 'local';
    process.env.CODEGRAPH_MODEL_CACHE_DIR = cacheDir;

    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.provider).toBe('local');
      // The ACTIVE local model + its dimension — NOT the stale persisted endpoint scalars.
      expect(status.model).toBe(LOCAL_MODEL_ID);
      expect(status.dims).toBe(LOCAL_DIMS);
      // Coverage is for the active local model: no local-model vectors exist yet.
      expect(status.coverage.embedded).toBe(0);
      expect(status.coverage.percent).toBe(0);
      expect(status.coverage.embeddable).toBeGreaterThan(0);
      expect(status.endpoint).toBeUndefined();
      // 0% coverage against an empty-but-valid cache surfaces the offline skip reason.
      expect(status.skipReason).toBe('offline');
    }
  }, 20000);

  it('7. prior LOCAL model persisted, then ENDPOINT active without re-embedding -> status reports the ENDPOINT model + 0% coverage, NEVER the stale local model/dims/100% coverage (P1-1 endpoint twin)', async () => {
    const dir = makeProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);

    // Simulate a project previously embedded via the LOCAL provider: seed a vector for
    // every embeddable node under the local model + persist its scalars — the on-disk
    // state a completed local pass leaves behind.
    const q = (cg as unknown as {
      queries: {
        selectEmbeddableNodesMissingVector(model: string): Array<{ id: string }>;
        upsertNodeVector(id: string, model: string, dims: number, blob: Buffer, hash: string): void;
        setMetadata(key: string, value: string): void;
        getEmbeddingCoverage(model: string): { embeddable: number; embedded: number };
      };
    }).queries;
    // Local vectors persist under the provider-qualified storage key (a real local pass
    // writes LOCAL_VECTOR_MODEL); the metadata scalar mirrors it.
    for (const node of q.selectEmbeddableNodesMissingVector(LOCAL_VECTOR_MODEL)) {
      q.upsertNodeVector(node.id, LOCAL_VECTOR_MODEL, LOCAL_DIMS, Buffer.alloc(LOCAL_DIMS * 4), 'h-local');
    }
    q.setMetadata('embedding_model', LOCAL_VECTOR_MODEL);
    q.setMetadata('embedding_dims', String(LOCAL_DIMS));
    // The local model IS fully covered on disk — the exact state that used to leak into
    // a `provider:endpoint` status as a stale model + stale 100% coverage.
    expect(q.getEmbeddingCoverage(LOCAL_VECTOR_MODEL).embedded).toBeGreaterThan(0);

    // The user switches to an ENDPOINT under a DIFFERENT model but has NOT re-embedded.
    const ENDPOINT_MODEL = 'text-embedding-3-small';
    process.env.CODEGRAPH_EMBEDDING_URL = 'https://api.example.com/v1/embeddings';
    process.env.CODEGRAPH_EMBEDDING_MODEL = ENDPOINT_MODEL;

    const status = cg.getEmbeddingStatus();
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.provider).toBe('endpoint');
      // The ACTIVE endpoint model — NOT the stale persisted local model.
      expect(status.model).toBe(ENDPOINT_MODEL);
      expect(status.model).not.toBe(LOCAL_MODEL_ID);
      // Coverage is for the active endpoint model: no endpoint-model vectors exist yet.
      expect(status.coverage.embedded).toBe(0);
      expect(status.coverage.percent).toBe(0);
      expect(status.coverage.embeddable).toBeGreaterThan(0);
      // The persisted 384 describes the OTHER (local) model — it must NOT be surfaced.
      expect(status.dims).not.toBe(LOCAL_DIMS);
    }
  }, 20000);
});
