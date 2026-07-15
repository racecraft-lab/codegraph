# Implementation Plan: PR Blast-Radius Review Action

**Branch**: `020-pr-blast-radius-review-action` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/020-pr-blast-radius-review-action/spec.md`

## Summary

Build a reusable GitHub composite action under `actions/pr-impact/` that restores and validates a CodeGraph index cache, rebuilds when needed, runs SPEC-012 `detect-changes --mode base-ref`, publishes one deterministic pull-request blast-radius report, applies only configured threshold failures, and safely suppresses privileged delivery or SPEC-018 narrative on untrusted runs.

The implementation keeps detector JSON authoritative. The action wrapper interprets detector statuses and exit codes, owns delivery state, and appends optional prose-only narrative after the final deterministic conclusion is fixed.

## Technical Context

**Language/Version**: TypeScript strict mode on Node `>=20 <25`; implementation and local validation use the repository-pinned Node 24.11.1.

**Primary Dependencies**: Existing CodeGraph package, SPEC-012 `src/analysis/detect-changes/*`, SPEC-018 `src/llm/*`, Node built-ins, GitHub Actions runtime contexts, GitHub REST API via `fetch`, `actions/cache`, and `actions/upload-artifact`.

**Storage**: Local CodeGraph index under `.codegraph/`; GitHub Actions cache stores `.codegraph/` only after validation metadata proves it belongs to the current comparison identity.

**Testing**: Vitest (`npm test`) with focused fixtures for action contract, detector-result matrix, cache validation, fork/trust behavior, comment delivery, narrative degradation, and generated runtime freshness. Full phase gates: `npm run build`, `npm run typecheck`, and `npm test`.

**Target Platform**: GitHub-hosted Linux pull-request workflows; no other CI vendors in v1. The action must also be dogfooded on this repository through `.github/workflows/pr-impact.yml`.

**Project Type**: Node/TypeScript library, CLI, MCP server, and GitHub Actions harness/adapter.

**Performance Goals**: Median warm-cache completion for CodeGraph self-repository PR runs is ≤3 minutes across at least five eligible samples with thresholds unset and narrative disabled.

**Constraints**: Deterministic detector facts and exit codes are canonical; no `pull_request_target` execution of untrusted PR code; fork-like runs receive no secret-backed narrative or write-comment assumption; cache is an optimization only; narrative is off by default and prose-only; do not widen beyond the one-spec Q9 decision.

**Scale/Scope**: Greenfield action adapter centered on approximately four production files and eleven total files. Reviewability projection is 455 LOC from Grill Me and 405 LOC from roadmap setup, which is a warning accepted by the maintainer rather than a split mandate.

**Reviewability Budget**: Primary surface: harness/adapter. Secondary surfaces: seed/config and docs/process. Budget result: warning accepted. The plan keeps one spec, minimizes production files, and carries reviewability checks through tasks and pre-PR gates.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Plan Alignment | Status |
|-----------|----------------|--------|
| I. Think Before Coding | Clarify captured runtime, cache, trust, delivery, conclusion, narrative, and performance decisions before implementation. | PASS |
| II. Simplicity First | One composite action plus one helper; no additional CI vendors, policy engines, provider framework, or speculative inputs. | PASS |
| III. Surgical Changes | New files stay centered on `actions/pr-impact/`, `.github/workflows/pr-impact.yml`, focused tests, docs, and changelog. SPEC-012/SPEC-018 internals change only if a contract test proves a gap. | PASS |
| IV. Goal-Driven Execution | Tasks must start with failing fixtures for action contract, result matrix, cache, fork, delivery, narrative, and dogfood behavior. | PASS |
| V. Deterministic Graph Authority | `detect-changes` JSON and markdown remain canonical; narrative appends prose only after deterministic conclusion is fixed. | PASS |
| VI. Retrieval Performance Regression Surface | The action reports bounded callers, affected flows, risks, warnings, and limits without changing retrieval semantics. | PASS |
| VII. Local-First, Private, Zero Native Dependencies | Narrative is dormant by default, fork runs do not receive secrets, and no new native runtime dependency is introduced. | PASS |
| Dogfooding | `.github/workflows/pr-impact.yml` validates the action on CodeGraph PRs in advisory mode. | PASS |

**Post-design re-check**: PASS. Design artifacts preserve the same boundaries and add no constitutional violations.

## Project Structure

### Documentation (this feature)

```text
specs/020-pr-blast-radius-review-action/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── action-contract.md
│   ├── result-matrix.md
│   └── report-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
actions/pr-impact/
├── action.yml             # Public composite action inputs, outputs, and steps
├── run.ts                 # Source for orchestration helper
└── dist/
    └── run.mjs            # Generated action runtime artifact, freshness-tested

__tests__/
├── pr-impact-action-contract.test.ts
├── pr-impact-cache.test.ts
├── pr-impact-delivery.test.ts
├── pr-impact-result-matrix.test.ts
├── pr-impact-narrative.test.ts
└── pr-impact-runtime-freshness.test.ts

.github/workflows/
└── pr-impact.yml          # Advisory self-repository dogfood workflow

CHANGELOG.md              # User-facing Unreleased bullet
```

**Structure Decision**: Use a composite action because the roadmap requires checkout/setup/cache/report steps as an action-level integration. Keep the non-trivial orchestration in a compiled helper generated from `run.ts`; tests enforce that `dist/run.mjs` is fresh and that users never execute uncompiled TypeScript.

## Declared File Operations

- NEW actions/pr-impact/action.yml
- NEW actions/pr-impact/run.ts
- NEW actions/pr-impact/dist/run.mjs
- NEW .github/workflows/pr-impact.yml
- MODIFIED package.json
- MODIFIED CHANGELOG.md

Additional planned test/design files are listed in the project structure above.
The authoritative roadmap projection remains approximately 4 production files
and 11 total files; this parseable list captures the production and
package-visible surface for the runner estimator.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Reviewability warning accepted at 455 projected LOC | The maintainer selected one SPEC-020 scope in Q9 to keep advisory reporting, threshold policy, safe fallback, cache validation, optional narrative, and dogfood as one review unit. | Splitting into two specs was recommended by the estimator but explicitly declined; the mitigation is a minimal adapter surface plus reviewability gates at plan, tasks, and pre-PR. |

## Reviewability Gate Fields

Primary surface: harness/adapter

Projected reviewable LOC: 455

Projected production files: 4

Projected total files: 11

Budget result: warning accepted; no blocker.

## Implementation Setup Reviewability Check

T007 setup verification keeps the one-spec Q9 decision intact:

- Primary production surface remains `actions/pr-impact/`.
- Package visibility is limited to exposing the existing package plus the new `actions` directory.
- Initial setup files match the planned scaffold: `actions/pr-impact/action.yml`, `actions/pr-impact/run.ts`, `actions/pr-impact/dist/run.mjs`, `__tests__/fixtures/pr-impact.ts`, and `package.json`.
- The accepted reviewability warning remains 455 projected reviewable LOC, 4 production files, and 11 total files. No blocker has been introduced during setup.
