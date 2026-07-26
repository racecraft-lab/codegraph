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

- [X] T009 [US1] RED -> GREEN -> REFACTOR the minimal TypeScript/JavaScript vertical path through IR, CFG builder, SQLite write, and `CodeGraph.getCfg` in `src/analysis/cfg/index.ts`, `src/index.ts`, and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused minimal available CFG test plus full gate `npm test` (FR-001, FR-003, FR-011, FR-012, FR-014; Q2,Q7,Q10,Q11,Q19,Q27)
  - TDD evidence: a real enabled TypeScript project first failed because `CodeGraph.getCfg` did not exist, then exposed an incorrect explicit-return edge before GREEN. The conservative tree-sitter linear-function path now persists entry/body/exit blocks and `fallthrough`/`return` edges atomically; 16 focused CFG contract/lifecycle/TypeScript tests and the Node 24 build passed.
- [X] T010 [US1] RED -> GREEN -> REFACTOR deterministic block IDs, graph IDs, block ordering, edge ordering, and byte-equivalent repeated re-index responses in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused three-run determinism test plus full gate `npm test` (FR-014, FR-027, FR-031; Q10,Q11,Q21)
  - Probe evidence: the new three-run unchanged re-index characterization passed immediately because T009 already derived IDs from stable source identity and persisted explicit ordinals. All three runs produced identical function/graph/block IDs, block/edge ordering, and byte-equivalent serialized `getCfg` results; 17 focused CFG tests and the Node 24 build passed.
- [X] T011 [US1] RED -> GREEN -> REFACTOR unsupported language, unsupported construct, parser-unavailable, parse-error, and parse-unsafe whole-function skip states in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused zero block/edge payload assertions plus full gate `npm test` (FR-013, FR-016; Q1,Q7,Q12)
  - TDD evidence: three focused assertions failed before out-of-scope Go functions, parser unavailability, and parse-unsafe target regions had distinct outcomes. Five durable skip cases now persist the exact stable reason, no blocks or edges, and no payload; parse errors outside a safe target remain distinct from unsafe target subtrees. The focused CFG suites passed 22/22 and the Node 24 build passed.
- [X] T012 [US1] RED -> GREEN -> REFACTOR the 10,000-block resource cap and `resource_limited`/`block_limit_exceeded` outcome in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused generated-over-limit fixture test plus full gate `npm test` (FR-017; Q15,Q23)
  - TDD evidence: a generated 5,001-branch function first returned generic `unsupported_construct`. An iterative control-flow-demand check now applies the exact 10,000-block cap before generic skip classification or payload writes, returns `resource_limited`/`block_limit_exceeded`, and persists zero blocks/edges. The focused CFG suites passed 23/23 and the Node 24 build passed.
- [X] T013 [US1] RED -> GREEN -> REFACTOR explicit `throw` and `try`/`finally` routing, including abrupt-transfer supersession inside `finally`, in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused edge-kind/order fixture tests plus full gate `npm test` (FR-018, FR-027; Q4,Q21)
  - TDD evidence: the committed throw/finally and two abrupt-supersession cases first returned `unsupported_construct`; seven review regressions then exposed shared-finally cross-products, missing empty-finally paths, emission-order edges, post-clone cap overflow, and deferred-expression flattening. The structured builder now clones lexical finally paths per pending continuation, honors overriding return/throw, emits only explicit throw edges, sorts edges by the frozen contract, rechecks the cap before persistence, and skips expression branching reserved for T014. The focused CFG suites passed 30/30 and the Node 24 build passed.
- [X] T014 [US1] RED -> GREEN -> REFACTOR TypeScript/JavaScript logical short-circuit, conditional expressions, optional chaining, and nullish coalescing in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused branch fixture tests plus full gate `npm test` (FR-019, FR-023; Q5,Q26)
  - TDD evidence: the three committed expression fixtures and a ternary probe first returned `unsupported_construct`; three review regressions then exposed flattened nested wrappers, optional calls/callees, and optional subscripts. The AST expression builder now gates `&&`, `||`, `??`, ternary arms, optional members/calls/subscripts, and branchy arguments/initializers/returns in evaluation order, while ordinary arithmetic/comparisons remain non-branching and unhandled branch wrappers fail closed. The focused CFG suites passed 35/35 and the Node 24 build passed.
