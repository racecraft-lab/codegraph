---
description: "Task list for Hybrid Semantic Search (SPEC-003)"
---

# Tasks: Hybrid Semantic Search

**Input**: Design documents from `specs/003-hybrid-semantic-search/`
**Prerequisites**: plan.md, spec.md (FR-001…FR-017, incl. FR-002a/004a/006a/008a/008b/009a/009b/009c/003a/014d), research.md (D1–D14), data-model.md (E1–E7), contracts/ (search-api, mcp-cli-surface, degradation-hints)

**Tests**: TDD is REQUIRED for this feature (Constitution IV; FR-014 encodes failing-first CI gates). Every implementation slice is preceded by a failing test.

**Reviewability**: Budget = ≈195 reviewable LOC / ≈4 production files / ≈10 total files / one primary surface (API). A checkpoint (T005) verifies scope before implementation; stop and split if it expands beyond 800 LOC / 8 prod files / 25 total files / >1 primary surface.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 | US2 | US3 | US4 (maps to spec.md user stories)
- Every task names an exact file path.

## Bounds & Non-Goals (guardrails — flag any task that crosses these)

- **NO task may touch `codegraph_explore`'s retrieval path** (`src/mcp/tools.ts` explore handler, `src/context/`) — explore-side semantic fusion is an explicit non-goal (Q2/Q3; deferred to a named future roadmap entry).
- **NO ANN / quantization / re-ranker / new env vars** — brute-force scan reused; embed budget & cache size are internal documented constants (FR-007; Constitution II).
- **`searchNodes` library default stays `keyword`** — a task that changes internal-caller (explore / prompt hook / context builder) behavior is out of bounds (Q1; FR-003).
- All new production logic lands in `src/search/hybrid.ts`; every other production file gets **plumbing-only** diffs.

## Path Conventions

Single project — `src/` and `__tests__/` at repository root (worktree `.worktrees/003-hybrid-semantic-search/`). Tests use vitest, real SQLite (no DB mocking), temp dirs via `fs.mkdtempSync`. The SC-001 / p95 gates live in a NEW top-level `__tests__/hybrid-search.test.ts` (the `__tests__/evaluation/` dir is excluded from the `npm test` glob).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm baseline and target surfaces before any change.

- [X] T001 Confirm baseline green and target files exist: run `npm run build && npm run typecheck && npm test`, then verify the plumbing targets are present — `src/types.ts`, `src/index.ts`, `src/db/queries.ts`, `src/mcp/tools.ts`, `src/bin/codegraph.ts`, `__tests__/evaluation/test-cases.ts`, and `src/embeddings/` (providers + `decodeVector` in `indexer-hook.ts`, `getEmbeddingCoverage`/`getEmbeddingStatus`). No code change. **Acceptance**: suite green; all paths confirmed (plan Project Structure).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared type + module + library-signature seams that ALL user stories build on. These change no runtime behavior (keyword arm still runs verbatim).

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [X] T002 [P] Add the mode/result type surface in `src/types.ts`: `type SearchMode = 'keyword' | 'semantic' | 'hybrid' | 'auto'`; add optional `mode?: SearchMode` to `SearchOptions`; add optional `matchType?: 'keyword' | 'semantic' | 'both'` and `fusedScore?: number` to `SearchResult`. Fields absent (not `undefined`) when unused. **Acceptance**: compiles; existing `{ node, score, highlights? }` shape byte-identical when the new fields are unset (FR-001/012; data-model E1/E2/E3).
- [X] T003 Create `src/search/hybrid.ts` module scaffold with internal documented constants only (no env vars, no user knobs): `RRF_K = 60`, `EMBED_BUDGET_MS ≈ 2000`, `MAX_MATRIX_BYTES = 1_073_741_824` (1 GiB), candidate depth `max(5×limit, 100)`, and a documented deterministic PRNG seed constant; header comment stating resident memory = `count × dims × 4` bytes. Export typed stubs for the fusion entry point + auto-resolve predicate. **Acceptance**: file exists, typechecks, exports referenced by later tasks; zero new env vars (FR-007/009/009c; research D6/D7).
- [X] T004 Plumb `searchNodes(query, { mode })` through `src/index.ts` (and its call into `QueryBuilder.searchNodes`, `src/db/queries.ts`): accept `mode`, **default `keyword`**, coerce any unknown/out-of-enum value to `keyword` (never throw), and run the existing keyword pipeline **verbatim** for keyword mode. No hybrid wiring yet. **Acceptance**: keyword-mode output byte-identical to today; unknown mode coerces without error (FR-001/003; contract search-api).
- [X] T005 Reviewability checkpoint: confirm the planned diff stays within budget (≈195 reviewable LOC / ≈4 production files / ≈10 total / single primary API surface); record the decision inline in this file. **Acceptance**: within budget recorded, or split/exception raised before implementation (template Reviewability gate).
  > **T005 decision (2026-07-10, orchestrator):** WITHIN BUDGET — proceed. Foundational diff so far: `src/types.ts` (+~30 doc-commented lines), `src/search/hybrid.ts` (new scaffold, constants+stubs), `src/index.ts` (+~10 plumbing lines), `__tests__/hybrid-search.test.ts` (test, non-production). Remaining planned production touches: hybrid.ts body (T007–T012/T015/T019–T021), `src/mcp/tools.ts` + `src/bin/codegraph.ts` (plumbing, T016/T017/T022/T023) → ~5–6 production files total vs warn threshold 6 / block 8; single primary API surface unchanged; projected reviewable LOC remains near the ~195 estimate against warn 400. No split, no exception needed.

