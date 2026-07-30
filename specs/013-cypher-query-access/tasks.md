# Tasks: Cypher Query Access

**Input**: Design documents from `specs/013-cypher-query-access/`

**Prerequisites**: `specs/013-cypher-query-access/spec.md`, `specs/013-cypher-query-access/plan.md`, `specs/013-cypher-query-access/research.md`, `specs/013-cypher-query-access/data-model.md`, `specs/013-cypher-query-access/contracts/`, and `specs/013-cypher-query-access/checklists/`

**Tests**: Required. SPEC-013 changes public API, CLI, MCP, query execution, safety boundaries, and retrieval steering. Tasks must follow strict RED -> GREEN -> REFACTOR -> VERIFY ordering.

**Organization**: Tasks are grouped by setup, blocking foundation, user story, and accepted vertical slice. Slice 1 delivers bounded connected-path querying end-to-end. Slice 2 delivers count/grouping, string predicates, backtick identifiers, recipes, and final guardrail closure.

**Reviewability**: Planned implementation remains within the accepted two-slice mitigation from `specs/013-cypher-query-access/plan.md`. If G5 or implementation scope exceeds one primary surface without the accepted mitigation, stop and split through the specified stack route.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and has no shared generated state, branch state, or artifact-order dependency.
- **[Story]**: `US1`, `US2`, or `US3` from `specs/013-cypher-query-access/spec.md`.
- Every task names exact repository paths or explicit branch/evidence targets.

---

## Phase 1: Setup and G5 Gate

**Purpose**: Establish implementation evidence, reviewability, and atomicity routing before code changes.

- [X] T001 Create `specs/013-cypher-query-access/evidence-matrix.md` with columns from `specs/013-cypher-query-access/plan.md`: id, slice, surface, input, command, expectedState, observedState, parityHash, artifact, reviewer, and date.
- [X] T002 Seed `specs/013-cypher-query-access/evidence-matrix.md` with placeholder rows for FR-001 through FR-032, SC-001 through SC-010, at least ten recipe rows, guard probes, performance probes, retrieval-guardian, retrieval A/B authorization, and PR review-packet evidence.
- [X] T003 Run the G5 atomicity classifier against `specs/013-cypher-query-access/tasks.md` after this file exists and record the selected one-PR or split-PR route in `specs/013-cypher-query-access/evidence-matrix.md`.
- [X] T004 If G5 selects split-PR, use exactly two branches: bottom `013-cypher-query-access-slice1` from `origin/main`, top `013-cypher-query-access-slice2` from `013-cypher-query-access-slice1`; record planned `gh stack submit --auto --remote origin` and `gh stack view --json` proof targets in `specs/013-cypher-query-access/evidence-matrix.md`.
- [X] T005 If G5 selects one PR, record that gh-stack proof is not applicable in `specs/013-cypher-query-access/evidence-matrix.md` while preserving the Slice 1 and Slice 2 internal verification checkpoints.
- [X] T006 Verify the planned file set from `specs/013-cypher-query-access/plan.md` before implementation: `src/query/cypher/index.ts`, `src/query/cypher/runtime.ts`, `src/query/cypher/serializer.ts`, `src/index.ts`, `src/bin/codegraph.ts`, `src/mcp/tools.ts`, `src/mcp/server-instructions.ts`, `CHANGELOG.md`, `__tests__/cypher-parser.test.ts`, `__tests__/cypher-runtime.test.ts`, `__tests__/cypher-recipes.test.ts`, `__tests__/cli-query-command.test.ts`, `__tests__/mcp-cypher-query.test.ts`, `__tests__/mcp-server-instructions.test.ts`, and `docs/ai/specs/013-cypher-query-access-recipes.md`.
- [X] T007 Record the pre-implementation reviewability decision in `specs/013-cypher-query-access/evidence-matrix.md`; stop if the task/file scope exceeds the accepted budget or needs a third slice.

**Checkpoint**: G5 route and reviewability evidence are recorded before feature implementation.

---

## Phase 2: Foundational Test Harness

**Purpose**: Add reusable failing-test scaffolding only; no production behavior belongs in this phase.

- [ ] T008 [P] Add shared real-SQLite graph fixture helpers in `__tests__/cypher-runtime.test.ts` for public nodes, active static/LSP/heuristic edges, inactive LSP-suppressed rows, cycles, malformed opaque JSON, high-degree traversal, schema/data snapshots, and representative node/edge record snapshots.
- [ ] T009 [P] Add CLI process helpers in `__tests__/cli-query-command.test.ts` for positional `MATCH`, stdin `-`, malformed stdin, raw stdout byte capture, raw stderr capture, exit-code capture, and shared `--path` execution.
- [ ] T010 [P] Add MCP invocation helpers in `__tests__/mcp-cypher-query.test.ts` for `codegraph_query`, default-list inspection, success-shaped response capture, raw text byte capture, and `isError` assertions.
- [ ] T011 [P] Add recipe fixture and transcript helpers in `__tests__/cypher-recipes.test.ts` for fixture recipes, live self-index recipes, guard probes, parity hash capture, and artifact path recording.
- [ ] T012 Add test evidence helper notes to `specs/013-cypher-query-access/evidence-matrix.md` for red/green/focused/full/live validation commands.

