# Tasks: LSP Client Integration

**Input**: Design documents from `specs/008-lsp-client-integration/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/`, `docs/ai/specs/.process/SPEC-008-design-concept.md`, and `docs/ai/specs/.process/language-feature-parity-baseline.md`

**Tests**: TDD-first is required for this feature. Each user-story phase starts with failing tests for the behavior it implements.

**Reviewability**: SPEC-008 remains one spec delivered as three vertical PR slices. Slice 1 covers activation/config/status/client/prereq plus TypeScript/JavaScript; Slice 2 covers correction/status generalization plus Python, Go, Rust, C/C++, Swift, and Java; Slice 3 covers remaining servers/dispositions, bounded watch verification, parity matrices, dogfood, and the final packet.

**Non-goals enforced by tasks**: No auto-install tasks, no CodeGraph-as-LSP-server facade tasks, and no rename/refactor tasks.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the SPEC-008 implementation and validation scaffolding without changing runtime behavior.

- [X] T001 Create LSP module scaffold exports in `src/lsp/index.ts` and `src/lsp/types.ts`
- [X] T002 [P] Create deterministic fake LSP fixture layout in `__tests__/fixtures/lsp/README.md`
- [X] T003 [P] Create SPEC-008 validation artifact directory and notes in `specs/008-lsp-client-integration/validation/README.md`
- [X] T004 [P] Create real-server validation script scaffold in `scripts/spec-008-validate-real-servers.mjs`
- [X] T005 Create three-slice review plan and file ownership map in `specs/008-lsp-client-integration/validation/slice-plan.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define shared types, registry contracts, config precedence, prereq detection, status records, and provenance support before any story implementation.

**Critical**: No user story work starts until this phase is complete.

- [X] T006 [P] Write failing registry completeness tests for every SPEC-008 language row and the COBOL SPEC-024 disposition in `__tests__/lsp-prereqs.test.ts`
- [X] T007 [P] Write failing activation/config precedence tests for CLI, project config, environment overrides, invalid values, and default-off behavior in `__tests__/lsp-config.test.ts`
- [X] T008 [P] Write failing status contract tests for stable LSP state, reason codes, coverage fields, and performance fields in `__tests__/lsp-status.test.ts`
- [X] T009 [P] Write failing provenance typing tests that preserve `null` and `heuristic` edges and allow only verified/corrected active edges to use `lsp` in `__tests__/lsp-precision-pass.test.ts`
- [X] T010 Implement LSP activation, config, registry, status, performance, reason-code, and correction metadata types in `src/lsp/types.ts`
- [X] T011 Implement the server registry for JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Ruby, Rust, PHP, Kotlin, Swift, Dart, Vue, and COBOL disposition in `src/lsp/servers.ts`
- [X] T012 Implement project and environment LSP config parsing with activation, env-only command selection, project/env timeout precedence, and committed-command warning behavior in `src/lsp/config.ts`
- [X] T013 Implement command probing, accepted-alternative selection, configured-command no-fallback behavior, and prereq report data in `src/lsp/prereqs.ts`
- [X] T014 Implement LSP status aggregation models for server availability, coverage, edge counts, skip reasons, degradation, and performance in `src/lsp/status.ts`
- [X] T015 Extend edge provenance typing and storage compatibility for additive `lsp` provenance in `src/types.ts` and `src/db/schema.sql`
- [X] T016 Export the LSP foundation modules from `src/lsp/index.ts`
- [X] T017 Wire `codegraph.json.lsp` loading into the project config path in `src/project-config.ts`
- [X] T018 Record the accepted reviewability warning, three-slice boundary, and implementation file budget in `specs/008-lsp-client-integration/validation/slice-plan.md`

**Checkpoint**: Foundation ready. User stories can start in slice order or in parallel where file ownership does not conflict.

---

## Phase 3: User Story 1 - Opt Into Compiler-Accurate Graph Precision (Priority: P1, Slice 1 MVP)

**Goal**: Users can explicitly enable LSP precision while default indexing remains unchanged.

**Independent Test**: Index the same fixture with and without LSP precision enabled and confirm the disabled run performs zero LSP runtime work while the enabled TypeScript/JavaScript run records LSP coverage and verified/corrected edges.

### Tests for User Story 1

- [X] T019 [P] [US1] Write failing disabled-path index, sync, and watch-triggered sync tests proving zero LSP command probes, subprocess starts, JSON-RPC messages, status writes, and graph mutations in `__tests__/lsp-disabled.test.ts`
- [X] T020 [P] [US1] Write failing CLI activation tests for `codegraph index`, `codegraph index --lsp`, and `codegraph index --no-lsp` precedence in `__tests__/lsp-config.test.ts`
- [X] T021 [P] [US1] Write failing JSON-RPC lifecycle tests for initialize, request id routing, timeout, shutdown, stderr/stdout draining, and malformed response handling in `__tests__/lsp-client.test.ts`
- [X] T022 [P] [US1] Write failing TypeScript/JavaScript precision-pass tests for one complete definition/reference verification path in `__tests__/lsp-precision-pass.test.ts`
- [X] T023 [P] [US1] Write failing status tests for CLI activation source, observed server evidence, per-language coverage, and edge counts in `__tests__/lsp-status.test.ts`
- [X] T024 [P] [US1] Write failing TypeScript/JavaScript real-server prereq validation tests for `typescript-language-server --stdio` and TypeScript SDK evidence in `__tests__/lsp-real-server-validation.test.ts`

### Implementation for User Story 1

- [X] T025 [US1] Add `--lsp` and `--no-lsp` index activation options without changing default behavior in `src/bin/codegraph.ts`
- [X] T026 [US1] Pass effective LSP activation from CLI and project config into index and sync entry points in `src/index.ts`
- [X] T027 [US1] Implement the JSON-RPC stdio client lifecycle in `src/lsp/client.ts`
- [X] T028 [US1] Implement bounded request timeout, shutdown, process exit, stdout draining, and stderr draining behavior in `src/lsp/client.ts`
- [X] T029 [US1] Implement TypeScript/JavaScript work-item selection after structural extraction and reference resolution in `src/lsp/precision-pass.ts`
- [X] T030 [US1] Implement verified-edge marking for matching TypeScript/JavaScript LSP targets in `src/lsp/precision-pass.ts`
- [X] T031 [US1] Persist slice-1 coverage, edge-count, and performance status for LSP-enabled runs in `src/lsp/status.ts`
- [X] T032 [US1] Integrate the LSP precision pass after existing reference resolution while preserving disabled-path behavior in `src/index.ts`
- [X] T033 [US1] Render LSP state in human and JSON status output without starting language servers from status in `src/bin/codegraph.ts`
- [X] T034 [US1] Implement TypeScript/JavaScript real-server validation in `scripts/spec-008-validate-real-servers.mjs`
- [X] T035 [US1] Run `npm test -- __tests__/lsp-disabled.test.ts __tests__/lsp-client.test.ts __tests__/lsp-precision-pass.test.ts` and record output in `specs/008-lsp-client-integration/validation/slice-1.md`
- [X] T036 [US1] Run TypeScript/JavaScript real-server validation and record observed command, resolved path, version, SDK evidence, and coverage in `specs/008-lsp-client-integration/validation/slice-1.md`
- [X] T037 [US1] Record slice-1 traceability, scope budget, non-goals, rollback note, and known gaps in `specs/008-lsp-client-integration/validation/slice-1.md`

**Checkpoint**: Slice 1 MVP proves explicit opt-in, default-off unchanged behavior, JSON-RPC lifecycle, status output, and one complete TypeScript/JavaScript path.

---

## Phase 4: User Story 2 - Configure Local Language-Server Behavior (Priority: P2, Slice 1)

**Goal**: Users can configure repeatable project LSP activation/timeouts and machine-local language-server command overrides without CodeGraph installing anything or activating LSP implicitly.

**Independent Test**: Provide project config and machine-local environment overrides, then verify indexing and status use selected environment commands plus project or environment timeout values while environment variables alone do not enable LSP.

### Tests for User Story 2

- [X] T038 [P] [US2] Write failing project config tests for `lsp.enabled`, `lsp.defaultTimeoutMs`, `lsp.watch.enabled`, ignored committed command values, and `lsp.servers.<language>.timeoutMs` values in `__tests__/lsp-config.test.ts`
- [X] T039 [P] [US2] Write failing environment override tests for `CODEGRAPH_LSP_<LANG>_COMMAND_JSON`, `CODEGRAPH_LSP_<LANG>_TIMEOUT_MS`, and `CODEGRAPH_LSP_TIMEOUT_MS` in `__tests__/lsp-config.test.ts`
- [X] T040 [P] [US2] Write failing invalid override tests proving malformed JSON, non-string argv elements, and invalid timeouts warn and fall back in `__tests__/lsp-config.test.ts`
- [X] T041 [P] [US2] Write failing command probing tests for PATH lookup, absolute argv, relative argv, selected argv reporting, and expected alternatives in `__tests__/lsp-prereqs.test.ts`
- [X] T042 [P] [US2] Write failing configured-command unavailable tests proving valid configured argv does not fall through to registry alternatives in `__tests__/lsp-prereqs.test.ts`

### Implementation for User Story 2

- [X] T043 [US2] Implement command argv parsing and validation for environment values plus warning/ignore behavior for committed project command values in `src/lsp/config.ts`
- [X] T044 [US2] Implement timeout precedence and validation for project and environment values in `src/lsp/config.ts`
- [X] T045 [US2] Implement warning collection for ignored unknown languages, invalid commands, and invalid timeout values in `src/lsp/config.ts`
- [X] T046 [US2] Implement PATH, absolute path, and relative path command resolution with configured-command no-fallback semantics in `src/lsp/prereqs.ts`
- [X] T047 [US2] Apply environment command and timeout overrides during index runtime without allowing environment-only activation in `src/bin/codegraph.ts`
- [X] T048 [US2] Include selected argv, resolved executable path, expected alternatives, timeout source, and warnings in status data in `src/lsp/status.ts`
- [X] T049 [US2] Run `npm test -- __tests__/lsp-config.test.ts __tests__/lsp-prereqs.test.ts` and record output in `specs/008-lsp-client-integration/validation/slice-1.md`

**Checkpoint**: User Story 2 can be validated independently through config precedence and status evidence.

---

## Phase 5: User Story 3 - Understand LSP Availability and Graceful Degradation (Priority: P2, Slice 1 and Slice 2)

**Goal**: Users can see which languages were verified, unavailable, skipped, degraded, or not present, and normal indexing succeeds when one language server is missing or unstable.

**Independent Test**: Enable LSP precision in a mixed-language fixture while one configured server is missing or fails, then confirm structural indexing succeeds and status reports the affected language with stable reason codes.

### Tests for User Story 3

- [X] T050 [P] [US3] Write failing missing-server degradation tests for normal runtime in `__tests__/lsp-prereqs.test.ts`
- [X] T051 [P] [US3] Write failing crash, initialize timeout, request timeout, malformed response, and shutdown failure tests in `__tests__/lsp-client.test.ts`
- [X] T052 [P] [US3] Write failing one-restart-per-language-per-run tests for bounded recovery in `__tests__/lsp-precision-pass.test.ts`
- [X] T053 [P] [US3] Write failing status tests for unavailable, skipped, degraded, not-present, not-applicable, and validation-only reason categories in `__tests__/lsp-status.test.ts`
- [X] T054 [P] [US3] Write failing performance enforcement and status tests for elapsed time, full-index per-language source-file caps, candidate work-item caps, 250-item LSP batch size, active session high-water mark, in-flight request high-water mark, cap-exceeded skip reasons, and deterministic no-unbounded-fallback behavior in `__tests__/lsp-status.test.ts` and `__tests__/lsp-precision-pass.test.ts`

### Implementation for User Story 3

- [X] T055 [US3] Map missing, crashed, timed-out, malformed, and shutdown-failed server conditions to per-language degradation in `src/lsp/prereqs.ts` and `src/lsp/status.ts`
- [X] T056 [US3] Implement at-most-one fresh session restart per language per explicit index or sync run in `src/lsp/precision-pass.ts`
- [X] T057 [US3] Implement checked, verified, corrected, suppressed, skipped-by-reason, and degraded counters in `src/lsp/status.ts`
- [X] T058 [US3] Implement structural-index elapsed time, LSP elapsed time, enabled-overhead ratio, full-index per-language file/work caps, 250-item batching, active session concurrency limit, request concurrency limit, session high-water, and request high-water status records in `src/lsp/precision-pass.ts`, `src/lsp/client.ts`, and `src/lsp/status.ts`
- [X] T059 [US3] Add deterministic missing, crashed, timed-out, malformed, and shutdown-failure fake server fixtures in `__tests__/fixtures/lsp/degradation/README.md`
- [X] T060 [US3] Ensure `codegraph status` reads recorded LSP state and does not start or probe language servers solely because status is requested in `src/bin/codegraph.ts`
- [X] T061 [US3] Run `npm test -- __tests__/lsp-prereqs.test.ts __tests__/lsp-client.test.ts __tests__/lsp-status.test.ts __tests__/lsp-precision-pass.test.ts` and record output in `specs/008-lsp-client-integration/validation/slice-2.md`
- [X] T062 [US3] Record graceful-degradation, full-index cap enforcement, batch-size enforcement, session/request concurrency, and no-unbounded-fallback evidence for missing, crashed, timed-out, malformed, shutdown-failed, and cap-exceeded scenarios in `specs/008-lsp-client-integration/validation/slice-2.md`

**Checkpoint**: User Story 3 can be validated independently through status and degradation fixtures.

---

## Phase 6: User Story 4 - Complete SPEC-008 With No Unowned Parity Gaps (Priority: P3, Slice 2 and Slice 3)

**Goal**: SPEC-008 completion proves unique-target correction, real-server coverage, bounded watch verification, self-repo dogfood, and language/capability parity ownership with zero unowned rows.

**Independent Test**: Run validation with missing prereqs, unowned language rows, unowned capability rows, unique LSP targets, ambiguous LSP targets, and self-repo opt-in dogfood; each invalid case fails clearly and each valid case records evidence.

### Tests for User Story 4

- [X] T063 [P] [US4] Write failing `Location` and `LocationLink` normalization and deduplication tests in `__tests__/lsp-precision-pass.test.ts`
- [X] T064 [P] [US4] Write failing unique in-workspace correction tests proving exactly one active edge remains for a semantic reference in `__tests__/lsp-precision-pass.test.ts`
- [X] T065 [P] [US4] Write failing external, generated, and unindexed target suppression tests proving no external graph nodes are created in `__tests__/lsp-precision-pass.test.ts`
- [X] T066 [P] [US4] Write failing ambiguous LSP output tests proving no speculative replacement edge is emitted in `__tests__/lsp-precision-pass.test.ts`
- [X] T067 [P] [US4] Write failing retrieval regression tests proving suppressed audit data is absent from traversal, callers, callees, impact, search, and flow-building outputs in `__tests__/lsp-retrieval-regression.test.ts`
- [X] T068 [P] [US4] Write failing bounded watch verification tests for changed-file sets, absent changed-file sets, oversized batches, and candidate work caps in `__tests__/lsp-watch.test.ts`
- [X] T069 [P] [US4] Write failing watch restart-budget tests keyed to the bounded changed-file batch rather than each debounce cycle in `__tests__/lsp-watch.test.ts`

### Implementation for User Story 4

- [X] T070 [US4] Implement LSP target normalization, equivalent range deduplication, and uniqueness checks in `src/lsp/precision-pass.ts`
- [X] T071 [US4] Implement compatible CodeGraph node matching for unique in-workspace targets in `src/lsp/precision-pass.ts`
- [X] T072 [US4] Implement edge retargeting, replacement, suppression, and ambiguous-output no-op behavior in `src/lsp/precision-pass.ts`
- [X] T073 [US4] Implement correction and suppression audit metadata storage in `src/lsp/corrections.ts` and `src/db/schema.sql`
- [X] T074 [US4] Exclude inactive suppression/audit data from traversal, callers, callees, impact, search, and flow-building surfaces in the existing retrieval paths, including `src/graph/queries.ts`, `src/graph/traversal.ts`, `src/db/queries.ts`, `src/context/index.ts`, `src/mcp/tools.ts`, and affected `src/search/` helpers
- [X] T075 [US4] Add retrieval regression probe script for `codegraph_explore`, callers, callees, impact, search, and flow-building surfaces in `scripts/spec-008-retrieval-probes.mjs`
- [X] T076 [US4] Run correction, suppression, ambiguity, and retrieval regression tests and record expected node/edge deltas in `specs/008-lsp-client-integration/validation/slice-2.md`

### Slice 2 Real-Server Validation

- [X] T077 [P] [US4] Add Python real-server prereq and smoke validation for `pyright-langserver --stdio` or `basedpyright-langserver --stdio` in `scripts/spec-008-validate-real-servers.mjs`
- [X] T078 [P] [US4] Add Go real-server prereq and module workspace smoke validation for `gopls` in `scripts/spec-008-validate-real-servers.mjs`
- [X] T079 [P] [US4] Add Rust real-server prereq and cargo workspace smoke validation for `rust-analyzer` in `scripts/spec-008-validate-real-servers.mjs`
- [X] T080 [P] [US4] Add C and C++ real-server prereq and compile-command-aware smoke validation for `clangd` in `scripts/spec-008-validate-real-servers.mjs`
- [X] T081 [P] [US4] Add Swift real-server prereq and package/source workspace smoke validation for `sourcekit-lsp` in `scripts/spec-008-validate-real-servers.mjs`
- [X] T082 [P] [US4] Add Java real-server prereq and workspace initialization smoke validation for configured JDT LS command in `scripts/spec-008-validate-real-servers.mjs`
- [X] T083 [US4] Run slice-2 real-server validation for Python, Go, Rust, C, C++, Swift, and Java and record observed versions, paths, status coverage, and degradation evidence in `specs/008-lsp-client-integration/validation/slice-2.md`

### Slice 3 Real-Server Validation and Watch

- [X] T084 [P] [US4] Add C# real-server prereq and workspace smoke validation for `csharp-ls` in `scripts/spec-008-validate-real-servers.mjs`
- [X] T085 [P] [US4] Add Kotlin real-server prereq and workspace smoke validation for `kotlin-language-server` or `kotlin-lsp` in `scripts/spec-008-validate-real-servers.mjs`
- [X] T086 [P] [US4] Add PHP real-server prereq and definition/reference smoke validation for `intelephense --stdio` or `phpactor language-server` in `scripts/spec-008-validate-real-servers.mjs`
- [X] T087 [P] [US4] Add Ruby real-server prereq and definition/reference smoke validation for `ruby-lsp` or `solargraph stdio` in `scripts/spec-008-validate-real-servers.mjs`
- [X] T088 [P] [US4] Add Dart real-server prereq and package smoke validation for `dart language-server` in `scripts/spec-008-validate-real-servers.mjs`
- [X] T089 [P] [US4] Add Vue real-server prereq, component smoke validation, and TypeScript SDK evidence for `vue-language-server --stdio` in `scripts/spec-008-validate-real-servers.mjs`
- [X] T090 [P] [US4] Add COBOL parser/resolver parity disposition with SPEC-024 LSP parity boundary in `specs/008-lsp-client-integration/validation/language-parity.md`
- [X] T091 [US4] Implement bounded incremental watch LSP verification after normal sync/reference resolution in `src/sync/watcher.ts`, `src/sync/index.ts`, and `src/lsp/precision-pass.ts`
- [X] T092 [US4] Implement absent, unbounded, oversized changed-file, and oversized candidate-work skip reasons for watch verification in `src/lsp/status.ts`
- [X] T093 [US4] Implement watch-mode restart budget keyed to a materially new bounded changed-file batch in `src/lsp/client.ts`, `src/sync/watcher.ts`, and `src/sync/watch-policy.ts`
- [X] T094 [US4] Run slice-3 real-server validation for C#, Kotlin, PHP, Ruby, Dart, Vue, and COBOL disposition and record evidence in `specs/008-lsp-client-integration/validation/slice-3.md`
- [X] T095 [US4] Run bounded watch tests and record changed-file, cap, skip, and restart-budget evidence in `specs/008-lsp-client-integration/validation/slice-3.md`

### Language and Capability Parity

- [X] T096 [US4] Implement language and capability parity gate checks that fail on any unowned row in `scripts/spec-008-parity-gate.mjs`
- [X] T097 [US4] Record language parity rows for JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Ruby, Rust, PHP, Kotlin, Swift, Dart, Vue, and COBOL with SPEC-008 or SPEC-024 validation boundaries in `specs/008-lsp-client-integration/validation/language-parity.md`
- [X] T098 [P] [US4] Record capability parity rows for multi-phase graph pipeline, field/property binding, hybrid search, process groups, functional clusters, and blast-radius impact with SPEC-024 validation boundaries where future-owned in `specs/008-lsp-client-integration/validation/capability-parity.md`
- [X] T099 [P] [US4] Record capability parity rows for git diff impact, multi-file rename, raw Cypher queries, MCP resources, MCP prompts, and wiki generation with SPEC-024 validation boundaries where future-owned in `specs/008-lsp-client-integration/validation/capability-parity.md`
- [X] T100 [P] [US4] Record capability parity rows for multi-repo registry, repository groups, remote embeddings, installer setup/uninstall, agent skills/hooks, and analyzer operational flags with SPEC-024 validation boundaries where future-owned in `specs/008-lsp-client-integration/validation/capability-parity.md`
- [X] T101 [US4] Run parity gate positive and negative fixtures and record zero unowned language and capability rows in `specs/008-lsp-client-integration/validation/parity-gate.md`

### Self-Repo Dogfood and Slice 3 Packet

- [X] T102 [US4] Run self-repo non-LSP dogfood with `node dist/bin/codegraph.js index` and record graph/provenance baseline evidence in `specs/008-lsp-client-integration/validation/self-repo-dogfood.md`
- [X] T103 [US4] Run self-repo explicit LSP dogfood with `node dist/bin/codegraph.js index --lsp` and record coverage, degradation, performance, and observed server evidence in `specs/008-lsp-client-integration/validation/self-repo-dogfood.md`
- [X] T104 [US4] Run self-repo `node dist/bin/codegraph.js status --json` after explicit LSP opt-in and record status evidence in `specs/008-lsp-client-integration/validation/self-repo-dogfood.md`
- [X] T105 [US4] Run and record representative small, medium, and large LSP-enabled validation evidence showing bounded completion or deterministic per-language skip/degrade reasons, no unbounded repository-wide LSP pass, no duplicate active-edge growth, retrieval sufficiency preservation, traceability, scope budget, parity closure, known gaps, rollback note, and review order in `specs/008-lsp-client-integration/validation/slice-3.md`

**Checkpoint**: User Story 4 validates correction, all server rows or SPEC-024 disposition, bounded watch behavior, parity gates, retrieval safety, and explicit self-repo dogfood.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validate the complete feature packet and prepare it for review without widening SPEC-008 scope.

- [X] T106 [P] Update SPEC-008 quickstart validation notes with final implemented command names and artifact paths in `specs/008-lsp-client-integration/quickstart.md`
- [X] T107 [P] Record README and CHANGELOG applicability decision without adding outbound links in `specs/008-lsp-client-integration/validation/final-packet.md`
- [X] T108 Run `npm run build` and record output in `specs/008-lsp-client-integration/validation/final-packet.md`
- [X] T109 Run `npm run typecheck` and record output in `specs/008-lsp-client-integration/validation/final-packet.md`
- [X] T110 Run `npm test` and record output in `specs/008-lsp-client-integration/validation/final-packet.md`
- [X] T111 Run `npm run build && npm run typecheck && npm test` and record output in `specs/008-lsp-client-integration/validation/final-packet.md`
- [X] T112 Run `scripts/spec-008-validate-real-servers.mjs` and record final prerequisite status in `specs/008-lsp-client-integration/validation/final-packet.md`
- [X] T113 Run `scripts/spec-008-parity-gate.mjs` and record final zero-unowned-row status in `specs/008-lsp-client-integration/validation/final-packet.md`
- [X] T114 Generate final PR review packet with what changed, why, non-goals, review order, scope budget, traceability, verification evidence, representative small/medium/large validation evidence, known gaps, rollback notes, and feature-flag notes in `specs/008-lsp-client-integration/validation/final-packet.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies.
- **Phase 2 Foundational**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 US1 / Slice 1 MVP**: Depends on Phase 2.
- **Phase 4 US2 / Slice 1**: Depends on Phase 2 and can proceed alongside non-conflicting US1 work after shared config files are coordinated.
- **Phase 5 US3 / Slice 1 and Slice 2**: Depends on Phase 2 and client/status scaffolding from US1.
- **Phase 6 US4 / Slice 2 and Slice 3**: Depends on correction/status foundations from US1 and US3.
- **Phase 7 Polish**: Depends on selected story slices being complete.

