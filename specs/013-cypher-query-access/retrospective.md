---
feature: "SPEC-013 Cypher Query Access"
branch: "013-cypher-query-access"
date: "2026-07-30"
completion_rate: "100%"
spec_adherence: "97.6%"
counts:
  requirements_total: 42
  implemented: 40
  partial: 2
  modified: 0
  not_implemented: 0
  critical_findings: 0
  significant_findings: 2
  minor_findings: 1
  positive_findings: 3
---

# SPEC-013 Retrospective

## Executive Summary

SPEC-013 completed all 79 implementation tasks and delivered the planned
read-only Cypher surface across the package API, CLI, and MCP. Build,
typecheck, 4,839 full-suite tests, 183 focused tests, twelve live self-index
recipes, task verification, and the final independent review all passed.

Forty of 42 FR/SC requirements are fully satisfied. FR-030 and SC-009 are
partial only because the required external retrieval A/B evaluation remains
blocked behind explicit operator authorization; retrieval-guardian review
passed, and no provider was contacted. The resulting adherence score is:

`(40 implemented + 0 modified + (2 partial * 0.5)) / 42 = 97.6%`.

There are no critical findings or constitution violations. The primary
implementation drift is reviewability: the final seven-production-file change
contains 5,894 reviewable production LOC, and the private
`src/query/cypher/index.ts` is 4,765 lines, materially above the 675-LOC manual
planning estimate. The accepted one-PR route retains two internal slice
checkpoints and an ordered review guide.

## Proposed Spec Changes

None. The implementation findings do not require a `spec.md` edit. The
retrieval A/B item is an unfulfilled, authorization-gated pre-merge condition,
not a spec defect. Per the human gate, `spec.md` was not modified.

## Requirement Coverage Matrix

| Requirement | Status | Evidence |
|---|---|---|
| FR-001 | Implemented | Package, CLI, MCP routing, and explicit search escape hatch pass T031/T057/T070. |
| FR-002 | Implemented | 10,000-character ceiling and redacted `CYPHER_INPUT_TOO_LONG` pass cross-surface tests. |
| FR-003 | Implemented | Public virtual schema catalog and excluded storage-only fields are parser/runtime tested. |
| FR-004 | Implemented | Unknown and incorrectly cased names return stable diagnostics. |
| FR-005 | Implemented | Active static/LSP/heuristic edges are included and inactive suppressed edges are excluded. |
| FR-006 | Implemented | Exactly one connected chain is accepted; disconnected/comma/multi-MATCH forms are rejected. |
| FR-007 | Implemented | Incoming/outgoing directed relationships pass; undirected forms are rejected. |
| FR-008 | Implemented | Variable paths require valid explicit bounds and reject upper bounds above eight. |
| FR-009 | Implemented | Recursive traversal is relationship-simple while allowing repeated nodes. |
| FR-010 | Implemented | Ordered typed path values pass package, CLI, and MCP demonstrations. |
| FR-011 | Implemented | Null checks, three-valued boolean logic, comparisons, and null ordering are covered. |
| FR-012 | Implemented | `STARTS WITH`, `ENDS WITH`, and `CONTAINS` pass runtime and live demonstrations. |
| FR-013 | Implemented | Opaque JSON/array fields are return-only, safely converted, and rejected in predicates. |
| FR-014 | Implemented | Keywords are case-insensitive while public names remain case-sensitive. |
| FR-015 | Implemented | Backtick identifiers, doubled backticks, and invalid escape diagnostics are covered. |
| FR-016 | Implemented | Single-quoted literals are validated and emitted as bound SQL parameters. |
| FR-017 | Implemented | Scalar, node, relationship, path, alias, and supported count returns pass. |
| FR-018 | Implemented | Supported count forms and implicit grouping pass; unsupported aggregation is rejected. |
| FR-019 | Implemented | Explicit/default ordering, aliases, null placement, LIMIT, and stable repeats pass. |
| FR-020 | Implemented | Default/hard caps, cap-plus-one truncation, and 1 MiB payload rejection pass. |
| FR-021 | Implemented | Worker-enforced five-second deadline terminates timed-out work and permits a healthy follow-up. |
| FR-022 | Implemented | CLI failure exits and MCP success-shaped timeout/diagnostic mapping are byte-stable. |
| FR-023 | Implemented | Diagnostics carry bounded located excerpts without raw query, SQL, or parameter leakage. |
| FR-024 | Implemented | Read-only snapshots remain unchanged; mutating and direct-SQL forms are rejected before prepare. |
| FR-025 | Implemented | CLI positional/stdin Cypher routing, flag separation, malformed stdin, and search alias pass. |
| FR-026 | Implemented | CLI JSON and MCP text are byte-identical for every comparable required state and recipe. |
| FR-027 | Implemented | Human table rendering uses the shared public result adapter. |
| FR-028 | Implemented | `codegraph_query` is default-listed with expected-state shaping and explore-first guidance. |
| FR-029 | Implemented | Twelve documented recipes ran on the live self-index; ten returned rows and two truthful empty results. |
| FR-030 | Partial | Retrieval-guardian passed five checks; external A/B remains `BLOCKED_BY_AUTHORIZATION`, with runs=0, sends=0, cost=0. |
| FR-031 | Implemented | `queryCypher` and stable result/value types are exported; parser/planner/emitter internals remain private. |
| FR-032 | Implemented | Both bounded-path and aggregate/recipe vertical slices were independently demonstrated. |
| SC-001 | Implemented | Grammar and input-ceiling acceptance pass across package, CLI, and MCP. |
| SC-002 | Implemented | Bounded path query returns five deterministic rows with cross-surface parity. |
| SC-003 | Implemented | Count/grouping, string predicate, and backtick demonstrations pass. |
| SC-004 | Implemented | All twelve live recipes have reviewed output or a documented expected-empty reason. |
| SC-005 | Implemented | Syntax, names, read-only, input, cap, timeout, and location guardrails pass. |
| SC-006 | Implemented | Required CLI/MCP machine states are byte-identical with no trailing newline. |
| SC-007 | Implemented | Default 100 and hard 1,000 row caps expose deterministic truncation metadata. |
| SC-008 | Implemented | Timeout returns no partial rows within the fixed deadline and leaves no active worker. |
| SC-009 | Partial | Guardian review has no unaddressed regression; A/B awaits separately recorded authorization before merge. |
| SC-010 | Implemented | Live plans prove directional edge-index use and bounded path/order/group/cap behavior. |

