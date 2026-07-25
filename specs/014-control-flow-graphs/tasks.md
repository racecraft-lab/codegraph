# Tasks: SPEC-014 Control-Flow Graphs

**Input**: Design documents from `specs/014-control-flow-graphs/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, checklists, and the SPEC-014 Tasks Prompt.

**Tests**: Required. SPEC-014 explicitly requires test-first delivery, deterministic probes, lifecycle coverage, cross-surface parity, benchmark evidence, self-repo UAT, and full gates.

**Reviewability**: Preserve the accepted two vertical slices. Slice 1 delivers shared infrastructure plus TypeScript/JavaScript end to end through library, CLI, MCP, and status. Slice 2 delivers Python parity through the same contracts. Re-check before implementation and before final review packet.

**Task Format**: `- [ ] T### [P?] [US?] Description with exact file path`

## Phase 1: Setup and Reviewability Baseline

**Purpose**: Establish fixture, evidence, and reviewability scaffolding before behavior work starts.

- [X] T001 Record the pre-implementation reviewability checkpoint and accepted two-slice boundary in `specs/014-control-flow-graphs/tasks.md` before any source edits; evidence: focused scope note plus full gate plan `npm run build` and `npm test` (FR-033; Q22)
  - Evidence (2026-07-25): setup sizing is 780 LOC / warn / two suggested slices below the 800-LOC block; plan sizing is 360 LOC / pass; G5 covers 34/34 FRs; atomicity route is `one-navigable-PR`. Preserve Slice 1 (shared + TS/JS end to end) before Slice 2 (Python parity). Run `npm run build` and `npm test` at every slice boundary and the final gate.
- [X] T002 [P] Add deterministic TypeScript/JavaScript fixture inventory for baseline, unsupported, over-limit, throw/finally, short-circuit, switch, optional chaining, nullish coalescing, nested functions, unreachable, and no-op cases in `__tests__/analysis/cfg/fixtures/tsjs/`; evidence: focused fixture manifest review plus full gate plan `npx vitest run __tests__/analysis/cfg/cfg-typescript.test.ts` (FR-014, FR-016, FR-017, FR-018, FR-019, FR-020, FR-023, FR-025, FR-026, FR-027, FR-031; Q1,Q4,Q5,Q6,Q10,Q11,Q15,Q18,Q21,Q23,Q26,Q28)
  - TDD evidence: 1 real manifest assertion failed before fixtures existed; 1 test passed after deterministic fixtures were added; refactor rerun stayed green.
- [X] T003 [P] Add committed Python fixture inventory for parity, `match`/`case`, comprehensions, generator expressions, `raise`, lambdas, nested local classes, unreachable, `await`, `yield`, and `yield from` in `__tests__/analysis/cfg/fixtures/python/`; evidence: focused fixture manifest review plus full gate plan `npx vitest run __tests__/analysis/cfg/cfg-python.test.ts` (FR-021, FR-022, FR-024, FR-025, FR-026, FR-034; Q6,Q17,Q18,Q25,Q28)
  - TDD evidence: 1 real manifest assertion failed before the Python fixture directory existed; 1 test passed after fixtures were added; refactor rerun stayed green.

---

## Phase 2: Foundational Contract and Storage

**Purpose**: Create only the blocking shared pieces required for the vertical stories.

**Critical**: No user story implementation begins until these tasks are complete.

- [X] T004 RED -> GREEN -> REFACTOR schema and migration parity for CFG status, block, edge, source-version, contract-version, tombstone, constraint, and index tables in `src/db/schema.sql`, `src/db/migrations.ts`, and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused real-SQLite migration-vs-fresh-schema test and full gate `npm run build` (FR-004, FR-005, FR-015; Q3,Q12)
  - TDD evidence: 3 real SQLite assertions failed before schema v11 existed; 3 passed after fresh/migrated table, index, trigger, FK, constraint, cascade, and tombstone parity was implemented. The full suite exposed and then cleared 6 legacy schema-version assertions.
- [X] T005 RED -> GREEN -> REFACTOR package asset shipping for CFG schema changes in `package.json`, `src/db/schema.sql`, and `dist/db/schema.sql`; evidence: focused build-asset assertion and full gate `npm run build` (FR-004, FR-015; Q3,Q12)
  - TDD evidence: a deterministic source-vs-dist schema assertion failed while the shipped asset was stale; `npm run build` refreshed it and the exact byte/CFG-table assertion passed.
