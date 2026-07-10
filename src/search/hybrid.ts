/**
 * Hybrid semantic search — query-vector acquisition, the in-memory vector
 * matrix cache, a cosine top-k scan, and the rank-only RRF merge with the
 * keyword arm (SPEC-003).
 *
 * This module owns ALL new hybrid/semantic logic; every existing surface
 * (`src/index.ts`, `src/db/queries.ts`, `src/mcp/tools.ts`, `src/bin/codegraph.ts`)
 * gains plumbing only and defaults to today's byte-identical keyword behavior
 * (FR-001/003, Constitution III). With no vectors and no provider the whole
 * feature is dormant (Constitution VII + Dogfooding law; SC-004).
 *
 * ── Tuning is internal, not configurable (FR-007) ──────────────────────────
 * The embed budget, RRF constant, candidate depth, memory ceiling, and the
 * fixture PRNG seed are internal DOCUMENTED constants — never environment
 * variables and never user-facing knobs. They live here, next to the code
 * they govern, so there is exactly one place to read their rationale.
 *
 * ── Resident memory of the matrix cache (FR-009 / FR-009c) ─────────────────
 * The KNN scan runs against a lazily built, single-precision (`Float32Array`)
 * in-memory matrix of every stored vector whose model matches the active
 * provider (research D6/D7). Its resident cost is exactly:
 *
 *     resident bytes = count × dims × 4        (4 bytes per f32 element)
 *
 * held ONCE per project in the daemon main process — never duplicated per
 * query worker (research D7). Worked envelope:
 *
 *   - bundled ONNX corpus   50k × 384  × 4 ≈  77 MB   (typical)
 *   - documented corner     50k × 3584 × 4 ≈ 717 MB   (large-dim boundary
 *                                                       where quantization/ANN
 *                                                       becomes the named
 *                                                       follow-up)
 *   - guard ceiling         MAX_MATRIX_BYTES = 1 GiB   (sits ABOVE the 717 MB
 *                                                       corner; a predicted
 *                                                       build over it is
 *                                                       skipped → keyword,
 *                                                       FR-009c)
 */

import type { Language, NodeKind, SearchMode, SearchResult } from '../types';
import type { QueryBuilder } from '../db/queries';
import { decodeVector } from '../embeddings/indexer-hook';
import { parseQuery } from './query-parser';
import type { EmbeddingProvider } from '../embeddings/provider';

/**
 * Coerce a possibly-untyped `mode` to a known library retrieval arm (FR-001/003,
 * contract search-api). The library default is `keyword`; any unknown /
 * out-of-enum value — a JS caller reaching past the union with `as any` — coerces
 * to `keyword` and NEVER throws or error-shapes. TypeScript callers cannot reach
 * the coercion (the `SearchMode` union rejects an unknown value at compile time);
 * this guard exists solely for untyped callers. Resolving here up front is what
 * keeps an unknown value from ever reaching a semantic/hybrid arm once those land
 * (T012) — the arms branch on the RESOLVED mode, never the raw option.
 *
 * NOTE: surface-level (MCP tool / CLI) unknown values coerce to `auto` instead —
 * their own default — handled at those surfaces, not here (see mcp-cli-surface).
 */
export function resolveLibrarySearchMode(mode: SearchMode | undefined): SearchMode {
  switch (mode) {
    case 'keyword':
    case 'semantic':
    case 'hybrid':
    case 'auto':
      return mode;
    default:
      return 'keyword';
  }
}

/**
 * Reciprocal-rank-fusion constant `k` (FR-004, research D3). Rank-only RRF:
 * `fused(d) = Σ over each arm surfacing d of 1/(RRF_K + rank_arm(d))`, where
 * `rank_arm` is the 1-based rank within that arm's ordered candidate list.
 * `60` is the canonical RRF default; only ranks — never raw keyword BM25
 * magnitudes or cosine similarities — enter the fused score.
 */
export const RRF_K = 60;

/**
 * Per-query embed-wait cap in milliseconds (~2 s, FR-006). A query-embed that
 * does not resolve within this budget falls back to keyword results plus a
 * degradation hint and MUST NOT return an error (FR-006/006a). Late-arriving
 * vectors are discarded, never written to the cache (FR-006). Internal
 * constant — never an env var or knob (FR-007).
 */
export const EMBED_BUDGET_MS = 2000;

/**
 * Pre-build memory guard for the vector matrix cache (FR-009c): 1 GiB in
 * bytes. When the predicted resident size (`count × dims × 4`) exceeds this
 * ceiling the build is skipped and the query degrades to keyword (hint
 * string 4). The ceiling sits deliberately ABOVE the documented 50k × 3584
 * ≈ 717 MB corner so the bundled and typical corpora always build. Internal
 * constant — never an env var or knob (FR-007).
 */
export const MAX_MATRIX_BYTES = 1_073_741_824;

/**
 * Seed for the deterministic pure-JS PRNG that generates the 50k × 384
 * latency fixture in CI (FR-014c). A fixed, documented seed keeps the p95
 * fusion-compute gate reproducible with no committed binary asset and no
 * `Math.random` (SC-006). Value is the golden-ratio fractional constant
 * (2654435769), the conventional mulberry32-style seed.
 */
export const LATENCY_FIXTURE_SEED = 0x9e3779b9;

/**
 * Per-arm candidate depth fed to the RRF merge (FR-004): `max(5 × limit, 100)`
 * — the keyword arm's existing over-fetch depth, reused for the semantic arm
 * so neither arm starves the fusion pool (research D3). This bound is fixed by
 * `limit` alone and is NOT scaled by `options.offset` (FR-004/016).
 */
export function candidateDepth(limit: number): number {
  return Math.max(5 * limit, 100);
}

/**
 * The concrete retrieval strategy a request actually runs, after `auto` has
 * been resolved and dormancy applied. `auto` is never a runtime arm — it
 * resolves to one of these before any work happens.
 */
export type ResolvedSearchMode = 'keyword' | 'semantic' | 'hybrid';

/** Inputs the `auto`-resolution predicate needs (FR-002; research D1). */
export interface AutoResolveInput {
  /** Whether an embedding provider is configured for this project. */
  providerConfigured: boolean;
  /** Count of stored vectors matching the active provider's stored model id. */
  matchingVectorCount: number;
}

