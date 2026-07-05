# Tasks: Web Framework Research Spike

**Input**: Design documents from `/specs/004-web-framework-research-spike/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/decision-artifacts.md`, `quickstart.md`, and `docs/ai/specs/.process/SPEC-004-design-concept.md`

**Tests**: This is a docs/process research spike, so no TDD test files are required. Verification tasks include `npm run build`, `npm test`, screenshot evidence, self-repo UAT, and runbook validation.

**Reviewability**: Primary surface is docs/process. Secondary surface is PNG evidence assets. Planned durable production files: 0. Planned durable implementation files: `docs/design/web-framework-decision.md`, `docs/design/assets/spec-004/self-repo-graph.png`, `docs/design/assets/spec-004/one-k-node-target.png`, `specs/004-web-framework-research-spike/.process/uat-runbook.md`, and updates to `specs/004-web-framework-research-spike/quickstart.md` only if runbook validation requires it.

**Organization**: Tasks are ordered by independent evidence milestones and grouped by user story so each story remains independently reviewable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it uses a different file or temporary evidence note and does not depend on incomplete tasks.
- **[Story]**: Maps the task to `US1`, `US2`, or `US3` from `spec.md`.
- Every task names an exact durable or temporary file path.

## Phase 1: Setup (Shared Evidence Workspace)

**Purpose**: Create the durable decision surface, UAT runbook check, and temporary research/prototype workspace without adding production code.

- [ ] T001 Create the initial decision document skeleton with all contract-required sections in `docs/design/web-framework-decision.md`
- [ ] T002 Generate or update the UAT runbook at `specs/004-web-framework-research-spike/.process/uat-runbook.md` against existing `spec.md` and `plan.md`, then update any stale SPEC-004 paths or commands in `specs/004-web-framework-research-spike/quickstart.md`
- [ ] T003 [P] Create the temporary evidence and prototype workspace at `/tmp/spec-004-web-framework-research/`
- [ ] T004 [P] Create the committed screenshot evidence directory at `docs/design/assets/spec-004/`
- [ ] T005 Verify the reviewability budget before implementation and record the split/no-split decision in `docs/design/web-framework-decision.md`

---

## Phase 2: Foundational (Decision Rules Before Evidence)

**Purpose**: Define the scoring, gate, evidence, and prototype rules before candidate research begins.

**Critical**: No candidate recommendation or prototype work begins until this phase is complete.

- [ ] T006 Record the SPEC-004 scope, non-goals, forbidden durable changes, and prototype-source boundary in `docs/design/web-framework-decision.md`
- [ ] T007 Define the hard-gate pass/fail thresholds and weighted scoring model, including UX sub-scores, in `docs/design/web-framework-decision.md`
- [ ] T008 Define the evidence record schema for official docs, package metadata, repository metadata, observed values, source URLs, access dates, lookup methods, and supported claims in `docs/design/web-framework-decision.md`
- [ ] T009 Define the prototype data shape, screenshot fallback ladder, self-repo UAT criteria, and no-hosted-runtime check in `docs/design/web-framework-decision.md`

**Checkpoint**: Decision rules are fixed and user story work can now proceed.

---

## Phase 3: User Story 1 - Review a grounded framework decision (Priority: P1) MVP

**Goal**: Produce a current-source decision matrix for all six roadmap candidates, apply hard gates, score only gate-passing candidates, and recommend exactly one stack.

**Independent Test**: A maintainer can review `docs/design/web-framework-decision.md` and confirm all six candidates have official documentation evidence, live package or repository metadata, hard-gate results, weighted scores where eligible, and one clear recommendation.

### Implementation for User Story 1

- [ ] T010 [P] [US1] Gather official documentation and live package/repository metadata for Vite+React SPA in `/tmp/spec-004-web-framework-research/vite-react.md`
- [ ] T011 [P] [US1] Gather official documentation and live package/repository metadata for SvelteKit static/adapter-node in `/tmp/spec-004-web-framework-research/sveltekit.md`
- [ ] T012 [P] [US1] Gather official documentation and live package/repository metadata for Next.js standalone in `/tmp/spec-004-web-framework-research/nextjs-standalone.md`
- [ ] T013 [P] [US1] Gather official documentation and live package/repository metadata for Astro islands in `/tmp/spec-004-web-framework-research/astro-islands.md`
- [ ] T014 [P] [US1] Gather official documentation and live package/repository metadata for TanStack Start in `/tmp/spec-004-web-framework-research/tanstack-start.md`
- [ ] T015 [P] [US1] Gather official documentation and live package/repository metadata for SolidStart in `/tmp/spec-004-web-framework-research/solidstart.md`
- [ ] T016 [P] [US1] Gather official documentation and live package/repository metadata for chosen-stack graph-rendering library candidates, including canvas/WebGL force-graph options and 1k-node/60fps evidence where available, in `/tmp/spec-004-web-framework-research/graph-renderers.md`
- [ ] T017 [US1] Consolidate all six framework evidence notes and graph-renderer notes into the current-source evidence table in `docs/design/web-framework-decision.md`
- [ ] T018 [US1] Apply hard gates to every framework candidate and graph-renderer candidate, excluding any failed framework candidate from final ranking and any failed renderer from prototype selection in `docs/design/web-framework-decision.md`
- [ ] T019 [US1] Score only gate-passing framework candidates with weighted scoring and UX sub-scores in `docs/design/web-framework-decision.md`
- [ ] T020 [US1] Select exactly one framework stack and one graph-rendering approach from the chosen-stack bake-off, then record runner-up tradeoffs and rejection rationale in `docs/design/web-framework-decision.md`

