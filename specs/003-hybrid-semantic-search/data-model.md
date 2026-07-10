# Phase 1 Data Model: Hybrid Semantic Search

This feature adds **no persistent schema** — `node_vectors` and `project_metadata` are consumed read-only. The "data model" here is the in-memory/runtime shapes and the optional result-field extensions. Field-level rules trace to FRs.

---

## E1 — Search mode (enum)

`type SearchMode = 'keyword' | 'semantic' | 'hybrid' | 'auto'`

| Value | Behavior | Source |
|-------|----------|--------|
| `keyword` | FTS5 → LIKE → fuzzy + exact-name supplement + multi-signal rescoring (the existing `QueryBuilder.searchNodes`, reused verbatim). | FR-001 |
| `semantic` | Vector (KNN) arm **only** — no FTS/exact-name supplement; MAY omit an exact-name symbol absent from the vector top-k. | FR-002a |
| `hybrid` | Rank-only RRF (`k=60`) fusion of the keyword arm and the vector arm. | FR-004 |
| `auto` | Resolves (at explicit surfaces only) to `hybrid` when matching-model vectors exist, else `keyword`. | FR-002 |

**Defaults**: library `searchNodes` default = `keyword` (byte-identical to today — FR-001/003). Explicit surfaces (`codegraph_search`, CLI `query`) default unspecified → `auto` (FR-002).

**Validation**: an unknown mode string at an explicit surface resolves to `auto` (never an error); the library API accepts only the four values.

---

## E2 — SearchOptions (extended, plumbing)

Existing (`src/types.ts:391`): `{ kinds?, languages?, includePatterns?, excludePatterns?, limit?, offset?, caseSensitive? }`.

**Added field**: `mode?: SearchMode` (optional; default `keyword` when omitted).

**Rules**:
- `kinds` / `languages` (and inline `kind:` / `lang:`) **pre-filter the vector scan before top-k** (FR-010). Cache rows carry `kind`+`language` for this.
- Inline `path:` / `name:` remain **post-fusion hard gates** (FR-010), identical semantics across all modes (FR-016).
- The semantic arm's embed input is the parsed query text with filter tokens stripped (FR-011).
- No new option beyond `mode` — embed budget / cache size are internal constants, not options (FR-007).

---

## E3 — SearchResult (optionally extended, plumbing)

Existing (`src/types.ts:417`): `{ node: Node; score: number; highlights?: string[] }`.

**Added optional fields (semantic/hybrid modes ONLY)**:

| Field | Type | When present | Rule |
|-------|------|--------------|------|
| `matchType` | `'keyword' \| 'semantic' \| 'both'` | semantic/hybrid only | Reflects which arm(s) contributed a rank to the fused score (FR-012, Clarify S1-Q2). |
| `fusedScore` | `number` | semantic/hybrid only | The rank-only RRF value (FR-004). Surfaced in CLI `--json` only; never in human output (FR-012). |

**Byte-identical invariant (SC-004)**: in `keyword` mode these fields MUST be **absent** — not `undefined`. Existing `{ node, score, highlights? }` shape is unchanged for every existing consumer. The FR-014(b) gate asserts field *absence* via structural deep-equal + explicit absence checks.

---

## E4 — Vector matrix cache (in-memory, runtime)

A lazily-built, single-owner (main daemon process) structure — one per `(project root, active stored model id)`.

| Component | Type | Notes |
|-----------|------|-------|
| `matrix` | `Float32Array` | `count × dims` row-major, single precision; decoded via `decodeVector` (FR-009). |
| per-row `nodeId` | `string[]` | Aligns matrix rows to node ids (RRF + gates). |
| per-row `kind` | `NodeKind[]` | For `kind:`/`options.kinds` pre-filter (FR-010). |
| per-row `language` | `Language[]` | For `lang:` pre-filter (FR-010). |
| `model` | `string` | The stored model id scanned (`local:Xenova/...` for local; raw for endpoint — see research D6). |
| `dims` | `number` | Row width. |
| staleness key | derived | `(matching-model vector count, embedding_model, embedding_dims)` from `getEmbeddingCoverage` + `project_metadata` (research D6a — there is no `data_version` column). |

**Lifecycle**: built on first semantic query; a cheap per-query staleness probe compares the staleness key and rebuilds on change (FR-009). Resident memory = `count × dims × 4` bytes, documented (FR-009). Never duplicated per worker (research D7).

---

## E5 — Query embedding / provider (runtime)

The active `EmbeddingProvider` (`src/embeddings/provider.ts:21` — `{ id, dims, embed(texts) }`). The query vector = `provider.embed([filterStrippedQueryText])[0]`.

| Aspect | Rule | Source |
|--------|------|--------|
| Init | Lazy, on first hybrid-eligible query; first query served keyword + warming note. | FR-005 |
| Budget | Per-query embed wait capped at internal ~2s; timeout/failure → keyword + hint, never error. | FR-006 |
| Model id | Must equal the stored id the matrix scans on (else the arm silently zeroes). | research D6 |
| Test seam | A new module-level `__set…ForTests` query-provider swap (research D11); not reachable in production resolution. | FR-014 |

---

## E6 — Degradation condition → hint (state → literal string)

Exactly four degraded conditions; each renders one literal success-shaped footer string (FR-015 table). Model mismatch is **not** a fifth — it renders string 2.

| # | Condition | Detection | Hint string (literal, from spec FR-015 table) |
|---|-----------|-----------|-----------------------------------------------|
| 1 | No provider configured | `getEmbeddingStatus` dormant/misconfigured | `…semantic ranking is off — no embedding provider configured…` |
| 2 | No matching-model vectors (folds model mismatch) | matching-model vector count = 0 | `…no semantic vectors for the active model yet… Run \`codegraph sync\`…` |
| 3 | Provider warming | first query while lazy init in flight | `…semantic ranking is warming up…later queries will fuse.` |
| 4 | Embed timeout / provider failure | ~2s budget elapsed or `embed()` threw | `…semantic ranking failed or timed out this query…` |

Footer placement: appended **after** results (results lead, note follows), emitted **every** query while the condition holds (not one-shot) — FR-005. Full literal strings live in `contracts/degradation-hints.md`.

---

## E7 — Timing footer (semantic/hybrid, non-degraded only)

Rendered only when the semantic arm actually ran (FR-008): e.g. `semantic: embed 34ms · fusion 12ms`. Human-readable footer on both surfaces; the same `embed`/`fusion` ms additionally emitted as machine fields in CLI `--json`. **Omitted entirely** in keyword mode and under every degraded condition (byte-identical keyword/degraded output — SC-004).

---

## Determinism (cross-cutting, FR-013 / SC-006)

Node id = stable content hash of file path + qualified name (existing). Tie-breaks by **ascending node id** at BOTH levels: within each arm on equal per-arm scores (before fusion) and on equal fused scores (after fusion). Identical query + unchanged index ⇒ byte-identical ordering.