**Checkpoint**: Foundation ready — type + module + library seams exist; no behavior change.

---

## Phase 3: User Story 1 - Paraphrase query surfaces semantic matches (Priority: P1) 🎯 MVP

**Goal**: Fuse FTS5 keyword hits with vector KNN via rank-only RRF so paraphrase queries surface semantically relevant symbols keyword search misses, each carrying match provenance.

**Independent Test**: With fixture vectors present, a paraphrase query in hybrid mode returns the RRF fusion of keyword + vector arms including semantically relevant symbols absent from keyword-only, each annotated `matchType`; identical query ⇒ byte-identical ordering.

### Tests for User Story 1 (write FIRST, must FAIL)

- [X] T006 [US1] Write the failing FR-014(a) hit-rate gate in `__tests__/hybrid-search.test.ts`: build a real-SQLite fixture graph (`fs.mkdtempSync`); seed hand-built **unit-normalized** vectors via `upsertNodeVector` under the **exact stored model id the test-only query-provider seam reports**; ≥3 paraphrase cases incl. ≥1 **semantic-only** case whose target's `name` + every `qualified_name` segment + `docstring` + `signature` avoid any FTS5 token-prefix match, plus ≥1 **decoy** node that DOES token-match (keyword arm returns a wrong hit, not empty). Assert aggregate hybrid hit-rate ≥ aggregate keyword; the semantic-only case's own contribution **strictly greater** under hybrid; and the **semantic arm alone** surfaces its target. Additionally assert **SC-006 determinism**: run one hybrid-mode fixture query **twice** against the unchanged index and assert the two returned result arrays are **byte-identical in order** (deep-equal on the ordered hit list), exercising the FR-013 ascending-node-id tie-break at both the per-arm and fused levels. **Acceptance**: test present and FAILS (no fusion yet); the SC-006 re-run equality assertion is present (FR-014a/SC-001/SC-006; FR-013; Assumptions non-tautology rules; research D11).

### Implementation for User Story 1