/**
 * Resolve `mode: 'auto'` to a concrete arm (FR-002, research D1): `hybrid`
 * iff a provider is configured AND ≥1 stored vector matches the active model,
 * else `keyword`. This is the SAME predicate the FR-017 `codegraph status`
 * availability line reports (T023 reuses it), and it is used ONLY by the explicit
 * surfaces (`codegraph_search` MCP tool + CLI search) and explicit opt-in callers
 * — never by internal callers, which stay keyword (FR-003).
 *
 * Pure and total: both conditions must hold for `hybrid`; a missing provider OR a
 * zero matching-model count resolves to the safe dormant default `keyword`, so an
 * unavailable semantic arm never spends embed latency. Consistent with the inline
 * healthy/degraded logic in `runFusedSearch` (index.ts, T019) — `provider === null`
 * ↔ `!providerConfigured` and `probe.count === 0` ↔ `matchingVectorCount === 0`
 * both degrade to keyword.
 */
export function resolveAutoMode(input: AutoResolveInput): ResolvedSearchMode {
  return input.providerConfigured && input.matchingVectorCount >= 1 ? 'hybrid' : 'keyword';
}

/**
 * Context handed to the fusion entry point by `searchNodes` for a resolved
 * `semantic` or `hybrid` request (wired in T012). Carries the keyword arm's
 * already-computed, post-rescore-ordered results (the RRF rank input for the
 * keyword arm, FR-004a) plus the filter-stripped query text the semantic arm
 * embeds (research D8) and the effective result cap.
 */
export interface HybridSearchContext {
  /** Resolved arm for this request — never `auto` (FR-002). */
  mode: 'semantic' | 'hybrid';
  /** Filter-stripped free-text used as the semantic embed input (research D8). */
  queryText: string;
  /** Effective result cap after option defaults; bounds the truncated union. */
  limit: number;
  /**
   * Keyword arm results in their existing post-rescore order — the keyword
   * arm's RRF rank input (FR-004a). Also the degradation fallback: every
   * degraded condition returns these verbatim (FR-006/015, SC-004).
   */
  keywordResults: SearchResult[];
}

/**
 * Fusion entry point: run the resolved semantic/hybrid arms and return the
 * fused, provenance-annotated results (FR-004/012). `searchNodes` delegates
 * here only for a resolved `semantic`/`hybrid` request; keyword requests never
 * reach this path and stay byte-identical to today (FR-001/003, SC-004).
 *
 * NOTE: stub — the arms (matrix cache T007, staleness probe T008, query-vector
 * acquisition T009, cosine top-k T010, RRF merge T011) and provenance wiring
 * (T012) land under US1. This placeholder is a keyword passthrough so the
 * feature is inert until then; it is NOT yet wired into `searchNodes`.
 */
export function runHybridSearch(ctx: HybridSearchContext): SearchResult[] {
  return ctx.keywordResults;
}

// ── Degradation signal + hint wording (T019; FR-005/006/009c/015, SC-003) ────
//
// The library exposes WHY a semantic/hybrid/auto request fell back to keyword as
// a machine-readable reason (`DegradationCondition`); the surfaces (MCP tool /
// CLI, T022) map that reason to the ONE verbatim footer string below and append
// it AFTER the results (FR-005 placement). Exactly four conditions exist — model
// mismatch folds into `no-vectors` and the FR-009c memory-guard skip folds into
// `embed-failure`; neither is a fifth condition (spec Degradation Hint Wording).

/**
 * The machine-readable reason a semantic/hybrid/auto request degraded to keyword
 * (FR-015). One per degraded condition; `null` at the call site means "not
 * degraded" (healthy fused, healthy-empty, or keyword mode). The surfaces map each
 * to `DEGRADATION_HINT_STRINGS[condition]`.
 *
 *   • `no-provider`   — no embedding provider configured (FR-002/015 → string 1)
 *   • `no-vectors`    — zero matching-model vectors; folds model mismatch (string 2)
 *   • `warming`       — provider present, matching vectors present, query cache cold
 *                       on the first hybrid-eligible query (FR-005 → string 3)
 *   • `embed-failure` — embed timeout / provider failure / FR-009c memory-guard skip /
 *                       any unexpected semantic-path throw — the catch-all (string 4)
 */
export type DegradationCondition = 'no-provider' | 'no-vectors' | 'warming' | 'embed-failure';

/**
 * The detailed search result the library exposes via `CodeGraph.searchNodesDetailed`
 * (the substrate the surfaces render). `results` is ALWAYS in dormant keyword shape
 * when `degradation !== null` (no `matchType`/`fusedScore`), byte-identical to the
 * keyword pipeline (SC-003/SC-004). `degradation` is the machine-readable reason, or
 * `null` when the request was healthy (fused, healthy-empty, or keyword mode).
 */
export interface SearchNodesDetailed {
  /** Result list — dormant keyword shape under any degraded condition, fused when healthy. */
  results: SearchResult[];
  /** Machine-readable degradation reason, or `null` when not degraded. */
  degradation: DegradationCondition | null;
  /**
   * Query-level timing for the semantic arm (FR-008), present ONLY when the semantic
   * arm actually RAN (a healthy, non-degraded `semantic`/`hybrid`/`auto` fusion).
   * ABSENT (`undefined`) in keyword mode, every degraded condition, and the
   * healthy-empty filter-only case — so keyword/degraded output stays byte-identical
   * (SC-004). Additive: existing shape asserts on `{ results, degradation }` stay green.
   */
  timing?: SearchTiming;
}

/**
 * The semantic arm's per-query timing (FR-008). `embedMs` is the query-embed duration
 * recorded at ACQUISITION time (`acquireQueryVectorForSearch` deposits it in the query
 * vector cache entry, since the embed happens there, not at search time); `fusionMs` is
 * the fusion leg (matrix scan + top-k + RRF merge) measured inside `runFusedSearch`. Both
 * are whole milliseconds. The MCP/CLI surfaces render `timingFooterLine(timing)` after the
 * results, and the CLI `--json` surface attaches the two fields per result via
 * {@link withJsonTiming}.
 */
export interface SearchTiming {
  /** Query-embed duration (ms) recorded when the vector was acquired/cached. */
  embedMs: number;
  /** Fusion leg duration (ms): matrix scan + top-k + RRF merge inside `runFusedSearch`. */
  fusionMs: number;
}

