# feat(SPEC-003): hybrid semantic search — RRF fusion of keyword + vector search with graceful degradation

## ## What & why

**Query-time hybrid semantic search.** A natural-language or paraphrased query now surfaces the right symbols even when they share no literal tokens with the query, by fusing the existing FTS5 keyword arm with a brute-force cosine vector arm over the embeddings CodeGraph already produces (SPEC-001/002).

- **Fusion:** rank-only Reciprocal-Rank Fusion (`k=60`): `fused(d) = Σ 1/(k + rank_arm(d))` — raw scores never enter the fused score, only per-arm ranks. Per-arm candidate depth `max(5×limit, 100)`.
- **New `mode` parameter** (`keyword | semantic | hybrid | auto`) on three surfaces: library `searchNodes`/`searchNodesDetailed` (default `keyword` — byte-identical to today when unspecified), MCP `codegraph_search` (default `auto`), CLI `codegraph query --mode` (default `auto`). `auto` = hybrid iff matching-model vectors exist, else keyword.
- **Provenance:** semantic/hybrid results carry optional `matchType`/`fusedScore`; surfaces render `[keyword]`/`[semantic]`/`[both]` tags and a `semantic: embed …ms · fusion …ms` footer when the semantic arm ran. Keyword results carry no added fields.
- **Graceful degradation:** four literal hint strings (no provider / no matching-model vectors / warming / embed-failure-or-timeout). Every degraded path returns success-shaped keyword results + a footer hint — never `isError` (Constitution VI). Hints also render on degraded-and-empty results.
- **Freshness:** the resident vector matrix is invalidated by a `(count, model, dims, writeVersion)` staleness token — a monotonic `vectors_write_version` counter bumps on every vector write, so same-count re-embeds and 1-for-1 renames rebuild the matrix (long-lived daemons never serve stale rankings).
- **Status:** `codegraph status` reports "Hybrid search available: yes/no (+reason)"; `--json` gains additive `hybridSearchAvailable`/`hybridSearchReason`.
- **Dormant by default:** with no embedding provider configured (or no matching vectors), the feature is inert and keyword output is byte-identical to the pre-feature baseline.

**Why it matters (measured):** in the deterministic probe A/B, a paraphrase query for `loadEmbeddingConfig` precedence is **missed entirely** by baseline keyword search (outside top-6) and ranked **#1** by semantic/hybrid/auto. Dogfood UAT on this repo's live index (4,630 vectors): 4/4 paraphrase queries hit ground truth, 3 at rank 1 — including pre-SPEC-003 code.

TBD

## ## Non-goals (held — verified against the diff)

| Non-goal | Verification |
|---|---|
| `codegraph_explore` retrieval path untouched | zero explore-related lines in the `src/mcp/tools.ts` diff; budget/output functions absent from the changeset (retrieval-guardian check 1) |
| `server-instructions.ts` untouched | not in `git diff main...HEAD --stat` |
| No ANN index / quantization | brute-force cosine only; ANN named as the scale follow-up in the memory-envelope docs (BUNDLING.md) |
| No re-ranking model | fusion is rank-only RRF |
| No new env vars / tuning knobs | only pre-existing `CODEGRAPH_EMBEDDING_*` (SPEC-002); embed budget + cache size are internal documented constants |
| No schema change / migration | `schema.sql` byte-identical; freshness counter rides the existing metadata table |

TBD

## ## Suggested review order

1. `src/types.ts` — `SearchMode` union, optional `matchType`/`fusedScore` fields (the contract).
2. `src/search/hybrid.ts` (new) — the fusion engine: RRF merge, lazy matrix cache + staleness probe (write-version token), degradation hint strings, `MAX_MATRIX_BYTES` (1 GiB) guard, memory-envelope header doc. **The core of the review.**
3. `src/index.ts` — `searchNodesDetailed` dispatch, `acquireQueryVectorForSearch` (the one async seam: embed-budget race + late-vector discard), bounded query-vector LRU cache, `resolveAutoMode` wiring.
4. `src/db/queries.ts` — vector/coverage/scalar reads + the `vectors_write_version` bump on vector mutations.
5. `src/mcp/tools.ts` — `codegraph_search` `mode` arg, auto default, provenance/footer rendering (incl. empty-result hint).
6. `src/bin/codegraph.ts` — CLI `--mode`, `--json` timing fields, tags/footers, status availability line.
7. Tests — `hybrid-search.test.ts` (fusion + CI gates), `hybrid-mcp-surface.test.ts`, `hybrid-cli-surface.test.ts`, `status-json.test.ts`, extended `security.test.ts` fake.
8. Eval + docs — `__tests__/evaluation/*` paraphrase cases, CHANGELOG, BUNDLING.md, spec artifacts.

Full traceability (every FR/SC → changed files → verifying test) and grounded diff numbers: `specs/003-hybrid-semantic-search/.process/pr-review-packet.md`.

