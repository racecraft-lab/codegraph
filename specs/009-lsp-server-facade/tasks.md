# Tasks: LSP Server Facade

**Input**: Design documents from `specs/009-lsp-server-facade/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`, and `.specify/memory/constitution.md`

**Tests**: Required. Every behavior group follows RED → GREEN → VERIFY, uses
real temporary repositories/SQLite and real transports, and preserves the two
independently reviewable slices approved in `plan.md`.

**Reviewability**: Slice 1 is projected at 320 reviewable LOC across eight
TypeScript files. Slice 2 is projected at 360 reviewable LOC across nine
TypeScript files. The combined 680-LOC warning is accepted only for these two
separately testable slices; T002 rechecks the boundary before implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Safe to execute in parallel because the task changes a different file
  and does not depend on unfinished work.
- **[US1]**, **[US2]**, **[US3]**: Trace to the user story in `spec.md`.
- Every task names an exact file path and the requirement or success-criterion
  group it proves.

## Phase 1: Setup and Scope Lock

**Purpose**: Freeze the accepted surfaces and establish a clean TDD baseline.

- [ ] T001 Verify the dedicated branch/worktree, pinned Node 24.11.1 baseline, and unchanged default CLI/server behavior using `package.json` and record evidence in `docs/ai/specs/.process/SPEC-009-workflow.md`
- [ ] T002 Re-run the installed reviewability estimator against `specs/009-lsp-server-facade/plan.md`; stop and split if either declared slice exceeds 400 projected LOC or its accepted file table

**Checkpoint**: Baseline and two-slice review boundary are authoritative.

---

## Phase 2: Foundational Protocol Contract

**Purpose**: Add only the transport-independent vocabulary shared by both
vertical slices. No repository read is enabled in this phase.

- [ ] T003 Write failing UTF-16, mixed-column evidence, stable-order, cap, JSON-RPC envelope, and closed-error tests in `__tests__/lsp-server.test.ts` for FR-005–FR-015, FR-021–FR-024, SC-002–SC-005
- [ ] T004 Implement the minimal server-side JSON-RPC/LSP types, lifecycle/error constants, redaction-safe errors, UTF-16 converters, and stable ordering helpers in `src/lsp/protocol.ts` to make T003 pass
- [ ] T005 Run the focused protocol cases in `__tests__/lsp-server.test.ts` and record RED/GREEN evidence in `docs/ai/specs/.process/SPEC-009-workflow.md`

**Checkpoint**: Both transports can depend on one deterministic, read-only wire
contract without activating a listener or graph read.

---

## Phase 3: User Story 1 - Query CodeGraph Through Standard LSP (Priority: P1) - Slice 1 MVP

**Goal**: A generic local client can start `codegraph lsp [path]`, bind one
indexed repository, call every standard read method, and shut down cleanly.

**Independent Test**: The built command passes the scripted Content-Length
black-box lifecycle, exact-result, ambiguity, cap, Unicode, framing, and cleanup
checks without writing graph state.

### Tests for User Story 1

- [ ] T006 [P] [US1] Extend failing real-SQLite daemon/facade tests for repository binding, exact cursor evidence, definition, references, hover, document symbols, workspace symbols, ambiguity, deduplication, and caps in `__tests__/lsp-server.test.ts` for FR-001–FR-015, FR-022–FR-024, SC-001–SC-005
- [ ] T007 [P] [US1] Write failing built-process tests for fragmented/coalesced Content-Length frames, header/body bounds, malformed valid-frame JSON recovery, stdout purity, exit states, EOF/signals, and orphan cleanup in `__tests__/lsp-stdio-black-box.test.ts` for FR-001, FR-005–FR-007, FR-025–FR-026, FR-042, SC-001, SC-006–SC-007, SC-011

### Implementation for User Story 1