## Success Criteria Assessment

| Result | Criteria | Assessment |
|---|---|---|
| Passed | SC-001–SC-008, SC-010 | Acceptance, parity, safety, boundedness, recipes, and performance evidence are complete. |
| Partial, pre-merge gate | SC-009 | Local retrieval review passed; external A/B cannot run without operator authorization. |

No success criterion failed. SC-009 must move from partial to passed before
merge if the operator authorizes the required off-box evaluation context.

## Architecture Drift

| Planned decision | Actual result | Drift | Severity |
|---|---|---|---|
| Dependency-free private lexer/parser/planner/emitter | Implemented under `src/query/cypher/`; no dependency added | None | — |
| Dedicated read-only SQLite worker boundary | Implemented with bounded termination/replacement and no migration/healing path | None | — |
| One canonical serializer for package/CLI/MCP | Implemented; CLI/MCP hashes match | None | — |
| Seven production files | Seven production files changed | None | — |
| 675 manual reviewable production LOC | 5,894 reviewable production LOC; `index.ts` is 4,765 lines | Material estimate miss; one-PR route retained with two checkpoints | SIGNIFICANT |
| One connected query and bounded path depth | Implemented, plus finite candidate-saturation budgets | Safety strengthened without public-scope expansion | POSITIVE |
| Retrieval A/B before merge | Guardian complete; external A/B not run without explicit authorization | Open pre-merge evidence gate | SIGNIFICANT |

## Significant Deviations

### SIGNIFICANT: Reviewability estimate was materially low

- Discovery point: implementation and independent post-review.
- Evidence: planned 675 manual reviewable LOC versus 5,894 actual production
  changed lines; `src/query/cypher/index.ts` is 4,765 lines.
