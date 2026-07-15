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
| Specify | `/speckit-specify` | ✅ Complete | `spec.md` generated with 0 unresolved markers at G1 |
| Clarify | `/speckit-clarify` | ✅ Complete | CLI/MCP contracts, staleness semantics, thresholds, and rename edge cases resolved with 15 total clarification answers |
| Plan | `/speckit-plan` | ✅ Complete | Constants, file layout, contracts, and two-slice implementation plan recorded |
| Checklist | `/speckit-checklist` | ✅ Complete | api-contracts, data-integrity, error-handling, and performance checklists passed with no unresolved gaps |
| Tasks | `/speckit-tasks` | ✅ Complete | 46 tasks generated across setup, foundation, 3 user stories, and polish |
| Analyze | `/speckit-analyze` | ✅ Complete | 0 critical/high findings; 2 medium advisory findings carried into confidence gate |
| Confidence Gate | G6.5 | ✅ Complete | Advisory pre-Implement confidence score 0.82; proceed with medium advisories visible |
| Implement | `/speckit-implement` | ✅ Complete | Core engine, CLI, MCP, tests, UAT, and verification completed |
| Post | Post-Implementation | 🔄 In Progress | Draft PR #55 opened; awaiting review feedback/remediation |

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
| G6.5 | Confidence Gate | Advisory confidence score recorded before implementation begins |
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

**Bootstrap status:** complete for autopilot Phase 0 on 2026-07-15. The
ambient shell was on unsupported Node `v26.4.0`, so all project commands were
run with the pinned `.nvmrc` runtime `v24.11.1`.

| Check | Result | Evidence |
|-------|--------|----------|
| Worktree binding | ✅ Pass | `git branch --show-current` → `012-change-impact-detection` |
| Dependencies | ✅ Pass | `npm install` added dependencies without lockfile changes |
| Build | ✅ Pass | `npm run build` |
| Typecheck | ✅ Pass | `npm run typecheck` |
| Full test suite | ✅ Pass | Escalated rerun of `npm test`: 231 files, 3913 tests passed, 7 skipped |

The first sandboxed `npm test` run failed because local loopback and Unix
socket listeners were denied (`listen EPERM`) and temporary git commits could
not reach the GPG agent. The same suite passed outside the sandbox, confirming
those failures were environmental rather than SPEC-012 regressions.

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
| Functional Requirements | 20 |
| User Stories | 3 |
| Acceptance Criteria | 10 acceptance scenarios; 9 measurable success criteria |
| Clarification markers | 0 in `spec.md` |

### Files Generated

- [x] `specs/012-change-impact-detection/spec.md`
- [x] `specs/012-change-impact-detection/checklists/requirements.md`
- [x] `.specify/feature.json`

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
| 1 | Output/API contracts | 5 answered | `codegraph_detect_changes`; `schemaVersion: 1`; stable JSON fields; deterministic markdown sections; normal MCP text payload for expected states; unmapped hunks are diagnostics, not invented impacts. Consensus: PASS |
| 2 | Diff and rename correctness | 5 answered | Exact `unstaged`/`staged`/`all`/`base-ref` comparison semantics; git rename detection preserves old/new paths; pure moves suppress semantic impact; edited/deleted indexed symbols map when spans exist; binary/generated/unsupported/unindexed/untracked files become reason-coded diagnostics; stale indexes warn and continue. Consensus: PASS |
| 3 | Risk and threshold behavior | 5 answered | Default caller bounds are `callerDepth: 1`, `maxCallers: 20`, clamped to 1–3 and 1–100; hub risk is direct callers >20; `failOn` grammar is `callers>N` and/or `hub`; exit code 2 only covers configured threshold breaches; `affectedFlows.state` mirrors SPEC-011 catalog states. Consensus: PASS |

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
| `plan.md` | ✅ | Technical context, constitution checks, two-slice plan, reviewability warning handling, and file plan recorded |
| `research.md` | ✅ | Diff acquisition, hunk mapping, staleness, caller bounds, affected-flow state, and threshold grammar decisions recorded |
| `data-model.md` | ✅ | Diff request, hunks, symbols, diagnostics, callers, flows, risks, limits, and report entities defined |
| `contracts/` | ✅ | CLI, MCP, and JSON schema contracts with examples generated |
| `quickstart.md` | ✅ | Local and CI-oriented validation/UAT scenarios generated |