- [X] T015 [US1] RED -> GREEN -> REFACTOR TypeScript/JavaScript `switch`, `default`, fallthrough, `break`, `continue`, and labeled-target safety in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused switch/loop fixture tests plus full gate `npm test` (FR-020, FR-027; Q6,Q21)
  - TDD evidence: seven committed switch/loop cases first returned `unsupported_construct`; subsequent parent-review RED regressions exposed missing no-default dispatch, branchy conditions, labeled-block breaks, synthetic exits from `for (;;)` loops, chained labels, and opaque branchy `for` updates. Structured lowering now preserves case/default dispatch, fallthrough, exact break/continue targets through finally and updates, loop re-entry, chained loop labels, and T014 expression flow on each condition/update evaluation. The focused CFG/contract/lifecycle suites passed 50/50 and the Node 24 build passed.
- [X] T016 [US1] RED -> GREEN -> REFACTOR nested function boundaries, local function identity handling, disconnected unreachable blocks, and no-op entry/exit graphs in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-typescript.test.ts`; evidence: focused nested/unreachable/no-op fixture tests plus full gate `npm test` (FR-014, FR-025, FR-026; Q10,Q11,Q18,Q28)
  - TDD evidence: six boundary regressions first exposed unsupported nested declarations, ambiguous same-name lookup, missing arrow/function-expression identity, dropped unreachable source, nonminimal no-op graphs, and nested-body cap leakage. Exact indexed spans now outrank name fallback; nested control bodies remain independently addressable boundaries; unreachable regions persist as disconnected blocks; empty and `return undefined` functions contain only entry and exit; and nested functions consume their own resource budget. The complete CFG directory passed 57/57, the Node 24 build passed, and the authoritative full suite passed 258 files with 4594 tests passed and 178 skipped.

**Checkpoint**: User Story 1 is independently complete when TypeScript/JavaScript library reads satisfy available, skip, resource, determinism, and no-partial graph assertions.

---

## Phase 4: Slice 1 / User Story 2 - Keep Persisted CFG State Correct Through Lifecycle Transitions (Priority: P1)

**Goal**: Persisted CFG state follows first enable, sync, deletion, disablement, unexpected failure, cancellation, and re-enable without serving stale rows as fresh.

**Independent Test**: Drive lifecycle transitions against real project files and real SQLite, then assert status rows, block/edge availability, source versions, and read states before and after each transition.

- [X] T017 [US2] RED -> GREEN -> REFACTOR first-enable full backfill when the ordinary incremental change set is empty in `src/index.ts`, `src/analysis/cfg/index.ts`, and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused empty-change backfill test plus full gate `npm test` (FR-003; Q19)
  - Characterization evidence: a real temp project was indexed while CFG analysis was disabled, leaving all CFG tables empty; after enabling CFG with no source changes, an ordinary zero-change `sync()` backfilled both current TypeScript functions with current status plus block/edge payload. The regression passed immediately because T009 already invokes CFG analysis after every successful sync. The complete CFG directory passed 58/58 and the Node 24 build passed; no production change was needed.
- [X] T018 [US2] RED -> GREEN -> REFACTOR affected-file transactional replacement after computing every current function status for that file in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused changed-file swap/unaffected-file retention test plus full gate `npm test` (FR-004, FR-015; Q3,Q12)
  - TDD evidence: the changed-file lifecycle regression first showed the unaffected file's `updated_at` advancing from 1000 to 2000, and a review regression showed a later zero-change sync advancing the backfilled snapshot to 3000. Sync now scopes ordinary refresh to the changed paths, performs a full pass only when functions exist but no CFG status has ever been written, precomputes all function outcomes before writing, and atomically swaps each affected file. The changed file replaced all three prior rows with its two current outcomes while the unaffected snapshot stayed byte-identical. The complete CFG directory passed 59/59 and the Node 24 build passed.
- [X] T019 [US2] RED -> GREEN -> REFACTOR source-file deletion, function deletion, compact `deleted` tombstones, and never-seen `unknown_function` reads in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused delete/unknown no-payload assertions plus full gate `npm test` (FR-005, FR-010, FR-013; Q3,Q7,Q9)
  - TDD evidence: the real-SQLite deletion regression first lost the removed function's status row entirely. Scoped refresh now compares prior by-value identities with current outcomes, adds compact `deleted` / `function_deleted` tombstones for missing function IDs, and discovers deleted file scopes from CFG paths absent from indexed files. Function and whole-file deletions retain identity with null source versions and zero blocks/edges; unaffected rows remain byte-identical; never-seen reads return `unknown_function` / `function_unknown` without payload. The complete CFG directory passed 60/60 and the Node 24 build passed.
- [X] T020 [US2] RED -> GREEN -> REFACTOR disabled reads, disabled sync zero CFG writes, retained inert rows, and re-enable refresh-before-current behavior in `src/project-config.ts`, `src/index.ts`, `src/analysis/cfg/index.ts`, and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused disable/re-enable lifecycle test plus full gate `npm test` (FR-001, FR-002, FR-006, FR-007; Q2,Q19,Q20)
  - TDD evidence: after an enabled index and a disabled sync retained rows stayed byte-identical, but the first re-enabled read incorrectly returned `available`. A durable revision derived from config content and stat identity now records the last successful CFG refresh. Disabled reads return `disabled` / `analysis_disabled` with no payload and disabled sync leaves all CFG tables untouched; a re-enabled read with a mismatched revision returns `not_computed` / `cfg_not_computed` without payload; zero-change sync then full-refreshes and advances the revision before current reads resume. The complete CFG directory passed 61/61 and the Node 24 build passed.
- [X] T021 [US2] RED -> GREEN -> REFACTOR unexpected first-refresh failure and later-refresh stale retention in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused `first_refresh_failed` and `refresh_failed_retained_stale` tests plus full gate `npm test` (FR-008, FR-009, FR-013; Q7,Q13)
  - TDD evidence: injected per-function failures first left a never-computed function as `not_computed`, and parent review then exposed re-enable full backfill dropping a function deleted while disabled. Unexpected computation is now contained per function: first failure persists payload-free `unavailable` / `first_refresh_failed`; later failure preserves the prior status/blocks/edges byte-identically and uses a durable metadata marker to project `stale` / `refresh_failed_retained_stale`; recovery clears the marker. Generic bounded messages expose neither source nor exception text, other functions still refresh, and full backfill tombstones prior identities missing from current nodes inside the same transaction. The complete CFG directory passed 63/63 and the Node 24 build passed.
- [X] T022 [US2] RED -> GREEN -> REFACTOR caller cancellation with no marker before swap, stale prior snapshot when applicable, and committed-result-stands after atomic swap in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused cancellation probe plus full gate `npm test` (FR-009; Q13)
  - TDD evidence: deterministic cancellation probes showed pre-swap behavior already preserved no rows/markers for first refresh and a byte-identical prior snapshot projected as `stale` / `source_version_mismatch` for later refresh. The post-swap probe failed because committed CFG rows existed but the config revision was suppressed by the signal's final state, making reads `not_computed`. `runCfgAnalysis` now returns whether any atomic swap committed, and orchestration advances the durable config revision from that commit result. A committed full refresh remains current even when cancellation flips immediately after commit. The complete CFG directory passed 66/66 and the Node 24 build passed.
- [X] T023 [US2] RED -> GREEN -> REFACTOR source-version and contract-version freshness so unrelated project writes do not make unchanged functions stale in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-lifecycle.test.ts`; evidence: focused unchanged-function freshness test plus full gate `npm test` (FR-015; Q12)
  - Characterization evidence: the real-SQLite integration probe passed on first execution. Advancing general `graph_write_version` metadata and syncing a source change in another file left the unchanged function's status, blocks, edges, and source version byte-identical and `available`. Directly mismatching the stored block contract version projected the retained complete payload as `stale` / `source_version_mismatch` without a read-side write or recomputation. The complete CFG directory passed 67/67, the Node 24 build passed, and the authoritative full suite passed 258 files with 4604 tests passed and 178 skipped while the live dogfood index remained intact.