/**
 * The FR-012 inline provenance tag for a fused hit's PRIMARY line — `[keyword]` /
 * `[semantic]` / `[both]`, with a leading space so it appends cleanly to both the MCP
 * markdown `**name** (kind)` line and the CLI human `kind name` line. Returns `''` when
 * the hit carries no `matchType` (keyword mode, or a dormant/degraded result) so that
 * output stays BYTE-IDENTICAL to today (SC-004). Pure/deterministic — unit-tested
 * without a subprocess.
 */
export function provenanceTag(matchType?: 'keyword' | 'semantic' | 'both'): string {
  return matchType ? ` [${matchType}]` : '';
}

/**
 * The FR-008 timing footer LINE (no leading separator) — `semantic: embed <n>ms ·
 * fusion <n>ms`. The surfaces add their own blank-line separator so the note follows
 * the results (FR-005). Only rendered when {@link SearchNodesDetailed.timing} is present
 * (the semantic arm ran). Pure/deterministic — unit-tested without a subprocess.
 */
export function timingFooterLine(timing: SearchTiming): string {
  return `semantic: embed ${timing.embedMs}ms · fusion ${timing.fusionMs}ms`;
}

/**
 * Attach the FR-008 machine-readable timing fields (`embedMs`, `fusionMs`) to every
 * result for the CLI `--json` surface, present ONLY when the semantic arm ran. When
 * `timing` is absent (keyword mode / any degraded condition) the input array is returned
 * BY IDENTITY — no wrapping, no added fields — so `--json` stays byte-stable on the
 * dormant path (existing `status-embedding-json`/CLI-shape contracts). Kept per-result
 * (not top-level) so the JSON top-level type remains a stable array across all modes.
 * Pure/deterministic — unit-tested without a subprocess.
 */
export function withJsonTiming(
  results: SearchResult[],
  timing?: SearchTiming,
): SearchResult[] | Array<SearchResult & { embedMs: number; fusionMs: number }> {
  if (timing === undefined) return results;
  return results.map((r) => ({ ...r, embedMs: timing.embedMs, fusionMs: timing.fusionMs }));
}

/**
 * The four VERBATIM degradation footer strings (FR-015 Degradation Hint Wording
 * table). Transcribed literally from `spec.md`; the leading `\n\n` is the blank-line
 * separator that places the note AFTER the results (FR-005). The surfaces (MCP tool /
 * CLI, T022) append `DEGRADATION_HINT_STRINGS[condition]` whenever
 * `searchNodesDetailed` reports a non-null degradation.
 *
 * No-abandonment invariant (Constitution VI): none of these strings — nor any future
 * degraded-path wording — tells the caller to fall back to Read/Grep or otherwise stop
 * using search; each states that keyword results are shown and, where actionable, the
 * config / `codegraph sync` step that enables semantic ranking. The FR-015 / US3 tests
 * assert these literals verbatim, mechanically enforcing the invariant.
 */
export const DEGRADATION_HINT_STRINGS: Record<DegradationCondition, string> = {
  'no-provider':
    '\n\n> **Note:** semantic ranking is off — no embedding provider configured; showing keyword matches. Set CODEGRAPH_EMBEDDING_PROVIDER=local for the bundled model, or CODEGRAPH_EMBEDDING_URL and CODEGRAPH_EMBEDDING_MODEL for an endpoint, to enable.',
  'no-vectors':
    '\n\n> **Note:** no semantic vectors for the active model yet; showing keyword matches. Run `codegraph sync` to embed.',
  warming:
    '\n\n> **Note:** semantic ranking is warming up; showing keyword matches — later queries will fuse.',
  'embed-failure':
    '\n\n> **Note:** semantic ranking failed or timed out this query; showing keyword matches.',
};

// ── Vector matrix cache (T007; data-model E4, research D6/D7) ────────────────
//
// The KNN scan (T010) runs against a lazily-built, single-precision in-memory
// matrix of every stored vector whose model matches the active provider. Two
// pieces live here:
//
//   • `buildVectorMatrix(source)` — the PURE builder: a pre-allocation memory
//     guard, then a decode of every matching-model BLOB (LE f32, via
//     `decodeVector`) into ONE contiguous `Float32Array` with aligned per-row
//     nodeId/kind/language prefilter arrays (E4). Deterministic, DB-free.
//   • `getVectorMatrix(root, model, build)` — the SINGLE-OWNER memoizing seam:
//     a module-level singleton holding exactly ONE resident matrix, keyed by
//     `(project root, active stored model id)`. It is owned by the daemon main
//     process and NEVER built per query-pool worker (research D7) — a plain-JS
//     matrix built inside a worker would duplicate 64–717 MB per isolate. It
//     also memoizes the IN-FLIGHT build promise so concurrent first queries
//     share one build (thundering-herd).
//
// NORMALIZATION: vectors are stored UNNORMALIZED (the codec normalizes nothing).
// This builder is a PURE DECODE — it does not normalize. Cosine similarity is
// normalized at SCAN time (T010), keeping the build a deterministic byte-for-byte
// decode with no float drift and cold-build cost fully separable from the p95
// fusion gate (which times scan + top-k + RRF only, T013).

/** One decoded corpus row's metadata + its raw LE-f32 BLOB (the scan input). */
export interface VectorRow {
  nodeId: string;
  kind: NodeKind;
  language: Language;
  /** Raw little-endian f32 BLOB (`byteLength === dims × 4`); decoded via `decodeVector`. */
  vector: Buffer;
}

/**
 * The read seam `buildVectorMatrix` consumes. The two scalars (`count`, `dims`)
 * are read cheaply UP FRONT so the memory guard can predict resident bytes
 * BEFORE `rows()` is ever called (and thus before any large allocation).
 */
export interface VectorMatrixSource {
  /** Active stored model id the rows were scanned under (research D6). */
  model: string;
  /** Matching-model vector count (`getEmbeddingCoverage(model).embedded`). */
  count: number;
  /** Row width — the persisted `embedding_dims` scalar (research D6a). */
  dims: number;
  /** Enumerate every matching-model row. Called ONLY when the guard passes. */
  rows(): VectorRow[];
}