**Checkpoint**: User Story 1 is complete when the decision matrix can be reviewed without relying on unstored live pages or uncaptured package metadata.

---

## Phase 4: User Story 2 - Verify graph rendering before committing to the stack (Priority: P2)

**Goal**: Prove the chosen stack can render representative CodeGraph data from this repository and a 1k-node/60fps target or documented fallback, with browser screenshot evidence.

**Independent Test**: A maintainer can inspect the committed PNGs, reproduction notes, data counts, browser/tooling path, and prototype limitations in `docs/design/web-framework-decision.md` without finding long-lived prototype source in the durable repo tree.

### Implementation for User Story 2

- [ ] T021 [US2] Generate or export representative CodeGraph data from this repository into `/tmp/spec-004-web-framework-research/data/self-repo-graph.json` and record the selection method in `docs/design/web-framework-decision.md`
- [ ] T022 [US2] Generate or simulate the 1k-node/60fps graph target into `/tmp/spec-004-web-framework-research/data/one-k-node-target.json` and record node/edge counts in `docs/design/web-framework-decision.md`
- [ ] T023 [US2] Build the selected-stack throwaway graph-rendering prototype under `/tmp/spec-004-web-framework-research/prototype/`
- [ ] T024 [US2] Run the throwaway prototype locally with package-shipped or local assets only and record commands plus any network/dependency findings in `docs/design/web-framework-decision.md`
- [ ] T025 [US2] Capture the representative self-repo browser screenshot or required no-screenshot fallback evidence at `docs/design/assets/spec-004/self-repo-graph.png`
- [ ] T026 [US2] Capture the 1k-node/60fps target browser screenshot or required no-screenshot fallback evidence at `docs/design/assets/spec-004/one-k-node-target.png`
- [ ] T027 [US2] Add screenshot references, captions, dataset names, node/edge counts, capture tool, dimensions, visible labels, graph structure, and primary controls to `docs/design/web-framework-decision.md`
- [ ] T028 [US2] Record graph interaction observations, first visible render timing, frame-rate or interaction-smoothness signal, machine/browser context, asset size notes, readability notes, and prototype limitations in `docs/design/web-framework-decision.md`
- [ ] T029 [US2] Run `npm run build` from the repository root and record the verification outcome in `docs/design/web-framework-decision.md`
- [ ] T030 [US2] Run `npm test` from the repository root and record the verification outcome in `docs/design/web-framework-decision.md`
- [ ] T031 [US2] Record the final self-repo UAT result as pass, pass with limitation, or fail in both `docs/design/web-framework-decision.md` and `specs/004-web-framework-research-spike/.process/uat-runbook.md`

**Checkpoint**: User Story 2 is complete when screenshots or explicitly documented fallback evidence are committed or recorded, prototype source remains outside durable source, and build/test health is documented.

---

## Phase 5: User Story 3 - Reuse the decision in later web specs (Priority: P3)

**Goal**: Make the decision reusable by SPEC-005, SPEC-006, and SPEC-007 without repeating the research spike.

**Independent Test**: A later spec author can use `docs/design/web-framework-decision.md` to identify the selected stack, serving model, graph-rendering approach, package-shipping constraints, API/static-asset handoff, container recipe, and deferred implementation owners.

### Implementation for User Story 3

- [ ] T032 [US3] Document the embedded package-shipped static asset strategy, asset classes, expected later build output, package destination, and copy-assets implications in `docs/design/web-framework-decision.md`
- [ ] T033 [US3] Document the SPEC-005 local HTTP server boundary, local API assumptions, route fallback behavior, static serving expectations, and explicit dormant activation handoff in `docs/design/web-framework-decision.md`
- [ ] T034 [US3] Document the standalone container recipe with entrypoint, served asset source, `.codegraph/` mount assumptions, host/port/configuration expectations, and offline behavior in `docs/design/web-framework-decision.md`
- [ ] T035 [US3] Map every deferred implementation concern to SPEC-005, SPEC-006, SPEC-007, or a named follow-up in `docs/design/web-framework-decision.md`

**Checkpoint**: User Story 3 is complete when later web specs can cite the decision document instead of reopening framework selection.

---

## Phase 6: Polish & Cross-Cutting Verification

**Purpose**: Validate the artifact set, runbook, traceability, and PR review packet before review.

