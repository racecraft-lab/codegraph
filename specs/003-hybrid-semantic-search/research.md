# Phase 0 Research: Hybrid Semantic Search

All decisions below are settled by the clarify-refined spec (FR-001…FR-017) and the SPEC-003 Design Concept (Q1–Q10). This document consolidates them into the resolved-decision format and records the remaining implementation research (cache ownership, tie-break identity, test seams). **Zero unresolved clarification markers remain** — the three clarify sessions closed them.

---

## D1 — Mode plumbing & default (FR-001/002/003, Q1)

- **Decision**: `searchNodes({mode})` accepts `keyword | semantic | hybrid | auto`; the **library default is `keyword`** (byte-identical to today). An `auto`-resolution helper — hybrid when matching-model vectors exist, else keyword — is invoked **only** by the explicit surfaces (`codegraph_search` MCP tool, CLI search) and by explicit opt-in callers.
- **Rationale**: Dormancy discipline (Constitution VII + Dogfooding). Internal callers (explore, prompt hook, context builder) keep keyword behavior with zero query-embed latency and no shape change (FR-003) — no silent retrieval change to the PRIMARY tool (Constitution VI).
- **Alternatives rejected**: `searchNodes` defaulting to auto-hybrid globally — matches roadmap phrasing literally but silently upgrades every internal caller (a retrieval-affecting change requiring full A/B) and adds a per-call embed tax.

## D2 — Semantic mode is vector-arm-only (FR-002a, Clarify S1-Q5)

- **Decision**: Pure `semantic` mode runs the vector (KNN) arm **only**. It does NOT fold in FTS5 exact-name / keyword supplement hits, and MAY omit an exact-name symbol absent from the vector arm's top-k. Exact-name recall is the job of `keyword`/`hybrid` (and therefore `auto` when vectors exist).
- **Rationale**: Keeps the arms cleanly separable and the fusion rank-only; matches US2 Acceptance Scenario 4.

## D3 — Fusion algorithm: rank-only RRF (FR-004/004a, Clarify S1-Q1/Q2/Q4)

- **Decision**: Hybrid fuses the keyword arm and the vector arm with reciprocal-rank fusion, `k=60`:
  `fused(d) = Σ over each arm surfacing d of 1/(k + rank_arm(d))`, `rank_arm` = 1-based rank in that arm's ordered candidate list. Keyword arm rank = its existing post-rescore order; semantic arm rank = descending cosine similarity. **Raw keyword scores and cosine magnitudes never enter the fused score — only ranks.** Each arm contributes depth `max(5×limit, 100)` (the keyword arm's existing over-fetch depth). Final list ordered by fused score descending, truncated to `limit`.
- **FR-004a**: The keyword arm's multi-signal rescoring (kindBonus + pathRelevance + nameMatchBonus) determines **only that arm's internal rank** prior to fusion. Per-signal bonuses MUST NOT be re-applied to the fused union after RRF.
- **Rationale**: Rank-only RRF is scale-free across arms with incomparable score magnitudes; reusing the keyword arm's existing depth avoids restructuring `QueryBuilder.searchNodes`.
- **Alternatives rejected**: Weighted score fusion (needs cross-arm score normalization — fragile); re-applying bonuses post-fusion (double-counting, non-deterministic ordering).

## D4 — Query-embed lifecycle: lazy init + keyword-while-warming (FR-005/006, Q4)

- **Decision**: The query-time provider initializes **lazily on the first hybrid-eligible query**; that query is served keyword-only with a success-shaped "semantic warming" note (hint string 3). Later queries fuse once ready. The per-query embed wait is capped at an internal **~2s budget**; on timeout or provider failure → keyword + hint (string 4), **never `isError`**.
- **Rationale**: Nothing spent until first use (dormancy). The local ONNX provider can take ~45s to spawn+load (incl. first-ever model download) — blocking the first query would teach abandonment (Constitution VI). Errors-teach-abandonment ⇒ every degraded path is success-shaped.
- **Alternatives rejected**: Pre-warm on daemon start (resident model in every session even when search unused); block first query on init (up to 45s stall).

## D5 — Latency gate scope: fusion compute only (FR-008, Q5)

