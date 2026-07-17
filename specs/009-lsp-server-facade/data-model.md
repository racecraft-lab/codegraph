# Data Model: LSP Server Facade

No schema migration is introduced. These are in-memory protocol/session models
backed by existing indexed nodes, edges, and file records.

## Bound Repository

| Field | Type | Rules |
|---|---|---|
| `id` | string | Existing registered 16-hex repository identifier. |
| `rootRealpath` | string | Canonical absolute root, fixed before session reads. |
| `rootUri` | file URI | Canonical URI derived from `rootRealpath`. |
| `daemonClient` | lease | One reference to the pooled read client; release once. |

Validation:

- All supplied initialize root signals must be local file paths whose realpath
  equals `rootRealpath`; absence is valid.
- A session never changes repository. A selected-repository change creates a new
  browser session rather than rebinding one.

## Repository-Bound LSP Session

| Field | Type | Rules |
|---|---|---|
| `repository` | Bound Repository | Required before transport admission completes. |
| `transport` | `stdio` or `websocket` | Fixed for lifetime. |
| `lifecycle` | lifecycle state | See transitions below. |
| `pending` | map of JSON-RPC ID → Pending Request | WebSocket max 16; stdio still deadline-bounded. |
| `closed` | boolean | Makes teardown idempotent. |
| `timers` | owned set | Cleared during settlement/teardown. |
| `diagnostic` | redacted sink | Never receives source, params, paths, IDs, or raw errors. |

Lifecycle states and transitions:

```text
created --initialize(valid)--> initialized --shutdown(request)--> shutdown
   |             |                   |                              |
   | invalid     | duplicate         | exit before shutdown         | exit
   v             v                   v                              v
error response  -32600           terminated(1)                 terminated(0)

any state --transport loss/signal/fatal framing/server close--> terminated
```

Rules:

- Before initialize, non-lifecycle requests return `-32002`.
- After shutdown, only `exit` is accepted.
- Unsupported requests in initialized state return `-32601`; unsupported
  notifications are ignored without mutation or response.

## Pending Request

| Field | Type | Rules |
|---|---|---|
| `id` | JSON-RPC string/number | Echo on wire only; never log. |
| `method` | allowlisted method | Fixed closed vocabulary. |
| `acceptedAt` | monotonic timestamp | Deadline starts here. |
| `deadline` | timer | 5,000 ms; cleared once. |
| `settled` | boolean | Compare-and-set prevents duplicate responses. |
| `generation` | integer | Browser/navigation correlation when applicable. |

Transitions:

```text
accepted -> succeeded | protocol_error | timeout | canceled | transport_closed
```

Every terminal transition releases the slot and timer exactly once. Late daemon
results are discarded.

## Graph Location

| Field | Type | Rules |
|---|---|---|
| `uri` | canonical indexed file URI | Must remain within bound root. |
| `range.start` | UTF-16 Position | Zero-based line/character. |
| `range.end` | UTF-16 Position | Half-open and not before start. |
| `targetNodeId` | string, internal | Stable identity used to collapse duplicates. |
| `evidence` | declaration or located occurrence | Exact persisted evidence only. |

Rules:

- Multiple evidence rows collapse only when they resolve to one stable target.
- Definition uses the target declaration range.
- Reference uses each occurrence range, plus declaration only when requested.
- Unprovable or distinct overlapping targets yield null/empty.

## Indexed Source Snapshot

| Field | Type | Rules |
|---|---|---|
| `relativePath` | string | Canonical repository-relative indexed path. |
| `uri` | file URI | Internal/protocol identity; never serialized to browser URL. |
| `text` | string | Valid UTF-8, at most 1 MiB. |
| `languageId` | string | Existing indexed language identity. |
| `contentHash` | opaque string | Exact existing persisted hash. |
| `snapshotToken` | opaque string | Equality-only, stable for snapshot, non-secret. |
| `fileIdentity` | internal stat/handle identity | Used only during trusted read/revalidation. |

Trusted-read transition:

```text
indexed record
  -> canonical containment
  -> open stable regular handle
  -> read <= 1 MiB + sentinel
  -> hash exact candidate bytes
  -> revalidate identity/containment/index record
  -> return snapshot OR discard entire result
```

