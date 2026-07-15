# Implementation Plan: Change Impact Detection

**Branch**: `012-change-impact-detection` | **Date**: 2026-07-15 | **Spec**: `specs/012-change-impact-detection/spec.md`

**Input**: Feature specification from `specs/012-change-impact-detection/spec.md`

## Summary

Add a local-first `detect-changes` capability that converts supported git diffs into directly changed CodeGraph symbols, unmapped diagnostics, bounded upstream callers, optional SPEC-011 affected flows, stable JSON/markdown output, and deterministic CLI/MCP exit semantics.

The implementation uses one deterministic engine under `src/analysis/detect-changes/`; CLI and MCP are thin adapters over the same report model. Work is split into two vertical slices to honor the setup reviewability warning and keep review focused.

## Technical Context

**Language/Version**: TypeScript on Node.js; project commands use Node `v24.11.1` from `.nvmrc` during this run.

**Primary Dependencies**: Existing CodeGraph library, SQLite query layer, Commander CLI, MCP tool handler, local `git` executable. No new runtime dependency is planned.

**Storage**: Existing `.codegraph/` SQLite index, including file/symbol span data and SPEC-011 flow catalog tables when enabled.

**Testing**: Vitest unit/contract tests, CLI subprocess tests, MCP tool tests, and a self-repo UAT runbook.

**Target Platform**: Local CLI and MCP server on macOS, Linux, and Windows. Git subprocess calls must use argument arrays, bounded timeouts, and `windowsHide`.

**Project Type**: TypeScript library + CLI + MCP server.

**Performance Goals**: Parse each requested diff once; map hunks by indexed span intersection; default caller expansion stays at direct callers only (`callerDepth: 1`, `maxCallers: 20`); user bounds clamp at `callerDepth` 1–3 and `maxCallers` 1–100; affected-flow rows are capped at 20 in SPEC-012 v1.

**Constraints**: Offline only; no REST/GitHub/PR-comment surface; no hidden index mutation; stale index warns and continues by default; MCP expected states return normal text payloads; no updates to `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.

**Scale/Scope**: One repository at a time, current working tree or `HEAD` vs merge-base comparisons. Large or high-fan-in diffs must stay bounded and report truncation/risk rather than walking the full transitive graph.

**Reviewability Budget**: Primary surface `harness/adapter`; secondary surfaces CLI, MCP, output contracts, and analysis data model. Setup estimate: 610 reviewable LOC, 5 production files, 11 total files, warning accepted. Two vertical slices are required; pause if implementation approaches the 800 block threshold.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Plan Evidence |
|-----------|--------|---------------|
| I. Think Before Coding | Pass | Clarify resolved 15 contract, diff, rename, staleness, bounds, and threshold questions; no unresolved markers remain. |
| II. Simplicity First | Pass | One engine; CLI/MCP adapters only; no REST, GitHub Action, general git-range parser, or cross-repo scope. |
| III. Surgical Changes | Pass | New feature logic lives in `src/analysis/detect-changes/`; existing CLI/MCP edits stay thin. |
| IV. Goal-Driven Execution | Pass | Each slice has contract tests and a self-repo UAT proof path. |
| V. Deterministic, LLM-Free Extraction | Pass | Reports derive only from git diffs, indexed spans, graph callers, and SPEC-011 catalog rows. |
| VI. Retrieval Performance | Pass | MCP output is bounded, success-shaped for expected states, and uses existing direct-caller defaults. |
| VII. Local-First | Pass | No network access or hidden remote state; reports use local git and local `.codegraph/` data only. |

**Pre-design gate result**: Pass. No unjustified complexity violations.

## Project Structure

### Documentation (this feature)

```text
specs/012-change-impact-detection/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli.md
│   ├── json-report.md
│   └── mcp.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/analysis/detect-changes/
├── index.ts        # orchestration and public engine entry point
├── git-diff.ts     # git mode acquisition and diff parsing
├── mapper.ts       # hunk-to-symbol and unmapped diagnostic mapping
├── impact.ts       # caller expansion, flow lookup, risk evaluation
└── report.ts       # JSON/markdown report rendering and exit-code selection

src/bin/codegraph.ts        # thin `codegraph detect-changes` command
src/mcp/tools.ts            # thin `codegraph_detect_changes` tool
src/mcp/server-instructions.ts