- **Decision**: The p95 ≤150 ms @ 50k gate covers **fusion compute only** = vector scan + top-k selection + RRF merge. The query-embed leg is **reported** (footer + CLI `--json` machine fields) but **not gated**. Footer e.g. `semantic: embed 34ms · fusion 12ms`, rendered **only when the semantic arm actually ran** (semantic/hybrid mode, available non-degraded provider). Footer + machine fields **omitted entirely** in keyword mode and under every degraded condition, so keyword/degraded output stays byte-identical (SC-004).
- **Rationale**: Fusion compute is deterministic and fixture-measurable in CI regardless of provider; the embed leg varies by operator infra and already has the ~2s budget + fallback — gating it would fail builds on infrastructure, not code.

## D6 — Vector source: lazy in-memory matrix cache + staleness probe (FR-009, Q6)

- **Decision**: On the first semantic query, decode all vectors whose stored `model` equals the active provider's stored model id into one single-precision (`Float32Array`) matrix, carrying per-row `kind` and `language` (joined from `nodes`) for pre-filtering. Invalidate per query with a cheap **staleness probe** (see the reconciliation below). Resident memory = `count × dims × 4` bytes, documented in code comments + BUNDLING/docs.
- **Model matching (precise)**: the scan filters `node_vectors.model = <active stored model id>`. **Storage-id nuance (from code facts)**: the endpoint provider stores under its raw `CODEGRAPH_EMBEDDING_MODEL`; the **local provider stores under `LOCAL_VECTOR_MODEL = 'local:Xenova/all-MiniLM-L6-v2'`** (not the bare `id`). The matrix scan and the FR-002/FR-017 predicate MUST match on the **stored** id, or the arm silently zeroes. Zero matching vectors → keyword + hint (string 2), following the SPEC-001/002 re-embed-on-switch precedent.
- **Vector decode**: reuse `decodeVector(blob, dims)` from `src/embeddings/indexer-hook.ts` (LE f32, throws if `byteLength !== dims*4`).
- **Memory envelope**: dogfood repo ≈4.5k×3584 ≈64 MB; bundled ONNX 50k×384 ≈77 MB; documented corner 50k×3584 ≈717 MB → quantization/ANN is the already-named follow-up.
- **Alternatives rejected**: budgeted cache + streaming fallback (second scan path + threshold to test; fallback misses p95 anyway); always stream from SQLite (hopeless at 50k×3584).

### D6a — Staleness-probe reconciliation (spec "data_version" vs. actual schema)

- **Finding (code facts)**: `node_vectors` has columns `node_id, model, dims, vector, input_hash` — **there is NO `data_version` column** anywhere in `src/`. The spec's "vector count + data_version" names a *logical* staleness token, not a literal column.
- **Decision**: Implement the probe as **(vector count for the active model) + (a version anchor from `project_metadata`)**. Concretely: `getEmbeddingCoverage(activeModel)` (`queries.ts:2489`) already returns `{ embeddable, embedded }` via matching-model JOIN counts — `embedded` is the matching-model vector count. `project_metadata` (`schema.sql:202`, `key/value/updated_at`) holds `embedding_model` + `embedding_dims` scalars; its `updated_at` (and/or the model/dims scalars) is the closest existing "data_version" anchor. The probe hashes/compares `(embedded_count, embedding_model, embedding_dims)` — cheap, no new column, no schema write (dormancy preserved). If a monotonic write-version is later wanted, it is a follow-up, not required for correctness here (count+model+dims already detect every re-embed/model-switch/add/remove that changes the matrix).
- **Rationale**: Honors Constitution VII (no schema write for a read feature) and III (no upstream schema churn). The spec's intent — "detect the index changed and rebuild" — is fully met by count+metadata.

## D7 — Cache ownership relative to the daemon query pool (Architecture note; FR-009)