Typed failure reasons:

- `not_found`
- `outside_repository`
- `unindexed`
- `not_regular`
- `too_large`
- `unreadable`
- stale content uses `-32801` rather than the reason enum

## LSP Capabilities

| Field | Value |
|---|---|
| `positionEncoding` | `utf-16` |
| `textDocumentSync` | absent/none |
| `definitionProvider` | true |
| `referencesProvider` | true |
| `hoverProvider` | true |
| `documentSymbolProvider` | true |
| `workspaceSymbolProvider` | true |
| `experimental.codegraphTextDocumentContent` | typed descriptor for custom method |

No diagnostics, edits, rename, formatting, code actions, or indexing capability
is advertised.

## WebSocket Admission

| Field | Type | Rules |
|---|---|---|
| `pathname` | string | Exactly `/lsp`. |
| `hostAuthority` | parsed host/port | Existing server allowlist must pass first. |
| `origin` | parsed origin or absent | One exact same-origin HTTP(S) triple; absent only for local scripts. |
| `repoId` | string | Exactly one registered identifier. |
| `daemon` | attached client lease | Must be available before 101 upgrade. |

Admission is sequential and fail-closed. A perimeter rejection cannot reveal
repository or daemon state.

## WebSocket Session Limits

| Field | Value |
|---|---:|
| `maxPayloadBytes` | 1,048,576 |
| `maxInFlight` | 16 |
| `requestDeadlineMs` | 5,000 |
| `outboundHighWaterBytes` | 2,097,152 |
| `drainDeadlineMs` | 5,000 |

Binary, UTF-8, size, policy, internal, shutdown, and clean-close paths use the
close-code mapping in [contracts/websocket-transport.md](contracts/websocket-transport.md).

## Viewer Location State

Internal state:

| Field | Type | Rules |
|---|---|---|
| `repoId` | string | Must equal selected registered repository. |
| `uri` | canonical file URI | Never written to URL. |
| `range` | complete UTF-16 range | Nonnegative, ordered. |
| `snapshotToken` | opaque string or null | Cache/race comparison only; never URL/log. |

Serialized query state:

| Field | Type | Rules |
|---|---|---|
| `repo` | registered repo ID | Reject mismatch. |
| `source` | percent-encoded relative path | No absolute path, URI, or traversal. |
| `sl`, `sc`, `el`, `ec` | decimal integers | Complete zero-based UTF-16 range. |

History transitions:

- initial symbol location: replace
- invalid restored state: fallback and replace
- explicit definition/reference: push
- POP/back/forward: restore without another entry

## Viewer Interaction State

| Field | Type | Rules |
|---|---|---|
| `activeToken` | exact mapped token or null | One programmatic active token. |
| `focusOwner` | source/hover action/definition action/retry/reference | Stable and visible. |
| `hoverDetails` | bounded metadata or null | Non-modal, associated, dismissible. |
| `hoverGeneration` | integer | 150 ms latest-wins dispatch. |
| `references` | grouped locations | Server order, relative headings/counts. |

The composite has one tab stop. Named hover and definition controls operate on
`activeToken`; no per-token tab sequence is created.

## Viewer Connection State

States:

- `dormant`: pane closed, no socket
- `connecting`: explicit pane open/retry is opening a socket
- `loading`: current validated location request is in flight
- `ready`: nonempty source loaded
- `empty`: successful zero-byte source only
- `stale`: indexed hash differs; re-index required
- `unavailable`: attach/daemon or typed source-unavailable reason
- `timed-out`: accepted request reached five seconds
- `disconnected`: socket was lost unexpectedly

State fields:

| Field | Type | Rules |
|---|---|---|
| `generation` | integer | Increment on location/retry/history/repo/pane change. |
| `connection` | native WebSocket or null | Exists only while pane lifecycle owns it. |
| `location` | Viewer Location State | Current validated target. |
| `message` | bounded safe copy | Polite status or one-time actionable alert. |

No state auto-reconnects. Retry creates a fresh attempt only if needed and
replays the current location. A result applies only if repository, location,
snapshot token, generation, mounted pane, and live connection still match.
