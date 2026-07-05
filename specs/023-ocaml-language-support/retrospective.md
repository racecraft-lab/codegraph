---
feature: "SPEC-023 - OCaml Language Support"
branch: "023-ocaml-language-support"
date: "2026-07-05"
completion_rate: 100
spec_adherence: 97.8
tasks:
  total: 74
  completed: 74
  verified: 74
requirements:
  total: 23
  implemented: 22
  partial: 1
  modified: 0
  unspecified: 0
findings:
  critical: 0
  significant: 2
  minor: 2
  positive: 3
---

# Retrospective: SPEC-023 - OCaml Language Support

## Executive Summary

SPEC-023 is locally implemented and verified for grammar distribution, OCaml
status reporting, extraction, conservative Dune-scoped resolution, PPX
non-expansion, fixtures, docs, real-repository smoke, deterministic probes, and
existing-language controls. The task ledger is complete: 74 of 74 tasks are
marked complete and verify-tasks confirmed 74 verified items, 0 partial, 0 weak,
0 not found, and 0 skipped.

The implementation should not yet be described as fully complete. SC-003 remains
partial until the recorded Dune A/B follow-up gate closes or the maintainer
explicitly replaces that acceptance gate. Final reviewability also blocks as one
PR by size, so the generated final-reviewability and dry-run slice artifacts
must be used before publication.

## Proposed Spec Changes

None.

The current spec already permits Dune A/B to split behind an explicit follow-up
gate before SPEC-023 completion. No `spec.md` edit, `/speckit.specify` handoff,
or acceptance-criteria rewrite is proposed by this retrospective.

## Requirement Coverage Matrix

| ID | Status | Evidence |
|----|--------|----------|
| FR-001 | Implemented | `.ml` and `.mli` language coverage in `src/types.ts`, `src/extraction/grammars.ts`, parser/status tests. |
| FR-002 | Implemented | OCaml status tests and Yojson, OCaml-LSP, Dune smoke records report OCaml language presence. |
| FR-003 | Implemented | OCaml extractor plus broad syntax fixtures cover modules, signatures, functors, types, records, variants, values, functions, classes, methods, fields, and interface declarations. |
| FR-004 | Implemented | Extraction tests and `validation/extraction.md` cover source spans and containment. |
| FR-005 | Implemented | Extraction tests cover labeled arguments, optional arguments, pattern-heavy bindings, and nearest-owner fallback behavior. |
| FR-006 | Implemented | OCaml resolver tests cover module paths, functors, opens, includes, and unique-only local relationships. |
| FR-007 | Implemented | Interface pairing constraints are implemented in `src/resolution/ocaml-resolver.ts` and tested. |
| FR-008 | Implemented | `src/resolution/ocaml-workspace.ts` uses checked-in Dune/opam metadata only for local constraints. |
| FR-009 | Implemented | Negative resolution and PPX tests prove ambiguity, external packages, PPX, and functor elaboration fail closed. |
| FR-010 | Implemented | Vendored `tree-sitter-ocaml@0.24.2` implementation/interface WASMs are copied by build and tested. |
| FR-011 | Implemented | Parser, status, extraction, resolution, and PPX fixtures cover required constructs and relationships. |
| FR-012 | Implemented | Yojson, OCaml-LSP, and Dune smoke records include URL, commit, status, graph counts, stability, and probe outcomes. |
| FR-013 | Implemented with gate | Nine deterministic probes are recorded; Yojson and OCaml-LSP A/B records exist; Dune A/B is explicitly gated before completion in `validation/dune-ab-gate.md`. |
| FR-014 | Implemented | `ppx-policy.md`, PPX tests, README, and PR packet document PPX unsupported/future-work status. |
| FR-015 | Implemented | Build, typecheck, full tests, targeted tests, self-repo smoke, and local current-vs-baseline existing-language control passed. |
| FR-016 | Implemented | Yojson, OCaml-LSP, and Dune smoke records include stable repeated graph counts. |
| FR-017 | Implemented with publication caveat | Implementation slices, final reviewability backstop, and dry-run emission artifacts exist; single-PR reviewability remains blocked by size. |
| SC-001 | Implemented | Required OCaml fixture constructs pass targeted extraction/resolution/PPX tests. |
| SC-002 | Implemented | Yojson, OCaml-LSP, and Dune index successfully with OCaml status and stable graph counts. |
| SC-003 | Partial | Deterministic probes and Yojson/OCaml-LSP A/B exist, but Dune A/B remains a required follow-up gate before SPEC-023 completion. |
| SC-004 | Implemented | Ambiguous module/package/PPX cases produce no speculative relationships in negative tests. |
| SC-005 | Implemented | `npm run build`, `npm run typecheck`, targeted OCaml tests, and `npm test` passed; copied WASM checks passed. |
| SC-006 | Implemented | PR packet traceability maps FR/SC coverage, evidence, known gaps, rollback, and deferred work. |

