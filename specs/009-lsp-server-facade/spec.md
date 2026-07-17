# Feature Specification: LSP Server Facade

**Feature Branch**: `009-lsp-server-facade`

**Created**: 2026-07-16

**Status**: Draft

**Input**: Expose CodeGraph's persisted graph as a bounded, read-only Language
Server Protocol facade over standard input/output and same-origin WebSocket,
with a focused source viewer in the packaged browser.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Query CodeGraph Through Standard LSP (Priority: P1) [US1]

A developer or local tool starts one CodeGraph language-intelligence session
for an indexed repository, initializes it through the standard protocol, asks
for definitions, references, hover details, and symbols, and shuts it down
without requiring an editor-specific integration.

**Why this priority**: The protocol facade is the foundational product value.
It makes deterministic graph intelligence available to generic local tooling
before any browser-specific work is needed.

**Independent Test**: A scripted generic client can start the packaged command
against a fixture repository, complete the lifecycle, exercise every advertised
read method, verify exact graph-backed answers and bounded empty results, and
observe clean process shutdown.

**Acceptance Scenarios**:

1. **Given** an indexed repository with an available CodeGraph daemon, **When**
   a client starts a session and initializes with no root, **Then** the session
   binds to the preselected repository and advertises only the supported
   read-only capabilities.
2. **Given** a supplied root or workspace folder that resolves to the bound
   repository, **When** initialization completes, **Then** all subsequent reads
   are restricted to that repository.
3. **Given** a supplied root that does not resolve to the bound repository or a
   multi-root request, **When** initialization is attempted, **Then** the server
   rejects the mismatch without exposing repository data.
4. **Given** a precise persisted declaration or located semantic occurrence,
   **When** the client requests a definition, **Then** it receives the exact
   graph-backed location using UTF-16 positions.
5. **Given** a position that does not map uniquely to persisted graph evidence,
   **When** definition, references, or hover is requested, **Then** the response
   is null or empty rather than a guessed nearest-line or same-name result.
6. **Given** more results than a method's deterministic cap, **When** references
   or symbols are requested, **Then** the response is stably ordered and
   truncated at the documented limit.
7. **Given** a mutation or another unsupported request, **When** it reaches the
   session, **Then** it receives Method Not Found and no write-capable path is
   invoked.
8. **Given** a normal shutdown, end-of-input, interrupt, termination signal, or
   stream error, **When** the session ends, **Then** pending work and the
   repository client are released and no orphan process remains.

---

### User Story 2 - Browse Indexed Source Intelligence (Priority: P2) [US2]

A developer viewing a symbol in the packaged browser opens its indexed source,
inspects bounded hover information, follows a precise definition, and chooses
from references grouped by file without leaving the existing symbol-detail
experience.

**Why this priority**: This is the first visible browser use of the LSP facade
and proves that one shared protocol contract serves both generic tools and the
packaged web application.

**Independent Test**: Starting from one indexed symbol page, a browser test can
load source through the read-only content request, activate hover and
definition navigation, select a grouped reference, use back/forward history,
and confirm the existing symbol metadata remains usable throughout.

**Acceptance Scenarios**:

1. **Given** a symbol with a current indexed source snapshot, **When** its source
   pane opens, **Then** the pane displays the bounded source and selects the
   symbol's exact range.
2. **Given** a token with persisted hover evidence, **When** the user points to
   or focuses it, **Then** a bounded card shows only persisted signature, kind,
   qualified name, and documentation metadata.
3. **Given** a token with one exact definition, **When** the user activates
   go-to-definition by pointer or keyboard, **Then** the same focused pane loads
   the returned location and records it in page history.
4. **Given** graph-backed references, **When** the user opens the references
   panel, **Then** results are deterministically grouped by file and each item
   can navigate the focused pane.
5. **Given** browser back or forward navigation, **When** a prior source
   location is restored, **Then** the pane shows the corresponding URI and
   range without creating editor tabs.
6. **Given** source loading, empty, stale, timeout, unavailable, disconnected,
   or retry states, **When** the state changes, **Then** the pane communicates
   it accessibly while preserving the rest of the symbol page.