- [X] T006 RED -> GREEN -> REFACTOR opt-in configuration and disabled dormancy in `src/project-config.ts`, `src/index.ts`, and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused disabled zero-CFG-write and no-network probe plus full gate `npm test` (FR-001, FR-002, FR-006; Q2,Q20)
  - TDD evidence: 1 lifecycle assertion failed before `analysis.cfg` existed; 4 lifecycle tests passed after the default-off gate and dormant index/sync hook were wired. Existing catalog dormancy expectations were updated and passed with `cfg: false`.
- [X] T007 RED -> GREEN -> REFACTOR exported CFG public types and exact `CfgReadResult` guards in `src/analysis/cfg/index.ts`, `src/index.ts`, and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused type/shape test plus full gate `npm run build` (FR-011, FR-012, FR-013, FR-014; Q7,Q10,Q11,Q27)
  - TDD evidence: 3 contract tests failed because `isCfgReadResult` was absent; 3 passed after the frozen public types, state/reason mapping, payload nullability, graph identity, role/kind, and page guards were exported. The Node 24 build passed.
- [X] T008 RED -> GREEN -> REFACTOR shared source-version, status-resolution, paging clamp, safe-message, and no-partial-payload helpers in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused state/reason/nullability/page clamp tests plus full gate `npm test` (FR-013, FR-015, FR-016, FR-017, FR-029; Q1,Q8,Q12,Q15,Q16,Q23)
  - TDD evidence: 5 helper tests failed before the shared helpers existed and 2 contract-safety regressions failed before invalid/incomplete payloads failed closed; 10 contract tests passed after remediation. Foundation verification passed 16/16 focused CFG tests, `npm run build`, and the authoritative Node 24 suite (258 files, 4553 passed, 178 skipped).

**Checkpoint**: Foundation ready. Slice 1 user-story implementation can begin.

---

## Phase 3: Slice 1 / User Story 1 - Enable CFG Analysis and Read Deterministic Library Results (Priority: P1)

**Goal**: A local user enables CFG analysis and reads deterministic, complete TypeScript/JavaScript per-function CFGs through the library, with explicit states for unsupported and unsafe functions.

**Independent Test**: Enable CFG analysis on fixtures, read known TypeScript/JavaScript function IDs through `CodeGraph.getCfg`, and compare graph, status, skip, and determinism results across repeated indexing runs.

- [ ] T009 [US1] RED -> GREEN -> REFACTOR the minimal TypeScript/JavaScript vertical path through IR, CFG builder, SQLite write, and `CodeGraph.getCfg` in `src/analysis/cfg/index.ts`, `src/index.ts`, and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused minimal available CFG test plus full gate `npm test` (FR-001, FR-003, FR-011, FR-012, FR-014; Q2,Q7,Q10,Q11,Q19,Q27)
- [ ] T010 [US1] RED -> GREEN -> REFACTOR deterministic block IDs, graph IDs, block ordering, edge ordering, and byte-equivalent repeated re-index responses in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused three-run determinism test plus full gate `npm test` (FR-014, FR-027, FR-031; Q10,Q11,Q21)
- [ ] T011 [US1] RED -> GREEN -> REFACTOR unsupported language, unsupported construct, parser-unavailable, parse-error, and parse-unsafe whole-function skip states in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused zero block/edge payload assertions plus full gate `npm test` (FR-013, FR-016; Q1,Q7,Q12)
- [ ] T012 [US1] RED -> GREEN -> REFACTOR the 10,000-block resource cap and `resource_limited`/`block_limit_exceeded` outcome in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused generated-over-limit fixture test plus full gate `npm test` (FR-017; Q15,Q23)
- [ ] T013 [US1] RED -> GREEN -> REFACTOR explicit `throw` and `try`/`finally` routing, including abrupt-transfer supersession inside `finally`, in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused edge-kind/order fixture tests plus full gate `npm test` (FR-018, FR-027; Q4,Q21)
- [ ] T014 [US1] RED -> GREEN -> REFACTOR TypeScript/JavaScript logical short-circuit, conditional expressions, optional chaining, and nullish coalescing in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused branch fixture tests plus full gate `npm test` (FR-019, FR-023; Q5,Q26)
- [ ] T015 [US1] RED -> GREEN -> REFACTOR TypeScript/JavaScript `switch`, `default`, fallthrough, `break`, `continue`, and labeled-target safety in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused switch/loop fixture tests plus full gate `npm test` (FR-020, FR-027; Q6,Q21)
- [ ] T016 [US1] RED -> GREEN -> REFACTOR nested function boundaries, local function identity handling, disconnected unreachable blocks, and no-op entry/exit graphs in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused nested/unreachable/no-op fixture tests plus full gate `npm test` (FR-014, FR-025, FR-026; Q10,Q11,Q18,Q28)

