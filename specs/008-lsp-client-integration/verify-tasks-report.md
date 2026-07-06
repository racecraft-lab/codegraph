# Verify Tasks Report: SPEC-008 LSP Client Integration

- Date: 2026-07-06T02:36:36Z
- Scope: `all`
- Base ref: `origin/main`
- Completed tasks verified: 114
- Fresh session advisory: For maximum reliability, run `/speckit.verify-tasks` in a separate agent session from the one that performed `/speckit.implement`.

## Summary Scorecard

| Verdict | Count |
|---|---:|
| ✅ VERIFIED | 114 |
| 🔍 PARTIAL | 0 |
| ⚠️ WEAK | 0 |
| ❌ NOT_FOUND | 0 |
| ⏭️ SKIPPED | 0 |

## Flagged Items

None.

## Verified Items

| Task ID | Verdict | Summary |
|---|---|---|
| T001 | ✅ VERIFIED | Create LSP module scaffold exports in `src/lsp/index.ts` and `src/lsp/types.ts` (Refs: src/lsp/index.ts, src/lsp/types.ts) |
| T002 | ✅ VERIFIED | [P] Create deterministic fake LSP fixture layout in `__tests__/fixtures/lsp/README.md` (Refs: __tests__/fixtures/lsp/README.md) |
| T003 | ✅ VERIFIED | [P] Create SPEC-008 validation artifact directory and notes in `specs/008-lsp-client-integration/validation/README.md` (Refs: specs/008-lsp-client-integration/validation/README.md) |
| T004 | ✅ VERIFIED | [P] Create real-server validation script scaffold in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T005 | ✅ VERIFIED | Create three-slice review plan and file ownership map in `specs/008-lsp-client-integration/validation/slice-plan.md` (Refs: specs/008-lsp-client-integration/validation/slice-plan.md) |
| T006 | ✅ VERIFIED | [P] Write failing registry completeness tests for every SPEC-008 language row and the COBOL SPEC-024 disposition in `__tests__/lsp-prereqs.test.ts` (Refs: __tests__/lsp-prereqs.test.ts) |
| T007 | ✅ VERIFIED | [P] Write failing activation/config precedence tests for CLI, project config, environment overrides, invalid values, and default-off behavior in `__tests__/lsp-config.test.ts` (Refs: __tests__/lsp-config.test.ts) |
| T008 | ✅ VERIFIED | [P] Write failing status contract tests for stable LSP state, reason codes, coverage fields, and performance fields in `__tests__/lsp-status.test.ts` (Refs: __tests__/lsp-status.test.ts) |
| T009 | ✅ VERIFIED | [P] Write failing provenance typing tests that preserve `null` and `heuristic` edges and allow only verified/corrected active edges to use `lsp` in `__tests__/lsp-precision-pass.test.ts` (Refs: __tests__/lsp-precision-pass.test.ts) |
| T010 | ✅ VERIFIED | Implement LSP activation, config, registry, status, performance, reason-code, and correction metadata types in `src/lsp/types.ts` (Refs: src/lsp/types.ts) |
| T011 | ✅ VERIFIED | Implement the server registry for JavaScript, JSX, TypeScript, TSX, Python, Java, C, C++, C#, Go, Ruby, Rust, PHP, Kotlin, Swift, Dart, Vue, and COBOL disposition in `src/lsp/servers.ts` (Refs: src/lsp/servers.ts) |
| T012 | ✅ VERIFIED | Implement project and environment LSP config parsing with activation, command, and timeout precedence in `src/lsp/config.ts` (Refs: src/lsp/config.ts) |
| T013 | ✅ VERIFIED | Implement command probing, accepted-alternative selection, configured-command no-fallback behavior, and prereq report data in `src/lsp/prereqs.ts` (Refs: src/lsp/prereqs.ts) |
| T014 | ✅ VERIFIED | Implement LSP status aggregation models for server availability, coverage, edge counts, skip reasons, degradation, and performance in `src/lsp/status.ts` (Refs: src/lsp/status.ts) |
| T015 | ✅ VERIFIED | Extend edge provenance typing and storage compatibility for additive `lsp` provenance in `src/types.ts` and `src/db/schema.sql` (Refs: src/types.ts, src/db/schema.sql) |
| T016 | ✅ VERIFIED | Export the LSP foundation modules from `src/lsp/index.ts` (Refs: src/lsp/index.ts) |
| T017 | ✅ VERIFIED | Wire `codegraph.json.lsp` loading into the project config path in `src/project-config.ts` (Refs: src/project-config.ts) |
| T018 | ✅ VERIFIED | Record the accepted reviewability warning, three-slice boundary, and implementation file budget in `specs/008-lsp-client-integration/validation/slice-plan.md` (Refs: specs/008-lsp-client-integration/validation/slice-plan.md) |
| T019 | ✅ VERIFIED | [P] [US1] Write failing disabled-path index, sync, and watch-triggered sync tests proving zero LSP command probes, subprocess starts, JSON-RPC messages, status writes, and graph mutations in `__tests__/lsp-disabled.test.ts` (Refs: __tests__/lsp-disabled.test.ts) |
| T020 | ✅ VERIFIED | [P] [US1] Write failing CLI activation tests for `codegraph index`, `codegraph index --lsp`, and `codegraph index --no-lsp` precedence in `__tests__/lsp-config.test.ts` (Refs: __tests__/lsp-config.test.ts) |
| T021 | ✅ VERIFIED | [P] [US1] Write failing JSON-RPC lifecycle tests for initialize, request id routing, timeout, shutdown, stderr/stdout draining, and malformed response handling in `__tests__/lsp-client.test.ts` (Refs: __tests__/lsp-client.test.ts) |
| T022 | ✅ VERIFIED | [P] [US1] Write failing TypeScript-family precision-pass tests for complete definition/reference verification paths in `__tests__/lsp-precision-pass.test.ts` (Refs: __tests__/lsp-precision-pass.test.ts) |
| T023 | ✅ VERIFIED | [P] [US1] Write failing status tests for CLI activation source, observed server evidence, per-language coverage, and edge counts in `__tests__/lsp-status.test.ts` (Refs: __tests__/lsp-status.test.ts) |
| T024 | ✅ VERIFIED | [P] [US1] Write failing TypeScript-family real-server prereq validation tests for `typescript-language-server --stdio` and TypeScript SDK evidence in `__tests__/lsp-real-server-validation.test.ts` (Refs: __tests__/lsp-real-server-validation.test.ts) |
| T025 | ✅ VERIFIED | [US1] Add `--lsp` and `--no-lsp` index activation options without changing default behavior in `src/bin/codegraph.ts` (Refs: src/bin/codegraph.ts) |
| T026 | ✅ VERIFIED | [US1] Pass effective LSP activation from CLI and project config into index and sync entry points in `src/index.ts` (Refs: src/index.ts) |
| T027 | ✅ VERIFIED | [US1] Implement the JSON-RPC stdio client lifecycle in `src/lsp/client.ts` (Refs: src/lsp/client.ts) |
| T028 | ✅ VERIFIED | [US1] Implement bounded request timeout, shutdown, process exit, stdout draining, and stderr draining behavior in `src/lsp/client.ts` (Refs: src/lsp/client.ts) |
| T029 | ✅ VERIFIED | [US1] Implement TypeScript-family work-item selection after structural extraction and reference resolution in `src/lsp/precision-pass.ts` (Refs: src/lsp/precision-pass.ts) |
| T030 | ✅ VERIFIED | [US1] Implement verified-edge marking for matching TypeScript-family LSP targets in `src/lsp/precision-pass.ts` (Refs: src/lsp/precision-pass.ts) |
| T031 | ✅ VERIFIED | [US1] Persist slice-1 coverage, edge-count, and performance status for LSP-enabled runs in `src/lsp/status.ts` (Refs: src/lsp/status.ts) |
| T032 | ✅ VERIFIED | [US1] Integrate the LSP precision pass after existing reference resolution while preserving disabled-path behavior in `src/index.ts` (Refs: src/index.ts) |
| T033 | ✅ VERIFIED | [US1] Render LSP state in human and JSON status output without starting language servers from status in `src/bin/codegraph.ts` (Refs: src/bin/codegraph.ts) |
| T034 | ✅ VERIFIED | [US1] Implement TypeScript-family real-server validation in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T035 | ✅ VERIFIED | [US1] Run `npm test -- __tests__/lsp-disabled.test.ts __tests__/lsp-client.test.ts __tests__/lsp-precision-pass.test.ts` and record output in `specs/008-lsp-client-integration/validation/slice-1.md` (Refs: specs/008-lsp-client-integration/validation/slice-1.md) |
| T036 | ✅ VERIFIED | [US1] Run TypeScript-family real-server validation and record observed command, resolved path, version, SDK evidence, and coverage in `specs/008-lsp-client-integration/validation/slice-1.md` (Refs: specs/008-lsp-client-integration/validation/slice-1.md) |
| T037 | ✅ VERIFIED | [US1] Record slice-1 traceability, scope budget, non-goals, rollback note, and known gaps in `specs/008-lsp-client-integration/validation/slice-1.md` (Refs: specs/008-lsp-client-integration/validation/slice-1.md) |
| T038 | ✅ VERIFIED | [P] [US2] Write failing project config tests for `lsp.enabled`, `lsp.defaultTimeoutMs`, `lsp.watch.enabled`, and `lsp.servers.<language>` values in `__tests__/lsp-config.test.ts` (Refs: __tests__/lsp-config.test.ts) |
| T039 | ✅ VERIFIED | [P] [US2] Write failing environment override tests for `CODEGRAPH_LSP_<LANG>_COMMAND_JSON`, `CODEGRAPH_LSP_<LANG>_TIMEOUT_MS`, and `CODEGRAPH_LSP_TIMEOUT_MS` in `__tests__/lsp-config.test.ts` (Refs: __tests__/lsp-config.test.ts) |
| T040 | ✅ VERIFIED | [P] [US2] Write failing invalid override tests proving malformed JSON, non-string argv elements, and invalid timeouts warn and fall back in `__tests__/lsp-config.test.ts` (Refs: __tests__/lsp-config.test.ts) |
| T041 | ✅ VERIFIED | [P] [US2] Write failing command probing tests for PATH lookup, absolute argv, relative argv, selected argv reporting, and expected alternatives in `__tests__/lsp-prereqs.test.ts` (Refs: __tests__/lsp-prereqs.test.ts) |
| T042 | ✅ VERIFIED | [P] [US2] Write failing configured-command unavailable tests proving valid configured argv does not fall through to registry alternatives in `__tests__/lsp-prereqs.test.ts` (Refs: __tests__/lsp-prereqs.test.ts) |
| T043 | ✅ VERIFIED | [US2] Implement command argv parsing and validation for project and environment values in `src/lsp/config.ts` (Refs: src/lsp/config.ts) |
| T044 | ✅ VERIFIED | [US2] Implement timeout precedence and validation for project and environment values in `src/lsp/config.ts` (Refs: src/lsp/config.ts) |
| T045 | ✅ VERIFIED | [US2] Implement warning collection for ignored unknown languages, invalid commands, and invalid timeout values in `src/lsp/config.ts` (Refs: src/lsp/config.ts) |
| T046 | ✅ VERIFIED | [US2] Implement PATH, absolute path, and relative path command resolution with configured-command no-fallback semantics in `src/lsp/prereqs.ts` (Refs: src/lsp/prereqs.ts) |
| T047 | ✅ VERIFIED | [US2] Apply environment command and timeout overrides during index runtime without allowing environment-only activation in `src/bin/codegraph.ts` (Refs: src/bin/codegraph.ts) |
| T048 | ✅ VERIFIED | [US2] Include selected argv, resolved executable path, expected alternatives, timeout source, and warnings in status data in `src/lsp/status.ts` (Refs: src/lsp/status.ts) |
| T049 | ✅ VERIFIED | [US2] Run `npm test -- __tests__/lsp-config.test.ts __tests__/lsp-prereqs.test.ts` and record output in `specs/008-lsp-client-integration/validation/slice-1.md` (Refs: specs/008-lsp-client-integration/validation/slice-1.md) |
| T050 | ✅ VERIFIED | [P] [US3] Write failing missing-server degradation tests for normal runtime in `__tests__/lsp-prereqs.test.ts` (Refs: __tests__/lsp-prereqs.test.ts) |
| T051 | ✅ VERIFIED | [P] [US3] Write failing crash, initialize timeout, request timeout, malformed response, and shutdown failure tests in `__tests__/lsp-client.test.ts` (Refs: __tests__/lsp-client.test.ts) |
| T052 | ✅ VERIFIED | [P] [US3] Write failing one-restart-per-language-per-run tests for bounded recovery in `__tests__/lsp-client.test.ts` (Refs: __tests__/lsp-client.test.ts) |
| T053 | ✅ VERIFIED | [P] [US3] Write failing status tests for unavailable, skipped, degraded, not-present, not-applicable, and validation-only reason categories in `__tests__/lsp-status.test.ts` (Refs: __tests__/lsp-status.test.ts) |
| T054 | ✅ VERIFIED | [P] [US3] Write failing performance enforcement and status tests for elapsed time, full-index per-language source-file caps, candidate work-item caps, 250-item LSP batch size, active session high-water mark, in-flight request high-water mark, cap-exceeded skip reasons, and deterministic no-unbounded-fallback behavior in `__tests__/lsp-status.test.ts` and `__tests__/lsp-precision-pass.test.ts` (Refs: __tests__/lsp-status.test.ts, __tests__/lsp-precision-pass.test.ts) |
| T055 | ✅ VERIFIED | [US3] Map missing, crashed, timed-out, malformed, and shutdown-failed server conditions to per-language degradation in `src/lsp/prereqs.ts` and `src/lsp/status.ts` (Refs: src/lsp/prereqs.ts, src/lsp/status.ts) |
| T056 | ✅ VERIFIED | [US3] Implement at-most-one fresh session restart per language per explicit index or sync run in `src/lsp/client.ts` (Refs: src/lsp/client.ts) |
| T057 | ✅ VERIFIED | [US3] Implement checked, verified, corrected, suppressed, skipped-by-reason, and degraded counters in `src/lsp/status.ts` (Refs: src/lsp/status.ts) |
| T058 | ✅ VERIFIED | [US3] Implement structural-index elapsed time, LSP elapsed time, enabled-overhead ratio, full-index per-language file/work caps, 250-item batching, active session concurrency limit, request concurrency limit, session high-water, and request high-water status records in `src/lsp/precision-pass.ts`, `src/lsp/client.ts`, and `src/lsp/status.ts` (Refs: src/lsp/precision-pass.ts, src/lsp/client.ts, src/lsp/status.ts) |
| T059 | ✅ VERIFIED | [US3] Add deterministic missing, crashed, timed-out, malformed, and shutdown-failure fake server fixtures in `__tests__/fixtures/lsp/degradation/README.md` (Refs: __tests__/fixtures/lsp/degradation/README.md) |
| T060 | ✅ VERIFIED | [US3] Ensure `codegraph status` reads recorded LSP state and does not start or probe language servers solely because status is requested in `src/bin/codegraph.ts` (Refs: src/bin/codegraph.ts) |
| T061 | ✅ VERIFIED | [US3] Run `npm test -- __tests__/lsp-prereqs.test.ts __tests__/lsp-client.test.ts __tests__/lsp-status.test.ts __tests__/lsp-precision-pass.test.ts` and record output in `specs/008-lsp-client-integration/validation/slice-2.md` (Refs: specs/008-lsp-client-integration/validation/slice-2.md) |
| T062 | ✅ VERIFIED | [US3] Record graceful-degradation, full-index cap enforcement, batch-size enforcement, session/request concurrency, and no-unbounded-fallback evidence for missing, crashed, timed-out, malformed, shutdown-failed, and cap-exceeded scenarios in `specs/008-lsp-client-integration/validation/slice-2.md` (Refs: specs/008-lsp-client-integration/validation/slice-2.md) |
| T063 | ✅ VERIFIED | [P] [US4] Write failing `Location` and `LocationLink` normalization and deduplication tests in `__tests__/lsp-precision-pass.test.ts` (Refs: __tests__/lsp-precision-pass.test.ts) |
| T064 | ✅ VERIFIED | [P] [US4] Write failing unique in-workspace correction tests proving exactly one active edge remains for a semantic reference in `__tests__/lsp-precision-pass.test.ts` (Refs: __tests__/lsp-precision-pass.test.ts) |
| T065 | ✅ VERIFIED | [P] [US4] Write failing external, generated, and unindexed target suppression tests proving no external graph nodes are created in `__tests__/lsp-precision-pass.test.ts` (Refs: __tests__/lsp-precision-pass.test.ts) |
| T066 | ✅ VERIFIED | [P] [US4] Write failing ambiguous LSP output tests proving no speculative replacement edge is emitted in `__tests__/lsp-precision-pass.test.ts` (Refs: __tests__/lsp-precision-pass.test.ts) |
| T067 | ✅ VERIFIED | [P] [US4] Write failing retrieval regression tests proving suppressed audit data is absent from traversal, callers, callees, impact, search, and flow-building outputs in `__tests__/lsp-retrieval-regression.test.ts` (Refs: __tests__/lsp-retrieval-regression.test.ts) |
| T068 | ✅ VERIFIED | [P] [US4] Write failing bounded watch verification tests for changed-file sets, absent changed-file sets, oversized batches, and candidate work caps in `__tests__/lsp-watch.test.ts` (Refs: __tests__/lsp-watch.test.ts) |
| T069 | ✅ VERIFIED | [P] [US4] Write failing watch restart-budget tests keyed to the bounded changed-file batch rather than each debounce cycle in `__tests__/lsp-watch.test.ts` (Refs: __tests__/lsp-watch.test.ts) |
| T070 | ✅ VERIFIED | [US4] Implement LSP target normalization, equivalent range deduplication, and uniqueness checks in `src/lsp/precision-pass.ts` (Refs: src/lsp/precision-pass.ts) |
| T071 | ✅ VERIFIED | [US4] Implement compatible CodeGraph node matching for unique in-workspace targets in `src/lsp/precision-pass.ts` (Refs: src/lsp/precision-pass.ts) |
| T072 | ✅ VERIFIED | [US4] Implement edge retargeting, replacement, suppression, and ambiguous-output no-op behavior in `src/lsp/precision-pass.ts` (Refs: src/lsp/precision-pass.ts) |
| T073 | ✅ VERIFIED | [US4] Implement correction and suppression audit metadata storage in `src/lsp/corrections.ts` and `src/db/schema.sql` (Refs: src/lsp/corrections.ts, src/db/schema.sql) |
| T074 | ✅ VERIFIED | [US4] Exclude inactive suppression/audit data from traversal, callers, callees, impact, search, and flow-building surfaces in the existing retrieval paths, including `src/graph/queries.ts`, `src/graph/traversal.ts`, `src/db/queries.ts`, `src/context/index.ts`, `src/mcp/tools.ts`, and affected `src/search/` helpers (Refs: src/graph/queries.ts, src/graph/traversal.ts, src/db/queries.ts, src/context/index.ts, src/mcp/tools.ts, src/search/) |
| T075 | ✅ VERIFIED | [US4] Add retrieval regression probe script for `codegraph_explore`, callers, callees, impact, search, and flow-building surfaces in `scripts/spec-008-retrieval-probes.mjs` (Refs: scripts/spec-008-retrieval-probes.mjs) |
| T076 | ✅ VERIFIED | [US4] Run correction, suppression, ambiguity, and retrieval regression tests and record expected node/edge deltas in `specs/008-lsp-client-integration/validation/slice-2.md` (Refs: specs/008-lsp-client-integration/validation/slice-2.md) |
| T077 | ✅ VERIFIED | [P] [US4] Add Python real-server prereq and smoke validation for `pyright-langserver --stdio` or `basedpyright-langserver --stdio` in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T078 | ✅ VERIFIED | [P] [US4] Add Go real-server prereq and module workspace smoke validation for `gopls` in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T079 | ✅ VERIFIED | [P] [US4] Add Rust real-server prereq and cargo workspace smoke validation for `rust-analyzer` in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T080 | ✅ VERIFIED | [P] [US4] Add C and C++ real-server prereq and compile-command-aware smoke validation for `clangd` in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T081 | ✅ VERIFIED | [P] [US4] Add Swift real-server prereq and package/source workspace smoke validation for `sourcekit-lsp` in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T082 | ✅ VERIFIED | [P] [US4] Add Java real-server prereq and workspace initialization smoke validation for configured JDT LS command in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T083 | ✅ VERIFIED | [US4] Run slice-2 real-server validation for Python, Go, Rust, C, C++, Swift, and Java and record observed versions, paths, status coverage, and degradation evidence in `specs/008-lsp-client-integration/validation/slice-2.md` (Refs: specs/008-lsp-client-integration/validation/slice-2.md) |
| T084 | ✅ VERIFIED | [P] [US4] Add C# real-server prereq and workspace smoke validation for `csharp-ls` in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T085 | ✅ VERIFIED | [P] [US4] Add Kotlin real-server prereq and workspace smoke validation for `kotlin-language-server` or `kotlin-lsp` in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T086 | ✅ VERIFIED | [P] [US4] Add PHP real-server prereq and definition/reference smoke validation for `intelephense --stdio` or `phpactor language-server` in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T087 | ✅ VERIFIED | [P] [US4] Add Ruby real-server prereq and definition/reference smoke validation for `ruby-lsp` or `solargraph stdio` in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T088 | ✅ VERIFIED | [P] [US4] Add Dart real-server prereq and package smoke validation for `dart language-server` in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T089 | ✅ VERIFIED | [P] [US4] Add Vue real-server prereq, component smoke validation, and TypeScript SDK evidence for `vue-language-server --stdio` in `scripts/spec-008-validate-real-servers.mjs` (Refs: scripts/spec-008-validate-real-servers.mjs) |
| T090 | ✅ VERIFIED | [P] [US4] Add COBOL parser/resolver parity disposition with SPEC-024 LSP parity boundary in `specs/008-lsp-client-integration/validation/language-parity.md` (Refs: specs/008-lsp-client-integration/validation/language-parity.md) |
| T091 | ✅ VERIFIED | [US4] Implement bounded incremental watch LSP verification after normal sync/reference resolution in `src/sync/watcher.ts`, `src/sync/index.ts`, and `src/lsp/precision-pass.ts` (Refs: src/sync/watcher.ts, src/sync/index.ts, src/lsp/precision-pass.ts) |
| T092 | ✅ VERIFIED | [US4] Implement absent, unbounded, oversized changed-file, and oversized candidate-work skip reasons for watch verification in `src/lsp/status.ts` (Refs: src/lsp/status.ts) |
| T093 | ✅ VERIFIED | [US4] Implement watch-mode restart budget keyed to a materially new bounded changed-file batch in `src/lsp/client.ts`, `src/sync/watcher.ts`, and `src/sync/watch-policy.ts` (Refs: src/lsp/client.ts, src/sync/watcher.ts, src/sync/watch-policy.ts) |
| T094 | ✅ VERIFIED | [US4] Run slice-3 real-server validation for C#, Kotlin, PHP, Ruby, Dart, Vue, and COBOL disposition and record evidence in `specs/008-lsp-client-integration/validation/slice-3.md` (Refs: specs/008-lsp-client-integration/validation/slice-3.md) |
| T095 | ✅ VERIFIED | [US4] Run bounded watch tests and record changed-file, cap, skip, and restart-budget evidence in `specs/008-lsp-client-integration/validation/slice-3.md` (Refs: specs/008-lsp-client-integration/validation/slice-3.md) |
| T096 | ✅ VERIFIED | [US4] Implement language and capability parity gate checks that fail on any unowned row in `scripts/spec-008-parity-gate.mjs` (Refs: scripts/spec-008-parity-gate.mjs) |
| T097 | ✅ VERIFIED | [US4] Record language parity rows for JavaScript, JSX, TypeScript, TSX, Python, Java, C, C++, C#, Go, Ruby, Rust, PHP, Kotlin, Swift, Dart, Vue, and COBOL with SPEC-008 or SPEC-024 validation boundaries in `specs/008-lsp-client-integration/validation/language-parity.md` (Refs: specs/008-lsp-client-integration/validation/language-parity.md) |
| T098 | ✅ VERIFIED | [P] [US4] Record capability parity rows for multi-phase graph pipeline, field/property binding, hybrid search, process groups, functional clusters, and blast-radius impact with SPEC-024 validation boundaries where future-owned in `specs/008-lsp-client-integration/validation/capability-parity.md` (Refs: specs/008-lsp-client-integration/validation/capability-parity.md) |
| T099 | ✅ VERIFIED | [P] [US4] Record capability parity rows for git diff impact, multi-file rename, raw Cypher queries, MCP resources, MCP prompts, and wiki generation with SPEC-024 validation boundaries where future-owned in `specs/008-lsp-client-integration/validation/capability-parity.md` (Refs: specs/008-lsp-client-integration/validation/capability-parity.md) |
| T100 | ✅ VERIFIED | [P] [US4] Record capability parity rows for multi-repo registry, repository groups, remote embeddings, installer setup/uninstall, agent skills/hooks, and analyzer operational flags with SPEC-024 validation boundaries where future-owned in `specs/008-lsp-client-integration/validation/capability-parity.md` (Refs: specs/008-lsp-client-integration/validation/capability-parity.md) |
| T101 | ✅ VERIFIED | [US4] Run parity gate positive and negative fixtures and record zero unowned language and capability rows in `specs/008-lsp-client-integration/validation/parity-gate.md` (Refs: specs/008-lsp-client-integration/validation/parity-gate.md) |
| T102 | ✅ VERIFIED | [US4] Run self-repo non-LSP dogfood with `node dist/bin/codegraph.js index` and record graph/provenance baseline evidence in `specs/008-lsp-client-integration/validation/self-repo-dogfood.md` (Refs: specs/008-lsp-client-integration/validation/self-repo-dogfood.md) |
| T103 | ✅ VERIFIED | [US4] Run self-repo explicit LSP dogfood with `node dist/bin/codegraph.js index --lsp` and record coverage, degradation, performance, and observed server evidence in `specs/008-lsp-client-integration/validation/self-repo-dogfood.md` (Refs: specs/008-lsp-client-integration/validation/self-repo-dogfood.md) |
| T104 | ✅ VERIFIED | [US4] Run self-repo `node dist/bin/codegraph.js status --json` after explicit LSP opt-in and record status evidence in `specs/008-lsp-client-integration/validation/self-repo-dogfood.md` (Refs: specs/008-lsp-client-integration/validation/self-repo-dogfood.md) |
| T105 | ✅ VERIFIED | [US4] Run and record representative small, medium, and large LSP-enabled validation evidence showing bounded completion or deterministic per-language skip/degrade reasons, no unbounded repository-wide LSP pass, no duplicate active-edge growth, retrieval sufficiency preservation, traceability, scope budget, parity closure, known gaps, rollback note, and review order in `specs/008-lsp-client-integration/validation/slice-3.md` (Refs: specs/008-lsp-client-integration/validation/slice-3.md) |
| T106 | ✅ VERIFIED | [P] Update SPEC-008 quickstart validation notes with final implemented command names and artifact paths in `specs/008-lsp-client-integration/quickstart.md` (Refs: specs/008-lsp-client-integration/quickstart.md) |
| T107 | ✅ VERIFIED | [P] Record README and CHANGELOG applicability decision without adding outbound links in `specs/008-lsp-client-integration/validation/final-packet.md` (Refs: specs/008-lsp-client-integration/validation/final-packet.md) |
| T108 | ✅ VERIFIED | Run `npm run build` and record output in `specs/008-lsp-client-integration/validation/final-packet.md` (Refs: specs/008-lsp-client-integration/validation/final-packet.md) |
| T109 | ✅ VERIFIED | Run `npm run typecheck` and record output in `specs/008-lsp-client-integration/validation/final-packet.md` (Refs: specs/008-lsp-client-integration/validation/final-packet.md) |
| T110 | ✅ VERIFIED | Run `npm test` and record output in `specs/008-lsp-client-integration/validation/final-packet.md` (Refs: specs/008-lsp-client-integration/validation/final-packet.md) |
| T111 | ✅ VERIFIED | Run `npm run build && npm run typecheck && npm test` and record output in `specs/008-lsp-client-integration/validation/final-packet.md` (Refs: specs/008-lsp-client-integration/validation/final-packet.md) |
| T112 | ✅ VERIFIED | Run `scripts/spec-008-validate-real-servers.mjs` and record final prerequisite status in `specs/008-lsp-client-integration/validation/final-packet.md` (Refs: scripts/spec-008-validate-real-servers.mjs, specs/008-lsp-client-integration/validation/final-packet.md) |
| T113 | ✅ VERIFIED | Run `scripts/spec-008-parity-gate.mjs` and record final zero-unowned-row status in `specs/008-lsp-client-integration/validation/final-packet.md` (Refs: scripts/spec-008-parity-gate.mjs, specs/008-lsp-client-integration/validation/final-packet.md) |
| T114 | ✅ VERIFIED | Generate final PR review packet with what changed, why, non-goals, review order, scope budget, traceability, verification evidence, representative small/medium/large validation evidence, known gaps, rollback notes, and feature-flag notes in `specs/008-lsp-client-integration/validation/final-packet.md` (Refs: specs/008-lsp-client-integration/validation/final-packet.md) |

## Unassessable Items

None.

## Mechanical Evidence

- Completed tasks parsed: 114 / 114.
- Missing referenced files: 0.
- Completed tasks with no branch-scope changed referenced file: 0.
- Branch changed files considered: 70.
- Repository shallow clone: false.

## Walkthrough

Interactive walkthrough was skipped because there are no flagged items.
