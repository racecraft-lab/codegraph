# Tasks: In-Browser Indexing

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/`, and the SPEC-007 design concept.

**Organization**: Tasks follow three independently demonstrable vertical
slices. Every behavior task uses RED → GREEN → REFACTOR, names concrete files,
and records focused verification before its checkbox may be marked complete.

## Task Format

- **[P]** means the task changes files that do not overlap another task that is
  eligible at the same point.
- **[US1]** through **[US7]** identify the independently testable user story.
- `FR-XXX` references are the authoritative requirement mapping.
- A task is complete only after its RED evidence is observed, GREEN evidence
  passes, REFACTOR preserves the focused test, and the stated evidence is
  recorded in the implementation handoff.

## Phase 1: Bounded Setup

**Purpose**: Establish the exact dependency, shipped-asset, and fixture seams
needed by the first vertical slice without creating a layer-only deliverable.

- [ ] T001 [US7] Pin the permissively licensed `@sqlite.org/sqlite-wasm@3.53.0-build1` dependency and declare its worker/WASM asset flow in `package.json` and `web/vite.config.ts` (`FR-003`, `FR-027`, `FR-045`, `FR-046`, `FR-062`).
  - **RED**: Extend `web/src/tests/local-indexing-packaged.spec.ts` to fail when the exact dependency, worker entry, SQLite WASM, or package asset is missing, empty, CDN-backed, or dev-server-only.
  - **GREEN**: Add the exact dependency and minimum build/asset declarations needed for the packaged test to find same-origin assets.
  - **REFACTOR**: Centralize asset-base resolution without adding a second build path or runtime fallback.
  - **Evidence**: Focused packaged test plus `npm run build`.

- [ ] T002 [P] [US1] Add deterministic browser-indexing fixture trees and semantic projection helpers under `__tests__/fixtures/browser-indexing/` and `__tests__/extraction-browser-kernel.test.ts` (`FR-005`, `FR-007`, `FR-047`, `FR-053`).
  - **RED**: Add fixtures whose nested ignores, extension overrides, binary/oversize files, traversal-shaped entries, and delegate grammars expose missing parity behavior.
  - **GREEN**: Define the accepted-manifest, language-map, graph projection, warning-code, and lazy-grammar expectations consumed by later tasks.
  - **REFACTOR**: Reuse canonical fixture builders and exclude runtime-specific ids, timestamps, and row order.
  - **Evidence**: Focused fixture test reaches the intended failing assertions before T004.

## Phase 2: Slice 1 — Browser Graph Bootstrap

**Goal**: A Chromium user deliberately opens a local folder, builds a durable
keyword graph off the main thread, and browses overview/search/source without a
server or network egress.

### User Story 1 — Open a Local Folder

- [ ] T003 [P] [US1] Add the shared source-cache/generation migration through `src/db/schema.sql`, `src/db/migrations.ts`, and `__tests__/db-browser-source-cache-migration.test.ts` (`FR-009`, `FR-010`, `FR-038`, `FR-039`).
  - **RED**: Prove the canonical migration stream lacks source-cache, generation, and publication metadata and rejects a browser-only schema fork.
  - **GREEN**: Add the smallest shared schema/migration entries needed by Node and browser storage.
  - **REFACTOR**: Preserve existing Node migrations and centralize schema-version invariants.
  - **Evidence**: Focused migration test and root typecheck.

- [ ] T004 [P] [US1] Extract the runtime-neutral source-to-graph kernel in `src/extraction/browser-kernel.ts` and adapt `src/extraction/index.ts` without importing Node-only modules into the browser seam (`FR-005`, `FR-006`, `FR-007`, `FR-047`, `FR-053`, `FR-061`).
  - **RED**: Run the T002 cross-runtime fixtures and capture manifest, grammar, warning, and semantic-projection failures.
  - **GREEN**: Implement injected source/language inputs, lazy grammar selection, deterministic extraction, traversal admission, and per-file resource release.
  - **REFACTOR**: Remove duplicated Node/browser graph materialization while preserving the Node adapter and existing extraction tests.
  - **Evidence**: `npx vitest run __tests__/extraction-browser-kernel.test.ts` plus focused existing extraction tests.

- [ ] T005 [US1] Implement explicit picked-folder and snapshot source providers in `web/src/local-indexing/source.ts` with focused cases in `web/src/tests/local-indexing-worker.test.ts` (`FR-002`, `FR-005`, `FR-020`, `FR-037`, `FR-040`, `FR-053`, `FR-059`).
  - **RED**: Fail on automatic prompts, host-path leakage, duplicate normalized paths, recursive cycles, ignore drift, unbounded reads, and rejected files entering accepted manifests.
  - **GREEN**: Add user-activation-only handle intake, opaque identity inputs, nested selection parity, bounded batches, hashes, snapshot manifests, and warning caps.
  - **REFACTOR**: Share normalization/admission helpers with the extraction kernel without retaining live handles in transferable payloads.
  - **Evidence**: Focused source-provider cases in the worker test.

- [ ] T006 [US1] Implement SQLite-Wasm SAH-pool storage and atomic generation publication in `web/src/local-indexing/sqlite.ts` with failure cases in `web/src/tests/local-indexing-worker.test.ts` (`FR-009`, `FR-010`, `FR-017`, `FR-038`, `FR-039`, `FR-055`, `FR-058`, `FR-061`).
  - **RED**: Demonstrate missing schema migration, partial publication, quota/write failure, stale staging, and unclosed-handle behavior against the prior readable generation.
  - **GREEN**: Open the canonical schema in OPFS, stage graph/cache/manifest/status together, publish one generation, retain the prior generation on failure, and close statements/VFS ownership deterministically.
  - **REFACTOR**: Isolate SQLite adapter boundaries and keep registry-only state outside the canonical graph schema.
  - **Evidence**: Focused real SQLite-Wasm worker test; no database mock for publication/recovery behavior.

- [ ] T007 [US1] Implement versioned worker RPC, lazy grammar loading, progress, cancellation, budgets, and resource cleanup in `web/src/local-indexing/worker.ts` (`FR-006`, `FR-008`, `FR-041`, `FR-048`, `FR-059`, `FR-061`).
  - **RED**: Fail on raw runtime errors, multiple terminal events, stale cancel/results, eager grammars, per-item progress floods, budget overruns, cancellation publication, and unreleased resources.
  - **GREEN**: Add structured-clone-safe v1 envelopes, one terminal state, coalesced progress, operation-scoped cancel, lazy grammar manifests, bounded transfers, and close cleanup.
  - **REFACTOR**: Centralize error redaction and operation lifecycle transitions without weakening type exhaustiveness.
  - **Evidence**: `npx vitest run web/src/tests/local-indexing-worker.test.ts`.

- [ ] T008 [US1] Introduce the typed repository-client boundary in `web/src/lib/repository-client.ts`, bridge existing REST behavior in `web/src/lib/api/client.ts`, and add local worker transport in `web/src/local-indexing/client.ts` (`FR-001`, `FR-008`, `FR-011`, `FR-035`, `FR-041`).
  - **RED**: Add client tests that fail when REST and local implementations diverge in result/error/status shapes or stale worker messages affect the active request.
  - **GREEN**: Implement the minimum shared methods for repositories, overview, search, symbol/source, relationships, graph, impact, refresh, and delete.
  - **REFACTOR**: Keep one SPA-facing interface and remove route-level runtime branching that the client can own.
  - **Evidence**: `npx vitest run web/src/tests/local-indexing-client.test.tsx`.

- [ ] T009 [US1] Add the deliberate **Open local folder** entry, runtime labels, progress/cancel states, and focus/live-region behavior in `web/src/components/layout/RepositorySwitcher.tsx` and `web/src/routes/RepositoryOverview.tsx` (`FR-001`, `FR-002`, `FR-012`, `FR-030`, `FR-031`, `FR-050`, `FR-051`).
  - **RED**: Add component tests for no automatic picker, missing Server/Local folder/Local snapshot labels, unreachable controls, focus loss, and silent progress/terminal states.
  - **GREEN**: Wire the local client from direct activation and expose accessible progress, cancellation, status, and trust-boundary labels.
  - **REFACTOR**: Reuse existing shell/status primitives and preserve server behavior.
  - **Evidence**: Focused app-shell and local-client component tests.

- [ ] T010 [US2] Route local overview, keyword search, symbol, and cached source reads through `LocalRepositoryClient` in `web/src/lib/repository-client.ts`, `web/src/routes/RepositoryOverview.tsx`, `web/src/routes/SymbolDetailRoute.tsx`, `web/src/components/symbol/SourcePane.tsx`, and `web/src/lib/lsp/client.ts` (`FR-010`, `FR-011`, `FR-013`, `FR-021`, `FR-035`, `FR-044`, `FR-054`).
  - **RED**: Add local-route cases that fail on daemon fetch fallback, any `/lsp` WebSocket connection, disabled core routes, raw HTML/source-derived URLs, or enabled LSP-only/server-only actions.
  - **GREEN**: Serve cached local source through `LocalRepositoryClient.getSource`, keep core routes enabled, render plain text/tokens, prevent `BrowserLspClient` from connecting for local repositories, and disable hover/definition/references with an honest LSP-only explanation.
  - **REFACTOR**: Share source-route presentation and source models while keeping the server LSP client available only for server repositories.
  - **Evidence**: Focused `web/src/tests/local-indexing-client.test.tsx` and malicious-source route/component tests proving local source never opens `/lsp`.

- [ ] T011 [US1] Complete the real Chromium folder-to-keyword journey in `web/src/tests/local-indexing-full.spec.ts` (`FR-001` through `FR-010`, `FR-025`, `FR-027`, `FR-031`, `FR-037` through `FR-041`, `FR-044`, `FR-047`, `FR-048`).
  - **RED**: Record the first failing secure-context picker/import/index/reload/search/source journey using real worker, WASM, OPFS, and shipped grammar assets.
  - **GREEN**: Make the journey complete with zero repository-derived network calls, visible progress/cancel, durable cached source, and deterministic parity output.
  - **REFACTOR**: Extract stable Playwright fixtures without mocking SQLite-Wasm, OPFS, or parser WASM.
  - **Evidence**: Chromium Playwright trace plus focused unit/root suites.

- [ ] T012 [US1] Run the Slice 1 reviewability and regression checkpoint, fixing only slice-owned defects (`FR-028`).
  - **RED**: Capture changed production files/LOC, failed focused tests, and any fourth capability surface or undeclared file.
  - **GREEN**: Keep the slice inside the declared source/storage/worker/client/UI ownership and pass root build/typecheck, focused root/web tests, and Chromium Slice 1 UAT.
  - **REFACTOR**: Simplify only code introduced in T003–T011; stop for consensus if the ratified three-slice boundary is exceeded.
  - **Evidence**: Diff budget record and clean Slice 1 verification log.

## Phase 3: Slice 2 — Local Repository Shell And Lifecycle

**Goal**: Local repositories support the complete core graph experience,
bounded impact, reload/reconnect, incremental refresh, busy/quota states, and
safe deletion while preserving the last good generation.

### User Story 2 — Browse the Local Graph Experience

- [ ] T013 [US2] Complete relationships and graph query parity in `web/src/local-indexing/sqlite.ts` and `web/src/lib/repository-client.ts` (`FR-011`, `FR-026`, `FR-035`, `FR-060`).
  - **RED**: Add client/worker cases that expose response-shape drift, unpublished-generation reads, unbounded candidates, and missing query-plan evidence.
  - **GREEN**: Implement bounded relationship/graph reads using existing result types and indexed/FTS query paths.
  - **REFACTOR**: Share row mappers and query-limit constants with REST semantics.
  - **Evidence**: Focused worker/client tests plus captured browser SQLite query plans.

- [ ] T014 [US2] Finish local/server route context, honest disabled states, mobile layout, and trust-boundary accessibility in `web/src/components/layout/RepositorySwitcher.tsx` and `web/src/routes/RepositoryOverview.tsx` (`FR-012`, `FR-013`, `FR-030`, `FR-035`, `FR-050`, `FR-051`).
  - **RED**: Fail keyboard, focus restoration, status announcement, 320 CSS px, reduced-motion, and server-only explanation cases.
  - **GREEN**: Reuse the existing shell while making runtime, status, and unavailable capabilities explicit at every relevant route/action.
  - **REFACTOR**: Consolidate status/action presentation without altering server repository UX.
  - **Evidence**: Focused accessibility/responsive component tests.

### User Story 3 — Inspect Local Impact

- [ ] T015 [US3] Implement bounded impact queries and explainable affected-file results in `web/src/local-indexing/sqlite.ts` and the shared repository client (`FR-011`, `FR-026`, `FR-035`, `FR-060`).
  - **RED**: Add known-symbol fixtures that fail on unbounded traversal, missing explanation fields, response drift, or full scans without rationale.
  - **GREEN**: Add bounded indexed queries that match current impact semantics and published-generation isolation.
  - **REFACTOR**: Reuse graph/relationship query helpers while preserving explicit limits.
  - **Evidence**: Focused worker/client impact tests and query-plan capture.

- [ ] T016 [US3] Add user-observed graph/impact latency coverage to `web/src/tests/local-indexing-full.spec.ts` (`FR-026`, `FR-048`, `FR-060`).
  - **RED**: Capture a deterministic suite that fails without one warmup, 20 measured samples, action-to-render timing, p95 calculation, and query-plan evidence.
  - **GREEN**: Meet p95 ≤150 ms for search, graph navigation, and bounded impact on the documented fixture.
  - **REFACTOR**: Share timing/evidence helpers with existing web performance marks.
  - **Evidence**: Playwright timing artifact with per-operation samples and p95.

### User Story 4 — Reconnect, Refresh, And Delete

- [ ] T017 [US4] Implement the origin-scoped repository registry, saved-handle identity, cached reopen, and explicit reconnect in `web/src/local-indexing/client.ts` and `web/src/local-indexing/source.ts` (`FR-016`, `FR-032`, `FR-037`).
  - **RED**: Fail on host-path identity, automatic permission requests, cached-browse loss, same-entry mismatch, and refresh enabled before reconnect.
  - **GREEN**: Persist only opaque identity/handle metadata, reopen last-good data, and request reconnect permission from direct activation.
  - **REFACTOR**: Separate durable registry metadata from live handle/permission state.
  - **Evidence**: Focused client tests covering granted, prompt, denied, and stale handles.

- [ ] T018 [US4] Implement manifest-hash incremental refresh and deterministic result counts in `web/src/local-indexing/source.ts`, `web/src/local-indexing/worker.ts`, and `web/src/local-indexing/sqlite.ts` (`FR-014`, `FR-015`, `FR-038`, `FR-040`, `FR-057`).
  - **RED**: Add one added/changed/deleted/unchanged/skipped-warning fixture and prove graph/cache/manifest/count drift or partial publication.
  - **GREEN**: Stage only changed work, remove deleted rows, retain unchanged data, cap warnings, and publish matching generation/count metadata.
  - **REFACTOR**: Reuse the initial-index generation transaction and hash helpers.
  - **Evidence**: Focused worker refresh test with exact counts and generation ids.

- [ ] T019 [US4] Harden cancel, crash, quota, migration, and database-write recovery across the worker/storage boundary (`FR-015`, `FR-038`, `FR-041`, `FR-058`).
  - **RED**: Inject each named failure after source staging, graph write, registry publish, status update, and delete cleanup and observe falsely complete or lost last-good state.
  - **GREEN**: Preserve/restore the prior readable generation, expose non-complete stable status, ignore stale messages, and clean staging on next open.
  - **REFACTOR**: Centralize recovery transitions and failure injection points.
  - **Evidence**: Focused real SQLite-Wasm recovery matrix.

- [ ] T020 [US4] Implement per-repository Web Lock ownership, busy/retry state, deterministic close, and stale-ownership recovery in `web/src/local-indexing/client.ts`, `web/src/local-indexing/worker.ts`, and `web/src/local-indexing/sqlite.ts` (`FR-018`, `FR-034`, `FR-055`, `FR-061`).
  - **RED**: Demonstrate a second tab opening storage concurrently, actions enabled while busy, leaked lock/DB handles, and next-open stale ownership marked complete.
  - **GREEN**: Acquire before storage open, expose Retry/Switch repository, disable local actions, close DB/VFS before release, and recover stale metadata safely.
  - **REFACTOR**: Keep lock lifecycle in one client/worker boundary.
  - **Evidence**: Multi-page Playwright and focused close/crash tests.

- [ ] T021 [US4] Add quota estimate, persistence request, and quota/permission status flows in `web/src/local-indexing/client.ts` and repository UI (`FR-017`, `FR-030`, `FR-038`, `FR-058`).
  - **RED**: Fail when persistence prompts automatically, quota failures look complete, or the UI implies automatic eviction.
  - **GREEN**: Report storage usage/persistence, request only from direct action, preserve last-good data, and show stable recovery guidance.
  - **REFACTOR**: Reuse status/error presentation from T014.
  - **Evidence**: Focused client/component tests for supported, denied, and quota-blocked cases.

- [ ] T022 [US4] Implement typed-name deletion, active-operation cancellation choice, and complete browser-owned cleanup in the repository client/UI (`FR-029`, `FR-036`, `FR-052`, `FR-055`, `FR-058`).
  - **RED**: Fail on deletion without exact name, missing source-folder safety text, reads/actions during delete, partial browser-data removal, source-handle writes, and active-operation ambiguity.
  - **GREEN**: Confirm runtime/name/data classes, cancel or retain active work explicitly, close storage, delete graph/cache/registry/semantic state, and restore prior readable state on failure.
  - **REFACTOR**: Share cleanup order with recovery and close paths.
  - **Evidence**: Focused client/component deletion tests and source-folder no-write assertion.

- [ ] T023 [US4] Validate reload, reconnect, refresh, cancel/failure, busy, quota, and delete as one real-browser lifecycle in `web/src/tests/local-indexing-full.spec.ts` (`FR-014` through `FR-018`, `FR-029`, `FR-030`, `FR-032`, `FR-034`, `FR-036`, `FR-040`, `FR-050` through `FR-052`, `FR-055`, `FR-057`, `FR-058`).
  - **RED**: Record the failing end-to-end lifecycle with controlled file mutations and fault injection.
  - **GREEN**: Pass every visible state and last-good/no-source-write assertion against real browser storage.
  - **REFACTOR**: Extract deterministic lifecycle helpers without hiding individual expected states.
  - **Evidence**: Chromium Playwright trace plus focused lifecycle suites.

- [ ] T024 [US4] Run the Slice 2 reviewability and regression checkpoint, fixing only slice-owned defects (`FR-028`).
  - **RED**: Capture changed files/LOC, unresolved lifecycle failures, and any new capability surface outside the accepted slice.
  - **GREEN**: Pass root build/typecheck, focused root/web tests, complete Chromium lifecycle UAT, and the Slice 1 regression journey.
  - **REFACTOR**: Simplify only T013–T023 changes; stop for consensus on boundary expansion.
  - **Evidence**: Diff budget record and clean Slice 2 verification log.

## Phase 4: Slice 3 — Degradation, Semantic Opt-In, And Shipping

**Goal**: Unsupported environments degrade honestly, semantic search is
explicit and secret-safe, and the shipped package proves privacy,
accessibility, determinism, performance, and asset completeness.

### User Story 5 — Degrade Honestly

- [ ] T025 [P] [US5] Implement independent secure-context, picker, drop-entry, OPFS, persistence, and Web Lock capability probes in `web/src/local-indexing/capabilities.ts` (`FR-004`, `FR-019`, `FR-049`).
  - **RED**: Add matrix tests that fail on browser-name inference, false full-path promises, or collapsed storage/lock results.
  - **GREEN**: Return the contract-defined capability report and exact user guidance from live probes.
  - **REFACTOR**: Keep probes pure/testable and separate from permission-triggering actions.
  - **Evidence**: `npx vitest run web/src/tests/local-indexing-capabilities.test.ts`.

- [ ] T026 [P] [US5] Complete bounded directory-drop snapshot identity/import in `web/src/local-indexing/source.ts` and registry client (`FR-020`, `FR-033`, `FR-037`, `FR-053`, `FR-059`).
  - **RED**: Fail on merged imports, reconnect/freshness claims, duplicate-fingerprint ambiguity, traversal admission, and unbounded transfer.
  - **GREEN**: Create a distinct opaque snapshot with import time, fingerprint warning, immutable accepted manifest, and explicit Replace choice.
  - **REFACTOR**: Reuse accepted-source admission while keeping snapshot and picked-folder semantics distinct.
  - **Evidence**: Focused snapshot source/client tests.

- [ ] T027 [US5] Add Chromium full-path plus Firefox/WebKit degradation coverage in `web/src/tests/local-indexing-degradation.spec.ts` (`FR-004`, `FR-019`, `FR-020`, `FR-033`, `FR-049`, `FR-051`, `FR-053`).
  - **RED**: Capture missing-capability guidance, inaccessible fallback, or accidental picker/reconnect promises in each engine project.
  - **GREEN**: Pass Chromium full probes and Firefox/WebKit independent guidance/drop behavior without false parity claims.
  - **REFACTOR**: Share capability assertions while retaining engine-specific expected support.
  - **Evidence**: Playwright Chromium, Firefox, and WebKit project results.

### User Story 6 — Opt Into Semantic Search

- [ ] T028 [P] [US6] Implement secret-free embedding profile persistence and memory-only credential intake in `web/src/local-indexing/embeddings.ts` (`FR-021`, `FR-022`, `FR-042`, `FR-044`).
  - **RED**: Fail storage/URL/log/error scans when keys, authorization material, userinfo, query/fragment components, or raw source/provider data persist.
  - **GREEN**: Store only canonical origin/model/dimensions/consent/generation/coverage/hash/resume state and require key re-entry after reload.
  - **REFACTOR**: Centralize redaction and serialization allowlists.
  - **Evidence**: Focused embedding/storage tests and durable-state audit.

- [ ] T029 [P] [US6] Implement fail-closed semantic endpoint validation and redacted transport/provider errors in `web/src/local-indexing/embeddings.ts` (`FR-024`, `FR-043`, `FR-045`).
  - **RED**: Fail insecure URL, mixed-content, CORS/TLS/network, HTTP, model/dimension, partial-response, cancel, and unavailable cases that leak details or offer unsafe bypasses.
  - **GREEN**: Emit stable safe codes, redacted origin, retry guidance, and no proxy/no-CORS/insecure override.
  - **REFACTOR**: Share error mapping with worker plain-object envelopes.
  - **Evidence**: Focused transport error table tests.

- [ ] T030 [US6] Add the post-keyword cancellable/resumable embedding worker path and vector convergence checks in `web/src/local-indexing/worker.ts`, `web/src/local-indexing/sqlite.ts`, and `web/src/local-indexing/embeddings.ts` (`FR-023`, `FR-041`, `FR-056`, `FR-061`, `FR-063`).
  - **RED**: Fail mixed model/dimension/generation results, keyword disablement, unbounded endpoint/vector batches, post-cancel calls, and unusable resume state.
  - **GREEN**: Run a distinct operation after keyword publication, validate hashes/dimensions, batch under declared ceilings, resume safely, and mark stale/unavailable without affecting keyword reads.
  - **REFACTOR**: Reuse operation lifecycle and generation metadata without coupling keyword publication to endpoint availability.
  - **Evidence**: Focused worker/embedding tests.

- [ ] T031 [US6] Enforce the no-consent and explicit-consent network boundary in `web/src/tests/local-indexing-network.spec.ts` (`FR-021`, `FR-022`, `FR-024`, `FR-042` through `FR-045`, `FR-054`, `FR-063`).
  - **RED**: Intercept fetch/XHR/WebSocket/beacon/external asset traffic and expose any repository-derived request before consent, including `/lsp`, or source-derived request after consent.
  - **GREEN**: Allow only enumerated same-origin shipped assets before consent, prove local source browsing opens no `/lsp` WebSocket, and allow only the configured secure endpoint with memory-only authorization afterward.
  - **REFACTOR**: Keep the request audit allowlist explicit and fail-closed.
  - **Evidence**: Network log proving zero no-consent repository egress and redacted consent traffic.

- [ ] T032 [US6] Prove semantic progress/cancel/resume and concurrent local-read responsiveness in `web/src/tests/local-indexing-full.spec.ts` (`FR-023`, `FR-026`, `FR-048`, `FR-056`, `FR-059` through `FR-061`, `FR-063`).
  - **RED**: Capture blocked controls, post-cancel endpoint calls, stale vectors, or p95 >150 ms while embedding is active/paused/failed/cancelled.
  - **GREEN**: Keep progress/cancel actionable, resume consistent with the graph generation, and satisfy local read p95.
  - **REFACTOR**: Reuse deterministic timing and operation evidence helpers.
  - **Evidence**: Playwright trace, endpoint call log, and p95 samples.

### User Story 7 — Verify The Shipped Build

- [ ] T033 [US7] Complete fail-closed worker/WASM/grammar/database asset packaging and lazy request evidence in `package.json`, `web/vite.config.ts`, and `web/src/tests/local-indexing-packaged.spec.ts` (`FR-003`, `FR-006`, `FR-027`, `FR-045`, `FR-046`, `FR-062`).
  - **RED**: Remove or corrupt each required asset and prove build/package/static-host verification fails; prove initial routes eagerly loading SQLite/tree-sitter/grammar assets also fail.
  - **GREEN**: Copy non-empty same-origin assets into `dist/web` and the package, resolve through asset base, and request only after local-index/language demand.
  - **REFACTOR**: Keep one asset manifest/copy source of truth.
  - **Evidence**: Root build, packaged test, byte inventory, and request-order trace.

- [ ] T034 [US7] Add keyboard/focus/live-status/mobile/reduced-motion acceptance coverage to `web/src/tests/local-indexing-full.spec.ts` and component tests (`FR-012`, `FR-030`, `FR-031`, `FR-034` through `FR-036`, `FR-050` through `FR-052`).
  - **RED**: Fail every required local flow using keyboard-only navigation, focus checks, status/alert observation, 320 CSS px viewport, and reduced-motion preference.
  - **GREEN**: Make import/reconnect/refresh/cancel/busy/quota/unsupported/semantic/delete flows pass without horizontal control/status scrolling or non-essential motion.
  - **REFACTOR**: Consolidate accessible operation/status primitives.
  - **Evidence**: Focused component tests and Playwright accessibility trace.

- [ ] T035 [US7] Run and harden the documented self-repository performance/resource suite in `web/src/tests/local-indexing-full.spec.ts` (`FR-025`, `FR-026`, `FR-048`, `FR-059` through `FR-063`).
  - **RED**: Capture failing ≤60-second keyword index, heartbeat/long-task, 20-sample p95, budget-overrun, query-plan, asset, and repeated cleanup evidence under disclosed conditions.
  - **GREEN**: Meet the canonical thresholds without weakening correctness, privacy, or deterministic output.
  - **REFACTOR**: Optimize only measured bottlenecks and preserve the declared budgets.
  - **Evidence**: Hardware/software disclosure, timing samples, query plans, resource high-water/post-cleanup, and run count.

- [ ] T036 [US7] Complete cross-runtime, three-browser, offline/privacy, and packaged-host acceptance in `web/src/tests/local-indexing-full.spec.ts`, `web/src/tests/local-indexing-degradation.spec.ts`, `web/src/tests/local-indexing-network.spec.ts`, and `web/src/tests/local-indexing-packaged.spec.ts` (`FR-003`, `FR-007`, `FR-025`, `FR-027`, `FR-044` through `FR-049`, `FR-062`).
  - **RED**: Run the full matrix and record parity, browser-guidance, offline, CSP, network, or packaged-host failures.
  - **GREEN**: Pass deterministic semantic projections, Chromium full path, Firefox/WebKit degradation, zero no-consent egress, trusted-host CSP, and package/static-host loading.
  - **REFACTOR**: Deduplicate test fixtures without collapsing independent acceptance assertions.
  - **Evidence**: Full browser matrix and root/web verification logs.

- [ ] T037 [P] [US7] Update user-facing release notes under `CHANGELOG.md` `[Unreleased]` and validate `specs/007-in-browser-indexing/quickstart.md` against the shipped flow (`FR-003`, `FR-004`, `FR-019`, `FR-022`, `FR-027`, `FR-045`, `FR-046`).
  - **RED**: Follow the current quickstart against the packaged build and record any inaccurate command, capability, security, or benchmark statement.
  - **GREEN**: Correct only verified user-facing guidance and add a symptom/capability-first changelog entry.
  - **REFACTOR**: Remove implementation-internal wording and keep non-goals explicit.
  - **Evidence**: Executed quickstart checklist and changelog diff.

- [ ] T038 [US7] Run the Slice 3/final reviewability and regression checkpoint, fixing only in-scope defects (`FR-028`).
  - **RED**: Capture final production files/LOC, undeclared files, all focused/full failures, unresolved acceptance evidence, and any fourth capability class.
  - **GREEN**: Pass root build/typecheck/tests, web tests, Chromium full UAT, Firefox/WebKit degradation, privacy/package/performance gates, and all prior slice regressions.
  - **REFACTOR**: Simplify new code only; stop for consensus if the ratified boundary or non-goals are violated.
  - **Evidence**: Final diff budget, full verification record, and clean worktree.

## Dependencies And Execution Order

- T001 and T002 may run in parallel.
- Slice 1 starts after T001–T002. T003 and T004 may run in parallel; T005
  depends on T002/T004, T006 on T001/T003, T007 on T004–T006, T008 on T007,
  T009–T010 on T008, T011 on T003–T010, and T012 on T011.
- Slice 2 starts after T012. T013–T016 are sequential around the shared query
  seam. T017–T022 are sequential around registry/worker/storage lifecycle.
  T023 depends on T013–T022 and T024 depends on T023.
- Slice 3 starts after T024. T025 and T026 may run in parallel. T027 depends on
  both. T028 and T029 may run in parallel; T030 depends on both; T031–T032
  depend on T030. T033–T036 are sequential because they share package/browser
  evidence. T037 may run in parallel with T035–T036 after T033. T038 is last.
- Tasks sharing `src/extraction/`, schema/migrations, worker protocol,
  SQLite/generation storage, or the repository-client boundary are never
  parallelized.

## User Story Coverage

| Story | Tasks | Independent completion evidence |
|---|---|---|
| US1 | T002–T009, T011–T012 | Deliberate Chromium folder open through durable keyword index |
| US2 | T010, T013–T014 | Local overview/search/symbol/source/relationships/graph |
| US3 | T015–T016 | Bounded explainable impact with user-observed p95 |
| US4 | T017–T024 | Reload/reconnect/refresh/recovery/busy/quota/delete lifecycle |
| US5 | T025–T027 | Honest capability and snapshot degradation matrix |
| US6 | T028–T032 | Explicit secret-safe semantic opt-in with keyword fallback |
| US7 | T001, T033–T038 | Shipped asset, privacy, browser, performance, and UAT evidence |

## Requirement Coverage

Every requirement is referenced by at least one task:

- `FR-001`–`FR-010`: T003–T011
- `FR-011`–`FR-013`: T008, T010, T013–T015
- `FR-014`–`FR-018`: T017–T023
- `FR-019`–`FR-020`: T025–T027, T037
- `FR-021`–`FR-024`: T028–T032, T037
- `FR-025`–`FR-027`: T001, T011, T016, T033, T035–T037
- `FR-028`: T012, T024, T038
- `FR-029`–`FR-036`: T009–T010, T014, T017, T020–T023, T034
- `FR-037`–`FR-041`: T003, T005–T008, T011, T017–T019, T030
- `FR-042`–`FR-046`: T001, T028–T031, T033, T036–T037
- `FR-047`–`FR-049`: T002, T004, T007, T011, T025, T027, T035–T036
- `FR-050`–`FR-054`: T005, T009–T010, T014, T023, T026–T027, T031, T034
- `FR-055`–`FR-058`: T006, T017–T023, T030
- `FR-059`–`FR-063`: T005, T007, T013, T015–T016, T026, T030, T032–T035

## Non-Goals Guard

No task may introduce a separate SPA, ZIP/archive parser, watcher, polling or
daemon sync, LSP, catalogs, chat, dataflow, service-worker API shim, Node
polyfill bundle, multi-tab database concurrency, persisted bearer credentials,
insecure endpoint override, automatic index eviction, or source-folder writes.