/** The resident in-memory matrix + its aligned per-row prefilter arrays (E4). */
export interface VectorMatrix {
  /** `count × dims` row-major single-precision matrix (research D6). */
  matrix: Float32Array;
  /** Per-row node id, aligned to matrix rows (RRF + gates). */
  nodeIds: string[];
  /** Per-row node kind, for the `kind:`/`options.kinds` prefilter (FR-010). */
  kinds: NodeKind[];
  /** Per-row node language, for the `lang:` prefilter (FR-010). */
  languages: Language[];
  /** Stored model id this matrix scans on. */
  model: string;
  /** Row width. */
  dims: number;
  /** Number of rows actually decoded into the matrix. */
  count: number;
}

/**
 * Result of a (possibly skipped) matrix build. `guarded: true` is the
 * success-shaped signal that the predicted resident size exceeded
 * `MAX_MATRIX_BYTES` and the build was skipped — the caller (T019) renders hint
 * string 4 and degrades to keyword. Never an error/throw (FR-009c).
 */
export type VectorMatrixResult =
  | { guarded: false; matrix: VectorMatrix }
  | { guarded: true; predictedBytes: number };

/**
 * Decode a source's matching-model BLOBs into one contiguous matrix (E4), OR skip
 * the build when it would be too large (FR-009c). The memory guard runs FIRST,
 * from the `count`/`dims` scalars alone — BEFORE `rows()` is called and before any
 * `Float32Array` is allocated — so an oversized corpus never allocates: a predicted
 * `count × dims × 4 > MAX_MATRIX_BYTES` returns `{ guarded: true }` and the caller
 * degrades to keyword (hint string 4). The boundary is strictly-greater, so a build
 * landing exactly on the ceiling is allowed.
 *
 * Past the guard, the matrix is sized from the ACTUAL enumerated rows (not the
 * predicted scalar) so a benign count/scan drift can never overflow the buffer;
 * each BLOB is decoded via `decodeVector` (LE f32; throws on a width mismatch — a
 * corrupt/wrong-dimension row) and written row-major into the single buffer, with
 * the nodeId/kind/language arrays filled in the same order.
 */
export function buildVectorMatrix(source: VectorMatrixSource): VectorMatrixResult {
  const { model, count, dims } = source;

  // Pre-build memory guard (FR-009c) — computed from scalars ONLY, before any
  // allocation or row scan. Strictly-greater: a build exactly at the ceiling builds.
  const predictedBytes = count * dims * 4;
  if (predictedBytes > MAX_MATRIX_BYTES) {
    return { guarded: true, predictedBytes };
  }

  // Guard passed → enumerate and decode. Size from the actual rows so a count/scan
  // drift can never overflow the contiguous buffer.
  const rows = source.rows();
  const rowCount = rows.length;
  const matrix = new Float32Array(rowCount * dims);
  const nodeIds: string[] = new Array(rowCount);
  const kinds: NodeKind[] = new Array(rowCount);
  const languages: Language[] = new Array(rowCount);

  for (let i = 0; i < rowCount; i++) {
    const row = rows[i]!;
    matrix.set(decodeVector(row.vector, dims), i * dims); // LE f32; row-major placement
    nodeIds[i] = row.nodeId;
    kinds[i] = row.kind;
    languages[i] = row.language;
  }

  return {
    guarded: false,
    matrix: { matrix, nodeIds, kinds, languages, model, dims, count: rowCount },
  };
}

/**
 * The single resident matrix (research D7). Held in the daemon MAIN process — one
 * per project, keyed by `(project root, active stored model id)`. A new key evicts
 * the prior entry, so at most ONE matrix is ever resident. `promise` memoizes the
 * in-flight build so concurrent first queries share one build (thundering-herd).
 */
interface ResidentMatrix {
  key: string;
  promise: Promise<VectorMatrixResult>;
}
let residentMatrix: ResidentMatrix | undefined;

/**
 * The single resident matrix for the SYNCHRONOUS accessor ({@link getVectorMatrixSync}).
 * `CodeGraph.searchNodes` is synchronous (contract search-api; every caller invokes
 * it synchronously), so it cannot await the Promise-returning {@link getVectorMatrix};
 * it memoizes the already-resolved result here instead. Same single-owner,
 * one-per-project, evict-on-new-key discipline as {@link residentMatrix}; the two
 * caches are independent (the async one serves any future async caller). Holds only a
 * resolved `VectorMatrixResult` — a build that throws is never memoized, so the next
 * query retries rather than seeing a sticky failure.
 */
let residentMatrixSync: { key: string; result: VectorMatrixResult } | undefined;

/** Composite cache key. The NUL separator can't occur in a path or a model id. */
function matrixCacheKey(projectRoot: string, model: string): string {
  return `${projectRoot}\u0000${model}`;
}

/**
 * Return the resident matrix for `(projectRoot, model)`, building it once via
 * `build` on the first query and memoizing the result for every later query on the
 * same key (build-once). Concurrent FIRST queries share the single in-flight build
 * promise (thundering-herd). A different key evicts the prior resident, so exactly
 * one matrix is ever held (research D7). `build` may return the result synchronously
 * or as a promise (e.g. an off-thread decode); either is awaited. A REJECTED build
 * is evicted so a subsequent query can retry rather than see a sticky failure —
 * `{ guarded: true }` is a normal (memoized) resolution, not a rejection.
 */
export function getVectorMatrix(
  projectRoot: string,
  model: string,
  build: () => VectorMatrixResult | Promise<VectorMatrixResult>,
): Promise<VectorMatrixResult> {
  const key = matrixCacheKey(projectRoot, model);
  if (residentMatrix && residentMatrix.key === key) {
    return residentMatrix.promise;
  }

  const promise = (async () => build())();
  const entry: ResidentMatrix = { key, promise };
  residentMatrix = entry;
  // A failed build must not stay resident as a sticky rejection: evict it (only if
  // it is still the current entry) so the next query rebuilds.
  promise.catch(() => {
    if (residentMatrix === entry) residentMatrix = undefined;
  });
  return promise;
}

/**
 * Build the `QueryBuilder`-backed source the matrix cache decodes (research D6/D6a).
 * The two guard scalars are read cheaply up front: `count` from the matching-model
 * JOIN count (`getEmbeddingCoverage(model).embedded`) and `dims` from the persisted
 * `embedding_dims` scalar — the same value the embed pass writes alongside every
 * vector, so a corpus that has vectors always has this scalar. `rows()` is deferred
 * to the actual BLOB scan and runs only when the guard passes.
 */