**Checkpoint**: Test harness support exists before story-level red tests are written.

---

## Phase 3: User Story 1 - Bounded Graph Evidence, Slice 1 (Priority: P1)

**Goal**: A graph explorer can run one connected node/relationship pattern with filters and bounded paths and receive deterministic typed public evidence through package API, CLI, and MCP.

**Independent Test**: Run the same bounded connected-path query through `queryCypher`, `codegraph query --json`, and `codegraph_query` against a prepared index and verify typed node, relationship, path, scalar, ordering, cap, truncation, timeout, and diagnostic behavior.

### RED: Tests First

- [ ] T013 [P] [US1] Add failing grammar and semantic tests in `__tests__/cypher-parser.test.ts` for one connected `MATCH` chain, optional full-chain path binding, public labels/types, explicit arrows, fixed relationships, `*lower..upper` bounds, unique declarations, rejected disconnected/comma/multi-`MATCH`/undirected/write/direct-SQL forms, case-insensitive keywords, case-sensitive public names, single-quoted literals, bound-literal expectations, and UTF-16 diagnostic locations. Covers FR-001, FR-002, FR-003, FR-004, FR-006, FR-007, FR-008, FR-014, FR-016, FR-023, FR-024, SC-001, SC-005.
- [ ] T014 [P] [US1] Add failing runtime and public API tests in `__tests__/cypher-runtime.test.ts` for public graph mapping, active-edge filtering, fixed traversal, variable traversal up to eight edges, relationship-simple paths with recurring nodes allowed, ordered typed path values, top-level property filters, null checks, boolean operators, comparisons, opaque return-only JSON shape conversion, stable ordering, `ORDER BY`, `LIMIT`, default cap, hard cap, `effectiveCap + 1`, output-too-large diagnostic, read-only invariants, not-indexed diagnostic, and worker timeout cleanup. Covers FR-003, FR-005, FR-009, FR-010, FR-011, FR-013, FR-017, FR-019, FR-020, FR-021, FR-022, FR-024, FR-031, SC-002, SC-005, SC-007, SC-008, SC-010.
- [ ] T015 [P] [US1] Add failing CLI tests in `__tests__/cli-query-command.test.ts` for `codegraph query <MATCH...>`, `codegraph query -`, bounded UTF-8 stdin, `--path`, `--json`, rejected Cypher-mode `--kind`, `--mode`, `--limit`, rejected `--file`, Cypher `LIMIT` inside query text, legacy search preservation for non-`MATCH` text, failure exit mapping, and canonical JSON without a trailing newline. Covers FR-001, FR-002, FR-022, FR-025, FR-026, FR-027, SC-001, SC-006.
- [ ] T016 [P] [US1] Add failing MCP tests in `__tests__/mcp-cypher-query.test.ts` for default-listed `codegraph_query`, valid bounded path result, empty success, parser diagnostic, unsupported-subset diagnostic, not-indexed diagnostic, timeout state, path/access refusal separation, and success-shaped expected states without `isError`. Covers FR-001, FR-002, FR-022, FR-026, FR-028, SC-001, SC-002, SC-006, SC-008.
- [ ] T017 [US1] Run and record failing Slice 1 focused tests in `specs/013-cypher-query-access/evidence-matrix.md`: `npx vitest run __tests__/cypher-parser.test.ts __tests__/cypher-runtime.test.ts __tests__/cli-query-command.test.ts __tests__/mcp-cypher-query.test.ts`.

### GREEN: Implementation

