# Feature Specification: LSP Server Facade

**Feature Branch**: `009-lsp-server-facade`

**Created**: 2026-07-16

**Status**: Draft

**Input**: Expose CodeGraph's persisted graph as a bounded, read-only Language
Server Protocol facade over standard input/output and same-origin WebSocket,
with a focused source viewer in the packaged browser.

## Clarifications

### Session 2026-07-16

- Q: How are multiple initialize root signals validated? → A: Validate every
  supplied local root signal against the one prebound repository; absent roots
  are valid, while invalid, conflicting, or multi-root inputs return `-32602`.
- Q: What lifecycle and notification policy applies? → A: Use standard
  state-specific errors, recognize only the required lifecycle messages, ignore
  unsupported notifications without mutation, and exit 0 only after shutdown.
- Q: How are overlapping persisted cursor spans resolved? → A: Collapse exact
  evidence only when it reaches the same stable target; distinct targets return
  no result, with declarations used for definitions and occurrences for
  references.
- Q: What source drives UTF-16 conversion? → A: Convert only from content proven
  identical to the indexed snapshot, fail closed on unprovable outgoing
  boundaries, and normalize overlong incoming characters to line end.
- Q: What ordering applies before result caps? → A: Deduplicate and completely
  order references, document symbols, and workspace symbols before truncation.
- Q: What is the bounded stdio framing failure policy? → A: Bound headers and
  inbound bodies, terminate on untrustworthy framing without resynchronizing,
  but return Parse Error and continue for malformed JSON in a valid frame.
- Q: How does WebSocket input failure map to the wire? → A: Use JSON-RPC errors
  for recoverable text-message failures and standard close codes for binary,
  invalid UTF-8, or oversized messages.
- Q: In what order are WebSocket upgrade gates applied? → A: Validate the
  handshake target, Host, and normalized Origin before repository lookup or
  daemon attach; allow a truly absent Origin only for valid local scripts.
- Q: How do request limits and cleanup interact? → A: Reserve one of 16 slots
  per accepted request, never queue excess work, enforce one five-second
  settlement deadline, and use bounded idempotent per-session teardown.
- Q: Where does diagnostic redaction apply? → A: Use one shared redaction policy
  for every log, error, rejection, and close path, while still echoing valid
  request IDs where JSON-RPC requires them.
- Q: What is the exact source-content API contract? → A: Keep the custom
  experimental `codegraph/textDocumentContent` request with text-document params,
  indexed metadata, opaque snapshot tokens, and closed redacted error reasons.
- Q: How are source validation and reading kept race-safe? → A: One trusted
  linearized fail-closed operation owns containment, index identity, bounded
  handle-based reading, exact-byte hashing, and final revalidation.
- Q: What source location is stored in browser history? → A: Keep canonical URIs
  internal but serialize only a registered-repo-bound relative path and complete
  UTF-16 range, with replace/push/pop behavior and strict fallback validation.
- Q: How do pointer and keyboard users interact with source? → A: Use one
  single-tab-stop read-only composite with an active token, shared exact mapping,
  and explicit named hover and definition controls.
- Q: How does source-viewer degradation recover? → A: Use explicit states with
  no auto-reconnect; manual Retry replays only the current validated location,
  and generation guards discard stale work.

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
2. **Given** any combination of current, legacy, or workspace root signals that
   all resolve to the bound repository, **When** initialization completes,
   **Then** all subsequent reads are restricted to that repository.
3. **Given** an invalid or non-file root, conflicting supplied root signals, a
   root that does not resolve to the bound repository, or a multi-root request,
   **When** initialization is attempted, **Then** the server returns invalid
   parameters without exposing repository data.
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
6. **Given** malformed JSON, an invalid request envelope, binary or invalid
   UTF-8 input, or an oversized WebSocket message, **When** it is received,
   **Then** the server uses the specified JSON-RPC error or WebSocket close code
   without crashing the surrounding HTTP service.
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
- An incoming LSP character is greater than the addressed line's UTF-16 length.
- An outgoing graph boundary falls inside a multi-byte or non-BMP character and
  cannot be mapped exactly against the indexed snapshot.