**Checkpoint**: User Story 2 is independently complete when lifecycle tests pass against real SQLite and disabled paths remain dormant.

---

## Phase 5: Slice 1 / User Story 3 - Query the Same Stateful Contract Through CLI, MCP, and Project Status (Priority: P2)

**Goal**: Library, CLI JSON, CLI human output, MCP, and status expose the same stateful CFG contract with deterministic paging and aggregate project health.

**Independent Test**: Query the same function IDs through all read surfaces, compare machine responses field-for-field, reconstruct MCP pages, and verify project status counts.

- [X] T024 [US3] RED -> GREEN -> REFACTOR `codegraph cfg <function-id> --json` parity with `CodeGraph.getCfg` in `src/bin/codegraph.ts`, `src/index.ts`, and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused CLI JSON field-for-field test plus full gate `npm test` (FR-010, FR-011, FR-012, FR-028; Q7,Q8,Q9,Q27)
  - TDD evidence: before the command existed, the built real-project CLI probe exited `1`. `codegraph cfg <function-id> -p <path> --json --limit --offset` is now a thin wrapper over `CodeGraph.getCfg`; the test creates and indexes a real temporary TypeScript project, derives the function ID from SQLite, and deep-compares paged `available` and payload-free `unknown_function` JSON field-for-field with the library result. Expected typed results exit `0` with JSON-only stdout. The focused contract suite passed 11/11, the complete CFG directory passed 68/68, and the Node 24 build passed.