- [ ] T018 [US1] Implement the dependency-free lexer, token location tracking, string literal validation, keyword handling, private AST, and recursive-descent parser for the Slice 1 grammar in `src/query/cypher/index.ts`. Satisfies FR-001, FR-002, FR-006, FR-007, FR-008, FR-014, FR-016, FR-023, FR-024.
- [ ] T019 [US1] Implement the v1 public virtual schema catalog and exact case-sensitive label/type/property validation in `src/query/cypher/index.ts`, including public `column`, excluding `updatedAt`, and rejecting unknown names. Satisfies FR-003, FR-004, FR-014.
- [ ] T020 [US1] Implement semantic planning for one connected chain, variable uniqueness, path binding, JSON/array return-only field restrictions, unsupported subset diagnostics, and read-only rejection before SQLite prepare in `src/query/cypher/index.ts`. Satisfies FR-004, FR-006, FR-010, FR-013, FR-024.
- [ ] T021 [US1] Implement parameterized SQL emission for fixed and variable relationships in `src/query/cypher/index.ts`, including `SELECT`/`WITH RECURSIVE` whitelist validation, active-edge predicates, direction-specific edge index eligibility, relationship-simple visited-edge state, depth bounds, and bounded recursive frontier/output guards before final caps. Satisfies FR-005, FR-007, FR-008, FR-009, FR-020, FR-024, SC-010.
- [ ] T022 [US1] Implement Slice 1 `WHERE` predicates in `src/query/cypher/index.ts`: `IS NULL`, `IS NOT NULL`, `AND`, `OR`, `NOT`, parentheses, comparisons, missing optional property nulls, and rejected predicates over opaque JSON/array fields. Satisfies FR-011, FR-013.
- [ ] T023 [US1] Implement Slice 1 `RETURN`, alias, scalar/node/relationship/path projection, deterministic default ordering, explicit `ORDER BY`, `LIMIT`, default cap, hard cap, no `totalRows`, and `truncated` detection in `src/query/cypher/index.ts`. Satisfies FR-017, FR-019, FR-020.
- [ ] T024 [US1] Implement the dedicated read-only SQLite open path, worker-thread execution boundary, fixed five-second deadline, timeout termination/replacement, no-background-continuation handling, and shared timeout result mapping in `src/query/cypher/runtime.ts`. Satisfies FR-021, FR-022, FR-024, SC-005, SC-008.
- [ ] T025 [US1] Implement the canonical result union serializer, stable recursive object-key ordering, minified UTF-8 bytes, preserved arrays, no trailing newline, 1 MiB payload ceiling, table row adapter, and output-too-large diagnostic in `src/query/cypher/serializer.ts`. Satisfies FR-020, FR-026, FR-027, SC-006.
- [ ] T026 [US1] Export `queryCypher(projectRoot, query)` and stable public `CypherQueryResult`, `CypherSuccessResult`, `CypherDiagnosticResult`, `CypherTimeoutResult`, `CypherValue`, node, relationship, and path value types from `src/index.ts` while keeping lexer, parser, AST, planner, SQL, and emitter internals private. Satisfies FR-031.
- [ ] T027 [US1] Wire Cypher mode into `src/bin/codegraph.ts` for first-token `MATCH`, stdin `-`, bounded input checks, malformed stdin diagnostic, shared `--path`, shared `--json`, rejected search-only flags, failure exits for diagnostics/timeouts, and human table rendering from the shared adapter. Satisfies FR-001, FR-002, FR-022, FR-025, FR-026, FR-027.
- [ ] T028 [US1] Add `codegraph_query` to `src/mcp/tools.ts` with default listing, `query` and optional `projectPath` inputs, shared result mapping, success-shaped expected states, timeout guidance, and reserved `isError` for path/access refusals or malfunctions. Satisfies FR-001, FR-002, FR-022, FR-026, FR-028.
- [ ] T029 [US1] Run Slice 1 focused green tests and record commands/statuses in `specs/013-cypher-query-access/evidence-matrix.md`: `npx vitest run __tests__/cypher-parser.test.ts`, `npx vitest run __tests__/cypher-runtime.test.ts`, `npx vitest run __tests__/cli-query-command.test.ts`, and `npx vitest run __tests__/mcp-cypher-query.test.ts`.

### REFACTOR

- [ ] T030 [US1] Refactor `src/query/cypher/index.ts`, `src/query/cypher/runtime.ts`, and `src/query/cypher/serializer.ts` only after green tests to keep private parser/planner/emitter internals unexported, remove duplication, preserve deterministic behavior, and stay inside the Slice 1 reviewability budget.

### VERIFY

- [ ] T031 [US1] Demonstrate Slice 1 independently and record evidence in `specs/013-cypher-query-access/evidence-matrix.md`: package API query via `queryCypher`, CLI query `node dist/bin/codegraph.js query "MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5" --json`, stdin query `printf '%s' 'MATCH (n:function)-[:calls]->(m:function) RETURN n.name, m.name LIMIT 5' | node dist/bin/codegraph.js query - --json`, and MCP `codegraph_query` with byte parity hash where applicable.

**Checkpoint**: Slice 1 is independently demonstrable across package API, CLI, and MCP before Slice 2 begins.

---

## Phase 4: User Story 3 - Safe Cross-Surface Operation, Slice 1 Closure (Priority: P3)

**Goal**: Operators and agent integrators receive the same bounded result shape and safe expected failures through package API, CLI, and MCP without mutating the repository.

**Independent Test**: Submit identical valid and invalid Slice 1 queries through all entry points and compare package union shape, CLI bytes, MCP text bytes, exit behavior, success-shaped MCP states, mutation guards, and retrieval guidance.

