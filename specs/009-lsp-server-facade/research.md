# Research: LSP Server Facade

## Scope and Evidence

Research used the exact SPEC-009 worktree, the existing SPEC-005 server and
daemon boundaries, SPEC-008 LSP client conventions, the project constitution,
and current primary documentation for LSP 3.18, `ws`, and React Router. Context7
was attempted first as required, but its transport was closed; the official
primary sources were used as the bounded fallback.

## Decision 1: Inbound Server Boundary

**Decision**: Build new server-side modules in `src/lsp/protocol.ts`,
`src/lsp/facade.ts`, and `src/lsp/stdio-server.ts`. Reuse types/conventions from
the existing outbound `LspJsonRpcClient`, but do not turn that child-process
client into a bidirectional server abstraction.

**Rationale**: The existing client owns child-process stdin/stdout, request IDs,
timeouts, and external-server failure. SPEC-009 owns the inverse concerns:
repository binding, server lifecycle state, an inbound allowlist, errors, and
transport-independent dispatch. Separate modules keep both paths small and
avoid a speculative generic JSON-RPC framework.

**Alternatives considered**:

- Reuse `LspJsonRpcClient` as a server: rejected because its lifecycle and
  ownership are directionally wrong.
- Add a third-party LSP framework: rejected because the supported surface is
  small and dependency/abstraction cost exceeds the bounded contract.

## Decision 2: Graph and Source Read Authority

**Decision**: Extend the existing daemon `codegraph/read` vocabulary. The daemon
owns cursor lookup, located references, file/workspace symbols, indexed file
metadata, and a linearized trusted content read.

**Rationale**: The daemon already owns the warm graph and exact repository root.
Putting the trust-critical path there avoids a second SQLite copy and prevents
the server facade from racing a daemon metadata read against an independent
filesystem read. The operation opens one stable regular-file handle, reads cap
plus sentinel, hashes returned bytes, then revalidates identity/containment and
the indexed record before returning.

**Alternatives considered**:

- Metadata in daemon, bytes in facade: rejected due to TOCTOU and duplicated
  trust policy.
- Direct database access from each LSP process: rejected because it violates the
  shared warm-daemon design and can create inconsistent snapshots.
- Persist source blobs: rejected because no new storage is required and the
  spec forbids unexpected schema writes.

## Decision 3: Exact Cursor and UTF-16 Mapping

**Decision**: Resolve only persisted declarations or located semantic edge
occurrences that contain the normalized cursor. Verify positions against the
hash-matching snapshot. Treat persisted columns as graph-native: derive both the
UTF-8-byte and JavaScript UTF-16 candidate boundaries when necessary, validate
them against exact node/target-name evidence, and accept only convergence to one
semantic target and one range.

**Rationale**: Tree-sitter columns are byte-oriented while some hand-written
extractors use JavaScript indices. The schema has no coordinate-provenance field.
A verification-based converter handles current mixed provenance without schema
change or guessing. Ambiguous candidates return null/empty. Incoming LSP
characters beyond line length normalize to line end per the protocol.

**Alternatives considered**:

- Assume all columns are UTF-16: rejected by tree-sitter byte coordinates.
- Assume all columns are UTF-8 bytes: rejected by hand-written extractors.
- Add a coordinate-provenance migration: rejected as disproportionate; exact
  verification meets the feature contract without stored-state churn.

## Decision 4: LSP 3.18 and the Content Extension

**Decision**: Keep `codegraph/textDocumentContent` under
`ServerCapabilities.experimental`, with `{ textDocument: { uri } }` params and
`{ text, languageId, contentHash, snapshotToken }` result. Explicitly document
that LSP 3.18 now has a separate standardized `workspace/textDocumentContent`
text-only request.

**Rationale**: The custom request is a binding scaffold decision and supplies
indexed language/hash/snapshot metadata needed for safe viewer cache and race
handling. Silently advertising the standard method with a nonstandard result
would be incompatible.

**Alternatives considered**:

- Replace with the standardized text-only method: rejected because it drops the
  required snapshot contract.
- Advertise both in v1: rejected as unnecessary scope and two content paths.

## Decision 5: Lifecycle and Error Vocabulary

**Decision**: Implement standard initialize/initialized/shutdown/exit states and
an explicit request allowlist. Use `-32002` pre-initialize, `-32602` invalid
params, `-32600` malformed/invalid-state, `-32601` unsupported, `-32700` parse
error, `-32801` stale content, and `-32803` bounded operational failures.
Overload and deadline use `-32803` with closed reasons `overloaded` and
`timeout`. Unsupported notifications receive no response and cannot mutate.

**Rationale**: One closed error vocabulary makes stdio and WebSocket byte-stable,
testable, and redaction-safe.

**Alternatives considered**:

- Custom errors for every failure: rejected as needless protocol drift.
- Close every transport on application errors: rejected because synchronized
  JSON-RPC errors are recoverable.

## Decision 6: Stdio Framing

**Decision**: Implement a bounded incremental Content-Length parser with an
8 KiB/32-line header cap and 1 MiB inbound body cap. Exactly one decimal
case-insensitive Content-Length is required; bounded valid companion headers are
ignored. Loss of frame trust is fatal and never resynchronized. Malformed JSON
inside a valid frame gets `-32700` and the session continues. Stdout is protocol
only; bounded redacted diagnostics use stderr.

**Rationale**: Scanning for another delimiter after an untrusted length can
reinterpret body bytes as headers. Valid-frame JSON failure retains a reliable
next boundary and is recoverable.

**Alternatives considered**:

