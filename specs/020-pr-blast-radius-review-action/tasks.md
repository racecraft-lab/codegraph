# Tasks: PR Blast-Radius Review Action

**Input**: Design documents from `specs/020-pr-blast-radius-review-action/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, and `docs/ai/specs/.process/SPEC-020-design-concept.md`

**Tests**: Required. The workflow and constitution require TDD-first coverage for the reusable action contract, deterministic result matrix, cache validation, fork/trust behavior, delivery fallback, narrative degradation, generated runtime freshness, and dogfood workflow.

**Reviewability**: SPEC-020 carries an accepted warning at 455 projected reviewable LOC. Keep production work centered on `actions/pr-impact/action.yml`, `actions/pr-impact/run.ts`, `actions/pr-impact/dist/run.mjs`, and `.github/workflows/pr-impact.yml`. Stop before implementation if task execution expands beyond the recorded one-spec boundary.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel after dependencies are met because it touches different files.
- **[Story]**: User-story task label from `spec.md`.
- Every task includes an exact file path.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the implementation boundary, baseline commands, and generated-runtime path before behavior work starts.

- [X] T001 Verify Node 24.11.1 and record pre-implementation baseline command results in `specs/020-pr-blast-radius-review-action/quickstart.md`
- [X] T002 Create the reusable action directory skeleton in `actions/pr-impact/action.yml`
- [X] T003 Create the action helper source skeleton and dependency-injection seam in `actions/pr-impact/run.ts`
- [X] T004 Add the generated action runtime target placeholder in `actions/pr-impact/dist/run.mjs`
- [X] T005 Add the action runtime build command and package visibility plan in `package.json`
- [X] T006 Add shared deterministic detector, GitHub event, and delivery fixtures in `__tests__/fixtures/pr-impact.ts`
- [X] T007 Verify the reviewability budget against the planned task/file scope and record the one-spec Q9 decision in `specs/020-pr-blast-radius-review-action/plan.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the contract and generated-runtime guardrails that every user story depends on.

**⚠️ CRITICAL**: No user story implementation can begin until these tasks are complete.

- [X] T008 [P] Add failing contract tests for action inputs, outputs, helper version, and CodeGraph version metadata in `__tests__/pr-impact-action-contract.test.ts`
- [X] T009 [P] Add failing freshness tests proving `actions/pr-impact/dist/run.mjs` is generated from `actions/pr-impact/run.ts` in `__tests__/pr-impact-runtime-freshness.test.ts`
- [X] T010 Add minimal action contract declarations for inputs, outputs, runtime step, summary, and artifact surfaces in `actions/pr-impact/action.yml`
- [X] T011 Add minimal helper types for `PullRequestContext`, `ActionInputs`, `DetectorResult`, `DeliveryResult`, `NarrativeResult`, and `FinalConclusion` in `actions/pr-impact/run.ts`
- [X] T012 Implement the reproducible action-runtime build path for `actions/pr-impact/dist/run.mjs` in `package.json`
- [X] T013 Generate `actions/pr-impact/dist/run.mjs` from `actions/pr-impact/run.ts` and make `__tests__/pr-impact-runtime-freshness.test.ts` pass

**Checkpoint**: Contract and generated-runtime foundation ready; user-story implementation can proceed.

---

## Phase 3: User Story 1 - Current PR impact report (Priority: P1) 🎯 MVP

**Goal**: Produce one current deterministic blast-radius report with changed symbols, callers, affected flows, risks, warnings, limits, run metadata, and a stable action-owned marker.

**Independent Test**: Run the helper against deterministic impact fixtures and verify exactly one current report is rendered or updated without modifying unrelated comments.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.**

- [ ] T014 [P] [US1] Add failing report contract tests for required deterministic sections and run metadata in `__tests__/pr-impact-delivery.test.ts`
- [ ] T015 [P] [US1] Add failing sticky-comment tests for create, update, deleted prior comment, duplicate action-owned markers, and unrelated comments in `__tests__/pr-impact-delivery.test.ts` (Q5)
- [ ] T016 [P] [US1] Add failing detector invocation tests for `detect-changes --base-ref`, caller depth, max callers, JSON capture, and markdown capture in `__tests__/pr-impact-action-contract.test.ts`

### Implementation for User Story 1

