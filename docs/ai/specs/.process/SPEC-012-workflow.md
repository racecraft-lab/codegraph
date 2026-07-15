# SpecKit Workflow: SPEC-012 — Change Impact Detection

**Template Version**: 1.0.0
**Created**: 2026-07-15
**Purpose**: Prepare and execute SPEC-012 so CodeGraph can map git diffs to
changed symbols, bounded caller and flow impact, stable CLI/MCP output, and
CI-friendly exit codes.

---

## Design Concept

This workflow file was enriched from a Grill Me interview run during
`$speckit-pro:speckit-scaffold-spec SPEC-012` on 2026-07-15. The full
8-question Q&A log, Goals, Non-goals, and Open Questions live at:

```text
docs/ai/specs/.process/SPEC-012-design-concept.md
```

Re-read it before each phase. It is the source of truth for setup decisions:
CLI + MCP only; local diff modes plus `--base-ref`; stale index warns and
continues; bounded callers plus SPEC-011 flow impact; exit codes `0` clean,
`1` impacts, `2` threshold breach; git rename detection with phantom-impact
prevention; two vertical slices; and self-repo UAT against a controlled diff.

> **Note:** Grill Me is human-in-the-loop only. It is not part of the autopilot
> loop. Once this workflow is populated and autopilot begins, clarifications
> happen via `/speckit-clarify` and the consensus protocol — never via Grill Me.

---

## Reviewability Budget & Split Decision

The setup-mode `reviewability-gate` ran on 2026-07-15 against the extracted
SPEC-012 roadmap section. Result: **WARN, pass=true**. The sole warning is
`reviewable LOC 405 exceeds warn threshold 400`; blockers are empty. The
roadmap records ~5 production files, ~11 total files, primary surface
`harness/adapter`, and an advisory two-slice estimate.

The shared `estimate-spec-size` runner then ran with scoped setup signals:
2 user-story slices, 11 files/surfaces, 8 functional requirements, net-new work.
Result: `estimated_loc=610`, `suggested_slices=2`, `status=warn`.

**Split decision (Q7, human-ratified 2026-07-15): two vertical slices.**

- **Slice 1:** diff acquisition, hunk-to-symbol mapping, stale-index warning,
  rename/move handling, CLI JSON/markdown output, and core exit codes.
- **Slice 2:** bounded caller expansion, SPEC-011 affected-flow lookup, risk
  annotations, MCP surface, `--fail-on` thresholds, and end-to-end hardening.

If Plan estimates the implementation near the 800 block threshold, pause and
re-surface the split decision instead of proceeding silently.

### Template Resolution Record

Resolved from this worktree on 2026-07-15:

- `spec-template` → `speckit-pro-reviewability v1.0.0`
- `plan-template` → `speckit-pro-reviewability v1.0.0`
- `tasks-template` → `codegraph-project-overrides v1.0.0`, intentionally higher
  priority than the generic reviewability tasks template.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `/speckit-specify` | ⏳ Pending | Produce `specs/012-change-impact-detection/spec.md`; no unresolved markers at G1 |
| Clarify | `/speckit-clarify` | ⏳ Pending | Focus on CLI/MCP contracts, staleness semantics, thresholds, and rename edge cases |
| Plan | `/speckit-plan` | ⏳ Pending | Confirm constants, file layout, schema changes, and two-slice implementation plan |
| Checklist | `/speckit-checklist` | ⏳ Pending | Run api-contracts, data-integrity, error-handling, and performance domains |
| Tasks | `/speckit-tasks` | ⏳ Pending | Preserve two vertical slices with independent verification |
| Analyze | `/speckit-analyze` | ⏳ Pending | Resolve all critical/high consistency findings before implementation |
| Implement | `/speckit-implement` | ⏳ Pending | TDD for mapper/expansion/contracts; record self-repo UAT evidence |

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates

| Gate | Checkpoint | Approval Criteria |
|------|------------|-------------------|
| G1 | After Specify | User stories are independently testable; no `[NEEDS CLARIFICATION]` markers remain |
| G2 | After Clarify | CLI/MCP output, staleness, thresholds, and rename semantics are resolved |
| G3 | After Plan | Constitution passes; reviewable LOC estimate and two-slice plan are recorded |
| G4 | After Checklist | All genuine `[Gap]` items are resolved or explicitly out of scope |
| G5 | After Tasks | Both vertical slices have complete task and verification coverage |
| G6 | After Analyze | No unresolved `CRITICAL` findings; `HIGH` findings resolved or accepted with rationale |
| G7 | After Each Implementation Phase | Targeted tests pass, full suite passes before completion claim, UAT evidence recorded |

---

## Prerequisites

### Constitution Validation

Before starting any workflow phase, verify alignment with
`.specify/memory/constitution.md`:

| Principle | Requirement | Verification |
|-----------|-------------|--------------|
| I. Think Before Coding | Treat Q1–Q8 as resolved; surface ambiguous constants and contracts in Clarify/Plan. | Marker scan plus traceability to design concept |
| II. Simplicity First | One deterministic diff-to-impact engine; no general git-range parser; no REST/GitHub surface in v1. | Plan scope review |
| III. Surgical Changes | New work lives primarily in `src/analysis/detect-changes/`; edits to CLI/MCP/schema stay minimal and declared. | File-operation table and diff review |
| IV. Goal-Driven Execution | Mapper, expansion, output, thresholds, and rename behavior start from tests or deterministic probes. | Red/green records and verification report |
| V. Deterministic, LLM-Free Extraction | Impact mapping derives only from git diff, indexed spans, and graph/flow tables. | Fixtures for changed symbols, renames, callers, and flow joins |
| VI. Retrieval Performance | MCP output is bounded, success-shaped for expected conditions, and does not steer agents to Read/Grep. | MCP contract tests and retrieval-guardian review if `src/mcp/` changes |
| VII. Local-First | No network calls; works offline against local git and `.codegraph/`; stale index warns without mutating hidden state. | Dormancy and no-network review |

**Bootstrap status:** no explicit worktree bootstrap command is documented in
root `AGENTS.md` or wrappers. Setup did not run `npm install`, `npm run build`,
or `codegraph init`. Run only user-approved project bootstrap commands from
this worktree before starting implementation if the environment is missing
dependencies or a fresh build.

---

## Specification Context

### Basic Information

| Field | Value |
|-------|-------|
| **Spec ID** | SPEC-012 |
| **Name** | Change Impact Detection |
| **Branch** | `012-change-impact-detection` |
| **Dependencies** | SPEC-011 preferred and now complete for flow impact enrichment |
| **Enables** | SPEC-020 PR Blast-Radius Review Action |
| **Priority** | P1 |
| **Primary surface** | Harness/adapter |
| **Workflow artifacts** | `docs/ai/specs/.process/SPEC-012-design-concept.md`, this workflow, `specs/012-change-impact-detection/SPEC-MOC.md` |
| **UAT runbook** | `specs/012-change-impact-detection/.process/uat-runbook.md` |

### Roadmap Scope

- `src/analysis/detect-changes/`: diff acquisition, git `-M` rename/move
  detection, hunk-to-symbol span intersection, caller expansion, flow lookup,
  and risk annotations.
- Outputs: stable JSON schema and markdown table renderer.
- CLI: `codegraph detect-changes`.
- MCP: one agent-facing detect-changes tool sharing the same engine and output
  semantics.
- Exit codes: `0` clean, `1` impacts, `2` threshold breach through
  `--fail-on callers>N|hub`.
- Correctness: stale-index warning, phantom-impact prevention on renames.

### Success Criteria Summary

- [ ] Diff modes cover unstaged, staged, all working-tree changes, and
  `--base-ref` merge-base comparison.
- [ ] Hunk-to-symbol mapping intersects git hunks with indexed symbol spans and
  reports unmapped hunks explicitly.
- [ ] Rename/move detection uses git `-M` and prevents pure moves from producing
  phantom semantic impacts.
- [ ] Direct changed symbols expand to bounded upstream callers with risk
  annotations for caller count and hub-like fan-in.
- [ ] SPEC-011 affected flows are included when flow tables are available and
  represented as unavailable or disabled when not.