export function vectorMatrixSourceFromQueries(
  queries: QueryBuilder,
  model: string,
): VectorMatrixSource {
  const storedDims = queries.getMetadata('embedding_dims');
  const parsed = storedDims === null ? NaN : Number(storedDims);
  const dims = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  const count = queries.getEmbeddingCoverage(model).embedded;
  return {
    model,
    count,
    dims,
    rows: () => queries.selectVectorRowsForModel(model),
  };
}

/** Test-only: drop BOTH resident matrices (async + sync) so a suite starts cold. */
export function __resetVectorMatrixCacheForTests(): void {
  residentMatrix = undefined;
  residentMatrixSync = undefined;
}

// ── Per-query staleness probe (T008; FR-008b, research D6a) ──────────────────
//
// A cheap BOUNDED read that decides, per semantic/hybrid query, whether the
// resident matrix (T007) still reflects the index. There is NO `data_version`
// column in `node_vectors` (research D6a); the token is instead the three
// scalars that fully capture every matrix-affecting change — a matching-model
// vector add/remove/re-embed, a model switch, or a dims change:
//
//   • count — the matching-model vector count (`getEmbeddingCoverage(model)
//             .embedded`, a JOINed COUNT — NOT a full `node_vectors` scan),
//   • model — the persisted `embedding_model` scalar (`project_metadata`),
//   • dims  — the persisted `embedding_dims` scalar (`project_metadata`).
//
// The three fold into the T007 cache key, so an unchanged token returns the
// resident matrix by object identity (build-once) while ANY change yields a new
// key — `getVectorMatrix` evicts the stale resident and rebuilds on the next
// query, reusing the SAME build path and thundering-herd memoization. No schema
// write, no new column (Constitution VII), no full scan (FR-008b).
//
// This probe runs ONLY on the semantic/hybrid path. The keyword path never
// calls `probeVectorStaleness`/`getVectorMatrixForProbe`, so it incurs zero
// probe cost (FR-003a).

/** The cheap bounded staleness token (FR-008b, research D6a). */
export interface StalenessProbe {
  /** Matching-model vector count (`getEmbeddingCoverage(model).embedded`). */
  count: number;
  /** Persisted `embedding_model` scalar — the stored model id (research D6a). */
  model: string;
  /** Persisted `embedding_dims` scalar — the row width (research D6a). */
  dims: number;
}

/**
 * Read the bounded staleness token for `model` (FR-008b): the matching-model
 * vector count plus the `embedding_model`/`embedding_dims` metadata scalars.
 * All three are cheap reads — a JOINed COUNT and two single-row metadata
 * lookups — never a full `node_vectors` scan and never a schema write. The
 * `embedding_model` scalar is the stored model id the vectors were written
 * under; it falls back to the passed active `model` when the scalar is absent
 * (a corpus mid-embed). `dims` is `0` when the scalar is missing or malformed.
 */
export function probeVectorStaleness(queries: QueryBuilder, model: string): StalenessProbe {
  const storedDims = queries.getMetadata('embedding_dims');
  const parsed = storedDims === null ? NaN : Number(storedDims);
  const dims = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  const storedModel = queries.getMetadata('embedding_model') ?? model;
  const count = queries.getEmbeddingCoverage(model).embedded;
  return { count, model: storedModel, dims };
}

// ── Query-vector acquisition (T009; FR-011, data-model E5, research D11) ──────
//
// Turn the RAW query string into the semantic arm's scan input: parse it with the
// SAME parser FTS uses (`parseQuery`), embed ONLY the filter-stripped free-text
// portion through the ACTIVE provider, and report the provider's stored model id
// so the scan/cache key (T007/T008) matches the id the corpus was embedded under
// (research D6 — a model mismatch silently zeroes the arm).
//
// Two callers, one shape: the pure `acquireQueryVector` here (a provider in hand),
// and `CodeGraph.acquireQueryVectorForSearch` (index.ts) which resolves the
// provider first — the test-only seam when set, else lazily from env config.
//
// HEALTHY-EMPTY (not degraded): a filter-only query (`kind:function`, `lang:go …`)
// strips to empty free text — there is nothing to embed, so NO embed call is made
// and the semantic arm contributes nothing. This is a normal, non-degraded outcome
// (no hint, no error); it mirrors how FTS receives an empty free-text portion.

/**
 * Outcome of acquiring the semantic arm's query vector (data-model E5). `vector`
 * is the embedded query (length === provider dims) and `model` the provider's
 * stored id — the value the T007/T008 scan+cache key is keyed on. Both are `null`
 * for the healthy-empty case (filter-stripped text empty → no embed call).
 */
export interface QueryVectorAcquisition {
  /** Embedded query vector, or `null` when there was nothing to embed. */
  vector: Float32Array | null;
  /** Provider's stored model id the vector was produced under, or `null` when no embed happened. */
  model: string | null;
}

/**
 * Acquire the semantic arm's query vector from an already-resolved provider
 * (FR-011, data-model E5). The raw query is parsed with the SAME `parseQuery` FTS
 * uses; only the filter-stripped free-text portion is embedded, so the semantic
 * input mirrors the keyword input. An empty filter-stripped text makes NO embed
 * call and returns `{ vector: null, model: null }` (the healthy-empty case — the
 * semantic arm simply contributes nothing; NOT a degraded/error condition). The
 * returned `model` is the provider's stored id, which the caller threads into the
 * scan/cache key so it matches the id the corpus was embedded under (research D6).
 */
export async function acquireQueryVector(
  rawQuery: string,
  provider: EmbeddingProvider,
): Promise<QueryVectorAcquisition> {
  // Mirror FTS: the semantic arm embeds the SAME filter-stripped free text the
  // keyword arm receives (`parseQuery(...).text` is already trimmed).
  const text = parseQuery(rawQuery).text;
  if (text.length === 0) {
    // Healthy-empty: a filter-only query has nothing to embed — no provider call,
    // the semantic arm contributes nothing (NOT a degraded/error condition).
    return { vector: null, model: null };
  }
  const vectors = await provider.embed([text]);
  // The provider's stored id is what the T007/T008 scan+cache key is keyed on, so
  // it matches the id the corpus was embedded under (research D6).
  return { vector: vectors[0] ?? null, model: provider.id };
}