TBD

## ## Scope budget — over, reported honestly

Setup-gate projection was ~195 reviewable LOC / ~4 production files. Actual: **1,830 raw added production LOC (743 code-only, excl. blank/comment) across 6 files** — ~59% of added lines are inline rationale/docs by design. The estimator modeled a thin slice; the real fusion module (RRF + matrix cache + staleness + four degradation conditions + embed-budget discipline + filter parity) is inherently larger. The reviewability diff gate decision is **WARN — proceed as one navigable PR** (single coherent vertical slice, dormant by default, no releasable partial split point); decision + justification recorded in `docs/ai/specs/.process/autopilot-state.json` (`final_diff_gate`). Budget your review time accordingly — the review-order section above is the mitigation.

TBD

## ## Verification

- **Full suite:** `npm test` → **2806 passed / 0 failed / 7 skipped** (165 files). Build + typecheck clean.
- **SPEC-003 suites:** hybrid-search 84 · mcp-surface 13 · cli-surface 24 · status-json 5 (all green; counts include post-review remediation tests).
- **CI gates (FR-014):** hybrid hit-rate ≥ keyword (non-vacuous decoy fixture), semantic-only case strictly greater, keyword byte-stability, deterministic ordering, **p95 fusion 49.9–85.2ms across runs vs 150ms budget** on the seeded 50k×384 fixture.
- **Post-implementation review suite (all green):** verify extension PASS (0 findings, 17/17 FRs traced) · verify-tasks fresh-session phantom check: **0 phantoms** (34/34 tasks verified from evidence) · **retrieval-guardian PASS 6/6** (explore path untouched, success-shaped degradation, no Read-steering, keyword byte-stability, bounded embed latency ≤2s, server-instructions untouched) · independent code review: approve-with-comments — **all findings remediated** (+7 TDD tests), incl. the staleness write-version fix and SC-003 never-throw hardening.
- **Scoped A/B (evidence: `specs/003-hybrid-semantic-search/.process/ab-evidence.md`):** deterministic probe decisive (keyword miss → semantic/hybrid rank 1); dormant control zero-delta; agent-level arm null — see Known gaps.
- **Dogfood UAT (`.process/dogfood-uat.md`):** 4/4 paraphrase recall on this repo's live index via CLI **and** MCP `codegraph_search`; dormancy byte-parity on an env-scrubbed project confirmed.

TBD

## ## Self-Review findings (non-blocking, recorded for reviewers)

- `[edge-case-gap]` US1 scenario 1 / SC-001: the hit-rate gate proves fused>keyword via an inline decoy fixture; no standalone adversarial test of the scenario.
- `[edge-case-gap]` US2 scenario 2 (auto + vectors present → hybrid): proven at library level; neither surface test suite seeds vectors, so no MCP/CLI test covers it. Mitigation: the T030 dogfood UAT exercised exactly this on the live MCP surface (auto/hybrid → `[both]` tags + timing footer on a real 4,630-vector index).
- `[edge-case-gap]` SC-002 p95: perf gate has no natural failure branch; the FR-009c memory-guard tests protect the budget under oversized input.
- `[tidiness]` deliberate keep: the async matrix-cache pair `getVectorMatrix`/`getVectorMatrixForProbe` (hybrid.ts) has test-only consumers after the sync pivot (production uses `getVectorMatrixSync`); the build-once/thundering-herd tests exercise real memoization logic through them. Removal = test rework for zero behavior gain — reviewer's call.

TBD

## ## Known gaps & follow-ups (named, not silent)

- **Agent-level A/B null by adoption, not retrieval quality:** Sonnet (the deliberate floor model) never picked codegraph tools in either arm — the documented low-salience wall. Feature value is demonstrated by the deterministic probe + dogfood UAT. Improving adoption is agent-steering work, out of SPEC-003 scope.
- **Corpus-scale eval:** the scored `npm run eval` requires an `EVAL_CODEBASE` pointing at an indexed Elasticsearch clone (pre-existing framework assumption; no local corpus). FR-014's CI evidence stands on the deterministic vitest gates. A large-real-corpus benchmark is future work.
- **Explore-side semantic fusion deliberately deferred:** wiring hybrid candidates into `codegraph_explore` is a named follow-up (A/B-gated experiment spec via the roadmap, per design-concept Open Questions Q2/Q3) — the explore path is the do-not-regress primary tool and was left untouched here.

TBD

## ## Rollback & flags

Dormant by default: activates only when an embedding provider is configured AND matching-model vectors exist. No feature flag or new env var — activation rides the pre-existing SPEC-002 `CODEGRAPH_EMBEDDING_*` env. **Rollback = unset the embedding env** (feature goes inert; keyword behavior is byte-identical to baseline, proven by the dormancy controls) or revert the branch. No migrations: `schema.sql` untouched; indexes built on `main` and on this branch are interchangeable.

TBD