7. **Given** an LSP failure, **When** the user remains on symbol detail, **Then**
   existing metadata and relationship panels stay usable and recovery is an
   explicit source-pane retry rather than a background reconnect loop.

---

### User Story 3 - Operate a Safe, Bounded Local Service (Priority: P3) [US3]

A local operator can trust that every session is repository-bound, dormant
until deliberately invoked, same-origin in the browser, resource-bounded,
read-only, and fail-closed when source or transport input is unsafe.

**Why this priority**: The service exposes source-derived information and holds
daemon references. Security, privacy, cleanup, and truthful degradation are
release requirements even though they are not the first interactive journey.

**Independent Test**: Black-box clients exercise invalid roots, path escape,
stale source, wrong origins, binary and malformed frames, message limits,
concurrency limits, timeouts, disconnects, daemon loss, and shutdown while
verifying bounded errors, zero source/body logging, and complete cleanup.

**Acceptance Scenarios**:

1. **Given** the feature has not been invoked and no source pane is open,
   **When** the rest of CodeGraph runs normally, **Then** no LSP listener,
   browser socket, network request, or new persisted state is created.
2. **Given** a browser upgrade from the served origin, **When** the repository
   identifier is registered and available, **Then** one repository-bound
   read-only session is accepted.
3. **Given** a wrong Host, cross-origin browser Origin, unknown repository, or
   unavailable daemon, **When** a browser upgrade is requested, **Then** the
   connection is rejected before a session can read data.
4. **Given** a missing Origin from a local scripted client, **When** all other
   local binding checks pass, **Then** the connection may proceed without a
   bearer token in the URL.
5. **Given** an escaped, outside-root, symlink-escaped, non-file, unindexed,
   non-regular, oversized, unreadable, or stale file, **When** source is
   requested, **Then** the request fails with a bounded typed error and no
   unrelated path or content is disclosed.
6. **Given** malformed, binary, or oversized WebSocket input, **When** it is
   received, **Then** that session is rejected or closed without crashing the
   surrounding HTTP service.
7. **Given** 16 requests are already in flight or a request exceeds five
   seconds, **When** more work arrives or the deadline expires, **Then** limits
   are enforced without leaking timers, listeners, or repository references.
8. **Given** peer disconnect, daemon loss, server shutdown, or backpressure,
   **When** the transport terminates, **Then** every pending request settles and
   all session resources are released.

### Edge Cases

- Initialization arrives twice, a read arrives before initialization, or work
  arrives after shutdown.
- An unsupported notification cannot receive an error response but must not
  mutate state.
- Multiple graph nodes overlap a cursor or a resolved edge lacks a precise
  persisted location.
- Non-ASCII and astral characters make stored columns differ from UTF-16 code
  units.
- Duplicate references or symbols arrive through multiple semantic edges.
- A client sends fragmented or coalesced standard-input frames, malformed
  headers, premature end-of-input, or diagnostics that could corrupt stdout.
- A browser sends fragmented protocol data across WebSocket frames even though
  one complete protocol object is required per text frame.
- Source changes between graph lookup, metadata validation, and disk read.
- A file is replaced by a symlink or a path changes case/normalization after
  the repository was bound.
- A client disconnects while its daemon request is pending or while output is
  backpressured.
- The viewer navigates to another symbol or unmounts while a request is in
  flight.
- A stale-source retry occurs before the user has re-indexed the repository.

## Requirements *(mandatory)*

### Functional Requirements

#### Session and Lifecycle

- **FR-001 [US1]**: The product MUST provide an explicit command that starts one
  protocol session for one selected initialized CodeGraph repository.
- **FR-002 [US1]**: A session MUST bind its repository before accepting
  protocol reads and MUST never switch repositories during its lifetime.
- **FR-003 [US1]**: An absent initialize root MUST use the prebound repository;
  every supplied root or workspace folder MUST realpath-match that repository.
- **FR-004 [US1]**: The server MUST reject multi-root initialization and any
  root mismatch before returning repository-derived results.