- Duplicate references or symbols arrive through multiple semantic edges.
- A client sends fragmented or coalesced standard-input frames, malformed
  headers, premature end-of-input, or diagnostics that could corrupt stdout.
- A valid standard-input frame contains malformed JSON even though its byte
  boundary remains trustworthy.
- A WebSocket peer uses legal RFC fragmentation within one text message, or
  attempts to split or combine protocol objects across WebSocket messages.
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
- **FR-003 [US1]**: An initialize request with all root fields absent or null
  MUST use the prebound repository. The server MUST canonicalize every supplied
  non-null `rootUri`, legacy `rootPath`, and workspace-folder URI, require a
  local file path whose realpath equals that repository, and treat workspace
  folders as the preferred effective field followed by `rootUri` and then
  `rootPath` without allowing precedence to bypass validation of another
  supplied field.
- **FR-004 [US1]**: The server MUST reject an invalid or non-file root, any root
  mismatch, conflicting supplied signals, and more than one distinct canonical
  workspace root with invalid parameters (`-32602`) before returning
  repository-derived results.
- **FR-005 [US1]**: The server MUST implement initialize, initialized, shutdown,
  and exit lifecycle behavior: non-lifecycle requests before initialization
  return server not initialized (`-32002`); malformed or invalid-state requests,
  including duplicate initialize and requests after shutdown, return invalid
  request (`-32600`); pre-initialize notifications other than `exit` are dropped;
  after shutdown only `exit` is accepted; and `exit` terminates with status 0
  after shutdown and status 1 otherwise.
- **FR-006 [US1]**: The server MUST advertise UTF-16 positions, no document
  synchronization, no diagnostics, and only the supported read capabilities.

#### Graph-Backed Read Contract

- **FR-007 [US1]**: The server MUST support definition, references, hover,
  document symbols, and workspace symbols through standard read requests.
- **FR-008 [US1]**: Position-based answers MUST use exact persisted declarations
  or located resolved semantic occurrences and MUST NOT use nearest-line,
  project-wide name, or other heuristic fallbacks. Multiple exact occurrences
  MAY collapse only when they resolve to the same stable target identity.
- **FR-009 [US1]**: Ambiguous or insufficient position evidence MUST return the
  protocol's null or empty result for that method, including when overlapping
  exact evidence resolves to distinct targets.
- **FR-010 [US1]**: Definition MUST return at most one exact target declaration
  location.
- **FR-011 [US1]**: References MUST return stable, deduplicated locations from
  the persisted occurrence ranges of located semantic edges, add the target
  declaration range only when include-declaration is true, exclude structural
  containment, order by normalized URI and complete range before truncation,
  and cap results at 500.
- **FR-012 [US1]**: Hover MUST return null or bounded Markdown containing only
  persisted signature, symbol kind, qualified name, and documentation metadata.
- **FR-013 [US1]**: Document symbols MUST return at most 500 hierarchical
  symbols derived from indexed nodes and containment, in stable source order
  with deterministic parent-before-child traversal. Deduplication and ordering
  MUST precede truncation, and truncation MUST NOT retain an orphaned child.
- **FR-014 [US1]**: Workspace symbols MUST reuse deterministic graph-backed
  search, preserve its rank, tie-break by qualified name, normalized URI, and
  complete range, deduplicate and completely order before truncation, and return
  at most 100 results.
- **FR-015 [US1]**: All returned line and character positions MUST be zero-based
  UTF-16 positions derived through one consistent conversion rule using source
  proven identical to the indexed snapshot. An outgoing boundary that cannot be
  mapped exactly MUST fail closed with the method-appropriate null, empty, or
  typed source error; an incoming character beyond a line's UTF-16 length MUST
  normalize to that line's end.

#### Read-Only Source Content

- **FR-016 [US2]**: The server MUST advertise a typed experimental
  `codegraph/textDocumentContent` read request under server capabilities'
  `experimental` field and no source mutation request. This CodeGraph extension
  is distinct from LSP 3.18's standardized text-only
  `workspace/textDocumentContent` request. Its params MUST be
  `{ textDocument: { uri: string } }`.
