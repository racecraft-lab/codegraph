# Tasks: Change Impact Detection

**Input**: Design documents from `specs/012-change-impact-detection/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Required. SPEC-012 requires deterministic contract tests, CLI/MCP tests, and self-repo UAT evidence.

**Reviewability**: Setup estimate is 610 reviewable LOC with a ratified two-slice plan. Pause and resurface the split decision if implementation approaches 800 reviewable LOC or expands beyond 8 production files / 25 total files.

**Organization**: Tasks are grouped by user story so Slice 1 can ship as a reviewable MVP before Slice 2 adds impact expansion and agent/CI behavior.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare files and fixtures without implementing behavior.

- [x] T001 Create `src/analysis/detect-changes/` with planned module files `index.ts`, `git-diff.ts`, `mapper.ts`, `impact.ts`, and `report.ts`
- [x] T002 [P] Create git-diff fixture helpers in `__tests__/helpers/detect-changes-fixture.ts`
- [x] T003 [P] Create baseline fixture project cases for symbol edits, renames, deletions, binary files, and untracked files under `__tests__/fixtures/detect-changes/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define shared types, constants, and reviewability guardrails before user-story work.

**⚠️ CRITICAL**: No user story work should begin until this phase is complete.

- [x] T004 Define `DiffRequest`, `ChangedHunk`, `ChangedSymbol`, `UnmappedHunk`, `CallerImpact`, `AffectedFlows`, `RiskAnnotation`, `Limits`, and `ImpactReport` types in `src/analysis/detect-changes/index.ts`
- [x] T005 Define shared constants for diff modes, reason codes, exit codes, caller bounds, hub threshold, and flow cap in `src/analysis/detect-changes/index.ts`
- [x] T006 Define JSON/markdown renderer interfaces and summary status values in `src/analysis/detect-changes/report.ts`
- [x] T007 Record the implementation file-count/reviewability checkpoint in `docs/ai/specs/.process/SPEC-012-workflow.md`

**Checkpoint**: Foundation ready - user story implementation can now begin.

---

## Phase 3: User Story 1 - Inspect local change impact before committing (Priority: P1) 🎯 MVP

**Goal**: A developer can inspect unstaged, staged, all, or base-ref diffs and receive changed symbols, unmapped diagnostics, rename behavior, warnings, JSON/markdown output, and stable clean/impact/unavailable exit behavior.

**Independent Test**: Controlled local diffs prove correct changed-symbol mapping, unmapped diagnostics, pure rename suppression, stale/missing index reporting, JSON/markdown output, and exit codes `0`, `1`, and `3` without caller/flow expansion.

### Tests for User Story 1

> Write these tests first and verify they fail before implementation.

- [x] T008 [P] [US1] Add failing unit tests for `unstaged`, `staged`, `all`, and `base-ref` diff acquisition in `__tests__/detect-changes.test.ts`
- [x] T009 [P] [US1] Add failing unit tests for hunk-to-symbol mapping and unmapped reason-code precedence in `__tests__/detect-changes.test.ts`
- [x] T010 [P] [US1] Add failing unit tests for pure rename suppression, edited rename mapping, deleted indexed symbols, binary diagnostics, generated diagnostics, unindexed diagnostics, and untracked diagnostics in `__tests__/detect-changes.test.ts`
- [x] T011 [P] [US1] Add failing CLI contract tests for JSON output, markdown output, and exit codes `0`, `1`, and `3` in `__tests__/detect-changes-cli.test.ts`

### Implementation for User Story 1

- [x] T012 [US1] Implement git diff acquisition, merge-base resolution, file metadata collection, and untracked diagnostics in `src/analysis/detect-changes/git-diff.ts`
- [x] T013 [US1] Implement textual hunk parsing with old/new ranges and rename/delete context in `src/analysis/detect-changes/git-diff.ts`
- [x] T014 [US1] Implement indexed hunk-to-symbol span intersection and deleted-symbol mapping in `src/analysis/detect-changes/mapper.ts`
- [x] T015 [US1] Implement unmapped diagnostic classification and pure move suppression in `src/analysis/detect-changes/mapper.ts`
- [x] T016 [US1] Implement stale-index and missing-index warning/report states in `src/analysis/detect-changes/index.ts`
- [x] T017 [US1] Implement stable JSON and markdown rendering for Summary, Warnings, Changed Symbols, and Unmapped Hunks in `src/analysis/detect-changes/report.ts`
- [x] T018 [US1] Implement the `codegraph detect-changes` CLI adapter with mode, base-ref, format, bounds, and path options in `src/bin/codegraph.ts`
- [x] T019 [US1] Run `PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH npx vitest run __tests__/detect-changes.test.ts __tests__/detect-changes-cli.test.ts` and record Slice 1 evidence in `docs/ai/specs/.process/SPEC-012-workflow.md`