- [X] T025 [US3] RED -> GREEN -> REFACTOR bounded CLI human output and exit-code behavior for every expected CFG state in `src/bin/codegraph.ts` and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused human output/exit matrix plus full gate `npm test` (FR-013, FR-028; Q7,Q8,Q27)
  - TDD evidence: the new behavioral tests first showed default output still parsing as JSON, the expected-state matrix receiving JSON rather than a human summary, and invalid `--limit nope` exiting `0`. Default output now exposes bounded state, reason, identity, freshness, count, and page metadata without CFG arrays; `--json` alone emits the machine object. Real CLI probes cover every state currently constructible through public project/config/SQLite setup, the closed state table locks all ten zero-exit states including `not_indexed`, and invalid paging, missing function ID, and invalid project paths exit nonzero. The focused contract suite passed 15/15, the complete CFG directory passed 72/72, and the Node 24 build passed.
- [X] T026 [US3] RED -> GREEN -> REFACTOR the `codegraph_get_cfg` MCP tool schema and success-shaped expected-state responses in `src/mcp/tools.ts` and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused MCP schema/state test plus full gate `npm test` (FR-011, FR-012, FR-013, FR-029; Q7,Q8,Q16,Q27)
  - TDD evidence: three red probes first found no static tool definition and received unknown-tool errors for available and expected-state reads. The statically exposed read-only `codegraph_get_cfg` tool now requires `projectPath` and `functionId`, accepts optional integer `limit`/`offset`, delegates indexed reads to `CodeGraph.getCfg`, and returns the exact `CfgReadResult` JSON text. Expected unindexed and representative absence/skip/stale states remain success-shaped without `isError`; malformed inputs and real failures keep normal MCP error behavior. The focused contract suite passed 18/18, relevant MCP definition/allowlist/project-path suites passed 17/17, the complete CFG directory passed 75/75, and the Node 24 build passed.
- [X] T027 [US3] RED -> GREEN -> REFACTOR MCP pagination defaults, clamps, independent block/edge windows, totals, and no-overlap/no-gap reconstruction in `src/mcp/tools.ts`, `src/analysis/cfg/index.ts`, and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused multi-page reconstruction test plus full gate `npm test` (FR-029; Q8,Q16)
  - TDD evidence: real SQLite/ToolHandler probes lock default `100/0`, integer clamps, independent block and edge windows with different totals, exact returned/hasMore/nextOffset metadata, and complete ordered reconstruction without duplicates or gaps. Parent review caught and rejected a temporary handler weakening that accepted fractional values despite the integer MCP schema; the remediated test first failed when `2.8` was accepted, then restored integer-only validation while preserving shared integer normalization and paging. The focused contract suite passed 20/20, relevant MCP suites passed 34/34, the complete CFG directory passed 77/77, and the Node 24 build passed.
- [X] T028 [US3] RED -> GREEN -> REFACTOR aggregate top-level `cfg` status in human and JSON `codegraph status` in `src/index.ts`, `src/bin/codegraph.ts`, and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused mixed-state count/precedence test plus full gate `npm test` (FR-030; Q24)
  - TDD evidence: the status matrix covers disabled, unindexed, not-computed, first-refresh unavailable, retained stale, source-mismatch stale, empty, and available states plus mixed skip counts. A resumed parent-review regression first exposed the wrong precedence when a first-refresh failure coexisted with retained stale rows: aggregate status returned `stale` instead of `unavailable` despite having no current available CFG. The resolver now follows the frozen precedence exactly and exports one read-only `CfgProjectStatus`; initialized/uninitialized JSON and bounded human `codegraph status` render the same values without per-function diagnostics. The focused contract suite passed 25/25, relevant status suites passed 48/48, the complete CFG directory passed 82/82, and the Node 24 build passed.