- **FR-005 [US1]**: The server MUST implement initialize, initialized, shutdown,
  and exit lifecycle behavior, including standard pre-initialize and
  post-shutdown restrictions.
- **FR-006 [US1]**: The server MUST advertise UTF-16 positions, no document
  synchronization, no diagnostics, and only the supported read capabilities.

#### Graph-Backed Read Contract

- **FR-007 [US1]**: The server MUST support definition, references, hover,
  document symbols, and workspace symbols through standard read requests.
- **FR-008 [US1]**: Position-based answers MUST use exact persisted declarations
  or located resolved semantic occurrences and MUST NOT use nearest-line,
  project-wide name, or other heuristic fallbacks.
- **FR-009 [US1]**: Ambiguous or insufficient position evidence MUST return the
  protocol's null or empty result for that method.
- **FR-010 [US1]**: Definition MUST return at most one exact location.
- **FR-011 [US1]**: References MUST return stable, deduplicated locations from
  located semantic edges, honor include-declaration, exclude structural
  containment, and cap results at 500.
- **FR-012 [US1]**: Hover MUST return null or bounded Markdown containing only
  persisted signature, symbol kind, qualified name, and documentation metadata.
- **FR-013 [US1]**: Document symbols MUST return at most 500 hierarchical
  symbols derived from indexed nodes and containment, in stable source order.
- **FR-014 [US1]**: Workspace symbols MUST reuse deterministic graph-backed
  search, apply stable tie-breaking, and return at most 100 results.
- **FR-015 [US1]**: All returned line and character positions MUST be zero-based
  UTF-16 positions derived through one consistent conversion rule.

#### Read-Only Source Content

- **FR-016 [US2]**: The server MUST advertise a typed experimental
  `codegraph/textDocumentContent` read request and no source mutation request.
- **FR-017 [US2]**: The content response MUST contain bounded UTF-8 source text,
  language identity, the persisted content hash, and a stable snapshot token.
- **FR-018 [US2][US3]**: Content requests MUST accept only indexed `file:` URIs
  whose decoded realpath remains inside the bound repository.
- **FR-019 [US2][US3]**: Before returning content, the product MUST verify the
  target is a regular indexed file no larger than 1 MiB and that its current
  content hash matches the indexed hash.
- **FR-020 [US2][US3]**: Missing, malformed, escaped, outside-root,
  symlink-escaped, remote-scheme, unindexed, non-regular, oversized, unreadable,
  and stale source requests MUST fail with bounded typed errors.
- **FR-021 [US3]**: Source errors and diagnostics MUST NOT reveal unrelated
  absolute paths, file contents, request bodies, or authorization values.

#### Dispatch and Transport

- **FR-022 [US1][US3]**: A single shared repository-bound dispatcher MUST apply
  equivalent request semantics and error mapping across both transports.
- **FR-023 [US1][US3]**: The request dispatcher MUST use an explicit read
  allowlist; every unsupported request MUST return JSON-RPC Method Not Found and
  MUST NOT reach write-capable behavior.
- **FR-024 [US1][US3]**: Unsupported notifications MUST be ignored where the
  protocol requires no response and MUST NOT mutate source, index, or session
  repository state.
- **FR-025 [US1]**: Standard-input transport MUST use standard Content-Length
  framing, tolerate fragmented and coalesced input, reserve stdout for protocol
  messages, and send diagnostics only to stderr.
- **FR-026 [US1][US3]**: End-of-input, stream failure, exit, interrupt, and
  termination MUST settle pending requests and release the repository client
  without leaving an orphan process.
- **FR-027 [US2][US3]**: Browser transport MUST accept one complete JSON-RPC
  object per UTF-8 WebSocket text frame and reject binary, malformed, or
  oversized messages without crashing the HTTP service.
- **FR-028 [US2][US3]**: The browser transport MUST resolve and bind a registered
  repository before completing the upgrade and preserve existing unknown-repo
  and unavailable-daemon behavior.
- **FR-029 [US3]**: Browser upgrades MUST preserve loopback-only startup, Host
  validation, and same-origin browser Origin checks; an absent Origin MAY be
  accepted only for otherwise-valid local scripted clients.