- [ ] T008 [US1] Add closed daemon read operations for exact cursor evidence, located references, file symbols, workspace symbols, and indexed metadata in `src/mcp/read-ops.ts` for FR-007–FR-015 without schema writes or heuristic fallbacks
- [ ] T009 [US1] Add typed repository-bound wrappers and closed error mapping for the new daemon reads in `src/server/daemon-client.ts` for FR-002, FR-007–FR-015, FR-021–FR-024
- [ ] T010 [US1] Implement initialize-root canonicalization and the exact initialize/initialized/shutdown/exit state machine in `src/lsp/facade.ts` for FR-002–FR-006
- [ ] T011 [US1] Implement the explicit dispatcher allowlist and exact definition/reference/hover/document-symbol/workspace-symbol handlers in `src/lsp/facade.ts` for FR-007–FR-015, FR-022–FR-024
- [ ] T012 [US1] Implement the bounded incremental Content-Length parser/writer, stderr-only redacted diagnostics, cancellation, and idempotent cleanup in `src/lsp/stdio-server.ts` for FR-005, FR-021–FR-026
- [ ] T013 [US1] Add the minimal lazy `codegraph lsp [path]` command and pre-session failure exit behavior in `src/bin/codegraph.ts` for FR-001–FR-002, FR-026 while preserving all existing CLI defaults
- [ ] T014 [US1] Make all daemon/facade protocol cases pass and confirm identical requests are byte-stable in `__tests__/lsp-server.test.ts` for SC-001–SC-005
- [ ] T015 [US1] Make the built-process framing, stdout-purity, lifecycle, signal, and cleanup suite pass in `__tests__/lsp-stdio-black-box.test.ts` for FR-025–FR-026, FR-042, SC-006–SC-007, SC-011
- [ ] T016 [US1] Run the Slice 1 build, typecheck, focused root tests, full root suite, and packaged generic-client UAT from `specs/009-lsp-server-facade/quickstart.md`; record G7 evidence in `docs/ai/specs/.process/SPEC-009-workflow.md`
- [ ] T017 [US1] Re-run the Slice 1 reviewability check against the actual diff and record any approved split/disposition in `specs/009-lsp-server-facade/plan.md`

**Checkpoint**: Slice 1 is an independently valuable, packaged read-only LSP
MVP with G7 evidence before any browser transport is added.

---

## Phase 4: User Story 2 - Browse Indexed Source Intelligence (Priority: P2) - Slice 2 Viewer

**Goal**: The packaged symbol page opens one dormant source pane, reads a
verified indexed snapshot, and supports hover, definition/history, and grouped
references with accessible degradation and retry.

**Independent Test**: A packaged browser test starts from symbol detail, opens
source, uses pointer and keyboard intelligence, navigates and restores history,
handles stale/unavailable states, and leaves existing symbol metadata usable.

### Tests and Dependency Setup for User Story 2

- [ ] T018 [US2] Add pure-JS `ws` as a runtime dependency and `@types/ws` as development-only typing in `package.json` and `package-lock.json`, preserving Node `>=20.0.0 <25.0.0` and excluding optional native addons
- [ ] T019 [P] [US2] Extend failing content-contract tests for exact indexed metadata, opaque snapshot changes, file-only URIs, 1 MiB-plus-sentinel reads, hash/identity revalidation, and closed errors in `__tests__/lsp-server.test.ts` for FR-016–FR-020, SC-006
- [ ] T020 [P] [US2] Write failing real HTTP/WebSocket tests for valid same-origin session parity, JSON-RPC text-message mapping, repository binding, and clean lifecycle in `__tests__/lsp-websocket.test.ts` for FR-016, FR-022–FR-028, FR-043, SC-011
- [ ] T021 [P] [US2] Write failing browser client, source display, hover, definition/history, grouped-reference, generation-guard, state, retry, keyboard, live-region, narrow-layout, and reduced-motion tests in `web/src/tests/source-pane.test.tsx` for FR-033–FR-041, SC-008–SC-009
- [ ] T022 [P] [US2] Add a failing packaged browser journey for source navigation, back/forward restoration, stale/unavailable recovery, and preserved symbol metadata in `web/src/tests/source-viewer-uat.spec.ts` for FR-033–FR-044, SC-008–SC-012