- [X] T029 [US3] RED -> GREEN -> REFACTOR cross-surface expected-state parity for disabled, not-indexed, not-computed, unknown, unsupported, resource-limited, unavailable, stale, deleted, and available results in `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused parity matrix plus full gate `npm test` (FR-011, FR-013, FR-028, FR-029; Q7,Q8,Q27)
  - TDD evidence: one real-project table-driven matrix exercises all ten frozen states through exact library, built CLI JSON/human, and MCP result assertions, including payload/nullability, reason, source version, stale flag, bounded message, zero CLI exit, and success-shaped MCP behavior. The red probe failed because a valid CFG-enabled but unindexed workspace returned CLI exit `1` instead of typed `not_indexed`. A shared constructor now gives CLI and MCP the same result for that valid boundary, while an empty invalid workspace remains a normal nonzero/error. The focused contract suite passed 26/26, selected CLI/MCP/status suites passed 83/83, the complete CFG directory passed 83/83, and the Node 24 build passed. A mistakenly started out-of-scope full run was stopped after sandbox-only GPG/socket/daemon failures and is not completion evidence.
- [X] T030 [US3] RED -> GREEN -> REFACTOR concise MCP server guidance for bounded CFG reads in `src/mcp/server-instructions.ts` with no instruction to use Read/Grep for expected states; evidence: focused instruction snapshot/retrieval-shape check plus full gate `npm test` (FR-029; Q16)
  - TDD evidence: the scout found `codegraph_get_cfg` defined but hidden from the default surface while the instruction source forbids naming hidden tools. Eight initial instruction/default-surface assertions and one tiny-project assertion failed. The tool is now the fourth default/tiny-project surface while `codegraph_explore` remains primary; both indexed and no-root instruction variants concisely pin function/project inputs, bounded independent paging, all ten success-shaped states, and payload rules without mentioning Read or Grep. Focused instruction tests passed 12/12, default allowlist/rename tests 22/22, combined instruction/explore/CFG tests 42/42, unindexed/annotation tests 12/12, the complete CFG directory 83/83, and the Node 24 build passed. Retrieval quality remains explicitly open for T041 retrieval-guardian and deterministic A/B validation.
- [X] T031 [US3] RED -> GREEN -> REFACTOR self-repo TypeScript/JavaScript UAT probe covering library, CLI JSON, MCP pagination, and status counts in `specs/014-control-flow-graphs/quickstart.md` and `__tests__/analysis/cfg/cfg-contract.test.ts`; evidence: focused self-repo UAT transcript plus full gate `npm run build` and `npm test` (FR-034, FR-011, FR-029, FR-030; Q8,Q16,Q24,Q27)
  - TDD evidence: the old runbook command failed with `unknown option '--analysis'`. The replacement opt-in UAT mirrors 671 current tracked TS/JS files into a temporary CFG-enabled project, leaves the live worktree/config/index untouched, dynamically selects an available self-repo function, and proves exact library/built-CLI JSON parity, MCP page reconstruction, and library/built-CLI status parity. The emitted target had 6 blocks and 6 edges; aggregate status reported 3,160 available, 1,599 unsupported, 0 resource-limited, and 0 stale. The Node 24 build passed, the env-gated UAT passed 1/1 with 26 ordinary cases skipped, the ordinary contract passed 26/26 with the UAT skipped, and the complete CFG directory passed 83/83 with one UAT skip.

**Checkpoint**: Slice 1 is independently complete when TypeScript/JavaScript traverses IR -> CFG -> SQLite -> library -> CLI JSON/human -> MCP pages -> status and the focused/full gates pass.

---

## Phase 6: Slice 2 / User Story 4 - Obtain Python Semantic Parity After the TypeScript/JavaScript Slice (Priority: P3)

**Goal**: Python functions use the same state, persistence, paging, and read contracts after the TypeScript/JavaScript vertical path is complete.

**Independent Test**: Query committed Python fixtures through the same library, CLI JSON, MCP, determinism, status, and pagination tests as TypeScript/JavaScript, adding Python-specific construct coverage.

- [X] T032 [US4] RED -> GREEN -> REFACTOR deterministic Python lambda identity before lambda CFG reads in `src/extraction/languages/python.ts` and `__tests__/analysis/cfg/cfg-python.test.ts`; evidence: focused lambda function-ID test plus full gate `npm test` (FR-025; Q28)
  - TDD evidence: three real-file/real-SQLite tests first failed because the committed nested lambda, a top-level assigned lambda, and two lambdas on one line had no separate function rows. Python extraction now recognizes every `lambda`, names it `<lambda@LINE:COLUMN>` with one-based line and zero-based column, and explicitly visits top-level assignment initializers that the generic Python variable path does not descend into. Repeated indexing preserves IDs; same-line lambdas remain distinct; named functions/methods and call attribution remain intact. The extraction contract version advanced from 24 to 25. The focused Python CFG file passed 4/4, Python extraction regressions passed 19/19, and the Node 24 build passed.
- [X] T033 [US4] RED -> GREEN -> REFACTOR Python ordinary branches, loops, explicit `raise`, nested functions/classes, and unreachable blocks through the shared builder in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-python.test.ts`; evidence: focused Python baseline fixture tests plus full gate `npm test` (FR-018, FR-025, FR-026, FR-027; Q4,Q18,Q21,Q28)
  - TDD evidence: four real-file/real-SQLite tests first returned `unsupported/unsupported_language` for every Python function. The shared builder now admits exact-span Python functions and lambdas, treats Python `block` as a statement sequence, lowers for-in loops with deterministic break/continue/loop-back routing, maps `raise` to `throw`, keeps nested functions/lambdas/classes opaque but separately addressable, retains disconnected unreachable blocks, and routes normal/return/raise transfers through a minimal lexical `finally`. Loop `else`, `except`, try `else`, and unsafe shapes fail the whole function closed. Parent review preserved existing TypeScript unreachable behavior and added a nested named-function probe. Focused T033 passed 4/4, Python CFG 8/8, TypeScript CFG 42/42, the complete CFG directory 90/90 with one opt-in skip, and the Node 24 build passed.