- [X] T007 [US1] Implement the vector matrix cache in `src/search/hybrid.ts`: lazily-built, **single-owner module-level singleton** keyed by `(project root, active stored model id)`; decode every matching-model BLOB via `decodeVector` (LE f32) into one `Float32Array` with aligned per-row `nodeId` / `kind` / `language`; pre-build **memory guard** — if `predictedBytes = count × dims × 4 > MAX_MATRIX_BYTES` skip the build; memoize the in-flight build so concurrent first queries share one build (thundering-herd). **Acceptance**: cache built once per project, never per worker; guard skips oversized builds (FR-009/009a/009b/009c/008a; data-model E4; research D6/D7).
- [X] T008 [US1] Implement the per-query staleness probe in `src/search/hybrid.ts`: compare `(getEmbeddingCoverage matching-model count) + (project_metadata embedding_model + embedding_dims)`; rebuild the matrix on change. Probe runs **only** on the semantic/hybrid path. **Acceptance**: index change (add/remove/re-embed/model-switch) triggers rebuild on next semantic query; no new column, no schema write (FR-008b/009; research D6a).
- [X] T009 [US1] Implement query-vector acquisition in `src/search/hybrid.ts` + add the single named **test-only query-provider seam** (`__set…ForTests`) in `src/index.ts`: acquire the active provider, embed the **filter-stripped** query text, match the provider's stored model id to the scanned id. Seam mirrors the existing `__setLocalProviderOverridesForTests` teardown discipline and is **never reachable in production config resolution**. **Acceptance**: seam swaps the query-time provider in tests; production path unchanged (FR-011; data-model E5; research D11).
- [X] T010 [US1] Implement the cosine top-k heap in `src/search/hybrid.ts` with `kind:` / `lang:` / `options.kinds` **pre-filtering the scan before top-k** (filtered-out rows never consume top-k slots); a fully-filtered scan yields keyword-only fusion input. Semantic arm rank = descending cosine similarity. **Acceptance**: top-k respects pre-filters; no starvation (FR-010; research D8).
- [X] T011 [US1] Implement rank-only RRF merge in `src/search/hybrid.ts`: each arm contributes depth `max(5×limit, 100)`; `fused(d) = Σ 1/(RRF_K + rank_arm(d))` (keyword rank = its existing post-rescore order, semantic rank = cosine order); **no raw keyword scores or cosine magnitudes enter the fused score**; order by fused desc; **ascending-node-id tie-break at BOTH levels** (within each arm on equal per-arm scores, and on equal fused scores); `path:`/`name:` post-fusion hard gates; `options.offset` slice after fusion over the fixed candidate pool; truncate to `limit`. Keyword arm's kind/path/name rescoring bonuses MUST NOT be re-applied post-fusion. **Acceptance**: deterministic fused ordering; matches contract behavioral table (FR-004/004a/010/012/013; research D3/D10).
- [X] T012 [US1] Wire the hybrid/semantic arms into `searchNodes` (via `src/index.ts` → `src/search/hybrid.ts`) and assign provenance: set `matchType` = `keyword` | `semantic` | `both` per which arm(s) contributed a rank, populate `fusedScore`, and set `score = fusedScore` in semantic/hybrid; both fields **absent** in keyword mode. Semantic mode runs the vector arm ONLY (no FTS/exact-name supplement; MAY omit an exact-name-only symbol). **Acceptance**: T006 hit-rate gate passes; provenance present in semantic/hybrid, absent in keyword (FR-002a/012; data-model E3; contract search-api).
- [X] T013 [US1] Write and pass the FR-014(c) p95 gate in `__tests__/hybrid-search.test.ts`: generate a 50k×384 fixture from the seeded pure-JS PRNG (no `Math.random`, no committed binary asset); time the **fusion leg only** (scan + top-k + RRF) via `performance.now()`; fixed **10-iteration warmup discard**; **N=200** timed iterations; nearest-rank p95 = `sorted[Math.ceil(0.95*200)-1] = sorted[189]`; single `expect(p95).toBeLessThanOrEqual(150)`, no retry. Re-measure and record observed p95; if within 2× of 150 ms, revisit threshold/fixture/headroom before merge. **Acceptance**: gate passes with order-of-magnitude headroom (FR-014c/014d/SC-002; research D11).

**Checkpoint**: US1 fully functional — paraphrase queries return fused, provenance-tagged, deterministic, performant results. **MVP deliverable.**

---

## Phase 4: User Story 2 - Explicit mode selection with auto resolution (Priority: P2)

**Goal**: `keyword` / `semantic` / `hybrid` / `auto` selectable at the `codegraph_search` MCP tool and CLI search; unspecified resolves to `auto` (hybrid iff matching-model vectors exist, else keyword).

**Independent Test**: Invoke each surface with each explicit mode and with none; resolved behavior matches the mode (or the auto rule).

### Tests for User Story 2 (write FIRST, must FAIL)

- [ ] T014 [US2] Write failing mode-resolution tests in `__tests__/hybrid-search.test.ts` covering US2 scenarios: explicit `keyword|semantic|hybrid` run exactly that arm config; unspecified → `auto`; `auto` → hybrid when matching-model vectors present, else keyword; `semantic` MAY omit an exact-name-only symbol absent from the vector top-k. **Acceptance**: tests present and FAIL (FR-002/002a; contract mcp-cli-surface).

### Implementation for User Story 2

