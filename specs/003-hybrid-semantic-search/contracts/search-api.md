# Contract: Library Search API (`searchNodes`)

Surface: `CodeGraph.searchNodes` (`src/index.ts` → `QueryBuilder.searchNodes`, `src/db/queries.ts`).

## Signature (extended — plumbing only)

```ts
// Existing (unchanged call shape):
searchNodes(query: string, options?: SearchOptions): SearchResult[]

// SearchOptions gains ONE optional field:
interface SearchOptions {
  kinds?: NodeKind[];
  languages?: Language[];
  includePatterns?: string[];
  excludePatterns?: string[];
  limit?: number;      // default 100 (library) — surfaces clamp to their own defaults
  offset?: number;
  caseSensitive?: boolean;
  mode?: SearchMode;   // NEW — default 'keyword' (FR-001)
}

type SearchMode = 'keyword' | 'semantic' | 'hybrid' | 'auto';

// SearchResult gains TWO optional fields, present in semantic/hybrid modes ONLY:
interface SearchResult {
  node: Node;
  score: number;                                  // unchanged (unbounded, ordering-only)
  highlights?: string[];
  matchType?: 'keyword' | 'semantic' | 'both';    // NEW — FR-012, absent in keyword mode
  fusedScore?: number;                            // NEW — FR-004, CLI --json only, absent in keyword mode
}
```

## Behavioral contract

| Input | Guaranteed behavior | Trace |
|-------|--------------------|-------|
| `mode` omitted / `'keyword'` | Byte-identical to today's `QueryBuilder.searchNodes`; result shape has no `matchType`/`fusedScore` (absent, not undefined). | FR-001/003, SC-004 |
| `mode: 'semantic'` | Vector KNN arm only; no FTS/exact-name supplement; MAY omit an exact-name-only symbol. Each hit carries `matchType`. | FR-002a |
| `mode: 'hybrid'` | Rank-only RRF (`k=60`) of keyword + vector arms; each arm depth `max(5×limit,100)`; ordered by fused score desc, tie-break ascending node id; truncated to `limit`. | FR-004/004a/013 |
| `mode: 'auto'` | **Library API does not auto-resolve** — `auto` resolution is a surface-only helper (FR-002). If a library caller passes `auto`, it resolves by the same predicate (hybrid iff matching-model vectors exist, else keyword). | FR-002 |
| No vectors / no provider / warming / embed-timeout, any semantic/hybrid/auto mode | Returns keyword results (never throws, never error-shaped). The *hint* is a surface concern; the library returns keyword `SearchResult[]`. | FR-015, US3 |
| `kind:`/`lang:`/`options.kinds` in any mode | Pre-filter the vector scan before top-k; identical semantics to keyword arm. | FR-010/016 |
| `path:`/`name:` in any mode | Post-fusion hard gate; identical semantics to keyword arm. | FR-010/016 |

## Invariants

- **Determinism (SC-006)**: identical `(query, options, index state)` ⇒ identical ordering.
- **No new config (FR-007)**: embed budget (~2s) and cache size are internal constants, not options or env vars.
- **Internal callers (FR-003)**: explore / prompt hook / context builder call with default (keyword) mode → zero query-embed latency, zero shape change. FR-014(b) asserts zero query-embed calls from these paths (provider-seam spy).
- **Keyword arm reused verbatim (Constitution III)**: the FTS5 → LIKE → fuzzy + exact-name supplement + multi-signal rescoring pipeline (`QueryBuilder.searchNodes`) is not restructured; its post-rescore order is the keyword arm's rank input to RRF (FR-004a).