- [X] T034 [US4] RED -> GREEN -> REFACTOR Python `match`/`case` source-order predicates and guarded cases through the multi-way branch contract in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-python.test.ts`; evidence: focused match/case fixture tests plus full gate `npm test` (FR-021; Q6)
  - TDD evidence: two committed/inline match probes first failed as `unsupported_construct`, then a parent-review regression failed for guarded wildcard fallthrough. Match subjects now dispatch once into source-ordered pattern predicates; guards run only after a match, Python `and`/`or` short-circuit their RHS, guard false advances to the next predicate, case bodies do not fall through, unguarded wildcard is terminal default, and guarded wildcard may advance when false. Python conditional-expression field order is language-correct. Focused T034 passed 3/3, Python CFG 11/11, TypeScript CFG 42/42, the complete CFG directory 93/93 with one opt-in skip, and the Node 24 build passed.
- [X] T035 [US4] RED -> GREEN -> REFACTOR Python list, set, dict comprehensions and generator expressions as loops, filters, and evaluation order in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-python.test.ts`; evidence: focused comprehension/generator fixture tests plus full gate `npm test` (FR-022; Q25)
  - TDD evidence: three real CFG tests first showed comprehension assignments flattened into linear statements. The shared builder now lowers list/set/dict comprehensions and generator expressions through ordered `for_in_clause`/`if_clause` loops, re-evaluates nested iterables at the correct outer-loop point, routes filter false/body completion to the correct loop, preserves iterable→filter→body and dict key→value order, and models generators passed through Python calls. Conservative demand includes comprehension clauses and unsafe await/yield shapes fail closed. Focused T035 passed 3/3, Python CFG 14/14, TypeScript CFG 42/42, the complete CFG directory 96/96 with one opt-in skip, and the Node 24 build passed.
- [X] T036 [US4] RED -> GREEN -> REFACTOR Python `await`, `yield`, and `yield from` as ordinary intra-procedural operations without suspension/resumption edges in `src/analysis/cfg/index.ts` and `__tests__/analysis/cfg/cfg-python.test.ts`; evidence: focused async/generator ordinary-operation tests plus full gate `npm test` (FR-024; Q17)
  - TDD evidence: committed await/yield fixtures characterized immediate-green after one corrected expected loop-back; a third wrapper probe then failed because `await (cached or client.fetch())` was unsupported. Await/yield wrappers now transparently delegate only when their operand needs ordinary short-circuit/conditional lowering. Normal fixture statements retain their full source spans, no scheduler blocks or public edge kinds exist, and unsafe await/yield inside comprehensions stays fail-closed. Focused T036 passed 3/3, Python CFG 17/17, TypeScript CFG 42/42, the complete CFG directory 99/99 with one opt-in skip, and the Node 24 build passed.
