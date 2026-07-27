---
feature: SPEC-014 Control-Flow Graphs
branch: 014-control-flow-graphs
date: 2026-07-26
base_commit: 474729007ebb6bf400857003790cc296a0238d75
process_head_commit: 7ff8b9668453611ff23eb7466e308f84c65cbf9d
code_checkpoint_commit: 91238913e5358560cbca8cec804e23e4b2c03f78
completion_rate: 100
spec_adherence: 100
counts:
  functional_requirements: 34
  nonfunctional_requirements: 0
  success_criteria: 11
  implemented: 44
  modified: 1
  partial: 0
  not_implemented: 0
  unspecified_implementations: 3
  critical_findings: 0
  significant_findings: 3
  minor_findings: 0
  positive_findings: 4
---

# SPEC-014 Retrospective

## Executive Summary

SPEC-014 is implemented and verified. All 43 tasks are complete, all 34 functional requirements and all 11 success criteria have implementation evidence, review remediation is complete, and the final recorded gates passed with 114 focused CFG tests and 4,662 full-suite tests.

Spec adherence is 100% by the command formula: 44 implemented requirements plus 1 modified requirement, divided by 45 total FR/SC requirements. The one modified requirement is FR-029: final MCP behavior allows omitting `projectPath` when the MCP server already has a default project, while still requiring `projectPath` in no-root sessions.

The largest process lesson is reviewability estimation. The original budget forecast was 780 reviewable LOC, 8 production surfaces, and 18 total files. The final task evidence recorded 67 files, 10 production files, and 4,457 lines of production churn, so the feature correctly shifted from one aggregate PR to 11 ordered stacked review markers.

## Proposed Spec Changes

These are report-only proposals. No `spec.md` change was made because that requires a separate human confirmation gate.

| ID | Target | Proposed edit | Rationale |
|---|---|---|---|
| PSC-001 | FR-029 | Clarify that `codegraph_get_cfg` requires `functionId`, accepts optional `limit` and `offset`, and requires `projectPath` only when the MCP server has no configured default project. | Final implementation preserves exact `CfgReadResult` parity while matching the existing default-project MCP ergonomics and no-root safety model. |
| PSC-002 | Reviewability Budget | Replace the forecast-only reviewability budget with an actual-outcome note: 67 files, 10 production files, 4,457 production churn, and 11 ordered review markers. | The implementation exceeded the forecast but was made reviewable through stacked PR packets rather than one aggregate PR. |
| PSC-003 | SC-010 / FR-034 | Add a dogfood-health clause that self-repo UAT must prove the local dogfood MCP service can start on the supported Node runtime without relying on a bare unsupported `node`. | Dogfooding found service/index failures caused by runtime resolution and local daemon constraints; the fix is part of the accepted evidence path. |

## Requirement Coverage Matrix

