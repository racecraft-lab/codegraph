# Verify-Tasks Report — SPEC-003 Hybrid Semantic Search

**Date**: 2026-07-10
**Scope**: `all` (branch `003-hybrid-semantic-search` diff vs `main`, merge-base `7c63234`)
**Tasks checked**: 34 of 34 `[X]` tasks in `specs/003-hybrid-semantic-search/tasks.md`

> ⚠️ **FRESH SESSION ADVISORY**: This run was executed in a separate agent
> session from the one that performed `/speckit.implement`, per the tool's
> reliability guidance.

## Summary scorecard

| Verdict | Count |
|---|---|
| ✅ VERIFIED | 33 |
| 🔍 PARTIAL | 1 |
| ⚠️ WEAK | 0 |
| ❌ NOT_FOUND | 0 |
| ⏭️ SKIPPED | 0 |

## Method

- Read `git diff main...HEAD` (41 files, +9193/−86) and cross-referenced every
  task's named files/symbols against it.
- Read `src/search/hybrid.ts` (1045 lines) and the relevant sections of
  `src/index.ts` (searchNodes/searchNodesDetailed/runFusedSearch/
  acquireQueryVectorForSearch, ~450 lines) in full — not excerpts.
- Ran `npx vitest run __tests__/hybrid-search.test.ts` (81/81 pass, including
  the T006 hit-rate gate and T013 p95 gate — observed p95 20.2ms, well under
  the 150ms budget).
- Ran `npx vitest run __tests__/hybrid-cli-surface.test.ts
  __tests__/hybrid-mcp-surface.test.ts __tests__/security.test.ts` (115/115
  pass, 2 skipped) — confirms the T033-flagged `security.test.ts` mock
  regression was actually fixed (commit 8f4004f), not just claimed.
- Ran the **full suite**: `npx vitest run` → **165 files, 2799 passed, 0
  failed, 7 skipped** — matches T034's claimed "2799/0/7" exactly.
- Ran `npm run typecheck` → clean, zero errors.
- Live-smoke-tested the CLI against this worktree's own `.codegraph/` index
  with the embedding env scrubbed: `query --mode auto` correctly appends the
  no-provider degradation hint; `query --mode keyword` renders no footer;
  `status` prints `Hybrid search available: no (no embedding provider
  configured)` exactly as T023 specifies.
- Grepped for dead code (`grep -rn`, not `git grep`) on every task-named
  symbol.

## Flagged item

### T015 — 🔍 PARTIAL

**Task**: Implement the shared `auto`-resolution predicate `resolveAutoMode`
in `src/search/hybrid.ts` (surfaced via `src/index.ts`).

**Evidence gap**: `resolveAutoMode` is correctly implemented
(`src/search/hybrid.ts:148`) and correctly unit-tested
(`__tests__/hybrid-search.test.ts:2380-2389`, 5 cases, all passing). However
it is **never imported or called by any production file** —
`grep -rn "resolveAutoMode" --include="*.ts" .` outside the definition site
returns only the test file. Production `auto`-mode resolution instead runs
through a **different, duplicated code path**: `searchNodesDetailed`
(`src/index.ts:1865-1876`) resolves `auto` straight to `hybrid` and lets
`runFusedSearch` (`src/index.ts:1892-2021`) reach the same outcome via its own
inline checks (`provider === null` → keyword, `probe.count === 0` → keyword),
and the FR-017 status line (`deriveHybridSearchAvailability`,
`src/bin/codegraph.ts`) implements a third, separately-written copy of the
identical `providerConfigured && matchingVectorCount >= 1` logic.

Functionally the end-to-end behavior is correct and verified (SC-007
truthfulness gate passes; dogfood UAT confirms `auto` resolves correctly on a
live index) — this is **not** a phantom feature, the behavior works. But the
specific deliverable T015 names (the exported, reusable predicate function)
is dead code in production: three independent implementations of the same
boolean now exist instead of one shared one, which is what T015's acceptance
criterion ("same predicate as the FR-017 status line") called for literally
(same *function*, not just equivalent logic).

**Per-layer detail**:

| Layer | Result | Note |
|---|---|---|
| L1 File existence | positive | `src/search/hybrid.ts`, `src/index.ts` both present |
| L2 Git diff | positive | both files in the branch diff |
| L3 Content pattern | positive | `resolveAutoMode` defined, `AutoResolveInput`/`ResolvedSearchMode` types present |
| L4 Dead-code | negative | zero production-file references outside its own definition; only the test file calls it |
| L5 Semantic | positive | the function itself is genuinely implemented (not a stub) and the *behavior* it describes is independently proven correct elsewhere |