- [X] T037 [US4] RED -> GREEN -> REFACTOR Python parity in library, CLI JSON, MCP paging, status, determinism, and skip contracts in `__tests__/analysis/cfg/cfg-contract.test.ts`, `__tests__/analysis/cfg/cfg-python.test.ts`, and `src/analysis/cfg/index.ts`; evidence: focused cross-language parity matrix plus full gate `npm test` (FR-011, FR-013, FR-029, FR-031, FR-033, FR-034; Q7,Q8,Q10,Q16,Q22,Q27)
  - TDD evidence: the first cross-language parity fixture exposed an unsupported TypeScript `for...of` test shape, so the contract probe was narrowed to the supported C-style loop before GREEN. The final real-SQLite matrix proves available TypeScript and Python CFGs, parser-unavailable and block-limit skip states, exact aggregate status, library/built-CLI/MCP deep equality, and independent limit-one block/edge reconstruction. Three complete re-indexes preserve byte-identical Python JSON, function/graph/source IDs, block IDs, and graph/index totals. Parent verification passed 2/2 focused T037 tests; the opt-in T038 harness also passed with 17 blocks, 21 edges, 21 MCP pages, and `available` status.
- [X] T038 [US4] RED -> GREEN -> REFACTOR Python parity UAT evidence and runbook updates in `specs/014-control-flow-graphs/quickstart.md`; evidence: focused Python UAT transcript plus full gate `npm run build` and `npm test` (FR-034; Constitution Dogfooding)
  - Verification evidence: the env-gated UAT passed before and after the documentation update. It builds the local CLI, creates a temporary mirror, enables CFG only there, resolves the Python fixture function dynamically from real SQLite, keeps embeddings and LSP disabled, proves library/CLI JSON/CLI human/MCP/status parity with independent MCP pages, emits a bounded 17-block/21-edge/21-page record, closes the database, removes the mirror, and never mutates the live index. The focused Python and contract suites passed 45 tests with 2 opt-in skips; both pre/post Node 24 builds passed.
  - Slice 2 gate evidence: Node 24.11.1 build and typecheck passed; the complete suite passed 258 files and 4,644 tests with 15 files and 180 tests skipped. A local-only embeddings/LSP-off dogfood reindex advanced the live index to extraction contract 25 with 898 files, 16,045 nodes, 68,457 edges, zero pending changes/references, and no reindex recommendation.

**Checkpoint**: Slice 2 is independently complete when Python satisfies the same machine contract and all Python-specific construct fixtures pass.

---

## Phase 7: Polish, Gates, and Review Packet

**Purpose**: Validate the full feature, preserve reviewability, and prepare review evidence without broadening scope.

- [X] T039 RED -> GREEN -> REFACTOR paired-median disabled/enabled CFG performance benchmark in `__tests__/analysis/cfg/cfg-performance.test.ts`; evidence: focused 2-warmup/10-measured-pair PR benchmark, CI smoke allowance, recorded environment metadata, and full gate `npm test` (FR-002, FR-032; Q2,Q14)
  - TDD evidence: the initial harness placeholder failed, the parse-count regression then proved three functions in one file caused three tree-sitter parses, and the pre-optimization authoritative benchmark failed at `1.4128`. CFG analysis now caches one parsed tree per source file for the bounded analysis run and disposes every tree in a `finally` block. The parser-cache probe passed with one parse. The executor's 2-warmup/10-pair GREEN ratio was `1.1618`; parent repetition passed at `1.1673` (57.03 ms disabled median, 66.58 ms enabled median), and the final isolated evidence rerun passed at `1.159`. Disabled wrote zero CFG rows; enabled wrote 36 statuses, 137 blocks, and 104 edges with available Python and TypeScript CFGs; non-CFG counts matched and network fetches were zero. To prevent concurrent full-suite load from invalidating timing evidence, the authoritative benchmark is explicit through `CODEGRAPH_CFG_PERF_EVIDENCE=1`, the non-authoritative invariant smoke is explicit through `CODEGRAPH_CFG_PERF_SMOKE=1`, and the deterministic parser-cache regression remains in the default suite. Node 24 build passed, the complete CFG directory passed 103 tests with 2 opt-in skips, and `git diff --check` passed.
- [X] T040 RED -> GREEN -> REFACTOR final full gates in `package.json` command surfaces by running `npm run build`, focused CFG suites, and `npm test`; evidence: focused suite outputs plus full build/test output captured for PR packet (FR-031, FR-033, FR-034; Q10,Q22)
  - TDD and gate evidence: a deterministic source-vs-dist schema assertion failed 1/6 while the shipped asset was stale, then `npm run build` restored exact byte parity and all 6 schema-shipping assertions passed with matching SHA-256 `ee029372fb2aaeb7c697ed3a4d317a7eee811fe5bfdba960f9bc9ccb563c53c3`. The complete CFG directory passed 103 tests with 2 explicit performance-mode skips, build and typecheck passed under Node 24.11.1, and the authoritative full suite passed 259 files and 4,646 tests with 15 files and 181 tests skipped. Full-suite concurrency exposed two integration-heavy CLI/contract assertions exceeding their default 5-second timeout; only those two cases now use an explicit 30-second timeout, and their focused contract file remains green. Source/dist schema structure is locked to the exact 3 CFG tables, 5 indexes, and 3 triggers. `git diff --check` passed.