- [ ] T017 [US1] Implement action input parsing and output emission for report metadata in `actions/pr-impact/run.ts`
- [ ] T018 [US1] Implement detector execution capture without shell-failing on ordinary impact in `actions/pr-impact/run.ts`
- [ ] T019 [US1] Implement deterministic markdown report rendering with hidden marker, metadata, changed symbols, callers, affected flows, risks, warnings, and limits in `actions/pr-impact/run.ts`
- [ ] T020 [US1] Implement action-owned sticky comment create/update behavior in `actions/pr-impact/run.ts`
- [ ] T021 [US1] Implement duplicate action-owned comment retirement and warning behavior in `actions/pr-impact/run.ts`
- [ ] T022 [US1] Wire helper outputs and report file paths through the composite action in `actions/pr-impact/action.yml`
- [ ] T023 [US1] Regenerate `actions/pr-impact/dist/run.mjs` and verify US1 contract freshness in `actions/pr-impact/dist/run.mjs`

**Checkpoint**: User Story 1 is independently functional and testable as the MVP.

---

## Phase 4: User Story 2 - Safe report availability for forks and restricted permissions (Priority: P1)

**Goal**: Preserve deterministic reports in durable fallback surfaces when comment writing or secrets are unavailable.

**Independent Test**: Run fork-like and read-only-token fixtures and verify successful analysis remains available in the job summary and artifact without privileged credentials.

### Tests for User Story 2 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.**

- [ ] T024 [P] [US2] Add failing fork/read-only permission tests for comment denial and no privileged secret use in `__tests__/pr-impact-delivery.test.ts` (Q1)
- [ ] T025 [P] [US2] Add failing fallback delivery tests for job summary plus artifact when comments are unavailable in `__tests__/pr-impact-delivery.test.ts` (Q7)
- [ ] T026 [P] [US2] Add failing delivery-degradation tests proving comment failure does not rewrite analysis status or threshold status in `__tests__/pr-impact-result-matrix.test.ts` (Q3, Q7)

### Implementation for User Story 2

- [ ] T027 [US2] Implement pull-request trust-boundary detection and observed permission checks in `actions/pr-impact/run.ts`
- [ ] T028 [US2] Implement safe comment-write eligibility and fork-like denial handling in `actions/pr-impact/run.ts`
- [ ] T029 [US2] Implement workflow-summary report writing in `actions/pr-impact/run.ts`
- [ ] T030 [US2] Implement artifact report handoff and delivery-status output wiring in `actions/pr-impact/action.yml`
- [ ] T031 [US2] Suppress secret-backed narrative eligibility for untrusted or read-only-token runs in `actions/pr-impact/run.ts` (Q1, Q4)
- [ ] T032 [US2] Regenerate `actions/pr-impact/dist/run.mjs` and verify US2 delivery freshness in `actions/pr-impact/dist/run.mjs`

**Checkpoint**: User Stories 1 and 2 both work independently for trusted and restricted PR contexts.

---

## Phase 5: User Story 3 - Opt-in policy enforcement (Priority: P2)

**Goal**: Keep ordinary impact advisory while failing only configured caller or hub threshold breaches and unrecovered analysis unavailability.

**Independent Test**: Run clean, ordinary-impact, caller-breach, hub-breach, and unavailable-analysis fixtures and verify final check conclusions match the documented matrix.

### Tests for User Story 3 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.**

- [ ] T033 [P] [US3] Add failing result-matrix tests for clean, ordinary impact, caller threshold breach, hub threshold breach, analysis unavailable, and report unavailable in `__tests__/pr-impact-result-matrix.test.ts` (Q2, Q3)
- [ ] T034 [P] [US3] Add failing threshold input mapping tests for `fail-on-callers` and `fail-on-hubs` detector arguments in `__tests__/pr-impact-action-contract.test.ts` (Q2)
- [ ] T035 [P] [US3] Add failing unavailable-analysis report tests proving detector exit 3 publishes an unavailable report and failing conclusion in `__tests__/pr-impact-result-matrix.test.ts` (Q3)

### Implementation for User Story 3

- [ ] T036 [US3] Implement final conclusion mapping for clean, impact, threshold breach, analysis unavailable, and report unavailable in `actions/pr-impact/run.ts`
- [ ] T037 [US3] Map `fail-on-callers` and `fail-on-hubs` inputs to detector `--fail-on` arguments without a second policy engine in `actions/pr-impact/run.ts`
- [ ] T038 [US3] Capture detector exit codes 0, 1, 2, and 3 and preserve detector JSON as canonical in `actions/pr-impact/run.ts`
- [ ] T039 [US3] Implement unavailable-analysis report rendering and failing conclusion output in `actions/pr-impact/run.ts`
- [ ] T040 [US3] Regenerate `actions/pr-impact/dist/run.mjs` and verify US3 policy freshness in `actions/pr-impact/dist/run.mjs`