**G3 status:** PASS. Constitution check passes pre- and post-design. Reviewability
warning remains accepted with the ratified two-slice implementation plan. Optional
before/after plan git hooks were skipped because `.specify/extensions/git/git-config.yml`
has `auto_commit.before_plan.enabled=false` and `auto_commit.after_plan.enabled=false`.

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
| api-contracts | 14/14 checked | 0 unresolved | `spec.md`, `contracts/cli.md`, `contracts/json-report.md`, `contracts/mcp.md` |
| data-integrity | 15/15 checked | 0 unresolved | `spec.md`, `data-model.md`, `research.md`, `quickstart.md` |
| error-handling | 15/15 checked | 0 unresolved | `spec.md`, `contracts/`, `data-model.md` |
| performance | 14/14 checked | 0 unresolved | `spec.md`, `plan.md`, `data-model.md`, `quickstart.md` |

**G4 status:** PASS. Checklist prep identified and resolved minor contract gaps
around untracked-file diagnostics in `all` mode, markdown table columns,
unavailable report status, and flow output bounds before the checklists were
marked complete. Optional before/after checklist git hooks were skipped because
`.specify/extensions/git/git-config.yml` has `auto_commit.before_checklist.enabled=false`
and `auto_commit.after_checklist.enabled=false`.

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
| Total Tasks | 46 |
| Phases | 6: setup, foundational, US1, US2, US3, polish |
| Parallel Opportunities | 15 tasks marked `[P]` plus story-level test batches |
| User Stories Covered | 3/3 with independent test criteria |

---

## Atomicity Route

This is filled after the Tasks phase. Run:

```text
runner helper atomicity-route specs/012-change-impact-detection
```

| Field | Value | Meaning |
|-------|-------|---------|
| Route | `one-navigable-PR` | One PR remains navigable if implementation stays near the 610 LOC estimate and follows the two vertical slices |
| Releasable | Yes, after all three user stories plus polish gates are complete | CI-green alone is not enough until self-repo UAT, reviewability re-measurement, and PR packet evidence are recorded |
| Signals | 46 tasks; 5 planned production files; thin CLI/MCP adapters; 3 test files; two ratified vertical slices | `split-PR` remains the fallback if reviewable LOC approaches the 800 block threshold |
| Warnings | Reviewability warning accepted; helper command not present in checkout, route recorded from task/file signals | Stop and resurface if tasks expand beyond the plan or add new surfaces |

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
| A1 | MEDIUM | Some `[P]` markers in `tasks.md` target the same test file (`T008`/`T009`/`T010`, `T020`/`T021`), so parallel execution could create edit contention. | Non-blocking because implementation can run sequentially; remove `[P]` markers or split test files if parallel agents are used. |
| A2 | MEDIUM | SC-009 no-network behavior is covered by local-first constraints and UAT, but there is no dedicated no-network verification task. | Non-blocking for G6; strengthen T045 or add a polish task if implementation reveals network-sensitive code paths. |

**Coverage summary:** 20/20 functional requirements mapped to tasks. 8/9 success
criteria have direct task coverage; SC-009 has partial coverage through local-only
constraints and UAT. Constitution alignment has no critical issue. Optional
before/after analyze git hooks were skipped because
`.specify/extensions/git/git-config.yml` has `auto_commit.before_analyze.enabled=false`
and `auto_commit.after_analyze.enabled=false`.

---

## Phase 6.5: Confidence Gate

**When to run:** After Analyze and before Implement. This gate records the
latest pre-Implement confidence block emitted by Analyze consensus.