### RED: Tests First

- [ ] T032 [US3] Add failing cross-surface byte-parity tests in `__tests__/cli-query-command.test.ts` and `__tests__/mcp-cypher-query.test.ts` for valid result, empty success, capped/truncated result, syntax diagnostic, unsupported write diagnostic, oversized input diagnostic, malformed stdin diagnostic, output-too-large diagnostic, timeout state, and not-indexed diagnostic. Covers FR-002, FR-020, FR-022, FR-023, FR-026, FR-028, SC-001, SC-006, SC-007, SC-008.
- [ ] T033 [P] [US3] Add failing security and privacy diagnostics tests in `__tests__/cypher-runtime.test.ts` for no raw full query text, no unbounded string literal values, no emitted SQL, no bound parameters, no oversized input echo, escaped excerpts at no more than 160 UTF-16 code units, Unicode astral code points, combining characters, CRLF/LF, and multiline source spans. Covers FR-023, FR-024, SC-005.
- [ ] T034 [P] [US3] Add failing MCP steering tests in `__tests__/mcp-server-instructions.test.ts` proving `codegraph_explore` remains primary and `codegraph_query` is reserved for deliberate structured graph-language requests. Covers FR-028, FR-030, SC-009.

### GREEN: Implementation

- [ ] T035 [US3] Complete shared canonical serializer usage in `src/bin/codegraph.ts` and `src/mcp/tools.ts` so CLI `--json` and MCP text write byte-identical payloads with no framing for success, capped, diagnostic, output-too-large, timeout, and not-indexed states. Satisfies FR-020, FR-026, FR-028, SC-006.
- [ ] T036 [US3] Complete stable diagnostic construction in `src/query/cypher/index.ts`, `src/query/cypher/runtime.ts`, `src/bin/codegraph.ts`, and `src/mcp/tools.ts`, including offsets, anchors, bounded excerpts, malformed stdin, oversized input, no unsafe logging, CLI exit mapping, and MCP success-shaped expected states. Satisfies FR-002, FR-022, FR-023, FR-024, FR-028, SC-005.
- [ ] T037 [US3] Update `src/mcp/server-instructions.ts` so default retrieval guidance keeps `codegraph_explore` primary and describes `codegraph_query` only for deliberate structured graph-language requests. Satisfies FR-028, FR-030.
- [ ] T038 [US3] Run focused Slice 1 safety tests and record results in `specs/013-cypher-query-access/evidence-matrix.md`: `npx vitest run __tests__/cypher-runtime.test.ts __tests__/cli-query-command.test.ts __tests__/mcp-cypher-query.test.ts __tests__/mcp-server-instructions.test.ts`.

### REFACTOR

- [ ] T039 [US3] Refactor `src/query/cypher/serializer.ts`, `src/bin/codegraph.ts`, and `src/mcp/tools.ts` to remove duplicate result mapping while preserving byte-identical machine output and expected-state MCP trust boundaries.

### VERIFY

- [ ] T040 [US3] Verify Slice 1 safe-operation evidence in `specs/013-cypher-query-access/evidence-matrix.md` with CLI/MCP parity hashes, read-only snapshot comparisons, malformed stdin diagnostic, timeout cleanup/replacement result, and MCP instruction test output.

**Checkpoint**: Slice 1 remains independently demonstrable and safe after cross-surface closure.

---

## Phase 5: User Story 2 - Practical Recipe Queries, Slice 2 (Priority: P2)

**Goal**: A power user can project, order, limit, count, group, use string predicates, use backtick identifiers, and run documented recipes across package API, CLI, and MCP.

**Independent Test**: Run count/grouping, string predicate, backtick identifier, and recipe queries through package API, CLI, and MCP, then record representative outputs or expected-empty dispositions.

### RED: Tests First