- **FR-017 [US2]**: The content response MUST be
  `{ text: string, languageId: string, contentHash: string, snapshotToken: string }`.
  Text MUST be bounded UTF-8 source, `contentHash` MUST be the exact opaque
  persisted indexed hash, and `snapshotToken` MUST be an opaque, non-secret,
  equality-only value that is byte-stable for one indexed file snapshot and
  changes whenever that indexed snapshot/version changes. Snapshot tokens MUST
  NOT appear in URLs or logs.
- **FR-018 [US2][US3]**: Content requests MUST accept only indexed `file:` URIs
  whose decoded realpath remains inside the bound repository. One trusted
  operation MUST own canonical containment, index-record lookup, regular-file
  identity, bounded reading, hashing, and final identity/containment validation;
  Plan MAY place that authority in the daemon or facade but MUST NOT split these
  trust-critical checks across independently raced reads.
- **FR-019 [US2][US3]**: Before returning content, the product MUST verify the
  target is a regular indexed file and open one stable file handle, read at most
  1 MiB plus one sentinel byte, hash the exact bytes proposed for return, and
  revalidate file identity, containment, size, and indexed state before success.
  Replacement, symlink escape, short or partial read, growth beyond 1 MiB,
  metadata drift, or hash drift MUST discard the entire result and fail closed;
  partial bytes MUST never be exposed.
- **FR-020 [US2][US3]**: Missing, malformed, escaped, outside-root,
  symlink-escaped, remote-scheme, unindexed, non-regular, oversized, unreadable,
  and stale source requests MUST fail with bounded typed errors. Malformed params
  or URI schemes MUST use Invalid Params (`-32602`); verified disk/index drift
  MUST use Content Modified (`-32801`); all other valid-but-unavailable source
  failures MUST use Request Failed (`-32803`) with `data.reason` from the closed
  redacted enum `not_found`, `outside_repository`, `unindexed`, `not_regular`,
  `too_large`, or `unreadable` and no path, input, hash, or raw-cause echo.
- **FR-021 [US3]**: One shared redaction policy MUST apply before every log,
  standard-error diagnostic, HTTP rejection body, JSON-RPC error message/data,
  send failure, daemon-loss diagnostic, and WebSocket close reason. These sinks
  MUST NOT reveal source text, params or request bodies, authorization or cookie
  values, query strings, raw Origin values, client or repository absolute paths,
  arbitrary client-supplied method names, raw exception text, nested causes, or
  stack traces. Logs MAY contain only stable bounded reason codes, method names
  from the fixed allowlist, registered repository IDs, and bounded session-state
  metadata, and MUST NOT contain raw request IDs. Protocol responses MUST still
  echo a valid request ID where JSON-RPC requires it; parse errors use `id: null`
  and notifications receive no response.

#### Dispatch and Transport

- **FR-022 [US1][US3]**: A single shared repository-bound dispatcher MUST apply
  equivalent request semantics and error mapping across both transports.
- **FR-023 [US1][US3]**: The request dispatcher MUST use an explicit read
  allowlist; every unsupported request in the initialized state MUST return
  JSON-RPC Method Not Found (`-32601`) and MUST NOT reach write-capable behavior.
- **FR-024 [US1][US3]**: Unsupported notifications MUST be ignored where the
  protocol requires no response and MUST NOT mutate source, index, session, or
  repository state. `initialized` and `exit` are the only recognized lifecycle
  notifications; `shutdown` remains a request.
- **FR-025 [US1]**: Standard-input transport MUST use standard Content-Length
  framing, tolerate fragmented and coalesced input, reserve stdout for protocol
  messages, and send diagnostics only to stderr. It MUST cap the complete header
  section by fixed bytes and header count, accept exactly one case-insensitive
  decimal `Content-Length` for an inbound JSON-RPC body no larger than 1 MiB,
  and MAY accept bounded syntactically valid companion headers. Missing,
  duplicate, conflicting, invalid, overflowing, oversized, non-ASCII, or
  premature-EOF framing MUST produce one bounded redacted stderr diagnostic,
  release the session, and terminate nonzero without resynchronization. Malformed
  JSON inside an otherwise valid bounded frame MUST instead return Parse Error
  (`-32700`, `id: null`) and keep the session synchronized. Outbound source text
  MAY reach the 1 MiB source cap plus bounded JSON-RPC envelope overhead.
