# SPEC-003 — Hybrid Semantic Search · PR Review Packet

> **ADDENDUM (2026-07-10, post-review remediation — supersedes stale lines below):**
> - §8(a) is **RESOLVED**: the security-test mock was extended in commit `8f4004f`; the full
>   suite is green. §6's "2798 passed · 1 failed" is superseded — current full suite:
>   **2806 passed / 0 failed / 7 skipped** (165 files), re-confirmed by a fresh
>   Integration Suite pass (`.process/integration-suite.md`).
> - Post-implementation review suite ran AFTER this packet was authored, all green: verify
>   ext PASS (0 findings) · verify-tasks 0 phantoms (`.process/verify-tasks-report.md`) ·
>   retrieval-guardian PASS 6/6 (`.process/retrieval-guardian-report.md`) · independent code
>   review approve-with-comments. All findings remediated in commits `3f6ec9e`/`a2d5c77`
>   (+7 TDD tests): staleness token now includes a monotonic `vectors_write_version` (same-count
>   re-embeds/renames invalidate the matrix), FR-015 hint now also renders on degraded-and-empty
>   results, `resolveAutoMode` consolidated into production, SC-003 never-throw hardening,
>   dead stub + stale TODOs removed, stray eval artifacts removed (+ results/ gitignored).
> - hybrid-search.test.ts is now **84** tests (81 + 3 remediation additions); SPEC-003 suite
>   total 126 incl. surface additions.
> - Reviewability diff gate decision: **WARN — proceed as one navigable PR** (recorded in
>   `autopilot-state.json` `final_diff_gate` with justification; §4's overage stands).

**Branch:** `003-hybrid-semantic-search` → `main` (origin: racecraft-lab/codegraph)
**Task:** T033 (Phase 7 Polish). Generated from the live branch diff (`git diff main...HEAD`), the SPEC-003 spec/plan/tasks, the four SPEC-003 test suites, and the recorded T029 (scoped A/B) + T030 (dogfood UAT) evidence. Every number below is grounded in a command run or a file read; sources are cited inline.

> Satisfies the spec's **PR Review Packet Requirements** (spec.md §"PR Review Packet Requirements", lines 275–279): what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, rollback/flag notes; traceability maps each requirement/criterion to changed files + verification; deferred work names its follow-up.

---

## 1. What changed & why

**Query-time hybrid semantic search.** A natural-language or paraphrased query now surfaces the right symbols even when they share no literal tokens with what was typed, by fusing the existing FTS5 keyword arm with a brute-force cosine vector arm over the embeddings CodeGraph already builds (SPEC-001/002).

- **Fusion:** rank-only Reciprocal-Rank Fusion, `k=60` (roadmap constant). `fused(d) = Σ 1/(k + rank_arm(d))` — raw keyword scores and cosine magnitudes never enter the fused score, only per-arm ranks do (FR-004/004a). Each arm contributes a candidate pool of depth `max(5×limit, 100)` (`src/search/hybrid.ts`).
- **New `mode` parameter** — `keyword | semantic | hybrid | auto` — on three surfaces:
  - library `searchNodes` / `searchNodesDetailed` (`src/index.ts`) — **default `keyword`**, byte-identical to today when unspecified;
  - MCP `codegraph_search` (`src/mcp/tools.ts`) — default **`auto`**;
  - CLI `codegraph query --mode` (`src/bin/codegraph.ts:1244`) — default **`auto`**, help text `Search mode: keyword | semantic | hybrid | auto (default: auto)`.
  `auto` = hybrid when matching-model vectors exist, else keyword.
- **Provenance:** semantic/hybrid results carry optional `matchType` (`keyword`|`semantic`|`both`) + `fusedScore` (`src/types.ts`); surfaces render inline `[keyword]`/`[semantic]`/`[both]` tags and a `semantic: embed …ms · fusion …ms` footer when the semantic arm actually ran. Keyword-mode results carry **no** added fields (SC-004/SC-005).
- **Four literal degradation hint strings** (`src/search/hybrid.ts:305–311`), one per degraded condition — no provider / no matching-model vectors / warming / embed-failure-or-timeout. Every degraded path returns success-shaped keyword results + a footer note, **never** an `isError` (FR-015; Constitution VI).
- **Status line:** `codegraph status` reports a derived "Hybrid search available: yes/no (+reason)"; `status --json` gains two additive fields `hybridSearchAvailable` / `hybridSearchReason` (FR-017).
- **Dormant by default:** with no embedding provider configured (or no matching-model vectors), the feature is inert and keyword output is byte-identical to the pre-feature baseline (SC-004; verified §7).

**Why:** the roadmap's semantic-search milestone. Keyword FTS misses paraphrased/NL queries whose relevant symbol shares no tokens with the query; the deterministic probe in the A/B evidence shows exactly this — a query that keyword buries outside the top-6 is ranked #1 by semantic/hybrid (§6).

---

## 2. Non-goals (held — verified against the diff)

| Non-goal | Verification |
|---|---|
| `codegraph_explore` retrieval path untouched | `git diff main...HEAD -- src/mcp/tools.ts \| grep -c explore` → **0**. The explore budget/output functions and explore handler are not in the diff. |
| `server-instructions.ts` (agent-facing guidance) untouched | Not present in `git diff main...HEAD --stat`. The single-source-of-truth agent guidance is unchanged. |
| No ANN index / quantization | Brute-force cosine scan only (blessed in SPEC-001); ANN/quantization named as the scale follow-up (spec Assumptions; `hybrid.ts` header memory-envelope doc, T031). |
| No re-ranking model | Fusion is rank-only RRF; no model in the ranking path. |
| No new environment variables or tuning knobs | `git diff` of `src/` shows only pre-existing `CODEGRAPH_EMBEDDING_{URL,MODEL,PROVIDER}` (all present on `main` — from SPEC-002). Embed budget (~2s) and cache size are internal documented constants (FR-007). |
| No schema/migration | `git diff main...HEAD -- src/db/schema.sql` → **empty**. Schema v8 is byte-identical; both builds read the same DB with no migration (A/B evidence §1). |

---

## 3. Suggested review order

1. **`src/types.ts`** (+35) — `SearchMode` union, optional `matchType`/`fusedScore` result fields. The contract everything else implements.
2. **`src/search/hybrid.ts`** (+1044, new file) — the fusion engine: RRF merge, lazy in-memory matrix cache, staleness probe, the 4 degradation hint strings, `MAX_MATRIX_BYTES` guard, memory-envelope header doc. **The core of the review.**
3. **`src/index.ts`** (+550/−2) — `searchNodesDetailed`, `acquireQueryVectorForSearch` (the one async seam), the query-vector cache, status-availability derivation, mode dispatch. `searchNodes` delegates to `searchNodesDetailed(...).results`.
4. **`src/db/queries.ts`** (+40) — vector/coverage/scalar reads feeding the matrix build + staleness probe.
5. **`src/mcp/tools.ts`** (+68/−5) — `codegraph_search` `mode` arg, `resolveSearchSurfaceMode` (auto default), provenance/footer rendering. **See §8 known gap — the truncation test regression lives here.**
6. **`src/bin/codegraph.ts`** (+93/−6) — CLI `--mode`, `--json` timing fields, tags/footer.
7. **Tests** — `hybrid-search.test.ts` (fusion/gates), `hybrid-mcp-surface.test.ts`, `hybrid-cli-surface.test.ts`, `status-json.test.ts`.
8. **Eval + docs** — `__tests__/evaluation/{test-cases,types,runner}.ts` (paraphrase cases), `CHANGELOG.md`, `BUNDLING.md`, spec artifacts.

---

## 4. Scope budget — reported honestly (OVER budget)

Setup-gate projection (spec.md §"Reviewability Budget", lines 265–273): **~195 reviewable LOC**, **~4 production files**, projected "within budget."

**Actual production diff** (`git diff main...HEAD --numstat -- src/`):

| File | Raw added | Code-only added (excl. blank/comment) |
|---|---:|---:|
| `src/search/hybrid.ts` | 1044 | 406 |
| `src/index.ts` | 550 (−2) | 233 |
| `src/bin/codegraph.ts` | 93 (−6) | 44 |
| `src/mcp/tools.ts` | 68 (−5) | 28 |
| `src/db/queries.ts` | 40 | 28 |
| `src/types.ts` | 35 | 4 |
| **Total** | **1830 (−13)** | **743** |

**Result: over budget on every honest measure.** 6 production files vs ~4 projected. Raw added 1830 LOC ≈ **9.4×** the 195 estimate; even counting **code-only** (non-blank, non-comment) lines, 743 LOC ≈ **3.8×**. About 59% of the added lines are comments/docs — this branch is deliberately heavily annotated with inline rationale (FR/Clarify references), consistent with the design's documentation emphasis.

**Why the estimate missed:** the roadmap LOC estimator modeled "a thin vertical slice (query → fusion → surfaces)" and under-projected `hybrid.ts` (406 code-only lines alone). The real fusion module carries materially more logic than a thin slice: rank-only RRF, a lazy single-precision matrix cache with a single-owner invariant, a cheap per-query staleness probe, four distinct degradation conditions, an embed-budget cap with late-vector-discard discipline, and filter pre-/post-gating parity across three modes. This is stated plainly rather than massaged; the reviewer should budget accordingly. The design-concept slice-sizing decision (one spec, no split) still holds — it is a single coherent vertical slice — but its size is larger than the setup gate projected.

---

## 5. Traceability — requirement → changed files → verification

Test names verified by running the suites (`npx vitest run`); describe/it labels quoted verbatim.

| Requirement | Changed file(s) | Verification (suite › case) |
|---|---|---|
| **FR-001** mode param, library default `keyword`; unknown coerces | `types.ts`, `index.ts` | hybrid-search › "mode plumbing (T004)" a/b/c |
| **FR-002/002a** surfaces default `auto`; semantic = vector-only | `tools.ts`, `bin/codegraph.ts`, `hybrid.ts` | hybrid-search › "US2 mode behavior (T014)"; hybrid-mcp-surface; hybrid-cli-surface |
| **FR-003** internal callers keyword, zero embed | `index.ts` | hybrid-search › "mode plumbing (T004) b"; FR-014 zero-embed spy (T009) |
| **FR-004/004a** RRF `k=60`, rank-only | `hybrid.ts` | hybrid-search › "US2 mode behavior (T014)", "FR-014(a) hit-rate gate (T006)" |
| **FR-005** lazy warming, footer-after-results | `index.ts`, `hybrid.ts` | hybrid-search › US3 warming cases |
| **FR-006** ~2s embed budget, late-vector discard | `index.ts`, `hybrid.ts` | hybrid-search › "embed-budget cap + late-vector discard (T021) c" |
| **FR-007** no new env vars/knobs | `hybrid.ts` (internal consts) | `git diff` env-var check (§2); Constitution II check (plan.md) |
| **FR-008/008a/008b** p95 ≤150ms; matrix build; staleness probe | `hybrid.ts`, `db/queries.ts` | hybrid-search › "FR-014(c) p95 fusion-compute gate (T013)" — **observed p95 49.9ms** (§6); "vector matrix cache (T007)", "staleness probe (T008)" |
| **FR-009/009a/009b** single lazy matrix cache | `hybrid.ts` | hybrid-search › "vector matrix cache (T007)" |
| **FR-010** filters pre-filter vector arm | `hybrid.ts` | hybrid-search › "filter parity across modes (T027)" |
| **FR-011** embed input = filter-stripped query | `index.ts`, `hybrid.ts` | hybrid-search › "query-provider seam (T009)" |
| **FR-012** `matchType`+`fusedScore`, absent in keyword | `types.ts`, `tools.ts`, `bin/codegraph.ts` | hybrid-search › "US2 mode behavior (T014)"; surface suites |
| **FR-013** deterministic tie-break (ascending node id) | `hybrid.ts` | hybrid-search › "SC-006 … order-stable" |
| **FR-014** CI gates in `npm test` + eval cases | `hybrid-search.test.ts`, `evaluation/test-cases.ts` | hybrid-search › T006 (hit-rate), T013 (p95); `npm run eval` 4 new `hybrid-paraphrase-*` cases |
| **FR-015** degraded → success-shaped keyword + hint | `hybrid.ts` (4 strings :305–311) | hybrid-search › "US3 degradation signal (T018)"; hybrid-cli-surface; hybrid-mcp-surface |
| **FR-016** filter parity across modes | `hybrid.ts` | hybrid-search › "filter parity across modes (T027)" kind/path/name |
| **FR-017** status availability + json fields | `index.ts`, `db/queries.ts` | status-json.test.ts (5); hybrid-search › "SC-007 status/search truthfulness gate (T024)" |

| Success criterion | Verification |
|---|---|
| **SC-001** hybrid hit-rate ≥ keyword, non-vacuous | hybrid-search › "FR-014(a) hit-rate gate (T006) a" |
| **SC-002** p95 fusion ≤150ms @50k | hybrid-search › T013 — observed **p95 49.9ms**, median 22.4ms (§6) |
| **SC-003** 100% degraded paths success-shaped | hybrid-search › US3 (T018); no `isError` on any degraded condition |
| **SC-004** keyword byte-identical to baseline | hybrid-search › "mode plumbing (T004) a/b" + new-field-absence checks |
| **SC-005** all semantic/hybrid hits labeled | surface suites; hybrid-search T014 |
| **SC-006** deterministic ordering | hybrid-search › "SC-006 … order-stable" |
| **SC-007** status truthful vs actual auto outcome | hybrid-search › "SC-007 … truthfulness gate (T024)" 3 states |

---

## 6. Verification evidence

**SPEC-003 suites — all green (run 2026-07-10, `npx vitest run`):**

| Suite | Tests | Result |
|---|---:|---|
| `__tests__/hybrid-search.test.ts` | 81 | ✅ pass |
| `__tests__/hybrid-mcp-surface.test.ts` | 11 | ✅ pass |
| `__tests__/hybrid-cli-surface.test.ts` | 22 | ✅ pass |
| `__tests__/status-json.test.ts` | 5 | ✅ pass |
| **SPEC-003 total** | **119** | ✅ |

> Note: these grounded per-file counts (81 / 11 / 22 / 5) supersede the pre-run estimates in the task brief (81 / 12 / 30 / 5); the smaller numbers are the actual `Tests N passed` lines from vitest.

**Full suite (`npx vitest run`, 2026-07-10):** **2798 passed · 1 failed · 7 skipped** (165 files). ⚠️ **NOT fully green** — the single failure is a SPEC-003-introduced test regression; details in §8. This blocks the "full suite green" acceptance of T034 until fixed.

**Performance gate (FR-014c/SC-002):** T013 measured on a seeded 50k×384 fixture, fusion leg only (scan + top-k + RRF), N=200 iterations after 10-iteration warmup discard, nearest-rank p95 = `sorted[189]`:
`rows=50000 dims=384 k=100 warmup=10 iterations=200 → p95=49.882ms median=22.415ms min=19.939ms max=99.519ms budget=150ms` — **~3× headroom** to the 150ms gate. (The task brief's "19.9ms" was the *min*, not p95; the grounded p95 is 49.9ms. Run-to-run variance is real; report the range.)

**Scoped agent A/B (T029, `.process/ab-evidence.md`):** WORKTREE (new) vs MAIN (baseline) build, both codegraph-on, same embedded index, Sonnet `--effort high` floor, ≥2 runs/arm, HAL endpoint sourced so the semantic arm runs at query time.
- **Agent-level A/B: NULL** — ranges overlap; **Sonnet did not call `codegraph_explore` in any arm** (0 `mcp__codegraph__*` calls). This is the documented low-salience / Read-displacement wall (CLAUDE.md "Adapt the tool to the agent"), an agent-adoption result, not a retrieval-quality result — see §8(b).
- **Deterministic probe A/B: decisive feature win** — NL query for `loadEmbeddingConfig` precedence: BASE keyword-only and `NEW --mode keyword` both **MISS** (target outside top-6); `NEW --mode {semantic,hybrid,auto}` rank it **#1**. `NEW --mode keyword == BASE` byte-for-byte isolates the win to the new capability. Query-time cost ~embed 121ms · fusion 31ms.
- **Control (no-vectors, no-endpoint): zero delta** — dormant in both arms; deterministic dormancy control degrades to exactly the keyword results, no tags/footer, no crash.

**Dogfood UAT (T030, `.process/dogfood-uat.md`):** SPEC-003 run against **this repo's own live index** (492 files, 7,434 nodes, 4,630/4,630 vectors @100%, HAL endpoint) across CLI `--mode` and MCP `codegraph_search`:
- **Semantic recall: 4/4 paraphrase queries hit ground truth** (3 at rank 1), tagged `[semantic]` on both surfaces; keyword mode missed the same paraphrase (Q1 ground truth absent from keyword top-6). Recall reached pre-SPEC-003 code (Q4 daemon lifecycle).
- **Dormancy: confirmed** — env-scrubbed vector-less project returns keyword-only, zero provenance tags/footer, result rows **byte-identical** to explicit keyword mode; only the documented no-provider hint is appended on semantic-eligible modes (intended T022 contract). Exit 0, no crash, no daemon leak.

---

## 7. Rollback & feature-flag posture

- **Dormant by default.** The feature activates **only** when an embedding provider is configured **AND** at least one matching-model vector exists (the FR-002 auto predicate). Absent either, `auto`/`semantic`/`hybrid` degrade to keyword results (+ a hint) and output is byte-identical to the pre-feature baseline — proven deterministically in T030 §3 and the A/B dormancy control (§6).
- **No feature flag / env toggle is added** (FR-007). Activation rides entirely on the pre-existing SPEC-002 embedding env (`CODEGRAPH_EMBEDDING_*`). **Rollback = unset the embedding provider env** (feature goes inert, zero keyword regression) or **revert the branch**.
- **No migrations.** `schema.sql` is untouched (§2) — schema v8 is byte-identical; there is nothing to roll back at the DB layer. An index built on `main` and one built on this branch are interchangeable.

---

## 8. Known gaps & caveats (reported honestly)

**(a) ⚠️ Full-suite regression — MUST fix before merge (blocks T034).**
`__tests__/security.test.ts › MCP Input Validation › should truncate oversized tool output` (line 437) **fails** on this branch. Root cause is a SPEC-003 change, confirmed:
- On `main`, `handleSearch` called `cg.searchNodes(query, …)` (main `tools.ts:1505`), satisfied by the test's `fakeCg = { searchNodes: () => many }` mock → test passed.
- On this branch, `handleSearch` now `await cg.acquireQueryVectorForSearch(query)` (mode `auto` ≠ keyword) and calls `cg.searchNodesDetailed(query, …)` (`tools.ts:1544–1556`) — **methods the `fakeCg` mock does not implement** (they exist on the real `CodeGraph`: `index.ts:1865`, `:2091`). The mock throws → caught → `isError:true` → the assertion `expect(result.isError).toBeFalsy()` fails.
- The test body is **unchanged** by this branch (`git diff main...HEAD -- __tests__/security.test.ts` shows no edit in that region) — this is a production-path change breaking a pre-existing test whose mock was not updated. **Fix: extend the security test's `fakeCg` with `searchNodesDetailed` (and a no-op `acquireQueryVectorForSearch`), or have it pass `mode: 'keyword'`.** This is a genuine SPEC-003 defect in test coverage, not a pre-existing flake. Document-authoring task T033 does not touch it; flagging for the implement/remediation step.

**(b) Agent-level A/B was null — by adoption, not retrieval quality.** Sonnet (the deliberate floor model) under-picks codegraph tools and chose `grep`/`Read` in every arm (§6). The feature's value is demonstrated by the **deterministic probe** (keyword miss → rank-1 hit), not by agent adoption. Improving adoption is an agent-steering problem explicitly out of SPEC-003's scope (CLAUDE.md: the low-salience wall). Honest, and consistent with the documented retrieval-performance posture.

**(c) Eval semantic cases run on synthetic fixtures, not a large real corpus.** The `npm test` CI gates and the `npm run eval` paraphrase cases use injected deterministic fixture vectors / synthetic fixture corpora (CI has no live provider — spec Assumptions). A corpus-scale semantic eval on a large real-world repo is **future work**. The live-index dogfood (T030, this repo, 4,630 real vectors) partially covers this but is not a large-corpus benchmark.

**(d) Explore-side semantic fusion is deliberately deferred (named).** Wiring hybrid candidates into `codegraph_explore` is an explicit **non-goal** of SPEC-003 (it is the do-not-regress primary retrieval tool; touching it needs its own A/B gate against SPEC-003's real dogfood results). No existing roadmap spec owns it. **Follow-up:** after SPEC-003 merges and dogfood/A-B numbers exist, add a new **A/B-gated explore-fusion experiment spec** via `/speckit-pro:speckit-coach` (design-concept Open Questions **Q2/Q3**, `docs/ai/specs/.process/SPEC-003-design-concept.md:195–197`; spec.md line 279). Named here rather than silently omitted.

---

## 9. Reproduction

```bash
# SPEC-003 suites (all green: 119):
npx vitest run __tests__/hybrid-search.test.ts __tests__/hybrid-mcp-surface.test.ts \
  __tests__/hybrid-cli-surface.test.ts __tests__/status-json.test.ts

# p95 gate (logs observed p95):
npx vitest run __tests__/hybrid-search.test.ts -t "p95 of the fusion leg"

# The failing test (§8a):
npx vitest run __tests__/security.test.ts -t "should truncate oversized tool output"

# Scoped A/B + dogfood: see .process/ab-evidence.md and .process/dogfood-uat.md
```