**Checkpoint**: User Story 1 is independently complete when TypeScript/JavaScript library reads satisfy available, skip, resource, determinism, and no-partial graph assertions.

---

## Phase 4: Slice 1 / User Story 2 - Keep Persisted CFG State Correct Through Lifecycle Transitions (Priority: P1)

**Goal**: Persisted CFG state follows first enable, sync, deletion, disablement, unexpected failure, cancellation, and re-enable without serving stale rows as fresh.

**Independent Test**: Drive lifecycle transitions against real project files and real SQLite, then assert status rows, block/edge availability, source versions, and read states before and after each transition.

- [ ] T017 [US2] RED -> GREEN -> REFACTOR first-enable full backfill when the ordinary incremental change set is empty in `src/index.ts`, `src/analysis/cfg/index.ts`, and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused empty-change backfill test plus full gate `npm test` (FR-003; Q19)
- [ ] T018 [US2] RED -> GREEN -> REFACTOR affected-file transactional replacement after computing every current function status for that file in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused changed-file swap/unaffected-file retention test plus full gate `npm test` (FR-004, FR-015; Q3,Q12)
- [ ] T019 [US2] RED -> GREEN -> REFACTOR source-file deletion, function deletion, compact `deleted` tombstones, and never-seen `unknown_function` reads in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused delete/unknown no-payload assertions plus full gate `npm test` (FR-005, FR-010, FR-013; Q3,Q7,Q9)
- [ ] T020 [US2] RED -> GREEN -> REFACTOR disabled reads, disabled sync zero CFG writes, retained inert rows, and re-enable refresh-before-current behavior in `src/project-config.ts`, `src/index.ts`, `src/analysis/cfg/index.ts`, and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused disable/re-enable lifecycle test plus full gate `npm test` (FR-001, FR-002, FR-006, FR-007; Q2,Q19,Q20)
- [ ] T021 [US2] RED -> GREEN -> REFACTOR unexpected first-refresh failure and later-refresh stale retention in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused `first_refresh_failed` and `refresh_failed_retained_stale` tests plus full gate `npm test` (FR-008, FR-009, FR-013; Q7,Q13)
- [ ] T022 [US2] RED -> GREEN -> REFACTOR caller cancellation with no marker before swap, stale prior snapshot when applicable, and committed-result-stands after atomic swap in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused cancellation probe plus full gate `npm test` (FR-009; Q13)
- [ ] T023 [US2] RED -> GREEN -> REFACTOR source-version and contract-version freshness so unrelated project writes do not make unchanged functions stale in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused unchanged-function freshness test plus full gate `npm test` (FR-015; Q12)

**Checkpoint**: User Story 2 is independently complete when lifecycle tests pass against real SQLite and disabled paths remain dormant.

---

## Phase 5: Slice 1 / User Story 3 - Query the Same Stateful Contract Through CLI, MCP, and Project Status (Priority: P2)

**Goal**: Library, CLI JSON, CLI human output, MCP, and status expose the same stateful CFG contract with deterministic paging and aggregate project health.

**Independent Test**: Query the same function IDs through all read surfaces, compare machine responses field-for-field, reconstruct MCP pages, and verify project status counts.