- [ ] T015 [US2] Implement the shared `auto`-resolution predicate in `src/search/hybrid.ts` (surfaced via `src/index.ts`): `auto` → `hybrid` iff (provider configured AND ≥1 vector matches the active stored model), else `keyword`. Used ONLY by explicit surfaces + explicit opt-in callers — **never** by internal callers. **Acceptance**: same predicate as the FR-017 status line; internal callers stay keyword (FR-002; research D1).
- [ ] T016 [P] [US2] Plumb `mode` into the MCP `codegraph_search` tool in `src/mcp/tools.ts`: add optional `mode` enum `["keyword","semantic","hybrid","auto"]` to `inputSchema` with a terse agent-facing description; omitted/unknown → `auto` (coerce, never `isError`); map through to `cg.searchNodes(query, { limit, kinds, mode: resolved })`. Do NOT edit `server-instructions.ts` unless guidance narrative changes. **Acceptance**: each mode routes correctly; unknown coerces to auto (FR-002; contract mcp-cli-surface).
- [ ] T017 [P] [US2] Add `-m, --mode <mode>` to CLI `query <search>` in `src/bin/codegraph.ts`: help text `Search mode: keyword | semantic | hybrid | auto (default: auto)`; NO commander `choices()` constraint; unspecified/unknown → `auto` coerced in the action handler (never exit non-zero). **Acceptance**: mistyped mode still returns keyword-eligible results, exit 0 (FR-002; contract mcp-cli-surface).

**Checkpoint**: US1 + US2 both work — modes selectable at both surfaces with auto default.

---

## Phase 5: User Story 3 - Graceful degradation, never an error (Priority: P1)

**Goal**: Under no vectors / no provider / warming provider / embed timeout, return success-shaped keyword results + a literal hint footer — never an error.

**Independent Test**: Run a search under each degraded condition; response is success-shaped keyword results with the matching literal hint, zero `isError`.

### Tests for User Story 3 (write FIRST, must FAIL)

- [ ] T018 [US3] Write failing degradation tests in `__tests__/hybrid-search.test.ts`: each of the 4 conditions (no provider configured, no matching-model vectors incl. model-mismatch fold, warming, embed timeout/provider failure) returns keyword results + the **exact verbatim literal footer string** (strings 1–4 from the FR-015 table); string 4 is the catch-all for any semantic-path exception (staleness-probe/decode/build/embed/fusion throw) and the FR-009c memory-guard skip; empty filter-stripped embed input is NOT degraded (no hint, no timing footer, byte-identical to keyword); ZERO `isError` responses. **Acceptance**: tests present and FAIL (FR-005/006/009c/015; SC-003; contract degradation-hints).

### Implementation for User Story 3

- [ ] T019 [US3] Implement degradation detection + the 4 literal hint strings (copied verbatim from the spec FR-015 table) as a footer appended AFTER results, emitted every query while the condition holds. Wrap the whole semantic/hybrid path so ANY unexpected exception degrades to keyword + **string 4** (catch-all), and the FR-009c memory-guard skip renders **string 4**; model-mismatch renders **string 2**. **Acceptance**: correct string per condition; never `isError` (FR-005/006/009c/015; contract degradation-hints).
- [ ] T020 [US3] Implement lazy-init warming (string 3) + init-failure reset in `src/search/hybrid.ts`: first hybrid-eligible query served keyword + warming note; a failed/timed-out lazy init returns the provider to uninitialized (no permanent latch), serialized behind the single warming owner, each attempt bounded by the embed budget, failing query served keyword + string 4. **Acceptance**: later query re-attempts init and fuses when ready; a persistently failing provider never blocks a query beyond the budget (FR-005).
- [ ] T021 [US3] Implement the embed-budget hard cap (~2 s) + late-vector discard in `src/search/hybrid.ts`: no query blocks past the budget before falling back to keyword + string 4; a query-embed completing AFTER its budget is **discarded** — never written to the matrix cache, never mutates `matchType`/provenance/order, never retroactively converts the returned keyword response. **Acceptance**: worst-case degraded latency ≤ keyword + embed budget, verifiable as an elapsed-time bound (FR-006/006a).
- [ ] T022 [US3] Implement the FR-008 timing footer render in `src/mcp/tools.ts` and `src/bin/codegraph.ts`: when the semantic arm actually ran (non-degraded), append `semantic: embed <n>ms · fusion <n>ms` after results (human) + emit `embedMs`/`fusionMs` machine fields in CLI `--json`; append the `[keyword]`/`[semantic]`/`[both]` provenance tag per hit in semantic/hybrid only; fused score NEVER in human output (CLI `--json` only). Footer + tags + machine fields **omitted entirely** in keyword mode and every degraded condition. **Acceptance**: keyword + degraded output byte-identical to today (FR-008/012; data-model E7; SC-004).
- [ ] T023 [US3] Implement the FR-017 status availability line in `src/bin/codegraph.ts`: under the existing `Embeddings:` block print `Hybrid search available: yes|no (reason)` derived SOLELY from `getEmbeddingStatus` (`yes` ⟺ `status.active === true && coverage.embedded > 0`; reasons from strings-1/2 vocabulary); add additive `--json` fields `hybridSearchAvailable` (boolean) + `hybridSearchReason` (string|null, `null` iff available). No new probe; no live daemon warmth; existing `status --json` fields byte-stable. **Acceptance**: line + fields correct across all 3 states (FR-017; research D12; contract degradation-hints).
- [ ] T024 [US3] Write and pass the SC-007 truthfulness test in `__tests__/hybrid-search.test.ts`: the status yes/no agrees with the actual `auto`-mode search outcome across all three reachable states (provider+vectors / no provider / provider-but-no-matching-vectors), and `hybridSearchReason` is `null` iff `hybridSearchAvailable` is `true`. **Acceptance**: passes with zero discrepancy (SC-007; FR-017 CHK022).