- Cause: the estimate did not account for the full grammar, typed
  materialization, deterministic ordering, fixed/mixed/ranged plan lowering,
  aggregate lowering, and fail-closed saturation behavior.
- Impact: correctness is verified, but reviewer cognitive load is high.
- Prevention: future language-runtime plans should estimate lexer, parser,
  semantic planner, SQL emitter, public materializer, and safety-budget logic
  separately, then run the reviewability helper again after the RED tests fix
  the true semantic surface.

### SIGNIFICANT: Retrieval A/B remains authorization-gated

- Discovery point: planned T069 runtime authorization gate.
- Evidence: FR-030 and SC-009 remain `BLOCKED_BY_AUTHORIZATION`; provider,
  endpoints, repository context, retention/training policy, budget, and
  approval timestamp were never authorized.
- Cause: privacy policy correctly prevents inferring off-box consent from
  scaffold, bootstrap, or local dogfood approval.
- Impact: the draft PR is reviewable, but this requirement remains a merge
  prerequisite if authorization is granted.
- Prevention: request the complete evaluation authorization packet before the
  final implementation slice when external evidence is expected.

### MINOR: Generated UAT skeleton was unavailable

- Discovery point: post-implementation UAT gate.
- Evidence: `generate-uat-skeleton` is deferred and no committed skeleton
  exists.
- Cause: helper capability was unavailable in this installation.
- Impact: no product evidence gap; the quickstart, live self-index evidence,
  and packet-owned manual UAT steps remain executable.
- Prevention: make UAT skeleton availability a preflight capability check.

## Innovations and Best Practices

### POSITIVE: Fail-closed candidate saturation

The final implementation adds deterministic finite expansion budgets and
`CYPHER_PATH_EXPANSION_LIMIT`. Boundary tests prove success at 16,000
nonaggregate and 48,000 aggregate candidates, with no partial rows above the
budget. This pattern is reusable for future graph traversals.

### POSITIVE: Private saturation sentinel

A private sentinel survives zero-group aggregate cases, is removed before
projection, and does not consume public cap-plus-one rows. This provides a
reusable separation between internal safety evidence and public result
semantics.

### POSITIVE: Cross-surface canonical evidence

One serializer and hash-based package/CLI/MCP recipe probes made parity
observable rather than inferred. Reuse this approach for future multi-surface
features with machine-readable outputs.

None of these innovations currently requires a constitution amendment; they
fit Principles IV, VI, and VII.

## Constitution Compliance

| Principle | Status | Evidence |
|---|---|---|
| I. Think Before Coding | PASS | Design concept, clarification, research, contracts, plan, checklists, and RED tests preceded implementation. |
| II. Simplicity First | PASS | No dependency, general SQL, write path, configurable limits, or speculative public API was added. |
| III. Surgical Changes | PASS | Product behavior is isolated to seven production files with narrow CLI/MCP/library integration. |
| IV. Goal-Driven Execution | PASS | 79/79 tasks are verified; FR/SC evidence and live UAT are durable. |
| V. Deterministic, LLM-Free Extraction | PASS | Queries read deterministic stored graph records; no LLM generates graph structure. |
| VI. Retrieval Performance Is a Regression Surface | PASS with open pre-merge gate | Guardian passed; off-box A/B remains blocked rather than bypassing authorization. |
| VII. Local-First, Private, Zero Native Dependencies | PASS | No dependency or network call; dedicated read-only SQLite access leaves schema/data unchanged. |
| Fork and ecosystem constraints | PASS | Changes target `origin`; no upstream push, release, tag, or manual publish occurred. |
| Quality gates and workflow | PASS | TDD slices, build, typecheck, full tests, review, task verification, PR packet, and monitoring ran. |
| Binding dogfooding | PASS | Existing live self-index was healthy and exercised through package, CLI, MCP, recipes, and plan probes. |

Constitution violations: None.

## Unspecified Implementations