- [ ] T041 [P] [US2] Add failing count and implicit grouping tests in `__tests__/cypher-parser.test.ts` for `count(*)`, `count(expr)`, non-aggregate grouping keys, rejected unsupported aggregation, rejected `DISTINCT`, aliases, and `ORDER BY` over aliases. Covers FR-017, FR-018, FR-019, SC-003.
- [ ] T042 [P] [US2] Add failing runtime tests in `__tests__/cypher-runtime.test.ts` for `count(*)`, `count(expr)`, implicit grouping, string predicate null semantics, `STARTS WITH`, `ENDS WITH`, `CONTAINS`, explicit null ordering, stable repeated-run serialization, cap-plus-one behavior with groups, payload-too-large aggregates, and realistic graph-density query plans. Covers FR-011, FR-012, FR-018, FR-019, FR-020, SC-003, SC-007, SC-010.
- [ ] T043 [P] [US2] Add failing identifier tests in `__tests__/cypher-parser.test.ts` for backtick-escaped identifiers and aliases, doubled-backtick unescaping, rejected control characters, rejected Unicode escape forms, exact case-sensitive comparison, and no Unicode normalization. Covers FR-014, FR-015, SC-003, SC-005.
- [ ] T044 [P] [US2] Add failing CLI tests in `__tests__/cli-query-command.test.ts` for `codegraph search <text>`, literal search terms beginning with `MATCH` or `-`, final human table rendering for aggregate/scalar/path values, and unchanged legacy search behavior. Covers FR-001, FR-025, FR-027.
- [ ] T045 [P] [US2] Add failing MCP tests in `__tests__/mcp-cypher-query.test.ts` for count/grouping, string predicates, backtick identifiers, canonical aggregate JSON, empty recipe output, timeout guidance, and byte parity with CLI `--json`. Covers FR-012, FR-015, FR-018, FR-026, FR-028, SC-003, SC-006.
- [ ] T046 [P] [US2] Add failing recipe coverage in `__tests__/cypher-recipes.test.ts` and recipe documentation placeholders in `docs/ai/specs/013-cypher-query-access-recipes.md` for at least ten practical recipes, guard probes, live self-index command slots, parity hash slots, reviewer/date fields, representative output, and expected-empty reasons. Covers FR-029, SC-004.
- [ ] T047 [US2] Run and record failing Slice 2 focused tests in `specs/013-cypher-query-access/evidence-matrix.md`: `npx vitest run __tests__/cypher-parser.test.ts __tests__/cypher-runtime.test.ts __tests__/cli-query-command.test.ts __tests__/mcp-cypher-query.test.ts __tests__/cypher-recipes.test.ts`.

### GREEN: Implementation

- [ ] T048 [US2] Implement `count(*)`, `count(expr)`, implicit grouping by every returned non-aggregate item, rejected unsupported aggregation, and aggregate-aware ordering in `src/query/cypher/index.ts`. Satisfies FR-017, FR-018, FR-019.
- [ ] T049 [US2] Implement `STARTS WITH`, `ENDS WITH`, and `CONTAINS` with documented three-valued null semantics and supported string-value checks in `src/query/cypher/index.ts`. Satisfies FR-011, FR-012.
- [ ] T050 [US2] Implement backtick-escaped identifiers and aliases, doubled-backtick unescaping, unsupported control/Unicode escape diagnostics, exact case-sensitive name matching, and no Unicode normalization in `src/query/cypher/index.ts`. Satisfies FR-014, FR-015.
- [ ] T051 [US2] Extend canonical serialization in `src/query/cypher/serializer.ts` for aggregate rows, opaque values by canonical JSON bytes, deterministic grouped results, recipe output states, and output-size diagnostics. Satisfies FR-019, FR-020, FR-026.
- [ ] T052 [US2] Add `codegraph search <text>` and final table rendering polish in `src/bin/codegraph.ts`, preserving legacy `query` behavior outside Cypher routing and keeping Cypher limits inside query text. Satisfies FR-001, FR-025, FR-027.
- [ ] T053 [US2] Complete final MCP schema, guidance text, recipe-compatible result mapping, and success-shaped diagnostic/timeout states in `src/mcp/tools.ts`. Satisfies FR-028.
- [ ] T054 [US2] Write at least ten documented recipes and guard probes in `docs/ai/specs/013-cypher-query-access-recipes.md`, including callers, path, hub, dead-export, count/grouping, string predicate, backtick identifier, row cap, path cap, timeout, read-only, malformed input, payload ceiling, CLI/MCP parity, and expected-empty examples. Satisfies FR-029, SC-004.
- [ ] T055 [US2] Run Slice 2 focused green tests and record commands/statuses in `specs/013-cypher-query-access/evidence-matrix.md`: `npx vitest run __tests__/cypher-parser.test.ts`, `npx vitest run __tests__/cypher-runtime.test.ts`, `npx vitest run __tests__/cli-query-command.test.ts`, `npx vitest run __tests__/mcp-cypher-query.test.ts`, and `npx vitest run __tests__/cypher-recipes.test.ts`.

### REFACTOR

- [ ] T056 [US2] Refactor `src/query/cypher/index.ts`, `src/query/cypher/serializer.ts`, `src/bin/codegraph.ts`, and `src/mcp/tools.ts` only after green tests to keep the language subset private, remove duplication, preserve public contracts, and stay within the Slice 2 reviewability budget.

### VERIFY

