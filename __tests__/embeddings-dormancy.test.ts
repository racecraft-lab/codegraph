/**
 * Embedding dormancy guard — SPEC-002 T001 (SC-004 / FR-005).
 *
 * Pins the dormant behavior SPEC-001 already established: with no
 * `CODEGRAPH_EMBEDDING_*` environment variable set at all, a full index
 * (`CodeGraph.indexAll` — the library entry point `codegraph index` drives)
 * performs ZERO outbound network calls and writes ZERO `node_vectors` rows —
 * observably byte-identical to a build without the embedding feature at all.
 *
 * This suite is a GUARD, not a feature test: no SPEC-002 provider code exists
 * yet (local ONNX fallback, model download, …), so it is GREEN the moment
 * it's written — the dormant behavior it pins already exists, wired in
 * SPEC-001 (`src/embeddings/config.ts`'s `loadEmbeddingConfig` returning
 * `null`, and `CodeGraph`'s private `maybeRunEmbeddingPass` short-circuiting
 * on that `null` before ever constructing a provider). It MUST STAY green
 * through every later SPEC-002 phase: any change that makes an unconfigured
 * index touch the network or write a vector is a dormancy regression, full
 * stop — not a TDD violation to "fix" by editing this test.
 *
 * Real temp project + real SQLite (repo convention: no DB mocking). Network
 * absence is proven by spying on the platform global `fetch` rather than only
 * trusting a mock server's request count: `endpoint-provider.ts` is the ONLY
 * call site of `fetch` in the entire `src/` tree, so a call count of 0 here
 * is a whole-process guarantee that nothing reached the network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph } from '../src';
import { DatabaseConnection, getDatabasePath } from '../src/db';
import { setLogger, getLogger } from '../src/errors';

let HAS_SQLITE = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:sqlite');
  HAS_SQLITE = true;
} catch {
  HAS_SQLITE = false;
}

const EMBED_ENV_KEYS = [
  'CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL', 'CODEGRAPH_EMBEDDING_API_KEY',
  'CODEGRAPH_EMBEDDING_DIMS', 'CODEGRAPH_EMBEDDING_BATCH_SIZE', 'CODEGRAPH_EMBEDDING_CONCURRENCY',
  'CODEGRAPH_EMBEDDING_TIMEOUT_MS',
  // SPEC-002 selection + model-acquisition vars — must also be cleared or an
  // ambient PROVIDER=local (or a MODEL_* override) in the runner would break
  // this suite's hermetic dormancy.
  'CODEGRAPH_EMBEDDING_PROVIDER', 'CODEGRAPH_MODEL_BASE_URL', 'CODEGRAPH_MODEL_CACHE_DIR',
];

/**
 * Replace `globalThis.fetch` with a call-counting spy that throws if invoked.
 * `endpoint-provider.ts` calls the platform's built-in global `fetch`
 * unqualified, so it resolves through this same global — a dormant pass
 * (which returns before ever constructing a provider) must never reach it.
 */
function spyFetch(): { count: () => number; restore: () => void } {
  const real = globalThis.fetch;
  let calls = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = (...args: unknown[]) => {
    calls++;
    throw new Error(`embeddings-dormancy: unexpected outbound fetch while dormant: ${String(args[0])}`);
  };
  return {
    count: () => calls,
    restore: () => {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = real;
    },
  };
}

/** A real temp project with a couple of embeddable declarations — enough for a non-trivial index. */
function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-embed-dormancy-'));
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);
  fs.writeFileSync(
    path.join(srcDir, 'math.ts'),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n' +
      'export class Calculator {\n  square(n: number): number {\n    return n * n;\n  }\n}\n',
  );
  return dir;
}

/** `node_vectors` row count via a FRESH connection, independent of the indexer under test. */
function vectorCount(dir: string): number {
  const conn = DatabaseConnection.open(getDatabasePath(dir));
  try {
    const row = conn.getDb().prepare('SELECT COUNT(*) AS c FROM node_vectors').get() as { c: number };
    return row.c;
  } finally {
    conn.close();
  }
}

describe.skipIf(!HAS_SQLITE)('embedding dormancy guard (T001, SC-004/FR-005)', () => {
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
  });

  afterEach(() => {
    setLogger(savedLogger);
    for (const k of EMBED_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    while (graphs.length) {
      try { graphs.pop()!.close(); } catch { /* may already be closed by the test */ }
    }
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a full index with no CODEGRAPH_EMBEDDING_* env set makes zero outbound fetch calls, writes zero node_vectors rows, and emits no advisory log line (byte-identical to a no-feature build)', async () => {
    // Confirms this suite's own scoping: nothing ambient survived into beforeEach.
    for (const k of EMBED_ENV_KEYS) expect(process.env[k]).toBeUndefined();

    const fetchSpy = spyFetch();
    try {
      const dir = makeProject();
      dirs.push(dir);
      const cg = await CodeGraph.init(dir);
      graphs.push(cg);

      const result = await cg.indexAll();

      // The index itself genuinely ran — this isn't a no-op or an early failure.
      expect(result.success).toBe(true);
      expect(result.filesIndexed).toBeGreaterThan(0);

      // Zero network: the embed pass never even reached the one fetch call site.
      expect(fetchSpy.count()).toBe(0);

      // Zero writes: no vector rows landed in the table SPEC-001 already ships.
      cg.close();
      expect(vectorCount(dir)).toBe(0);

      // Zero noise: a fully-dormant pass is byte-silent, not just inert.
      expect(warnings.some((w) => w.includes('CODEGRAPH_EMBEDDING'))).toBe(false);
    } finally {
      fetchSpy.restore();
    }
  });
});