- [ ] T024 [US3] RED -> GREEN -> REFACTOR `codegraph cfg <function-id> --json` parity with `CodeGraph.getCfg` in `src/bin/codegraph.ts`, `src/index.ts`, and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused CLI JSON field-for-field test plus full gate `npm test` (FR-010, FR-011, FR-012, FR-028; Q7,Q8,Q9,Q27)
- [ ] T025 [US3] RED -> GREEN -> REFACTOR bounded CLI human output and exit-code behavior for every expected CFG state in `src/bin/codegraph.ts` and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused human output/exit matrix plus full gate `npm test` (FR-013, FR-028; Q7,Q8,Q27)
- [ ] T026 [US3] RED -> GREEN -> REFACTOR the `codegraph_get_cfg` MCP tool schema and success-shaped expected-state responses in `src/mcp/tools.ts` and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused MCP schema/state test plus full gate `npm test` (FR-011, FR-012, FR-013, FR-029; Q7,Q8,Q16,Q27)
- [ ] T027 [US3] RED -> GREEN -> REFACTOR MCP pagination defaults, clamps, independent block/edge windows, totals, and no-overlap/no-gap reconstruction in `src/mcp/tools.ts`, `src/analysis/cfg/index.ts`, and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused multi-page reconstruction test plus full gate `npm test` (FR-029; Q8,Q16)
- [ ] T028 [US3] RED -> GREEN -> REFACTOR aggregate top-level `cfg` status in human and JSON `codegraph status` in `src/index.ts`, `src/bin/codegraph.ts`, and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused mixed-state count/precedence test plus full gate `npm test` (FR-030; Q24)
- [ ] T029 [US3] RED -> GREEN -> REFACTOR cross-surface expected-state parity for disabled, not-indexed, not-computed, unknown, unsupported, resource-limited, unavailable, stale, deleted, and available results in `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused parity matrix plus full gate `npm test` (FR-011, FR-013, FR-028, FR-029; Q7,Q8,Q27)
- [ ] T030 [US3] RED -> GREEN -> REFACTOR concise MCP server guidance for bounded CFG reads in `src/mcp/server-instructions.ts` with no instruction to use Read/Grep for expected states; evidence: focused instruction snapshot/retrieval-shape check plus full gate `npm test` (FR-029; Q16)
- [ ] T031 [US3] RED -> GREEN -> REFACTOR self-repo TypeScript/JavaScript UAT probe covering library, CLI JSON, MCP pagination, and status counts in `specs/014-control-flow-graphs/quickstart.md` and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused self-repo UAT transcript plus full gate `npm run build` and `npm test` (FR-034, FR-011, FR-029, FR-030; Q8,Q16,Q24,Q27)

**Checkpoint**: Slice 1 is independently complete when TypeScript/JavaScript traverses IR -> CFG -> SQLite -> library -> CLI JSON/human -> MCP pages -> status and the focused/full gates pass.

---

## Phase 6: Slice 2 / User Story 4 - Obtain Python Semantic Parity After the TypeScript/JavaScript Slice (Priority: P3)

**Goal**: Python functions use the same state, persistence, paging, and read contracts after the TypeScript/JavaScript vertical path is complete.

**Independent Test**: Query committed Python fixtures through the same library, CLI JSON, MCP, determinism, status, and pagination tests as TypeScript/JavaScript, adding Python-specific construct coverage.

- [ ] T032 [US4] RED -> GREEN -> REFACTOR deterministic Python lambda identity before lambda CFG reads in `src/extraction/languages/python.ts` and `__tests__/analysis/cfg/cfg-python.test.ts`; evidence: focused lambda function-ID test plus full gate `npm test` (FR-025; Q28)
- [ ] T033 [US4] RED -> GREEN -> REFACTOR Python ordinary branches, loops, explicit `raise`, nested functions/classes, and unreachable blocks through the shared builder in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-python.test.ts`; evidence: focused Python baseline fixture tests plus full gate `npm test` (FR-018, FR-025, FR-026, FR-027; Q4,Q18,Q21,Q28)
- [ ] T034 [US4] RED -> GREEN -> REFACTOR Python `match`/`case` source-order predicates and guarded cases through the multi-way branch contract in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-python.test.ts`; evidence: focused match/case fixture tests plus full gate `npm test` (FR-021; Q6)
- [ ] T035 [US4] RED -> GREEN -> REFACTOR Python list, set, dict comprehensions and generator expressions as loops, filters, and evaluation order in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-python.test.ts`; evidence: focused comprehension/generator fixture tests plus full gate `npm test` (FR-022; Q25)
- [ ] T036 [US4] RED -> GREEN -> REFACTOR Python `await`, `yield`, and `yield from` as ordinary intra-procedural operations without suspension/resumption edges in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-python.test.ts`; evidence: focused async/generator ordinary-operation tests plus full gate `npm test` (FR-024; Q17)
- [ ] T037 [US4] RED -> GREEN -> REFACTOR Python parity in library, CLI JSON, MCP paging, status, determinism, and skip contracts in `__tests__/analysis/cfg/cfg-contract.test.ts`, `__tests__/analysis/cfg/cfg-python.test.ts`, and `src/analysis/cfg/index.ts`; evidence: focused cross-language parity matrix plus full gate `npm test` (FR-011, FR-013, FR-029, FR-031, FR-033, FR-034; Q7,Q8,Q10,Q16,Q22,Q27)
- [ ] T038 [US4] RED -> GREEN -> REFACTOR Python parity UAT evidence and runbook updates in `specs/014-control-flow-graphs/quickstart.md`; evidence: focused Python UAT transcript plus full gate `npm run build` and `npm test` (FR-034; Constitution Dogfooding)

**Checkpoint**: Slice 2 is independently complete when Python satisfies the same machine contract and all Python-specific construct fixtures pass.

---

## Phase 7: Polish, Gates, and Review Packet

**Purpose**: Validate the full feature, preserve reviewability, and prepare review evidence without broadening scope.

- [ ] T039 RED -> GREEN -> REFACTOR paired-median disabled/enabled CFG performance benchmark in `__tests__/analysis/cfg/cfg-performance.test.ts`; evidence: focused 2-warmup/10-measured-pair PR benchmark, CI smoke allowance, recorded environment metadata, and full gate `npm test` (FR-002, FR-032; Q2,Q14)
- [ ] T040 RED -> GREEN -> REFACTOR final full gates in `package.json` command surfaces by running `npm run build`, focused CFG suites, and `npm test`; evidence: focused suite outputs plus full build/test output captured for PR packet (FR-031, FR-033, FR-034; Q10,Q22)
- [ ] T041 RED -> GREEN -> REFACTOR retrieval-guardian review for all `src/mcp/tools.ts` and `src/mcp/server-instructions.ts` changes; evidence: focused retrieval-guardian verdict plus full gate `npm test` (FR-029; Q16)
- [ ] T042 RED -> GREEN -> REFACTOR PR review packet with what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, rollback/feature-flag notes, and separated source/fixture/benchmark/generated evidence in `specs/014-control-flow-graphs/quickstart.md`; evidence: focused packet checklist plus full gate references `npm run build` and `npm test` (FR-033, FR-034; Q22)
- [ ] T043 RED -> GREEN -> REFACTOR final reviewability re-check against 780 reviewable LOC, 8 production surfaces, 18 total files, and two vertical slices in `specs/014-control-flow-graphs/tasks.md`; evidence: focused scope-budget note plus full gate `npm run build` and `npm test` (FR-033; Q22)

---

## Dependencies and Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies.
- **Phase 2 Foundational**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 US1 / Slice 1 Library Path**: Depends on Phase 2.
- **Phase 4 US2 / Slice 1 Lifecycle**: Depends on Phase 3 because lifecycle states need a working TS/JS library CFG path.
- **Phase 5 US3 / Slice 1 Surfaces**: Depends on Phases 3 and 4 because CLI/MCP/status must expose the same persisted state.
- **Phase 6 US4 / Slice 2 Python Parity**: Depends on complete Slice 1.
- **Phase 7 Polish**: Depends on selected slice completion; final benchmark, retrieval-guardian, and PR packet depend on all source-affecting tasks.

### User Story Dependencies

- **US1 (P1)**: Can start after foundation and is the MVP.
- **US2 (P1)**: Starts after US1 minimum library path, then proves persistence lifecycle.
- **US3 (P2)**: Starts after US1 and US2 state contract exists, then adds CLI/MCP/status parity.
- **US4 (P3)**: Starts after Slice 1 is complete, then carries Python through the same path.

### Slice Counts

- **Slice 1 behavior tasks**: 23 tasks (`T009`-`T031`) after setup and foundation tasks `T001`-`T008`
- **Slice 2 behavior tasks**: 7 tasks (`T032`-`T038`)
- **Cross-cutting gates**: 5 tasks (`T039`-`T043`)

---

## Parallel Opportunities

- `T002` and `T003` can run in parallel because they write different fixture directories and do not decide shared contracts.
- After `T004`-`T008`, most TypeScript/JavaScript semantic fixture work can be prepared in parallel, but implementation tasks `T009`-`T016` should merge sequentially because they share `src/analysis/cfg/index.ts`.
- CLI-only and MCP-only tests can be drafted in parallel after `T024`, but changes to `src/bin/codegraph.ts`, `src/mcp/tools.ts`, and shared result helpers must be integrated sequentially.
- Python fixtures can be prepared while Slice 1 is under review, but `T032`-`T037` implementation waits for the Slice 1 contract to be stable.

---

## Parallel Example: Race-Free Fixture Preparation

```text
Task: "T002 Add deterministic TypeScript/JavaScript fixture inventory in __tests__/analysis/cfg/fixtures/tsjs/"
Task: "T003 Add committed Python fixture inventory in __tests__/analysis/cfg/fixtures/python/"
```

## Implementation Strategy

### MVP First

1. Complete Phase 1.
2. Complete Phase 2.
3. Complete Phase 3 through `T009` minimum vertical path.
4. Stop and validate `CodeGraph.getCfg` returns a deterministic TypeScript/JavaScript `available` result.

### Slice 1 Completion

1. Finish US1 semantics and skip states.
2. Finish US2 lifecycle and failure states.
3. Finish US3 CLI, MCP, status, self-repo UAT, and retrieval guidance.
4. Run focused Slice 1 suites plus `npm run build` and `npm test`.

### Slice 2 Completion

1. Add deterministic Python lambda identity.
2. Carry Python fixtures through the existing shared CFG path.
3. Add Python construct coverage and cross-language parity.
4. Run focused Python/contract suites plus `npm run build` and `npm test`.

---

## Requirement Coverage

| Requirement | Task Coverage | Traceability |
|---|---|---|
| FR-001 | T006, T009, T020 | Q2 |
| FR-002 | T006, T020, T039 | Q2, Q20 |
| FR-003 | T009, T017 | Q19 |
| FR-004 | T004, T005, T018 | Q3 |
| FR-005 | T004, T019 | Q3 |
| FR-006 | T006, T020 | Q20 |
| FR-007 | T020 | Q20, Q19 |
| FR-008 | T021 | Q13 |
| FR-009 | T021, T022 | Q13 |
| FR-010 | T019, T024 | Q9 |
| FR-011 | T007, T009, T024, T026, T029, T031, T037 | Q7, Q27 |
| FR-012 | T007, T009, T024, T026 | Q7, Q27 |
| FR-013 | T007, T008, T011, T019, T021, T025, T026, T029, T037 | Q7 |
| FR-014 | T002, T007, T009, T010, T016 | Q10, Q11 |
| FR-015 | T004, T005, T008, T018, T023 | Q12 |
| FR-016 | T002, T008, T011 | Q1 |
| FR-017 | T002, T008, T012 | Q15, Q23 |
| FR-018 | T002, T013, T033 | Q4 |
| FR-019 | T002, T014 | Q5 |
| FR-020 | T002, T015 | Q6 |
| FR-021 | T003, T034 | Q6 |
| FR-022 | T003, T035 | Q25 |
| FR-023 | T002, T014 | Q26 |
| FR-024 | T003, T036 | Q17 |
| FR-025 | T002, T003, T016, T032, T033 | Q28 |
| FR-026 | T002, T003, T016, T033 | Q18 |
| FR-027 | T002, T010, T013, T015, T033 | Q21 |
| FR-028 | T024, T025, T029 | Q7, Q8, Q9, Q27 |
| FR-029 | T008, T026, T027, T029, T030, T031, T037, T041 | Q8, Q16 |
| FR-030 | T028, T031 | Q24 |
| FR-031 | T002, T010, T037, T040 | Q10 |
| FR-032 | T039 | Q14 |
| FR-033 | T001, T037, T040, T042, T043 | Q22 |
| FR-034 | T003, T031, T037, T038, T040, T042 | Constitution Dogfooding |

---

## G5 Readiness

- **Total tasks**: 43
- **User-story tasks**: US1 = 8, US2 = 7, US3 = 8, US4 = 7
- **Setup/foundational tasks**: 8
- **Polish/gate tasks**: 5
- **Vertical slices**: Slice 1 = shared plus TypeScript/JavaScript end to end; Slice 2 = Python parity through the same contracts
- **Requirement coverage**: FR-001 through FR-034 covered at least once
- **Task format**: Every task uses checkbox, sequential ID, optional `[P]`, required story label for user-story phases, and exact file path
- **Marker check**: No clarification, gap, or critical markers are intentionally present
- **Unresolved consensus**: None
