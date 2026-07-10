# Implementation Plan: Hybrid Semantic Search

**Branch**: `003-hybrid-semantic-search` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-hybrid-semantic-search/spec.md`

**Note**: This plan honors the clarify-refined spec (FR-001…FR-017, incl. FR-002a/004a, the Degradation Hint Wording table, SC-001…SC-007, and the binding fixture rules in Assumptions) and the SPEC-003 Design Concept (Q1–Q10) as settled decisions. Q-numbers and FR-numbers are cited inline.

## Summary

Fuse the existing FTS5 keyword arm with a vector K-nearest-neighbor (KNN) arm via reciprocal-rank fusion (RRF, `k=60`) so paraphrase / natural-language queries surface semantically relevant symbols that keyword tokens miss, degrading gracefully to keyword-only — never an error — whenever vectors or a provider are absent (FR-004, FR-015, US1/US3).

Technical approach: a single new module `src/search/hybrid.ts` owns query-vector acquisition (active embedding provider, ~2s budget), a lazily-built in-memory single-precision matrix cache (matching-model vectors only) with a cheap per-query staleness probe, a cosine top-k heap, and the rank-only RRF merge with the keyword arm. Every existing file gains **plumbing only**: `searchNodes({mode})` (library default `keyword`, byte-identical today — FR-001/003), an `auto`-resolution helper used ONLY by the explicit surfaces (`codegraph_search` MCP tool + CLI search — FR-002), optional `matchType`/fused-score result fields in semantic/hybrid modes (FR-012), a `codegraph status` availability line (FR-017), and deterministic CI gates in `npm test` plus new `npm run eval` cases (FR-014). Dormancy is absolute: with no vectors and no provider, every surface stays byte-identical to today (Constitution VII + Dogfooding law; SC-004).

## Technical Context

**Language/Version**: TypeScript (strict, `tsc`) on Node engines `>=20 <25`; effective from-source floor 22.5+ for `node:sqlite`. No TS config or engine changes.

**Primary Dependencies**: None added. Pure JS/WASM only (Constitution VII). Reuses `src/embeddings/` providers (endpoint HTTP `/v1/embeddings`; in-process ONNX local, 384 dims) and the existing little-endian f32 codec.

**Storage**: `node:sqlite` (`DatabaseSync`) — existing `node_vectors` table (model-tagged f32 BLOBs; columns `node_id, model, dims, vector, input_hash` — **no `data_version` column**). No schema change; read-only consumption for the KNN arm. The staleness probe reads the matching-model vector count (`getEmbeddingCoverage`) + the `embedding_model`/`embedding_dims` scalars in `project_metadata` only (FR-008b; consistent with the Post-Phase-1 re-check below).

**Testing**: vitest (`__tests__/*.test.ts`) for the CI gates (FR-014 clauses a/b/c), plus the scored `npm run eval` harness (`__tests__/evaluation/`) gaining the same semantic cases. Two test-only injection seams: seeded `node_vectors` (existing f32 codec) + a single named test-only query-provider seam — neither reachable in production resolution.

**Target Platform**: Same as codegraph today — macOS/Linux/Windows; MCP daemon + CLI. No platform-divergent behavior introduced (the KNN scan, cache, and RRF are pure compute).

**Project Type**: Single project — local-first library + CLI + MCP server (existing layered pipeline).

**Performance Goals**: Fusion compute (vector scan + top-k selection + RRF merge) p95 ≤150 ms at 50k nodes (FR-008/SC-002), measured N=200 iterations with 10-iteration warmup discard, nearest-rank p95 = `sorted[189]`. The query-embed leg is reported (footer + CLI `--json`) but NOT gated (FR-008, Q5).

**Constraints**: `<150 ms` p95 fusion compute; per-query embed wait capped at an internal ~2s budget (FR-006). No new env vars or user-facing tuning knobs — embed budget and cache size are internal documented constants (FR-007, Constitution II). Resident matrix memory = `count×dims×4` bytes, documented in code + BUNDLING/docs (FR-009). Deterministic ordering for identical input (FR-013, SC-006, Constitution V).

**Scale/Scope**: Dogfood repo ≈ 4.5k×3584 (≈64 MB resident); bundled ONNX 50k×384 (≈77 MB); documented corner 50k×3584 (≈717 MB) is the boundary where quantization/ANN (named follow-up) becomes necessary (FR-009, Q6).

**Reviewability Budget**: Primary surface = API (library `searchNodes` + `codegraph_search` MCP tool + CLI search). Secondary surface = harness/adapter (vitest fixture-vector gates + `npm run eval` cases). Projected reviewable LOC ≈195; production files ≈4; total files ≈10. Budget result: **within budget** (setup reviewability gate passed with zero warnings against thresholds 400/6/15). Single primary surface — no split.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Initial gate evaluation (pre-Phase 0):**

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Think Before Coding | ✅ PASS | Three clarify sessions + consensus resolved every ambiguity into FR-001…FR-017 (incl. FR-002a, FR-004a) and the Degradation Hint Wording table. Zero unresolved clarification markers remain in spec.md. |
| II. Simplicity First | ✅ PASS | One new module; existing files gain plumbing only. No new env vars/knobs — embed budget and cache size are internal constants (FR-007). Brute-force scan reused (SPEC-001 blessed it); ANN/quantization explicitly deferred. |
| III. Surgical Changes | ✅ PASS | Hybrid logic isolated in `src/search/hybrid.ts`; upstream-owned files (`src/index.ts`, `src/db/queries.ts`, `src/mcp/tools.ts`, `src/bin/codegraph.ts`) get minimal opt-in plumbing behind a `mode` param that defaults to today's behavior. Keyword arm reused verbatim, not restructured. |
| IV. Goal-Driven Execution | ✅ PASS | Success criteria SC-001…SC-007 are pre-defined and machine-verifiable; FR-014 encodes the failing-first CI gates (hit-rate, byte-stability, p95). Completion carries test + A/B evidence. |
| V. Deterministic, LLM-Free Extraction | ✅ PASS | No graph structure created — search is a query-time read. RRF ordering is deterministic with ascending-node-id tie-breaks at both levels (FR-013). No embeddings written here (SPEC-001/002 own that). |
| VI. Retrieval Performance Is a Regression Surface | ✅ PASS | The PRIMARY tool `codegraph_explore` is untouched (Q1/Q2 — explore-side fusion is an explicit non-goal). `codegraph_search` degrades success-shaped, never `isError` (FR-015). Scoped agent A/B (`ab-new-vs-baseline.sh`, both arms codegraph-on, ≥2 runs/arm, Sonnet floor, no-vectors control) recorded in the UAT runbook (Q10). |
| VII. Local-First, Private, Zero Native Deps | ✅ PASS | No new runtime deps; pure JS/WASM. `node:sqlite` sole store, read-only here. Dormancy: with no vectors + no provider, every surface byte-identical, zero network calls, zero schema writes (proved by tests — SC-004). No new SQL/WASM asset to wire into `copy-assets`. |

**Reviewability & PR packet (required for all specs):**

- **Primary review surface**: API (search path). **Secondary**: harness/adapter (test gates + eval cases). Single primary surface — within the "one primary surface" rule.
- **Budget**: ≈195 reviewable LOC / ≈4 production files / ≈10 total files — all below the warn thresholds (400 / 6 / 15). No split exception needed.
- **Split decision**: Remains one spec (single thin vertical slice: query → fusion logic → library/MCP/CLI surfaces).
- **PR review packet source**: what changed, why, non-goals, review order, scope budget, traceability (each FR/SC → changed files + verification evidence), verification (npm test gates + scoped A/B), known gaps (explore-side fusion deferred to a named future roadmap entry), rollback/flags (dormant by default — no vectors/provider ⇒ no behavior change).

**Result: PASS — no violations. Complexity Tracking table not required.**

**Post-Phase-1 re-check (after research.md + data-model.md + contracts/ + quickstart.md):** Design surfaced two facts that *strengthen* the gate rather than violate it — (1) `node_vectors` has no `data_version` column, so the staleness probe maps to `getEmbeddingCoverage` count + `project_metadata` scalars with **no schema write** (research D6a; reinforces Principle VII dormancy); (2) query-pool workers each open their own DB isolate, so the matrix cache is fixed to a **single main-daemon-process owner** with the smallest upstream diff (research D7; reinforces Principle III). No new dependencies, no new config surface, no upstream file rewrites, single primary surface, budget unchanged (≈195 LOC / ≈4 prod files / ≈10 total). **Constitution Check still PASS — no Complexity Tracking row required.**

## Project Structure

### Documentation (this feature)

```text
specs/003-hybrid-semantic-search/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── search-api.md        # library searchNodes({mode}) + result provenance contract
│   ├── mcp-cli-surface.md   # codegraph_search schema + CLI search flags & rendering
│   └── degradation-hints.md # the four literal footer strings + status availability line
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── search/
│   ├── hybrid.ts            # NEW — query-vector acquisition (active provider, ~2s budget),
│   │                        #       matrix cache + staleness probe, cosine top-k heap,
│   │                        #       rank-only RRF merge (k=60), matchType assignment (FR-004/004a/009/013)
│   └── (existing FTS query parser/helpers — untouched)
├── index.ts                # PLUMBING — searchNodes({mode}) default 'keyword'; wires hybrid arm (FR-001/003)
├── db/
│   └── queries.ts          # REUSED VERBATIM as the keyword arm (QueryBuilder.searchNodes) — no restructure
├── embeddings/             # REUSED — endpoint/local providers, config selection, f32 codec, getEmbeddingStatus
├── mcp/
│   └── tools.ts            # PLUMBING — codegraph_search: optional mode enum + auto-resolve + [tag]/footer render (FR-002/008/012)
├── bin/
│   └── codegraph.ts        # PLUMBING — CLI `query <search>`: --mode + --json machine fields; `status` availability line (FR-002/008/012/017)
└── types.ts                # PLUMBING — SearchMode type; optional matchType/fusedScore on SearchResult (FR-001/012)

__tests__/
├── hybrid-search.test.ts   # NEW — FR-014 gates (a) hit-rate, (b) byte-stability, (c) p95 fusion; seeded vectors + test provider seam
└── evaluation/
    └── test-cases.ts       # PLUMBING — add the same semantic/paraphrase cases to the scored eval report (Q9)
```

**Structure Decision**: Single-project layout (existing). All new hybrid logic lands in the new `src/search/hybrid.ts` module (Constitution III — new capability in a new module); the daemon/CLI/MCP/library surfaces gain thin plumbing that defaults to today's byte-identical keyword behavior. The matrix cache has a single owner (see research.md "Cache ownership") so it is not duplicated per query worker.

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.

_No entries — the Constitution Check passed with zero violations; no complexity justification is required._
