# Contract: Local Index Worker

## Purpose

The local indexing worker owns browser-local parsing, SQLite-Wasm database access, OPFS source cache writes, graph queries, refresh, deletion, and optional semantic vector generation. The main thread owns UI state, user activation, and permission prompts.

## Message Envelope

```ts
export type WorkerRequest = {
  protocolVersion: 1;
  requestId: string;
  operationId?: string;
  repositoryId?: string;
  kind: WorkerRequestKind;
  payload?: unknown;
};

export type WorkerResponse =
  | WorkerAck
  | WorkerProgress
  | WorkerResult
  | WorkerFailure;
```

Rules:

- Every request has a unique `requestId`.
- Long-running requests have an `operationId`.
- Responses include the matching `requestId` and `operationId` when present.
- Payloads are structured-clone safe. No `Error` instances or DOM nodes cross the boundary.
- Transferable `ArrayBuffer` values are allowed for snapshot file content when useful.

## Request Kinds

| Kind | Payload | Result |
|------|---------|--------|
| `capabilities` | none | `CapabilityReport` |
| `open-picked-folder` | Granted `FileSystemDirectoryHandle`, config | `LocalRepository` and indexing operation |
| `import-snapshot` | Snapshot manifest and file buffers/text | `LocalRepository` and indexing operation |
| `reconnect` | Granted handle ref metadata | `LocalRepository` |
| `index` | Repository id and source provider | Published generation |
| `refresh` | Repository id | Published generation or warnings |
| `query` | Query kind and typed request | Existing API result shape |
| `embed` | Session credential, endpoint profile, model settings | Vector generation summary |
| `cancel` | Operation id | Cancellation acknowledgement |
| `delete` | Repository id | Deletion acknowledgement |
| `close` | none | Worker shutdown acknowledgement |

## Progress Events

```ts
export type ProgressPhase =
  | "queued"
  | "capability-check"
  | "permission-check"
  | "scan"
  | "read"
  | "grammar-load"
  | "parse"
  | "store"
  | "resolve"
  | "publish"
  | "embed"
  | "complete"
  | "cancelled"
  | "failed";
```

Each progress event includes:

- `phase`
- `repositoryId`
- `operationId`
- `completed`
- `total`
- `message`
- `warnings`
- `timestamp`

Rules:

- Progress is monotonic within a phase.
- Terminal phase is exactly one of `complete`, `cancelled`, or `failed`.
- `failed` includes a stable redacted error code.
- `cancelled` must not publish a partial generation.
- Progress emission is coalesced under the documented cadence ceiling and must not require one main-thread message per file, node, edge, vector, or source-cache row.

## Performance Budgets

The implementation must declare exact constants before code review for:

- `maxFilesPerReadBatch`
- `maxBytesPerReadBatch`
- `maxBytesPerWorkerPayload`
- `maxBytesPerSnapshotTransfer`
- `maxProgressEventsPerSecond`
- `maxEmbeddingBatchItems`
- `maxVectorRowsPerTransaction`

Rules:

- File reads, snapshot transfer, parser/store bundles, and embedding writes stay within the declared ceilings.
- ArrayBuffer transfer is preferred for snapshot payloads large enough to avoid duplicate structured-clone copies.
- Budget overruns return stable bounded warnings or recoverable failures before source text enters the source cache, graph, semantic queue, URLs, or logs.
- Long-running phases yield or return progress at the documented cadence so progress, cancel, and route chrome remain actionable.
- Evidence must record heartbeat maximum gap for scan, read, grammar-load, parse, store, publish, and embed phases.

## Database Rules

- The worker installs the SQLite-Wasm `opfs-sahpool` VFS once per runtime.
- A Web Lock serializes repository write operations before opening a write connection.
- The worker runs shared migrations before writing graph/source data.
- Builds write a new generation and publish atomically.
- Previous generation remains readable until publish succeeds.
- The worker closes statements/connections before deleting graph files.

## Source Rules

- The main thread may pass handles only after user-activation permission checks.
- The worker performs reads only through granted handles or immutable snapshots.
- Paths are normalized to POSIX-style relative paths before database writes.
- The worker admits only paths derived from source-provider ancestry metadata; absolute paths, empty segments, `.`, `..`, separator escapes, duplicate normalized paths, unsupported entry kinds, recursive cycles, and configured traversal budget overruns are warnings before source text is read.
- Files above 1 MiB, binary files, unreadable files, and unsupported languages produce warnings.
- Source text never leaves the worker except for requested source-pane reads or explicit semantic opt-in input.
- Source-pane payloads are plain text/token data only; worker responses never produce HTML markup, executable document content, iframe/blob/object URLs, CSS URLs, or link-autoload instructions from repository bytes.

## Query Rules

`query` supports these local query kinds:

- `list-repositories`
- `repository-status`
- `search`
- `node`
- `source`
- `callers`
- `callees`
- `graph`
- `impact`

Rules:

- Results match existing web API response shapes.
- Unsupported query shapes return `capability_unavailable`.
- Query methods must read only the published generation.
- The deterministic self-repository search, graph, and impact suite must capture SQLite `EXPLAIN QUERY PLAN` or equivalent browser-SQLite plan output, index/FTS usage, row limits, candidate caps, and any intentional bounded scan rationale.
- Local reads must remain eligible for the 150 ms p95 target while indexing, refresh, cancellation cleanup, and semantic embedding operations are active.

## Semantic Rules

- `embed` requires an explicit endpoint profile and a session-only credential.
- The worker may store vector rows and a secret-free profile.
- The worker must not persist API keys or bearer tokens.
- Direct endpoint failures are normalized as `network_blocked`, `credential_required`, or provider error codes with redacted details.
- Keyword search remains available if semantic vector generation fails.
- Embedding runs as a distinct long-running operation with its own `operationId`, cancellation state, resumable progress, and documented endpoint/vector batch ceilings.
- Cancellation prevents new endpoint calls before the next documented batch and persists only secret-free resumable state consistent with the current graph generation.
- Active, paused, failed, or cancelled embedding must not block local keyword search, graph, or impact reads from the published keyword generation.

## Failure Handling

| Failure | Required Behavior |
|---------|-------------------|
| Worker boot failure | UI reports local indexing unavailable. |
| WASM asset failure | Return `asset_unavailable`. |
| OPFS unavailable | Return `capability_unavailable`. |
| Repository lock unavailable | Return `repository_busy`. |
| Permission revoked | Return `permission_denied`; keep previous generation if present. |
| Quota exceeded | Return `quota_exceeded`; rollback in-progress generation. |
| Migration failure | Return `schema_migration_failed`; previous generation remains readable. |
| User cancellation | Return `operation_cancelled`; no partial publish. |

## Versioning

- `protocolVersion` starts at `1`.
- The worker rejects unknown major protocol versions.
- New optional fields must be ignored by older clients when possible.

## Resource Release

- Parser trees and per-file parse resources are released after each file result is materialized.
- Grammar/parser caches, SQLite statements, database handles, SAH-pool/VFS ownership, transferable buffers, vector matrices, and worker instances are released or bounded after completion, cancellation, delete, worker crash, and close.
- Repeated self-repository index/delete/reindex and embed cancel/resume evidence must record resource high-water and post-cleanup state.