- [ ] T036 Validate the reproduction and UAT steps against the actual commands, artifact paths, screenshots, and prototype outcomes in `specs/004-web-framework-research-spike/quickstart.md` and `specs/004-web-framework-research-spike/.process/uat-runbook.md`
- [ ] T037 Confirm the durable diff contains no production server or web UI source, no in-browser indexing, no LSP facade or WebSocket endpoint, no long-lived prototype source, no generated web build output, no CDN/runtime hosted-service dependency, and no non-permissive dependency adoption; record the result in `docs/design/web-framework-decision.md`
- [ ] T038 Add a review packet source section covering what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, and rollback or feature-flag notes in `docs/design/web-framework-decision.md`
- [ ] T039 Validate FR and success-criteria coverage against `specs/004-web-framework-research-spike/spec.md` and record any known limitation or pass-with-limitation status in `docs/design/web-framework-decision.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 - Setup**: No dependencies.
- **Phase 2 - Foundational**: Depends on Phase 1 because the decision document must exist.
- **Phase 3 - US1**: Depends on Phase 2 because gates and evidence schema must be fixed before research is scored.
- **Phase 4 - US2**: Depends on US1 because only the selected stack gets a throwaway prototype.
- **Phase 5 - US3**: Can begin after US1 selects the stack; complete after US2 so prototype limits are included.
- **Phase 6 - Polish**: Depends on desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2. No dependency on US2 or US3.
- **US2 (P2)**: Depends on US1 stack and graph-renderer selection.
- **US3 (P3)**: Depends on US1 selection and should incorporate US2 prototype findings before final review.

### Requirement Coverage

- **FR-001 to FR-007**: T006-T020
- **FR-008 to FR-012**: T021-T031
- **FR-013**: T032-T034
- **FR-014**: T021-T031
- **FR-015 to FR-018**: T006, T009, T018, T024, T032-T039
- **SC-001 to SC-003**: T010-T020
- **SC-004 to SC-006**: T021-T031, T037
- **SC-007 to SC-008**: T032-T035, T039

---

## Parallel Opportunities

- T003 and T004 can run in parallel after T001 creates the durable decision surface.
- T010-T016 can run in parallel because each writes to a separate temporary evidence note under `/tmp/spec-004-web-framework-research/`.
- T021 and T022 can run in parallel after US1 selects the stack because they generate separate temporary datasets.
- T032-T034 can be drafted in parallel after US1 selects the stack, then reconciled after US2 records prototype limits.

---

## Parallel Example: User Story 1

```bash
Task: "Gather official documentation and live package/repository metadata for Vite+React SPA in /tmp/spec-004-web-framework-research/vite-react.md"
Task: "Gather official documentation and live package/repository metadata for SvelteKit static/adapter-node in /tmp/spec-004-web-framework-research/sveltekit.md"
Task: "Gather official documentation and live package/repository metadata for Next.js standalone in /tmp/spec-004-web-framework-research/nextjs-standalone.md"
Task: "Gather official documentation and live package/repository metadata for Astro islands in /tmp/spec-004-web-framework-research/astro-islands.md"
Task: "Gather official documentation and live package/repository metadata for TanStack Start in /tmp/spec-004-web-framework-research/tanstack-start.md"
Task: "Gather official documentation and live package/repository metadata for SolidStart in /tmp/spec-004-web-framework-research/solidstart.md"
Task: "Gather official documentation and live package/repository metadata for chosen-stack graph-rendering library candidates, including canvas/WebGL force-graph options and 1k-node/60fps evidence where available, in /tmp/spec-004-web-framework-research/graph-renderers.md"
```

---

## Parallel Example: User Story 2

```bash
Task: "Generate or export representative CodeGraph data from this repository into /tmp/spec-004-web-framework-research/data/self-repo-graph.json"
Task: "Generate or simulate the 1k-node/60fps graph target into /tmp/spec-004-web-framework-research/data/one-k-node-target.json"
```

---

## Parallel Example: User Story 3

```bash
Task: "Document the embedded package-shipped static asset strategy in docs/design/web-framework-decision.md"
Task: "Document the SPEC-005 local HTTP server boundary in docs/design/web-framework-decision.md"
Task: "Document the standalone container recipe in docs/design/web-framework-decision.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup and Phase 2 decision rules.
2. Complete US1 candidate research, hard gates, weighted scoring, and stack recommendation.
3. Stop and validate that all six candidates have current official and live evidence before prototype work begins.

### Incremental Delivery

1. Finish US1 to lock the recommendation.
2. Finish US2 to prove graph rendering and self-repo UAT with screenshot evidence.
3. Finish US3 to make the decision reusable by SPEC-005, SPEC-006, and SPEC-007.
4. Finish Phase 6 to validate reviewability, runbook accuracy, traceability, and non-goals.

### Boundary Rules

- Do not commit production server or web UI code.
- Do not commit in-browser indexing, LSP facade, or WebSocket endpoint code.
- Do not commit long-lived prototype source.
- Do not add CDN/runtime hosted-service dependencies.
- Do not adopt source-available-only or non-permissive dependencies.
- Do not change `src/`, `web/`, extraction, retrieval, MCP, SQLite schema, installer, release flow, build/copy wiring, or package behavior for SPEC-004.