Net: mechanical L4 `negative` + L1-L3/L5 `positive` → **PARTIAL** per the
verdict table (at least one mechanical layer positive AND at least one
negative).

## Verified items (33)

| Task | Verdict | Summary |
|---|---|---|
| T001 | ✅ VERIFIED | Baseline confirmed; all named plumbing targets present |
| T002 | ✅ VERIFIED | `SearchMode`, `SearchOptions.mode`, `SearchResult.matchType`/`fusedScore` in `src/types.ts`, fields optional/absent-when-unset |
| T003 | ✅ VERIFIED | `src/search/hybrid.ts` scaffold with `RRF_K`, `EMBED_BUDGET_MS`, `MAX_MATRIX_BYTES`, `LATENCY_FIXTURE_SEED`, `candidateDepth` |
| T004 | ✅ VERIFIED | `searchNodes(query, {mode})` plumbed through `src/index.ts`→`QueryBuilder`; keyword mode byte-identical, unknown mode coerces |
| T005 | ✅ VERIFIED | Reviewability decision recorded inline in tasks.md (2026-07-10) |
| T006 | ✅ VERIFIED | FR-014(a) hit-rate + SC-006 determinism gate present in `hybrid-search.test.ts`, passing |
| T007 | ✅ VERIFIED | `buildVectorMatrix`/`getVectorMatrix` single-owner memoizing cache, memory guard, thundering-herd protection — all present and unit-tested |
| T008 | ✅ VERIFIED | `probeVectorStaleness` bounded token read, wired into `runFusedSearch` |
| T009 | ✅ VERIFIED | `acquireQueryVector` + `__setQueryEmbeddingProviderForTests`/`__setQueryEmbeddingProviderFactoryForTests` seams in `src/index.ts` |
| T010 | ✅ VERIFIED | `semanticTopK` bounded min-heap with kind/lang pre-filtering, tie-break |
| T011 | ✅ VERIFIED | `rrfMerge` rank-only RRF, post-fusion path/name gates, ascending-id tie-break, pagination |
| T012 | ✅ VERIFIED | Wired via `runFusedSearch` (`src/index.ts:1892`); `matchType`/`fusedScore` populated in semantic/hybrid, absent in keyword. (Note: the `runHybridSearch`/`HybridSearchContext` stub left in `hybrid.ts:180-187` from the original scaffold is superseded, unused dead code — cosmetic, not a phantom; the real wiring path is `runFusedSearch`.) |
| T013 | ✅ VERIFIED | p95 gate present and passing — observed p95 20.2ms vs 150ms budget |
| T014 | ✅ VERIFIED | US2 mode-resolution tests present (`describe('hybrid search — US2 auto-resolution predicate (T014)'`), passing |
| T016 | ✅ VERIFIED | `mode` enum plumbed into `codegraph_search` MCP tool (`src/mcp/tools.ts`), coerces unknown to `auto`, never `isError` |
| T017 | ✅ VERIFIED | `-m, --mode` on CLI `query`, no commander `choices()`, coerces to `auto`, exit 0 on mistype |
| T018 | ✅ VERIFIED | Degradation tests for all 4 conditions present and passing |
| T019 | ✅ VERIFIED | 4 verbatim `DEGRADATION_HINT_STRINGS` present, exception wrapping confirmed in `runFusedSearch` |
| T020 | ✅ VERIFIED | Single-owner lazy init (`resolveQueryEmbeddingProvider`/`resetQueryEmbeddingProvider`) with init-failure reset |
| T021 | ✅ VERIFIED | Embed-budget race + late-vector discard (`attempt.timedOut` flag) in `acquireQueryVectorForSearch` |
| T022 | ✅ VERIFIED | Timing footer + provenance tags rendered in both `src/mcp/tools.ts` and `src/bin/codegraph.ts`, confirmed live via CLI smoke test and passing surface-test suites (minor: a stale leftover `TODO(T022)` comment sits directly above the code that already implements it in both files — doc hygiene nit, not a functional gap) |
| T023 | ✅ VERIFIED | `deriveHybridSearchAvailability` + `Hybrid search available:` line + `--json` fields, confirmed live (`status .` → `no (no embedding provider configured)`) |
| T024 | ✅ VERIFIED | SC-007 truthfulness gate present and passing across all 3 states |
| T025 | ✅ VERIFIED | FR-014(b) byte-stability gate + new-field-absence + zero-embed spy present |
| T026 | ✅ VERIFIED | Keyword path is zero-touch by construction (`searchNodesDetailed` early-returns before any provider/probe/cache work for `mode === 'keyword'`) |
| T027 | ✅ VERIFIED | Filter-parity assertions (`kind:`/`lang:`/`path:`/`name:`) present across all 3 modes |
| T028 | ✅ VERIFIED | 4 new `hybrid-paraphrase-*` cases + optional `mode` field in `EvalTestCase`/`test-cases.ts`/`runner.ts` |
| T029 | ✅ VERIFIED | `.process/ab-evidence.md` (216 lines) + `.process/ab-spec003.sh` — real recorded numbers, deterministic probe evidence, honest null-result reporting for the agent-adoption arm |
| T030 | ✅ VERIFIED | `.process/dogfood-uat.md` (92 lines) — 4/4 paraphrase recall on this repo's live index, dormancy byte-parity check, both CLI and MCP surfaces exercised |
| T031 | ✅ VERIFIED | Memory-envelope math in `hybrid.ts` header (lines 18-37) and `BUNDLING.md` (`## Query-time memory: the semantic search matrix`) |
| T032 | ✅ VERIFIED | CHANGELOG.md `[Unreleased]` entry, user-facing wording, no internal paths/symbols |
| T033 | ✅ VERIFIED | `.process/pr-review-packet.md` (181 lines) — full traceability table, honestly reports the scope-budget overage and (now-fixed) security-test regression |
| T034 | ✅ VERIFIED | `npm run typecheck` clean; full suite reproduces the claimed 2799 passed / 0 failed / 7 skipped exactly; quickstart CLI smoke scenarios reproduced live |

