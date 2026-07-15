# Contract: Web API Consumption

## Scope

The SPEC-006 SPA consumes the shipped CodeGraph local HTTP API from `src/server/openapi.yaml` before adding any backend route. Existing read/reindex endpoints remain authoritative and same-origin. Browser requests use relative `/api/*` URLs.

## Existing Routes Consumed By The Web App

| Route | Method | Repo Scope | UI Usage | Notes |
|---|---|---|---|---|
| `/api/status` | GET | Default repo only | Server/index health and default repository status | Not repo-scoped. |
| `/api/repos` | GET | None | Repository picker | Startup repo is default; registry repos are listed when live. |
| `/api/search?q=&repo=` | GET | `?repo=<repo-id>` optional/default | Global search and empty/degraded states | Empty `q` is invalid; clients treat capped totals as capped. |
| `/api/node/{id}?repo=` | GET | `?repo=<repo-id>` optional/default | Symbol detail anchor | Node id is opaque and percent-encoded in path. |
| `/api/callers/{id}?repo=` | GET | `?repo=<repo-id>` optional/default | Caller relationships | Paged relationship view. |
| `/api/callees/{id}?repo=` | GET | `?repo=<repo-id>` optional/default | Callee relationships | Paged relationship view. |
| `/api/graph/{id}?repo=&depth=` | GET | `?repo=<repo-id>` optional/default | Graph neighborhood | Depth default/max follows OpenAPI; truncated flag is visible in UI. |
| `/api/impact/{id}?repo=` | GET | `?repo=<repo-id>` optional/default | Impact radius | Shares subgraph shape with graph route; truncation disclosed. |
| `/api/flows?repo=` | GET | `?repo=<repo-id>` optional/default | Flow catalog and trace-style entry points | Success-shaped degraded/miss states are preserved. |
| `/api/flows/{id}?repo=` | GET | `?repo=<repo-id>` optional/default | Flow detail graph | Unknown flow id may be success-shaped rather than 404. |
| `/api/clusters?repo=&minSize=` | GET | `?repo=<repo-id>` optional/default | Cluster and context navigation | UI treats labels as backend data, not LLM-created graph structure. |
| `/api/reindex/{repo}` | POST | Path repo id | Start sync/full re-analysis | URL/query only; duplicate active job returns `409`. |
| `/api/reindex/{repo}` | GET | Path repo id | Latest job state | Used for snapshot/refresh after navigation. |
| `/api/reindex/{repo}/events` | GET | Path repo id | Live EventSource progress | Live-only stream: snapshot, progress, terminal event, heartbeat comments, terminal status collapsed into snapshot for already-finished jobs, slow-consumer progress coalescing, disconnect does not cancel the job, no replay guarantee. |

## Error Handling

- REST errors use the existing CodeGraph JSON envelope: `{ "error": { "code": "...", "message": "...", "details": ... } }`.
- Success-shaped degraded states remain route-specific success payloads and must not be normalized into generic errors.
- Non-loopback server token behavior remains server-owned. Browser code must not persist provider credentials or provider bearer tokens.

## API Client Rules

- All runtime calls are relative same-origin `/api/*`.
- The app may use hand-written typed clients from `src/server/openapi.yaml`; generated clients are acceptable only if they keep the diff reviewable.
- The client layer exposes result unions for loading, empty, unavailable, stale, truncated, degraded, unauthorized, and error states.
- No client route can create executable flows for backend capabilities absent from OpenAPI except the approved SPEC-018 chat adapter.

## Acceptance Checks

- Contract tests cover request URL construction for repo-scoped and non-repo-scoped routes.
- UI tests verify `/api/*` 404/error behavior is not swallowed by the SPA fallback.
- Re-analysis tests cover start, duplicate active job, latest job, SSE snapshot/progress/terminal events, already-finished terminal snapshot, slow-consumer progress coalescing, disconnect-does-not-cancel behavior, and no replay assumption.