| Requirement | Status | Evidence |
|---|---|---|
| FR-001 | Implemented | T006, T009, T020 prove opt-in configuration and disabled default behavior. |
| FR-002 | Implemented | T006, T020, T039 prove disabled dormancy, zero CFG writes, and zero network fetches. |
| FR-003 | Implemented | T009 and T017 prove first-enable full backfill when no ordinary file changes exist. |
| FR-004 | Implemented | T004, T005, T018 prove by-value CFG rows and affected-file atomic replacement. |
| FR-005 | Implemented | T004 and T019 prove deleted tombstones and unknown-function separation. |
| FR-006 | Implemented | T006 and T020 prove retained rows are inert while disabled. |
| FR-007 | Implemented | T020 proves re-enable requires refresh before serving retained rows as current. |
| FR-008 | Implemented | T021 proves stale prior snapshot retention after refresh failure. |
| FR-009 | Implemented | T021 and T022 prove first-refresh failure, contained failures, and cancellation behavior. |
| FR-010 | Implemented | T019 and T024 prove function-ID-only reads. |
| FR-011 | Implemented | T007, T009, T024, T026, T029, T031, and T037 prove one machine shape across library, CLI JSON, and MCP. |
| FR-012 | Implemented | T007, T009, T024, and T026 prove exported public types and exact top-level fields. |
| FR-013 | Implemented | T007, T008, T011, T019, T021, T025, T026, T029, and T037 prove closed state/reason/nullability rules. |
| FR-014 | Implemented | T002, T007, T009, T010, and T016 prove complete graph metadata, ordering, entry, and exit blocks. |
| FR-015 | Implemented | T004, T005, T008, T018, and T023 prove source-version freshness and compact status persistence. |
| FR-016 | Implemented | T002, T008, and T011 prove whole-function unsupported skips with no partial payload. |
| FR-017 | Implemented | T002, T008, and T012 prove the 10,000-block resource cap with no partial payload. |
| FR-018 | Implemented | T002, T013, and T033 prove explicit throw/raise and finally routing without implicit exception edges. |
| FR-019 | Implemented | T002 and T014 prove TypeScript/JavaScript and Python short-circuit flow. |
| FR-020 | Implemented | T002 and T015 prove TypeScript/JavaScript switch, default, and fallthrough semantics. |
| FR-021 | Implemented | T003 and T034 prove Python match/case source-order predicates and guarded cases. |
| FR-022 | Implemented | T003 and T035 prove Python comprehensions and generator expressions as real flow. |
| FR-023 | Implemented | T002 and T014 prove optional chaining and nullish coalescing branch flow. |
| FR-024 | Implemented | T003 and T036 prove await/yield/yield-from as ordinary operations. |
| FR-025 | Implemented | T002, T003, T016, T032, and T033 prove nested function boundaries and Python lambda identity. |
| FR-026 | Implemented | T002, T003, T016, and T033 prove unreachable blocks remain disconnected. |
| FR-027 | Implemented | T002, T010, T013, T015, and T033 prove distinct edge kinds and static break/continue targets. |
| FR-028 | Implemented | T024, T025, and T029 prove `getCfg`, `codegraph cfg`, JSON/human output, paging, and exit behavior. |
| FR-029 | Modified | T026, T027, T030, T041 prove exact result shape and paging. Final schema makes `projectPath` optional with a default project and required in no-root sessions. |
| FR-030 | Implemented | T028 and T031 prove aggregate CFG status counts and precedence. |
| FR-031 | Implemented | T002, T010, T037, and T040 prove deterministic output across re-indexing. |
| FR-032 | Implemented | T039 proves paired-median CFG overhead within the 1.20 budget. |
| FR-033 | Implemented | T001, T037, T040, T042, and T043 preserve the two vertical language slices and review packet route. |
| FR-034 | Implemented | T003, T031, T037, T038, T040, and T042 prove self-repo TypeScript/JavaScript UAT plus Python parity fixture UAT. |

## Success Criteria Assessment

| Success Criterion | Status | Evidence |
|---|---|---|
| SC-001 | Implemented | T006, T020, and T039 prove disabled mode writes no CFG rows and performs no network fetches. |
| SC-002 | Implemented | T017 proves first-enable backfill and stable skip status creation. |
| SC-003 | Implemented | T010 and T037 prove repeated re-index byte equivalence and stable block IDs. |
| SC-004 | Implemented | T017 through T023 prove lifecycle transitions with expected state assertions. |
| SC-005 | Implemented | T011 and T012 prove unsupported, parse-unsafe, and over-limit cases expose no partial CFG. |
| SC-006 | Implemented | T024 through T029 prove library, CLI JSON, MCP, and expected-state exit/status parity. |
| SC-007 | Implemented | T027 proves deterministic MCP pagination reconstruction without duplicates or gaps. |
| SC-008 | Implemented | T028 and T031 prove aggregate status counts and precedence. |
| SC-009 | Implemented | T039 records final paired-median ratios below 1.20. |
| SC-010 | Implemented | T031 and T042 prove self-repo TypeScript/JavaScript library, CLI JSON, MCP, and status parity. |
| SC-011 | Implemented | T032 through T038 prove Python parity for match/case, comprehensions, generators, raise, nested boundaries, unreachable blocks, await, and yield. |