- **FR-026 [US1][US3]**: End-of-input, stream failure, exit, interrupt, and
  termination MUST settle pending requests and release the repository client
  without leaving an orphan process.
- **FR-027 [US2][US3]**: Browser transport MUST accept one complete JSON-RPC
  object per UTF-8 WebSocket text message after standards-compliant fragmentation
  reassembly and MUST NOT split or combine objects across messages. Malformed
  JSON text MUST return Parse Error (`-32700`, `id: null`) without closing; a
  structurally invalid JSON-RPC object MUST return Invalid Request (`-32600`)
  using a safely recoverable valid ID or `null`; binary input MUST close with
  1003, invalid UTF-8 with 1007, and input over 1 MiB with 1009. Policy abuse MAY
  close with 1008, fatal internal failure with 1011, server shutdown with 1001,
  and clean protocol shutdown with 1000. Close reasons MUST be generic, redacted,
  and at most 123 UTF-8 bytes; reserved close codes MUST never be transmitted.
- **FR-028 [US2][US3]**: The browser transport MUST resolve and bind a registered
  repository and attach its daemon before completing the upgrade. Before any
  repository lookup or daemon work, it MUST validate the upgrade/handshake shape,
  exact `/lsp` pathname, existing Host policy, and Origin policy in that order.
  It MUST then accept exactly one syntactically valid registered repository ID,
  preserve existing unknown-repo and unavailable-daemon behavior, and reject
  missing, duplicate, empty, malformed, or ambiguous repository parameters.
- **FR-029 [US3]**: Browser upgrades MUST preserve loopback-only startup, Host
  validation, and same-origin browser Origin checks. A present Origin MUST be a
  single parsed HTTP(S) origin whose exact scheme, normalized hostname, and
  effective port equal the served origin; loopback hostnames and addresses are
  not interchangeable origins. Null, multiple or comma-joined, malformed,
  credential-bearing, or mismatched Origins MUST be rejected. An absent Origin
  MAY be accepted only for otherwise-valid local scripted clients that still
  pass every Host, repository, daemon, and resource gate. A rejected Host or
  Origin MUST NOT reveal whether a repository or daemon exists.
- **FR-030 [US3]**: Browser connections MUST NOT rely on bearer tokens in
  WebSocket URLs.
- **FR-031 [US3]**: Each browser session MUST cap messages and source at 1 MiB,
  concurrent in-flight requests at 16, and request duration at five seconds.
  Only accepted ID-bearing requests consume a slot, which MUST be reserved before
  daemon dispatch and released exactly once. Request 17 MUST receive one stable
  bounded overload response without dispatch or queuing. The five-second
  wall-clock deadline starts at accepted dispatch; timeout settles once, clears
  its timer, releases the slot, and discards any late daemon result. The Plan
  MUST freeze and tests MUST cover the exact overload/timeout error codes and a
  fixed outbound queued-byte high-water threshold before Tasks.
- **FR-032 [US3]**: Ping/pong, close, peer disconnect, daemon loss, server
  shutdown, timeout, and backpressure paths MUST converge on one idempotent
  teardown that settles each accepted request once and releases every timer,
  listener, pending request, in-flight slot, and that session's repository client
  reference exactly once. Dispatch MUST stop at the fixed outbound high-water
  threshold, drain for no more than the same five-second window, and then close
  with 1013 if pressure remains. Cleanup MUST NOT close a pooled daemon transport
  still referenced by another session, and daemon loss or server shutdown MUST
  not disrupt an unaffected session.

#### Focused Source Viewer

- **FR-033 [US2]**: The existing symbol-detail experience MUST gain one focused,
  read-only source pane initialized from the selected symbol's indexed location.