- **Research finding (code facts)**: The daemon answers queries through a `worker_threads` pool (`query-pool.ts`); **each `PoolWorker` opens its OWN `CodeGraph` → `QueryBuilder` → SQLite handle in a separate V8 isolate** (`query-worker.ts:47-56`). A plain JS matrix built inside a worker is therefore **duplicated once per worker** (N copies of 64–717 MB) — explicitly disallowed by the workflow prompt.
- **Decision (pick ONE owner)**: The matrix cache is a **lazily-built module-level singleton owned by the main daemon process, keyed by `(project root, active stored model id)`** — exactly ONE resident matrix per project. The semantic/hybrid arm's matrix-bearing step (vector scan + top-k + RRF) is served by that single owner; the keyword arm continues to run unchanged (in the pool). Building/holding the matrix once in the main process avoids per-worker duplication with the **smallest diff to the upstream-owned pool files** (Constitution III) and stays within the ≈195-LOC / ≈4-file budget.
- **RSS impact**: `count × dims × 4` bytes, once per project, resident in the daemon main process — documented in `src/search/hybrid.ts` header + BUNDLING/docs (FR-009).
- **Binding invariant**: the matrix is **never duplicated per worker**, in any wiring.
- **Documented scale-up alternative (not adopted now)**: back the matrix with a `SharedArrayBuffer` built once in the main process and handed to workers via the existing `workerData` handoff (`query-pool.ts:167`) so workers do the cosine math in parallel over shared bytes. Rejected for v1 because it adds non-trivial plumbing to upstream-owned pool files and exceeds the simplicity/budget envelope; it is the natural next step if main-loop contention is ever measured to matter (semantic search is low-QPS user-typed search, so a ≤150 ms occasional main-loop step is acceptable today).
- **Rationale**: Simplicity (one cache, minimal upstream diff) + the p95 budget (rebuilding per worker per query cannot hit 150 ms). Constitution II/III.

## D8 — Filter interaction (FR-010/011/016, Q7)

- **Decision**: `kind:` / `lang:` / `options.kinds` **pre-filter the vector scan before top-k** (cache rows carry kind+language), so filtered-out rows never consume top-k slots. `path:` / `name:` remain **post-fusion hard gates**. The semantic arm's embed input is the **parsed query text with filter tokens stripped**, mirroring how FTS receives it. All four filters keep byte-identical semantics across keyword/semantic/hybrid (FR-016, SC-004).
- **Edge**: a fully-filtered scan yields keyword-only fusion input (never starves top-k with filtered rows); an empty embed input (query was only filter tokens) ⇒ semantic arm contributes nothing, results fall back to keyword.

## D9 — Result provenance (FR-012, Q8)

- **Decision**: In semantic/hybrid modes only, each `SearchResult` gains an optional `matchType: 'keyword' | 'semantic' | 'both'` plus the fused RRF score. **Absent in keyword mode** (byte-identical existing shape — SC-004). `matchType` reflects which arm(s) contributed a rank to the fused score. Rendering: both surfaces append an inline bracket tag (`[keyword]`/`[semantic]`/`[both]`) to each hit's primary line in semantic/hybrid modes only; the **fused score appears only in CLI `--json`**, never in human-readable output.

## D10 — Deterministic tie-breaks (FR-013, SC-006, Constitution V)

- **Decision**: Ties broken by **ascending node id** (a stable content hash of file path + qualified name) at **BOTH levels**: within each arm's ranking on equal per-arm scores (before fusion) and on equal fused scores (after fusion). Identical query + index ⇒ byte-identical ordering.
- **Rationale**: RRF can produce equal fused scores (e.g., a doc surfaced at the same rank by both arms); without a stable secondary key, ordering would depend on iteration/insertion order. Node id is already stable and content-derived.

## D11 — CI gates & fixtures (FR-014, SC-001/SC-002, Clarify S3, Assumptions)

- **Decision**: A new top-level `__tests__/hybrid-search.test.ts` (picked up by the `__tests__/**/*.test.ts` vitest include; `__tests__/evaluation/` has no `*.test.ts` and is excluded from `npm test`) asserts three clauses with **no live provider**:
  - **(a) Hit-rate**: aggregate hybrid hit-rate ≥ aggregate keyword hit-rate over a ≥3-case paraphrase fixture including ≥1 semantic-only case; that semantic-only case's own aggregate contribution asserted **strictly greater** under hybrid than keyword (non-vacuous). Also assert the **semantic arm alone** surfaces the target for that case.
  - **(b) Byte-stability**: existing keyword cases structurally deep-equal on the same fixture graph, PLUS explicit **new-field-absence** checks (`matchType`/fused score absent, not `undefined`); internal callers make **zero** query-embed calls (spy on the query-provider seam). Asserted independently of clause (a).
  - **(c) p95**: generated 50k×384-dim fixture, fusion leg only, `performance.now()`, fixed 10-iteration warmup discard, N=200 timed iterations, nearest-rank p95 = `sorted[Math.ceil(0.95*200)-1] = sorted[189]`, single `expect(p95).toBeLessThanOrEqual(150)`, no retry.