### Implementation for User Story 2

- [ ] T023 [US2] Implement the single trusted handle-based source read with containment, index record, regular-file, bounded bytes, exact hash, language, snapshot token, and final revalidation in `src/mcp/read-ops.ts` for FR-016–FR-020
- [ ] T024 [US2] Add the typed trusted-content daemon wrapper and closed source errors in `src/server/daemon-client.ts` for FR-016–FR-021
- [ ] T025 [US2] Advertise and dispatch `codegraph/textDocumentContent` without advertising mutation or the distinct standard text-only method in `src/lsp/facade.ts` for FR-006, FR-016–FR-020, FR-022–FR-024
- [ ] T026 [US2] Implement the repository-bound native browser JSON-RPC client, typed errors, five-second request settlement, generation/cancellation guards, and explicit no-auto-reconnect lifecycle in `web/src/lib/lsp/client.ts` for FR-027–FR-028, FR-034, FR-038–FR-040
- [ ] T027 [US2] Implement the focused single-tab-stop source composite, exact token mapping, named hover/definition actions, grouped references, live state announcements, manual retry, focus, narrow layout, and reduced-motion behavior in `web/src/components/symbol/SourcePane.tsx` for FR-033–FR-041
- [ ] T028 [US2] Integrate Open/Close source and repo-relative path/range search history using replace for canonicalization, push for explicit navigation, and no push on POP in `web/src/routes/SymbolDetailRoute.tsx` for FR-033, FR-036–FR-040
- [ ] T029 [US2] Make the client/source-pane interaction and accessibility suite pass in `web/src/tests/source-pane.test.tsx` for SC-008–SC-009
- [ ] T030 [US2] Make the packaged source-viewer browser journey pass in `web/src/tests/source-viewer-uat.spec.ts` for FR-044, SC-011–SC-012

**Checkpoint**: The viewer is complete against a controlled repository-bound
transport and remains independently testable even when source intelligence is
unavailable.

---

## Phase 5: User Story 3 - Operate a Safe, Bounded Local Service (Priority: P3) - Slice 2 Transport and Safety

**Goal**: WebSocket sessions are deliberate, loopback/same-origin,
repository-bound, redacted, resource-bounded, dormant, and fully cleaned up.

**Independent Test**: Real black-box clients prove perimeter gate order,
protocol/close mapping, source safety, overload/deadline/backpressure limits,
session isolation, dormancy, daemon loss, and ordered shutdown.

### Tests for User Story 3

- [ ] T031 [US3] Extend failing WebSocket tests for handshake path, Host/normalized Origin order, absent-Origin scripts, repo/daemon admission, binary/invalid/oversized input, 16-slot overload, five-second timeout, 2 MiB backpressure, disconnect, daemon loss, redaction, isolation, and shutdown in `__tests__/lsp-websocket.test.ts` for FR-021–FR-032, FR-043, SC-006–SC-007
- [ ] T032 [P] [US3] Extend the failing package/offline suite to prove zero unopened `/lsp` connections, external requests, schema writes, and behavior drift when uninvoked in `web/src/tests/package-offline.spec.ts` for FR-040, FR-045, SC-010

### Implementation for User Story 3