- [ ] Stale index conditions are visible in every output surface and warn by
  default rather than failing.
- [ ] JSON output is schema-stable; markdown output is readable and includes
  changed symbols, callers, affected flows, risks, and warnings.
- [ ] CLI exit codes are stable: `0` clean, `1` impacts, `2` threshold breach.
- [ ] MCP response is bounded and success-shaped for expected conditions.
- [ ] Self-repo UAT proves a controlled diff end-to-end per the UAT runbook.

---

## Phase 1: Specify

**When to run:** At the start. Focus on what and why, not implementation
internals. Output: `specs/012-change-impact-detection/spec.md`.

### Specify Prompt

```text
/speckit-specify

## Feature: Change Impact Detection (SPEC-012)

CodeGraph needs a local-first diff-to-impact capability. Given a git diff, the
feature maps changed hunks to indexed symbols, expands to bounded upstream
callers and affected SPEC-011 flows, and emits stable JSON/markdown through CLI
and MCP surfaces with CI-stable exit codes.

Source of truth for setup decisions:
docs/ai/specs/.process/SPEC-012-design-concept.md.

### Users
- Developers running local impact checks before committing.
- AI agents deciding which code context and tests are relevant to a change.
- CI workflows and future SPEC-020 PR review automation.

### Required behavior
1. Support unstaged, staged, all working-tree changes, and `--base-ref`
   merge-base comparisons.
2. Acquire git diffs with rename/move detection enabled.
3. Map changed hunks to indexed symbol spans and report unmapped hunks.
4. Suppress phantom impacts for pure renames/moves.
5. Expand direct changed symbols to bounded callers.
6. Join SPEC-011 flow data to report affected flows when available.
7. Emit risk annotations for caller count and hub-like fan-in.
8. Warn and continue when the index may be stale.
9. Emit a stable JSON schema and markdown table output.
10. Use exit codes: 0 clean, 1 impacts, 2 configured threshold breach.
11. Expose the same engine through `codegraph detect-changes` and MCP.
12. Keep PR comments, GitHub Actions wiring, REST endpoints, and cross-repo
    impact out of scope.

### Review plan
Plan this as two vertical slices:
- Slice 1: diff acquisition, symbol mapping, staleness warning,
  rename/move handling, CLI JSON/markdown, and core exit codes.
- Slice 2: bounded caller expansion, affected-flow lookup, risk annotations,
  MCP surface, threshold failures, and UAT hardening.
```

### Specify Results

| Metric | Value |
|--------|-------|
| Functional Requirements | Pending |
| User Stories | Pending |
| Acceptance Criteria | Pending |
| Clarification markers | Must be zero before G1 passes |

### Files Generated

- [ ] `specs/012-change-impact-detection/spec.md`

---

## Phase 2: Clarify

**When to run:** After Specify if any contract, threshold, or edge-case behavior
can be interpreted multiple ways. Maximum 5 targeted questions per session.

### Clarify Prompts

#### Session 1: Output and API contract focus

```text
/speckit-clarify Focus on output/API contracts for SPEC-012:
- exact JSON field names and versioning strategy
- markdown table columns and warning presentation
- MCP tool name, input schema, and response envelope
- whether unmapped hunks are warnings, impact rows, or separate diagnostics
- consistency between CLI and MCP semantics
```

#### Session 2: Diff and rename correctness focus

```text
/speckit-clarify Focus on git diff and rename correctness for SPEC-012:
- unstaged/staged/all/base-ref mode definitions
- git rename/move detection expectations
- pure move versus semantic change behavior
- binary, generated, deleted, and unindexed files
- stale index warnings and when strict failures are allowed
```

#### Session 3: Risk and threshold focus

```text
/speckit-clarify Focus on risk scoring and CI threshold behavior for SPEC-012:
- default caller depth and width limits
- hub-risk definition
- `--fail-on callers>N|hub` exact grammar
- exit code 2 threshold-breach behavior
- how affected-flow absence is represented when SPEC-011 catalogs are disabled
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---------|------------|-----------|--------------|
| 1 | Output/API contracts | Pending | Pending |
| 2 | Diff and rename correctness | Pending | Pending |
| 3 | Risk and threshold behavior | Pending | Pending |

---

## Phase 3: Plan

**When to run:** After spec is finalized. Output:
`specs/012-change-impact-detection/plan.md`.

### Plan Prompt

```text
/speckit-plan

