# Tasks: Web UI: Graph Browser

**Input**: Design documents from `specs/006-web-ui-graph-browser/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Tests are included because SPEC-006 has explicit API, accessibility, performance, package, and UAT success criteria. Test tasks should be created before implementation tasks in each story and should fail until the corresponding implementation lands.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing. The implementation order preserves the accepted three review slices: foundation/search/symbol, graph canvas, and impact/reindex/chat/package validation.

**Reviewability**: SPEC-006 has an accepted one-spec split exception. Keep implementation in the three vertical slices named in `spec.md`, and complete the reviewability checkpoint before implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other tasks in the same phase because it touches different files and has no dependency on incomplete tasks.
- **[Story]**: User story label from `spec.md`; setup, foundation, and polish tasks have no story label.
- Every task names concrete file paths.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the nested Vite React app, shadcn/Tailwind foundation, and package/build seams.

- [ ] T001 Create the nested web app scaffold files in `web/package.json`, `web/index.html`, and `web/tsconfig.json`
- [ ] T002 Configure Vite React and Tailwind v4 integration in `web/vite.config.ts` and `web/src/styles/globals.css`
- [ ] T003 [P] Configure shadcn/ui aliases and utilities in `web/components.json` and `web/src/lib/utils.ts`
- [ ] T004 [P] Add required shadcn base components under `web/src/components/ui/`
- [ ] T005 [P] Create the web test harness in `web/vitest.config.ts`, `web/src/tests/setup.ts`, and `web/src/tests/test-utils.tsx`
- [ ] T006 Wire root web build and asset copy commands in `package.json` and `scripts/copy-web-assets.mjs`
- [ ] T007 [P] Create the web app entry and route shell placeholders in `web/src/main.tsx`, `web/src/app/App.tsx`, and `web/src/app/routes.tsx`
- [ ] T008 Record the accepted reviewability split checkpoint in `specs/006-web-ui-graph-browser/tasks.md`

**Checkpoint**: Web scaffolding and build seams exist; no user story work depends on missing app structure.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared API, state, layout, accessibility, and performance primitives required by all user stories.

**Critical**: No user story implementation starts until this phase is complete.

- [ ] T009 Define shared data-model types and state taxonomy in `web/src/lib/api/types.ts`
- [ ] T010 Implement the same-origin API client core and ErrorEnvelope handling in `web/src/lib/api/client.ts`
- [ ] T011 [P] Add URL/search-param helpers for repo-scoped routes in `web/src/lib/api/routes.ts`
- [ ] T012 [P] Add status announcement and async state helpers in `web/src/lib/a11y/status-announcer.ts`
- [ ] T013 [P] Add performance mark and threshold helpers for NFR evidence in `web/src/lib/perf/marks.ts`
- [ ] T014 Implement app-level repository and selected-context state in `web/src/app/state.ts`
- [ ] T015 Implement the persistent developer-tool shell layout in `web/src/components/layout/AppShell.tsx`
- [ ] T016 [P] Implement reusable loading, empty, degraded, unauthorized, and error panels in `web/src/components/layout/StatePanel.tsx`
- [ ] T017 [P] Add shared accessible toolbar and icon-button primitives in `web/src/components/layout/Toolbar.tsx`
- [ ] T018 Add root app tests for shell rendering and state taxonomy in `web/src/tests/app-shell.test.tsx`
- [ ] T019 Update server static/package asset integration in `src/server/static.ts` and `scripts/copy-web-assets.mjs`
- [ ] T020 Add package asset and static fallback tests in `__tests__/package-web-assets.test.ts` and `__tests__/server-static-fallback.test.ts`

**Checkpoint**: Shared foundation is ready; user stories can proceed independently.

---

## Phase 3: User Story 1 - Select Repo and See Status (Priority: P1)

**Goal**: Users can select a backend-known repository and understand health, freshness, indexing, unavailable, unauthorized, and no-repo states.

**Independent Test**: Open the web app against local backend fixtures for indexed, stale, indexing, unavailable, unauthorized, and missing-repo states and verify the repo picker/status surface shows the correct state and next available action.

### Tests for User Story 1

- [ ] T021 [P] [US1] Add repository/status API client tests in `web/src/tests/repository-api.test.ts`
- [ ] T022 [P] [US1] Add repo shell and status state tests in `web/src/tests/repository-shell.test.tsx`
- [ ] T023 [P] [US1] Add Playwright repo/status UAT coverage in `web/src/tests/repository-status.spec.ts`

### Implementation for User Story 1

- [ ] T024 [US1] Implement `/api/repos` and `/api/status` clients in `web/src/lib/api/repositories.ts`
- [ ] T025 [US1] Implement repository switcher component in `web/src/components/layout/RepositorySwitcher.tsx`
- [ ] T026 [US1] Implement repository health and freshness status display in `web/src/components/layout/RepositoryStatus.tsx`
- [ ] T027 [US1] Implement repository overview route in `web/src/routes/RepositoryOverview.tsx`
- [ ] T028 [US1] Wire repository switching reset behavior in `web/src/app/state.ts` and `web/src/app/routes.tsx`
- [ ] T029 [US1] Implement unauthorized and backend-unreachable repo states in `web/src/components/layout/StatePanel.tsx`

**Checkpoint**: US1 is independently functional and testable.

---

## Phase 4: User Story 2 - Search and Open Symbols (Priority: P1)

**Goal**: Users can search the selected repository, inspect result context, and open a symbol detail page with metadata and source context.

**Independent Test**: Search known symbols in an indexed repository and verify results link to a detail page with identifying metadata and source context.

### Tests for User Story 2

- [ ] T030 [P] [US2] Add search API client tests in `web/src/tests/search-api.test.ts`
- [ ] T031 [P] [US2] Add symbol detail API client tests in `web/src/tests/symbol-api.test.ts`
- [ ] T032 [P] [US2] Add search and symbol route UI tests in `web/src/tests/search-symbol.test.tsx`

### Implementation for User Story 2

- [ ] T033 [US2] Implement `/api/search` client and result unions in `web/src/lib/api/search.ts`
- [ ] T034 [US2] Implement `/api/node/{id}` client and symbol types in `web/src/lib/api/symbols.ts`
- [ ] T035 [US2] Implement global search input and results in `web/src/components/search/GlobalSearch.tsx`
- [ ] T036 [US2] Implement search route with loading, no-result, ambiguous, stale, degraded, and error states in `web/src/routes/SearchRoute.tsx`
- [ ] T037 [US2] Implement symbol detail route with metadata and source context in `web/src/routes/SymbolDetailRoute.tsx`
- [ ] T038 [US2] Preserve selected-symbol context and breadcrumbs in `web/src/components/layout/SelectedContextBar.tsx`
- [ ] T039 [US2] Add post-response rendering performance marks for search and symbol views in `web/src/routes/SearchRoute.tsx` and `web/src/routes/SymbolDetailRoute.tsx`

**Checkpoint**: US2 is independently functional and testable.

---

## Phase 5: User Story 3 - Inspect Symbol Relationships (Priority: P1)

**Goal**: Users can inspect callers, callees, flows, snippets, and trace-style context for a selected symbol.

**Independent Test**: Open a symbol with known relationships and verify relationship sections can be inspected without using a separate IDE agent or CLI.

### Tests for User Story 3

- [ ] T040 [P] [US3] Add callers and callees API client tests in `web/src/tests/relationships-api.test.ts`
- [ ] T041 [P] [US3] Add flows and clusters API client tests in `web/src/tests/catalog-api.test.ts`
- [ ] T042 [P] [US3] Add relationship panel UI tests in `web/src/tests/relationships-panel.test.tsx`

### Implementation for User Story 3

- [ ] T043 [US3] Implement callers and callees clients in `web/src/lib/api/relationships.ts`
- [ ] T044 [US3] Implement flows and clusters clients in `web/src/lib/api/catalogs.ts`
- [ ] T045 [US3] Implement callers/callees relationship panels in `web/src/components/symbol/RelationshipPanels.tsx`
- [ ] T046 [US3] Implement flow and trace-style catalog sections in `web/src/components/symbol/FlowSections.tsx`
- [ ] T047 [US3] Implement empty, unavailable, stale, truncated, and success-shaped catalog states in `web/src/components/symbol/RelationshipStates.tsx`
- [ ] T048 [US3] Integrate relationship sections into `web/src/routes/SymbolDetailRoute.tsx`

**Checkpoint**: US3 is independently functional and testable.

---

## Phase 6: User Story 4 - Explore Graph Neighborhoods (Priority: P1)

**Goal**: Users can visually explore graph neighborhoods with pan, zoom, filters, selection, and click-to-expand behavior while retaining non-canvas summaries.

**Independent Test**: Load a representative graph neighborhood, interact with the canvas, expand a node, and verify the visible graph and selected-node context update together.

### Tests for User Story 4

- [ ] T049 [P] [US4] Add graph API and transform tests in `web/src/tests/graph-transform.test.ts`
- [ ] T050 [P] [US4] Add graph canvas component tests in `web/src/tests/graph-view.test.tsx`
- [ ] T051 [P] [US4] Add Playwright nonblank canvas, keyboard controls, and graph performance coverage in `web/src/tests/graph-uat.spec.ts`

### Implementation for User Story 4

- [ ] T052 [US4] Add Cytoscape dependency and renderer setup in `web/package.json` and `web/src/lib/graph/cytoscape.ts`
- [ ] T053 [US4] Implement `/api/graph/{id}` client and graph transform layer in `web/src/lib/api/graph.ts` and `web/src/lib/graph/transform.ts`
- [ ] T054 [US4] Implement graph canvas component in `web/src/components/graph/GraphCanvas.tsx`
- [ ] T055 [US4] Implement graph toolbar controls for zoom, fit/reset, filter, focus, select, and expand in `web/src/components/graph/GraphToolbar.tsx`
- [ ] T056 [US4] Implement synchronized selected-node and neighbor summaries in `web/src/components/graph/GraphSummary.tsx`
- [ ] T057 [US4] Implement graph route and expansion behavior in `web/src/routes/GraphRoute.tsx`
- [ ] T058 [US4] Implement graph truncation, render-error, reduced-motion, and performance-threshold handling in `web/src/components/graph/GraphState.tsx`

**Checkpoint**: US4 is independently functional and testable.

---

## Phase 7: User Story 5 - Review Impact Radius (Priority: P2)

**Goal**: Maintainers can inspect likely impact radius, affected symbols, affected files, and traversal limits for a selected symbol.

**Independent Test**: Select a symbol with known downstream dependents and verify impact details include affected symbols, files, and traversal limits.

### Tests for User Story 5

- [ ] T059 [P] [US5] Add impact API and transform tests in `web/src/tests/impact-api.test.ts`
- [ ] T060 [P] [US5] Add impact route UI tests in `web/src/tests/impact-route.test.tsx`

### Implementation for User Story 5

- [ ] T061 [US5] Implement `/api/impact/{id}` client and impact transform layer in `web/src/lib/api/impact.ts`
- [ ] T062 [US5] Implement affected symbols and files tables in `web/src/components/impact/ImpactTables.tsx`
- [ ] T063 [US5] Implement impact limits, stale input, unavailable, truncated, and incomplete-result states in `web/src/components/impact/ImpactState.tsx`
- [ ] T064 [US5] Implement impact route in `web/src/routes/ImpactRoute.tsx`
- [ ] T065 [US5] Integrate impact navigation from symbol detail and graph selections in `web/src/routes/SymbolDetailRoute.tsx` and `web/src/routes/GraphRoute.tsx`

**Checkpoint**: US5 is independently functional and testable.

---

## Phase 8: User Story 6 - Re-analyze with Progress (Priority: P2)

**Goal**: Maintainers can trigger backend re-analysis and watch progress until completion, failure, stall, or disconnect.

**Independent Test**: Trigger a re-analysis job and verify progress, completion, failure, duplicate-start prevention, disconnect handling, terminal snapshots, and resulting repository freshness are visible.

### Tests for User Story 6

- [ ] T066 [P] [US6] Add re-analysis REST and SSE client tests in `web/src/tests/reindex-api.test.ts`
- [ ] T067 [P] [US6] Add re-analysis UI state tests in `web/src/tests/reindex-panel.test.tsx`
- [ ] T068 [P] [US6] Extend server reindex lifecycle coverage for terminal snapshots and disconnect semantics in `__tests__/server-reindex-jobs.test.ts`

### Implementation for User Story 6

- [ ] T069 [US6] Implement `/api/reindex/{repo}` REST and EventSource clients in `web/src/lib/api/reindex.ts`
- [ ] T070 [US6] Implement re-analysis start controls and duplicate-job handling in `web/src/components/reindex/ReindexControls.tsx`
- [ ] T071 [US6] Implement progress, terminal, stalled, disconnected, and already-finished snapshot states in `web/src/components/reindex/ReindexProgress.tsx`
- [ ] T072 [US6] Implement re-analysis route or panel in `web/src/routes/ReindexRoute.tsx`
- [ ] T073 [US6] Refresh repository freshness after terminal jobs in `web/src/app/state.ts` and `web/src/lib/api/repositories.ts`

**Checkpoint**: US6 is independently functional and testable.

---

## Phase 9: User Story 7 - Chat with Graph Context (Priority: P2)

**Goal**: Users can ask graph-grounded questions through a same-origin browser chat backed by SPEC-018, with honest disabled/fallback states and no browser provider secrets.

**Independent Test**: Ask a repository question through the browser, verify the request goes only to the local backend, and verify visible answers, fallback, pending-bundle, or disabled states.

### Tests for User Story 7

- [ ] T074 [P] [US7] Add server chat adapter contract tests in `__tests__/server-chat-adapter.test.ts`
- [ ] T075 [P] [US7] Add web chat API client tests in `web/src/tests/chat-api.test.ts`
- [ ] T076 [P] [US7] Add chat panel UI state tests in `web/src/tests/chat-panel.test.tsx`
- [ ] T077 [P] [US7] Add Playwright network-boundary coverage for no browser provider calls in `web/src/tests/chat-network.spec.ts`

### Implementation for User Story 7

- [ ] T078 [US7] Implement SPEC-018 chat adapter route handlers in `src/server/chat.ts`
- [ ] T079 [US7] Wire `/api/chat/status`, `/api/chat/messages`, and `/api/chat/bundles/{handle}` routes in `src/server/routes.ts`
- [ ] T080 [US7] Implement chat adapter error-envelope and result-mapping behavior in `src/server/chat.ts`
- [ ] T081 [US7] Implement browser chat status, message, and bundle clients in `web/src/lib/api/chat.ts`
- [ ] T082 [US7] Implement chat panel with disabled, dormant, misconfigured, pending-bundle, fallback, answer, rate-limited, and error states in `web/src/components/chat/ChatPanel.tsx`
- [ ] T083 [US7] Integrate selected repo, symbol, view hints, and context-boundary display in `web/src/components/chat/ChatContextBoundary.tsx`
- [ ] T084 [US7] Integrate chat route and symbol-context entry points in `web/src/routes/ChatRoute.tsx` and `web/src/routes/SymbolDetailRoute.tsx`

**Checkpoint**: US7 is independently functional and testable.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Validate package delivery, accessibility, performance, clean-room evidence, and final review material across all stories.

- [ ] T085 [P] Add package/offline/no-CDN Playwright coverage in `web/src/tests/package-offline.spec.ts`
- [ ] T086 [P] Add accessibility regression coverage for keyboard, focus, names, status announcements, graph/impact mirrors, contrast, target size, reduced motion, and reflow in `web/src/tests/accessibility.spec.ts`
- [ ] T087 [P] Add performance validation coverage for NFR-001 through NFR-006 in `web/src/tests/performance.spec.ts`
- [ ] T088 [P] Add mobile layout and no-overlap coverage in `web/src/tests/mobile-layout.spec.ts`
- [ ] T089 Update release notes under `## [Unreleased]` in `CHANGELOG.md`
- [ ] T090 Update package/static documentation and non-loopback guidance in `README.md`
- [ ] T091 Record quickstart validation evidence in `specs/006-web-ui-graph-browser/quickstart.md`
- [ ] T092 Create PR review packet with review order, scope budget, traceability, verification evidence, known gaps, rollback notes, and clean-room ledger in `specs/006-web-ui-graph-browser/review-packet.md`
- [ ] T093 Run full verification commands and record results in `specs/006-web-ui-graph-browser/review-packet.md`
- [ ] T094 Run `codegraph serve --web` packaged UAT and record local/package results in `specs/006-web-ui-graph-browser/review-packet.md`
- [ ] T095 Update chat adapter OpenAPI route documentation in `src/server/openapi.yaml`
- [ ] T096 Record self-repo dogfood UAT results in `specs/006-web-ui-graph-browser/review-packet.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on setup; blocks all user stories.
- **US1-US4 (P1)**: Depend on foundation. Deliver the first review slice: foundation/search/symbol plus graph canvas.
- **US5-US7 (P2)**: Depend on foundation and may use selected-symbol context from US2 and graph context from US4.
- **Polish (Phase 10)**: Depends on all desired user stories and validates cross-cutting acceptance criteria.

### User Story Dependencies

- **US1 Select Repo and See Status**: Starts after foundation; no other story dependency.
- **US2 Search and Open Symbols**: Starts after foundation; uses selected repository from US1 but can be tested with seeded state.
- **US3 Inspect Symbol Relationships**: Starts after foundation; uses selected symbol from US2 but can be tested with direct route state.
- **US4 Explore Graph Neighborhoods**: Starts after foundation; uses selected symbol from US2 but can be tested with direct route state.
- **US5 Review Impact Radius**: Starts after foundation; integrates best after US2 because it uses selected-symbol navigation.
- **US6 Re-analyze with Progress**: Starts after foundation; independent of graph and chat.
- **US7 Chat with Graph Context**: Starts after foundation; integrates best after US2/US4 for selected symbol and graph hints.

### Within Each User Story

- Write story tests before implementation.
- Implement API clients before route components.
- Implement route components before Playwright/UAT stabilization.
- Complete story checkpoint before expanding to the next review slice.

---

## Parallel Opportunities

- Setup tasks T003, T004, T005, and T007 can run in parallel.
- Foundational helper tasks T011, T012, T013, T016, and T017 can run in parallel after T009-T010 are understood.
- Test tasks inside each story can run in parallel with each other.
- US1, US2, US3, and US4 can be staffed in parallel after foundation if direct-route test fixtures are used.
- US5, US6, and US7 can be staffed in parallel after foundation; US7 integration is smoother after US2/US4.
- Polish validation tasks T085 through T088 can run in parallel once the corresponding features exist.

## Parallel Example: P1 Slice

```bash
Task: "T021 [US1] Add repository/status API client tests in web/src/tests/repository-api.test.ts"
Task: "T030 [US2] Add search API client tests in web/src/tests/search-api.test.ts"
Task: "T040 [US3] Add callers and callees API client tests in web/src/tests/relationships-api.test.ts"
Task: "T049 [US4] Add graph API and transform tests in web/src/tests/graph-transform.test.ts"
```

## Parallel Example: P2 Slice

```bash
Task: "T059 [US5] Add impact API and transform tests in web/src/tests/impact-api.test.ts"
Task: "T066 [US6] Add re-analysis REST and SSE client tests in web/src/tests/reindex-api.test.ts"
Task: "T074 [US7] Add server chat adapter contract tests in __tests__/server-chat-adapter.test.ts"
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete US1 and US2 to make repository selection, search, and symbol detail usable.
3. Stop and validate US1-US2 independently before graph work.

### Review Slice Order

1. **Slice 1**: Setup, foundation, US1, US2, US3.
2. **Slice 2**: US4 graph canvas and non-canvas graph summaries.
3. **Slice 3**: US5 impact, US6 re-analysis, US7 chat, package/offline/accessibility/performance polish.

### Final Validation

1. Run `npm run build`.
2. Run `npm run typecheck`.
3. Run `npm test`.
4. Run web test and Playwright commands added under `web/package.json`.
5. Run packaged `codegraph serve --web` UAT from `quickstart.md`.
6. Run the self-repo dogfood UAT from `quickstart.md`.
7. Record evidence in `specs/006-web-ui-graph-browser/review-packet.md`.