- [ ] T033 [US3] Implement the `ws` no-server adapter with exact `/lsp` admission order, one repo lease per session, text-only JSON-RPC mapping, 1 MiB payload cap, 16 atomic slots, five-second deadlines, 2 MiB/5-second backpressure, redaction, and idempotent teardown in `src/server/lsp-websocket.ts` for FR-021–FR-032
- [ ] T034 [US3] Replace only the reserved upgrade destroy hook with the LSP adapter, share the daemon pool, stop upgrades first, and close sessions before existing HTTP/daemon shutdown in `src/server/index.ts` for FR-028–FR-032
- [ ] T035 [US3] Make all admission, close/error, resource-limit, session-isolation, redaction, daemon-loss, and cleanup cases pass in `__tests__/lsp-websocket.test.ts` for SC-006–SC-007, SC-011
- [ ] T036 [US3] Make the dormant/offline package checks pass without opening a browser socket or making an external request in `web/src/tests/package-offline.spec.ts` for FR-040, FR-045, SC-010
- [ ] T037 [US3] Run real stdio and WebSocket conformance plus invalid-root/path/hash/origin/frame/limit/disconnect/shutdown probes from `specs/009-lsp-server-facade/quickstart.md`; record G7 evidence in `docs/ai/specs/.process/SPEC-009-workflow.md`
- [ ] T038 [US3] Re-run the Slice 2 reviewability check against the actual diff and record any approved split/disposition in `specs/009-lsp-server-facade/plan.md`

**Checkpoint**: Slice 2 is a dormant, bounded, same-origin local capability with
all safety behavior proven through real transports.

---

## Phase 6: Polish and Cross-Cutting Verification

**Purpose**: Prove the complete feature, package contract, retrieval safety,
self-repo value, and review traceability without expanding scope.

- [ ] T039 [P] Add a user-facing read-only LSP facade and focused source-viewer bullet under `## [Unreleased]` in `CHANGELOG.md`, including dormant/local safety without internal paths
- [ ] T040 Audit the `ws` license, pure-JS install graph, engine range, optional-native-addon exclusion, and packed contents using `package.json` and `package-lock.json`; record evidence in `docs/ai/specs/.process/SPEC-009-workflow.md`
- [ ] T041 Run the retrieval-guardian workflow for the additive daemon diff in `src/mcp/read-ops.ts` and record its no-regression disposition in `docs/ai/specs/.process/SPEC-009-workflow.md`
- [ ] T042 Run root build/typecheck, focused LSP suites, full `npm test`, web tests/build, package/offline suite, and browser UAT from `specs/009-lsp-server-facade/quickstart.md`; record exact results in `docs/ai/specs/.process/SPEC-009-workflow.md`
- [ ] T043 Exercise initialize, definition, references, hover, both symbol methods, verified source content, browser navigation, and graceful stale/unavailable recovery against this repository using `specs/009-lsp-server-facade/quickstart.md`; record the self-repo UAT result in `docs/ai/specs/.process/SPEC-009-workflow.md` for FR-044, SC-012
- [ ] T044 Verify no diagnostics, edits, text synchronization, auto-indexing, multi-root switching, external LSP process, cross-origin access, TLS surface, or editor workspace was introduced by reviewing `src/lsp/facade.ts`, `src/server/lsp-websocket.ts`, and `web/src/components/symbol/SourcePane.tsx`
- [ ] T045 Map FR-001–FR-045 and SC-001–SC-012 to completed implementation/test evidence and close every task checkbox in `specs/009-lsp-server-facade/tasks.md`
- [ ] T046 Run the final installed reviewability estimator/backstop on the actual branch diff and record the two-slice result in `specs/009-lsp-server-facade/plan.md`
- [ ] T047 Generate the review packet with what/why, non-goals, review order, two-slice scope budget, requirement/test traceability, verification, known gaps, rollback, and dormancy notes in `docs/ai/specs/.process/SPEC-009-pr-body.md`
- [ ] T048 Run final self-review for secrets, absolute local paths, private infrastructure, source/request logging, session URLs, and unrelated changes across `docs/ai/specs/.process/SPEC-009-pr-body.md` and the complete git diff

---

## Dependencies and Execution Order

### Phase Dependencies

- **Setup and Scope Lock (Phase 1)**: Starts immediately.
- **Foundational Protocol (Phase 2)**: Depends on Phase 1 and blocks both
  transports.