// ── Cosine top-k scan (T010; FR-010/013/014c, research D8) ───────────────────
//
// The semantic arm's ranking leg: a single allocation-light pass over the
// resident matrix's contiguous `Float32Array` that keeps the k highest-cosine
// rows, with `kind:`/`lang:`/`options.kinds` PRE-filtering the scan BEFORE
// top-k so a filtered-out row never consumes a top-k slot (FR-010, research
// D8). `path:`/`name:` are NOT applied here — they are post-fusion hard gates
// (T011). A fully-filtered scan yields an empty candidate list, so the fusion
// input degrades to keyword-only (research D8 edge).
//
// NORMALIZATION (documented choice): stored vectors are UNNORMALIZED (T007 is a
// pure decode). Cosine is normalized HERE at scan time — each row's L2 norm is
// computed on the fly inside the same inner loop that accumulates the dot
// product (one pass, no second read, no per-matrix precompute), and the query
// norm is computed once up front. This keeps the T007 build a byte-for-byte
// decode with no float drift, and the scan deterministic either way: a row's
// norm is a pure function of its f32 values, recomputed identically every scan.
//
// ZERO-MAGNITUDE / NON-POSITIVE (documented choice): a zero-magnitude row or a
// zero-magnitude query has an undefined cosine; we define its similarity as 0
// and EXCLUDE it from candidates. More generally only rows with cosine strictly
// > 0 are candidates — an orthogonal (0) or opposing (< 0) row contributes no
// semantic signal, so it never enters the fusion pool. This subsumes the
// zero-magnitude case and keeps the rule a single deterministic threshold.
//
// ALLOCATION (FR-014c): the scan holds a bounded min-heap of at most k entries
// (root = the worst kept candidate). A row that does not make the cut allocates
// nothing; only a kept/replacing candidate allocates one small object. This
// keeps the p95-gated fusion leg allocation-light with no per-row object churn.

/**
 * Pre-filter inputs for the cosine scan (FR-010, research D8). Both are the
 * union of the parsed `kind:`/`lang:` query filters and `options.kinds`, merged
 * by the caller (T012). An absent or empty array means "no filter on that
 * axis". `path:`/`name:` are deliberately NOT here — they gate post-fusion.
 */
export interface SemanticScanFilters {
  /** Keep only rows whose kind is in this set; empty/absent ⇒ no kind filter. */
  kinds?: NodeKind[];
  /** Keep only rows whose language is in this set; empty/absent ⇒ no lang filter. */
  languages?: Language[];
}

/**
 * One ranked semantic candidate: the row's node id (the RRF join key + the
 * FR-013 tie-break key) and its cosine similarity to the query. The returned
 * array's ORDER is the semantic arm's rank (index 0 = rank 1); the score is
 * carried for diagnostics/JSON only — RRF fuses ranks, never magnitudes (T011).
 */
export interface SemanticCandidate {
  /** Stable content-hash node id, aligned to the matrix row it was scored from. */
  nodeId: string;
  /** Cosine similarity to the query vector in `(0, 1]` (non-positive rows are excluded). */
  similarity: number;
}

/**
 * Total order over candidates (FR-013, research D10): DESCENDING cosine, ties
 * broken by ASCENDING node id. Node ids are unique within a matrix, so this is
 * a strict total order — identical (matrix, query, k) ⇒ byte-identical output.
 */
function candidateRanksBefore(aSim: number, aId: string, bSim: number, bId: string): boolean {
  if (aSim !== bSim) return aSim > bSim;
  return aId < bId;
}

/** True iff `a` is the WORSE candidate (sinks toward the min-heap root). */
function candidateIsWorse(a: SemanticCandidate, b: SemanticCandidate): boolean {
  return candidateRanksBefore(b.similarity, b.nodeId, a.similarity, a.nodeId);
}

/** Bubble the entry at `idx` toward the root while it is worse than its parent. */
function heapSiftUp(heap: SemanticCandidate[], idx: number): void {
  let i = idx;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (candidateIsWorse(heap[i]!, heap[parent]!)) {
      const tmp = heap[i]!;
      heap[i] = heap[parent]!;
      heap[parent] = tmp;
      i = parent;
    } else {
      break;
    }
  }
}

/** Sink the entry at `idx` while a child is worse than it (worst stays at root). */
function heapSiftDown(heap: SemanticCandidate[], idx: number): void {
  const n = heap.length;
  let i = idx;
  for (;;) {
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    let worst = i;
    if (l < n && candidateIsWorse(heap[l]!, heap[worst]!)) worst = l;
    if (r < n && candidateIsWorse(heap[r]!, heap[worst]!)) worst = r;
    if (worst === i) break;
    const tmp = heap[i]!;
    heap[i] = heap[worst]!;
    heap[worst] = tmp;
    i = worst;
  }
}

/**
 * Scan `matrix` and return the `k` rows most cosine-similar to `queryVector`,
 * ranked DESCENDING by cosine with ASCENDING node-id tie-break (FR-010/013,
 * research D8/D10). `filters` PRE-filter the scan before top-k: a row whose
 * kind/language is excluded is skipped BEFORE scoring, so it never occupies a
 * top-k slot (no starvation). A fully-filtered scan, a zero-magnitude query, or
 * a matrix of only non-positive rows all return `[]` (the arm contributes
 * nothing; the caller falls back to keyword-only fusion input). Deterministic:
 * identical inputs ⇒ identical output.
 *
 * `k` is `candidateDepth(limit)` (T003) at the call site. See the section
 * header for the normalization, zero-magnitude, and allocation rationale.
 */