### User Story Dependencies

- **US1 (P1)**: MVP; no dependency on US2, US3, or US4 after foundation.
- **US2 (P2)**: Depends on foundation; validates config behavior independently but shares config files with US1.
- **US3 (P2)**: Depends on foundation and JSON-RPC lifecycle; validates degradation independently.
- **US4 (P3)**: Depends on foundation, lifecycle, status, and precision-pass scaffolding; validates parity and final completion gates.

### Vertical PR Slices

- **Slice 1**: T001-T049 plus relevant T106-T114 validation packet tasks.
- **Slice 2**: T050-T083 plus relevant T106-T114 validation packet tasks.
- **Slice 3**: T084-T105 plus T106-T114 validation packet tasks.

---

## Parallel Opportunities

- Phase 1 scaffolding tasks T002-T004 can run in parallel.
- Phase 2 failing tests T006-T009 can run in parallel before implementation.
- US1 tests T019-T024 can run in parallel before US1 implementation.
- US2 tests T038-T042 can run in parallel before US2 implementation.
- US3 tests T050-T054 can run in parallel before US3 implementation.
- US4 tests T063-T069 can run in parallel before correction/watch implementation.
- Slice 2 real-server validation task additions T077-T082 can run in parallel.
- Slice 3 real-server validation task additions T084-T090 can run in parallel.
- Capability parity documentation tasks T098-T100 can run in parallel.
- Polish notes T106-T107 can run in parallel after implementation.