- [X] T041 RED -> GREEN -> REFACTOR retrieval-guardian review for all `src/mcp/tools.ts` and `src/mcp/server-instructions.ts` changes; evidence: focused retrieval-guardian verdict plus full gate `npm test` (FR-029; Q16)
  - Final evidence: the first RED regression proved that a valid explicitly configured but unindexed project with CFG disabled returned CLI nonzero and MCP `isError: true` instead of the expected success-shaped `disabled` / `analysis_disabled` result. The guardian follow-up then exposed four more RED cases: the static schema required `projectPath` despite default-project guidance, omission could not use the default project, and two ordinary unindexed workspaces leaked error-shaped Read/Grep/Glob steering. A shared DB-free constructor now restores exact CLI/MCP parity; the static schema requires only `functionId`, no-default sessions dynamically require `projectPath`, and every expected unindexed state is success-shaped without raw steering text. The four-case RED/GREEN probe passed 4/4; the focused CFG/MCP suite passed 70 tests with 2 skips; the final authoritative suite passed 260 files and 4,652 tests with 15 files and 181 tests skipped. The explicit disabled/enabled invariant smoke held non-CFG counts at 52 nodes and 109 base edges while enabled mode alone wrote 36 CFG statuses, 137 blocks, and 104 CFG edges with zero network fetches. Live dogfooding isolated and fixed a sandbox-denied POSIX daemon lease (`EPERM`), watcher exhaustion (`EMFILE`), and bare `node` resolving to unsupported Node 26.5.0; a fresh Codex session invoked `codegraph_explore` successfully. The retrieval-guardian re-audit passes all seven applicable local checks with no advisory. Two authorized Sonnet/high A/B repetitions against baseline `bab20702` succeeded in every arm: new Read counts were 2 and 1 versus baseline 2 and 2, so worst-case Read usage did not regress; every arm used CodeGraph. Durable evidence is recorded in `.process/evidence/t041-retrieval-ab.json`.
- [X] T042 RED -> GREEN -> REFACTOR PR review packet with what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, rollback/feature-flag notes, and separated source/fixture/benchmark/generated evidence in `specs/014-control-flow-graphs/quickstart.md`; evidence: focused packet checklist plus full gate references `npm run build` and `npm test` (FR-033, FR-034; Q22)
  - TDD and UAT evidence: the first built Node 24 CLI probe failed because compiled parse workers loaded grammar WASM only in worker processes, leaving main-process CFG reparsing as `unsupported` / `parser_unavailable`. CFG-enabled index and first-enable zero-change sync now load only the CFG languages actually present before analysis while disabled projects remain dormant. The built-runtime regression passed TypeScript init plus TypeScript/Python zero-change backfill; the complete contract/performance files passed 31 tests with 3 explicit skips. Manual built-CLI UAT returned a 7-block/7-edge TypeScript CFG, preserved `1:7:7` rows through disabled sync, restored `available` after re-index, and returned the 17-block/21-edge Python CFG through library, CLI, MCP, and status. Node 24 build and typecheck passed, all 19 packet checks passed with zero forbidden strings, `git diff --check` passed, and the packet now records the completed T041 A/B evidence.
- [X] T043 RED -> GREEN -> REFACTOR final reviewability re-check against 780 reviewable LOC, 8 production surfaces, 18 total files, and two vertical slices in `specs/014-control-flow-graphs/tasks.md`; evidence: focused scope-budget note plus full gate `npm run build` and `npm test` (FR-033; Q22)
  - Final evidence (2026-07-25): live `origin/main` and the feature merge base both resolve to `474729007ebb6bf400857003790cc296a0238d75`; no GitHub PR exists for the feature head or a `SPEC-014` title, so no SPEC-014 work is merged and SPEC-015 remains blocked. The actual surface is 67 files including 10 production files and 4,457 lines of production churn, exceeding the 780/8/18/two-slice forecast. The final classification is a size-only block with no correctness exception: one aggregate PR is forbidden, `final-actual.json` records the current evidence, and the planned route uses 11 ordered markers with a verified commit checkpoint required for every marker before emission.

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
