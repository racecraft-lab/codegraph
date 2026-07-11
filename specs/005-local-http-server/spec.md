# Feature Specification: Local HTTP Server & REST API

**Feature Branch**: `005-local-http-server`

**Created**: 2026-07-10

**Status**: Draft

**Input**: User description: "SPEC-005 — `codegraph serve --web` exposes the full graph read surface plus re-index jobs over a documented local REST API riding the existing daemon/query-pool. Local-first, dormant by default, no hosted services. Unblocks SPEC-006 (web graph browser) and reserves the SPEC-009 LSP-over-WebSocket upgrade hook."

## Overview

CodeGraph's knowledge graph is reachable today only through MCP (for agents) and the CLI (for terminal users). SPEC-006's web graph browser and SPEC-009's LSP facade need a documented local HTTP surface to build on. This feature adds one opt-in command — `codegraph serve --web` — that stands up a local REST API over the existing per-project daemon: every read capability the graph already exposes (symbol search, callers, callees, impact, graph neighborhood, status) plus repo discovery and on-demand re-index jobs, streamed as live progress. The server binds loopback by default, refuses unsafe network exposure, and adds no new runtime dependencies (design concept Q1–Q13).

The work is split into **two vertical review slices on this one branch** (Q13): Slice 1 delivers the read API end-to-end; Slice 2 layers the job subsystem on top. User stories partition cleanly across the two slices (see Reviewability Budget).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Query the graph over a local REST API (Priority: P1) *(Slice 1)*

As a developer working in an indexed project, I run `codegraph serve --web` and query symbols, callers/callees, impact, graph neighborhoods, and server status over documented REST endpoints — served from the same warm daemon index my MCP sessions already use, so results match what my agent sees.

**Why this priority**: This is the MVP. The read API is the whole reason the server exists — it is what SPEC-006's browser renders and what a developer can exercise directly today with a browser or `curl`. Everything else hardens or extends it.

**Independent Test**: Start `codegraph serve --web` in an indexed repo, then retrieve status, a symbol search, callers, callees, impact, and a graph neighborhood over the documented endpoints and confirm each returns the expected graph data as JSON — with zero source files read by hand. Delivers a usable read API even if no other story ships.

**Acceptance Scenarios**:

1. **Given** an indexed project with a running daemon, **When** the developer starts `codegraph serve --web` and requests server status, **Then** the response reports the server version and index health so the client can confirm the API is live and which project is served.
2. **Given** the server is running, **When** the developer searches for a symbol name, **Then** the response returns matching graph nodes as JSON, drawn from the shared warm index, paged with a total count.
3. **Given** a known symbol, **When** the developer requests its callers, its callees, and its impact radius, **Then** each endpoint returns the corresponding graph relationships as JSON consistent with the same query run over MCP or the CLI.
4. **Given** a known symbol, **When** the developer requests a graph neighborhood, **Then** the response returns nodes and edges within the requested depth and signals when the result was capped.

---

### User Story 2 - Discover and address multiple indexed repos (Priority: P3) *(Slice 1)*

As a developer with several indexed projects on my machine, I list them via `/api/repos` and address any of them by repo id in repo-scoped requests; the server attaches a daemon for a non-default repo lazily, only when I first touch it (Q2).

**Why this priority**: Multi-repo turns the single-project server into the project switcher SPEC-006 wants, and `/api/repos` is in the roadmap's endpoint list. It extends US1 rather than being required for the MVP — single-repo browsing is viable without it — so it ranks below the core read API and the safe-binding hardening.

**Independent Test**: With two indexed projects registered, start the server in one, call `/api/repos`, confirm both projects are listed with the startup project marked as default, then issue a repo-scoped read against the second project and confirm its daemon is attached on demand and returns that project's data.

**Acceptance Scenarios**:

1. **Given** two indexed projects known to the daemon registry, **When** the developer requests `/api/repos`, **Then** both are listed and the project the server was started in is identified as the default.
2. **Given** a second, not-yet-attached repo appears in `/api/repos`, **When** the developer issues a repo-scoped read against it, **Then** the server attaches that repo's daemon on demand (not eagerly at startup) and returns that repo's graph data.
3. **Given** a repo id that is not indexed/registered, **When** the developer addresses it, **Then** the server returns a not-found error in the standard envelope rather than failing the request pipeline.