| Gate | Mode | Status | Notes |
|------|------|--------|-------|
| G6.5 | advisory | ✅ Pass | Confidence score 0.82. No critical/high findings; medium advisories A1/A2 remain visible for implementation discipline |

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
| Setup and foundation | T001-T007 | ✅ 7/7 | Planned module files, fixtures, shared model, constants, render contracts, and reviewability tracking were established |
| Slice 1 - Core diff-to-symbol CLI | T008-T019 | ✅ 12/12 | Diff acquisition, hunk parsing, symbol mapping, diagnostics, stale/missing-index states, JSON/markdown output, and CLI exit behavior implemented |
| Slice 2 - Impact expansion and MCP | T020-T029 | ✅ 10/10 | Bounded callers, affected-flow enrichment, risks, MCP tool wiring, and agent-facing guidance implemented |
| CI thresholds | T030-T037 | ✅ 8/8 | `failOn` parsing, threshold-breach status, exit-code precedence, CLI exit 2, and MCP parity implemented |
| Polish and UAT | T038-T046 | ✅ 9/9 | Changelog, UAT evidence, verification evidence, retrieval-guardian review, reviewability measurement, and PR packet recorded |

### Reviewability Checkpoint

| Scope | Files | Additions | Deletions | Notes |
|-------|-------|-----------|-----------|-------|
| Production | 8 | 1,418 | 8 | `src/analysis/detect-changes/`, CLI wiring, MCP wiring, and server instructions |
| Tests | 8 | 338 | 0 | Unit, CLI, MCP, helper, and fixture coverage |
| Spec/process docs | 22 | 2,589 | 148 | SpecKit artifacts, workflow, UAT, contracts, and checklists |
| Total | 38 | 4,345 | 156 | Includes generated/SpecKit documentation artifacts |

**Reviewability verdict:** ✅ One-PR exception accepted. The ratified workflow
said to pause if implementation size materially exceeded the setup estimate or
approached the 800 reviewable LOC block threshold. The production diff is 1,418
additions across 8 files, and the maintainer accepted a one-PR exception on
2026-07-15 so draft PR creation may proceed.

### Verification Evidence

| Check | Result | Evidence |
|-------|--------|----------|
| Build | ✅ Pass | `PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH npm run build` |
| Typecheck | ✅ Pass | `PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH npm run typecheck` |
| Focused detect-changes suite | ✅ Pass | `npx vitest run __tests__/detect-changes.test.ts __tests__/detect-changes-cli.test.ts __tests__/detect-changes-mcp.test.ts`: 3 files, 12 tests |
| MCP/default-surface regression suite | ✅ Pass | `npx vitest run __tests__/rename-mcp.test.ts __tests__/mcp-tool-allowlist.test.ts __tests__/analysis/explore-unchanged.test.ts __tests__/mcp-server-instructions.test.ts __tests__/detect-changes-mcp.test.ts`: 5 files, 36 tests |
| Full suite | ✅ Pass | Escalated `npm test`: 234 files, 3,925 tests passed, 7 skipped |

The first sandboxed `npm test` attempt was stopped after unrelated environment
failures: GPG signing could not access `~/.gnupg`, loopback/Unix socket listeners
hit `listen EPERM`, and endpoint/embedding tests timed out. The same suite
passed with the pinned project runtime outside the sandbox.

### Retrieval Guardian Review

| Check | Verdict | Evidence |
|-------|---------|----------|
| Explore call budget | ✅ Unchanged | `getExploreBudget` still uses the expected monotonic tiers: 1/2/3/4/5 calls as repository size grows |
| Explore output budget | ✅ Unchanged | Per-file caps remain monotonic at 3,800/3,800/6,500/7,000/7,000 chars; no smaller large-repo tier was introduced |
| Read/Grep steering | ✅ Pass | Added server instructions do not tell agents to use Read/Grep/open files for this workflow |
| Expected degraded states | ✅ Pass | Missing index returns a normal unavailable report; malformed args and git failures remain operational tool errors |
| Dynamic-dispatch coverage | ✅ Not touched | No extraction, resolver, synthesized-edge, or flow-connection code was modified |
| Focused regression tests | ✅ Pass | `explore-unchanged`, MCP server instructions, MCP allowlist, rename MCP, and detect-changes MCP tests passed together |
| Agent A/B | N/A | No explore retrieval behavior, dynamic-dispatch coverage, or output budget changed; this adds a local diff impact tool |

### Self-Repo UAT Evidence

The worktree CodeGraph index was refreshed with `node dist/bin/codegraph.js sync`
before UAT.

