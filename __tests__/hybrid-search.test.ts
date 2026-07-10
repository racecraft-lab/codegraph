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
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph, __setQueryEmbeddingProviderForTests } from '../src';
// Namespace import so the T020 factory seam can be reached via an optional-property
// cast (like `searchDetailed` probes `searchNodesDetailed`) — a plain named import of
// a not-yet-existing export is an ESM link-time COLLECTION error that would turn the
// whole file red, not the single RED assertion the TDD gate requires.
import * as CodeGraphIndex from '../src';
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
  resolveAutoMode,
  DEGRADATION_HINT_STRINGS,
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
  type AutoResolveInput,
} from '../src/search/hybrid';
import type { EmbeddingProvider } from '../src/embeddings/provider';
import type { Language, Node, NodeKind, SearchMode, SearchOptions, SearchResult } from '../src/types';

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
// ignores `mode`). So
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
    writeVersion: 0,
    ...over,
  });

  it('no index change → the resident matrix is reused (build-once, same object identity)', async () => {
    const { build, builds } = countingBuild();
    const r1 = await getVectorMatrixForProbe('/proj', probe(), build);
    const r2 = await getVectorMatrixForProbe('/proj', probe(), build);
    expect(builds()).toBe(1); // second query reused the resident matrix — no probe-driven rebuild
    expect(r2).toBe(r1);      // same resolved result object
  });

  // Count-driven change only (add/remove). Same-count re-embeds and 1-for-1 renames are
  // NOT detectable by count alone — the write-version token covers those (review item 6,
  // exercised in the 'write-version staleness' describe below).
  it('vector count change (add/remove) → invalidate + rebuild on the next query', async () => {
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
// T008 extension (review item 6) — same-count re-embed / rename detection via a
// monotonic `vectors_write_version` metadata counter (FR-008b).
//
// The (count, model, dims) token is BLIND to a mutation that leaves the count
// unchanged: an in-place re-embed (`upsertNodeVector` ON CONFLICT DO UPDATE) or a
// 1-for-1 rename (delete A + insert B). A long-lived daemon would then serve stale
// rankings for exactly the symbols being edited. The write-version counter — bumped
// on EVERY node_vectors mutation — folds into the staleness key so any such churn
// invalidates the resident matrix. Dormant projects never write vectors, so the
// scalar stays absent (writeVersion 0) and byte-parity is untouched.
// ───────────────────────────────────────────────────────────────────────────
describe.skipIf(!HAS_SQLITE)('hybrid search — write-version staleness (T008 extension; review item 6)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];

  afterEach(() => {
    __resetVectorMatrixCacheForTests();
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* already closed */ } }
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  /** Index a fixture, seed vectors, mirror the embed-pass metadata scalars. */
  async function seededGraph(): Promise<string> {
    const dir = makeHybridFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    seedFixtureVectors(dir);
    return dir;
  }

  it('same-count in-place re-embed → write-version changes the staleness key → rebuild serves the NEW vector', async () => {
    const dir = await seededGraph();
    const conn = DatabaseConnection.open(getDatabasePath(dir));
    try {
      const q = new QueryBuilder(conn.getDb());

      const probe1 = probeVectorStaleness(q, FIXTURE_MODEL);
      let builds = 0;
      const build = (): VectorMatrixResult => {
        builds++;
        return buildVectorMatrix(vectorMatrixSourceFromQueries(q, FIXTURE_MODEL));
      };
      const r1 = await getVectorMatrixForProbe(dir, probe1, build);
      expect(builds).toBe(1);
      expect(r1.guarded).toBe(false);

      // Re-embed ONE existing symbol IN PLACE with a brand-new distinct vector.
      // Same node_id ⇒ ON CONFLICT DO UPDATE ⇒ the matching-model COUNT is unchanged.
      const victim = q.selectVectorRowsForModel(FIXTURE_MODEL)[0]!.nodeId;
      const NEW_BASIS = 321;
      q.upsertNodeVector(victim, FIXTURE_MODEL, FIXTURE_DIMS, encodeVector(unitVector(NEW_BASIS)), `reembed-${victim}`);

      const probe2 = probeVectorStaleness(q, FIXTURE_MODEL);
      // The OLD token is blind to this — count/model/dims are identical …
      expect(probe2.count).toBe(probe1.count);
      expect(probe2.model).toBe(probe1.model);
      expect(probe2.dims).toBe(probe1.dims);
      // … but the write-version moved, so the staleness key changes and the matrix rebuilds.
      expect(probe2.writeVersion).toBeGreaterThan(probe1.writeVersion);

      const r2 = await getVectorMatrixForProbe(dir, probe2, build);
      expect(builds).toBe(2);            // rebuilt (the old token would have reused r1)
      expect(r2).not.toBe(r1);
      expect(r2.guarded).toBe(false);
      if (!r2.guarded) {
        // And it serves the NEW vector for that symbol.
        const idx = r2.matrix.nodeIds.indexOf(victim);
        expect(idx).toBeGreaterThanOrEqual(0);
        const served = Array.from(
          r2.matrix.matrix.subarray(idx * FIXTURE_DIMS, (idx + 1) * FIXTURE_DIMS),
        );
        expect(served).toEqual(Array.from(unitVector(NEW_BASIS)));
      }
    } finally {
      conn.close();
    }
  });

  it('1-for-1 churn with net-zero count (orphan upsert + sweep) still invalidates via write-version', async () => {
    const dir = await seededGraph();
    const conn = DatabaseConnection.open(getDatabasePath(dir));
    try {
      const q = new QueryBuilder(conn.getDb());

      const probe1 = probeVectorStaleness(q, FIXTURE_MODEL);
      let builds = 0;
      const build = (): VectorMatrixResult => {
        builds++;
        return buildVectorMatrix(vectorMatrixSourceFromQueries(q, FIXTURE_MODEL));
      };
      await getVectorMatrixForProbe(dir, probe1, build);
      expect(builds).toBe(1);

      // Insert a vector for a node_id NOT in `nodes` (an orphan — coverage's JOIN never
      // counts it), then reconcile it away. Both the upsert AND the delete bump the
      // write-version; the matching-model count returns to its original value.
      q.upsertNodeVector('renamed-orphan-id', FIXTURE_MODEL, FIXTURE_DIMS, encodeVector(unitVector(777)), 'rename-hash');
      const swept = q.deleteRemovedVectors();
      expect(swept).toBeGreaterThanOrEqual(1);

      const probe2 = probeVectorStaleness(q, FIXTURE_MODEL);
      expect(probe2.count).toBe(probe1.count);                          // net-zero count change
      expect(probe2.writeVersion).toBeGreaterThan(probe1.writeVersion); // but the token moved

      await getVectorMatrixForProbe(dir, probe2, build);
      expect(builds).toBe(2); // rebuilt — the old (count,model,dims) token would have reused
    } finally {
      conn.close();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SC-003 never-throw hardening (review item 7) — the post-embed fusion leg
// (keyword-arm search, getNodesByIds, RRF merge, materialize) must also fall back
// to keyword-shape + a degradation hint if it throws, never escape
// searchNodesDetailed (the probe/build legs already do; this closes the last gap).
// ───────────────────────────────────────────────────────────────────────────
describe.skipIf(!HAS_SQLITE)('hybrid search — post-embed never-throw (SC-003; review item 7)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];

  afterEach(() => {
    __setQueryEmbeddingProviderForTests(undefined);
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* already closed */ } }
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('a throw from the post-embed leg (getNodesByIds) degrades to keyword + embed-failure, never escapes', async () => {
    __setQueryEmbeddingProviderForTests(fixtureQueryProvider);
    const dir = makeHybridFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    seedFixtureVectors(dir);
    const q = CASES[0].query;
    await cg.acquireQueryVectorForSearch(q); // warm the query-vector cache (healthy fused precondition)

    // Force a throw INSIDE the post-embed leg (after the matrix build/scan): stub the
    // batched node lookup to throw. A clean test-only seam — reaches into the private
    // queries handle with no production change.
    const queries = (cg as unknown as {
      queries: { getNodesByIds: (ids: string[]) => Map<string, Node> };
    }).queries;
    const original = queries.getNodesByIds.bind(queries);
    queries.getNodesByIds = () => {
      throw new Error('forced post-embed failure');
    };
    try {
      // Must NOT throw (SC-003) and must degrade to keyword shape with the catch-all hint.
      const detailed = cg.searchNodesDetailed(q, { mode: 'hybrid' });
      expect(detailed.degradation).toBe('embed-failure');
      // Dormant keyword shape — no fused provenance fields, no timing.
      for (const r of detailed.results) {
        expect(r.matchType).toBeUndefined();
        expect(r.fusedScore).toBeUndefined();
      }
      expect(detailed.timing).toBeUndefined();
    } finally {
      queries.getNodesByIds = original;
    }
  });
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

// ───────────────────────────────────────────────────────────────────────────
// T018 — US3 degradation SIGNAL at the LIBRARY layer (FR-005/006/009c/015,
// SC-003; contract degradation-hints.md). RED-only.
//
// SCOPE (per the T018/T019 split): the four VERBATIM footer strings render at
// the SURFACES (MCP tools.ts / CLI) — T019/T022 own that and assert the literal
// strings against the surface renderer. At the LIBRARY layer this file exercises
// (`cg.searchNodes`), the degradation REASON must be exposed MACHINE-READABLY so
// the surfaces can map it to the correct string. So these tests assert a
// library-visible degradation SIGNAL + keyword-dormant results, NOT markdown
// strings.
//
// THE LIBRARY CONTRACT T019 MUST SATISFY (asserted below):
//   • New method `CodeGraph.searchNodesDetailed(query, options?)` returning
//         interface SearchNodesDetailed {
//           results: SearchResult[];                 // ALWAYS dormant keyword
//           degradation: DegradationCondition | null; // the machine-readable reason
//         }
//     where `DegradationCondition =
//         'no-provider'    // condition 1 → FR-015 string 1
//       | 'no-vectors'     // condition 2 → string 2 (folds model-mismatch)
//       | 'warming'        // condition 3 → string 3
//       | 'embed-failure'` // condition 4 → string 4 (folds embed timeout /
//                          //   provider failure / FR-009c memory-guard skip /
//                          //   any unexpected semantic-path exception — catch-all)
//   • When `degradation !== null`, `results` is byte-identical to the keyword
//     pipeline (dormant shape: NO `matchType`/`fusedScore` fields — SC-003).
//   • `degradation === null` for: keyword mode, a healthy fused query, AND the
//     healthy-empty case (filter-only query on a provider WITH matching vectors).
//   • The whole path NEVER throws / never `isError` for any mode or provider,
//     and `acquireQueryVectorForSearch` RESOLVES (never rejects) on a failing
//     provider, recording the failure so a later `searchNodesDetailed` reports
//     `embed-failure` rather than `warming`.
//
// WHY RED TODAY (real assertion failures, not collection errors): `searchNodes`
// already degrades to dormant keyword for SOME conditions but exposes NO signal,
// returns matchType-tagged results for the no-vectors condition, and
// `searchNodesDetailed` does not exist. We probe for the method through an
// OPTIONAL-typed cast (so the file still typechecks and imports cleanly) and the
// presence assertion FAILS as a real assertion until T019 lands the method.
// ───────────────────────────────────────────────────────────────────────────

/** The machine-readable degradation reason T019 must expose (one per FR-015 condition). */
type DegradationCondition = 'no-provider' | 'no-vectors' | 'warming' | 'embed-failure';

/** The detailed search result T019 must add; surfaces map `degradation` → the FR-015 footer string. */
interface SearchNodesDetailed {
  results: SearchResult[];
  degradation: DegradationCondition | null;
}

/**
 * Probe `CodeGraph` for the T019 `searchNodesDetailed` surface WITHOUT a
 * compile-time dependency on a method that does not exist yet: the optional cast
 * keeps the call type-safe today (typecheck clean) while the presence assertion
 * FAILS as a real assertion (not a collection/import error) until T019 lands the
 * method. Once present, the caller's downstream assertions run unchanged.
 */
function searchDetailed(cg: CodeGraph, query: string, options: SearchOptions): SearchNodesDetailed {
  const obj = cg as unknown as {
    searchNodesDetailed?: (q: string, o?: SearchOptions) => SearchNodesDetailed;
  };
  expect(typeof obj.searchNodesDetailed).toBe('function'); // RED today — T019 adds the method
  return obj.searchNodesDetailed!(query, options);
}

/** Every degraded response is dormant keyword shape: NO provenance fields (SC-003; FR-014 absence check). */
function expectDormantShape(results: SearchResult[]): void {
  for (const r of results) {
    expect(r.matchType).toBeUndefined();
    expect(r.fusedScore).toBeUndefined();
  }
}

/** A provider that embeds ANY text to a fixed one-hot unit vector (no live endpoint). */
function constEmbedProvider(id: string, dims: number): EmbeddingProvider {
  return {
    id,
    dims,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map(() => {
        const v = new Float32Array(dims);
        v[0] = 1;
        return v;
      });
    },
  };
}

/** A provider whose embed() always REJECTS — the timeout/provider-failure stand-in (condition 4). */
function rejectingEmbedProvider(id: string, dims: number): EmbeddingProvider {
  return {
    id,
    dims,
    async embed(): Promise<Float32Array[]> {
      throw new Error('embed failed (fixture provider)');
    },
  };
}

/**
 * A slow-but-HEALTHY provider (T021): its embed eventually resolves to a fixed one-hot
 * unit vector, but only AFTER `delayMs`. It is the stand-in for the embed-budget race —
 * a race with a test budget << `delayMs` times out (the vector arrives LATE), while a
 * budget > `delayMs` lets the same embed win and deposit. `basis` picks the one-hot
 * index (0 → cosine 1.0 with `parseConfig`'s seeded fixture vector). `embedCalls`
 * exposes how many times embed actually ran (so a test can prove the LATE embed still
 * resolved). The internal timer is `unref`'d so a hang far longer than the test budget
 * never keeps the vitest process alive after the capped acquisition already returned.
 */
function slowEmbedProvider(
  id: string,
  dims: number,
  delayMs: number,
  basis = 0,
): { provider: EmbeddingProvider; embedCalls: () => number } {
  let calls = 0;
  const provider: EmbeddingProvider = {
    id,
    dims,
    async embed(texts: string[]): Promise<Float32Array[]> {
      calls++;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delayMs);
        (t as unknown as { unref?: () => void }).unref?.();
      });
      return texts.map(() => {
        const v = new Float32Array(dims);
        v[basis] = 1;
        return v;
      });
    },
  };
  return { provider, embedCalls: () => calls };
}

/** Seed one one-hot fixture vector per embeddable node under an ARBITRARY model id (for the mismatch fold). */
function seedVectorsUnderModel(dir: string, model: string): void {
  const conn = DatabaseConnection.open(getDatabasePath(dir));
  try {
    const q = new QueryBuilder(conn.getDb());
    let basis = 0;
    for (const node of q.selectEmbeddableNodesMissingVector(model)) {
      q.upsertNodeVector(node.id, model, FIXTURE_DIMS, encodeVector(unitVector(basis++)), `mm-${node.id}`);
    }
  } finally {
    conn.close();
  }
}

/** Write a single `project_metadata` scalar through a fresh connection (mirrors the embed pass). */
function setFixtureMetadata(dir: string, key: string, value: string): void {
  const conn = DatabaseConnection.open(getDatabasePath(dir));
  try {
    new QueryBuilder(conn.getDb()).setMetadata(key, value);
  } finally {
    conn.close();
  }
}

/** Run `fn` with all three CODEGRAPH_EMBEDDING_* env vars forced OFF, restoring them after (dogfood shells export them). */
function withEmbeddingEnvOff<T>(fn: () => T): T {
  const saved = {
    url: process.env.CODEGRAPH_EMBEDDING_URL,
    model: process.env.CODEGRAPH_EMBEDDING_MODEL,
    provider: process.env.CODEGRAPH_EMBEDDING_PROVIDER,
  };
  delete process.env.CODEGRAPH_EMBEDDING_URL;
  delete process.env.CODEGRAPH_EMBEDDING_MODEL;
  delete process.env.CODEGRAPH_EMBEDDING_PROVIDER;
  try {
    return fn();
  } finally {
    if (saved.url !== undefined) process.env.CODEGRAPH_EMBEDDING_URL = saved.url;
    if (saved.model !== undefined) process.env.CODEGRAPH_EMBEDDING_MODEL = saved.model;
    if (saved.provider !== undefined) process.env.CODEGRAPH_EMBEDDING_PROVIDER = saved.provider;
  }
}

describe.skipIf(!HAS_SQLITE)('hybrid search — US3 degradation signal (T018)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];

  /** The three modes for which a degraded condition surfaces a hint (FR-015: auto, semantic, hybrid). */
  const HINT_MODES: SearchMode[] = ['hybrid', 'semantic', 'auto'];

  /** A free-text query keyword-reachable in the fixture (`parse` prefixes `parseConfig`) → non-empty keyword hits. */
  const DEGRADE_QUERY = 'parse raw config text';

  afterEach(() => {
    __setQueryEmbeddingProviderForTests(undefined); // never leak the seam into another suite
    __resetVectorMatrixCacheForTests();
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  /** A real, structurally-indexed fixture graph; `seed` optionally hand-seeds vectors/metadata. */
  async function indexed(seed?: (dir: string) => void): Promise<{ cg: CodeGraph; dir: string }> {
    const dir = makeHybridFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    if (seed) seed(dir);
    return { cg, dir };
  }

  // ── Condition 1: no provider configured (FR-002/015 → string 1) ────────────
  it('condition 1 — no provider (env OFF, no seam): auto/semantic/hybrid degrade to keyword + `no-provider` (FR-015)', async () => {
    const { cg } = await indexed(); // structural-only; no vectors, no seam
    withEmbeddingEnvOff(() => {
      for (const mode of HINT_MODES) {
        const keyword = cg.searchNodes(DEGRADE_QUERY, { mode: 'keyword' });
        expect(keyword.length).toBeGreaterThan(0); // fixture actually matches

        const detailed = searchDetailed(cg, DEGRADE_QUERY, { mode });
        expect(detailed.degradation).toBe('no-provider');
        expect(detailed.results).toEqual(keyword); // dormant keyword, byte-identical
        expectDormantShape(detailed.results);

        // Zero throws from mode dispatch (SC-003) — plain searchNodes stays keyword too.
        expect(() => cg.searchNodes(DEGRADE_QUERY, { mode })).not.toThrow();
      }
    });
  });

  // ── Condition 2: no matching-model vectors (FR-015 → string 2) ─────────────
  it('condition 2 — provider present, ZERO matching-model vectors: degrades to keyword + `no-vectors` (FR-015)', async () => {
    // Provider present + query cache WARM (so `warming` is ruled out) but no
    // vectors seeded under the provider's model → the only reason is no-vectors.
    const { cg } = await indexed(); // deliberately NOT seeded
    __setQueryEmbeddingProviderForTests(constEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS));
    await cg.acquireQueryVectorForSearch(DEGRADE_QUERY); // warm the query-vector cache

    const keyword = cg.searchNodes(DEGRADE_QUERY, { mode: 'keyword' });
    for (const mode of HINT_MODES) {
      const detailed = searchDetailed(cg, DEGRADE_QUERY, { mode });
      expect(detailed.degradation).toBe('no-vectors');
      expect(detailed.results).toEqual(keyword);
      expectDormantShape(detailed.results);
    }
  });

  it('condition 2 — MODEL MISMATCH fold: vectors under a DIFFERENT model id still read as `no-vectors` (Edge Cases)', async () => {
    // Vectors exist, but under `stale-model-384`; the provider reports FIXTURE_MODEL
    // → zero matching-model vectors → same signal (string 2), not a fifth condition.
    const { cg } = await indexed((dir) => seedVectorsUnderModel(dir, 'stale-model-384'));
    __setQueryEmbeddingProviderForTests(constEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS));
    await cg.acquireQueryVectorForSearch(DEGRADE_QUERY); // warm — rule out `warming`

    const keyword = cg.searchNodes(DEGRADE_QUERY, { mode: 'keyword' });
    const detailed = searchDetailed(cg, DEGRADE_QUERY, { mode: 'hybrid' });
    expect(detailed.degradation).toBe('no-vectors');
    expect(detailed.results).toEqual(keyword);
    expectDormantShape(detailed.results);
  });

  // ── Condition 3: provider warming (FR-005 → string 3) ──────────────────────
  it('condition 3 — provider present + matching vectors but cache COLD (first query): keyword + `warming` (FR-005)', async () => {
    // Seed matching-model vectors so it is NOT condition 2; leave the query-vector
    // cache cold (no acquireQueryVectorForSearch) so the first query is warming.
    const { cg } = await indexed((dir) => seedFixtureVectors(dir));
    __setQueryEmbeddingProviderForTests(constEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS));

    const keyword = cg.searchNodes(DEGRADE_QUERY, { mode: 'keyword' });
    for (const mode of HINT_MODES) {
      const detailed = searchDetailed(cg, DEGRADE_QUERY, { mode });
      expect(detailed.degradation).toBe('warming');
      expect(detailed.results).toEqual(keyword);
      expectDormantShape(detailed.results);
    }
  });

  // ── Condition 4: embed timeout / provider failure (FR-006 → string 4) ──────
  it('condition 4 — a REJECTING provider: acquisition resolves (never rejects) and the search degrades to keyword + `embed-failure` (FR-006/SC-003)', async () => {
    const { cg } = await indexed((dir) => seedFixtureVectors(dir));
    __setQueryEmbeddingProviderForTests(rejectingEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS));

    // Library no-throw invariant: a failing embed must RESOLVE to the empty
    // acquisition (recording the failure), never reject/throw (SC-003; Constitution VI).
    await expect(cg.acquireQueryVectorForSearch(DEGRADE_QUERY)).resolves.toEqual({
      vector: null,
      model: null,
    });

    const keyword = cg.searchNodes(DEGRADE_QUERY, { mode: 'keyword' });
    const detailed = searchDetailed(cg, DEGRADE_QUERY, { mode: 'hybrid' });
    expect(detailed.degradation).toBe('embed-failure'); // recorded failure ⇒ NOT `warming`
    expect(detailed.results).toEqual(keyword);
    expectDormantShape(detailed.results);
  });

  // ── Condition 4 fold: FR-009c memory-guard skip → string 4 ─────────────────
  it('condition 4 — FR-009c memory-guard skip (predictedBytes > 1 GiB): keyword + `embed-failure`, not `isError` (FR-009c)', async () => {
    // Seed one real matching-model vector, then poison `embedding_dims` so the
    // matrix source predicts a > 1 GiB build → buildVectorMatrix guards it PRE-
    // allocation and the semantic arm is skipped (catch-all string 4).
    const HUGE_DIMS = MAX_MATRIX_BYTES / 4 + 1; // 1 row × this width × 4 bytes > ceiling
    const { cg } = await indexed((dir) => {
      seedFixtureVectors(dir);
      setFixtureMetadata(dir, 'embedding_dims', String(HUGE_DIMS));
    });
    __setQueryEmbeddingProviderForTests(constEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS));
    await cg.acquireQueryVectorForSearch(DEGRADE_QUERY); // warm — rule out `warming`

    const keyword = cg.searchNodes(DEGRADE_QUERY, { mode: 'keyword' });
    let detailed!: SearchNodesDetailed;
    expect(() => { detailed = searchDetailed(cg, DEGRADE_QUERY, { mode: 'hybrid' }); }).not.toThrow();
    expect(detailed.degradation).toBe('embed-failure');
    expect(detailed.results).toEqual(keyword);
    expectDormantShape(detailed.results);
  });

  // ── NOT degraded: healthy-empty (filter-only query) — FR-011 / Edge Cases ──
  it('healthy-empty — a filter-only query on a HEALTHY provider is NOT degraded: `degradation === null`, byte-identical to keyword', async () => {
    // Provider present AND matching vectors exist → healthy. The query is only
    // filter tokens → empty embed input → the semantic arm contributes nothing,
    // but this is NOT one of the four conditions: no signal, byte-identical.
    const { cg } = await indexed((dir) => seedFixtureVectors(dir));
    __setQueryEmbeddingProviderForTests(constEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS));

    const FILTER_ONLY = 'kind:function';
    const keyword = cg.searchNodes(FILTER_ONLY, { mode: 'keyword' });
    expect(keyword.length).toBeGreaterThan(0); // the fixture has functions to match

    for (const mode of HINT_MODES) {
      const detailed = searchDetailed(cg, FILTER_ONLY, { mode });
      expect(detailed.degradation).toBeNull(); // healthy-empty ≠ degraded
      expect(detailed.results).toEqual(keyword); // byte-identical to keyword
      expectDormantShape(detailed.results);
    }
  });

  // ── SC-003: zero isError / zero throws from library mode dispatch ──────────
  it('SC-003 — the library never throws from mode dispatch under any degraded condition', async () => {
    // No provider, no vectors: the harshest degraded state. Neither `searchNodes`
    // nor the new `searchNodesDetailed` may throw for any mode (success-shaped).
    const { cg } = await indexed();
    withEmbeddingEnvOff(() => {
      for (const mode of HINT_MODES) {
        expect(() => cg.searchNodes(DEGRADE_QUERY, { mode })).not.toThrow(); // keyword — green today

        const obj = cg as unknown as {
          searchNodesDetailed?: (q: string, o?: SearchOptions) => SearchNodesDetailed;
        };
        expect(typeof obj.searchNodesDetailed).toBe('function'); // RED today — T019 adds it
        expect(() => obj.searchNodesDetailed!(DEGRADE_QUERY, { mode })).not.toThrow();
      }
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T024 — SC-007 cross-surface TRUTHFULNESS GATE (FR-017; CHK022).
//
// `codegraph status` must report query-side hybrid availability with ZERO
// discrepancy against the ACTUAL `auto`-mode search outcome, for the SAME index
// state, across all THREE reachable states:
//
//   (a) provider configured + matching-model vectors present
//         status hybridSearchAvailable === true   ⟺  a warmed auto query FUSES
//                                                     (searchNodesDetailed.degradation === null)
//   (b) no embedding provider configured
//         hybridSearchAvailable === false          ⟺  auto degrades → 'no-provider'
//   (c) provider configured but ZERO matching-model vectors
//         hybridSearchAvailable === false          ⟺  auto degrades → 'no-vectors'
//
// The invariant asserted per state: `hybridSearchAvailable === (degradation === null)`,
// AND the status `hybridSearchReason` draws from the SAME condition-family vocabulary
// the search-time degradation maps to (reason for (b) ⊂ the no-provider hint's
// vocabulary; reason for (c) ⊂ the no-vectors hint's vocabulary).
//
// DESIGN (per the T024 contract). The status FIELD is read via the CLI SUBPROCESS
// (execFileSync of the built binary — the surface a user actually sees); the auto
// OUTCOME is read via the IN-PROCESS library (`searchNodesDetailed` + the query-
// provider seam + a warmed cache), on the SAME on-disk fixture. The provider seam is
// in-process only (unreachable across the subprocess boundary), and BOTH surfaces read
// the SAME on-disk model + vectors, so we keep them aligned by making
// `env CODEGRAPH_EMBEDDING_MODEL === provider.id === the model the vectors are seeded
// under` (all `FIXTURE_MODEL`). getEmbeddingStatus reads CONFIG (env) + coverage (DB)
// only — never the endpoint — so a dummy URL fully drives the subprocess `yes`/`no`.
//
// RED is NOT APPLICABLE. This is a truthfulness gate layered over three ALREADY-LANDED
// surfaces (T015 auto resolution, T019 degradation signal, T023 status fields); it
// passes on first run precisely because those surfaces are consistent — that
// consistency IS the property under test. Non-vacuity is proven two independent ways:
//   1. the three states yield three DISTINCT (available, reason, degradation) tuples —
//      so the equalities bind to real, differing values, not a constant; and
//   2. an explicit negative control shows the agreement operator REJECTS the
//      disagreeing combinations (available=true while degraded, etc.) — guarding
//      against a vacuous `x === x`.
// If any surface later drifts (e.g. status says `yes` while auto still degrades), a
// state's `available === (degradation === null)` assertion fails — the discrepancy the
// gate exists to catch.
// ───────────────────────────────────────────────────────────────────────────
describe.skipIf(!HAS_SQLITE)('hybrid search — SC-007 status/search truthfulness gate (T024)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];

  /** The built binary the CLI status subprocess drives (matches hybrid-cli-surface.test.ts). */
  const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');

  /** Free-text query keyword-reachable in the fixture AND embedded to parseConfig's basis (basis 0) → a real fuse in state (a). */
  const DEGRADE_QUERY = 'parse raw config text';

  /** The exact status reason literals (contract §Status availability line; mirrors T023). */
  const REASON_NO_PROVIDER = 'no embedding provider configured';
  const REASON_NO_VECTORS = 'no matching-model vectors — run `codegraph sync`';

  /**
   * Ambient embedding vars a dogfood shell / .envrc.local would leak into the child;
   * scrubbed so the subprocess sees ONLY the per-state env we layer on (same list as
   * hybrid-cli-surface.test.ts / embeddings-dormancy.test.ts).
   */
  const EMBEDDING_ENV_VARS = [
    'CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL', 'CODEGRAPH_EMBEDDING_API_KEY',
    'CODEGRAPH_EMBEDDING_DIMS', 'CODEGRAPH_EMBEDDING_BATCH_SIZE', 'CODEGRAPH_EMBEDDING_CONCURRENCY',
    'CODEGRAPH_EMBEDDING_TIMEOUT_MS', 'CODEGRAPH_EMBEDDING_PROVIDER', 'CODEGRAPH_MODEL_BASE_URL',
    'CODEGRAPH_MODEL_CACHE_DIR',
  ];

  /** Active endpoint provider config: BOTH URL and MODEL set; the model === FIXTURE_MODEL so coverage counts the seeded vectors. */
  const ACTIVE_ENV: NodeJS.ProcessEnv = {
    CODEGRAPH_EMBEDDING_URL: 'http://localhost:9/embed',
    CODEGRAPH_EMBEDDING_MODEL: FIXTURE_MODEL,
  };

  /** Child env: inherit, force daemon off + skip the wasm relaunch, scrub ambient embedding vars, then layer per-state config. */
  function childStatusEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_WASM_RELAUNCHED: '1' };
    for (const k of EMBEDDING_ENV_VARS) delete env[k];
    return { ...env, ...extra };
  }

  /** Run `codegraph status --json` against the built binary in `dir`; parse the single JSON line. */
  function statusJson(dir: string, extra: NodeJS.ProcessEnv = {}): Record<string, unknown> {
    const out = execFileSync(process.execPath, [BIN, 'status', '--json'], {
      cwd: dir,
      encoding: 'utf-8',
      env: childStatusEnv(extra),
      stdio: ['ignore', 'pipe', 'ignore'], // drop stderr (SQLite experimental warning)
    });
    return JSON.parse(out.trim().split('\n').filter(Boolean).pop()!);
  }

  afterEach(() => {
    __setQueryEmbeddingProviderForTests(undefined); // never leak the seam into another suite
    __resetVectorMatrixCacheForTests();
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  /** The reachable index states SC-007 must report truthfully. */
  type StateKind = 'provider-and-vectors' | 'no-provider' | 'no-matching-vectors';

  /** The tuple SC-007 asserts agrees: the CLI status field pair + the in-process auto outcome, on ONE fixture. */
  interface CrossSurface {
    available: boolean;
    reason: string | null;
    degradation: DegradationCondition | null;
    autoResults: SearchResult[];
  }

  /**
   * Build a fixture in the given state, then read BOTH surfaces on the SAME dir: the
   * in-process `auto` outcome (library, via the seam + warmed cache) and the CLI status
   * `--json` fields (subprocess against the built binary). The in-process read happens
   * first (needs the graph open); the graph is then CLOSED before the subprocess reads
   * the DB, so the two surfaces never contend for the SQLite file.
   */
  async function crossSurface(kind: StateKind): Promise<CrossSurface> {
    const dir = makeHybridFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);

    let statusEnv: NodeJS.ProcessEnv = {};
    let detailed: SearchNodesDetailed;

    if (kind === 'provider-and-vectors') {
      // Matching-model vectors present → status active+covered = yes; seam + warmed
      // cache → the auto query fuses (degradation null).
      seedFixtureVectors(dir);
      statusEnv = ACTIVE_ENV;
      __setQueryEmbeddingProviderForTests(constEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS));
      await cg.acquireQueryVectorForSearch(DEGRADE_QUERY); // warm the query-vector cache
      detailed = searchDetailed(cg, DEGRADE_QUERY, { mode: 'auto' });
    } else if (kind === 'no-provider') {
      // No provider configured either surface: env OFF for the subprocess (statusEnv
      // stays empty → scrubbed → dormant), seam UNSET in-process → auto → 'no-provider'.
      detailed = withEmbeddingEnvOff(() => {
        __setQueryEmbeddingProviderForTests(undefined);
        return searchDetailed(cg, DEGRADE_QUERY, { mode: 'auto' });
      });
    } else {
      // Provider configured but ZERO matching-model vectors (none seeded): status
      // active but coverage 0 = no; seam present + cache warmed (rules out `warming`,
      // though the zero-corpus probe takes precedence) → auto → 'no-vectors'.
      statusEnv = ACTIVE_ENV;
      __setQueryEmbeddingProviderForTests(constEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS));
      await cg.acquireQueryVectorForSearch(DEGRADE_QUERY);
      detailed = searchDetailed(cg, DEGRADE_QUERY, { mode: 'auto' });
    }

    // Release the graph's DB handle before the subprocess opens the same file — no
    // cross-process SQLite contention (the in-process outcome is already captured).
    cg.close();
    const status = statusJson(dir, statusEnv);

    return {
      available: status.hybridSearchAvailable as boolean,
      reason: status.hybridSearchReason as string | null,
      degradation: detailed.degradation,
      autoResults: detailed.results,
    };
  }

  // ── State (a): provider + matching-model vectors → status `yes` ⟺ auto fuses ──
  it('state (a) provider+vectors — status hybridSearchAvailable=true agrees with a FUSED auto query (degradation null)', async () => {
    const s = await crossSurface('provider-and-vectors');

    // CLI status field.
    expect(s.available).toBe(true);
    expect(s.reason).toBeNull(); // reason is null iff available (contract)

    // Actual auto outcome: the warmed query genuinely FUSED (provenance-tagged), not a
    // healthy-empty null — so `degradation === null` reflects a real fuse.
    expect(s.degradation).toBeNull();
    expect(s.autoResults.some((r) => r.matchType !== undefined)).toBe(true);

    // Zero discrepancy: available ⟺ (auto fused).
    expect(s.available).toBe(s.degradation === null);
  });

  // ── State (b): no provider → status `no (no-provider)` ⟺ auto degrades 'no-provider' ──
  it("state (b) no-provider — status hybridSearchAvailable=false agrees with an auto query degrading to 'no-provider'", async () => {
    const s = await crossSurface('no-provider');

    expect(s.available).toBe(false);
    expect(s.reason).toBe(REASON_NO_PROVIDER);
    expect(s.degradation).toBe('no-provider');

    // Zero discrepancy: available ⟺ (auto fused). Both say "not available".
    expect(s.available).toBe(s.degradation === null);

    // Reason FAMILY: the status reason draws from the no-provider hint's vocabulary
    // ('provider') — a token the no-vectors hint does NOT carry, so the family binds.
    expect(s.reason).toContain('provider');
    expect(DEGRADATION_HINT_STRINGS['no-provider']).toContain('provider');
    expect(DEGRADATION_HINT_STRINGS['no-vectors']).not.toContain('provider');
  });

  // ── State (c): provider but 0 vectors → status `no (no-vectors)` ⟺ auto degrades 'no-vectors' ──
  it("state (c) provider+no-vectors — status hybridSearchAvailable=false agrees with an auto query degrading to 'no-vectors'", async () => {
    const s = await crossSurface('no-matching-vectors');

    expect(s.available).toBe(false);
    expect(s.reason).toBe(REASON_NO_VECTORS);
    expect(s.degradation).toBe('no-vectors');

    // Zero discrepancy: available ⟺ (auto fused). Both say "not available".
    expect(s.available).toBe(s.degradation === null);

    // Reason FAMILY: the status reason draws from the no-vectors hint's vocabulary (the
    // '`codegraph sync`' remediation) — a token the no-provider hint does NOT carry.
    expect(s.reason).toContain('codegraph sync');
    expect(DEGRADATION_HINT_STRINGS['no-vectors']).toContain('codegraph sync');
    expect(DEGRADATION_HINT_STRINGS['no-provider']).not.toContain('codegraph sync');
  });

  // ── Non-vacuity: the three states are DISTINCT and the agreement operator BINDS ──
  it('the agreement is non-vacuous: the three states yield distinct tuples and the operator rejects disagreement', async () => {
    const a = await crossSurface('provider-and-vectors');
    const b = await crossSurface('no-provider');
    const c = await crossSurface('no-matching-vectors');

    // Each state independently agrees (the SC-007 property, once per state).
    for (const s of [a, b, c]) expect(s.available).toBe(s.degradation === null);

    // (1) The three (available, reason, degradation) tuples are pairwise DISTINCT, so
    // the per-state equalities bind to differing values — not a constant that would
    // pass for any state. `available` alone is true/false/false, but reason and
    // degradation separate (b) from (c).
    const tuple = (s: CrossSurface) => JSON.stringify([s.available, s.reason, s.degradation]);
    const tuples = new Set([tuple(a), tuple(b), tuple(c)]);
    expect(tuples.size).toBe(3);
    expect(a.degradation).toBeNull();
    expect(b.degradation).toBe('no-provider');
    expect(c.degradation).toBe('no-vectors');

    // (2) Negative control — the agreement operator is not a vacuous `x === x`: it
    // ACCEPTS the three observed shapes and REJECTS every disagreeing combination.
    const agree = (available: boolean, degradation: DegradationCondition | null) => available === (degradation === null);
    expect(agree(true, null)).toBe(true); // (a)
    expect(agree(false, 'no-provider')).toBe(true); // (b)
    expect(agree(false, 'no-vectors')).toBe(true); // (c)
    expect(agree(true, 'no-provider')).toBe(false); // status lies "available" while search degraded
    expect(agree(true, 'no-vectors')).toBe(false); // "
    expect(agree(false, null)).toBe(false); // status lies "unavailable" while search fused
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T019 — the exported degradation hint-string map (FR-015 Degradation Hint
// Wording table). The four VERBATIM footer literals the surfaces (MCP/CLI, T022)
// append when `searchNodesDetailed` reports a non-null degradation. The literals
// below are transcribed straight from spec.md's table — this test is the
// cross-check that the exported constant matches the spec byte-for-byte (leading
// `\n\n` separator included, per FR-005's after-results placement).
// ───────────────────────────────────────────────────────────────────────────
describe('hybrid search — degradation hint strings (T019)', () => {
  it('maps every degraded condition to its verbatim FR-015 footer literal', () => {
    expect(DEGRADATION_HINT_STRINGS['no-provider']).toBe(
      '\n\n> **Note:** semantic ranking is off — no embedding provider configured; showing keyword matches. Set CODEGRAPH_EMBEDDING_PROVIDER=local for the bundled model, or CODEGRAPH_EMBEDDING_URL and CODEGRAPH_EMBEDDING_MODEL for an endpoint, to enable.',
    );
    expect(DEGRADATION_HINT_STRINGS['no-vectors']).toBe(
      '\n\n> **Note:** no semantic vectors for the active model yet; showing keyword matches. Run `codegraph sync` to embed.',
    );
    expect(DEGRADATION_HINT_STRINGS['warming']).toBe(
      '\n\n> **Note:** semantic ranking is warming up; showing keyword matches — later queries will fuse.',
    );
    expect(DEGRADATION_HINT_STRINGS['embed-failure']).toBe(
      '\n\n> **Note:** semantic ranking failed or timed out this query; showing keyword matches.',
    );
  });

  it('has exactly the four degraded conditions and every string leads with the blank-line footer separator', () => {
    expect(Object.keys(DEGRADATION_HINT_STRINGS).sort()).toEqual([
      'embed-failure',
      'no-provider',
      'no-vectors',
      'warming',
    ]);
    for (const s of Object.values(DEGRADATION_HINT_STRINGS)) {
      expect(s.startsWith('\n\n')).toBe(true);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T020 — lazy-init warming ownership + init-failure reset (FR-005/006).
//
// The query-time embedding provider is constructed LAZILY, exactly once, behind a
// SINGLE warming owner: concurrent first-time acquisitions for the same
// (text-independent) provider share ONE construction / warm-up — no duplicate
// provider construction, no duplicate ONNX/HTTP warm-up. A failed or timed-out
// init/embed returns the memoized slot to UNINITIALIZED (init-failure reset — NO
// permanent latch), so a LATER acquisition re-attempts construction from scratch
// and can succeed once the provider recovers. A persistently-failing provider
// therefore never wedges: every acquisition resolves {vector:null,model:null} and
// every search reports `embed-failure` without throwing, and acquisition happens
// ONLY when called (no background retry timers, bounded failure recording).
//
// A NEW test-only seam — a provider FACTORY — makes construction observable and
// repeatable so these invariants are testable: the factory count is the number of
// provider constructions. RED until T020 memoizes construction behind the owner and
// adds the factory seam (the pre-T019 code constructs a fresh provider per call and
// exposes no factory, so `setQueryProviderFactory`'s presence assertion fails).
// ───────────────────────────────────────────────────────────────────────────
describe.skipIf(!HAS_SQLITE)('hybrid search — lazy-init warming + reset (T020)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];

  /** A free-text query keyword-reachable in the fixture AND embedded to parseConfig's basis (basis 0). */
  const DEGRADE_QUERY = 'parse raw config text';

  /**
   * Install the T020 provider-FACTORY seam via an optional-property cast (no hard
   * import dependency — see the namespace import note). The presence assertion is the
   * RED carrier until T020 exports the seam; once present, callers run unchanged.
   */
  function setQueryProviderFactory(factory: (() => EmbeddingProvider) | undefined): void {
    const mod = CodeGraphIndex as unknown as {
      __setQueryEmbeddingProviderFactoryForTests?: (f: (() => EmbeddingProvider) | undefined) => void;
    };
    expect(typeof mod.__setQueryEmbeddingProviderFactoryForTests).toBe('function'); // RED until T020
    mod.__setQueryEmbeddingProviderFactoryForTests!(factory);
  }

  afterEach(() => {
    // Clear the factory seam without asserting (optional chaining) so cleanup never
    // masks a test failure and never leaks the seam into another suite.
    (CodeGraphIndex as unknown as {
      __setQueryEmbeddingProviderFactoryForTests?: (f: (() => EmbeddingProvider) | undefined) => void;
    }).__setQueryEmbeddingProviderFactoryForTests?.(undefined);
    __setQueryEmbeddingProviderForTests(undefined);
    __resetVectorMatrixCacheForTests();
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  /** A real, structurally-indexed fixture graph with matching-model vectors seeded. */
  async function indexedSeeded(): Promise<CodeGraph> {
    const dir = makeHybridFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    seedFixtureVectors(dir);
    return cg;
  }

  it('a. concurrent first-time acquisitions share ONE provider construction (single-owner warming)', async () => {
    const cg = await indexedSeeded();
    let constructions = 0;
    setQueryProviderFactory(() => {
      constructions++;
      return constEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS);
    });

    // Two concurrent FIRST acquisitions race BEFORE either warms — the single-owner
    // memoization must serialise them onto ONE constructed provider (no duplicate
    // construction, no duplicate warm-up).
    const [a, b] = await Promise.all([
      cg.acquireQueryVectorForSearch(DEGRADE_QUERY),
      cg.acquireQueryVectorForSearch(DEGRADE_QUERY),
    ]);

    expect(constructions).toBe(1);        // one construction served both concurrent acquisitions
    expect(a.vector).not.toBeNull();
    expect(b.vector).not.toBeNull();
    expect(a.model).toBe(FIXTURE_MODEL);
    expect(b.model).toBe(FIXTURE_MODEL);
  });

  it('b. init-failure RESET — a fail-once-then-succeed provider re-acquires and fuses healthy (no permanent latch)', async () => {
    const cg = await indexedSeeded();
    let constructions = 0;
    setQueryProviderFactory(() => {
      constructions++;
      // First init fails (rejects on embed); every later construction succeeds — the
      // reset must let construction RE-ATTEMPT rather than latch the failed slot.
      return constructions === 1
        ? rejectingEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS)
        : constEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS);
    });

    // First acquisition hits the failing provider: RESOLVES (never rejects) and records
    // the failure so the cache-cold query reports `embed-failure`, not `warming`.
    await expect(cg.acquireQueryVectorForSearch(DEGRADE_QUERY)).resolves.toEqual({
      vector: null,
      model: null,
    });
    const first = searchDetailed(cg, DEGRADE_QUERY, { mode: 'hybrid' });
    expect(first.degradation).toBe('embed-failure');

    // Re-acquire: the init-failure reset returned the slot to UNINITIALIZED, so
    // construction re-attempts (succeeds now) and the query vector caches.
    const reacq = await cg.acquireQueryVectorForSearch(DEGRADE_QUERY);
    expect(reacq.vector).not.toBeNull();
    expect(reacq.model).toBe(FIXTURE_MODEL);

    // The reset invariant: a recovered provider fuses healthy (degradation null) — the
    // failed init is NOT latched permanently.
    const healthy = searchDetailed(cg, DEGRADE_QUERY, { mode: 'hybrid' });
    expect(healthy.degradation).toBeNull();
    expect(healthy.results.some((r) => r.node.name === 'parseConfig')).toBe(true);
    expect(constructions).toBeGreaterThanOrEqual(2); // reconstructed, not latched
  });

  it('c. a persistently-failing provider never wedges — every query resolves {null,null} + `embed-failure`, no throw', async () => {
    const cg = await indexedSeeded();
    let constructions = 0;
    setQueryProviderFactory(() => {
      constructions++;
      return rejectingEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS);
    });

    for (let i = 0; i < 3; i++) {
      await expect(cg.acquireQueryVectorForSearch(DEGRADE_QUERY)).resolves.toEqual({
        vector: null,
        model: null,
      });
      let detailed!: SearchNodesDetailed;
      expect(() => {
        detailed = searchDetailed(cg, DEGRADE_QUERY, { mode: 'hybrid' });
      }).not.toThrow();
      expect(detailed.degradation).toBe('embed-failure');
    }

    // Each failed attempt returned the slot to UNINITIALIZED, so later attempts
    // RE-ATTEMPTED construction — proof there is no permanent single latch and no wedge.
    expect(constructions).toBeGreaterThan(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T021 — embed-budget hard cap (~2s in production) + late-vector discard
// (FR-006/006a; spec Degradation, contract degradation-hints).
//
// The per-query embed wait is capped at EMBED_BUDGET_MS. When the embed does not
// resolve within the budget the acquisition RESOLVES to {vector:null,model:null}
// (never rejects), records an embed-failure so the synchronous search reports
// `embed-failure` (string 4), and — critically — a query-embed that completes AFTER
// its budget is DISCARDED: never written to the query-vector cache, never mutating
// matchType/provenance/order and never retroactively converting an already-returned
// keyword response to fused. The worst-case degraded latency is therefore bounded by
// keyword + budget, verifiable as an elapsed-time assertion (FR-006a).
//
// EMBED_BUDGET_MS stays the production constant (no env var, FR-007); a test-only
// budget override seam (`__setQueryEmbedBudgetMsForTests`) lets these tests use a
// ~30ms budget against a slow provider so they never literally wait 2s. The seam is
// reached through an optional-property cast (like the T020 factory seam) so its
// absence fails as a real ASSERTION — the RED carrier — rather than an ESM
// link-time collection error that would redden the whole file.
// ───────────────────────────────────────────────────────────────────────────
describe.skipIf(!HAS_SQLITE)('hybrid search — embed-budget cap + late-vector discard (T021)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];

  /** A free-text query keyword-reachable in the fixture AND embedded to parseConfig's basis 0. */
  const DEGRADE_QUERY = 'parse raw config text';

  /** Install the T021 budget override seam via optional-property cast (RED until T021 exports it). */
  function setQueryEmbedBudget(ms: number | undefined): void {
    const mod = CodeGraphIndex as unknown as {
      __setQueryEmbedBudgetMsForTests?: (ms: number | undefined) => void;
    };
    expect(typeof mod.__setQueryEmbedBudgetMsForTests).toBe('function'); // RED until T021
    mod.__setQueryEmbedBudgetMsForTests!(ms);
  }

  afterEach(() => {
    // Clear the budget seam without asserting so cleanup never masks a failure or leaks.
    (CodeGraphIndex as unknown as {
      __setQueryEmbedBudgetMsForTests?: (ms: number | undefined) => void;
    }).__setQueryEmbedBudgetMsForTests?.(undefined);
    __setQueryEmbeddingProviderForTests(undefined);
    __resetVectorMatrixCacheForTests();
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  /** A real, structurally-indexed fixture graph with matching-model vectors seeded. */
  async function indexedSeeded(): Promise<CodeGraph> {
    const dir = makeHybridFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    seedFixtureVectors(dir);
    return cg;
  }

  it('a. elapsed bound (FR-006a) — a provider hanging >> budget resolves within budget + epsilon to {null,null}', async () => {
    const cg = await indexedSeeded();
    const BUDGET = 40;
    setQueryEmbedBudget(BUDGET);
    // Embed would take ~3s; the budget must cap the wait far below that.
    const { provider } = slowEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS, 3000);
    __setQueryEmbeddingProviderForTests(provider);

    const start = performance.now();
    const acq = await cg.acquireQueryVectorForSearch(DEGRADE_QUERY);
    const elapsed = performance.now() - start;

    expect(acq).toEqual({ vector: null, model: null }); // capped → empty, never rejects
    // The FR-006a guarantee: degraded latency ≤ budget + small epsilon, NOT the ~3s embed.
    expect(elapsed).toBeLessThan(BUDGET + 500);
  });

  it('b. timeout degrades to keyword + `embed-failure` without throwing (FR-006)', async () => {
    const cg = await indexedSeeded();
    setQueryEmbedBudget(30);
    const { provider } = slowEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS, 2000);
    __setQueryEmbeddingProviderForTests(provider);

    // No-throw invariant: a budget timeout RESOLVES to the empty acquisition (SC-003).
    await expect(cg.acquireQueryVectorForSearch(DEGRADE_QUERY)).resolves.toEqual({
      vector: null,
      model: null,
    });

    const keyword = cg.searchNodes(DEGRADE_QUERY, { mode: 'keyword' });
    let detailed!: SearchNodesDetailed;
    expect(() => { detailed = searchDetailed(cg, DEGRADE_QUERY, { mode: 'hybrid' }); }).not.toThrow();
    expect(detailed.degradation).toBe('embed-failure'); // timeout counts as failure (string 4)
    expect(detailed.results).toEqual(keyword);
    expectDormantShape(detailed.results);
  });

  it('c. LATE-VECTOR DISCARD — a vector arriving AFTER its budget is never cached; the query stays degraded until a fresh acquisition', async () => {
    const cg = await indexedSeeded();
    setQueryEmbedBudget(30);
    // The embed resolves a VALID (cosine-1.0) vector at ~120ms — well after the 30ms budget.
    const slow = slowEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS, 120, /* basis */ 0);
    __setQueryEmbeddingProviderForTests(slow.provider);

    // Budget expires before the embed → keyword + embed-failure.
    await expect(cg.acquireQueryVectorForSearch(DEGRADE_QUERY)).resolves.toEqual({
      vector: null,
      model: null,
    });
    expect(searchDetailed(cg, DEGRADE_QUERY, { mode: 'hybrid' }).degradation).toBe('embed-failure');

    // Let the LOSING embed resolve; its valid vector arrives late and MUST be discarded.
    await new Promise((r) => setTimeout(r, 250));
    expect(slow.embedCalls()).toBe(1); // the embed genuinely ran and resolved

    // WITHOUT a fresh acquisition the query is STILL degraded: the late vector never
    // populated the cache — no retroactive keyword→fused conversion (FR-006).
    const stillDegraded = searchDetailed(cg, DEGRADE_QUERY, { mode: 'hybrid' });
    expect(stillDegraded.degradation).toBe('embed-failure');
    expectDormantShape(stillDegraded.results);

    // A fresh acquisition with a healthy provider (and the production budget) recovers:
    // the vector caches, the recorded failure clears, and the SAME query now fuses.
    setQueryEmbedBudget(undefined); // back to the ~2s production constant
    __setQueryEmbeddingProviderForTests(constEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS));
    const reacq = await cg.acquireQueryVectorForSearch(DEGRADE_QUERY);
    expect(reacq.vector).not.toBeNull();
    expect(reacq.model).toBe(FIXTURE_MODEL);

    const healthy = searchDetailed(cg, DEGRADE_QUERY, { mode: 'hybrid' });
    expect(healthy.degradation).toBeNull();
    expect(healthy.results.some((r) => r.node.name === 'parseConfig')).toBe(true);
  });

  it('d. a generous budget does NOT cap a healthy slow-but-in-time embed — it deposits and fuses', async () => {
    const cg = await indexedSeeded();
    setQueryEmbedBudget(1000); // comfortably above the embed delay → embed wins the race
    const slow = slowEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS, 60, 0);
    __setQueryEmbeddingProviderForTests(slow.provider);

    const acq = await cg.acquireQueryVectorForSearch(DEGRADE_QUERY);
    expect(acq.vector).not.toBeNull(); // in-budget embed deposited normally
    expect(acq.model).toBe(FIXTURE_MODEL);

    const healthy = searchDetailed(cg, DEGRADE_QUERY, { mode: 'hybrid' });
    expect(healthy.degradation).toBeNull();
    expect(healthy.results.some((r) => r.node.name === 'parseConfig')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T014 — US2 mode resolution (FR-002/002a; contract mcp-cli-surface, search-api;
// US2 scenarios 1–4).
//
// The retrieval mode a request runs under, and how the surfaces' `auto` default
// resolves. Two surfaces here:
//
//   • The PURE `auto`-resolution predicate `resolveAutoMode({providerConfigured,
//     matchingVectorCount})` — `hybrid` iff a provider is configured AND ≥1 stored
//     vector matches the active model, else `keyword`. This is the SAME availability
//     predicate FR-017's `codegraph status` line reports (research D1). T003 landed
//     it as a stub that ALWAYS returns `keyword`; T015 lands the real predicate — so
//     the predicate contract test below is the genuine RED carrier of this task.
//
//   • End-to-end mode behavior through `CodeGraph.searchNodes` /
//     `searchNodesDetailed`: explicit `keyword|semantic|hybrid` each run exactly
//     their arm config, and the surfaces' `auto` default behaves as HYBRID when the
//     corpus is healthy and as KEYWORD (with a `no-vectors` signal) when it is not.
//
// RED/GREEN ACCOUNTING (honest, per the T014 handoff): T019 already routed `auto`
// through the fusion/degradation path (healthy → hybrid; degraded → keyword +
// signal) and T012–T019 wired the semantic/hybrid arms, so the end-to-end scenario
// tests below are REGRESSION GUARDS that pass immediately ("RED-not-applicable —
// behavior landed in T019"). Each is written to be NON-VACUOUS: it asserts a
// concrete, arm-specific outcome (a decoy that FTS would add is absent from pure
// semantic; a both-arms node carries matchType 'both'; auto's fused output equals
// hybrid's; auto-without-vectors is byte-identical to keyword + carries the signal)
// that a keyword passthrough or a mis-wired arm would fail. Only the pure
// `resolveAutoMode` predicate test is genuine RED against the T003 stub.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Scenario-4 fixture: an EXACT-name symbol left WITHOUT a seeded vector next to a
 * semantic target that HAS one. `lookup`'s name exactly equals the query token
 * `lookup` (a keyword hit); `fetchRemoteValue` is the semantic target. The seeder
 * below deliberately skips `lookup`, so it is absent from the vector matrix and
 * therefore from any semantic top-k (US2 scenario 4).
 */
function makeExactNameFixture(dirs: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-hybrid-us2-exact-'));
  dirs.push(dir);
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);
  fs.writeFileSync(
    path.join(srcDir, 'store.ts'),
    // `lookup` — its name EXACTLY equals the query token "lookup"; left WITHOUT a
    // seeded vector below so it can only surface via the keyword (FTS) arm.
    'export function lookup(key: string): string {\n  return key;\n}\n' +
      // `fetchRemoteValue` — the semantic target; seeded at basis 0 (the query vector).
      'export function fetchRemoteValue(key: string): string {\n  return key;\n}\n',
  );
  return dir;
}

/**
 * Seed one one-hot fixture vector per embeddable node under FIXTURE_MODEL, EXCEPT
 * `skipName` (left with no vector). `targetName` gets basis 0 (cosine 1.0 to a
 * `constEmbedProvider` query vector); every other node gets a distinct orthogonal
 * filler basis. Mirrors the embed-pass scalars so the staleness probe reads a
 * non-zero matching-model count.
 */
function seedExactNameVectors(dir: string, targetName: string, skipName: string): void {
  const conn = DatabaseConnection.open(getDatabasePath(dir));
  try {
    const q = new QueryBuilder(conn.getDb());
    let filler = FILLER_BASIS_START;
    for (const node of q.selectEmbeddableNodesMissingVector(FIXTURE_MODEL)) {
      if (node.name === skipName) continue; // exact-name symbol left WITHOUT a vector
      const basis = node.name === targetName ? 0 : filler++;
      q.upsertNodeVector(node.id, FIXTURE_MODEL, FIXTURE_DIMS, encodeVector(unitVector(basis)), `us2-${node.id}`);
    }
    q.setMetadata('embedding_model', FIXTURE_MODEL);
    q.setMetadata('embedding_dims', String(FIXTURE_DIMS));
  } finally {
    conn.close();
  }
}

describe('hybrid search — US2 auto-resolution predicate (T014)', () => {
  // The pure FR-002 predicate contract — the ONE genuine RED carrier of T014. The
  // T003 stub ALWAYS returns 'keyword', so the healthy-corpus rows below fail until
  // T015 lands the real predicate. `auto` → `hybrid` iff (provider configured AND
  // ≥1 matching-model vector), else `keyword` — the SAME predicate as the FR-017
  // `codegraph status` availability line (research D1).
  it('resolveAutoMode → `hybrid` iff provider configured AND ≥1 matching vector, else `keyword` (FR-002)', () => {
    // hybrid ONLY when BOTH hold (RED against the stub, which returns 'keyword'):
    const bothHold: AutoResolveInput = { providerConfigured: true, matchingVectorCount: 1 };
    expect(resolveAutoMode(bothHold)).toBe('hybrid');
    expect(resolveAutoMode({ providerConfigured: true, matchingVectorCount: 42 })).toBe('hybrid');

    // keyword when EITHER condition is missing (these already hold against the stub):
    expect(resolveAutoMode({ providerConfigured: true, matchingVectorCount: 0 })).toBe('keyword');
    expect(resolveAutoMode({ providerConfigured: false, matchingVectorCount: 5 })).toBe('keyword');
    expect(resolveAutoMode({ providerConfigured: false, matchingVectorCount: 0 })).toBe('keyword');
  });
});

describe.skipIf(!HAS_SQLITE)('hybrid search — US2 mode behavior (T014)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];

  beforeEach(() => __setQueryEmbeddingProviderForTests(fixtureQueryProvider));

  afterEach(() => {
    __setQueryEmbeddingProviderForTests(undefined);
    __resetVectorMatrixCacheForTests();
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A real, structurally-indexed fixture graph with hand-seeded vectors + a warm query cache. */
  async function indexedFixture(): Promise<CodeGraph> {
    const dir = makeHybridFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    seedFixtureVectors(dir);
    for (const c of CASES) await cg.acquireQueryVectorForSearch(c.query); // warm each case's query vector
    return cg;
  }

  /** A structurally-indexed fixture with vectors seeded but the query cache left COLD (no warming). */
  async function indexedFixtureUnwarmed(seed?: (dir: string) => void): Promise<CodeGraph> {
    const dir = makeHybridFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    if (seed) seed(dir);
    return cg;
  }

  const names = (rs: SearchResult[]): string[] => rs.map((r) => r.node.name);

  const semanticCase = CASES.find((c) => c.semanticOnly)!; // 'S': backoffLoop / endpointHealthCheck decoy
  const bothArmsCase = CASES.find((c) => c.id === 'P1')!;  // parseConfig — keyword-reachable AND vector-affine

  // ── Scenario 1: explicit modes each run exactly their arm config ───────────

  it('explicit `keyword` runs the FTS arm ONLY, in dormant shape (no provenance) (FR-003, SC-004)', async () => {
    const cg = await indexedFixture();

    // The semantic-only case: FTS surfaces the DECOY (token-matches "endpoint") but
    // NOT the vector-only target — proof this is the keyword arm alone.
    const kw = cg.searchNodes(semanticCase.query, { mode: 'keyword' });
    expect(names(kw)).toContain(semanticCase.decoyName!);
    expect(names(kw)).not.toContain(semanticCase.targetName);
    expectDormantShape(kw); // dormant keyword shape — no matchType/fusedScore

    // Byte-identical to a call without the option (the FR-003 dormancy invariant).
    expect(kw).toEqual(cg.searchNodes(semanticCase.query));
  });

  it('explicit `semantic` runs the vector arm ONLY — surfaces the semantic-only target and OMITS the keyword decoy (FR-002a)', async () => {
    const cg = await indexedFixture();

    const sem = cg.searchNodes(semanticCase.query, { mode: 'semantic' });

    // The vector arm surfaces backoffLoop (cosine 1.0 to the query vector)…
    expect(names(sem)).toContain(semanticCase.targetName);
    // …and does NOT include the keyword-only decoy: its stored vector is orthogonal
    // to the query (a filler basis), so the pure semantic arm never surfaces it — the
    // non-vacuity anchor (a keyword passthrough WOULD return the decoy).
    expect(names(sem)).not.toContain(semanticCase.decoyName!);

    // Healthy fused (vector-only) result carries provenance; the sole hit is semantic-only.
    const detailed = searchDetailed(cg, semanticCase.query, { mode: 'semantic' });
    expect(detailed.degradation).toBeNull();
    expect(detailed.results.find((r) => r.node.name === semanticCase.targetName)?.matchType).toBe('semantic');
  });

  it("explicit `hybrid` fuses BOTH arms — a both-arms node carries matchType 'both' (FR-004/012)", async () => {
    const cg = await indexedFixture();

    const detailed = searchDetailed(cg, bothArmsCase.query, { mode: 'hybrid' });
    expect(detailed.degradation).toBeNull();

    // parseConfig is keyword-reachable ("parse" prefix) AND vector-affine (cosine 1.0)
    // → surfaced by BOTH arms → matchType 'both' with a rank-only fused score present.
    const target = detailed.results.find((r) => r.node.name === bothArmsCase.targetName);
    expect(target).toBeDefined();
    expect(target!.matchType).toBe('both');
    expect(typeof target!.fusedScore).toBe('number');
  });

  // ── Scenario 2: auto + matching vectors + warmed provider → behaves as HYBRID

  it('`auto` with matching-model vectors + a warmed provider behaves as HYBRID (fused, provenance present) (FR-002)', async () => {
    const cg = await indexedFixture();

    const auto = searchDetailed(cg, bothArmsCase.query, { mode: 'auto' });
    const hybrid = searchDetailed(cg, bothArmsCase.query, { mode: 'hybrid' });

    // Healthy: auto resolved to the hybrid arm — fused, provenance-tagged, not degraded.
    expect(auto.degradation).toBeNull();
    expect(auto.results.every((r) => r.matchType !== undefined)).toBe(true);
    const autoTarget = auto.results.find((r) => r.node.name === bothArmsCase.targetName);
    expect(autoTarget?.matchType).toBe('both');

    // auto behaves IDENTICALLY to explicit hybrid (same ordered names + provenance).
    expect(names(auto.results)).toEqual(names(hybrid.results));
    expect(auto.results.map((r) => r.matchType)).toEqual(hybrid.results.map((r) => r.matchType));
  });

  // ── Scenario 3: auto + no matching vectors → behaves as KEYWORD + signal ────

  it('`auto` with NO matching-model vectors behaves as KEYWORD (dormant results) AND reports the `no-vectors` signal (FR-002/015)', async () => {
    // Provider present (the beforeEach seam), but NO vectors seeded → the corpus is
    // unavailable, so auto must resolve to keyword. searchNodesDetailed additionally
    // reports the machine-readable reason (T019).
    const cg = await indexedFixtureUnwarmed(); // deliberately NOT seeded

    const keyword = cg.searchNodes(bothArmsCase.query, { mode: 'keyword' });
    expect(keyword.length).toBeGreaterThan(0); // the fixture actually matches

    // searchNodes → byte-identical keyword-shape results (dormant, no provenance).
    const auto = cg.searchNodes(bothArmsCase.query, { mode: 'auto' });
    expect(auto).toEqual(keyword);
    expectDormantShape(auto);

    // searchNodesDetailed → same dormant results PLUS the no-vectors signal.
    const detailed = searchDetailed(cg, bothArmsCase.query, { mode: 'auto' });
    expect(detailed.degradation).toBe('no-vectors');
    expect(detailed.results).toEqual(keyword);
    expectDormantShape(detailed.results);
  });

  // ── Scenario 4: semantic MAY omit an exact-name-only symbol not in the top-k

  it('`semantic` MAY omit an exact-name symbol that has no vector — present in keyword, ABSENT in semantic (US2 scenario 4)', async () => {
    const dir = makeExactNameFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    // Seed a vector for `fetchRemoteValue` (basis 0) but NOT for `lookup`.
    seedExactNameVectors(dir, 'fetchRemoteValue', 'lookup');
    // A provider that embeds any query to basis 0 (cosine 1.0 with fetchRemoteValue).
    __setQueryEmbeddingProviderForTests(constEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS));
    await cg.acquireQueryVectorForSearch('lookup'); // warm the query-vector cache

    // Keyword arm: `lookup` exactly matches the query token → present.
    const kw = cg.searchNodes('lookup', { mode: 'keyword' });
    expect(names(kw)).toContain('lookup');

    // Semantic arm: `lookup` has NO seeded vector → not in the matrix → absent from
    // the top-k, even though its NAME exactly matches the query. The vector target
    // (fetchRemoteValue) is surfaced instead — a healthy, non-degraded semantic result.
    const detailed = searchDetailed(cg, 'lookup', { mode: 'semantic' });
    expect(detailed.degradation).toBeNull();
    expect(names(detailed.results)).not.toContain('lookup');
    expect(names(detailed.results)).toContain('fetchRemoteValue');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T025 — US4 FR-014(b) dormancy GATE: keyword byte-stability + zero-embed-call
// (FR-003/003a, SC-004/SC-005; spec Assumptions "dormancy" rules).
//
// This is a GUARD gate over dormancy that ALREADY landed (T019 routes the keyword
// mode through a zero-touch early return in `searchNodesDetailed`; the fused path
// is unreachable for keyword / no-mode / internal callers). So MOST assertions
// PASS on first run — each carries a "RED-not-applicable" note stating the task
// that made it green, and every gate is proven NON-VACUOUS so a passing assertion
// is a real measurement, not a tautology:
//
//   1. BYTE-STABILITY (FR-014b/003/SC-004): `searchNodes(q)`, `searchNodes(q, {})`,
//      `searchNodes(q, {mode:'keyword'})`, and `searchNodesDetailed(q,{mode:
//      'keyword'}).results` are all structurally equal on ONE fixture graph, and —
//      the T025 value-add over T004/T018's `.toBeUndefined()` — every dormant row
//      carries NO `matchType`/`fusedScore` KEY (`'matchType' in r === false`, i.e.
//      absent, not present-but-undefined). Non-vacuity: a fused row DOES carry the
//      key (`'matchType' in r === true`), so the `in` operator genuinely discriminates.
//
//   2. ZERO-EMBED / ZERO-CONSTRUCTION (FR-003a): with a counting FACTORY spy
//      installed (`__setQueryEmbeddingProviderFactoryForTests` — counts provider
//      constructions; its provider's `embed` counts embed calls), every keyword
//      surface AND the internal-caller shapes (`searchNodes(q)` with no mode,
//      `buildContext`) leave BOTH counters at 0. Non-vacuity: the SAME spy on the
//      fused (hybrid) path counts ≥1 construction AND ≥1 embed — so the zeros above
//      are a real measurement of a wired-and-observed seam, not a dead spy.
//
//   3. NO matrix build / staleness probe on the keyword path: there is no clean
//      public observable for "matrix built" / "probe ran" without adding a NEW seam
//      (documented coverage boundary). It is bounded by the construction proxy:
//      `runFusedSearch` resolves the provider BEFORE it ever probes staleness or
//      builds the matrix, so a construction count of 0 proves `runFusedSearch`
//      (hence probe + build) was never entered — even with a live corpus present.
//
// The gate FAILS (surfacing a genuine dormancy regression) if a future change ever
// routes a keyword/no-mode/internal call through the fused path: a leaked
// `matchType`/`fusedScore` key, a non-zero embed, or a non-zero provider construction.
// ───────────────────────────────────────────────────────────────────────────
describe.skipIf(!HAS_SQLITE)('hybrid search — FR-014(b) dormancy gate (T025)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];

  /** Free-text query keyword-reachable in the fixture (`parse` prefixes `parseConfig`) → non-empty keyword hits. */
  const QUERY = 'parse';
  /** Free-text + basis-0 query (embeds to `parseConfig`'s seeded vector) — the fused-path driver. */
  const FUSE_QUERY = 'parse raw config text';

  /**
   * Install the counting provider-FACTORY seam via an optional-property cast (the
   * same pattern T020 uses — no hard import dependency). The seam landed in T020, so
   * the presence assertion PASSES here; it stays as a guard that the seam still exists.
   */
  function setQueryProviderFactory(factory: (() => EmbeddingProvider) | undefined): void {
    const mod = CodeGraphIndex as unknown as {
      __setQueryEmbeddingProviderFactoryForTests?: (f: (() => EmbeddingProvider) | undefined) => void;
    };
    expect(typeof mod.__setQueryEmbeddingProviderFactoryForTests).toBe('function');
    mod.__setQueryEmbeddingProviderFactoryForTests!(factory);
  }

  /**
   * A counting spy behind the factory seam: the factory increments `constructions`
   * on each provider construction, and the constructed provider's `embed` increments
   * `embeds` per embed call. It embeds ANY text to basis 0 (cosine 1.0 with the
   * `parseConfig` vector `seedFixtureVectors` seeds), so the fused path genuinely
   * fuses when it runs — making the non-vacuity counts real, not incidental.
   */
  function countingSpy(): {
    factory: () => EmbeddingProvider;
    constructions: () => number;
    embeds: () => number;
  } {
    let constructions = 0;
    let embeds = 0;
    const factory = (): EmbeddingProvider => {
      constructions++;
      return {
        id: FIXTURE_MODEL,
        dims: FIXTURE_DIMS,
        async embed(texts: string[]): Promise<Float32Array[]> {
          embeds++;
          return texts.map(() => unitVector(0));
        },
      };
    };
    return { factory, constructions: () => constructions, embeds: () => embeds };
  }

  afterEach(() => {
    // Clear the factory seam without asserting so cleanup never masks a failure or leaks.
    (CodeGraphIndex as unknown as {
      __setQueryEmbeddingProviderFactoryForTests?: (f: (() => EmbeddingProvider) | undefined) => void;
    }).__setQueryEmbeddingProviderFactoryForTests?.(undefined);
    __setQueryEmbeddingProviderForTests(undefined); // never leak the fixed-instance seam
    __resetVectorMatrixCacheForTests();
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  /** A real, structurally-indexed fixture graph; `seed` optionally hand-seeds vectors/metadata. */
  async function indexed(seed?: (dir: string) => void): Promise<CodeGraph> {
    const dir = makeHybridFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    if (seed) seed(dir);
    return cg;
  }

  // ── (1) BYTE-STABILITY + new-field ABSENCE (RED-not-applicable — landed T004/T019) ──
  it(
    'byte-stability — every keyword call shape is structurally identical AND carries NO matchType/fusedScore key (FR-014b/003, SC-004)',
    async () => {
      // Structural-only fixture: no vectors, no provider seam. The keyword path is
      // env-independent (it never resolves a provider), so ambient CODEGRAPH_EMBEDDING_*
      // cannot perturb this — no scrub needed on the keyword surfaces.
      const cg = await indexed();

      const base: SearchResult[] = cg.searchNodes(QUERY);                       // call "without the option"
      const withEmptyOpts: SearchResult[] = cg.searchNodes(QUERY, {});          // options present, mode omitted
      const explicitKeyword: SearchResult[] = cg.searchNodes(QUERY, { mode: 'keyword' });
      const detailed: SearchNodesDetailed = cg.searchNodesDetailed(QUERY, { mode: 'keyword' });

      // The fixture genuinely matches ≥1 symbol (parseConfig) so the deep-equals bind
      // to a real, non-empty array rather than passing vacuously on [].
      expect(base.length).toBeGreaterThan(0);

      // Structural deep-equal across every pre-feature-equivalent shape.
      expect(withEmptyOpts).toEqual(base);
      expect(explicitKeyword).toEqual(base);
      expect(detailed.results).toEqual(base);
      expect(detailed.degradation).toBeNull(); // keyword is never degraded

      // The T025 value-add: ABSENCE of the new provenance keys — NOT merely undefined.
      // A dormant keyword row has no such key at all; `!(k in r)` is the strict check.
      for (const arr of [base, withEmptyOpts, explicitKeyword, detailed.results]) {
        for (const r of arr) {
          expect('matchType' in r).toBe(false);
          expect('fusedScore' in r).toBe(false);
        }
      }
    },
    30_000,
  );

  it(
    'non-vacuity of the absence check — a FUSED row DOES carry matchType/fusedScore keys, so `in` discriminates (FR-012/014b)',
    async () => {
      // Seed matching-model vectors so a hybrid query truly fuses. The SAME `'k' in r`
      // operator that reads FALSE on every dormant row above must read TRUE here — else
      // the absence assertions would be a vacuous check against a key nothing ever sets.
      const cg = await indexed((dir) => seedFixtureVectors(dir));
      __setQueryEmbeddingProviderForTests(constEmbedProvider(FIXTURE_MODEL, FIXTURE_DIMS));
      await cg.acquireQueryVectorForSearch(FUSE_QUERY); // warm the query-vector cache

      const detailed = cg.searchNodesDetailed(FUSE_QUERY, { mode: 'hybrid' });
      expect(detailed.degradation).toBeNull(); // genuinely fused, not degraded
      const target = detailed.results.find((r) => r.node.name === 'parseConfig');
      expect(target).toBeDefined();
      expect('matchType' in target!).toBe(true);   // fused rows carry the key…
      expect('fusedScore' in target!).toBe(true);   // …both of them
      expect(target!.matchType).toBe('both');
      expect(typeof target!.fusedScore).toBe('number');
    },
    30_000,
  );

  // ── (2) ZERO-EMBED / ZERO-CONSTRUCTION on keyword + internal-caller paths ──
  it(
    'zero embed AND zero provider construction on every keyword surface incl. internal callers (FR-003a/014b, SC-005)',
    async () => {
      // Install ONLY the counting factory (fixed-instance seam left unset). The factory
      // wins over env inside `constructQueryEmbeddingProvider`, so this is env-hermetic:
      // if any keyword surface DID resolve a provider, the counter would catch it.
      const cg = await indexed();
      const spy = countingSpy();
      setQueryProviderFactory(spy.factory);

      // (a) Explicit keyword-mode surfaces.
      cg.searchNodes(QUERY, { mode: 'keyword' });
      cg.searchNodesDetailed(QUERY, { mode: 'keyword' });

      // (b) Internal-caller simulation: pre-feature call shapes that default to keyword,
      // plus `buildContext` (runs its own FTS + graph expansion — never the query embed).
      cg.searchNodes(QUERY);        // no options → keyword default
      cg.searchNodes(QUERY, {});    // options present, mode omitted → keyword default
      await cg.buildContext('parse config');

      expect(spy.embeds()).toBe(0);        // FR-003a: keyword pays zero embed latency
      expect(spy.constructions()).toBe(0); // no provider is ever constructed on these paths
    },
    30_000,
  );

  // ── (2) NON-VACUITY: the SAME spy COUNTS on the fused path ──
  it(
    'non-vacuity — the SAME counting spy records ≥1 construction and ≥1 embed on the fused path (proves the keyword zeros are real measurements)',
    async () => {
      const cg = await indexed((dir) => seedFixtureVectors(dir)); // matching-model vectors present
      const spy = countingSpy();
      setQueryProviderFactory(spy.factory);

      // The realistic fused flow the async surfaces (MCP/CLI) run: warm the query vector
      // (the embed + the single-owner provider construction happen HERE), then search.
      const acq = await cg.acquireQueryVectorForSearch(FUSE_QUERY);
      expect(acq.vector).not.toBeNull();
      expect(acq.model).toBe(FIXTURE_MODEL);

      // The spy genuinely measures BOTH counters on the fused path — so the 0/0 on the
      // keyword paths above is a live measurement of a wired seam, not a dead spy.
      expect(spy.constructions()).toBeGreaterThanOrEqual(1);
      expect(spy.embeds()).toBeGreaterThanOrEqual(1);

      // And the hybrid search actually fuses using that vector (provenance present).
      const detailed = cg.searchNodesDetailed(FUSE_QUERY, { mode: 'hybrid' });
      expect(detailed.degradation).toBeNull();
      expect(detailed.results.some((r) => r.matchType !== undefined)).toBe(true);
    },
    30_000,
  );

  // ── (3) Keyword builds no matrix / runs no staleness probe (construction proxy) ──
  it(
    'keyword does no matrix build / staleness probe — proven via the construction proxy even with a LIVE corpus (FR-003a; documented coverage boundary)',
    async () => {
      // Vectors ARE present: a hybrid query here WOULD probe staleness and build the
      // matrix (proven by the non-vacuity test above). A keyword query must touch none
      // of it. There is no clean public observable for "matrix built" / "probe ran"
      // without adding a NEW seam (the documented coverage boundary), so both are
      // bounded by the construction proxy: `runFusedSearch` resolves the provider
      // BEFORE it probes or builds, so a construction count of 0 proves `runFusedSearch`
      // — and therefore the probe + matrix build — was never entered.
      const cg = await indexed((dir) => seedFixtureVectors(dir));
      const spy = countingSpy();
      setQueryProviderFactory(spy.factory);
      __resetVectorMatrixCacheForTests(); // ensure no resident matrix leaks in from setup

      cg.searchNodes(QUERY, { mode: 'keyword' });
      cg.searchNodesDetailed(QUERY, { mode: 'keyword' });
      cg.searchNodes(QUERY); // no-mode default keyword

      expect(spy.constructions()).toBe(0); // provider never resolved ⟹ probe + matrix build never reached
      expect(spy.embeds()).toBe(0);
    },
    30_000,
  );
});

// ───────────────────────────────────────────────────────────────────────────
// T027 — US4 filter-parity gate: `kind:`, `lang:`, `path:`, `name:` produce
// IDENTICAL FILTERING SEMANTICS across keyword, semantic, and hybrid modes
// (FR-016 / FR-010 / US4 scenario 3; SC-004).
//
// This is a GUARD gate over filtering behavior that ALREADY landed, wired at three
// distinct sites that must AGREE:
//   • keyword: `queries.searchNodes` parses all four filters — kind:/lang: narrow the
//     FTS candidate set; path:/name: are post-scoring HARD gates (T009/queries).
//   • semantic/hybrid pre-filter: kind:/lang: (query filters ∪ options) PRE-filter the
//     cosine scan inside `semanticTopK` BEFORE top-k (T010) — so a filtered row never
//     even enters the vector arm's candidate pool.
//   • semantic/hybrid post-gate: path:/name: are POST-fusion hard gates inside
//     `rrfMerge`, dropping BOTH keyword-arm rows and semantic-only rows (via the
//     caller-supplied gateFields) AFTER fusion, BEFORE the slice (T011).
//
// So most assertions PASS on first run (RED-not-applicable: T009–T011 landed the three
// sites; this gate proves they agree). A FAILURE here is a genuine parity bug — the
// three sites diverged — and must be reported, not patched around.
//
// NON-VACUITY is proven per filter, so parity is never satisfied by trivially-empty
// sets: (b) each filter is shown to EXCLUDE at least one node the unfiltered variant
// returns, in keyword AND a fused mode; (c) kind:/lang: exclude a semantic-ONLY target
// from the FUSED result under the filter while it appears without it — proving the
// pre-filter reaches the vector arm; (d) path:/name: drop a fused hit (keyword-arm AND
// semantic-only) failing the gate in hybrid EXACTLY as in keyword. A fixture-sanity
// test asserts the fused path is HEALTHY (degradation === null, the vector arm ran) so
// the whole comparison is a real fusion, not a degraded keyword passthrough.
//
// Fused comparisons use the in-process query-provider seam (never ambient env), so no
// env scrub is needed — with the seam SET, production env-config resolution is bypassed.
// ───────────────────────────────────────────────────────────────────────────

/**
 * A mixed-kind / mixed-language / mixed-path corpus for the four filter axes. Each
 * filter's "stem" is keyword-reachable by MULTIPLE symbols spanning the two sides of
 * the filter (so the filtered variant excludes something — non-vacuity), plus one
 * semantic-ONLY reach-through target whose name shares NO FTS token with the stem and
 * whose kind/lang/path/name lands on the EXCLUDED side of the filter.
 */
function makeParityFixture(dirs: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-hybrid-parity-'));
  dirs.push(dir);
  const apiDir = path.join(dir, 'src', 'api');
  const dbDir = path.join(dir, 'src', 'db');
  const workerDir = path.join(dir, 'src', 'worker');
  fs.mkdirSync(apiDir, { recursive: true });
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(workerDir, { recursive: true });

  // src/api/router.ts — typescript, path contains "api". Mixed kinds behind the
  // "kindle" stem (function + class), plus the typescript/api/name-satisfying arms of
  // the other three stems, plus the kind: reach-through semantic target `MuffledBeacon`
  // (a CLASS with no keyword tie to any stem).
  fs.writeFileSync(
    path.join(apiDir, 'router.ts'),
    [
      '/** Kindles a routing session (function, keyword-reachable via "kindle"). */',
      'export function kindleRoute(p: string): string {\n  return p;\n}',
      '/** A reader over the kindle table (class, keyword-reachable via "kindle"). */',
      'export class KindleReader {\n  open(): void {}\n}',
      '/** A muffled beacon (class) — neutral doc text, no free-text tie to any stem. */',
      'export class MuffledBeacon {\n  ping(): void {}\n}',
      '/** typescript arm of the lang: stem "harvest". */',
      'export function harvestConfigTs(): void {}',
      '/** api-path arm of the path: stem "vault". */',
      'export function vaultReadApi(): void {}',
      '/** name:emit-SATISFYING arm of the name: stem "signal". */',
      'export function signalEmitLoud(): void {}',
      '/** name:emit-FAILING arm of the name: stem "signal". */',
      'export function signalMuteQuiet(): void {}',
      '',
    ].join('\n'),
  );

  // src/db/store.ts — typescript, path contains "db". The db-path arm of the path:
  // stem, plus the path:/name: reach-through semantic targets (names with no "vault"
  // and no "signal"/"emit").
  fs.writeFileSync(
    path.join(dbDir, 'store.ts'),
    [
      '/** db-path arm of the path: stem "vault". */',
      'export function vaultReadDb(): void {}',
      '/** A quiet ledger accessor in db/ — neutral doc text (path reach-through target). */',
      'export function hushedLedgerDb(): void {}',
      '/** A muffled gloom accessor — neutral doc text (name reach-through target). */',
      'export function whisperGloom(): void {}',
      '',
    ].join('\n'),
  );

  // src/worker/pipeline.py — python. The python arm of the lang: stem, plus the lang:
  // reach-through semantic target (a python function, excluded by lang:typescript).
  fs.writeFileSync(
    path.join(workerDir, 'pipeline.py'),
    [
      '# python arm of the lang: stem "harvest".',
      'def harvest_config_py():',
      '    return 1',
      '',
      '# A background reaper task in python — neutral doc text (lang reach-through target).',
      'def quiet_reaper_py():',
      '    return 2',
      '',
    ].join('\n'),
  );

  return dir;
}

/** Semantic-only reach-through targets → their one-hot basis (matches PARITY_BASIS below). */
const PARITY_TARGET_BASIS = new Map<string, number>([
  ['MuffledBeacon', 0],   // kind: stem "kindle" (a class → excluded by kind:function)
  ['quiet_reaper_py', 1], // lang: stem "harvest" (python → excluded by lang:typescript)
  ['hushedLedgerDb', 2],  // path: stem "vault"   (db/ path → excluded by path:api)
  ['whisperGloom', 3],    // name: stem "signal"  (no "emit" → excluded by name:emit)
]);

/** Each parity stem's filter-stripped text → the basis its semantic-only target is seeded at. */
const PARITY_BASIS: Record<string, number> = { kindle: 0, harvest: 1, vault: 2, signal: 3 };

/**
 * A query provider mapping each parity stem's filter-stripped text to its target's
 * one-hot basis (cosine 1.0). Any other text → an orthogonal filler basis (cosine 0)
 * so an unexpected embed can never fabricate a semantic hit.
 */
const parityQueryProvider: EmbeddingProvider = {
  id: FIXTURE_MODEL,
  dims: FIXTURE_DIMS,
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const basis = PARITY_BASIS[t.trim()];
      return unitVector(basis === undefined ? FILLER_BASIS_START : basis);
    });
  },
};

/**
 * Seed one one-hot vector per embeddable node under FIXTURE_MODEL: a reach-through
 * target gets its mapped basis (cosine 1.0 to its stem's query vector); every other
 * node gets a distinct filler basis (orthogonal to all query vectors → never surfaces
 * in the semantic arm). Mirrors the embed-pass metadata scalars.
 */
function seedParityVectors(dir: string): void {
  const conn = DatabaseConnection.open(getDatabasePath(dir));
  try {
    const q = new QueryBuilder(conn.getDb());
    let filler = FILLER_BASIS_START;
    for (const node of q.selectEmbeddableNodesMissingVector(FIXTURE_MODEL)) {
      const basis = PARITY_TARGET_BASIS.has(node.name)
        ? PARITY_TARGET_BASIS.get(node.name)!
        : filler++;
      q.upsertNodeVector(node.id, FIXTURE_MODEL, FIXTURE_DIMS, encodeVector(unitVector(basis)), `parity-${node.id}`);
    }
    q.setMetadata('embedding_model', FIXTURE_MODEL);
    q.setMetadata('embedding_dims', String(FIXTURE_DIMS));
  } finally {
    conn.close();
  }
}

describe.skipIf(!HAS_SQLITE)('hybrid search — filter parity across modes (T027)', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];

  // Fused comparisons run through the in-process seam (never ambient env): with the
  // seam SET, production env-config resolution is bypassed, so no env scrub is needed.
  beforeEach(() => __setQueryEmbeddingProviderForTests(parityQueryProvider));

  afterEach(() => {
    __setQueryEmbeddingProviderForTests(undefined);
    __resetVectorMatrixCacheForTests();
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A real, structurally-indexed parity fixture with seeded vectors + a warm query cache. */
  async function indexedParity(): Promise<CodeGraph> {
    const dir = makeParityFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    seedParityVectors(dir);
    // Warm each stem's query vector — the async surfaces await this before the sync
    // fusion path reads the cached vector (mirrors US1 acceptance scenario 1's "warmed
    // provider" precondition). Each filtered/unfiltered variant strips to the bare stem.
    for (const stem of Object.keys(PARITY_BASIS)) await cg.acquireQueryVectorForSearch(stem);
    return cg;
  }

  const ALL_MODES: SearchMode[] = ['keyword', 'semantic', 'hybrid'];
  const FUSED_MODES: SearchMode[] = ['semantic', 'hybrid'];

  /** Result node list for `query` under `mode`. */
  const nodesFor = (cg: CodeGraph, query: string, mode: SearchMode): Node[] =>
    cg.searchNodes(query, { mode }).map((r) => r.node);
  const namesFor = (cg: CodeGraph, query: string, mode: SearchMode): string[] =>
    nodesFor(cg, query, mode).map((n) => n.name);

  // ── fixture sanity — the fused path is HEALTHY, so parity is non-vacuous ─────
  it('fixture sanity — the fused path is HEALTHY (vector arm ran, not a degraded keyword passthrough)', async () => {
    const cg = await indexedParity();

    // A degraded passthrough would make every "parity" comparison trivially true
    // (all modes == keyword). Assert the vector arm genuinely ran: no degradation AND
    // the semantic-only target (unreachable by keyword) is present under hybrid.
    const detailed = searchDetailed(cg, 'kindle', { mode: 'hybrid' });
    expect(detailed.degradation).toBeNull();
    expect(detailed.results.map((r) => r.node.name)).toContain('MuffledBeacon');

    // And the semantic-only targets are keyword-INVISIBLE (proves they can only enter
    // via the vector arm — the premise of the reach-through checks below).
    for (const [name, basis] of PARITY_TARGET_BASIS) {
      const stem = Object.keys(PARITY_BASIS).find((s) => PARITY_BASIS[s] === basis)!;
      expect(namesFor(cg, stem, 'keyword')).not.toContain(name);
    }
  }, 30_000);

  // ── kind: — pre-filters BOTH the keyword candidate set AND the vector scan ───
  it('kind: filters identically in keyword, semantic, and hybrid — and pre-filters the vector arm (FR-016/FR-010)', async () => {
    const cg = await indexedParity();
    const FILTERED = 'kind:function kindle';
    const UNFILTERED = 'kindle';
    const satisfies = (n: Node): boolean => n.kind === 'function';

    // (a) every returned node satisfies kind:function in EVERY mode.
    for (const mode of ALL_MODES) {
      expect(nodesFor(cg, FILTERED, mode).every(satisfies)).toBe(true);
    }

    // (b) non-vacuity — the unfiltered variant returns a non-function that the filter
    // excludes, in keyword AND hybrid (a real narrowing, not an empty-set no-op).
    expect(namesFor(cg, UNFILTERED, 'keyword')).toContain('KindleReader'); // class
    expect(namesFor(cg, FILTERED, 'keyword')).not.toContain('KindleReader');
    expect(namesFor(cg, UNFILTERED, 'hybrid')).toContain('KindleReader');
    expect(namesFor(cg, FILTERED, 'hybrid')).not.toContain('KindleReader');

    // (c) the kind: pre-filter REACHES the vector arm: the semantic-only target
    // `MuffledBeacon` (a class) appears in the FUSED result unfiltered, and is EXCLUDED
    // under kind:function — so it never even entered the cosine scan.
    for (const mode of FUSED_MODES) {
      expect(namesFor(cg, UNFILTERED, mode)).toContain('MuffledBeacon');
      expect(namesFor(cg, FILTERED, mode)).not.toContain('MuffledBeacon');
    }
  }, 30_000);

  // ── lang: — pre-filters BOTH arms; a cross-language vector target is excluded ─
  it('lang: filters identically in keyword, semantic, and hybrid — and pre-filters the vector arm (FR-016/FR-010)', async () => {
    const cg = await indexedParity();
    const FILTERED = 'lang:typescript harvest';
    const UNFILTERED = 'harvest';
    const satisfies = (n: Node): boolean => n.language === 'typescript';

    // (a) every returned node is typescript in EVERY mode.
    for (const mode of ALL_MODES) {
      expect(nodesFor(cg, FILTERED, mode).every(satisfies)).toBe(true);
    }

    // (b) non-vacuity — the python arm is returned unfiltered and excluded by the
    // filter, in keyword AND hybrid.
    expect(namesFor(cg, UNFILTERED, 'keyword')).toContain('harvest_config_py'); // python
    expect(namesFor(cg, FILTERED, 'keyword')).not.toContain('harvest_config_py');
    expect(namesFor(cg, UNFILTERED, 'hybrid')).toContain('harvest_config_py');
    expect(namesFor(cg, FILTERED, 'hybrid')).not.toContain('harvest_config_py');

    // (c) the lang: pre-filter reaches the vector arm: the semantic-only python target
    // `quiet_reaper_py` appears in the FUSED result unfiltered, EXCLUDED under
    // lang:typescript before it could consume a top-k slot.
    for (const mode of FUSED_MODES) {
      expect(namesFor(cg, UNFILTERED, mode)).toContain('quiet_reaper_py');
      expect(namesFor(cg, FILTERED, mode)).not.toContain('quiet_reaper_py');
    }
  }, 30_000);

  // ── path: — a POST-fusion hard gate; drops keyword-arm AND semantic-only rows ─
  it('path: filters identically in keyword, semantic, and hybrid — post-gating both fused arms (FR-016/FR-010)', async () => {
    const cg = await indexedParity();
    const FILTERED = 'path:api vault';
    const UNFILTERED = 'vault';
    const satisfies = (n: Node): boolean => n.filePath.toLowerCase().includes('api');

    // (a) every returned node's path contains "api" in EVERY mode.
    for (const mode of ALL_MODES) {
      expect(nodesFor(cg, FILTERED, mode).every(satisfies)).toBe(true);
    }

    // (b) non-vacuity — the db-path arm is returned unfiltered and gated out, in keyword
    // AND hybrid.
    expect(namesFor(cg, UNFILTERED, 'keyword')).toContain('vaultReadDb'); // src/db/…
    expect(namesFor(cg, FILTERED, 'keyword')).not.toContain('vaultReadDb');
    expect(namesFor(cg, UNFILTERED, 'hybrid')).toContain('vaultReadDb');
    expect(namesFor(cg, FILTERED, 'hybrid')).not.toContain('vaultReadDb');

    // (d) a FUSED hit failing the path gate is dropped in HYBRID exactly as in keyword:
    //   • the SEMANTIC-ONLY db target `hushedLedgerDb` — present in hybrid unfiltered,
    //     dropped under path:api (post-gates the vector-arm row via gateFields);
    //   • the KEYWORD-arm db row `vaultReadDb` — dropped in BOTH keyword and hybrid.
    expect(namesFor(cg, UNFILTERED, 'hybrid')).toContain('hushedLedgerDb');
    expect(namesFor(cg, FILTERED, 'hybrid')).not.toContain('hushedLedgerDb');
    // …while the surviving api-path node is kept identically in keyword and hybrid.
    expect(namesFor(cg, FILTERED, 'keyword')).toContain('vaultReadApi');
    expect(namesFor(cg, FILTERED, 'hybrid')).toContain('vaultReadApi');
  }, 30_000);

  // ── name: — a POST-fusion hard gate; drops keyword-arm AND semantic-only rows ─
  it('name: filters identically in keyword, semantic, and hybrid — post-gating both fused arms (FR-016/FR-010)', async () => {
    const cg = await indexedParity();
    const FILTERED = 'name:emit signal';
    const UNFILTERED = 'signal';
    const satisfies = (n: Node): boolean => n.name.toLowerCase().includes('emit');

    // (a) every returned node's name contains "emit" in EVERY mode.
    for (const mode of ALL_MODES) {
      expect(nodesFor(cg, FILTERED, mode).every(satisfies)).toBe(true);
    }

    // (b) non-vacuity — the emit-less keyword arm `signalMuteQuiet` is returned
    // unfiltered and gated out, in keyword AND hybrid.
    expect(namesFor(cg, UNFILTERED, 'keyword')).toContain('signalMuteQuiet');
    expect(namesFor(cg, FILTERED, 'keyword')).not.toContain('signalMuteQuiet');
    expect(namesFor(cg, UNFILTERED, 'hybrid')).toContain('signalMuteQuiet');
    expect(namesFor(cg, FILTERED, 'hybrid')).not.toContain('signalMuteQuiet');

    // (d) a FUSED hit failing the name gate is dropped in HYBRID exactly as in keyword:
    //   • the SEMANTIC-ONLY target `whisperGloom` (no "emit") — present in hybrid
    //     unfiltered, dropped under name:emit (post-gates the vector-arm row);
    //   • the surviving `signalEmitLoud` is kept identically in keyword and hybrid.
    expect(namesFor(cg, UNFILTERED, 'hybrid')).toContain('whisperGloom');
    expect(namesFor(cg, FILTERED, 'hybrid')).not.toContain('whisperGloom');
    expect(namesFor(cg, FILTERED, 'keyword')).toContain('signalEmitLoud');
    expect(namesFor(cg, FILTERED, 'hybrid')).toContain('signalEmitLoud');
  }, 30_000);
});