**Checkpoint**: User Story 1 is independently usable through CLI JSON/markdown with direct changed symbols and diagnostics.

---

## Phase 4: User Story 2 - Let agents request bounded impact context (Priority: P2)

**Goal**: An AI agent can request the same report through MCP and receive bounded direct callers, affected-flow state/items, warnings, limits, and risks in a normal text payload for expected states.

**Independent Test**: MCP JSON matches CLI JSON semantics for the same diff, caller expansion stays bounded, affected-flow states are explicit, and expected degraded states do not become MCP tool errors.

### Tests for User Story 2

> Write these tests first and verify they fail before implementation.

- [x] T020 [P] [US2] Add failing unit tests for direct caller expansion, caller sorting, caller truncation, and hub-risk detection in `__tests__/detect-changes.test.ts`
- [x] T021 [P] [US2] Add failing unit tests for affected-flow matching and `disabled`, `unavailable`, `not_indexed`, `stale`, `empty`, and `available` states in `__tests__/detect-changes.test.ts`
- [x] T022 [P] [US2] Add failing MCP contract tests for `codegraph_detect_changes` JSON/markdown payloads and expected-state non-errors in `__tests__/detect-changes-mcp.test.ts`

### Implementation for User Story 2

- [x] T023 [US2] Implement bounded caller expansion, deterministic caller ordering, caller counts, and truncation metadata in `src/analysis/detect-changes/impact.ts`
- [x] T024 [US2] Implement affected-flow lookup, matching, state envelopes, deterministic ordering, and `maxFlows: 20` truncation in `src/analysis/detect-changes/impact.ts`
- [x] T025 [US2] Implement risk annotations for high callers, hubs, stale index, truncation, and unavailable enrichment in `src/analysis/detect-changes/impact.ts`
- [x] T026 [US2] Extend JSON and markdown rendering for Impacted Callers, Affected Flows, Risks, and Limits in `src/analysis/detect-changes/report.ts`
- [x] T027 [US2] Wire `codegraph_detect_changes` into MCP tool definitions and handler dispatch in `src/mcp/tools.ts`
- [x] T028 [US2] Update agent-facing MCP guidance for `codegraph_detect_changes` in `src/mcp/server-instructions.ts`
- [x] T029 [US2] Run `PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH npx vitest run __tests__/detect-changes.test.ts __tests__/detect-changes-mcp.test.ts` and record Slice 2 MCP/caller/flow evidence in `docs/ai/specs/.process/SPEC-012-workflow.md`

**Checkpoint**: User Stories 1 and 2 are independently testable; MCP and CLI share one report model.

---

## Phase 5: User Story 3 - Enforce CI thresholds for risky changes (Priority: P3)

**Goal**: A local or CI preflight can configure caller-count and hub thresholds and distinguish ordinary impact from threshold breach using exit code `2`.

**Independent Test**: Controlled diffs with and without `failOn` policies prove threshold parsing, risk annotation, exit-code precedence, CLI process exit `2`, and MCP normal payload with `exitCode: 2`.

### Tests for User Story 3

> Write these tests first and verify they fail before implementation.

- [x] T030 [P] [US3] Add failing unit tests for `failOn` grammar parsing, invalid tokens, `callers>N`, `hub`, and combined policies in `__tests__/detect-changes.test.ts`
- [x] T031 [P] [US3] Add failing CLI contract tests for threshold breach process exit `2` and operational failure precedence in `__tests__/detect-changes-cli.test.ts`
- [x] T032 [P] [US3] Add failing MCP contract tests for threshold-breach normal payloads with `exitCode: 2` in `__tests__/detect-changes-mcp.test.ts`

### Implementation for User Story 3

- [x] T033 [US3] Implement `failOn` parsing, validation, and threshold-breach risk generation in `src/analysis/detect-changes/report.ts`
- [x] T034 [US3] Implement exit-code precedence for clean, impact, threshold breach, unavailable, and operational failure states in `src/analysis/detect-changes/report.ts`
- [x] T035 [US3] Wire CLI process exit behavior for `exitCode: 2` and `exitCode: 3` in `src/bin/codegraph.ts`
- [x] T036 [US3] Wire MCP threshold-breach payload parity without tool errors in `src/mcp/tools.ts`
- [x] T037 [US3] Run `PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH npx vitest run __tests__/detect-changes.test.ts __tests__/detect-changes-cli.test.ts __tests__/detect-changes-mcp.test.ts` and record threshold evidence in `docs/ai/specs/.process/SPEC-012-workflow.md`