**Checkpoint**: US1 + US2 + US3 — semantic value with fully success-shaped degradation and truthful status.

---

## Phase 6: User Story 4 - Existing keyword behavior is untouched (Priority: P1)

**Goal**: Zero-harm dormancy — library `searchNodes` default keyword, internal callers byte-identical, no query-embed latency, keyword shape gains no fields.

**Independent Test**: Existing keyword cases + internal-caller paths return byte-identical results and shapes to the pre-feature baseline.

### Tests for User Story 4 (write FIRST, must FAIL/GUARD)

- [ ] T025 [US4] Write the FR-014(b) byte-stability gate in `__tests__/hybrid-search.test.ts` (asserted independently of clause (a)): existing keyword cases structural deep-equal on the same fixture graph, PLUS explicit new-field-absence checks (`matchType`/`fusedScore` **absent, not `undefined`**); internal callers (explore, prompt hook, context builder) make **ZERO** query-embed calls (spy on the query-provider seam). **Acceptance**: gate present; passes once dormancy is correct (FR-014b/003/003a; SC-004/SC-005; research D11).
- [ ] T026 [US4] Enforce/verify FR-003a keyword-path non-regression in `src/index.ts` / `src/search/hybrid.ts`: keyword mode and every internal caller incur NO matrix build, NO staleness probe, NO query-embed call (guard so the semantic path is never entered for keyword). **Acceptance**: T025 zero-embed spy passes; keyword latency not regressed (FR-003/003a).
- [ ] T027 [US4] Add filter-parity assertions in `__tests__/hybrid-search.test.ts`: `kind:`, `lang:`, `path:`, `name:` produce identical filtering semantics in keyword, semantic, and hybrid modes. **Acceptance**: parity holds across all three modes (FR-016; SC-004).