**Checkpoint**: Policy enforcement is deterministic, threshold-only, and independently testable.

---

## Phase 6: User Story 4 - Correct cache use and optional prose narrative (Priority: P3)

**Goal**: Use valid warm cache without changing correctness, rebuild invalid cache before analysis, keep narrative off by default, and append trusted narrative as prose-only.

**Independent Test**: Run valid-cache, stale-cache, cache-miss, corrupt-cache, incompatible-cache, narrative-disabled, narrative-suppressed, narrative-unavailable, narrative-fallback, narrative-pending, and narrative-appended fixtures.

### Tests for User Story 4 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.**

- [ ] T041 [P] [US4] Add failing cache validation tests for warm-valid, miss, stale, corrupt, incompatible, rebuilt, and unavailable states in `__tests__/pr-impact-cache.test.ts` (Q6)
- [ ] T042 [P] [US4] Add failing narrative tests proving disabled, suppressed, unavailable, fallback, pending, and appended prose never change deterministic facts or conclusion in `__tests__/pr-impact-narrative.test.ts` (Q4)
- [ ] T043 [P] [US4] Add failing dogfood workflow tests proving advisory defaults, no threshold inputs, narrative disabled, and pull-request trigger in `.github/workflows/pr-impact.yml` via `__tests__/pr-impact-action-contract.test.ts` (Q8)
- [ ] T044 [P] [US4] Add failing warm-cache evidence validation for at least five eligible self-repository samples and median ≤3 minutes in `__tests__/pr-impact-cache.test.ts`

### Implementation for User Story 4

- [ ] T045 [US4] Implement cache identity and validation metadata for lockfile, merge base, base ref, head SHA, and CodeGraph runtime in `actions/pr-impact/run.ts`
- [ ] T046 [US4] Implement cache miss, stale, corrupt, incompatible, rebuild, and unavailable transitions in `actions/pr-impact/run.ts`
- [ ] T047 [US4] Wire `.codegraph/` cache restore/save steps around validation and rebuild in `actions/pr-impact/action.yml`
- [ ] T048 [US4] Implement optional SPEC-018 narrative status handling as disabled, suppressed, unavailable, fallback, pending, or appended in `actions/pr-impact/run.ts`
- [ ] T049 [US4] Append eligible narrative only after deterministic report sections and final conclusion are fixed in `actions/pr-impact/run.ts`
- [ ] T050 [US4] Add advisory self-repository dogfood workflow with thresholds unset and narrative disabled in `.github/workflows/pr-impact.yml` (Q8)
- [ ] T051 [US4] Regenerate `actions/pr-impact/dist/run.mjs` and verify US4 cache/narrative freshness in `actions/pr-impact/dist/run.mjs`

**Checkpoint**: Cache, narrative, and dogfood behavior are subordinate to deterministic correctness and privacy.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, changelog, package inclusion, review packet, and final verification.

- [ ] T052 [P] Add user-facing setup, inputs, outputs, fallback, threshold, cache, fork, and narrative documentation in `actions/pr-impact/README.md`
- [ ] T053 [P] Add a user-facing `## [Unreleased]` changelog bullet for the reusable PR impact action in `CHANGELOG.md`
- [ ] T054 Verify package inclusion for `actions/pr-impact/action.yml`, `actions/pr-impact/run.ts`, and `actions/pr-impact/dist/run.mjs` in `package.json`
- [ ] T055 Run focused action contract, cache, delivery, result-matrix, narrative, runtime-freshness, and dogfood tests and record evidence in `specs/020-pr-blast-radius-review-action/quickstart.md`
- [ ] T056 Run `npm run build`, `npm run typecheck`, and `npm test`, then record final verification evidence in `specs/020-pr-blast-radius-review-action/quickstart.md`
- [ ] T057 Record at least five eligible self-repository warm-cache sample rows, exclusion decisions, and median duration in `specs/020-pr-blast-radius-review-action/quickstart.md`
- [ ] T058 Run the SpecKit reviewability gate and record the pass/warn/blocker result in `specs/020-pr-blast-radius-review-action/plan.md`
- [ ] T059 Generate the PR review packet with review order, scope budget, traceability, verification evidence, known gaps, and rollback notes in `specs/020-pr-blast-radius-review-action/pr-review-packet.md`
- [ ] T060 Regenerate `specs/020-pr-blast-radius-review-action/SPEC-MOC.md` after final docs and task artifacts are present

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup completion and blocks all user stories.
- **US1 Current PR impact report (Phase 3)**: Depends on Foundational; MVP path.
- **US2 Safe fallback (Phase 4)**: Depends on Foundational; can start after US1 report renderer/sticky contract is stable.
- **US3 Policy enforcement (Phase 5)**: Depends on Foundational; can proceed in parallel with US2 after detector capture exists.
- **US4 Cache/narrative/dogfood (Phase 6)**: Depends on Foundational plus detector capture; narrative tasks also depend on trust-boundary work from US2.
- **Polish (Phase 7)**: Depends on all selected user stories.