export function semanticTopK(
  matrix: VectorMatrix,
  queryVector: Float32Array,
  k: number,
  filters?: SemanticScanFilters,
): SemanticCandidate[] {
  if (k <= 0) return [];

  const { matrix: data, nodeIds, kinds, languages, dims, count } = matrix;

  // Query magnitude computed ONCE. A zero-magnitude query has no direction, so
  // every cosine is undefined → 0 → excluded: return an empty candidate list.
  let qSq = 0;
  for (let d = 0; d < dims; d++) {
    const q = queryVector[d]!;
    qSq += q * q;
  }
  if (qSq === 0) return [];
  const qNorm = Math.sqrt(qSq);

  const kindFilter =
    filters?.kinds && filters.kinds.length > 0 ? new Set<NodeKind>(filters.kinds) : null;
  const langFilter =
    filters?.languages && filters.languages.length > 0
      ? new Set<Language>(filters.languages)
      : null;

  // Bounded min-heap of the k best candidates; heap[0] is the WORST kept.
  const heap: SemanticCandidate[] = [];

  for (let i = 0; i < count; i++) {
    // PRE-FILTER before scoring: a filtered row must never consume a top-k slot.
    if (kindFilter && !kindFilter.has(kinds[i]!)) continue;
    if (langFilter && !langFilter.has(languages[i]!)) continue;

    // One pass over the contiguous row: dot product + row L2 norm together.
    const base = i * dims;
    let dot = 0;
    let rSq = 0;
    for (let d = 0; d < dims; d++) {
      const x = data[base + d]!;
      dot += queryVector[d]! * x;
      rSq += x * x;
    }
    if (rSq === 0) continue; // zero-magnitude row: similarity 0, excluded

    const sim = dot / (qNorm * Math.sqrt(rSq));
    if (!(sim > 0)) continue; // orthogonal (0) or opposing (<0): excluded

    const id = nodeIds[i]!;
    if (heap.length < k) {
      heap.push({ nodeId: id, similarity: sim });
      heapSiftUp(heap, heap.length - 1);
    } else if (candidateRanksBefore(sim, id, heap[0]!.similarity, heap[0]!.nodeId)) {
      // Incoming ranks before the worst kept → it belongs in the top-k.
      heap[0] = { nodeId: id, similarity: sim };
      heapSiftDown(heap, 0);
    }
  }

  // The heap holds the ≤k best candidates unordered; materialise the final rank.
  heap.sort((a, b) =>
    candidateRanksBefore(a.similarity, a.nodeId, b.similarity, b.nodeId) ? -1 : 1,
  );
  return heap;
}

// ── Rank-only RRF merge (T011; FR-004/004a/010/012/013, research D3/D10) ─────
//
// Fuse the keyword arm (its existing post-rescore order) and the semantic arm
// (T010 cosine order) by RECIPROCAL RANK ONLY:
//
//     fused(d) = Σ over each arm surfacing d of 1/(RRF_K + rank_arm(d))
//
// `rank_arm` is the 1-based position of d in that arm's ordered candidate list.
// Only RANKS enter the sum — never a raw BM25 magnitude or cosine similarity
// (FR-004) — and the keyword arm's kind/path/name rescoring BONUSES are NOT
// re-applied here (FR-004a): the keyword arm's rank already baked them in, so
// re-adding them would double-count. The two arms are deduped by node id (a node
// in both contributes one fused row summing both arms' reciprocals), and each
// row is tagged `matchType` per which arm(s) surfaced it (FR-012).
//
// ORDER: fused DESC, ties broken by ASCENDING node id (FR-013) — a strict total
// order over unique node ids, so identical inputs ⇒ byte-identical output (SC-006).
//
// POST-FUSION HARD GATES (FR-010): `path:`/`name:` drop non-matching rows AFTER
// the fused order is fixed and BEFORE the offset/limit slice — mirroring the
// keyword pipeline's gate semantics (case-insensitive substring, OR within a
// field, AND across fields) at `src/db/queries.ts`. A keyword-arm candidate
// supplies its gate fields from its own `node`; a semantic-only candidate (whose
// `SearchResult.node` the merge never sees) supplies them via the caller's
// `gateFields` map — keeping this function PURE (no DB reach). A gated candidate
// with no resolvable gate fields is treated as a non-match and dropped.
//
// PAGINATION (FR-004/016): `offset` slices the FIXED fused pool `[offset,
// offset+limit)` — the pool is bounded by each arm's `candidateDepth(limit)`, NOT
// scaled by offset — so a page beyond the pool returns fewer than `limit` rows,
// a normal bounded-slice outcome, never an error.

/** A candidate's gate fields (the POST-fusion `path:`/`name:` hard gate reads these). */
export interface RrfGateFields {
  /** File path relative to project root — the `path:` gate's substring target. */
  filePath: string;
  /** Symbol name — the `name:` gate's substring target. */
  name: string;
}

/** One fused row: the node id, its rank-only fused score, and its arm provenance (FR-012). */
export interface FusedResult {
  /** Node id — the RRF join key and FR-013 tie-break key. */
  nodeId: string;
  /** Rank-only RRF score (FR-004); the value `score`/`fusedScore` carry in fused modes. */
  fusedScore: number;
  /** Which arm(s) surfaced this node: keyword-only, semantic-only, or both. */
  matchType: 'keyword' | 'semantic' | 'both';
}

/**
 * Inputs to the rank-only RRF merge (FR-004). `RRF_K` defaults to the module
 * constant. `pathFilters`/`nameFilters` are the parsed `path:`/`name:` values
 * applied as POST-fusion hard gates. `gateFields` supplies gate fields for
 * semantic-only candidates the merge can't see a `SearchResult.node` for (T012
 * builds it from the node records backing the semantic candidates) — keyword-arm
 * candidates supply theirs from their own node. `offset`/`limit` slice the fused
 * pool after gating.
 */
export interface RrfMergeOptions {
  /** Result cap; the fused pool is sliced to at most this many rows after gating. */
  limit: number;
  /** Post-fusion slice start over the FIXED pool (default 0); a deep page returns < limit. */
  offset?: number;
  /** Reciprocal-rank-fusion constant (default: the module `RRF_K`). */
  RRF_K?: number;
  /** Parsed `path:` filter values — case-insensitive substring gate on filePath (OR'd). */
  pathFilters?: string[];
  /** Parsed `name:` filter values — case-insensitive substring gate on name (OR'd). */
  nameFilters?: string[];
  /** Gate fields for semantic-only candidates (keyword candidates use their own node). */
  gateFields?: Map<string, RrfGateFields>;
}

/** One accumulating fused row before ordering: score plus per-arm provenance. */
interface FusionAccumulator {
  nodeId: string;
  fusedScore: number;
  inKeyword: boolean;
  inSemantic: boolean;
}