## Success Criteria Assessment

| Criterion | Result | Notes |
|-----------|--------|-------|
| SC-001 | Pass | Targeted OCaml suite passed: 5 files, 11 tests. |
| SC-002 | Pass | Yojson, OCaml-LSP, and Dune smoke records are complete with repeated stability. |
| SC-003 | Partial | Dune deterministic smoke/probes passed, but large-repo Dune A/B is still an explicit follow-up gate. |
| SC-004 | Pass | Negative resolution and PPX policy tests cover no speculative edge behavior. |
| SC-005 | Pass | Build, typecheck, full test suite, targeted tests, and copied artifact checks passed. |
| SC-006 | Pass | PR packet traceability is populated and names the Dune A/B and reviewability gaps. |

## Architecture Drift

| Area | Planned | Actual | Severity |
|------|---------|--------|----------|
| Public language model | One public `ocaml` language token with internal grammar selection by extension. | Implemented through grammar metadata and parser path selection. | Positive |
| Extractor scope | New OCaml extractor and fixtures for broad syntax. | Implemented as `src/extraction/languages/ocaml.ts` plus focused fixture/test coverage. | None |
| Resolution scope | Conservative Dune-scoped local relationships only. | Implemented through OCaml-specific workspace/resolver modules and unique-only tests. | None |
| PPX handling | Parse/preserve syntax only; no expansion or generated relationships. | Implemented and validated through PPX negative fixtures. | None |
| Existing-language control | Run an existing-language A/B only if shared behavior changed. | Shared paths changed; external Claude A/B was policy-blocked, so a local-only current-vs-baseline deterministic control replaced it. | Minor |
| Reviewability | Split-ready work, projected 10-16 total files. | Final gate reports 987 reviewable LOC, 16 production files, 80 total files; final backstop proceeds through a maintainer-authorized infra exception. | Significant |

## Significant Deviations

### SIGNIFICANT: Dune A/B remains open

Evidence: `validation/dune-ab-gate.md` records Dune A/B as a follow-up gate that
still blocks SPEC-023 completion. This is not a skipped task: T056 explicitly
allowed either Dune A/B evidence or an explicit gate, and the task is verified.
The completion claim must remain bounded until that gate closes.

Root cause: the large-repository A/B path depends on external Claude harness
execution and safe evaluation constraints.

Prevention: keep large-corpus A/B gates separate from code-complete claims, and
start harness safety checks before the implementation phase on future language
support specs.

### SIGNIFICANT: Single-PR reviewability blocks by size

Evidence: final reviewability reports `status=block`, `reviewable_loc=987`,
`production_files=16`, `total_files=80`, and `primary_surface_count=5`.
After commit `267d25e`, the final-reviewability backstop accepted
`Reviewability-Exception: infra` from `implementation-slices.md` and returned
`status=exception` with no blocked PR operations.

Root cause: the clarified OCaml scope required grammar assets, broad extraction,
conservative resolution, PPX boundary tests, real-repo validation, and PR packet
evidence in one local branch.

Prevention: split earlier when language support spans extractor, resolver,
fixtures, docs, and eval; reserve typed exceptions for explicit operator-owned
closeout decisions.

### MINOR: External existing-language A/B was policy-blocked

Evidence: `validation/existing-language-ab-gate.md` records the rejected
external-agent run and the local-only current-vs-baseline replacement. The
replacement control passed for parser selection and TypeScript import-resolution
surfaces.

Impact: no known correctness regression, but the evidence is deterministic local
comparison rather than an external agent behavior A/B.

### MINOR: Headless A/B adoption is weak

Evidence: Yojson exposed CodeGraph but Claude did not select it. OCaml-LSP used
CodeGraph in one exact with-arm run but still needed Read/Grep; the safer second
run also did not select CodeGraph.

Impact: OCaml indexing and deterministic probes are useful, but the agent-facing
retrieval adoption signal is not yet a zero-Read/zero-Grep pass.

## Innovations and Best Practices

### POSITIVE: Internal grammar selection preserves public API simplicity

The implementation supports both `.ml` and `.mli` grammar artifacts while keeping
one public `ocaml` language token. This avoids leaking an `ocaml_interface`
language into user-facing status or APIs.

### POSITIVE: OCaml-specific resolver modules limit shared-surface churn

OCaml workspace and resolver behavior live in new OCaml-specific files, while
shared resolver changes are limited to narrow integration points.

### POSITIVE: Final reviewability artifacts preserve the exception audit trail

The final-reviewability state records both the size failure and the accepted
operator-owned infra exception, so the PR does not hide the size risk.

## Constitution Compliance