- [ ] T057 [US2] Demonstrate Slice 2 independently and record evidence in `specs/013-cypher-query-access/evidence-matrix.md`: package API count/grouping query, CLI `node dist/bin/codegraph.js query "MATCH (n:function) WHERE n.name STARTS WITH 'q' RETURN n.filePath, count(*) AS callers ORDER BY callers DESC LIMIT 10" --json`, CLI `codegraph search` escape-hatch search, MCP `codegraph_query` parity hash, and representative recipe outputs or expected-empty dispositions.

**Checkpoint**: Slice 2 is independently demonstrable across package API, CLI, MCP, documented recipes, and live self-index evidence slots.

---

## Phase 6: User Story 3 - Safe Cross-Surface Operation, Final Closure (Priority: P3)

**Goal**: The completed feature returns the same canonical bounded result or safe failure everywhere, never mutates data, and preserves retrieval trust boundaries.

**Independent Test**: Send identical valid, invalid, mutating, oversized, over-cap, over-payload, timeout, not-indexed, and malformed-stdin inputs through package API, CLI, and MCP; compare behavior, bytes, invariants, and retrieval guidance.

### RED: Tests First

- [ ] T058 [P] [US3] Add final guardrail tests in `__tests__/cypher-runtime.test.ts` for rejected mutating/direct-SQL syntax before prepare, external parameter syntax rejection, unsupported openCypher rejection, no schema/data version changes, no graph row count changes, no representative node/edge mutations, timeout worker replacement, and read-only connection dormancy. Covers FR-021, FR-024, SC-005, SC-008.
- [ ] T059 [P] [US3] Add final parity and malformed-input tests in `__tests__/cli-query-command.test.ts` and `__tests__/mcp-cypher-query.test.ts` for malformed UTF-8 stdin, oversized query text across all surfaces, payload-too-large diagnostics, timeout states, path/access refusal separation, MCP expected-state `isError` absence, and byte-identical CLI/MCP JSON for every required state. Covers FR-002, FR-020, FR-022, FR-023, FR-026, FR-028, SC-001, SC-006.
- [ ] T060 [P] [US3] Add final retrieval steering and regression-surface tests in `__tests__/mcp-server-instructions.test.ts` for default tool listing, no instruction to prefer Cypher over explore, and reserved `codegraph_query` language. Covers FR-028, FR-030, SC-009.
- [ ] T061 [P] [US3] Add representative performance probe tests in `__tests__/cypher-runtime.test.ts` and `__tests__/cypher-recipes.test.ts` for variable-path query plans, stable ordering, count/grouping, row-cap truncation, output-size rejection, edge-index use, and bounded temporary sort/group work. Covers FR-020, FR-029, SC-010.

### GREEN: Implementation

- [ ] T062 [US3] Complete defense-in-depth read-only SQL validation and rejected-input handling in `src/query/cypher/index.ts` and `src/query/cypher/runtime.ts`, including one parameterized SELECT-only statement, CTE SELECT-only validation, no statement lists, no PRAGMA/ATTACH/DETACH/transaction/DDL/DML, and no prepare/execution for rejected syntax. Satisfies FR-024, SC-005.
- [ ] T063 [US3] Complete malformed stdin, oversized input, rejected flag, timeout, diagnostic, and failure-exit behavior in `src/bin/codegraph.ts` without adding `--file` support or exposing raw query/literal/SQL/parameter data. Satisfies FR-002, FR-022, FR-023, FR-025.
- [ ] T064 [US3] Complete final MCP result shaping in `src/mcp/tools.ts`, including success, empty, not-indexed, diagnostic, timeout, payload-too-large, path/access refusal, and malfunction boundaries. Satisfies FR-028.
- [ ] T065 [US3] Complete retrieval guidance in `src/mcp/server-instructions.ts` and ensure `codegraph_query` is default-listed but not positioned as the primary retrieval tool. Satisfies FR-028, FR-030.
- [ ] T066 [US3] Run final focused guardrail tests and record commands/statuses in `specs/013-cypher-query-access/evidence-matrix.md`: `npx vitest run __tests__/cypher-runtime.test.ts __tests__/cli-query-command.test.ts __tests__/mcp-cypher-query.test.ts __tests__/mcp-server-instructions.test.ts __tests__/cypher-recipes.test.ts`.

### REFACTOR

- [ ] T067 [US3] Refactor `src/query/cypher/index.ts`, `src/query/cypher/runtime.ts`, `src/query/cypher/serializer.ts`, `src/bin/codegraph.ts`, `src/mcp/tools.ts`, and `src/mcp/server-instructions.ts` after final focused tests to remove duplication and keep expected failures stable, success-shaped, and bounded.

### VERIFY