/**
 * Rank-only RRF merge of the keyword and semantic arms (FR-004/004a/010/012/013).
 * See the section header for the fusion formula, tie-break, post-fusion gate, and
 * pagination semantics. Pure and deterministic: identical inputs ⇒ identical output.
 */
export function rrfMerge(
  keywordArm: SearchResult[],
  semanticArm: SemanticCandidate[],
  opts: RrfMergeOptions,
): FusedResult[] {
  const k = opts.RRF_K ?? RRF_K;

  // Accumulate one row per unique node id, summing each arm's 1/(k + rank).
  const acc = new Map<string, FusionAccumulator>();
  // Gate fields resolvable from the keyword arm's own nodes (no lookup needed).
  const keywordGateFields = new Map<string, RrfGateFields>();

  // Keyword arm: rank = 1-based position in the post-rescore order. First
  // occurrence wins a node's rank (a dedup guard; the arm is normally unique).
  let kwRank = 0;
  for (const r of keywordArm) {
    const id = r.node.id;
    if (!keywordGateFields.has(id)) {
      keywordGateFields.set(id, { filePath: r.node.filePath, name: r.node.name });
    }
    let row = acc.get(id);
    if (row?.inKeyword) continue; // already ranked in this arm — keep the best (first) rank
    kwRank++;
    const contribution = 1 / (k + kwRank);
    if (row) {
      row.fusedScore += contribution;
      row.inKeyword = true;
    } else {
      row = { nodeId: id, fusedScore: contribution, inKeyword: true, inSemantic: false };
      acc.set(id, row);
    }
  }

  // Semantic arm: rank = 1-based position in the T010 cosine order.
  let semRank = 0;
  for (const c of semanticArm) {
    const id = c.nodeId;
    let row = acc.get(id);
    if (row?.inSemantic) continue; // already ranked in this arm — keep the best rank
    semRank++;
    const contribution = 1 / (k + semRank);
    if (row) {
      row.fusedScore += contribution;
      row.inSemantic = true;
    } else {
      row = { nodeId: id, fusedScore: contribution, inKeyword: false, inSemantic: true };
      acc.set(id, row);
    }
  }

  // Order: fused DESC, tie-break ASCENDING node id (FR-013) — a strict total order.
  const ordered = Array.from(acc.values()).sort((a, b) => {
    if (a.fusedScore !== b.fusedScore) return b.fusedScore - a.fusedScore;
    return a.nodeId < b.nodeId ? -1 : 1;
  });

  // POST-fusion hard gates (FR-010): drop non-matching rows BEFORE the slice.
  const pathFilters = (opts.pathFilters ?? []).filter((p) => p.length > 0).map((p) => p.toLowerCase());
  const nameFilters = (opts.nameFilters ?? []).filter((n) => n.length > 0).map((n) => n.toLowerCase());
  let gated: FusionAccumulator[] = ordered;
  if (pathFilters.length > 0 || nameFilters.length > 0) {
    gated = ordered.filter((row) => {
      const fields = keywordGateFields.get(row.nodeId) ?? opts.gateFields?.get(row.nodeId);
      if (!fields) return false; // gate active but no fields to evaluate → non-match, dropped
      if (pathFilters.length > 0) {
        const fp = fields.filePath.toLowerCase();
        if (!pathFilters.some((p) => fp.includes(p))) return false;
      }
      if (nameFilters.length > 0) {
        const nm = fields.name.toLowerCase();
        if (!nameFilters.some((n) => nm.includes(n))) return false;
      }
      return true;
    });
  }

  // Pagination (FR-004/016): slice the fixed pool; a deep page returns < limit.
  const offset = opts.offset ?? 0;
  const page = gated.slice(offset, offset + opts.limit);

  return page.map((row) => ({
    nodeId: row.nodeId,
    fusedScore: row.fusedScore,
    matchType: row.inKeyword && row.inSemantic ? 'both' : row.inKeyword ? 'keyword' : 'semantic',
  }));
}

/** Fold the probe token into the T007 cache key. NUL can't occur in a model id. */
function stalenessKey(probe: StalenessProbe): string {
  return `${probe.model}\u0000${probe.count}\u0000${probe.dims}`;
}

/**
 * Return the resident matrix for a probe token, rebuilding it whenever the token
 * changed since the resident was built (FR-008b). The token folds into the T007
 * cache key: an UNCHANGED token hits the same `getVectorMatrix` key and returns
 * the resident matrix by object identity (build-once); ANY change (vector
 * add/remove/re-embed → `count`; model switch → `model`; dims change → `dims`)
 * yields a new key, so `getVectorMatrix` evicts the stale resident and rebuilds
 * on the next query — reusing its build path and thundering-herd memoization.
 * Called ONLY on the semantic/hybrid path (FR-003a).
 */
export function getVectorMatrixForProbe(
  projectRoot: string,
  probe: StalenessProbe,
  build: () => VectorMatrixResult | Promise<VectorMatrixResult>,
): Promise<VectorMatrixResult> {
  return getVectorMatrix(projectRoot, stalenessKey(probe), build);
}

/**
 * Synchronous counterpart to {@link getVectorMatrixForProbe} for the sync
 * `searchNodes` fusion path (T012). Returns the resident matrix for a probe token,
 * rebuilding SYNCHRONOUSLY via `build` whenever the token changed since the resident
 * was built (FR-008b) — identical build-once / evict-on-change semantics as the async
 * accessor, folding the same probe token into the same cache key, but with no Promise
 * so a synchronous caller can consume it directly. `build` MUST be synchronous (the
 * decode itself is pure and sync — {@link buildVectorMatrix}); a throwing build is
 * propagated and NOT memoized, so the caller degrades this query and the next retries.
 * A `{ guarded: true }` result is a normal (memoized) resolution, not a failure.
 * Owned by the daemon main process, one matrix per project (research D7).
 */
export function getVectorMatrixSync(
  projectRoot: string,
  probe: StalenessProbe,
  build: () => VectorMatrixResult,
): VectorMatrixResult {
  const key = matrixCacheKey(projectRoot, stalenessKey(probe));
  if (residentMatrixSync && residentMatrixSync.key === key) {
    return residentMatrixSync.result;
  }
  const result = build(); // throws propagate (not memoized) → caller degrades, next retries
  residentMatrixSync = { key, result };
  return result;
}