## Architecture Drift

| Area | Planned | Actual | Assessment |
|---|---|---|---|
| CFG module | One language-neutral module under `src/analysis/cfg`. | Implemented in `src/analysis/cfg/index.ts`, including shared builder, store, TS/JS lowering, and Python parity. | No negative drift. |
| Storage | SQLite CFG status/block/edge tables with by-value identity and CFG-owned cascades. | Implemented in `src/db/schema.sql` and `src/db/migrations.ts`; schema shipping locked by tests. | No drift. |
| Public API | `CodeGraph.getCfg`, CLI JSON, MCP, and status surfaces share one response shape. | Implemented across `src/index.ts`, `src/bin/codegraph.ts`, `src/mcp/tools.ts`, and status output. | No drift in result shape. |
| MCP input contract | `projectPath` required by spec text. | `projectPath` is optional for configured default-project sessions and required for no-root sessions. | Significant but positive API ergonomics drift; propose FR-029 clarification. |
| Runtime dependencies | No new runtime dependency. | No new runtime dependency; implementation stays within tree-sitter, SQLite, and existing runtime. | No drift. |
| Reviewability route | Forecast: 780 reviewable LOC, 8 production surfaces, 18 files, two slices. | Actual: 67 files, 10 production files, 4,457 production churn; review route changed to 11 stacked PR markers. | Significant process drift, mitigated through stacked PR packets. |
| Dogfooding | Self-repo UAT required. | UAT also exposed local dogfood service issues around daemon lease, watcher exhaustion, and unsupported bare Node runtime; fixes landed in dogfood runtime/config surfaces. | Significant operational learning. |

## Significant Deviations

### SIGNIFICANT: Reviewability Forecast Was Too Small

Evidence: T043 records 67 files, 10 production files, and 4,457 lines of production churn against the original 780/8/18 forecast. The root cause was underestimating the combined cost of lifecycle state, cross-surface parity, Python semantic parity, performance evidence, UAT, and retrieval/dogfood remediation.

Impact: Correctness was not compromised, but one aggregate PR became unreleasable for review. Mitigation was the 11-marker stacked PR route with per-marker packets, validation files, and review order.

Prevention: Future specs with new persisted analysis state plus multiple public read surfaces should start with an explicit stacked-PR plan before implementation, even if initial LOC estimation is below a hard block.

### SIGNIFICANT: MCP `projectPath` Contract Needed Default-Project Compatibility

Evidence: T041 records review findings where strict static `projectPath` requirements conflicted with default-project MCP guidance. The final tool preserves success-shaped results and exact machine output while dynamically requiring `projectPath` only when no default root exists.

Impact: This is a backward-compatible user ergonomics improvement, but it modifies the literal FR-029 wording.

Prevention: MCP contract specs should distinguish static schema requirements from session-dependent required inputs when default-root behavior already exists.

### SIGNIFICANT: Dogfood Service Health Was a Hidden Acceptance Risk

Evidence: T041 records live dogfooding fixes for sandbox-denied POSIX daemon lease behavior, watcher exhaustion, and bare `node` resolving to unsupported Node 26.5.0. T042 records built-runtime UAT after CFG language loading was corrected.

Impact: The feature could pass normal unit gates while still failing to provide a reliable local dogfood MCP service for the autopilot/retrieval phase. The final implementation corrected that through runtime/config dogfood support.

Prevention: New retrieval-facing features should include a dogfood service startup check before A/B evaluation begins, not only after MCP implementation appears complete.

## Innovations and Best Practices