- [ ] T068 [US3] Run retrieval-guardian review for changes under `src/mcp/tools.ts` and `src/mcp/server-instructions.ts`; record disposition and findings in `specs/013-cypher-query-access/evidence-matrix.md`.
- [ ] T069 [US3] Run retrieval A/B validation only after explicit runtime authorization records provider, model/tool endpoints, repository context to be sent, retention/training setting, cost/time limit, and approval timestamp; if authorization is absent, record the retrieval A/B gate as blocked in `specs/013-cypher-query-access/evidence-matrix.md` and do not send repository context off-box.
- [ ] T070 [US3] Verify final safe-operation evidence in `specs/013-cypher-query-access/evidence-matrix.md`: byte parity hashes, read-only snapshot comparisons, timeout cleanup/replacement, malformed stdin diagnostic, payload ceiling diagnostic, MCP default-listing, and retrieval steering test output.

**Checkpoint**: US3 safe-operation closure is complete or explicitly blocked only by external/off-box evaluation authorization.

---

## Phase 7: Polish, Documentation, and Delivery Evidence

**Purpose**: Finish user-facing documentation, validation, traceability, and PR evidence without expanding implementation scope.

- [ ] T071 [P] Update `CHANGELOG.md` under `## [Unreleased]` with a user-facing Cypher query access capability note and no internal implementation-path language.
- [ ] T072 [P] Update `specs/013-cypher-query-access/quickstart.md` with runnable focused, full, CLI, MCP, live self-index, recipe, parity, guardrail, and retrieval authorization validation commands.
- [ ] T073 Complete `specs/013-cypher-query-access/evidence-matrix.md` rows for every FR, SC, recipe, guard probe, performance probe, retrieval-guardian result, retrieval A/B authorization disposition, slice demo, and parity hash.
- [ ] T074 Run full local validation and record output in `specs/013-cypher-query-access/evidence-matrix.md`: `npm run build`, `npm run typecheck`, and `npm test`.
- [ ] T075 Run live self-index UAT and record output in `specs/013-cypher-query-access/evidence-matrix.md`: `node dist/bin/codegraph.js status . --json`, `node dist/bin/codegraph.js query "MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5" --json`, and `printf '%s' 'MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5' | node dist/bin/codegraph.js query - --json`.
- [ ] T076 Compare CLI `--json` bytes and MCP `codegraph_query` text bytes for valid, capped, diagnostic, timeout, not-indexed, malformed stdin, and payload-too-large states; record parity hashes in `specs/013-cypher-query-access/evidence-matrix.md`.
- [ ] T077 Prepare PR description content from `specs/013-cypher-query-access/evidence-matrix.md` with what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, rollback or feature-flag notes, and the selected one-PR or gh-stack route.
- [ ] T078 If split-PR delivery was selected by G5, run `gh stack submit --auto --remote origin`, then `gh stack view --json`, and record JSON proof in `specs/013-cypher-query-access/evidence-matrix.md`; if one PR was selected, record gh-stack proof as not applicable and do not manufacture stack evidence.
- [ ] T079 Run final hygiene checks and record status in `specs/013-cypher-query-access/evidence-matrix.md`: `git diff --check`, `git status --porcelain=v1 --untracked-files=all`, and unresolved-marker scan in `specs/013-cypher-query-access/tasks.md`.

---

## Dependencies and Execution Order

### Phase Dependencies

- **Phase 1**: No dependencies; must complete before any implementation.
- **Phase 2**: Depends on Phase 1; blocks all story work.
- **Phase 3 / US1 Slice 1**: Depends on Phase 2; delivers the first independently demonstrable vertical slice.
- **Phase 4 / US3 Slice 1 Closure**: Depends on Phase 3; verifies Slice 1 safety and cross-surface parity before Slice 2.
- **Phase 5 / US2 Slice 2**: Depends on Phase 4; delivers the second independently demonstrable vertical slice.
- **Phase 6 / US3 Final Closure**: Depends on Phase 5; completes safety, retrieval, and regression-surface gates.
- **Phase 7**: Depends on all selected story work; produces delivery evidence and final validation.

### Story Dependencies

- **US1 (P1)**: Starts after foundational harness; no dependency on US2.
- **US2 (P2)**: Starts after Slice 1 cross-surface closure because it extends the accepted Slice 1 public surfaces.
- **US3 (P3)**: Runs in two closure phases because safe public-surface behavior is required for both independently demonstrable slices.

### RED -> GREEN -> REFACTOR -> VERIFY Rules

- RED tasks in each story phase must be complete and observed failing before GREEN implementation tasks in that phase begin.
- GREEN tasks must use only the production paths declared in `specs/013-cypher-query-access/plan.md` unless the G5/reviewability gate records a split or stop decision first.
- REFACTOR tasks run only after focused green tests for that phase.
- VERIFY tasks must record commands, observed states, hashes, artifacts, reviewer, and date in `specs/013-cypher-query-access/evidence-matrix.md`.

### Parallel Opportunities