| Scenario | Exit | Result |
|----------|------|--------|
| `--mode staged --format json` | 0 | Clean report: 0 changed symbols, 0 unmapped hunks, 0 callers, 0 affected flows |
| `--mode all --format json --max-callers 10` | 1 | Impact report: 9 changed symbols, 68 unmapped diagnostics, 10 bounded callers, 0 affected flows |
| `--mode all --format markdown --max-callers 10` | 1 | Markdown summary matched JSON counts and surfaced risks/warnings |
| `--mode all --format json --fail-on callers>0 --max-callers 10` | 2 | Threshold-breach report with configured caller threshold risk |
| `--path <tempdir> --mode all --format json` | 3 | Success-shaped unavailable report for a directory without `.codegraph/` |

Detailed command evidence is recorded in
`specs/012-change-impact-detection/.process/uat-runbook.md`.

### PR Review Packet

Draft PR: https://github.com/racecraft-lab/codegraph/pull/55

Recommended review order:

1. Spec and contracts: `specs/012-change-impact-detection/spec.md`,
   `contracts/`, `data-model.md`, and `research.md`.
2. Core engine: `src/analysis/detect-changes/`.
3. CLI adapter: `src/bin/codegraph.ts`.
4. MCP adapter and guidance: `src/mcp/tools.ts`,
   `src/mcp/server-instructions.ts`.
5. Tests and fixtures: `__tests__/detect-changes*.test.ts`,
   `__tests__/helpers/detect-changes-fixture.ts`, and
   `__tests__/fixtures/detect-changes/`.
6. UAT, changelog, and reviewability evidence.

Traceability:

- US1 maps to T008-T019 and covers diff acquisition, hunk-to-symbol mapping,
  diagnostics, stale/missing-index behavior, JSON/markdown output, and CLI exit
  codes.
- US2 maps to T020-T029 and covers bounded callers, affected-flow enrichment,
  MCP parity, expected-state non-errors, and agent guidance.
- US3 maps to T030-T037 and covers `failOn`, threshold-breach status, exit-code
  precedence, and CLI/MCP parity.

Known gaps and risks:

- The implementation is verified but exceeds the ratified reviewability stop
  condition: 1,418 production additions versus the 800 LOC block threshold.
- No Sonnet A/B run was performed because the change does not alter
  `codegraph_explore`, retrieval budgets, extraction, resolution, or dynamic
  dispatch. Retrieval-guardian review remains focused on MCP-surface safety.
- The one-PR exception was accepted on 2026-07-15. Reviewers should still start
  with the core engine and adapter boundaries because the production diff
  exceeds the original reviewability threshold.

Rollback notes:

- Remove `src/analysis/detect-changes/`.
- Remove `codegraph detect-changes` CLI wiring from `src/bin/codegraph.ts`.
- Remove `codegraph_detect_changes` MCP wiring/default exposure from
  `src/mcp/tools.ts` and related agent guidance from `src/mcp/server-instructions.ts`.
- Remove detect-changes tests, fixtures, helper, changelog entry, and SPEC-012
  generated artifacts if abandoning the feature branch.

---

## Post-Implementation Checklist

- [ ] Post: Doctor Extension Check
- [ ] Post: Verify Implementation
- [ ] Post: Verify Tasks Phantom Check
- [ ] Post: Code Review
- [x] Post: Integration Suite
- [x] Post: Reviewability Diff Gate — one-PR exception accepted by maintainer
- [ ] Post: Self-Review
- [x] Post: UAT Runbook Generation
- [ ] Post: Final Reviewability Backstop
- [x] Post: PR Packet/Body Generation
- [x] Post: PR Body Generation
- [x] Post: PR Creation — https://github.com/racecraft-lab/codegraph/pull/55
- [ ] Post: Review Remediation — awaiting review feedback
- [ ] Post: Retrospective
- [x] All tasks marked complete in `tasks.md`.
- [x] Reviewability LOC re-measured and compared to setup warning.
- [x] `npm run build` passes.
- [x] `npm test` passes.
- [x] CLI and MCP contract tests pass.
- [x] Self-repo UAT runbook executed and evidence recorded.
- [x] CHANGELOG entry added under `## [Unreleased]`.
- [x] PR packet excludes Codex/Claude session URLs.

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
