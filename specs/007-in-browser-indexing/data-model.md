# Data Model: In-Browser Indexing

## Overview

The browser feature adds local repository state around the existing CodeGraph graph schema. Queryable graph, file, node, edge, source, and vector facts remain in SQLite and use shared migrations. Browser-only handle metadata and capability state live outside the graph database where they do not affect graph query semantics.

## Entities

### LocalRepository

Represents one browser-local repository known to the web app.

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | Opaque stable id derived from browser-local registry data; not a raw filesystem path. |
| `displayName` | string | Human-readable folder or import name. |
| `sourceKind` | enum | `picked-folder`, `dropped-snapshot`, or `imported-snapshot`. |
| `virtualRoot` | string | Normalized display root such as `/`; never exposes private absolute host paths. |
| `currentGeneration` | number | Last fully published successful index generation. |
| `status` | enum | `empty`, `ready`, `indexing`, `needs-permission`, `partial`, `error`, `deleting`. |
| `handleRefId` | string? | Registry pointer for a stored browser handle; absent for snapshots. |
| `manifestFingerprint` | string? | Stable hash of accepted source manifest for refresh comparison. |
| `createdAt` | ISO string | Registry creation time. |
| `lastIndexedAt` | ISO string? | Last successful publish time. |
| `capabilityProfile` | string | Summary of capability tier used for the repository. |

### SourceHandleRef

Stores permission-restorable browser handles in IndexedDB or equivalent structured-clone storage.

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | Registry-local id. |
| `kind` | enum | `directory` only for full folder-open flow. |
| `handle` | FileSystemDirectoryHandle | Structured-cloned handle, never serialized as a path. |
| `lastPermissionState` | enum | `granted`, `prompt`, or `denied`. |
| `sameEntryToken` | string? | Optional registry token used with `isSameEntry` checks. |
| `lastCheckedAt` | ISO string | Permission state check time. |

Validation:

- `requestPermission()` is called only after a user gesture on the window thread.
- Worker operations may read handles only after the main thread has established permission.
- A denied handle moves the repository to `needs-permission`, not `error`.

### SnapshotImport

Represents a directory snapshot captured from drag/drop or imported browser entries.

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | Import id. |
| `repositoryId` | string | Owning local repository. |
| `acceptedAt` | ISO string | Time snapshot was accepted. |
| `fileCount` | number | Count after filtering and caps. |
| `totalBytes` | number | UTF-8 text bytes accepted into source cache. |
| `rootLabel` | string | Display-only name. |

Validation:

- A snapshot is immutable after publish.
- Refresh requires a new snapshot import.
- Dropped directory handles are collected synchronously in the drop event before awaiting reads.

### BrowserIndexMetadata

Tracks one index generation.

| Field | Type | Rules |
|-------|------|-------|
| `repositoryId` | string | Owning local repository. |
| `generation` | number | Monotonic per repository. |
| `schemaVersion` | number | Shared CodeGraph schema version after migrations. |
| `graphDbFile` | string | Absolute SAH-pool filename within the installed VFS. |
| `status` | enum | `building`, `published`, `rolled-back`, `failed`, `deleted`. |
| `counts` | object | Files, nodes, edges, unresolved refs, warnings. |
| `startedAt` | ISO string | Build start. |
| `publishedAt` | ISO string? | Atomic publish time. |
| `failure` | object? | Stable error code and redacted message. |

Validation:

- Only one generation per repository may have `published` status.
- Failed generations do not replace `currentGeneration`.
- Delete removes graph DB, source cache, vector state, registry row, and handle references.

### SourceCacheEntry

Shared graph-database table owned by schema/migration changes.

| Field | Type | Rules |
|-------|------|-------|
| `repository_id` | text | Local repository id. |
| `generation` | integer | Index generation. |
| `path` | text | Normalized POSIX-style path relative to virtual root. |
| `content_hash` | text | Hash of accepted UTF-8 content. |
| `language` | text? | CodeGraph language id if supported. |
| `size_bytes` | integer | Accepted UTF-8 byte length. |
| `mtime_hint` | integer? | Best-effort browser timestamp, not a correctness key alone. |
| `text` | text | Accepted text used for source panes and parser input. |

Validation:

- Primary key is `(repository_id, generation, path)`.
- Entries above 1 MiB are rejected with a warning row, not truncated silently.
- Binary/NUL-containing files are rejected from text cache.
- Paths use `/`, reject `..`, reject absolute host paths, and remain case-preserving.
- Paths are admitted only after separator normalization rejects empty segments, `.`, `..`, absolute paths, duplicate normalized paths, unsupported entry kinds, recursive cycles, and configured traversal budget overruns.

### AcceptedFileManifest

Immutable manifest for one build input.