- Scan/resynchronize after framing errors: rejected as unsafe.
- Exit on every parse error: rejected as unnecessarily brittle.

## Decision 7: `ws` Integration

**Decision**: Add `ws` as the one runtime dependency, without optional native
addons. Use `WebSocketServer({ noServer: true, maxPayload: 1_048_576,
perMessageDeflate: false, clientTracking: false, closeTimeout: 5_000 })` on the
reserved HTTP upgrade event. Validate upgrade shape, Host, Origin, repository,
and daemon availability before `handleUpgrade`.

**Rationale**: Current `ws` documentation provides `noServer`, `handleUpgrade`,
`maxPayload`, `bufferedAmount`, ping/pong, close, pause/resume, and bounded close
behavior. It correctly reassembles RFC fragmentation into messages, so the app
contract is one JSON-RPC object per text message, not per physical frame.

**Alternatives considered**:

- Hand-roll RFC 6455: rejected for security and lifecycle risk.
- Attach a second HTTP listener: rejected because SPEC-005 already reserved the
  exact upgrade seam and shared server lifecycle.
- Enable compression: rejected because local source messages gain little and
  compression adds resource/attack surface.

## Decision 8: WebSocket Resource Ownership

**Decision**: Count only ID-bearing accepted requests. Reserve one of 16 slots
before daemon dispatch; never queue request 17. Start a 5-second deadline at
dispatch, settle once, delete the slot/timer, and ignore late results. Stop new
dispatch when `bufferedAmount` exceeds 2 MiB; drain for at most 5 seconds and
close 1013 if pressure remains. A single idempotent teardown owns listeners,
timers, pending settlements, and that session's daemon lease.

**Rationale**: `bufferedAmount` is the current `ws` queued-byte signal. A 2 MiB
threshold leaves room for one maximum source response plus JSON-RPC envelope and
one small concurrent response without allowing unbounded growth.

**Alternatives considered**:

- Queue excess requests: rejected due to unbounded memory and hidden latency.
- Close on first overload/timeout: rejected because a bounded error can preserve
  an otherwise healthy local session.

## Decision 9: Upgrade Admission and Redaction

**Decision**: Apply gates in this order: valid WebSocket handshake/exact `/lsp`
pathname, existing Host policy, one parsed same-origin Origin when present,
exactly one registered repository ID, daemon attach, then upgrade. A genuinely
absent Origin is allowed only for otherwise-valid local scripts. Use a shared
redaction formatter for logs, stderr, HTTP rejection bodies, JSON-RPC error
message/data, send failures, and close reasons.

**Rationale**: Perimeter checks before repository work prevent repository/daemon
status enumeration and preserve the existing DNS-rebinding defense. Valid
JSON-RPC request IDs are echoed on the wire but never logged.

**Alternatives considered**:

- Resolve repository first: rejected because rejected callers could distinguish
  registered/unavailable repositories.
- Raw-string Origin comparison: rejected because scheme/hostname/effective-port
  normalization is required.

## Decision 10: Browser Transport and History

**Decision**: Use the native browser WebSocket and React Router 7.18 navigation.
The client opens only when the pane opens and never reconnects automatically.
Internal locations retain canonical file URIs; the URL stores only registered
repo ID, canonical relative path, and complete UTF-16 range. Initial/fallback
canonicalization uses replace, explicit definition/reference navigation pushes,
and POP restoration never pushes.

**Rationale**: React Router documents programmatic navigation with `replace` and
search-param navigation. Keeping router ownership avoids raw History API drift
and makes back/forward observable in normal route state.

**Alternatives considered**:

- Absolute file URI in the URL: rejected as a local-path privacy leak.
- Memory-only state: rejected because browser history is a binding requirement.

## Decision 11: Accessible Focused Source Surface

**Decision**: Build one single-tab-stop read-only composite with a
programmatically active token. Pointer and keyboard use the same exact mapping.
Expose named `Show hover details` and `Go to definition` controls. Hover details
are non-modal, associated, persistent while hovered/focused, and dismissed by
Escape/token change. Debounce/coalesce hover at 150 ms with latest-generation
guards. References remain a semantic grouped list.

**Rationale**: Per-token tab stops do not scale, while a bare focusable `<pre>`
does not expose active-token semantics or discoverable actions. The composite
contract permits a roving token or accessible caret-bearing realization during
implementation without growing into an editor.

**Alternatives considered**:

- Every token tabbable: rejected for tab-stop explosion.
- Pointer-only source: rejected by the accepted keyboard success criterion.
- Monaco/full editor: rejected as unnecessary workspace/editing scope.

## Decision 12: Degradation and Testing

**Decision**: Use the explicit dormant → connecting/loading → ready/empty state
machine, with stale, unavailable, timed-out, disconnected, and typed
source-unavailable variants. Retry is manual and replays only the current
validated location. Every location/retry/history/lifecycle change advances a
generation and superseded responses are canceled or discarded.

**Rationale**: This makes no-background-activity, stale truthfulness, unmount
cleanup, and preservation of existing symbol detail independently testable.

**Alternatives considered**:

- Background reconnect: rejected by privacy/dormancy requirements.
- Fail the whole symbol route: rejected because source is an additive panel and
  existing metadata must remain usable.

## Current Documentation Notes

- `ws` currently documents `noServer`, `handleUpgrade`, `maxPayload`,
  `bufferedAmount`, client tracking, ping/pong, and close-timeout behavior.
- React Router 7.18.1 supports search-param navigation and programmatic
  `{ replace: true }`; browser-history POP flows through router location state.
- The latest official LSP line is 3.18 and includes the standardized text-only
  content request, which this feature deliberately does not impersonate.