## Unassessable items (SKIPPED)

None — every task carried verifiable file/symbol/behavioral evidence.

## Machine-parseable verdict lines

| T001 | ✅ VERIFIED | Baseline + target files confirmed |
| T002 | ✅ VERIFIED | Type surface added, additive |
| T003 | ✅ VERIFIED | hybrid.ts scaffold + constants |
| T004 | ✅ VERIFIED | searchNodes mode plumbing |
| T005 | ✅ VERIFIED | Reviewability checkpoint recorded |
| T006 | ✅ VERIFIED | FR-014(a)/SC-006 gate passing |
| T007 | ✅ VERIFIED | Vector matrix cache |
| T008 | ✅ VERIFIED | Staleness probe |
| T009 | ✅ VERIFIED | Query-vector acquisition + test seam |
| T010 | ✅ VERIFIED | Cosine top-k heap |
| T011 | ✅ VERIFIED | Rank-only RRF merge |
| T012 | ✅ VERIFIED | Wired into searchNodes via runFusedSearch |
| T013 | ✅ VERIFIED | p95 gate passing (20.2ms observed) |
| T014 | ✅ VERIFIED | US2 mode-resolution tests |
| T015 | 🔍 PARTIAL | resolveAutoMode implemented+tested but dead in production (3 duplicated inline implementations instead) |
| T016 | ✅ VERIFIED | MCP mode plumbing |
| T017 | ✅ VERIFIED | CLI --mode flag |
| T018 | ✅ VERIFIED | Degradation tests, 4 conditions |
| T019 | ✅ VERIFIED | 4 hint strings + catch-all wrapping |
| T020 | ✅ VERIFIED | Lazy warming + init-failure reset |
| T021 | ✅ VERIFIED | Embed-budget cap + late-vector discard |
| T022 | ✅ VERIFIED | Timing footer + provenance tags rendered |
| T023 | ✅ VERIFIED | Status availability line, confirmed live |
| T024 | ✅ VERIFIED | SC-007 truthfulness gate |
| T025 | ✅ VERIFIED | FR-014(b) byte-stability gate |
| T026 | ✅ VERIFIED | Keyword path zero-touch |
| T027 | ✅ VERIFIED | Filter-parity assertions |
| T028 | ✅ VERIFIED | Eval harness paraphrase cases |
| T029 | ✅ VERIFIED | Scoped A/B evidence recorded |
| T030 | ✅ VERIFIED | Dogfood UAT evidence recorded |
| T031 | ✅ VERIFIED | Memory envelope documented |
| T032 | ✅ VERIFIED | CHANGELOG entry |
| T033 | ✅ VERIFIED | PR review packet |
| T034 | ✅ VERIFIED | Full verify reproduced (2799/0/7, clean typecheck) |