## Tech Stack
- Runtime: TypeScript/Node, existing CodeGraph CLI and MCP server.
- Storage: existing SQLite schema and SPEC-011 flow tables when available.
- Git integration: local `git diff`/merge-base commands with rename detection.
- Testing: Vitest fixtures for diff parsing, symbol mapping, rename handling,
  caller expansion, flow joins, output contracts, and exit codes.

## Architecture
- Put the core engine under `src/analysis/detect-changes/`.
- Keep CLI and MCP thin: both call the same engine and format stable output.
- Add schema or query helpers only if needed for efficient symbol-span and
  flow-step lookup.
- Preserve local-first behavior: no network calls, no hidden state mutation.

## Reviewability
- Keep the two vertical slices from the design concept.
- Record the actual reviewable LOC estimate at G3 and compare it with the
  setup warning values: 405 roadmap LOC and 610 estimator LOC.
- If the implementation approaches the 800 block threshold, stop and resurface
  the split decision.
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | ⏳ | Technical context, constitution checks, and file plan |
| `research.md` | ⏳ | Only if Plan needs decisions beyond existing roadmap and design concept |
| `data-model.md` | ⏳ | Impact report entities and risk annotations |
| `contracts/` | ⏳ | CLI/MCP JSON schema and examples |
| `quickstart.md` | ⏳ | Local and CI-oriented detect-changes examples |

---

## Phase 4: Domain Checklists

**When to run:** After Plan. Validate both spec and plan together.

### Recommended Domains

1. **api-contracts** — CLI JSON and MCP response contracts need stable fields,
   warning representation, and examples.
2. **data-integrity** — hunk-to-symbol mapping, rename suppression, and stale
   index status must not misrepresent impact.
3. **error-handling** — git failures, missing indexes, disabled flow catalogs,
   unindexed files, and threshold breaches need consistent behavior.
4. **performance** — caller and flow expansion must stay bounded and predictable.

### Checklist Prompts

#### api-contracts

```text
/speckit-checklist api-contracts

Focus on SPEC-012 requirements:
- CLI JSON schema and MCP response fields are fully specified.
- Markdown output has deterministic columns and warning placement.
- Exit codes 0/1/2 are tied to observable states.
- MCP expected conditions are success-shaped, not tool errors.
- Pay special attention to: CLI and MCP contract parity.
```

#### data-integrity

```text
/speckit-checklist data-integrity

Focus on SPEC-012 requirements:
- Hunk-to-symbol span mapping is unambiguous.
- Unmapped hunks are represented without inventing impacts.
- Rename/move handling suppresses phantom semantic changes.
- Stale index status is visible in all outputs.
- Pay special attention to: pure renames versus renamed files with edited hunks.
```

#### error-handling

```text
/speckit-checklist error-handling

Focus on SPEC-012 requirements:
- Missing `.codegraph/` and disabled SPEC-011 flow catalogs degrade explicitly.
- Git command failures have clear messages and non-confusing exit behavior.
- Threshold breaches are distinguishable from ordinary impact reports.
- Unindexed, deleted, binary, or generated files are handled deliberately.
- Pay special attention to: warning-and-continue behavior for stale indexes.
```

#### performance

```text
/speckit-checklist performance

Focus on SPEC-012 requirements:
- Caller expansion has documented depth and width bounds.
- Flow impact lookup avoids unbounded joins or duplicate-heavy output.
- Markdown and JSON output stay bounded on large diffs.
- Risk annotations identify hubs without walking the full transitive graph.
- Pay special attention to: worst-case diffs touching high-fan-in symbols.
```

### Checklist Results

| Checklist | Items | Gaps | Spec References |
|-----------|-------|------|-----------------|
| api-contracts | Pending | Pending | Pending |
| data-integrity | Pending | Pending | Pending |
| error-handling | Pending | Pending | Pending |
| performance | Pending | Pending | Pending |