**Checkpoint**: All user stories are independently functional and threshold behavior is CI-ready.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, dogfooding, documentation, and review packet preparation.

- [x] T038 Re-measure reviewable LOC and file counts for SPEC-012 and record the result in `docs/ai/specs/.process/SPEC-012-workflow.md`
- [x] T039 Run retrieval-guardian review for MCP changes and record findings in `docs/ai/specs/.process/SPEC-012-workflow.md`
- [x] T040 [P] Add user-facing CHANGELOG entry under `## [Unreleased]` in `CHANGELOG.md`
- [x] T041 [P] Update SPEC-012 self-repo UAT evidence and actual command results in `specs/012-change-impact-detection/.process/uat-runbook.md`
- [x] T042 Run `PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH npm run build`
- [x] T043 Run `PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH npm run typecheck`
- [x] T044 Run `PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH npm test`
- [x] T045 Run the self-repo UAT scenarios from `specs/012-change-impact-detection/quickstart.md` and record JSON, markdown, warning, caller, flow, and exit-code evidence in `specs/012-change-impact-detection/.process/uat-runbook.md`
- [x] T046 Generate the PR review packet with review order, scope budget, traceability, verification evidence, known gaps, and rollback notes in `docs/ai/specs/.process/SPEC-012-workflow.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational; MVP/Slice 1.
- **User Story 2 (Phase 4)**: Depends on Foundational and can begin after US1 report model exists; Slice 2.
- **User Story 3 (Phase 5)**: Depends on US2 risk/caller data and report model.
- **Polish (Phase 6)**: Depends on completed selected user stories.

### User Story Dependencies

- **US1 (P1)**: Independent MVP after Foundational.
- **US2 (P2)**: Depends on US1 report model but remains independently testable through MCP fixtures.
- **US3 (P3)**: Depends on caller/risk data from US2.

### Within Each User Story

- Tests must be written first and fail before implementation.
- Core module changes precede CLI/MCP adapters.
- Targeted tests must pass before moving to the next story.

---

## Parallel Opportunities

- T002 and T003 can run in parallel after T001.
- T008, T009, T010, and T011 can run in parallel because they add separate failing test coverage before US1 implementation.
- T020, T021, and T022 can run in parallel because they cover separate US2 test surfaces.
- T030, T031, and T032 can run in parallel because they cover separate US3 test surfaces.
- T040 and T041 can run in parallel during polish after implementation behavior is known.

## Parallel Example: User Story 1

```text
Task: "T008 [US1] Add failing unit tests for diff acquisition in __tests__/detect-changes.test.ts"
Task: "T009 [US1] Add failing unit tests for hunk-to-symbol mapping in __tests__/detect-changes.test.ts"
Task: "T010 [US1] Add failing unit tests for rename/delete/binary/generated/unindexed/untracked diagnostics in __tests__/detect-changes.test.ts"
Task: "T011 [US1] Add failing CLI contract tests in __tests__/detect-changes-cli.test.ts"
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete US1 only.
3. Validate direct diff-to-symbol CLI reports with JSON/markdown and exit codes `0`, `1`, and `3`.
4. Stop for review if reviewable LOC materially exceeds the setup estimate.

### Incremental Delivery

1. US1 delivers Slice 1: local CLI diff-to-symbol reporting.
2. US2 delivers Slice 2 agent impact expansion: callers, affected flows, MCP, and risks.
3. US3 completes CI threshold behavior: `failOn`, exit code `2`, and parity.
4. Polish validates the full system with build, typecheck, tests, retrieval-guardian, and self-repo UAT.

### Review Boundaries

- Slice 1 review: `src/analysis/detect-changes/`, `src/bin/codegraph.ts`, `__tests__/detect-changes*.test.ts`.
- Slice 2 review: `src/analysis/detect-changes/impact.ts`, `src/mcp/tools.ts`, `src/mcp/server-instructions.ts`, MCP tests.
- CI threshold review: `report.ts`, CLI/MCP adapters, threshold tests.
- Final review: CHANGELOG, UAT evidence, reviewability measurement, PR packet.

## Notes

- `[P]` tasks use different files or independent test additions.
- `[US#]` labels map tasks to user stories in `spec.md`.
- `src/mcp/` changes require retrieval-guardian review before completion.
- Do not update `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` for SPEC-012.
- Do not add REST endpoints, GitHub Actions wiring, PR comments, general git-range parsing, or cross-repository impact.