---

### User Story 3 - Trigger a re-index and watch live progress (Priority: P4) *(Slice 2)*

As a developer (or the SPEC-006 UI), I trigger a re-index job for a repo — incremental sync by default, or a full rebuild with `?full=true` — watch live progress over a streamed connection, get a conflict response if a job is already running for that repo, and read the last job's outcome after it finishes (Q6–Q8).

**Why this priority**: The job subsystem is the second, layered slice. It depends on the read API and repo addressing already existing, and a corrupt/partial index recovery path is valuable but not part of the minimum read surface. It ships as a separate, sequenced PR.

**Independent Test**: With the read API in place, POST a re-index for a repo, subscribe to its progress stream, observe an immediate snapshot followed by live progress and a terminal event, POST a second re-index for the same repo while the first runs and confirm it is rejected with a conflict, then read the finished job's terminal outcome.

**Acceptance Scenarios**:

1. **Given** an indexed repo with no job running, **When** the developer POSTs a re-index without `?full=true`, **Then** an incremental sync job starts; **When** they POST with `?full=true`, **Then** a full rebuild job starts instead.
2. **Given** a re-index job is running for a repo, **When** a client subscribes to its progress stream, **Then** the client receives an immediate snapshot of current state, then live progress events, and the stream ends after a terminal done/error event.
3. **Given** a re-index job is already running for a repo, **When** a second re-index is requested for the same repo, **Then** the server responds with a conflict (409) in the standard envelope and does not start a duplicate job.
4. **Given** a re-index job has finished, **When** the developer reads that repo's latest job state, **Then** the terminal outcome (succeeded or failed) is available until the server restarts.

---

### User Story 4 - Safe-by-default network binding and token auth (Priority: P2) *(Slice 1)*

As a security-conscious user, I trust that the server binds loopback by default and needs no auth there, refuses to start on a non-loopback host unless `CODEGRAPH_SERVER_TOKEN` is set, and then enforces that token as a Bearer header on every `/api/*` request (Q5).

**Why this priority**: Fail-closed binding is a release-blocking property of the read API, not an optional add-on — the alternative failure mode is an unauthenticated code index exposed on the LAN. It ranks just below the core read surface and above multi-repo because security-by-default cannot be deferred.

**Independent Test**: Start the server with defaults and confirm it binds loopback and serves `/api/*` without credentials; attempt to bind a non-loopback host with no token set and confirm startup is refused; set a token, bind non-loopback, and confirm `/api/*` requests without a valid `Authorization: Bearer` are rejected while valid ones succeed.

**Acceptance Scenarios**:

1. **Given** no host override, **When** the server starts, **Then** it binds the loopback interface and serves `/api/*` without requiring authentication.
2. **Given** a non-loopback host override and no `CODEGRAPH_SERVER_TOKEN` set, **When** the server is asked to start, **Then** startup is refused with a clear message and nothing binds.
3. **Given** a non-loopback host override with `CODEGRAPH_SERVER_TOKEN` set, **When** a client calls `/api/*` without a valid `Authorization: Bearer` header, **Then** the request is rejected with 401 in the standard envelope; **When** the client presents the valid Bearer token, **Then** the request succeeds.

---

### Edge Cases