| Positive finding | Evidence | Reuse potential | Constitution candidate |
|---|---|---|---|
| Success-shaped expected states across CLI and MCP | T024 through T030 and T041 | Reuse for future agent-facing tools so expected absence states do not train agents to abandon CodeGraph. | Aligns with Principle VI. |
| Per-file parse cache for CFG analysis | T039 | Reuse for future analysis passes that need tree-sitter reparsing by function. | No amendment needed. |
| Marker-based stacked PR packets | T042 and T043 | Reuse for large specs that exceed reviewability budgets after implementation reality is known. | Possible workflow guidance, not constitutional law. |
| Self-repo UAT with isolated temp mirror | T031, T038, T042 | Reuse for dogfood features that must not mutate live `.codegraph/` state during verification. | Aligns with Dogfooding. |

## Constitution Compliance

| Principle | Result | Evidence |
|---|---|---|
| I. Think Before Coding | PASS | Q1-Q28 decisions were preserved; tasks record clarification-sensitive constraints and no unresolved markers. |
| II. Simplicity First | PASS with tracked complexity | Complexity is concentrated in one CFG module plus required public surfaces; reviewability overrun is documented and mitigated. |
| III. Surgical Changes | PASS | Source changes are scoped to CFG analysis, schema, config, library, CLI, MCP, Python extraction identity, dogfood runtime support, tests, fixtures, and spec artifacts. |
| IV. Goal-Driven Execution | PASS | Every task records focused evidence; final gates include build, typecheck, focused CFG, full suite, performance, UAT, retrieval review, and A/B evidence. |
| V. Deterministic, LLM-Free Extraction | PASS | CFGs derive from tree-sitter/static lowering; unsupported unsafe cases skip whole functions. |
| VI. Retrieval Performance | PASS | MCP output is bounded/paginated; expected states are success-shaped; authorized A/B evidence passed without Read/Grep regression. |
| VII. Local-First | PASS | SQLite-only storage, no new runtime dependency, disabled path dormant, no network fetches in CFG-disabled/benchmark evidence. |
| Dogfooding | PASS | Self-repo TypeScript/JavaScript UAT, Python parity fixture UAT, and dogfood MCP service remediation are recorded in tasks. |

Constitution violations: None.

## Unspecified Implementations

| Item | Why it appeared | Classification |
|---|---|---|
| Supported Node runtime selection for dogfood scripts in `scripts/lib/dogfood-node-runtime.mjs` and `scripts/mcp-dogfood.mjs` | Live dogfooding failed when bare `node` resolved to an unsupported runtime. | Necessary operational support for FR-034/Dogfooding. |
| Stacked PR packet/process artifacts under `specs/014-control-flow-graphs/.process/` | The actual implementation exceeded the reviewability forecast and needed durable marker evidence. | Necessary reviewability mitigation for FR-033. |
| Secure config open-mode remediation in dogfood/Codex config surfaces | Final CodeQL/review remediation identified unsafe config handling. | Necessary remediation; no product-scope expansion. |

## Task Execution Analysis

| Phase | Tasks | Result |
|---|---:|---|
| Setup and reviewability baseline | T001-T003 | Complete |
| Foundation contract and storage | T004-T008 | Complete |
| US1 TypeScript/JavaScript library CFG | T009-T016 | Complete |
| US2 lifecycle state | T017-T023 | Complete |
| US3 CLI/MCP/status parity | T024-T031 | Complete |
| US4 Python parity | T032-T038 | Complete |
| Polish, gates, review packet | T039-T043 | Complete |

Completion formula: `43 completed / 43 total = 100%`.

Spec adherence formula: `((44 implemented + 1 modified + (0 partial * 0.5)) / (45 total requirements - 0 unspecified requirements)) * 100 = 100%`.

## Lessons Learned and Recommendations