- **FR-030 [US3]**: Browser connections MUST NOT rely on bearer tokens in
  WebSocket URLs.
- **FR-031 [US3]**: Each browser session MUST cap messages and source at 1 MiB,
  concurrent in-flight requests at 16, and request duration at five seconds.
- **FR-032 [US3]**: Ping/pong, close, peer disconnect, daemon loss, server
  shutdown, timeout, and backpressure paths MUST release every timer, listener,
  pending request, and repository client reference.

#### Focused Source Viewer

- **FR-033 [US2]**: The existing symbol-detail experience MUST gain one focused,
  read-only source pane initialized from the selected symbol's indexed location.
- **FR-034 [US2]**: The pane MUST obtain source only through the advertised
  content request and intelligence only through standard read requests.
- **FR-035 [US2]**: Hover activation by pointer or keyboard MUST show bounded
  persisted metadata and MUST not expose surrounding source excerpts as hover
  content.
- **FR-036 [US2]**: Activating an exact definition MUST load that URI and range
  in the same pane and persist the location in the page query state so browser
  history restores it.
- **FR-037 [US2]**: The viewer MUST group references by file in deterministic
  order and allow each reference to navigate the focused pane.
- **FR-038 [US2]**: Loading, ready, empty, stale, unavailable, timeout,
  disconnected, and retry states MUST use semantic controls, visible focus, and
  screen-reader status announcements.
- **FR-039 [US2]**: Source-pane failure MUST preserve existing symbol metadata
  and relationship panels and MUST offer an explicit manual retry.
- **FR-040 [US2][US3]**: The browser connection MUST remain dormant until the
  source pane is opened, MUST not reconnect in the background, and MUST close
  when the pane lifecycle ends.
- **FR-041 [US2]**: The focused viewer MUST remain usable under narrow layouts
  and reduced-motion preferences without adding tabs, editing, or workspace
  chrome.

#### Verification and Delivery

- **FR-042 [US1][US3]**: A deterministic generic client MUST black-box test the
  packaged standard-input transport across lifecycle, all advertised reads,
  unsupported methods, framing failures, and clean shutdown.
- **FR-043 [US2][US3]**: A deterministic client MUST black-box test the real
  WebSocket endpoint across equivalent reads, origin/repository gates,
  malformed input, limits, disconnects, daemon loss, and shutdown.
- **FR-044 [US1][US2][US3]**: The delivered feature MUST be demonstrated against
  this repository, including standard-input reads, browser source navigation,
  and truthful stale or unavailable behavior.
- **FR-045 [US3]**: When the feature is unconfigured and uninvoked, existing
  CodeGraph behavior MUST remain unchanged with zero new network calls and zero
  new persisted writes.

### Reviewability Budget *(mandatory)*

- **Primary surface**: harness/adapter
- **Secondary surfaces, if any**: CLI, local server transport, focused browser UI
- **Projected reviewable LOC**: 450 from scaffold; the plan MUST replace this
  with per-slice production-file estimates
- **Projected production files**: At least 6 surfaces; the plan MUST declare the
  concrete files before implementation
- **Projected total files**: To be established from the plan's two slice tables
- **Budget result**: warning accepted with mandatory two-slice delivery
- **Split decision**: Slice 1 delivers daemon reads, shared LSP behavior,
  standard-input transport, and black-box conformance. Slice 2 delivers
  WebSocket transport, focused viewer, browser/package checks, and self-repo
  UAT. Either slice MUST split further before implementation if its declared
  review surface exceeds the applicable ceiling.

### PR Review Packet Requirements *(mandatory)*

- Each emitted PR description MUST explain what changed and why in public,
  non-expert language and include non-goals, review order, scope budget,
  traceability, verification evidence, known gaps, and rollback or activation
  notes.
- Traceability MUST map major requirements and success criteria to changed files
  and current verification evidence.
- A multi-PR delivery MUST preserve the planned slice order and make each slice
  independently reviewable and testable.
- Deferred work MUST name a follow-up specification or issue; silent deferral is
  not allowed.

### Key Entities

