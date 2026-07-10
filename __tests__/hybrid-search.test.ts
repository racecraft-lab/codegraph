/**
 * Hybrid semantic search — the SPEC-003 gate suite (this file is the designated
 * home; later tasks extend it). T004 covers the mode-plumbing contract only:
 * `CodeGraph.searchNodes(query, { mode })` accepts a mode, defaults to keyword,
 * and coerces any unknown / out-of-enum value to keyword WITHOUT throwing —
 * running the existing keyword pipeline byte-identically to today (FR-001/003,
 * contract search-api, SC-004). No hybrid/semantic wiring is exercised here.
 *
 * Real SQLite temp projects, no DB mocking (repo convention). Embeddings stay
 * OFF (env unset) so indexing is structural-only and every mode is dormant →
 * keyword.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph, __setQueryEmbeddingProviderForTests } from '../src';
import { DatabaseConnection, getDatabasePath } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import { encodeVector } from '../src/embeddings/indexer-hook';
import {
  buildVectorMatrix,
  getVectorMatrix,
  getVectorMatrixForProbe,
  probeVectorStaleness,
  vectorMatrixSourceFromQueries,
  acquireQueryVector,
  semanticTopK,
  candidateDepth,
  rrfMerge,
  RRF_K,
  __resetVectorMatrixCacheForTests,
  MAX_MATRIX_BYTES,
  LATENCY_FIXTURE_SEED,
  type StalenessProbe,
  type VectorMatrixSource,
  type VectorMatrixResult,
  type VectorRow,
  type VectorMatrix,
  type QueryVectorAcquisition,
  type SemanticCandidate,
  type FusedResult,
  type RrfGateFields,
} from '../src/search/hybrid';
import type { EmbeddingProvider } from '../src/embeddings/provider';
import type { Language, Node, NodeKind, SearchMode, SearchResult } from '../src/types';

let HAS_SQLITE = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:sqlite');
  HAS_SQLITE = true;
} catch {
  HAS_SQLITE = false;
}

/** A real temp project with several searchable declarations sharing a stem. */
function makeProject(dirs: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-hybrid-search-'));
  dirs.push(dir);
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);
  fs.writeFileSync(
    path.join(srcDir, 'config.ts'),
    'export function parseConfig(raw: string): object {\n  return JSON.parse(raw);\n}\n' +
      'export function parseInput(raw: string): string {\n  return raw.trim();\n}\n' +
      'export class ConfigParser {\n  parse(raw: string): object {\n    return parseConfig(raw);\n  }\n}\n',
  );
  fs.writeFileSync(
    path.join(srcDir, 'util.ts'),
    'export function parseNumber(raw: string): number {\n  return Number(raw);\n}\n' +
      'export const PARSE_VERSION = "1.0.0";\n',
  );
  return dir;
}