---

## Phase 5: Tasks

**When to run:** After checklists complete and all genuine gaps are resolved.
Output: `specs/012-change-impact-detection/tasks.md`.

### Tasks Prompt

```text
/speckit-tasks

## Task Structure
- Preserve two vertical slices.
- Each slice must produce a working end-to-end capability and its own tests.
- Mark parallel-safe tests and formatter work with [P] only when independent.
- Organize implementation by user story, not by technical layer.

## Slice 1: Core diff-to-symbol CLI
- git diff acquisition for unstaged, staged, all, and base-ref modes
- rename/move detection
- hunk-to-symbol mapping and unmapped hunk reporting
- stale index warning
- CLI JSON and markdown output
- exit code 0/1 behavior
- focused fixtures and contract tests

## Slice 2: Impact expansion and agent surface
- bounded caller expansion
- SPEC-011 affected-flow lookup
- risk annotations and fail-on thresholds
- exit code 2 behavior
- MCP tool and response tests
- self-repo UAT runbook execution
- full-suite and reviewability evidence
```

### Tasks Results

| Metric | Value |
|--------|-------|
| Total Tasks | Pending |
| Phases | Pending |
| Parallel Opportunities | Pending |
| User Stories Covered | Pending |

---

## Atomicity Route

This is filled after the Tasks phase. Run:

```text
runner helper atomicity-route specs/012-change-impact-detection
```

| Field | Value | Meaning |
|-------|-------|---------|
| Route | Pending | One of `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope` |
| Releasable | Pending | Whether CI-green is enough to consider the change releasable |
| Signals | Pending | Decisive detector findings |
| Warnings | Pending | Release-safety warnings |

---

## Phase 6: Analyze

### Analyze Prompt

```text
/speckit-analyze

Focus on SPEC-012:
1. Contract consistency across CLI, MCP, JSON examples, markdown examples, and
   exit-code requirements.
2. Coverage gaps for renames, stale indexes, unmapped hunks, disabled flow
   catalogs, and threshold breaches.
3. Whether tasks preserve two independently reviewable vertical slices.
4. Constitution alignment: deterministic local analysis, no network calls,
   bounded output, and success-shaped MCP expected conditions.
```

### Analysis Results

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| Pending | Pending | Pending | Pending |

---

## Phase 7: Implement

### Implement Prompt

```text
/speckit-implement

## Approach
- Start each behavior from a failing fixture or contract test when practical.
- Keep the core engine independent of CLI/MCP formatting.
- Preserve the two vertical slices and stop for review if implementation size
  materially exceeds the setup estimate.

## Verification required before completion
- Targeted tests for diff acquisition, rename handling, symbol mapping, caller
  expansion, flow lookup, output contracts, and exit codes.
- `npm run build`
- `npm test`
- Self-repo UAT from `specs/012-change-impact-detection/.process/uat-runbook.md`
- Reviewability LOC re-measurement and PR packet evidence
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| Slice 1 - Core diff-to-symbol CLI | Pending | 0 | Pending |
| Slice 2 - Impact expansion and MCP | Pending | 0 | Pending |
| Polish and UAT | Pending | 0 | Pending |

---

## Post-Implementation Checklist

- [ ] All tasks marked complete in `tasks.md`.
- [ ] Reviewability LOC re-measured and compared to setup warning.
- [ ] `npm run build` passes.
- [ ] `npm test` passes.
- [ ] CLI and MCP contract tests pass.
- [ ] Self-repo UAT runbook executed and evidence recorded.
- [ ] CHANGELOG entry added under `## [Unreleased]`.
- [ ] PR packet excludes Codex/Claude session URLs.

---

## Project Structure Reference

```text
src/analysis/detect-changes/       # New diff-to-impact engine
src/bin/codegraph.ts               # CLI command wiring
src/mcp/                           # MCP tool wiring and server instructions
src/db/                            # Query/schema changes if needed
__tests__/                         # Fixtures and contract tests
specs/012-change-impact-detection/ # SpecKit artifacts
```