### User Story Dependencies

- **US1 (P1)**: First MVP increment; no dependency on other user stories after foundation.
- **US2 (P1)**: Shares delivery/report primitives with US1, but fork fallback remains independently testable.
- **US3 (P2)**: Depends on detector capture from US1, not on comment delivery.
- **US4 (P3)**: Depends on detector capture and trust-boundary status; cache and narrative remain independently testable.

### Within Each User Story

- Tests must be written and observed failing before implementation tasks.
- Contract fixtures precede helper behavior.
- Helper behavior precedes composite action wiring.
- Generated `dist/run.mjs` is regenerated after each story's source behavior changes.
- Story checkpoint tests must pass before moving to the next phase.

## Parallel Opportunities

- T008 and T009 can run in parallel after setup.
- T014, T015, and T016 can run in parallel for US1 tests.
- T024, T025, and T026 can run in parallel for US2 tests.
- T033, T034, and T035 can run in parallel for US3 tests.
- T041, T042, T043, and T044 can run in parallel for US4 tests.
- T052 and T053 can run in parallel during polish.

## Parallel Example: User Story 1

```bash
Task: "Add failing report contract tests for required deterministic sections and run metadata in __tests__/pr-impact-delivery.test.ts"
Task: "Add failing sticky-comment tests for create, update, deleted prior comment, duplicate action-owned markers, and unrelated comments in __tests__/pr-impact-delivery.test.ts"
Task: "Add failing detector invocation tests for detect-changes --base-ref, caller depth, max callers, JSON capture, and markdown capture in __tests__/pr-impact-action-contract.test.ts"
```

## Parallel Example: User Story 4

```bash
Task: "Add failing cache validation tests for warm-valid, miss, stale, corrupt, incompatible, rebuilt, and unavailable states in __tests__/pr-impact-cache.test.ts"
Task: "Add failing narrative tests proving disabled, suppressed, unavailable, fallback, pending, and appended prose never change deterministic facts or conclusion in __tests__/pr-impact-narrative.test.ts"
Task: "Add failing dogfood workflow tests proving advisory defaults, no threshold inputs, narrative disabled, and pull-request trigger in .github/workflows/pr-impact.yml via __tests__/pr-impact-action-contract.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 for the deterministic report and sticky comment.
3. Validate US1 independently with `__tests__/pr-impact-action-contract.test.ts`, `__tests__/pr-impact-delivery.test.ts`, and `__tests__/pr-impact-runtime-freshness.test.ts`.

### Incremental Delivery

1. Foundation → generated runtime and public contract.
2. US1 → deterministic report and one sticky comment.
3. US2 → fork-safe fallback surfaces.
4. US3 → threshold-only policy enforcement.
5. US4 → cache validation, optional prose-only narrative, and advisory dogfood.
6. Polish → docs, changelog, warm-cache evidence, reviewability, and PR packet.

### Reviewability Guardrail

Run the reviewability gate before implementation and again before PR packaging. If the actual diff crosses a hard blocker, stop and produce a split/remediation recommendation rather than widening this spec.

## Notes

- `[P]` tasks touch different files or only add independent test cases.
- Every security, degradation, conclusion, cache, and rollout task carries the relevant Q-number from the design concept.
- `actions/pr-impact/dist/run.mjs` is generated and must never become an unexplained hand-maintained runtime artifact.