- T008, T009, T010, and T011 can run in parallel.
- T013, T014, T015, and T016 can run in parallel.
- T033 and T034 can run in parallel after T032 test contracts are agreed.
- T041, T042, T044, T045, and T046 can run in parallel; T043 also touches `__tests__/cypher-parser.test.ts` and must be coordinated with T041.
- T058, T059, T060, and T061 can run in parallel.
- T071 and T072 can run in parallel after story implementation is complete.

---

## Implementation Strategy

### Slice 1 First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 RED tests and confirm failure.
3. Complete Phase 3 GREEN implementation.
4. Complete Phase 3 REFACTOR and VERIFY.
5. Complete Phase 4 safety closure and record Slice 1 evidence.

### Slice 2 Second

1. Complete Phase 5 RED tests and confirm failure.
2. Complete Phase 5 GREEN implementation.
3. Complete Phase 5 REFACTOR and VERIFY.
4. Complete Phase 6 final safe-operation closure.
5. Complete Phase 7 delivery evidence.

### Stack Strategy

- Default route: one PR from `013-cypher-query-access` with two internal verification slices.
- Split route only if selected by G5: bottom branch `013-cypher-query-access-slice1`, top branch `013-cypher-query-access-slice2`, submitted with `gh stack submit --auto --remote origin`, verified with `gh stack view --json`.

---

## Requirement Traceability

### Functional Requirements

| Requirement | Tasks |
|---|---|
| FR-001 | T013, T015, T016, T027, T028, T044, T052 |
| FR-002 | T013, T015, T016, T018, T027, T028, T032, T036, T059, T063 |
| FR-003 | T013, T014, T019 |
| FR-004 | T013, T019, T020 |
| FR-005 | T014, T021 |
| FR-006 | T013, T018, T020 |
| FR-007 | T013, T018, T021 |
| FR-008 | T013, T018, T021 |
| FR-009 | T014, T021 |
| FR-010 | T014, T020 |
| FR-011 | T014, T022, T042, T049 |
| FR-012 | T042, T045, T049 |
| FR-013 | T014, T020, T022 |
| FR-014 | T013, T019, T043, T050 |
| FR-015 | T043, T045, T050 |
| FR-016 | T013, T018 |
| FR-017 | T014, T023, T041, T048 |
| FR-018 | T041, T042, T048 |
| FR-019 | T014, T023, T041, T042, T048, T051 |
| FR-020 | T014, T023, T025, T032, T035, T042, T051, T059, T061 |
| FR-021 | T014, T024, T058 |
| FR-022 | T014, T015, T016, T024, T027, T028, T032, T036, T059, T063 |
| FR-023 | T013, T032, T033, T036, T059, T063 |
| FR-024 | T013, T014, T018, T020, T021, T024, T033, T036, T058, T062 |
| FR-025 | T015, T027, T044, T052, T063 |
| FR-026 | T015, T016, T025, T032, T035, T045, T051, T059, T076 |
| FR-027 | T015, T025, T027, T044, T052 |
| FR-028 | T016, T028, T032, T034, T035, T037, T045, T053, T059, T064, T065 |
| FR-029 | T046, T054, T061, T073, T075 |
| FR-030 | T034, T037, T060, T065, T068, T069 |
| FR-031 | T014, T026 |
| FR-032 | T031, T040, T057, T070, T075 |

### Success Criteria

| Success Criterion | Tasks |
|---|---|
| SC-001 | T013, T015, T016, T032, T059, T074 |
| SC-002 | T014, T016, T031 |
| SC-003 | T041, T042, T043, T045, T057 |
| SC-004 | T046, T054, T073, T075 |
| SC-005 | T013, T014, T033, T036, T058, T062, T070 |
| SC-006 | T015, T016, T025, T032, T035, T045, T059, T076 |
| SC-007 | T014, T023, T032, T042 |
| SC-008 | T014, T016, T024, T032, T058, T066 |
| SC-009 | T034, T037, T060, T065, T068, T069 |
| SC-010 | T014, T021, T042, T061, T073 |

### Checklist Coverage

| Checklist | Coverage Tasks |
|---|---|
| `specs/013-cypher-query-access/checklists/requirements.md` | T001-T007, T013-T017, T031, T057, T073-T079 |
| `specs/013-cypher-query-access/checklists/performance.md` | T014, T021, T023, T024, T025, T042, T051, T061, T073, T075 |
| `specs/013-cypher-query-access/checklists/error-handling.md` | T013, T014, T020, T022, T024, T032, T033, T036, T058, T059, T062-T064 |
| `specs/013-cypher-query-access/checklists/security.md` | T013, T018, T020, T021, T024, T027, T028, T033, T036, T058, T062, T063, T068, T069 |
| `specs/013-cypher-query-access/checklists/api-contracts.md` | T013-T016, T018-T028, T032-T037, T041-T053, T058-T065, T076 |