| Field | Type | Rules |
|-------|------|-------|
| `repositoryId` | string | Owning local repository. |
| `generation` | number | Build generation. |
| `entries` | array | Ordered by normalized path. |
| `fingerprint` | string | Hash of path, content hash, size, and language id. |
| `warnings` | array | Unsupported language, ignored, oversized, binary, permission, or hidden path warnings. |

Validation:

- Manifest order is deterministic.
- Manifest records filtered/skipped counts for status reporting.
- Manifest fingerprint changes trigger refresh eligibility.
- Manifest warnings include traversal-rejected entries before any rejected file text is read into source cache or graph input.

### WorkerOperation

Tracks an in-flight worker request.

| Field | Type | Rules |
|-------|------|-------|
| `operationId` | string | Stable per long-running operation. |
| `requestId` | string | Message correlation id. |
| `repositoryId` | string? | Required for repository operations. |
| `kind` | enum | See worker contract. |
| `state` | enum | `queued`, `running`, `cancelling`, `complete`, `failed`, `cancelled`. |
| `abortReason` | string? | Redacted reason for cancellation/failure. |

Validation:

- Terminal states are idempotent.
- Cancellation must not publish a partial generation.
- Progress events are advisory; terminal event is authoritative.

### CapabilityReport

Represents the live browser/runtime capability result.

| Field | Type | Rules |
|-------|------|-------|
| `secureContext` | boolean | Required for all durable browser-local flows. |
| `folderPicker` | enum | `available`, `missing`, `blocked-by-policy`. |
| `directoryDrop` | enum | `available`, `missing`, `partial`. |
| `opfs` | enum | `available`, `missing`, `quota-risk`. |
| `webLocks` | enum | `available`, `missing`. |
| `moduleWorker` | boolean | Required for local indexing. |
| `wasm` | enum | `available`, `blocked-by-csp`, `missing`. |
| `storageEstimate` | object? | Usage/quota when available. |
| `persistedStorage` | enum | `granted`, `denied`, `unknown`, `not-supported`. |

Validation:

- UI derives available actions from this report, not browser-name checks.
- Missing full-flow capabilities do not block REST-backed repository browsing.

### EmbeddingProfile

Secret-free persisted semantic configuration.

| Field | Type | Rules |
|-------|------|-------|
| `repositoryId` | string | Owning local repository. |
| `enabled` | boolean | False by default. |
| `endpointOrigin` | string | HTTPS origin and path allowed by user; no userinfo/query/fragment. |
| `model` | string | User-selected embedding model id. |
| `dimensions` | number? | Stored only when known. |
| `vectorGeneration` | number? | Generation for current vectors. |
| `coverage` | object | Embedded node count, skipped count, last failure code. |

Validation:

- API keys are never persisted.
- Semantic search is unavailable until graph generation and vector generation match.
- Network/CORS/TLS/mixed-content failures preserve stable error codes and redact endpoint secrets.

## State Transitions

```text
empty -> needs-permission -> indexing -> ready
empty -> indexing -> ready
ready -> indexing -> ready
ready -> indexing -> partial
ready -> needs-permission -> indexing -> ready
ready -> deleting -> empty
indexing -> cancelled -> previous ready|empty
indexing -> error -> previous ready|empty
```

Rules:

- A new generation publishes atomically only after migrations, source cache writes, node/edge writes, reference resolution, and status metadata complete.
- Cancellation, quota failure, grammar failure, or parse failure keeps the previous generation readable.
- Partial status is allowed only when the index publishes with non-fatal skipped-file warnings.

## Error Taxonomy

| Code | Meaning |
|------|---------|
| `capability_unavailable` | Required browser capability is missing or blocked by policy. |
| `permission_denied` | User denied or revoked access to a previously selected source. |
| `repository_busy` | Another tab or worker owns the repository lock/pool. |
| `quota_exceeded` | OPFS or browser storage quota prevented a durable write. |
| `asset_unavailable` | Worker, SQLite WASM, tree-sitter WASM, or grammar asset failed to load. |
| `unsupported_language` | File language is not supported by packaged grammars. |
| `file_too_large` | File exceeds the 1 MiB text cap. |
| `binary_file` | File is not accepted UTF-8 text. |
| `schema_migration_failed` | Shared migration sequence failed in browser SQLite. |
| `network_blocked` | Semantic endpoint blocked by CORS, CSP, TLS, mixed content, or browser network policy. |
| `credential_required` | Semantic call needs an in-memory key that is not present. |
| `operation_cancelled` | User cancelled a long-running operation. |

## Data Retention

- Delete repository removes registry metadata, stored handles, graph database files, source cache, vectors, and in-progress generations.
- Clearing site data may remove all browser-local state; UI must report missing registry/OPFS data as empty or recoverable, not corrupt.
- Source text remains browser-local and is never sent to a network endpoint except selected embedding inputs after explicit semantic opt-in.