1. Treat persisted analysis plus multiple read surfaces as stacked-PR work from the start. The original budget missed lifecycle, UAT, retrieval, and dogfood costs.
2. Put default-project MCP semantics directly into the spec when a tool can run both with and without an explicit project root.
3. Build before dogfooding the MCP server. The built-runtime parser/WASM behavior differed from source-level expectations and was only caught by real UAT.
4. Keep performance evidence isolated from concurrent full-suite load. SPEC-014 correctly separated authoritative evidence mode from non-authoritative smoke mode.
5. Add dogfood service startup to future retrieval-facing UAT before running A/B, so index availability problems are found before external evaluation.

## File Traceability Appendix

### Source and Runtime

- `src/analysis/cfg/index.ts`: CFG types, builder, TS/JS lowering, Python lowering, persistence, read states, source versions, pagination, project status.
- `src/db/schema.sql` and `src/db/migrations.ts`: CFG status/block/edge tables, indexes, triggers, schema versioning.
- `src/project-config.ts`: opt-in `analysis.cfg`, disabled/default behavior, config revision support.
- `src/index.ts`: index/sync orchestration, `CodeGraph.getCfg`, aggregate status wiring.
- `src/bin/codegraph.ts`: `codegraph cfg`, JSON/human output, paging flags, expected-state exit behavior, status output.
- `src/mcp/tools.ts`: `codegraph_get_cfg` tool, default-project/no-root input handling, success-shaped expected states.
- `src/mcp/server-instructions.ts`: bounded CFG read guidance for agents.
- `src/extraction/languages/python.ts` and `src/extraction/extraction-version.ts`: deterministic Python lambda identity.
- `scripts/lib/dogfood-node-runtime.mjs` and `scripts/mcp-dogfood.mjs`: dogfood runtime selection and service reliability support.

### Tests and Fixtures

- `__tests__/analysis/cfg/cfg-contract.test.ts`: shared result shape, CLI/MCP parity, expected states, status, pagination, self-repo UAT.
- `__tests__/analysis/cfg/cfg-lifecycle.test.ts`: enable, sync, delete, disable, stale, first failure, cancellation, re-enable.
- `__tests__/analysis/cfg/cfg-typescript.test.ts`: TS/JS semantic CFG fixtures and deterministic behavior.
- `__tests__/analysis/cfg/cfg-python.test.ts`: Python parity and construct coverage.
- `__tests__/analysis/cfg/cfg-performance.test.ts`: parser cache and paired-median performance evidence.
- `__tests__/analysis/cfg/fixtures/tsjs/`: TypeScript/JavaScript golden fixtures.
- `__tests__/analysis/cfg/fixtures/python/`: Python golden fixtures.
- `__tests__/mcp-dogfood-runtime.test.ts`: dogfood runtime support coverage.

### Spec and Process Artifacts

- `specs/014-control-flow-graphs/spec.md`: accepted requirements and success criteria.
- `specs/014-control-flow-graphs/plan.md`: architecture, slice plan, gates, complexity tracking.
- `specs/014-control-flow-graphs/tasks.md`: task evidence and completion ledger.
- `specs/014-control-flow-graphs/quickstart.md`: UAT runbook and packet evidence.
- `specs/014-control-flow-graphs/.process/evidence/t041-retrieval-ab.json`: retrieval A/B evidence.
- `specs/014-control-flow-graphs/.process/pr-packets/`: stacked PR packets and validation evidence.

## Self-Assessment Checklist

| Check | Result | Evidence |
|---|---|---|
| Evidence completeness | PASS | Significant deviations cite tasks, files, or behavior. |
| Coverage integrity | PASS | All FR-001 through FR-034 and SC-001 through SC-011 are listed. |
| Metrics sanity | PASS | Completion and adherence formulas are shown and use the counted task/requirement totals. |
| Severity consistency | PASS | Significant findings affect reviewability, public contract wording, or dogfood availability; no critical runtime or constitution issue remains. |
| Constitution review | PASS | Each principle is assessed and violations are explicitly listed as none. |
| Human Gate readiness | PASS | Proposed spec changes are grouped by target and ready for separate confirmation. |
| Actionability | PASS | Recommendations are specific and tied to findings. |