| Principle | Result | Evidence |
|-----------|--------|----------|
| I. Think Before Coding | Pass | Clarify resolved grammar, syntax breadth, resolution scope, PPX policy, and validation corpus before implementation. |
| II. Simplicity First | Pass with size risk | Scope excludes PPX expansion, external package edges, package nodes, and typechecker-grade semantics; reviewability size remains a publication risk. |
| III. Surgical Changes | Pass with shared-file caution | Shared edits are limited to language/grammar/parser/resolver registration, with OCaml logic in new files. |
| IV. Goal-Driven Execution | Pass | 74/74 tasks verified; build, typecheck, targeted tests, full tests, probes, and smoke evidence are recorded. |
| V. Deterministic, LLM-Free Extraction | Pass | Graph behavior derives from tree-sitter/static metadata; ambiguity and PPX fail closed. |
| VI. Retrieval Performance Is a Regression Surface | Pass with follow-up | Deterministic probes and controls passed; Dune A/B and weak adoption remain follow-up risks. |
| VII. Local-First, Private, Zero Native Dependencies | Pass | OCaml support ships as vendored WASM assets; no native runtime dependency or runtime network behavior was added. |

Constitution violations: None.

## Unspecified Implementations

- Extension-aware internal grammar selection was an implementation detail needed
  to keep `.mli` support behind the single public `ocaml` language.
- The local-only existing-language current-vs-baseline control was a process
  replacement for an external-agent run rejected by policy, not a product
  feature.
- The final-reviewability typed exception was an operator-owned process decision
  to close the autopilot after the gate proved the remaining blocker was size,
  not correctness.

These are bounded process or implementation details and do not require spec
changes.

## Task Execution Analysis

- Total tasks: 74.
- Completed tasks: 74.
- Completion rate: 100%.
- Verify-tasks result: 74 verified, 0 partial, 0 weak, 0 not found, 0 skipped.
- Major verification commands recorded: `npm run build`, `npm run typecheck`,
  targeted OCaml vitest suite, and `npm test`.
- Marker scan result: 0 gaps, 0 clarifications, 0 critical, 0 high, 0 medium,
  and 0 low markers.
- Autopilot phase coverage guard: pass with 38 plan steps.

## Lessons Learned and Recommendations

1. Close Dune A/B before calling SPEC-023 complete or archiving it as complete.
2. Present the PR as an exception-backed single PR; do not describe it as a clean
   reviewability size pass.
3. Treat weak CodeGraph tool adoption as a separate retrieval-sufficiency follow
   up, not as evidence that OCaml indexing or deterministic probes failed.
4. For future language-support specs, check external-agent harness safety during
   validation setup so A/B feasibility is known before the final evidence gate.

## File Traceability Appendix

Primary implementation:

- `src/types.ts`
- `src/extraction/grammars.ts`
- `src/extraction/tree-sitter.ts`
- `src/extraction/languages/index.ts`
- `src/extraction/languages/ocaml.ts`
- `src/extraction/wasm/tree-sitter-ocaml.wasm`
- `src/extraction/wasm/tree-sitter-ocaml_interface.wasm`
- `src/resolution/import-resolver.ts`
- `src/resolution/index.ts`
- `src/resolution/ocaml-resolver.ts`
- `src/resolution/ocaml-workspace.ts`

Primary verification:

- `__tests__/ocaml-parser-health.test.ts`
- `__tests__/ocaml-status.test.ts`
- `__tests__/ocaml-extraction.test.ts`
- `__tests__/ocaml-resolution.test.ts`
- `__tests__/ocaml-ppx-policy.test.ts`
- `specs/023-ocaml-language-support/validation/`
- `specs/023-ocaml-language-support/verify-tasks-report.md`

Primary process and reviewability records:

- `specs/023-ocaml-language-support/implementation-slices.md`
- `specs/023-ocaml-language-support/validation/pr-packet-traceability.md`
- `specs/023-ocaml-language-support/.process/final-reviewability/`

## Self-Assessment Checklist

- Evidence completeness: PASS. Major deviations cite concrete files, commands,
  or measured gate outputs.
- Coverage integrity: PASS. FR-001 through FR-017 and SC-001 through SC-006 are
  listed with no missing IDs.
- Metrics sanity: PASS. Completion rate is 74/74 = 100%; spec adherence is
  `(22 implemented + 0.5 partial) / 23 = 97.8%`.
- Severity consistency: PASS. Open Dune A/B and size-blocked reviewability are
  significant; external A/B policy replacement and weak adoption are minor.
- Constitution review: PASS. No violations found; residual risks are listed.
- Human Gate readiness: PASS. No spec changes are proposed, so no spec-modifying
  confirmation is required.
- Actionability: PASS. Follow-ups are tied to Dune A/B, reviewability slicing,
  retrieval adoption, and future harness setup.