**Checkpoint**: All four user stories independently functional; dormancy proven.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T028 [P] Add the same semantic/paraphrase cases to `__tests__/evaluation/test-cases.ts` and give `EvalTestCase` an optional `mode` field to drive hybrid cases in the scored `npm run eval` report. **Acceptance**: `npm run eval` includes the new cases (Q9; FR-014).
- [ ] T029 Run the scoped agent A/B: `scripts/agent-eval/ab-new-vs-baseline.sh <indexed-embedded-repo> "<NL-flavored search task>" [baseline-ref]` — both arms codegraph-on, ≥2 runs/arm, Sonnet floor — PLUS a no-vectors CONTROL repo expecting zero delta. Record duration/tool-call/Read/Grep numbers. **Acceptance**: numbers recorded for the UAT runbook (Q10; research D14; Constitution VI).
- [ ] T030 Self-repo dogfood UAT: run paraphrase NL queries through `codegraph_search` on THIS repo's live index (HAL endpoint), plus the dormancy check that an unconfigured/vector-less project behaves byte-identically. Record in the UAT runbook. **Acceptance**: semantic recall observed on live index; dormancy confirmed (Dogfooding Protocol).
- [ ] T031 [P] Document the resident-memory envelope in the `src/search/hybrid.ts` header and BUNDLING/docs: `count × dims × 4` bytes; bundled 50k×384 ≈77 MB; documented corner 50k×3584 ≈717 MB; the 1 GiB `MAX_MATRIX_BYTES` guard above it; ANN/quantization named as the follow-up. **Acceptance**: memory math documented (FR-009).
- [ ] T032 [P] Add a CHANGELOG.md entry under `## [Unreleased]` in user-facing wording (hybrid semantic search for paraphrase/NL queries; graceful keyword fallback; new `mode` on search / `codegraph_search`; status availability line) — no internal paths/symbols/benchmark numbers. **Acceptance**: entry present under `[Unreleased]` (house rules).
- [ ] T033 Generate/update the PR review packet: what changed, why, non-goals (explore untouched, no ANN/re-ranker/env vars), review order, scope budget, traceability (each FR/SC → changed files + verification evidence), verification (npm test gates + scoped A/B), known gaps (explore-side fusion deferred to a named future roadmap entry), rollback/flags (dormant by default). **Acceptance**: packet complete per spec PR Review Packet Requirements.
- [ ] T034 Run quickstart.md validation and FULL_VERIFY (`npm run build && npm run typecheck && npm test`) — all green. **Acceptance**: quickstart scenarios pass; full suite green (Constitution IV).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories (types + module + library seam).
- **User Stories (Phase 3–6)**: all depend on Foundational.
  - **US1 (P1, MVP)** is the fusion core — US2/US3 build on the arms it introduces. Recommended order US1 → US3 → US2 → US4, though US2 and US4 are largely independent once US1 lands.
  - US3's degradation wrapping and US2's surfaces both call the US1 fusion entry point.
- **Polish (Phase 7)**: depends on the user stories it validates (A/B, dogfood, eval, CHANGELOG, PR packet).

### Story Dependencies

- **US1 (P1)**: after Foundational — no dependency on other stories.
- **US2 (P2)**: after US1 (needs the arm-config the fusion entry point exposes).
- **US3 (P1)**: after US1 (wraps the semantic path); status line (T023) is independent of the fusion internals.
- **US4 (P1)**: after Foundational; byte-stability gate (T025) is most meaningful once US1's arms exist so absence is actively proven.

### Within Each Story

- Failing test precedes implementation (Constitution IV).
- Same-file tasks are sequential: all `__tests__/hybrid-search.test.ts` tasks (T006, T013, T014, T018, T024, T025, T027) and all `src/search/hybrid.ts` tasks (T007–T012, T015, T019–T021) touch one file each — NOT parallel with each other.

### Parallel Opportunities

- **T002** (`src/types.ts`) is [P] within Foundational.
- **T016** (`src/mcp/tools.ts`) and **T017** (`src/bin/codegraph.ts`) are [P] with each other (different files).
- **T028** (eval), **T031** (docs), **T032** (CHANGELOG) are [P] within Polish (different files).
- The `hybrid.ts` and `hybrid-search.test.ts` sequences are inherently serial (single-file).

---

## Parallel Example: Foundational + Polish

```bash
# Foundational — types can land alongside module scaffold review:
Task: "T002 Add SearchMode + optional result fields in src/types.ts"

# US2 surfaces — different files, run together:
Task: "T016 Plumb mode into codegraph_search in src/mcp/tools.ts"
Task: "T017 Add -m,--mode to CLI query in src/bin/codegraph.ts"

# Polish — different files, run together:
Task: "T028 Add semantic eval cases to __tests__/evaluation/test-cases.ts"
Task: "T031 Document memory envelope in src/search/hybrid.ts + BUNDLING/docs"
Task: "T032 Add CHANGELOG entry under [Unreleased]"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational (types + module + library seam).
2. Phase 3 US1 → **STOP and VALIDATE**: paraphrase query returns fused, provenance-tagged, deterministic results; T006 hit-rate + T013 p95 gates green.
3. This is the shippable semantic-recall increment.

### Incremental Delivery

1. Foundational → US1 (MVP) → US3 (success-shaped degradation, the P1 safety invariant) → US2 (mode surfaces) → US4 (dormancy proof).
2. Each story is independently testable; keyword behavior stays byte-identical throughout.

---

## Notes

- [P] = different files, no dependency on incomplete tasks.
- [Story] label maps each task to its user story for traceability.
- Verify tests FAIL before implementing (TDD; Constitution IV).
- Do NOT expand past the reviewability budget — split the spec instead (template Reviewability gate).
- Guardrails: no `codegraph_explore` changes, no ANN/quantization/re-ranker, no new env vars, `searchNodes` library default stays `keyword`.