__tests__/detect-changes.test.ts
__tests__/detect-changes-cli.test.ts
__tests__/detect-changes-mcp.test.ts
```

**Structure Decision**: Use one new analysis module with five production files and thin surface adapters. This keeps the feature reviewable, avoids scattering diff logic through CLI/MCP code, and preserves upstream merge discipline.

## Complexity Tracking

No constitution violation is accepted. The reviewability warning is handled by the ratified two-slice plan below.

## Phase 0: Research Decisions

Research output is recorded in `research.md`.

Key decisions:

- Use local git subprocesses with explicit arguments for the four supported modes.
- Parse file-level metadata and hunk ranges separately so binary/generated/deleted/unindexed cases remain representable.
- Reuse existing indexed file/symbol span data for hunk mapping.
- Reuse existing direct-caller behavior for default caller expansion.
- Reuse SPEC-011 catalog state semantics for `affectedFlows.state`.

## Phase 1: Design and Contracts

Design artifacts:

- `data-model.md` defines `DiffRequest`, `ChangedHunk`, `ChangedSymbol`, `UnmappedHunk`, `CallerImpact`, `AffectedFlows`, `RiskAnnotation`, `Limits`, and `ImpactReport`.
- `contracts/json-report.md` defines the stable `schemaVersion: 1` report shape.
- `contracts/cli.md` defines `codegraph detect-changes` options and exit codes.
- `contracts/mcp.md` defines the `codegraph_detect_changes` tool input and success-shaped response behavior.
- `quickstart.md` defines the end-to-end validation/UAT scenarios.

**Post-design Constitution Check**: Pass. The design remains deterministic, local-only, bounded, and split into reviewable vertical slices. No agent instruction files were updated.

## Implementation Slices

### Slice 1: Core diff-to-symbol CLI

Deliver:

- `unstaged`, `staged`, `all`, and `base-ref` diff acquisition.
- Rename/move detection and pure-move phantom-impact suppression.
- Hunk-to-symbol mapping and unmapped diagnostics with stable reason codes.
- Stale-index warning path.
- JSON and markdown report rendering.
- CLI command and exit codes `0`, `1`, and operational failure `3`.

Verification:

- Unit tests for diff parsing and hunk mapping.
- Fixture tests for pure rename, edited rename, delete, binary/generated/unindexed cases.
- CLI contract tests for JSON/markdown and exit codes `0`/`1`/`3`.

### Slice 2: Impact expansion and agent surface

Deliver:

- Bounded direct caller expansion with `callerDepth`, `maxCallers`, and truncation metadata.
- SPEC-011 affected-flow lookup with explicit catalog states.
- Risk annotations for caller thresholds, hub-like fan-in, truncation, stale index, and unavailable enrichment.
- `failOn` threshold parsing and exit code `2`.
- MCP tool sharing the same report model and expected-state success behavior.
- Self-repo UAT evidence.

Verification:

- Unit tests for caller bounds, hub risk, `failOn`, and exit code `2`.
- Flow-state tests for disabled/unavailable/not-indexed/stale/empty/available catalogs.
- MCP contract tests for JSON/markdown payloads and expected-state non-errors.
- Self-repo UAT from `quickstart.md`.

## Risk and Mitigation

| Risk | Mitigation |
|------|------------|
| Git diff output differs across platforms | Use git argument arrays, `--no-ext-diff`, `--no-color`, NUL-delimited file metadata where possible, and platform-gated tests for path behavior. |
| Pure renames create noisy impacts | Treat path-only changes as file/path diagnostics; only mapped content hunks create changed symbols. |
| Stale index misleads users | Emit visible stale warnings in JSON, markdown, and MCP; do not silently omit uncertainty. |
| High-fan-in symbols overwhelm output | Default to direct callers and 20 displayed callers; record counts, limits, and truncation. |
| Flow catalogs are absent | Return `affectedFlows.state` with empty items and warning where appropriate, not a failure. |

## Review Packet Source

The PR packet must include:

- What changed: core engine, CLI, MCP, contracts, tests, UAT.
- Why: local diff-to-impact reporting for humans, agents, and future CI automation.
- Non-goals: PR comments, GitHub Actions wiring, REST endpoints, cross-repo impact, general git range parser.
- Review order: contracts/data model → core engine → CLI → MCP → tests/UAT.
- Scope budget: 610 estimated reviewable LOC, two vertical slices, stop near 800.
- Traceability: map FR-001–FR-020 and SC-001–SC-009 to tests/UAT.
- Verification: targeted tests, `npm run build`, `npm run typecheck`, `npm test`, self-repo UAT.
- Known gaps: SPEC-020 PR automation and SPEC-022 cross-repo impact remain deferred.
- Rollback/flags: remove CLI/MCP entry points and new analysis module; no persisted schema migration required unless Plan-time implementation proves one necessary.