| Item | Classification | Rationale |
|---|---|---|
| `CYPHER_PATH_EXPANSION_LIMIT` and finite candidate budgets | POSITIVE | Behavior-preserving safety completion needed to make path bounds fail closed. |
| Codepoint comparator and explicit null-last tuple parity | POSITIVE | Deterministic ordering detail required to satisfy existing FR-019/FR-026 semantics. |
| MCP allowlist/rename regression updates | MINOR | Supporting tests keep existing MCP contracts accurate after adding a default-listed tool. |
| PR packet, validation, workflow state, and retrospective artifacts | Process | Required SpecKit delivery evidence, not product scope. |

No unspecified public capability, dependency, network integration, schema
mutation, or write-capable query feature was added.

## Task Execution Analysis

- Completion: 79/79 tasks, 100%.
- Fidelity: every completed task has implementation or verification evidence;
  the fresh phantom check reports 79 VERIFIED and zero partial, weak,
  not-found, skipped, or flagged tasks.
- Route: one navigable PR with two internal slice checkpoints, as selected at
  G5.
- Review: 18 findings were closed with regression coverage; the final
  independent review returned `NO FINDINGS`.
- Verification: build and typecheck passed; 266 test files and 4,839 tests
  passed; the final focused bundle passed 183/183.
- Blockers: only the explicitly authorization-gated external retrieval A/B
  evaluation remains open.

## Lessons Learned and Recommendations

1. HIGH — Decompose language-runtime LOC estimates by compiler stage and
   safety layer; rerun reviewability after RED tests expose the real surface.
2. HIGH — Collect external-evaluation authorization details before the final
   slice when a pre-merge A/B artifact is expected.
3. MEDIUM — Preserve candidate-budget boundary tests and the private sentinel
   pattern for future recursive graph features.
4. MEDIUM — Keep canonical hash probes for every machine-output surface and
   every documented live recipe.
5. LOW — Check UAT skeleton helper availability during post-gate preflight and
   fall back explicitly to the quickstart when unavailable.
6. LOW — For installed SpecKit helpers in linked worktrees, verify the helper's
   resolved repository root before mutation-mode operations.

## File Traceability Appendix

| Concern | Primary files |
|---|---|
| Lexer, parser, semantics, planning, SQL, path budgets, materialization | `src/query/cypher/index.ts` |
| Read-only SQLite worker and deadline | `src/query/cypher/runtime.ts` |
| Canonical JSON and table adapter | `src/query/cypher/serializer.ts` |
| Public API and types | `src/index.ts` |
| CLI routing, stdin bounds, exits, tables | `src/bin/codegraph.ts` |
| MCP tool, shaping, allowlist | `src/mcp/tools.ts` |
| Explore-first MCP guidance | `src/mcp/server-instructions.ts` |
| Parser coverage | `__tests__/cypher-parser.test.ts` |
| Runtime, SQL, ordering, caps, safety | `__tests__/cypher-runtime.test.ts` |
| CLI behavior and byte output | `__tests__/cli-query-command.test.ts` |
| MCP behavior and byte output | `__tests__/mcp-cypher-query.test.ts` |
| Live recipes and parity | `__tests__/cypher-recipes.test.ts`, `docs/ai/specs/013-cypher-query-access-recipes.md` |
| Requirement and task evidence | `specs/013-cypher-query-access/evidence-matrix.md`, `verify-tasks-report.md` |
| Delivery packet | `specs/013-cypher-query-access/.process/pr-packets/spec-013-cypher-query-access.json` |

## Self-Assessment Checklist

| Check | Result | Evidence |
|---|---|---|
| Evidence completeness | PASS | Each deviation cites a task, file, metric, behavior, or durable artifact. |
| Coverage integrity | PASS | FR-001–FR-032 and SC-001–SC-010 all appear in the coverage matrix. |
| Metrics sanity | PASS | 79/79 = 100%; `(40 + 2*0.5) / 42 = 97.6%`. |
| Severity consistency | PASS | Open pre-merge/reviewability issues are significant; safety improvements are positive; missing helper is minor. |
| Constitution review | PASS | Every principle and binding dogfood rule is assessed; violations are explicitly `None`. |
| Human Gate readiness | PASS | Proposed Spec Changes is `None`; no `spec.md` modification was attempted. |
| Actionability | PASS | Six prioritized recommendations map directly to the findings. |

Retrospective saved | Adherence: 97.6% | Critical findings: 0