- **Repository-Bound Session**: One protocol lifecycle associated with one
  preselected repository, lifecycle state, transport, pending requests, limits,
  and cleanup ownership.
- **Bound Repository**: The canonical repository identity and realpath used to
  validate initialize roots and every file URI.
- **Graph Location**: A precise file URI and UTF-16 range backed by a persisted
  declaration or located semantic occurrence.
- **Indexed Source Snapshot**: Indexed file identity, persisted content hash,
  language, bounded source text, and stable snapshot token.
- **Viewer Location State**: The source URI and selected range stored in page
  query/history state.
- **Viewer Connection State**: Dormant, connecting, ready, stale, unavailable,
  timed out, disconnected, or retrying-manually state owned by the focused pane.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 [US1]**: A generic client can initialize, call every advertised read
  method, shut down, and exit successfully against a packaged process.
- **SC-002 [US1]**: Identical requests against an unchanged indexed snapshot
  return byte-stable ordering and equivalent semantic results on both
  transports.
- **SC-003 [US1]**: Every ambiguous cursor fixture returns null or empty, with
  zero demonstrated nearest-line or same-name guesses.
- **SC-004 [US1]**: References and document symbols never exceed 500 results,
  workspace symbols never exceed 100, and repeated capped queries preserve
  order.
- **SC-005 [US1]**: Unicode fixtures containing non-BMP characters return the
  exact expected UTF-16 positions for every location-bearing method.
- **SC-006 [US3]**: All invalid-root, path-escape, symlink-escape, stale-hash,
  write-method, wrong-origin, malformed-input, binary-input, oversize,
  concurrency, timeout, disconnect, and shutdown tests fail closed.
- **SC-007 [US3]**: Resource-leak probes observe zero live session timers,
  listeners, pending requests, or repository client references after every
  termination path.
- **SC-008 [US2]**: A keyboard-only user can load source, inspect hover, follow
  a definition, choose a reference, retry a failure, and restore history
  without leaving symbol detail.
- **SC-009 [US2]**: When source intelligence is unavailable, all existing symbol
  metadata and relationship content remains usable in every tested state.
- **SC-010 [US3]**: With no session or source pane active, probes record zero
  feature-created sockets, external requests, and persisted writes.
- **SC-011 [US1][US2]**: Scripted standard-input and WebSocket conformance plus
  browser user-acceptance tests pass against built/package artifacts.
- **SC-012 [US1][US2][US3]**: A self-repository demonstration exercises
  definition, references, hover, symbols, source content, history navigation,
  and stale/unavailable recovery with recorded evidence.

## Assumptions

- SPEC-005's local HTTP server, repository registry, daemon client pool, Host
  policy, and reserved upgrade seam are available.
- SPEC-006's packaged browser shell and symbol-detail route are available.
- The selected repository has already been initialized and indexed; this
  feature never initializes or indexes it automatically.
- Persisted graph locations are the authority even when that means returning
  fewer results than a heuristic language server might.
- Local scripted WebSocket clients may omit Origin, but browser clients always
  provide and must satisfy same-origin policy.
- Users recover from stale source through the existing re-index workflow before
  choosing manual retry.
- Standard diagnostic redaction and local-only operating assumptions continue
  to apply.

## Dependencies

- SPEC-005 is a required completed dependency for repository binding, daemon
  reads, local server lifecycle, and browser upgrade policy.
- SPEC-006 is a required completed dependency for the packaged source-viewer
  surface.
- SPEC-008 provides reusable protocol conventions and position types but is not
  a roadmap dependency.

## Out of Scope

- Rename, formatting, code actions, workspace edits, diagnostics, and all other
  mutating or push-oriented protocol methods.
- Unsaved-buffer overlays, document synchronization, or automatic re-indexing.
- Proxying an external language server or running precision-pass processes at
  request time.
- Multi-repository sessions, remote URI schemes, cross-origin browser access,
  TLS termination, or hosted-service deployment.
- IDE extension packaging, marketplace distribution, a tabbed editor, editing,
  or workspace chrome.
- Heuristic cursor, nearest-line, or project-wide name fallback.