describe.skipIf(!HAS_SQLITE)('hybrid search — mode plumbing (T004)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];

  afterEach(() => {
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function indexedGraph(): Promise<CodeGraph> {
    const dir = makeProject(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    const result = await cg.indexAll();
    expect(result.success).toBe(true);
    return cg;
  }

  const QUERY = 'parse';

  it('a. mode omitted returns byte-identical results to a call without the option (FR-001, SC-004)', async () => {
    const cg = await indexedGraph();

    const base: SearchResult[] = cg.searchNodes(QUERY);           // the call "without the option"
    const omitted: SearchResult[] = cg.searchNodes(QUERY, {});    // options present, mode omitted

    expect(base.length).toBeGreaterThan(1);                       // the fixture actually matches several symbols
    expect(omitted).toEqual(base);
  });

  it("b. mode: 'keyword' returns byte-identical results to the default (FR-003, SC-004)", async () => {
    const cg = await indexedGraph();

    const base: SearchResult[] = cg.searchNodes(QUERY);
    const keyword: SearchResult[] = cg.searchNodes(QUERY, { mode: 'keyword' });

    expect(keyword).toEqual(base);
  });

  it('c. an unknown / out-of-enum mode coerces to keyword — no throw, identical results (FR-001/003, contract search-api)', async () => {
    const cg = await indexedGraph();

    const base: SearchResult[] = cg.searchNodes(QUERY);

    // A JS caller reaching past the type union with `as any` — the coercion
    // guard must default it to keyword and never throw or error-shape.
    expect(() => cg.searchNodes(QUERY, { mode: 'kwd' as never })).not.toThrow();

    const unknown: SearchResult[] = cg.searchNodes(QUERY, { mode: 'kwd' as never });
    expect(unknown).toEqual(base);

    // A second, differently-shaped bogus value — still keyword, still no throw.
    const bogus: SearchResult[] = cg.searchNodes(QUERY, { mode: '' as never });
    expect(bogus).toEqual(base);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T006 — the FR-014(a) hit-rate gate (RED until fusion lands in T007–T012).
//
// This is the non-tautology CI gate for hybrid retrieval (FR-014a / SC-001 /
// SC-006, spec Assumptions "Fixture non-tautology" rules). It builds a REAL
// SQLite fixture graph (structural extraction only — embeddings stay OFF), then
// hand-seeds unit-normalized vectors into `node_vectors` under the EXACT model
// id the T009 query-provider seam will report (`FIXTURE_MODEL`). Each case pins
// its query AND its target to the same one-hot basis vector, so at green-time
// the semantic arm scores the target at cosine 1.0 and every other stored vector
// near-orthogonal (rule 4).
//
// WHY IT FAILS TODAY (real assertion errors, not collection errors): fusion is
// still a keyword passthrough — `searchNodes(q, { mode: 'hybrid' | 'semantic' })`
// runs the byte-identical keyword pipeline (src/index.ts → queries.searchNodes
// ignores `mode`; src/search/hybrid.ts `runHybridSearch` is an unwired stub). So
//   (b) the semantic-only case's hybrid contribution EQUALS its keyword
//       contribution (both 0 — the target is not FTS-matchable), failing the
//       strictly-greater assertion; and
//   (c) semantic mode returns keyword results that MISS the target.
// (a) passes trivially today (hybrid == keyword, so ≥ holds) — it is the
// non-vacuous anchor, not the RED carrier. T012 flips (b)/(c) green WITHOUT
// rewriting a single assertion: it wires the arms + the query-provider seam that
// reads these same `CASES` to build each query vector.
//
// The query-provider seam itself is T009's deliverable; it does not exist yet.
// This file deliberately does NOT import it (an import of a missing symbol would
// be a COLLECTION error, not the assertion failure we require). The stored
// vectors + `CASES.basisIndex` are the fixture data that seam will consume.
// ───────────────────────────────────────────────────────────────────────────

/** Exact model id the T009 query-provider seam reports; a mismatch would silently zero the semantic arm (spec Assumptions). */
const FIXTURE_MODEL = 'fixture-model-384';
/** Vector dimension of the fixture corpus (matches the model id above). */
const FIXTURE_DIMS = 384;
/**
 * First basis index handed to a non-target ("filler") node. Sits well above the
 * per-case target/query bases (0..CASES.length-1) so every filler vector is
 * orthogonal to every query vector (cosine 0), and stays < FIXTURE_DIMS for the
 * small fixture corpus.
 */
const FILLER_BASIS_START = 50;

/** One paraphrase evaluation case (mirrors __tests__/evaluation recall scoring). */
interface HybridCase {
  id: string;
  /** Free-text paraphrase query. */
  query: string;
  /** The single relevant symbol name for this case. */
  targetName: string;
  /**
   * Basis index for this case's one-hot unit vector. The target's STORED vector
   * and the (future) query vector both use this index → cosine 1.0 (rule 4).
   */
  basisIndex: number;
  /** True for the strict semantic-only case: target unmatchable by FTS keyword tokens. */
  semanticOnly: boolean;
  /** A node that DOES token-match the query — the keyword arm's wrong (non-empty) hit. */
  decoyName?: string;
}

/**
 * ≥3 paraphrase cases incl. ≥1 semantic-only case (spec SC-001).
 *
 * P1–P3 are paraphrases whose target IS keyword-reachable (a query token is a
 * prefix of the target name), so the keyword arm scores a hit. S is the strict
 * semantic-only case: its target `backoffLoop` — its name, its sole
 * qualified_name segment, its docstring, and its signature — shares NO FTS
 * token-prefix with the query words "exponential wait between flaky endpoint
 * attempts", while the decoy `endpointHealthCheck` token-matches "endpoint" so
 * the keyword arm returns a wrong hit rather than an empty set (keeping the
 * LIKE/fuzzy fallbacks dormant).
 */
const CASES: HybridCase[] = [
  { id: 'P1', query: 'parse raw config text',       targetName: 'parseConfig',      basisIndex: 0, semanticOnly: false },
  { id: 'P2', query: 'validate the session token',  targetName: 'validateToken',    basisIndex: 1, semanticOnly: false },
  { id: 'P3', query: 'serialize a payload object',  targetName: 'serializePayload', basisIndex: 2, semanticOnly: false },
  {
    id: 'S',
    query: 'exponential wait between flaky endpoint attempts',
    targetName: 'backoffLoop',
    basisIndex: 3,
    semanticOnly: true,
    decoyName: 'endpointHealthCheck',
  },
];

/** A one-hot, unit-normalized (‖v‖ = 1) fixture vector with `hotIndex` set to 1. */
function unitVector(hotIndex: number): Float32Array {
  const v = new Float32Array(FIXTURE_DIMS); // zero-filled
  v[hotIndex] = 1;
  return v;
}

/**
 * The T006-handoff query-provider double the T009 seam swaps in: it reports the
 * EXACT stored model id the fixture vectors were seeded under (FIXTURE_MODEL) and
 * resolves each query's vector deterministically as `unitVector(CASES.find(c =>
 * c.query === queryText).basisIndex)` — pinning the query to the same one-hot basis
 * as its target's seeded vector (cosine 1.0). Since T006's CASES carry no filter
 * tokens, the filter-stripped embed input equals the raw query, so matching on the
 * exact query text is correct. Wired into T006's setup (inert until T012 calls the
 * arm) so that gate flips green with zero assertion edits; also used by T009's own
 * seam-swap assertions.
 */
const fixtureQueryProvider: EmbeddingProvider = {
  id: FIXTURE_MODEL,
  dims: FIXTURE_DIMS,
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const c = CASES.find((cc) => cc.query === t);
      if (!c) throw new Error(`fixture query-provider: no CASE for query text ${JSON.stringify(t)}`);
      return unitVector(c.basisIndex);
    });
  },
};

/**
 * The fixture corpus: real TypeScript so tree-sitter extraction populates
 * nodes + nodes_fts. Docstrings/signatures for `backoffLoop` are written to
 * avoid ANY FTS token-prefix overlap with the semantic-only query words.
 */
function makeHybridFixture(dirs: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-hybrid-fr014-'));
  dirs.push(dir);
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);

  // P1–P3 targets: each keyword-reachable via a query-token prefix of its name.
  fs.writeFileSync(
    path.join(srcDir, 'core.ts'),
    '/** Reads the given configuration string into a settings record. */\n' +
      'export function parseConfig(raw: string): object {\n  return JSON.parse(raw);\n}\n' +
      '/** Confirms the supplied credential matches an active grant. */\n' +
      'export function validateToken(token: string): boolean {\n  return token.length > 10;\n}\n' +
      '/** Turns a record into its wire representation for storage. */\n' +
      'export function serializePayload(record: object): string {\n  return JSON.stringify(record);\n}\n',
  );

  // Semantic-only target + its decoy. `backoffLoop` shares no FTS token-prefix
  // with "exponential wait between flaky endpoint attempts"; the signature
  // `(job: () => void): void` and the docstring likewise avoid every query word.
  // `endpointHealthCheck` token-matches "endpoint" → the keyword arm's wrong hit.
  fs.writeFileSync(
    path.join(srcDir, 'resilience.ts'),
    '/** Repeatedly runs the closure, doubling the pause each time it throws. */\n' +
      'export function backoffLoop(job: () => void): void {\n  job();\n}\n' +
      '/** Verifies a service URL responds before traffic is routed to it. */\n' +
      'export function endpointHealthCheck(url: string): boolean {\n  return url.length > 0;\n}\n',
  );

  return dir;
}

/**
 * Seed one hand-built unit vector per embeddable node under FIXTURE_MODEL:
 * a case target gets its case's basis (cosine 1.0 to the query vector); every
 * other node (incl. the decoy) gets a distinct filler basis, orthogonal to all
 * query vectors. Written through a FRESH connection via the little-endian f32
 * codec, exactly as the embed pass persists vectors (FR-011).
 */
function seedFixtureVectors(dir: string): void {
  const conn = DatabaseConnection.open(getDatabasePath(dir));
  try {
    const q = new QueryBuilder(conn.getDb());
    const targetBasis = new Map(CASES.map((c) => [c.targetName, c.basisIndex]));
    let filler = FILLER_BASIS_START;
    // "missing under FIXTURE_MODEL" === every embeddable node (nothing embedded yet).
    for (const node of q.selectEmbeddableNodesMissingVector(FIXTURE_MODEL)) {
      const basis = targetBasis.has(node.name) ? targetBasis.get(node.name)! : filler++;
      q.upsertNodeVector(node.id, FIXTURE_MODEL, FIXTURE_DIMS, encodeVector(unitVector(basis)), `fixture-hash-${node.id}`);
    }
    // The real embed pass persists these scalars alongside the vectors; the direct
    // seed bypasses it, so mirror them here — the matrix source + staleness probe read
    // `embedding_dims`/`embedding_model` from `project_metadata` (research D6a).
    q.setMetadata('embedding_model', FIXTURE_MODEL);
    q.setMetadata('embedding_dims', String(FIXTURE_DIMS));
  } finally {
    conn.close();
  }
}

describe.skipIf(!HAS_SQLITE)('hybrid search — FR-014(a) hit-rate gate (T006)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];

  // T009 handoff: install the query-provider seam so that once the fusion arm is
  // wired (T012) each query embeds to its case's one-hot basis. Inert today — the
  // keyword passthrough never calls the arm — so this touches no T006 assertion and
  // the gate stays RED until T012.
  beforeEach(() => __setQueryEmbeddingProviderForTests(fixtureQueryProvider));

  afterEach(() => {
    __setQueryEmbeddingProviderForTests(undefined);
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A real, structurally-indexed fixture graph with hand-seeded fixture vectors. */
  async function indexedFixture(): Promise<CodeGraph> {
    const dir = makeHybridFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    const result = await cg.indexAll();
    expect(result.success).toBe(true);
    seedFixtureVectors(dir);
    // Warm the query-vector cache — US1 acceptance scenario 1's Given is "a warmed
    // provider". The async surfaces (MCP/CLI, T016/T017) `await` this before the sync
    // `searchNodes`; the library test mirrors that precondition so the synchronous
    // fusion path has each case's query vector on hand (additive setup — no assertions
    // touched). The seam (beforeEach) maps each query to its one-hot basis.
    for (const c of CASES) await cg.acquireQueryVectorForSearch(c.query);
    return cg;
  }

  /** Result symbol names for `query` under `mode`. */
  function names(cg: CodeGraph, query: string, mode: SearchMode): string[] {
    return cg.searchNodes(query, { mode }).map((r) => r.node.name);
  }

  /** Set-level aggregate: # of cases whose target appears in results under `mode`. */
  function aggregateHits(cg: CodeGraph, mode: SearchMode): number {
    let hits = 0;
    for (const c of CASES) {
      if (names(cg, c.query, mode).includes(c.targetName)) hits++;
    }
    return hits;
  }

  it('a. aggregate hybrid hit-rate ≥ keyword, and the semantic-only case is non-vacuous (FR-014a / SC-001)', async () => {
    const cg = await indexedFixture();
    const semanticCase = CASES.find((c) => c.semanticOnly)!;

    // Fixture sanity — the semantic-only case's keyword arm returns the DECOY (a
    // wrong hit) but NOT the target, proving the case is non-vacuous and the
    // LIKE/fuzzy fallbacks stay dormant (they fire only on zero FTS results).
    const keywordS = names(cg, semanticCase.query, 'keyword');
    expect(keywordS).toContain(semanticCase.decoyName!);
    expect(keywordS).not.toContain(semanticCase.targetName);

    // (a) Set-level aggregate — hybrid must never surface fewer relevant symbols
    // than keyword. Passes trivially today (hybrid == keyword); the non-tautology
    // guarantee is carried by the semantic-only contribution assertion below.
    const keywordHits = aggregateHits(cg, 'keyword');
    const hybridHits = aggregateHits(cg, 'hybrid');
    expect(hybridHits).toBeGreaterThanOrEqual(keywordHits);

    // (b) NON-TAUTOLOGY ANCHOR — the semantic-only case must contribute STRICTLY
    // more under hybrid than keyword. RED today: fusion is a keyword passthrough,
    // so both contributions are 0 (target not FTS-matchable) → 0 > 0 fails.
    const keywordContribution = keywordS.includes(semanticCase.targetName) ? 1 : 0;
    const hybridContribution = names(cg, semanticCase.query, 'hybrid').includes(semanticCase.targetName) ? 1 : 0;
    expect(hybridContribution).toBeGreaterThan(keywordContribution);

    // (c) The semantic arm ALONE surfaces the semantic-only target. RED today:
    // semantic mode is a keyword passthrough, so it returns the decoy, not the
    // target.
    const semanticS = names(cg, semanticCase.query, 'semantic');
    expect(semanticS).toContain(semanticCase.targetName);
  });

  it('SC-006 — an identical hybrid query against an unchanged index is order-stable (FR-013 tie-break)', async () => {
    const cg = await indexedFixture();
    const query = CASES[0].query;

    const run1: SearchResult[] = cg.searchNodes(query, { mode: 'hybrid' });
    const run2: SearchResult[] = cg.searchNodes(query, { mode: 'hybrid' });

    expect(run1.length).toBeGreaterThan(0);   // the query actually matches something
    expect(run2).toEqual(run1);               // byte-identical ordered hit list
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T007 — the vector matrix cache (data-model E4; research D6/D7).
//
// Unit-level behavior of the lazily-built, single-owner matrix cache: build-once
// memoization, the pre-build memory guard, and thundering-herd single-build. The
// pure builder is exercised against an in-memory `VectorMatrixSource` (no DB) for
// deterministic guard/decode assertions; one real-SQLite case proves the
// `QueryBuilder`-backed source decodes seeded `node_vectors` BLOBs into an aligned
// contiguous matrix (repo convention: real SQLite, no mocking).
// ───────────────────────────────────────────────────────────────────────────

/** An in-memory `VectorMatrixSource` over `vectors`, counting `rows()` invocations. */
function fakeSource(
  vectors: Float32Array[],
  opts: { model?: string; dims?: number; count?: number } = {},
): { source: VectorMatrixSource; rowsCalls: () => number } {
  const dims = opts.dims ?? (vectors[0]?.length ?? 0);
  let calls = 0;
  const source: VectorMatrixSource = {
    model: opts.model ?? 'fake-model',
    dims,
    count: opts.count ?? vectors.length,
    rows(): VectorRow[] {
      calls++;
      return vectors.map((v, i) => ({
        nodeId: `n${i}`,
        kind: 'function' as NodeKind,
        language: 'typescript' as Language,
        vector: encodeVector(v),
      }));
    },
  };
  return { source, rowsCalls: () => calls };
}

/** A one-hot unit vector of width `dims` with `hot` set to 1 (as in the T006 fixture). */
function oneHot(dims: number, hot: number): Float32Array {
  const v = new Float32Array(dims);
  v[hot] = 1;
  return v;
}

describe('hybrid search — vector matrix cache (T007)', () => {
  afterEach(() => {
    __resetVectorMatrixCacheForTests();
  });

  it('builds ONE contiguous Float32Array with aligned per-row nodeId/kind/language (FR-009; E4)', () => {
    const dims = 8;
    const vectors = [oneHot(dims, 0), oneHot(dims, 3), oneHot(dims, 7)];
    const { source } = fakeSource(vectors, { model: 'm', dims });

    const result = buildVectorMatrix(source);
    expect(result.guarded).toBe(false);
    if (result.guarded) return; // narrow

    const { matrix } = result;
    expect(matrix.matrix).toBeInstanceOf(Float32Array);
    expect(matrix.matrix.length).toBe(vectors.length * dims); // ONE contiguous buffer
    expect(matrix.count).toBe(vectors.length);
    expect(matrix.dims).toBe(dims);
    expect(matrix.model).toBe('m');
    expect(matrix.nodeIds).toEqual(['n0', 'n1', 'n2']);
    expect(matrix.kinds).toEqual(['function', 'function', 'function']);
    expect(matrix.languages).toEqual(['typescript', 'typescript', 'typescript']);

    // Each decoded row sits row-major at [i*dims, (i+1)*dims) with the hot bit set.
    for (let i = 0; i < vectors.length; i++) {
      const row = matrix.matrix.subarray(i * dims, (i + 1) * dims);
      expect(Array.from(row)).toEqual(Array.from(vectors[i]));
    }
  });

  it('memory guard SKIPS an oversized build BEFORE any allocation — rows() never called (FR-009c)', () => {
    // count × dims × 4 must exceed MAX_MATRIX_BYTES with a tiny scalar footprint so
    // no giant array is ever allocated: 1 row × (MAX/4 + 1) dims × 4 bytes > MAX.
    const dims = MAX_MATRIX_BYTES / 4 + 1;
    const { source, rowsCalls } = fakeSource([], { model: 'huge', dims, count: 1 });

    const result = buildVectorMatrix(source);

    expect(result.guarded).toBe(true);
    if (!result.guarded) return; // narrow
    expect(result.predictedBytes).toBeGreaterThan(MAX_MATRIX_BYTES);
    // The guard is PRE-allocation: the row scan was never even started.
    expect(rowsCalls()).toBe(0);
  });

  it('a build at exactly the ceiling is NOT guarded (boundary is strictly-greater)', () => {
    // count × dims × 4 === MAX_MATRIX_BYTES exactly → allowed (guard is `>`).
    const dims = MAX_MATRIX_BYTES / 4; // 1 row of this width == the ceiling exactly
    const { source, rowsCalls } = fakeSource([], { model: 'edge', dims, count: 1 });

    // rows() returns [] so nothing is actually decoded/allocated at scale; we only
    // assert the guard verdict at the boundary, not a real 1 GiB allocation.
    const result = buildVectorMatrix(source);
    expect(result.guarded).toBe(false);
    expect(rowsCalls()).toBe(1); // guard passed → the scan ran
  });

  it('build-once memoization: two sequential queries for the same (root, model) share ONE build', async () => {
    const dims = 4;
    const { source } = fakeSource([oneHot(dims, 0), oneHot(dims, 1)], { model: 'm1', dims });
    let builds = 0;
    const build = (): VectorMatrixResult => {
      builds++;
      return buildVectorMatrix(source);
    };

    const r1 = await getVectorMatrix('/proj', 'm1', build);
    const r2 = await getVectorMatrix('/proj', 'm1', build);

    expect(builds).toBe(1);      // second query reused the resident matrix
    expect(r2).toBe(r1);         // same resolved result object
  });

  it('thundering-herd: concurrent FIRST queries share ONE in-flight build (single-owner)', async () => {
    const dims = 4;
    const { source } = fakeSource([oneHot(dims, 0)], { model: 'm2', dims });
    let builds = 0;
    // An async build that resolves on a later tick, so both callers race BEFORE
    // the first build settles — the memoized in-flight promise must dedupe them.
    const build = (): Promise<VectorMatrixResult> => {
      builds++;
      return new Promise((resolve) => setTimeout(() => resolve(buildVectorMatrix(source)), 15));
    };

    const [a, b] = await Promise.all([
      getVectorMatrix('/proj', 'm2', build),
      getVectorMatrix('/proj', 'm2', build),
    ]);

    expect(builds).toBe(1);  // exactly one build served both concurrent first queries
    expect(b).toBe(a);
  });

  it('exactly ONE resident matrix: a new (root, model) key evicts the prior one', async () => {
    const dims = 4;
    const src = fakeSource([oneHot(dims, 0)], { dims });
    let builds = 0;
    const build = (): VectorMatrixResult => { builds++; return buildVectorMatrix(src.source); };

    await getVectorMatrix('/proj', 'modelA', build); // resident = A
    await getVectorMatrix('/proj', 'modelB', build); // resident = B (evicts A)
    await getVectorMatrix('/proj', 'modelA', build); // A is gone → rebuild

    expect(builds).toBe(3); // no key was ever served from a stale second resident
  });

  it.skipIf(!HAS_SQLITE)(
    'vectorMatrixSourceFromQueries decodes seeded node_vectors BLOBs into an aligned matrix (real SQLite)',
    async () => {
      const dirs: string[] = [];
      const graphs: CodeGraph[] = [];
      try {
        const dir = makeHybridFixture(dirs);
        const cg = await CodeGraph.init(dir);
        graphs.push(cg);
        expect((await cg.indexAll()).success).toBe(true);
        seedFixtureVectors(dir);

        const conn = DatabaseConnection.open(getDatabasePath(dir));
        try {
          const q = new QueryBuilder(conn.getDb());
          // The embed pass persists embedding_dims alongside the vectors; the direct
          // seed above bypasses it, so mirror that invariant for the source scalars.
          q.setMetadata('embedding_dims', String(FIXTURE_DIMS));

          const source = vectorMatrixSourceFromQueries(q, FIXTURE_MODEL);
          expect(source.model).toBe(FIXTURE_MODEL);
          expect(source.dims).toBe(FIXTURE_DIMS);
          expect(source.count).toBe(q.getEmbeddingCoverage(FIXTURE_MODEL).embedded);
          expect(source.count).toBeGreaterThan(0);

          const result = buildVectorMatrix(source);
          expect(result.guarded).toBe(false);
          if (result.guarded) return;

          const { matrix } = result;
          expect(matrix.count).toBe(source.count);
          expect(matrix.matrix.length).toBe(source.count * FIXTURE_DIMS);

          // The decoded matrix rows reconstruct the seeded one-hot vectors exactly,
          // row-major and aligned to the same nodeId/kind ordering as the source rows.
          const rows = source.rows();
          expect(rows.length).toBe(matrix.count);
          for (let i = 0; i < rows.length; i++) {
            expect(matrix.nodeIds[i]).toBe(rows[i].nodeId);
            const decoded = matrix.matrix.subarray(i * FIXTURE_DIMS, (i + 1) * FIXTURE_DIMS);
            let hotCount = 0;
            for (const x of decoded) if (x === 1) hotCount++;
            expect(hotCount).toBe(1); // every seeded fixture vector is one-hot unit
          }
        } finally {
          conn.close();
        }
      } finally {
        while (graphs.length) { try { graphs.pop()!.close(); } catch { /* already closed */ } }
        while (dirs.length) {
          const d = dirs.pop()!;
          if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
        }
      }
    },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// T008 — the per-query staleness probe (FR-008b; research D6a).
//
// A cheap BOUNDED read — matching-model vector count (`getEmbeddingCoverage`)
// plus the `embedding_model`/`embedding_dims` scalars from `project_metadata`
// (there is NO `data_version` column) — that fully determines whether the
// resident matrix still reflects the index. It runs ONLY on the semantic/hybrid
// path (the keyword path never calls it — FR-003a). Any change to the probe
// token (add/remove a vector, re-embed, model switch, dims change) invalidates
// the resident matrix and rebuilds it on the NEXT semantic query, reusing the
// T007 build path + its thundering-herd memoization; an unchanged token reuses
// the resident matrix by object identity. No full scan, no schema write.
// ───────────────────────────────────────────────────────────────────────────
describe('hybrid search — staleness probe (T008)', () => {
  afterEach(() => {
    __resetVectorMatrixCacheForTests();
  });

  /** A build closure that counts invocations and returns a fresh matrix each time. */
  function countingBuild(): { build: () => VectorMatrixResult; builds: () => number } {
    let n = 0;
    const build = (): VectorMatrixResult => {
      n++;
      return buildVectorMatrix(fakeSource([oneHot(4, 0)], { model: 'm', dims: 4 }).source);
    };
    return { build, builds: () => n };
  }

  /** A probe token; override any of the three bounded scalars per case. */
  const probe = (over: Partial<StalenessProbe> = {}): StalenessProbe => ({
    count: 10,
    model: 'active-model',
    dims: 384,
    ...over,
  });

  it('no index change → the resident matrix is reused (build-once, same object identity)', async () => {
    const { build, builds } = countingBuild();
    const r1 = await getVectorMatrixForProbe('/proj', probe(), build);
    const r2 = await getVectorMatrixForProbe('/proj', probe(), build);
    expect(builds()).toBe(1); // second query reused the resident matrix — no probe-driven rebuild
    expect(r2).toBe(r1);      // same resolved result object
  });

  it('vector count change (add/remove/re-embed) → invalidate + rebuild on the next query', async () => {
    const { build, builds } = countingBuild();
    await getVectorMatrixForProbe('/proj', probe({ count: 10 }), build);
    await getVectorMatrixForProbe('/proj', probe({ count: 11 }), build); // one vector added
    expect(builds()).toBe(2);
  });

  it('model switch → invalidate + rebuild (a new probe token, a new cache key)', async () => {
    const { build, builds } = countingBuild();
    await getVectorMatrixForProbe('/proj', probe({ model: 'modelA' }), build);
    await getVectorMatrixForProbe('/proj', probe({ model: 'modelB' }), build);
    expect(builds()).toBe(2);
  });

  it('embedding dims change → invalidate + rebuild', async () => {
    const { build, builds } = countingBuild();
    await getVectorMatrixForProbe('/proj', probe({ dims: 384 }), build);
    await getVectorMatrixForProbe('/proj', probe({ dims: 512 }), build);
    expect(builds()).toBe(2);
  });

  it.skipIf(!HAS_SQLITE)(
    'reads the bounded scalars from a real graph; a vector add/remove drives a rebuild (FR-008b, real SQLite)',
    async () => {
      const dirs: string[] = [];
      const graphs: CodeGraph[] = [];
      try {
        const dir = makeHybridFixture(dirs);
        const cg = await CodeGraph.init(dir);
        graphs.push(cg);
        expect((await cg.indexAll()).success).toBe(true);
        seedFixtureVectors(dir);

        const conn = DatabaseConnection.open(getDatabasePath(dir));
        try {
          const q = new QueryBuilder(conn.getDb());
          // The direct seed bypasses the embed pass; mirror the scalars it persists.
          q.setMetadata('embedding_model', FIXTURE_MODEL);
          q.setMetadata('embedding_dims', String(FIXTURE_DIMS));

          const coverage = q.getEmbeddingCoverage(FIXTURE_MODEL);
          const probe1 = probeVectorStaleness(q, FIXTURE_MODEL);
          // The probe is exactly the three bounded scalars — no full scan.
          expect(probe1.count).toBe(coverage.embedded);
          expect(probe1.count).toBeGreaterThan(0);
          expect(probe1.model).toBe(FIXTURE_MODEL);
          expect(probe1.dims).toBe(FIXTURE_DIMS);

          let builds = 0;
          const build = (): VectorMatrixResult => {
            builds++;
            return buildVectorMatrix(vectorMatrixSourceFromQueries(q, FIXTURE_MODEL));
          };

          await getVectorMatrixForProbe(dir, probe1, build); // cold build
          expect(builds).toBe(1);

          // Re-probe with the index UNCHANGED → same token → resident reused.
          await getVectorMatrixForProbe(dir, probeVectorStaleness(q, FIXTURE_MODEL), build);
          expect(builds).toBe(1);

          // Remove one stored vector → the bounded count drops (add/remove detected).
          const removed = conn
            .getDb()
            .prepare(
              'DELETE FROM node_vectors WHERE node_id = (SELECT node_id FROM node_vectors WHERE model = ? LIMIT 1)',
            )
            .run(FIXTURE_MODEL);
          expect(removed.changes).toBe(1);

          const probe2 = probeVectorStaleness(q, FIXTURE_MODEL);
          expect(probe2.count).toBe(probe1.count - 1); // the cheap read saw the change

          await getVectorMatrixForProbe(dir, probe2, build); // changed token → rebuild
          expect(builds).toBe(2);
        } finally {
          conn.close();
        }
      } finally {
        while (graphs.length) { try { graphs.pop()!.close(); } catch { /* already closed */ } }
        while (dirs.length) {
          const d = dirs.pop()!;
          if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
        }
      }
    },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// T009 — query-vector acquisition + the test-only query-provider seam
// (FR-011; data-model E5; research D11).
//
// Two surfaces:
//   • `acquireQueryVector(rawQuery, provider)` — the PURE acquisition: parse the
//     query with the SAME parser FTS uses, embed ONLY the filter-stripped free
//     text through the provider, report the provider's stored model id. An empty
//     filter-stripped text is the HEALTHY-EMPTY case: no embed call, no vector,
//     no contribution (not degraded, not an error).
//   • `CodeGraph.acquireQueryVectorForSearch(query)` — resolves the query provider
//     first (the test-only seam `__setQueryEmbeddingProviderForTests` when set,
//     else the production env-config path) then delegates to the pure acquisition.
//     The seam is NEVER reachable in production config resolution.
// ───────────────────────────────────────────────────────────────────────────

/** A query-provider double recording every embed() input; per-query one-hot vectors. */
function spyProvider(): { provider: EmbeddingProvider; embedInputs: () => string[][] } {
  const calls: string[][] = [];
  const provider: EmbeddingProvider = {
    id: FIXTURE_MODEL,
    dims: FIXTURE_DIMS,
    async embed(texts: string[]): Promise<Float32Array[]> {
      calls.push([...texts]);
      return texts.map((t) => {
        const c = CASES.find((cc) => cc.query === t);
        return unitVector(c ? c.basisIndex : FILLER_BASIS_START);
      });
    },
  };
  return { provider, embedInputs: () => calls };
}

describe('hybrid search — query-vector acquisition (pure, T009)', () => {
  it('embeds the filter-stripped query text and reports the provider model id (FR-011)', async () => {
    const { provider, embedInputs } = spyProvider();

    for (const c of CASES) {
      const acq: QueryVectorAcquisition = await acquireQueryVector(c.query, provider);
      expect(acq.model).toBe(FIXTURE_MODEL);                                   // stored id threaded to the scan/cache key
      expect(acq.vector).not.toBeNull();
      expect(Array.from(acq.vector!)).toEqual(Array.from(unitVector(c.basisIndex)));
    }
    // Each case embedded its exact (filter-free) query text, once, in order.
    expect(embedInputs().map((inp) => inp[0])).toEqual(CASES.map((c) => c.query));
  });

  it('embeds ONLY the filter-stripped free text — kind:/lang: filter tokens are stripped, mirroring FTS (FR-011)', async () => {
    const { provider, embedInputs } = spyProvider();

    // The field-qualified prefix must NOT reach the embed input — only the free text.
    const acq = await acquireQueryVector('kind:function lang:typescript parse raw config text', provider);

    expect(embedInputs()).toHaveLength(1);
    expect(embedInputs()[0]).toEqual(['parse raw config text']);
    expect(acq.model).toBe(FIXTURE_MODEL);
    expect(acq.vector).not.toBeNull();
  });

  it('an empty filter-stripped query makes NO embed call and contributes nothing (healthy-empty, FR-011)', async () => {
    const { provider, embedInputs } = spyProvider();

    // Filters only → the free-text portion strips to empty. Nothing to embed.
    const acq = await acquireQueryVector('kind:function lang:go', provider);

    expect(acq).toEqual({ vector: null, model: null });   // no vector, no model — the arm contributes nothing
    expect(embedInputs()).toEqual([]);                     // the provider was never invoked
  });
});

describe.skipIf(!HAS_SQLITE)('hybrid search — query-provider seam (T009)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];

  afterEach(() => {
    __setQueryEmbeddingProviderForTests(undefined); // never leak the seam into another suite
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  async function indexedGraph(): Promise<CodeGraph> {
    const dir = makeHybridFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    return cg;
  }

  it('the seam swaps the query-time provider — fixture vectors resolve deterministically (research D11)', async () => {
    const cg = await indexedGraph();
    const { provider } = spyProvider();
    __setQueryEmbeddingProviderForTests(provider);

    for (const c of CASES) {
      const acq = await cg.acquireQueryVectorForSearch(c.query);
      expect(acq.model).toBe(FIXTURE_MODEL);
      expect(acq.vector).not.toBeNull();
      expect(Array.from(acq.vector!)).toEqual(Array.from(unitVector(c.basisIndex)));
    }
  });

  it('production resolution IGNORES the seam when unset — no configured provider yields no query vector (FR-011)', async () => {
    const cg = await indexedGraph();

    // Seam left unset (afterEach clears it). Force the embedding env OFF so the
    // production path (loadEmbeddingConfig) is dormant regardless of the ambient
    // shell (a dogfood checkout may export CODEGRAPH_EMBEDDING_*): resolution must
    // yield NO provider — never a test double — and acquisition returns nothing.
    const saved = {
      url: process.env.CODEGRAPH_EMBEDDING_URL,
      model: process.env.CODEGRAPH_EMBEDDING_MODEL,
      provider: process.env.CODEGRAPH_EMBEDDING_PROVIDER,
    };
    delete process.env.CODEGRAPH_EMBEDDING_URL;
    delete process.env.CODEGRAPH_EMBEDDING_MODEL;
    delete process.env.CODEGRAPH_EMBEDDING_PROVIDER;
    try {
      const acq = await cg.acquireQueryVectorForSearch(CASES[0].query);
      expect(acq).toEqual({ vector: null, model: null });
    } finally {
      if (saved.url !== undefined) process.env.CODEGRAPH_EMBEDDING_URL = saved.url;
      if (saved.model !== undefined) process.env.CODEGRAPH_EMBEDDING_MODEL = saved.model;
      if (saved.provider !== undefined) process.env.CODEGRAPH_EMBEDDING_PROVIDER = saved.provider;
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T010 — the cosine top-k scan (FR-010/013/014c; research D8/D10).
//
// The semantic arm's ranking leg: an allocation-light single pass over the
// resident matrix that keeps the k highest-cosine rows, ranked DESCENDING by
// cosine with an ASCENDING node-id tie-break, with kind:/lang:/options.kinds
// PRE-filtering the scan BEFORE top-k so a filtered row never consumes a slot
// (no starvation). Stored vectors are UNNORMALIZED — cosine is normalized here
// at scan time, and the query vector may be unnormalized too. Zero-magnitude
// (or otherwise non-positive) rows/queries are excluded from candidates. Pure,
// DB-free unit behavior over hand-built matrices.
// ───────────────────────────────────────────────────────────────────────────

/** A hand-built VectorMatrix. Vectors pass through Float32Array exactly as production rows do. */
function makeMatrix(
  rows: Array<{ nodeId: string; kind: NodeKind; language: Language; vec: number[] }>,
): VectorMatrix {
  const dims = rows[0]?.vec.length ?? 0;
  const data = new Float32Array(rows.length * dims);
  const nodeIds: string[] = [];
  const kinds: NodeKind[] = [];
  const languages: Language[] = [];
  rows.forEach((r, i) => {
    data.set(Float32Array.from(r.vec), i * dims);
    nodeIds.push(r.nodeId);
    kinds.push(r.kind);
    languages.push(r.language);
  });
  return { matrix: data, nodeIds, kinds, languages, model: 'test-model', dims, count: rows.length };
}

const fn = (nodeId: string, vec: number[], language: Language = 'typescript') =>
  ({ nodeId, kind: 'function' as NodeKind, language, vec });

describe('hybrid search — cosine top-k scan (T010)', () => {
  it('ranks candidates by DESCENDING cosine and excludes non-positive rows (FR-010)', () => {
    const m = makeMatrix([
      fn('a', [1, 0]), //  cosine 1.0
      fn('b', [1, 1]), //  cosine 1/√2 ≈ 0.707
      fn('c', [0, 1]), //  cosine 0    → excluded
      fn('d', [-1, 0]), // cosine -1   → excluded
    ]);

    const out = semanticTopK(m, Float32Array.from([1, 0]), 10);

    expect(out.map((r) => r.nodeId)).toEqual(['a', 'b']); // c (0) and d (<0) never enter
    expect(out[0].similarity).toBeCloseTo(1, 6);
    expect(out[1].similarity).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('breaks exact-cosine ties by ASCENDING node id (FR-013, research D10)', () => {
    // Three identical vectors → identical cosine; insertion order deliberately
    // NOT sorted, so only the tie-break can produce ascending node ids.
    const m = makeMatrix([fn('zeta', [1, 0]), fn('alpha', [1, 0]), fn('mid', [1, 0])]);

    const out = semanticTopK(m, Float32Array.from([1, 0]), 10);

    expect(out.map((r) => r.nodeId)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('kind: pre-filter excludes rows BEFORE top-k — no starvation (FR-010; research D8)', () => {
    // The two highest-cosine rows are `class` (filtered out). With k=2 they must
    // NOT consume the two slots — the next two `function` rows are returned.
    const m = makeMatrix([
      { nodeId: 'c1', kind: 'class', language: 'typescript', vec: [10, 0] }, //  ≈1.000 filtered
      { nodeId: 'c2', kind: 'class', language: 'typescript', vec: [10, 3] }, //  ≈0.958 filtered
      fn('f1', [10, 5]), //  ≈0.894
      fn('f2', [10, 8]), //  ≈0.781
      fn('f3', [10, 12]), // ≈0.640
    ]);

    const out = semanticTopK(m, Float32Array.from([1, 0]), 2, { kinds: ['function'] });

    expect(out.map((r) => r.nodeId)).toEqual(['f1', 'f2']); // slots went to unfiltered rows
  });

  it('lang: pre-filter excludes rows BEFORE top-k — no starvation (FR-010; research D8)', () => {
    const m = makeMatrix([
      fn('g1', [10, 0], 'go'), //         ≈1.000 filtered
      fn('t1', [10, 5], 'typescript'), // ≈0.894
      fn('t2', [10, 8], 'typescript'), // ≈0.781
    ]);

    const out = semanticTopK(m, Float32Array.from([1, 0]), 1, { languages: ['typescript'] });

    expect(out.map((r) => r.nodeId)).toEqual(['t1']); // the go row never took the only slot
  });

  it('a fully-filtered scan yields an EMPTY candidate list (keyword-only fusion input)', () => {
    const m = makeMatrix([fn('f1', [1, 0]), fn('f2', [1, 1])]);

    // No row is a struct → every row is filtered out → nothing to rank.
    expect(semanticTopK(m, Float32Array.from([1, 0]), 5, { kinds: ['struct'] })).toEqual([]);
  });

  it('excludes zero-magnitude rows and returns [] for a zero-magnitude query (documented)', () => {
    const m = makeMatrix([fn('z', [0, 0]), fn('a', [1, 0])]);

    // Zero-magnitude query → no direction → no candidates.
    expect(semanticTopK(m, Float32Array.from([0, 0]), 5)).toEqual([]);

    // Zero-magnitude row `z` is excluded; only the positive row survives.
    expect(semanticTopK(m, Float32Array.from([1, 0]), 5).map((r) => r.nodeId)).toEqual(['a']);
  });

  it('normalizes cosine over UNNORMALIZED rows and an unnormalized query (magnitude-invariant)', () => {
    // Row `a` is unnormalized ([3,0]); its cosine to [1,0] is still exactly 1.
    // `b` ([0,7]) is orthogonal → excluded. Scaling the query must not change it.
    const m = makeMatrix([fn('a', [3, 0]), fn('b', [0, 7])]);

    const small = semanticTopK(m, Float32Array.from([1, 0]), 5);
    const big = semanticTopK(m, Float32Array.from([100, 0]), 5);

    expect(small.map((r) => r.nodeId)).toEqual(['a']);
    expect(big.map((r) => r.nodeId)).toEqual(small.map((r) => r.nodeId));
    expect(small[0].similarity).toBeCloseTo(1, 6);
    expect(big[0].similarity).toBeCloseTo(small[0].similarity, 6);
  });

  it('caps the result at k, keeping the k best (candidateDepth from T003 is the call-site k)', () => {
    const m = makeMatrix([
      { nodeId: 'c1', kind: 'class', language: 'typescript', vec: [10, 0] }, //  ≈1.000
      { nodeId: 'c2', kind: 'class', language: 'typescript', vec: [10, 3] }, //  ≈0.958
      fn('f1', [10, 5]), //  ≈0.894
      fn('f2', [10, 8]), //  ≈0.781
      fn('f3', [10, 12]), // ≈0.640
    ]);

    const capped: SemanticCandidate[] = semanticTopK(m, Float32Array.from([1, 0]), 3);
    expect(capped.map((r) => r.nodeId)).toEqual(['c1', 'c2', 'f1']); // top-3 only

    // With the real call-site depth (max(5×limit,100)) all positive rows fit.
    const all = semanticTopK(m, Float32Array.from([1, 0]), candidateDepth(1));
    expect(all.map((r) => r.nodeId)).toEqual(['c1', 'c2', 'f1', 'f2', 'f3']);
  });

  it('is deterministic — two identical scans produce byte-identical arrays (SC-006)', () => {
    const m = makeMatrix([fn('f1', [10, 5]), fn('f2', [10, 8]), fn('f3', [10, 0]), fn('f4', [10, 3])]);
    const q = Float32Array.from([1, 0]);

    const run1 = semanticTopK(m, q, 3);
    const run2 = semanticTopK(m, q, 3);

    expect(run2).toEqual(run1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T011 — the rank-only RRF merge (FR-004/004a/010/012/013; research D3/D10).
//
// Fuse the keyword arm (post-rescore order) and the semantic arm (cosine order)
// by RECIPROCAL RANK ONLY: fused(d) = Σ over each arm surfacing d of
// 1/(RRF_K + rank_arm(d)), rank 1-based. Raw BM25 / cosine magnitudes NEVER
// enter the fused score, and the keyword arm's kind/path/name rescoring bonuses
// are NOT re-applied post-fusion (FR-004a). Order by fused DESC, tie-break
// ASCENDING node id. `path:`/`name:` are POST-fusion hard gates (drop
// non-matching rows AFTER fusion, BEFORE the offset/limit slice). `options.offset`
// slices the fixed candidate pool; a page beyond the pool returns fewer than
// `limit` rows — never an error. Pure and deterministic.
// ───────────────────────────────────────────────────────────────────────────

/** A minimal but complete `Node` for merge/gate tests (gates read filePath+name). */
function mkNode(id: string, over: Partial<Node> = {}): Node {
  return {
    id,
    kind: 'function',
    name: id,
    qualifiedName: id,
    filePath: `src/${id}.ts`,
    language: 'typescript',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    updatedAt: 0,
    ...over,
  };
}

/** A keyword-arm `SearchResult` carrying its node (the RRF join key + gate source). */
function kw(id: string, over: Partial<Node> = {}): SearchResult {
  return { node: mkNode(id, over), score: 1 };
}

/** A semantic-arm candidate (order = rank; similarity is diagnostic only). */
function sem(nodeId: string, similarity = 0.9): SemanticCandidate {
  return { nodeId, similarity };
}

describe('hybrid search — rank-only RRF merge (T011)', () => {
  it('fuses by reciprocal rank only — a rank-1-in-both-arms node scores 2/(K+1) (FR-004)', () => {
    // keyword ranks: a=1, b=2 · semantic ranks: a=1, c=2
    const out: FusedResult[] = rrfMerge(
      [kw('a'), kw('b')],
      [sem('a'), sem('c')],
      { limit: 10, RRF_K: 60 },
    );

    // a surfaces at rank 1 in BOTH arms → 1/61 + 1/61 = 2/61 (the hand-computed value).
    // b (kw rank 2) and c (sem rank 2) each = 1/62 and tie → ascending node id b<c.
    expect(out.map((r) => r.nodeId)).toEqual(['a', 'b', 'c']);
    expect(out[0].fusedScore).toBeCloseTo(2 / 61, 10);
    expect(out[1].fusedScore).toBeCloseTo(1 / 62, 10);
    expect(out[2].fusedScore).toBeCloseTo(1 / 62, 10);
  });

  it('assigns matchType per contributing arm: keyword | semantic | both (FR-012)', () => {
    const out = rrfMerge([kw('a'), kw('b')], [sem('a'), sem('c')], { limit: 10, RRF_K: 60 });
    const byId = new Map(out.map((r) => [r.nodeId, r.matchType]));

    expect(byId.get('a')).toBe('both');     // both arms surfaced it
    expect(byId.get('b')).toBe('keyword');  // keyword only
    expect(byId.get('c')).toBe('semantic'); // semantic only
  });

  it('never lets raw magnitudes enter the fused score (FR-004/004a)', () => {
    // A keyword hit with a huge BM25 score and a semantic hit with a tiny cosine —
    // if magnitudes leaked in, the keyword node would dominate. Rank-only fusion
    // makes them equal (each sole rank-1 in its arm → 1/61), tie-broken by node id.
    const bigScore: SearchResult = { node: mkNode('z'), score: 9999 };
    const out = rrfMerge([bigScore], [sem('a', 0.0001)], { limit: 10, RRF_K: 60 });

    expect(out[0].fusedScore).toBeCloseTo(1 / 61, 10);
    expect(out[1].fusedScore).toBeCloseTo(1 / 61, 10);
    expect(out.map((r) => r.nodeId)).toEqual(['a', 'z']); // equal fused → ascending id
  });

  it('breaks equal fused scores by ASCENDING node id (FR-013)', () => {
    // Each node is the sole rank-1 of one arm → identical fused 1/61; only the
    // tie-break orders them. Insertion order deliberately NOT ascending.
    const out = rrfMerge([kw('zeta')], [sem('alpha')], { limit: 10, RRF_K: 60 });
    expect(out.map((r) => r.nodeId)).toEqual(['alpha', 'zeta']);
    expect(out[0].fusedScore).toBeCloseTo(out[1].fusedScore, 12);
  });

  it('dedupes across arms by node id — one fused row per node (FR-004)', () => {
    const out = rrfMerge([kw('a'), kw('b')], [sem('a'), sem('b')], { limit: 10, RRF_K: 60 });
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.matchType === 'both')).toBe(true);
    // Both at rank 1+2 vs 1+2 → identical fused; ascending id keeps a before b.
    expect(out.map((r) => r.nodeId)).toEqual(['a', 'b']);
  });

  it('defaults RRF_K to the module constant when opts.RRF_K is omitted', () => {
    const withConst = rrfMerge([kw('a')], [], { limit: 10, RRF_K });
    const omitted = rrfMerge([kw('a')], [], { limit: 10 });
    expect(omitted).toEqual(withConst);
    expect(omitted[0].fusedScore).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it('applies path: as a POST-fusion hard gate, dropping rows BEFORE the slice (FR-010)', () => {
    // Highest-ranked keyword row `x` is gated OUT; with limit 1 the surviving `a`
    // must take the slot — proving the gate runs before the offset/limit slice
    // (gate-after-slice would slice [x] then drop → empty).
    const out = rrfMerge(
      [kw('x', { filePath: 'src/db/x.ts' }), kw('a', { filePath: 'src/api/a.ts' }), kw('b', { filePath: 'src/api/b.ts' })],
      [],
      { limit: 1, RRF_K: 60, pathFilters: ['api'] },
    );
    expect(out.map((r) => r.nodeId)).toEqual(['a']);
  });

  it('gates semantic-only rows via the caller-supplied gateFields lookup (FR-010, pure)', () => {
    // `c` has no keyword SearchResult, so the merge cannot see its node — the caller
    // (T012) supplies its gate fields. path: keeps it in api/, drops it under db/.
    const gateFields = new Map<string, RrfGateFields>([['c', { filePath: 'src/api/c.ts', name: 'c' }]]);

    const kept = rrfMerge([], [sem('c')], { limit: 10, RRF_K: 60, pathFilters: ['api'], gateFields });
    expect(kept.map((r) => r.nodeId)).toEqual(['c']);

    const dropped = rrfMerge([], [sem('c')], { limit: 10, RRF_K: 60, pathFilters: ['db'], gateFields });
    expect(dropped).toEqual([]);
  });

  it('applies name: as a POST-fusion hard gate (FR-010)', () => {
    const out = rrfMerge(
      [kw('parseConfig', { name: 'parseConfig' }), kw('validateToken', { name: 'validateToken' })],
      [],
      { limit: 10, RRF_K: 60, nameFilters: ['parse'] },
    );
    expect(out.map((r) => r.nodeId)).toEqual(['parseConfig']);
  });

  it('slices the fixed pool by offset/limit; a deep page returns < limit, not an error (FR-004/016)', () => {
    const arm = [kw('a'), kw('b'), kw('c')]; // fused pool of 3, ordered a,b,c
    // offset within the pool: skip 2, take up to 5 → only the 3rd remains.
    const page = rrfMerge(arm, [], { limit: 5, offset: 2, RRF_K: 60 });
    expect(page.map((r) => r.nodeId)).toEqual(['c']);

    // offset beyond the pool → empty slice, NOT an error/throw.
    const beyond = rrfMerge(arm, [], { limit: 5, offset: 10, RRF_K: 60 });
    expect(beyond).toEqual([]);
  });

  it('is deterministic — identical inputs produce byte-identical output (SC-006)', () => {
    const keyword = [kw('a'), kw('b'), kw('c')];
    const semantic = [sem('c'), sem('a'), sem('d')];
    const opts = { limit: 10, RRF_K: 60 };

    const run1 = rrfMerge(keyword, semantic, opts);
    const run2 = rrfMerge(keyword, semantic, opts);
    expect(run2).toEqual(run1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T013 — the FR-014(c) p95 fusion-compute gate (SC-002; research D11).
//
// A performance GATE, not a red-green behavior test: it PROVES the fusion leg
// (semantic scan + top-k + rank-only RRF) stays under its 150 ms p95 budget at
// the documented corpus envelope (50k × 384 — the bundled-ONNX typical case,
// ~77 MB resident). There is no meaningful RED here: the fusion arms already
// landed green in T007–T012, so a correct implementation satisfies the budget
// on the first run. The gate exists to CATCH a future regression that pushes
// the leg over budget — that is the failing case it guards against.
//
// BINDING MEASUREMENT SPEC (FR-014c/014d, SC-002):
//   • Fixture: 50 000 vectors × 384 dims built IN-MEMORY from a seeded, pure-JS
//     deterministic PRNG (mulberry32 seeded with LATENCY_FIXTURE_SEED). No
//     Math.random, no committed binary asset, no disk write. We construct the
//     VectorMatrix object directly — the gate times FUSION COMPUTE, not DB decode.
//   • Timed region: the FUSION LEG ONLY = semanticTopK (scan + top-k) + rrfMerge,
//     via performance.now(). EXCLUDED: query-embed, fixture generation, matrix
//     build/decode (all done once, up front, outside the timed loop).
//   • Keyword arm: a small fixed synthetic ranked SearchResult[] — its cost is
//     negligible and part of the merge timing.
//   • Warmup: run the fusion leg 10 times, DISCARD those timings (JIT warm-up).
//   • Measure: N = 200 timed iterations; sort ascending; nearest-rank p95 =
//     sorted[Math.ceil(0.95 * 200) - 1] = sorted[189].
//   • Assertion: a single expect(p95).toBeLessThanOrEqual(150). No retry logic.
//   • Record: the observed p95 (+ median) is logged for the orchestrator. Per
//     FR-014d, if the observed p95 lands within 2× of the gate (> 75 ms) the
//     threshold/fixture/headroom must be revisited before merge — the test logs
//     that explicitly when it triggers.
// ───────────────────────────────────────────────────────────────────────────

/**
 * A deterministic pure-JS PRNG (mulberry32) — no Math.random, so the fixture is
 * byte-reproducible across machines/CI from LATENCY_FIXTURE_SEED alone (SC-006).
 * Returns a fresh generator producing floats in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('hybrid search — FR-014(c) p95 fusion-compute gate (T013)', () => {
  const LATENCY_ROWS = 50_000;
  const LATENCY_DIMS = 384;
  const WARMUP = 10;
  const ITERATIONS = 200;
  const P95_BUDGET_MS = 150;

  it(
    'p95 of the fusion leg (scan + top-k + RRF) over a 50k×384 seeded fixture is ≤ 150 ms (SC-002)',
    () => {
      // ── Fixture generation (EXCLUDED from timing) ───────────────────────────
      // One contiguous Float32Array of 50k×384 f32 values from the seeded PRNG,
      // centered to [-1, 1) so cosine similarities span positive and negative
      // (mirroring a real embedding corpus); aligned per-row metadata arrays.
      const rng = mulberry32(LATENCY_FIXTURE_SEED);
      const data = new Float32Array(LATENCY_ROWS * LATENCY_DIMS);
      for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;

      const nodeIds: string[] = new Array(LATENCY_ROWS);
      const kinds: NodeKind[] = new Array(LATENCY_ROWS);
      const languages: Language[] = new Array(LATENCY_ROWS);
      for (let i = 0; i < LATENCY_ROWS; i++) {
        nodeIds[i] = `n${i}`;
        kinds[i] = 'function';
        languages[i] = 'typescript';
      }

      // Construct the resident matrix directly — the gate times fusion compute,
      // not the DB→matrix decode (which T007 covers and is cold-path anyway).
      const matrix: VectorMatrix = {
        matrix: data,
        nodeIds,
        kinds,
        languages,
        model: 'latency-fixture-384',
        dims: LATENCY_DIMS,
        count: LATENCY_ROWS,
      };

      // Query vector: the next 384 draws off the SAME seeded stream (deterministic).
      const queryVector = new Float32Array(LATENCY_DIMS);
      for (let d = 0; d < LATENCY_DIMS; d++) queryVector[d] = rng() * 2 - 1;

      // Keyword arm: a small fixed synthetic ranked list. Two ids overlap the
      // semantic corpus (n0, n1) so the merge exercises its dedup/`both` path;
      // the rest are keyword-only. Its cost is negligible, timed with the merge.
      const keywordArm: SearchResult[] = [
        kw('n0'),
        kw('n1'),
        kw('kw-a'),
        kw('kw-b'),
        kw('kw-c'),
        kw('kw-d'),
        kw('kw-e'),
        kw('kw-f'),
      ];

      // The real call-site depth: k = candidateDepth(limit). limit=10 → k=100.
      const limit = 10;
      const k = candidateDepth(limit);

      // The fusion leg under measurement — scan + top-k, then rank-only RRF.
      const fusionLeg = (): FusedResult[] => {
        const semantic = semanticTopK(matrix, queryVector, k);
        return rrfMerge(keywordArm, semantic, { limit });
      };

      // ── Warmup (DISCARDED) ──────────────────────────────────────────────────
      for (let w = 0; w < WARMUP; w++) fusionLeg();

      // ── Measure: N=200 timed iterations ─────────────────────────────────────
      const timings: number[] = new Array(ITERATIONS);
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        fusionLeg();
        timings[i] = performance.now() - start;
      }

      // Nearest-rank p95 over the ascending-sorted samples:
      //   p95 index = Math.ceil(0.95 * N) - 1 = Math.ceil(190) - 1 = 189.
      timings.sort((a, b) => a - b);
      const p95Index = Math.ceil(0.95 * ITERATIONS) - 1; // = 189 for N=200
      const p95 = timings[p95Index]!;
      const median = timings[Math.ceil(0.5 * ITERATIONS) - 1]!;

      // Record for the orchestrator (reporter-visible).
      // eslint-disable-next-line no-console
      console.log(
        `[T013 FR-014c p95 gate] rows=${LATENCY_ROWS} dims=${LATENCY_DIMS} k=${k} ` +
          `warmup=${WARMUP} iterations=${ITERATIONS} → p95=${p95.toFixed(3)}ms ` +
          `median=${median.toFixed(3)}ms min=${timings[0]!.toFixed(3)}ms ` +
          `max=${timings[ITERATIONS - 1]!.toFixed(3)}ms budget=${P95_BUDGET_MS}ms`,
      );

      // FR-014d headroom clause: within 2× of the gate (> 75 ms) ⇒ revisit before merge.
      if (p95 > P95_BUDGET_MS / 2) {
        // eslint-disable-next-line no-console
        console.warn(
          `[T013 FR-014d] observed p95=${p95.toFixed(3)}ms is within 2× of the ` +
            `${P95_BUDGET_MS}ms gate — revisit threshold/fixture/headroom before merge.`,
        );
      }

      // The gate: a single assertion, no retry.
      expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
    },
    120_000,
  );
});