- **Two injection seams** (Clarify S3-Q1, neither reachable in production resolution):
  1. Stored vectors seeded directly into `node_vectors` via the existing little-endian f32 codec (`upsertNodeVector`), hand-built unit-normalized, under the **exact model id the test-only query-provider seam reports** (mismatch would zero the semantic arm and pass the gate vacuously).
  2. A single named **test-only query-provider seam** mirroring the existing module-level test-injection precedent. **Code-facts note**: today's provider seams (`__setLocalProviderOverridesForTests` at `src/index.ts:310`; the `runEmbeddingPass({ provider })` constructor injection) cover the *indexing* side only — **no search-side provider-swap seam exists yet**. SPEC-003 ADDS one new module-level `__set…ForTests`-style seam (same shape/teardown discipline as `__setLocalProviderOverridesForTests`) that swaps the query-time `EmbeddingProvider` used by the hybrid arm; it is never reachable in production config resolution (`loadEmbeddingConfig`).
- **Latency fixture**: 50k×384 generated in-memory from a **seeded deterministic pure-JS PRNG** with a documented seed constant — no committed binary asset, no `Math.random`.
- **Non-tautology (Assumptions)**: the semantic-only target's `name` and every `qualified_name` segment MUST NOT be an FTS5 token-prefix match for any paraphrase word — `nodes_fts` indexes `name`, `qualified_name`, `docstring`, `signature` under `unicode61` (no camelCase splitting), so all four columns must avoid the match. Include ≥1 decoy node that DOES token-match the query so the keyword arm returns a wrong result, not an empty one (keeping LIKE/fuzzy fallbacks dormant).
- **Eval harness**: `__tests__/evaluation/test-cases.ts` gains the same semantic/paraphrase cases for the scored `npm run eval` report; `EvalTestCase` gains an optional `mode` field to drive hybrid cases (Q9).

## D12 — Status availability line (FR-017, SC-007)

- **Decision**: `codegraph status` reports a derived query-side "Hybrid search available" line under the existing Embeddings block: `yes` when a provider is configured AND ≥1 vector matches the active provider's model (the FR-002 auto predicate); else `no` with a reason drawn from the same success-shaped vocabulary (no provider configured / no matching-model vectors). Derived **solely from the existing `getEmbeddingStatus` snapshot** — no new probe — and MUST NOT report live per-daemon provider warmth (transient / would be stale in a point-in-time snapshot).
- **Code-facts mapping**: `getEmbeddingStatus()` (`src/index.ts:1484`) returns a discriminated union — `EmbeddingStatusActive { active:true, provider, model, coverage:{ embedded, embeddable, percent } }` | `EmbeddingStatusDormant { active:false, activationVars }` | `EmbeddingStatusMisconfigured`. The availability predicate is purely a function of this snapshot: **`yes` ⟺ `status.active === true && status.coverage.embedded > 0`** (the active branch already keys coverage by the active/stored model, so `embedded > 0` means matching-model vectors exist). Reasons: dormant/misconfigured → "no provider configured"; active with `embedded === 0` → "no matching-model vectors". Printed under the existing `Embeddings:` block (`src/bin/codegraph.ts:1081-1124`) and included in `--json` status (`bin/codegraph.ts:1029`). No new probe, no daemon warmth.

## D13 — No new config surface (FR-007, Constitution II)

- **Decision**: No new environment variables or user-facing tuning knobs. The embed budget (~2s) and any cache sizing are **internal documented constants**.

## D14 — Pre-merge agent A/B (Q10, Constitution VI)

- **Decision**: `scripts/agent-eval/ab-new-vs-baseline.sh <indexed-repo> "<task>" [baseline-ref]` — new build vs baseline, **both arms codegraph-on**, ≥2 runs/arm, Sonnet floor — on an embedded repo with NL-flavored search prompts, PLUS a no-vectors control repo expecting **zero delta**. Results recorded in the UAT runbook. Plus the self-repo dogfood UAT: paraphrase NL queries through `codegraph_search` on this repo's live index (HAL endpoint), and the dormancy check that an unconfigured/vector-less project behaves byte-identically.

---

## Deferred (named, out of scope)

- **Explore-side semantic fusion** — hybrid candidates inside `codegraph_explore` is an explicit non-goal (Q2/Q3); has no owning roadmap spec yet. After SPEC-003 merges and dogfood/A-B numbers exist, add a new A/B-gated explore-fusion roadmap entry via `/speckit-pro:speckit-coach`. Recorded in the PR packet's deferred-work section.
- **ANN indexes / quantization** — roadmap out-of-scope; invoked only when scale demands (the 50k×3584 ≈717 MB corner).
- **Re-ranking models** — roadmap out-of-scope.