## Parallel Example: User Story 1

```text
Task: T019 disabled-path tests in __tests__/lsp-disabled.test.ts
Task: T020 CLI activation tests in __tests__/lsp-config.test.ts
Task: T021 JSON-RPC lifecycle tests in __tests__/lsp-client.test.ts
Task: T022 TypeScript/JavaScript precision tests in __tests__/lsp-precision-pass.test.ts
Task: T023 status output tests in __tests__/lsp-status.test.ts
Task: T024 real-server prereq tests in __tests__/lsp-real-server-validation.test.ts
```

## Parallel Example: User Story 4

```text
Task: T077 Python real-server validation in scripts/spec-008-validate-real-servers.mjs
Task: T078 Go real-server validation in scripts/spec-008-validate-real-servers.mjs
Task: T079 Rust real-server validation in scripts/spec-008-validate-real-servers.mjs
Task: T080 C and C++ real-server validation in scripts/spec-008-validate-real-servers.mjs
Task: T081 Swift real-server validation in scripts/spec-008-validate-real-servers.mjs
Task: T082 Java real-server validation in scripts/spec-008-validate-real-servers.mjs
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup.
2. Complete Phase 2 foundation.
3. Complete Phase 3 US1 / Slice 1 MVP.
4. Stop and validate explicit opt-in, default-off unchanged behavior, JSON-RPC lifecycle, status output, and TypeScript/JavaScript real-server evidence.

### Incremental Delivery

1. Deliver Slice 1 with US1, US2, and the first status/degradation path.
2. Deliver Slice 2 with correction behavior, retrieval regression checks, and the middle language group.
3. Deliver Slice 3 with remaining server rows, COBOL SPEC-024 disposition, bounded watch behavior, parity gates, self-repo dogfood, and final packet.

### TDD Rule

Every test task in a user-story phase must be written and observed failing before its matching implementation task is completed. Completion evidence belongs in the matching `specs/008-lsp-client-integration/validation/*.md` artifact.
