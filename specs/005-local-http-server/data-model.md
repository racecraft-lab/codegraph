# Phase 1 Data Model: Local HTTP Server & REST API

Entities are **wire shapes** the API returns/accepts — there is no new persisted
store (reads forward to the daemon's `node:sqlite` index; job state is in-memory,
lost on restart, Q8). Field-level detail and status codes are pinned by
[`contracts/openapi.yaml`](./contracts/openapi.yaml); this document is the
conceptual model. Slice tags mark which review slice introduces each entity.

---

## Repo (indexed project) — *Slice 1*

An entry in the daemon registry, addressable by repo id.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | 16-hex-char SHA-256 prefix of the realpath'd project root — the registry's own record key (FR-010). Opaque, URL-safe (hex only), stable across restarts. |
| `root` | string | Canonical (realpath'd) project root. |
| `name` | string | The root's basename. |
| `default` | boolean | Exactly one entry (the startup repo) is `true` (FR-009). |

- **Source**: `listDaemons()` in `src/mcp/daemon-registry.ts`; `id` = `sha256(path
  .resolve(root)).slice(0,16)` — identical to the registry key by construction.
- **Addressing**: repo-scoped routes take `id`; a non-default repo's daemon is
  attached **lazily** on first access (FR-010, Q2). An unknown/unregistered id →
  404 `not_found` with `details.resource: "repo"` (FR-011). The API never runs
  first-time `init` (dormancy — Constitution VII).

## Node id (opaque token) — *Slice 1*

Not a standalone entity but a **value type** governing node addressing (FR-004a).

- Two shapes: `<kind>:<32hex>` or `file:<relative/posix/path>`.
- In a URL path segment the client **percent-encodes** the id (literal `/` →
  `%2F`). The server splits the raw path on literal `/` **first**, then decodes
  the matched segment with **exactly one** `decodeURIComponent` call at a single
  site (the raw path is never decoded before the split).
- Resolved **only** as an opaque DB key (existing exact-match lookup) — never as a
  filesystem path, so a traversal-shaped id (`../`, absolute) is just a key with
  no match. Unknown or malformed id → 404 `not_found` (`details.resource:
  "node"`); the two are deliberately indistinguishable.

## Server status — *Slice 1*

Returned by `GET /api/status` (FR-005). Enough to confirm liveness + served
project without inferring from other calls.

| Field | Type | Notes |
|-------|------|-------|
| `version` | string | Server/API version (the versioning channel — no URL prefix, FR-016). |
| `repo` | `{ id, root, name }` | The **default** repo only (full list is `/api/repos`, not duplicated here). |
| `index` | `{ state, fileCount, nodeCount, edgeCount, lastIndexed }` | Index health summary. |
| `hybridSearch` | `{ available, reason }` | SPEC-003 availability + why (e.g. embeddings unconfigured). |
| `lsp` | `{ available }` | SPEC-008 availability. |

- **Excluded** (CLI-diagnostic internals, not the API's job): db size, journal
  mode, backend name (FR-005).

## Read query result — *Slice 1*

Graph data returned by the read endpoints (FR-004, FR-008 — served from the shared
daemon index).

- **List results** (`search`, `callers`, `callees`): `{ items: Node[], total,
  limit, offset }` — `total` is the match count (for `search`, capped at the scan
  ceiling — `min(matches, 500)`, FR-006); the response echoes the
  **effective** paging window (`limit` default 100 / **max 500**, clamped not
  errored; `offset`) (FR-006).
- **Node detail** (`GET /api/node/:id`): the node's **own fields only** (identity,
  kind, name, location, signature/doc metadata). Callers and callees are the
  separate offset-paged endpoints, and impact the separate subgraph endpoint —
  keeps the node payload bounded regardless of fan-in (FR-004).
- **Graph neighborhood** (`GET /api/graph/:id`): `{ nodes: Node[], edges: Edge[],
  truncated }` within `depth` (default 1 / **max 3**); `nodes` capped at **2000**;
  `truncated: true` when a cap is hit (FR-007).
- **Impact radius** (`GET /api/impact/:id`): the **same** node+edge subgraph shape
  as graph neighborhood — `{ nodes: Node[], edges: Edge[], truncated }` — because
  the library's `getImpactRadius` returns a Subgraph, not a flat list; it is
  therefore **not** an offset-paged list endpoint (FR-004/006). Its `depth` defaults
  to **3** — the library's `getImpactRadius(nodeId, maxDepth=3)` natural default,
  **not** the neighborhood default of 1 — with the same **max 3**; an over-max value
  clamps, a malformed/negative one → **400** `invalid_request` (FR-004/015a).

**Search mode** (`GET /api/search`, FR-006a): optional `mode ∈ {keyword, semantic,
hybrid, auto}`, mapping 1:1 to SPEC-003 modes; **defaults to `auto` only when
omitted**. An invalid `mode` value → **400** `invalid_request` (diverges
deliberately from MCP/CLI coercion — REST clients want the machine-readable
error). A `semantic`/`hybrid`/`auto` request that **degrades** to keyword
(embeddings unavailable) → **200** with `degraded: true` + `degradationReason`
(degradation is never an HTTP error).

## Re-index job — *Slice 2*

A unit of re-index work for one repo (in-memory, latest-per-repo, lost on restart).

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | `crypto.randomUUID()`. |
| `repo` | string | Repo id (FR-010). |
| `mode` | `"sync" \| "full"` | `sync` default; `full` when `?full=true` (FR-020). The **discriminator** for `result`. |
| `status` | `"running" \| "done" \| "error"` | Created **running**; no `queued` state (no queue, Q8). |
| `startedAt` | string (ISO-8601) | Set at creation. |
| `finishedAt` | string (ISO-8601)? | Set on terminal transition. |
| `reason` | string? | On `error`: `aborted` (shutdown) \| `lock_unavailable` (lock retry window exhausted) \| an extraction failure. Open-but-documented list (each new value gets spec'd, mirroring FR-015a discipline). |
| `result` | union (below) | Present on `done` (and on a partial `full` that set `success:false`). |

**Lifecycle**: `running` → terminal `done` | `error`. One active job per repo; a
second `POST` while one runs → **409** `conflict` (FR-022). `409` is reserved
**only** for a duplicate active job in *this server's* registry — never for
external lock contention (that is a job `error`/`lock_unavailable`, FR-021a) and
never for daemon attach failure (that is 503 `unavailable`, FR-015a). Every in-job
failure is **contained**: any error the job's `sync()`/`indexAll()` raises that is
not lock contention (FR-021a) or a shutdown abort (FR-023) is caught and recorded
as a terminal `error` with a whitelisted `reason`, delivered over SSE and readable
via latest-job-state — it never crashes the serve process, surfaces as a 5xx on the
already-returned `202`, or leaves the job stuck `running` (FR-021).

**Terminal `result`, discriminated on `mode`** (FR-023/024; see research.md D3 —
FR-015a whitelist applied, raw path arrays and `errors[]` dropped):

```
mode "sync": { filesChecked, filesAdded, filesModified, filesRemoved,
               nodesUpdated, durationMs }
mode "full": { success, filesIndexed, filesSkipped, filesErrored,
               filesDiscovered?, nodesCreated, edgesCreated, durationMs }
```

A **partial** full index (aborted rebuild, or silent mid-pipeline drop) →
`success: false` and/or `filesDiscovered > filesIndexed + filesSkipped +
filesErrored`; recoverable by re-running the job.

## Progress event (SSE) — *Slice 2*

A message on a job's per-repo stream `GET /api/reindex/:repo/events`
(`Content-Type: text/event-stream`), FR-023.

| Event | Payload | When |
|-------|---------|------|
| `snapshot` | full job descriptor | **On every connect** (mid-job reconnect re-snapshots; if already finished, the snapshot is terminal and the stream closes immediately). |
| `progress` | `{ phase, current, total, currentFile? }` | Live, mirroring the library `IndexProgress` **verbatim**. `phase ∈ scanning \| parsing \| storing \| resolving \| embedding` (`embedding` only when embeddings configured). |
| `done` / `error` | terminal job descriptor | **Single** terminal event; the stream ends after it. |

- No `id:` field, no Last-Event-ID replay (Q8). A client disconnect stops writes to
  that response but **MUST NOT** cancel the running job (FR-023). Browser note
  (SPEC-006/009): `EventSource` cannot send `Authorization`, so a token-bound
  deployment's browser client must use `fetch` + `ReadableStream` (FR-014).
- **Transport headers** (FR-023): `Content-Type: text/event-stream`,
  `Cache-Control: no-cache`, `Connection: keep-alive`, and `X-Accel-Buffering: no`
  (disables reverse-proxy response buffering that would otherwise batch/withhold
  the stream). A heartbeat comment frame — a `:`-prefixed line, ignored by
  `EventSource` — is sent about every 15 s (below the common 30–60 s proxy/browser
  idle timeout) so a quiet long job is not timed out.
- **Backpressure & fan-out** (FR-023): `IndexProgress` fires per file, so `progress`
  frames are written per subscriber under backpressure — when a subscriber's socket
  refuses a write (`res.write()` → `false`) the server coalesces to the latest
  pending `progress` instead of buffering an unbounded backlog (a slow subscriber
  may skip superseded intermediate frames; each frame carries the absolute
  `current`/`total`), always delivering the `snapshot` and the terminal event.
  Multiple subscribers may attach concurrently; each is snapshotted independently
  and a slow/disconnected one never stalls the job or the others.

## Error envelope — *Slice 1*

The uniform shape returned by **every** failing request (FR-015): `{ error: {
code, message, details? } }`.

`error.code` is exactly one of **six** values (FR-015a):

| code | HTTP | Meaning |
|------|------|---------|
| `invalid_request` | 400 | Malformed/negative params; non-allowlisted `Host`; invalid `mode`. An over-cap `limit`/`depth` **clamps** (echoing the effective value), does not error. |
| `unauthorized` | 401 | Missing/invalid Bearer on a token-bound bind. Body is **generic and identical** regardless of reason (enumeration prevention). |
| `not_found` | 404 | One code for all not-found; `details.resource ∈ node \| repo \| route`. |
| `conflict` | 409 | Duplicate active job for a repo (FR-022) — that case only. |
| `unavailable` | 503 | Daemon attach/spawn failure. Transient; **carries `Retry-After`**. |
| `internal` | 500 | Unexpected faults only; every handler is wrapped in a top-level catch so an unanticipated throw becomes this envelope — never a raw crash, leaked stack, or hung socket (FR-015a). |

- `message`/`details` are **whitelisted, schema-defined fields only** — never raw
  exception text, absolute paths, stack traces, or cause chains (FR-015a).

## Non-entities (boundary notes)

- **WebSocket / upgrade**: SPEC-005 exposes the server's `'upgrade'` attach point
  and implements nothing (reserved for SPEC-009). No data model here.
- **Static assets**: SPEC-006 owns `web/` + its `copy-assets` wiring; SPEC-005
  ships only the static placeholder (FR-017/017a — no repo-identifying data,
  byte-identical regardless of registered repos) and `openapi.yaml`.