- **Server not started with `--web`**: no HTTP listener opens, no port binds, and behavior is byte-identical to the prior release (dormancy, Constitution VII).
- **Requested port already in use / bind fails**: the server reports the failure clearly and exits without leaving a half-open listener.
- **Read against a repo whose daemon cannot be spawned/attached**: returns an error in the standard envelope, not an unhandled crash.
- **List query exceeds the server maximum page size**: the server clamps to its hard cap rather than returning an unbounded result (Q12).
- **Graph neighborhood exceeds the node cap**: the result is truncated and the response flags it so a consumer can narrow the query (Q12).
- **Client disconnects mid-stream during a re-index**: the running job is unaffected and continues; a later subscriber re-snapshots current state (no Last-Event-ID replay, Q8).
- **Static assets absent (all of SPEC-005's life)**: `/` serves a minimal built-in placeholder page pointing at `/api/status`, not a raw 404 (Q11).
- **Unknown `/api/*` path**: returns 404 as the JSON error envelope; a missing asset-extension path (`.js`, `.css`, …) returns 404 without falling back to the app shell; only an extensionless browser route falls back to the shell (Q11, binding from SPEC-004).
- **Cross-origin request**: denied by default — the server sends no CORS headers (Q11).

## Requirements *(mandatory)*

### Functional Requirements

**Activation, process model, and dependency posture**

- **FR-001**: The system MUST expose the HTTP server only when `codegraph serve --web` is invoked; without `--web`, no HTTP listener opens, no port is bound, and observable behavior is byte-identical to the prior release (dormancy — Constitution VII; Q3).
- **FR-002**: The serve process MUST act as a daemon *client* for all read queries — attaching to (or spawning) the per-project daemon and forwarding queries over its socket — so the web API and MCP sessions share one warm index; it MUST NOT open a second in-process copy of the index for reads (Q1).
- **FR-003**: The system MUST NOT add new runtime dependencies to satisfy this feature; the HTTP server, streaming, and static mount are built on the runtime's standard capabilities (Q4; Constitution VII). Any static-serving escape hatch is deferred until a later spec proves the need.

**Read endpoints**

- **FR-004**: The system MUST expose documented read endpoints returning JSON for: server status, symbol search, callers of a symbol, callees of a symbol, impact radius of a symbol, graph neighborhood of a symbol, and the list of indexed repos (US1, US2).
- **FR-005**: The status endpoint MUST report at least the server/API version and index health so a client can detect that the API is live and what it is serving, without inferring capability from other calls (Q9 — version is carried in status, not a URL prefix).
- **FR-006**: List-style endpoints (symbol search, callers, callees) MUST support offset paging via `limit` and `offset`, defaulting `limit` to 100 with a server-enforced maximum of 500, and each response MUST carry the total count of matching items (Q12).
- **FR-007**: The graph-neighborhood endpoint MUST accept a traversal depth defaulting to 1 with a maximum of 3, MUST cap returned nodes at 2000, and MUST set a `truncated` flag on the response when the cap is reached (Q12).
- **FR-008**: Read results MUST be served from the shared daemon index (per FR-002), reflecting the index as of the daemon's current state (last sync / file-watch update).

**Multi-repo discovery and addressing**

- **FR-009**: The system MUST provide a `/api/repos` endpoint listing the indexed projects known to the daemon registry, with the project the server was started in identified as the default repo (Q2).
- **FR-010**: Repo-scoped endpoints MUST accept a repo identifier addressing any listed repo, and the daemon for a non-default repo MUST be attached lazily on first access rather than eagerly at startup (Q2). [NEEDS CLARIFICATION: repo identifier scheme for `/api/repos` entries and the `:repo` path segment — is a repo addressed by an opaque server-assigned id, its absolute filesystem path, a hash of that path, or a short project name? This is load-bearing for every repo-scoped endpoint and for how SPEC-006 builds its project switcher.]
- **FR-011**: Addressing a repo that is not indexed/registered MUST return a not-found error in the standard envelope, never an unhandled failure of the request pipeline.

**Authentication and network binding**

- **FR-012**: The default bind MUST be the loopback interface and MUST require no authentication there (Q5). [NEEDS CLARIFICATION: default listen port for `serve --web`; whether `--web` and the hidden `--mcp` mode may be combined on a single `serve` invocation or are mutually exclusive; and whether the IPv6 loopback address (`::1`) is treated as loopback for the no-auth path.]
- **FR-013**: Binding to any non-loopback host MUST fail at startup unless `CODEGRAPH_SERVER_TOKEN` is set — fail-closed, so an unauthenticated code index is never exposed on the network (Q5).
- **FR-014**: When a token is configured for a non-loopback bind, every `/api/*` request MUST present a matching `Authorization: Bearer` token; a missing or invalid token MUST be rejected with 401 in the standard envelope (Q5).

**Error envelope and versioning**

- **FR-015**: Every error response across the API MUST use a single envelope shape: `{ error: { code, message, details? } }` (Q9).
- **FR-016**: Endpoints MUST NOT carry a URL version prefix (no `/api/v1`); the API version is reported through the status endpoint instead, because the only sanctioned client ships in the same package as the server and cannot skew (Q9).

**Static mount and route fallback**

- **FR-017**: The system MUST serve static assets from the web build directory when present; while that directory is absent (all of SPEC-005's life), `/` MUST return a minimal built-in placeholder page that points the visitor at the status endpoint, rather than raw JSON or a bare 404 (Q11).
- **FR-018**: Route fallback MUST follow the binding SPEC-004 rules: unknown `/api/*` paths return 404 as the JSON error envelope; requests for missing asset-extension paths (e.g., `.js`, `.css`) return 404 without falling back; only extensionless browser-route paths fall back to the app shell (Q11).
- **FR-019**: The server MUST be same-origin only — it MUST NOT emit CORS headers and MUST NOT honor cross-origin requests (Q11; Constitution VII no-external-surface posture).

**Re-index jobs (Slice 2)**

- **FR-020**: The system MUST provide a `POST /api/reindex/:repo` endpoint that starts a re-index job for the addressed repo, defaulting to an incremental sync and escalating to a full rebuild when `?full=true` is supplied (Q6).
- **FR-021**: Re-index jobs MUST run inside the serve process via the library's sync/full-index operations, arbitrated against the daemon's file watcher by the existing cross-process file lock; the daemon MUST retain its no-indexing invariant (no new indexing RPC is added to the daemon) (Q7).
- **FR-022**: The system MUST allow at most one active job per repo; a re-index request for a repo that already has a job running MUST return 409 Conflict in the standard envelope and MUST NOT start a duplicate job (Q8).
- **FR-023**: Job progress MUST be delivered to subscribers as a live stream: a subscriber receives an immediate snapshot of current state, then live progress events, and the stream ends after a terminal done/error event, with no Last-Event-ID replay (a mid-job reconnect re-snapshots) (Q8). [NEEDS CLARIFICATION: subscription and lifecycle edges — is progress delivered from a per-repo events endpoint or a per-job id, and how does the client that POSTed the re-index correlate to its stream; and if the serve process is asked to shut down while a job is running, is the in-process re-index aborted cleanly and the index lock released, or is shutdown deferred until the job ends?]
- **FR-024**: Job state MUST be held in memory as the latest job per repo, so a client can read the last job's terminal outcome after it finishes; no job state persists across a server restart (Q8).

**Contract honesty**

- **FR-025**: The system MUST ship a committed, hand-written API description document that documents every endpoint (path, method, and response shapes), kept honest by a contract test that walks every documented path/method/status against a running fixture server and fails on any undocumented route or mismatched response shape (Q10).

**Lifecycle**

- **FR-026**: The server MUST start, serve, and stop cleanly under standard process termination, releasing the bound port on exit so a subsequent start can re-bind. (Behavior when a job is in flight at shutdown is captured in FR-023's clarification.)

### Reviewability Budget *(mandatory)*

- **Primary surface**: API
- **Secondary surfaces, if any**: CLI (`serve --web` activation and bind/auth flags); scheduler/runtime (the job subsystem in Slice 2); docs/process (the committed API description document and its contract test)
- **Projected reviewable LOC**: ~620 net-new (per the design concept's Q13 size signals), divided across the two slices so each stays under the ~400-LOC review ceiling
- **Projected production files**: ~7
- **Projected total files**: ~14 (production plus tests and the API description document)
- **Budget result**: warning accepted — split into two review slices. The single-spec projection trips the greenfield warn line (600 LOC / 6 production files) with no hard blocker (Q13); the accepted resolution is a 2-slice split, not one oversized PR.
- **Split decision**: Two vertical, sequenced, review-markered PRs on this branch (`005-local-http-server`). **Slice 1** = read API end-to-end: `serve --web`, the request router, safe binding and token auth (US1, US2, US4), all read endpoints, the API description document, and contract tests — independently shippable and the thing that unblocks SPEC-006. **Slice 2** = job subsystem layered on top: `POST /api/reindex/:repo`, the live progress stream, and the 409 single-active-job rule (US3). Each slice cuts end-to-end through CLI → server → daemon/library → tests and stays under the ~400-LOC ceiling.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, and rollback or feature-flag notes. The dormancy flag (`--web`) is the rollback lever — absent it, no behavior changes.
- Traceability MUST map each major requirement or success criterion to changed files and verification evidence, including the self-repo dogfood exercise (SC-008).
- Deferred work MUST name the follow-up spec or issue (SPEC-006 for the web UI; SPEC-009 for the LSP-over-WebSocket handler).

### Key Entities *(include if feature involves data)*

- **Repo (indexed project)**: an entry in the daemon registry addressable by a repo identifier; carries its project root and index/health status, and one entry is flagged as the server's default. (Identifier scheme is FR-010's clarification.)
- **Read query result**: graph nodes and/or edges returned as JSON for a read endpoint; list results additionally carry `total`, and echo the effective paging window; the graph-neighborhood result additionally carries `truncated`.
- **Re-index job**: a unit of re-index work for one repo; carries its mode (incremental sync or full rebuild), lifecycle status (running or a terminal done/error), progress information, and start/finish timing. In memory only, latest-per-repo, lost on restart.
- **Progress event**: a message on a job's live stream — an initial snapshot, subsequent progress updates, and a single terminal done/error event that ends the stream.
- **Error envelope**: the uniform error shape `{ error: { code, message, details? } }` returned by every failing request.
- **Server status**: the descriptor returned by the status endpoint — at least API/server version and index health, sufficient for a client to confirm liveness and served project.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can start `codegraph serve --web` in an indexed repo and retrieve status, symbol-search, callers, callees, impact, and graph-neighborhood results over the documented endpoints — every read capability available via MCP/CLI is reachable over HTTP — without reading any source file by hand.
- **SC-002**: Safe-by-default binding holds 100% of the time: with defaults the server binds loopback and serves `/api/*` without credentials, and an attempt to bind a non-loopback host with no token set prevents startup every time (nothing binds).
- **SC-003**: With a token configured on a non-loopback bind, 100% of `/api/*` requests lacking a valid Bearer token are rejected and 100% of requests with the valid token succeed.
- **SC-004**: A re-index triggered via the API surfaces live progress to a connected client and a terminal outcome the client can read after completion; a duplicate re-index for the same repo is rejected while one is running, 100% of the time.
- **SC-005**: The committed API description matches the running server — the contract test detects any undocumented route or mismatched response shape, and CI tolerates zero undocumented endpoints.
- **SC-006**: With `--web` not passed, the tool performs zero network binds and behaves identically to the prior release (dormancy verified).
- **SC-007**: Each of the two review slices lands as its own PR under the ~400 reviewable-LOC ceiling.
- **SC-008**: The API is exercised against this repository's own index as a self-repo dogfood step — `serve --web` here answers `/api/status` and a symbol search with this project's data (Constitution "Dogfooding (binding)").

## Out of Scope

- The web UI itself — delivered by SPEC-006; SPEC-005 ships only the API and a placeholder page.
- The LSP-over-WebSocket handler — SPEC-009; SPEC-005 reserves the connection-upgrade path but implements no WebSocket or LSP behavior (nothing to assert here, so it is a boundary note, not a functional requirement).
- TLS / HTTPS termination — reverse-proxy territory.
- Any new daemon RPC for indexing — the daemon keeps its no-indexing invariant; jobs run in the serve process (Q7).
- Job history or persistence — only the latest job per repo is kept, in memory, lost on restart (Q8).
- CORS / cross-origin access — same-origin only (Q11).
- Cursor-based pagination — offset/limit with hard caps only (Q12).
- URL versioning (`/api/v1`) — version is reported in status (Q9).
- Eager attach of all registered repos — lazy attach only (Q2).

## Assumptions

- The per-project daemon, its registry, and the attach-or-spawn machinery the MCP proxy uses already exist and are reused unchanged for read queries (Q1, Q2).
- The existing cross-process file lock is sufficient to arbitrate an in-process re-index job against the daemon's file watcher, and the library's sync/full-index operations expose progress suitable for driving the live stream (Q7).
- On a loopback bind, no authentication is required even if `CODEGRAPH_SERVER_TOKEN` happens to be set — the Bearer requirement is a property of non-loopback binds (design-concept reading of Q5; the precise loopback-plus-token interaction is folded into the bind/auth clarification).
- The web build directory is absent for all of SPEC-005's lifetime, so the placeholder page is the only HTML served (Q11).
- Read endpoints reflect the daemon's current index state; correcting for a stale index mid-read is a UI concern (SPEC-006), not handled here.
- The reviewable-LOC projection (~620) uses the roadmap's recorded estimator numbers; the plugin's live size-estimator operation is not installed in this environment (design concept Open Questions), which does not affect the accepted 2-slice decision.
- No TLS: operators who need network exposure put the loopback server behind their own reverse proxy.
