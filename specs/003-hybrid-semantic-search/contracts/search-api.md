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
  score: number;                                  // unchanged FIELD (unbounded, ordering-only). Value source by mode — see note below.
  highlights?: string[];
  matchType?: 'keyword' | 'semantic' | 'both';    // NEW — FR-012, absent in keyword mode
  fusedScore?: number;                            // NEW — FR-004, CLI --json only, absent in keyword mode
}
```

### `score` value by mode (FR-012 clarification)

`score` remains a required, unbounded, ordering-only number (never removed — keyword-mode
value is byte-identical to today, SC-004). Its VALUE source depends on mode so that
`score` always stays monotonic with the returned order (the sole guarantee existing
`--json` consumers rely on):

- **keyword mode**: unchanged — the FTS BM25 magnitude (or ~0–1 fuzzy/exact value), exactly as today.
- **semantic / hybrid mode**: `score` carries the same value as `fusedScore` (the RRF fused score, FR-004). This keeps `score` consistent with the fused ordering; `fusedScore` is the explicit, self-documenting machine field surfaced only in CLI `--json`. Raw keyword magnitudes and cosine similarities never populate `score` in these modes (FR-004 forbids raw magnitudes from entering the fused score).

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
| `mode` is an unknown / out-of-enum string (e.g. a JS caller passing `'kwd' as any`) | Coerces to the **library default `keyword`** — never throws, never error-shaped. TypeScript callers cannot reach this (the `SearchMode` union rejects it at compile time); the coercion guards only untyped/`as any` callers. Surface-level unknown values coerce to `auto` instead (their default) — see mcp-cli-surface. | FR-001/015 |
| `options.offset` set in semantic/hybrid mode | Pagination applies **after** fusion: the fused, tie-broken, ordered union is sliced `[offset, offset+limit)` — matching keyword-mode pagination's slice shape and tie-break, but bounded by FR-004's fixed per-arm candidate depth (`max(5×limit,100)`, not scaled by offset) rather than keyword-mode's unbounded SQL `OFFSET`; pages beyond that pool return fewer than `limit` results, a normal bounded-slice outcome, not an error. Determinism (SC-006) holds because the pre-slice order is deterministic. `offset` is a library-only option; neither the MCP tool nor the CLI exposes it. | FR-004/013/016 |

## Invariants

- **Determinism (SC-006)**: identical `(query, options, index state)` ⇒ identical ordering.
- **No new config (FR-007)**: embed budget (~2s) and cache size are internal constants, not options or env vars.
- **Internal callers (FR-003)**: explore / prompt hook / context builder call with default (keyword) mode → zero query-embed latency, zero shape change. FR-014(b) asserts zero query-embed calls from these paths (provider-seam spy).
- **Keyword arm reused verbatim (Constitution III)**: the FTS5 → LIKE → fuzzy + exact-name supplement + multi-signal rescoring pipeline (`QueryBuilder.searchNodes`) is not restructured; its post-rescore order is the keyword arm's rank input to RRF (FR-004a).