- **US1 / Slice 1 (Phase 3)**: Depends on Phase 2. It must pass its G7 checkpoint
  before Slice 2 starts.
- **US2 Viewer (Phase 4)**: Depends on Slice 1's shared dispatcher. Its browser
  tests can use a controlled WebSocket peer while the production adapter is red.
- **US3 Transport/Safety (Phase 5)**: Depends on the US2 browser client contract
  and completes Slice 2 by connecting it to the real packaged server.
- **Polish (Phase 6)**: Depends on all three stories and both slice gates.

### Within Each User Story

1. Add the listed failing tests and observe the intended RED result.
2. Implement the smallest behavior in the declared production files.
3. Run focused tests until GREEN; refactor only code introduced by this feature.
4. Complete the independent black-box/UAT and reviewability checkpoint.
5. Commit the verified slice before moving to the next slice.

### Parallel Opportunities

- T006 and T007 touch separate Slice 1 harnesses and can be authored together.
- T019–T022 touch four separate root/web harnesses after T018.
- T026 and T033 target separate browser/server modules after the wire contract is
  frozen, but integration still follows the ordered US2 then US3 checkpoints.
- T039 can proceed alongside read-only verification after both slices are green.

## Parallel Examples

### User Story 1

```text
T006: daemon/facade behavior tests in __tests__/lsp-server.test.ts
T007: built stdio process tests in __tests__/lsp-stdio-black-box.test.ts
```

### User Story 2

```text
T019: trusted source contract tests in __tests__/lsp-server.test.ts
T020: transport parity tests in __tests__/lsp-websocket.test.ts
T021: browser component tests in web/src/tests/source-pane.test.tsx
T022: packaged browser journey in web/src/tests/source-viewer-uat.spec.ts
```

### User Story 3

```text
T031: WebSocket security/resource tests in __tests__/lsp-websocket.test.ts
T032: dormant/offline tests in web/src/tests/package-offline.spec.ts
```

## Implementation Strategy

### MVP First

1. Complete T001–T005 to freeze the shared protocol.
2. Complete T006–T017 to ship and verify the stdio LSP MVP.
3. Stop if Slice 1 G7 or its actual reviewability gate fails.

### Incremental Delivery

1. **Slice 1**: exact daemon reads → shared facade → stdio → packaged generic
   client and cleanup evidence.
2. **Slice 2 viewer**: trusted source → browser client/pane/history against the
   frozen wire contract.
3. **Slice 2 transport**: perimeter-first WebSocket adapter → real package
   integration → security/dormancy evidence.
4. **Final**: retrieval guardian → full suites → self-repo UAT → review packet.

## Requirement Coverage Summary

| Requirement group | Primary tasks |
|---|---|
| FR-001–FR-006 lifecycle/root/capabilities | T003–T007, T010, T013–T016 |
| FR-007–FR-015 exact graph reads/UTF-16/caps | T003–T006, T008–T011, T014–T017 |
| FR-016–FR-020 trusted content extension | T019, T023–T025, T042–T045 |
| FR-021–FR-026 redaction/dispatcher/stdio | T003–T015, T031, T033–T037 |
| FR-027–FR-032 WebSocket/security/resources | T020, T026, T031–T038 |
| FR-033–FR-041 viewer/accessibility/retry | T021–T030, T036, T042–T045 |
| FR-042–FR-045 black-box/self-repo/dormancy | T007, T015–T016, T020, T022, T030–T048 |
| SC-001–SC-012 measurable outcomes | T003–T007, T014–T017, T019–T022, T029–T048 |

## Notes

- `[P]` means file-independent, not permission to bypass a RED/GREEN dependency.
- No task introduces a schema migration, write method, external network service,
  editor workspace, or new top-level package.
- The optional `after_tasks` git hook is fulfilled by autopilot's phase commit.
