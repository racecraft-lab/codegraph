# Verify Tasks Report: SPEC-014 Control-Flow Graphs

Generated: 2026-07-26
Scope: all completed tasks in `specs/014-control-flow-graphs/tasks.md`
Extension: installed `$speckit-verify-tasks`

> ⚠️ **FRESH SESSION ADVISORY**: For maximum reliability, run `/speckit.verify-tasks`
> in a **separate** agent session from the one that performed `/speckit.implement`.
> The implementing agent's context biases it toward confirming its own work.

## Summary Scorecard

| Verdict | Count |
| --- | ---: |
| ✅ VERIFIED | 43 |
| 🔍 PARTIAL | 0 |
| ⚠️ WEAK | 0 |
| ❌ NOT_FOUND | 0 |
| ⏭️ SKIPPED | 0 |

## Flagged Items

None.

## Verified Items

| Task ID | Verdict | Summary |
| --- | --- | --- |
| T001 | ✅ VERIFIED | Reviewability checkpoint and full-gate plan are recorded in `tasks.md`. |
| T002 | ✅ VERIFIED | TypeScript/JavaScript CFG fixtures exist under `__tests__/analysis/cfg/fixtures/tsjs/`. |
| T003 | ✅ VERIFIED | Python CFG fixtures exist under `__tests__/analysis/cfg/fixtures/python/`. |
| T004 | ✅ VERIFIED | CFG schema, migration, and lifecycle tests exist for status/block/edge persistence. |
| T005 | ✅ VERIFIED | Source and shipped schema assets contain CFG tables/indexes/triggers. |
| T006 | ✅ VERIFIED | CFG opt-in and disabled dormancy are implemented and covered by lifecycle tests. |
| T007 | ✅ VERIFIED | Public CFG types and guards are exported and tested. |
| T008 | ✅ VERIFIED | Shared source-version, status, paging, safe-message, and payload guards are present and tested. |
| T009 | ✅ VERIFIED | TypeScript/JavaScript CFG vertical path and `CodeGraph.getCfg` are present and tested. |
| T010 | ✅ VERIFIED | Deterministic IDs/order and repeated re-index behavior are covered. |
| T011 | ✅ VERIFIED | Unsupported/parser/unsafe skip states are implemented and tested. |
| T012 | ✅ VERIFIED | Block-limit resource cap and payload-free resource-limited state are implemented and tested. |
| T013 | ✅ VERIFIED | Explicit throw and try/finally routing are implemented and tested. |
| T014 | ✅ VERIFIED | TypeScript/JavaScript short-circuit, ternary, optional-chain, and nullish flow are implemented and tested. |
| T015 | ✅ VERIFIED | TypeScript/JavaScript switch, fallthrough, break/continue, and label safety are implemented and tested. |
| T016 | ✅ VERIFIED | Nested boundaries, identity handling, unreachable blocks, and no-op graphs are implemented and tested. |
| T017 | ✅ VERIFIED | First-enable backfill with empty change set is covered. |
| T018 | ✅ VERIFIED | Affected-file transactional replacement and unaffected-file retention are covered. |
| T019 | ✅ VERIFIED | Deleted file/function tombstones and never-seen unknown reads are covered. |
| T020 | ✅ VERIFIED | Disabled reads/sync dormancy and re-enable refresh behavior are covered. |
| T021 | ✅ VERIFIED | First-refresh failure and retained-stale failure behavior are covered. |
| T022 | ✅ VERIFIED | Caller cancellation before/after swap is covered. |
| T023 | ✅ VERIFIED | Source-version freshness and contract mismatch stale projection are covered. |
| T024 | ✅ VERIFIED | CLI JSON parity with `CodeGraph.getCfg` is implemented and tested. |
| T025 | ✅ VERIFIED | CLI human output and expected-state exit behavior are implemented and tested. |
| T026 | ✅ VERIFIED | `codegraph_get_cfg` MCP schema and success-shaped expected states are implemented and tested. |
| T027 | ✅ VERIFIED | MCP pagination defaults, clamps, totals, and reconstruction are implemented and tested. |
| T028 | ✅ VERIFIED | Aggregate top-level CFG status is implemented and tested. |
| T029 | ✅ VERIFIED | Cross-surface expected-state parity matrix is implemented and tested. |
| T030 | ✅ VERIFIED | MCP server guidance for bounded CFG reads is present. |
| T031 | ✅ VERIFIED | Self-repo TypeScript/JavaScript UAT runbook/probe evidence is present. |
| T032 | ✅ VERIFIED | Deterministic Python lambda identity is implemented and tested. |
| T033 | ✅ VERIFIED | Python branches, loops, raise, nested boundaries, and unreachable blocks are implemented and tested. |
| T034 | ✅ VERIFIED | Python `match`/`case` source-order and guarded-case flow are implemented and tested. |
| T035 | ✅ VERIFIED | Python comprehensions and generator expressions are implemented and tested. |
| T036 | ✅ VERIFIED | Python `await`, `yield`, and `yield from` ordinary-operation behavior is implemented and tested. |
| T037 | ✅ VERIFIED | Python library/CLI/MCP/status/determinism parity is implemented and tested. |
| T038 | ✅ VERIFIED | Python parity UAT evidence and runbook updates are present. |
| T039 | ✅ VERIFIED | CFG performance benchmark harness and recorded evidence are present. |
| T040 | ✅ VERIFIED | Final build, focused CFG suites, typecheck, full suite, and diff-check evidence are recorded. |
| T041 | ✅ VERIFIED | Retrieval-guardian evidence for MCP/tool guidance changes is recorded. |
| T042 | ✅ VERIFIED | PR review packet requirements are recorded in the quickstart packet. |
| T043 | ✅ VERIFIED | Final reviewability re-check is recorded with size-only block and marker-split route. |

## Unassessable Items

None.

## Layer Checks

| Layer | Result | Evidence |
| --- | --- | --- |
| File existence | PASS | 20/20 unique task-referenced paths exist; `CodeGraph.getCfg` was treated as a symbol reference, not a file path. |
| Git diff cross-reference | PASS | 18/20 referenced paths are changed in `origin/main...HEAD`; unchanged `dist/db/schema.sql` and `package.json` are expected generated/command-surface references. |
| Content pattern matching | PASS | CFG tables, migrations, library API, CLI command, MCP tool, status surface, fixtures, and benchmark harness are present in referenced files. |
| Dead-code detection | PASS | No task-owned source symbols were found as isolated stubs; authoritative build/typecheck/test gate follows this report. |
| Semantic assessment | PASS | Completed task FR tags cover all 34 functional requirements and all 4 user stories. |

## Walkthrough

✅ No flagged items — verification complete.