- **FR-034 [US2]**: The pane MUST obtain source only through the advertised
  content request and intelligence only through standard read requests.
- **FR-035 [US2]**: Hover activation by pointer or keyboard MUST show bounded
  persisted metadata and MUST not expose surrounding source excerpts as hover
  content. The source surface MUST be a single-tab-stop read-only composite with
  one programmatically identifiable active token settable by pointer and
  keyboard through the same exact UTF-16 mapping. It MUST provide an explicit
  named `Show hover details` action; the non-modal details MUST be associated
  with the active token, remain non-focus-stealing, and close on Escape or token
  change. Hover work MUST be bounded, latest-wins, and cancellation/generation
  guarded so pointer movement cannot exhaust the session request limit.
- **FR-036 [US2]**: Activating an exact definition MUST load that URI and range
  in the same pane. The active-token interaction MUST provide an explicit named
  `Go to definition` action; Enter and a deliberate pointer gesture or that
  action MAY activate it, while no-result MUST preserve location/focus and
  announce bounded status. Internally the viewer MAY retain a canonical file URI,
  but the fixed query schema MUST serialize only a registered-repository-bound,
  canonical repository-relative path and complete nonnegative UTF-16 range.
  It MUST never serialize an absolute path, `file:` URI, source, hash, snapshot
  token, or credential. The initial canonical location and invalid-state fallback
  MUST replace history; successful explicit definition/reference navigation MUST
  push; pop restoration MUST NOT add an entry. Decoded state MUST reject
  traversal, malformed or reversed ranges, and repository mismatch, then fall
  back to the symbol's indexed location and replace the invalid state.
- **FR-037 [US2]**: The viewer MUST group references by file in deterministic
  order and allow each reference to navigate the focused pane. Group headings
  MUST use repository-relative paths and counts; items MUST preserve server order
  and use semantic keyboard-activatable controls whose accessible names include
  file and line/column position.
- **FR-038 [US2]**: Loading, ready, empty, stale, unavailable, timeout,
  disconnected, and retry states MUST use semantic controls, visible focus, and
  screen-reader status announcements. Closed pane maps to dormant/no socket;
  opening maps to connecting then loading; successful nonempty or zero-byte
  source maps to ready or empty; hash drift maps to stale/re-index-required;
  daemon attach failure maps to unavailable; request deadline maps to timed out;
  and unexpected socket loss maps to disconnected. `not_found`,
  `outside_repository`, `unindexed`, `not_regular`, `too_large`, and `unreadable`
  MUST display truthful safe source-unavailable variants, never empty. A
  persistent polite status region MUST announce meaningful state changes without
  repeatedly announcing pointer hover; actionable failures MAY use a one-time
  alert without moving focus merely to announce state.
- **FR-039 [US2]**: Source-pane failure MUST preserve existing symbol metadata
  and relationship panels and MUST offer a semantic manual Retry control with
  deterministic focus return. Retry MUST open one fresh connection only when
  needed and replay only the current validated repository-bound history location.
  Stale retry MUST remain stale until re-indexing changes the snapshot, and old
  content MUST NOT be presented as belonging to a newly failed location.
- **FR-040 [US2][US3]**: The browser connection MUST remain dormant until the
  source pane is opened, MUST not reconnect or retry in the background, and MUST
  close when the pane lifecycle ends or selected repository changes. Every
  location change, history restore, retry, repository change, and pane lifecycle
  MUST advance a generation; a response MAY apply only when its generation,
  repository, location, snapshot token, mounted pane, and live connection still
  match. Superseded work MUST be canceled where supported and otherwise discarded,
  and teardown MUST suppress post-unmount updates and clear listeners/timers.
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
  state, separated into an internal canonical file URI and a privacy-safe query
  serialization containing only registered repository identity, canonical
  repository-relative path, and complete UTF-16 range.
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
- **SC-005 [US1]**: Unicode fixtures containing non-BMP characters and
  byte-versus-UTF-16 column divergence return exact expected positions for every
  location-bearing method; stale content and unprovable outgoing boundaries fail
  closed, while overlong incoming characters normalize to line end.
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
