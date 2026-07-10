---
topic: "Local HTTP server & REST API"
slug: "spec-005-design-concept"
date: "2026-07-10"
mode: "setup"
spec_id: "SPEC-005"
source_input:
  type: "topic"
  ref: "SPEC-005 scope from docs/ai/specs/intelligence-platform-technical-roadmap.md"
question_count: 13
stop_reason: "natural"
---

# Design Concept: Local HTTP Server & REST API

> **Source:** SPEC-005 scope, intelligence-platform-technical-roadmap.md (+ SPEC-004 handoff in docs/design/web-framework-decision.md)
> **Date:** 2026-07-10
> **Questions asked:** 13
> **Stop reason:** natural (all branches walked, no critical opens remain)

## Goals

- `codegraph serve --web` exposes the full graph read surface plus re-index jobs over a documented local REST API, riding the existing daemon/query-pool.
- The serve process is a **daemon client, like MCP sessions** — it attaches to (or spawns) the per-project daemon and forwards queries over its socket, sharing one warm index (Q1).
- **Multi-repo via the daemon registry**: `/api/repos` lists indexed projects from the existing registry; the startup repo is the default; other repos are addressed by explicit repo id with a daemon attached lazily on demand (Q2).
- **Zero new runtime dependencies**: hand-rolled method+path router, SSE, and static mount on `node:http` (Q4, research-backed; sirv is the researched escape hatch if SPEC-006's static needs outgrow it).
- Fail-closed auth: loopback needs no auth; non-loopback binds refuse to start without `CODEGRAPH_SERVER_TOKEN`, then require `Authorization: Bearer` on `/api/*` (Q5).
- Reindex jobs run **in the serve process** via the library's `sync()` (default) / `indexAll()` (`?full=true`), progress streamed over SSE, one active job per repo with 409 on duplicates (Q6, Q7, Q8).
- Committed `src/server/openapi.yaml` kept honest by a contract test that walks every documented path/method/status against a running fixture server (Q10).
- **Split into 2 vertical slices on this one branch** (Q13, accepted): Slice 1 = read API end-to-end (`serve --web`, router, auth, all GET endpoints, openapi.yaml, contract tests); Slice 2 = job subsystem (POST reindex, SSE, 409) layered on top. Two sequenced, review-markered PRs, each under the ~400 reviewable-LOC ceiling.

## Non-goals

- The web UI itself — SPEC-006 (roadmap scope; reaffirmed throughout).
- LSP-over-WebSocket handler — SPEC-009; SPEC-005 only reserves the upgrade hook (roadmap scope).
- TLS — reverse-proxy territory (roadmap scope).
- No new daemon RPC for indexing — the daemon keeps its no-indexing invariant; jobs run in the serve process (Q7).
- No job history/persistence — only the latest job per repo, in memory; lost on restart (Q8).
- No `/api/v1` URL versioning — client and server ship in the same npm package and cannot skew; version reported in `/api/status` (Q9).
- No CORS surface — same-origin only; cross-origin requests denied by default (Q11).
- No cursor-based pagination — offset/limit with hard caps suffices for a warm local index (Q12).
- No router/framework dependency — not even polka/sirv for now (Q4).
- No eager daemon attach for all registered repos — lazy attach only (Q2).

## Design Tree (Q&A log)

### Q1. How should the HTTP server share the index with other sessions?

**Branch:** Process model

**Recommended answer:** Daemon client, like MCP
> The roadmap says the API rides "the existing daemon/query-pool"; the MCP proxy already implements attach-or-spawn against the per-project daemon socket, so REST→daemon RPC translation reuses a proven path and shares one warm index across MCP sessions and the web UI.

**Alternatives offered:**
- In-process CodeGraph instance: simpler wiring, but duplicates the warm index in memory and diverges from the roadmap's stated intent.
- HTTP listener inside the daemon: zero duplication, but couples web serving into the daemon lifecycle (idle-timeout, orphan reaping, restarts kill the UI).

**User's answer:** Daemon client, like MCP (Recommended)

---

### Q2. What does one running server instance serve — just the project it was started in, or any indexed repo on the machine?

**Branch:** Repo scope

**Recommended answer:** Multi-repo via registry, lazy attach
> The roadmap's endpoint list (`GET /api/repos`, `POST /api/reindex/:repo`) implies plural repos, and the daemon registry already tracks every project daemon. Startup repo is the default; other repos get a daemon attached on demand — the same lazy-attach the MCP proxy does. Gives SPEC-006 a project switcher for free.

**Alternatives offered:**
- Single repo per server: simplest surface (Principle II) but boxes SPEC-006 into one-project browsing and makes `/api/repos` nearly vestigial.
- Multi-repo eager attach: warm everything, but spawns N daemons the user may never browse.

**User's answer:** Multi-repo via registry (Recommended)

---

### Q3. What command starts the HTTP server?

**Branch:** CLI surface

**Recommended answer:** `codegraph serve --web`
> Matches the SPEC-004 handoff ("expected to be a SPEC-005 command such as `codegraph serve --web` unless SPEC-005 chooses another path") and keeps one `serve` umbrella: `--mcp` (hidden, agents) vs `--web` (documented, humans). Explicit opt-in preserves the constitution's dormancy discipline — no web server starts by default.

**Alternatives offered:**
- Bare `codegraph serve` = web: nicer to type, but silently re-purposes a command string agents already invoke.
- New `codegraph web` subcommand: clearest help text, but diverges from the SPEC-004 handoff and splits two server modes that share all their plumbing.

**User's answer:** codegraph serve --web (Recommended)

---

### Q4. Does src/server/ take a router dependency or stay zero-dependency on node:http?

**Branch:** Router / dependency policy

**Recommended answer (first pass):** Zero-dep node:http router
> Roadmap says "framework-light: Node http/router"; the repo hand-rolls small infrastructure (toml.ts precedent) to avoid new deps.

**Alternatives offered:** Micro-framework (hono); Express.

**User's answer (first pass):** Other — "use /deep-research to see what gitnexus uses and the rest of the community for similar features".

**Research run (deep-research workflow, 2026-07-10, adversarially verified):**
- GitNexus (`abhigyanpatwari/GitNexus`) uses Express 5 + cors for `gitnexus serve` — but it is a thin bridge in an already dependency-heavy project, not a considered norm (verified at HEAD in its `src/server/api.ts` / ARCHITECTURE.md).
- Storybook 9 deliberately migrated OFF Express to polka + sirv + @polka/compression to cut transitive-dependency bloat (issue #29083 / PR #29230; ~2MB saved; Express ships 57–67 transitive packages vs polka's ~5).
- Vite dev/preview is built on connect + sirv, not Express.
- SSE was empirically verified trivial on bare `node:http`; sirv provides SPA fallback/ETag/precompiled gzip/brotli directly on native http servers.
- Community norm for a dependency-averse npm CLI serving a loopback UI + small REST API: bare `node:http` (optionally + sirv for static) or polka; Express is legacy weight flagship tools actively removed.

**Recommended answer (re-ask, research-backed):** Zero-dep node:http
> Hand-rolled matcher for ~7 routes, hand-rolled SSE, minimal static mount. Matches the community direction, the toml.ts precedent, and Principle II. sirv (67KB, native-http compatible) is the researched escape hatch, deferred until SPEC-006 proves the need.

**Alternatives offered (re-ask):** node:http + sirv now; polka + sirv (Storybook's stack).

**User's answer:** Zero-dep node:http (Recommended)

---

### Q5. How strict is auth for non-loopback binds?

**Branch:** Auth model (roadmap OQ-6)

**Recommended answer:** Refuse non-loopback without token
> Loopback binds need no auth. `--host` beyond 127.0.0.1 hard-fails at startup unless `CODEGRAPH_SERVER_TOKEN` is set; the token is then required as `Authorization: Bearer` on `/api/*`. Fail-closed matches the local-first posture; the alternative failure mode is an unauthenticated code index on the LAN.

**Alternatives offered:**
- Warn but allow unauthenticated: respects user intent on trusted networks but ships a foot-gun default.
- Always require token, even loopback: punishes the 99% localhost case for no real threat gain on 127.0.0.1.

**User's answer:** Refuse non-loopback w/o token (Recommended)

---

### Q6. What does `POST /api/reindex/:repo` actually run — incremental sync or full re-index?

**Branch:** Job semantics

**Recommended answer:** Sync default, `?full=true` opt-in
> `sync()` (filesystem reconcile, seconds) is what a UI refresh button wants and matches what the daemon's file-watcher already does; `?full=true` escalates to `indexAll()` for rebuild cases. One endpoint, two documented modes, shared job/SSE plumbing.

**Alternatives offered:**
- Always full indexAll: unambiguous but minutes of parsing (holding the index lock) as the default is wrong when the watcher keeps things fresh.
- Always sync only: smallest surface, but the UI has no recovery path for a corrupt/partial index without leaving the browser.

**User's answer:** Sync default, ?full=true opt-in (Recommended)

---

### Q7. Which process executes the reindex job?

**Branch:** Job locus

**Recommended answer:** In the serve process
> The job calls the library's `sync()`/`indexAll()` directly — exactly what CLI `codegraph sync` does alongside a running daemon today. The existing cross-process file lock arbitrates against the daemon's watcher, and `IndexProgress` callbacks feed SSE with zero new daemon protocol. Keeps the daemon's deliberate no-indexing invariant intact.

**Alternatives offered:**
- New reindex RPC in the daemon: architecturally purer single-writer, but adds an index RPC + progress-streaming protocol to a daemon that deliberately never indexes.

**User's answer:** In the serve process (Recommended)

---

### Q8. How long do jobs live, and what does the SSE stream promise?

**Branch:** Job lifecycle / SSE contract

**Recommended answer:** In-memory, last job per repo
> One active job per repo (409 on duplicate); the finished job's terminal state is kept in memory (latest per repo) so the UI can read the outcome after the fact. SSE: subscriber gets a snapshot event immediately, then live progress; stream ends after a terminal done/error event; no Last-Event-ID replay — reconnecting mid-job re-snapshots. No persistence across restarts.

**Alternatives offered:**
- In-memory ring-buffer job history: more UI affordance, but SPEC-006 hasn't asked for history — speculative surface (Principle II).
- Fire-and-forget, no retention: minimal, but a UI that polls after a refresh can't tell whether the job succeeded.

**User's answer:** In-memory, last job per repo (Recommended)

---

### Q9. Do the endpoints carry a version prefix (/api/v1/...)?

**Branch:** API versioning / error envelope

**Recommended answer:** No prefix; version in `/api/status`
> The UI (SPEC-006) ships embedded in the same npm package as the server, so client and server can never skew — URL versioning is speculative (Principle II). SPEC-009's LSP-over-WebSocket rides the upgrade hook, not the path. Error envelope is one shape everywhere: `{error: {code, message, details?}}`.

**Alternatives offered:**
- `/api/v1` from day one: cheap insurance for third-party scripting, but the only sanctioned client ships in-package.

**User's answer:** No prefix, version in /api/status (Recommended)

---

### Q10. How is the committed openapi.yaml kept honest?

**Branch:** API contract

**Recommended answer:** Hand-written + contract test
> Author `src/server/openapi.yaml` by hand (7 endpoints — small) and add an integration test that walks every path/method/status in the yaml against the running fixture server, failing on undocumented routes or mismatched response shapes. Zero new deps; drift caught in CI.

**Alternatives offered:**
- Hand-written, no enforcement: silently rots at the first endpoint change; SPEC-006 inherits the drift.
- Generated from code annotations: can't drift by construction but adds a dependency + build step, against the zero-dep decision (Q4).

**User's answer:** Hand-written + contract test (Recommended)

---

### Q11. What does the static mount serve before SPEC-006's assets exist, and what are the fallback rules?

**Branch:** Static mount / route fallback

**Recommended answer:** Placeholder page + strict fallback
> Mount serves `dist/web/` when present; absent (all of SPEC-005's life), `/` returns a minimal built-in status page pointing at `/api/status`. Fallback per the binding SPEC-004 handoff: `/api/*` 404s as the JSON envelope, asset-extension requests (.js/.css/…) 404 rather than falling back, only extensionless browser routes fall back to the shell. Same-origin only — no CORS headers.

**Alternatives offered:**
- 404 everything until SPEC-006: purest scope cut, but `serve --web` greets a human with raw JSON and the mount wiring still has to be designed later.
- Redirect `/` to `/api/status`: cheap signal, dead weight the moment SPEC-006 lands.

**User's answer:** Placeholder page + strict fallback (Recommended)

---

### Q12. What paging/cap discipline do the read endpoints get?

**Branch:** Pagination / response caps

**Recommended answer:** Offset paging + hard caps
> List endpoints (search, callers/callees pages): `?limit&offset`, default 100, server max 500, response carries total. `/api/graph`: default depth 1, max depth 3, node cap 2000 with a `truncated` flag so the canvas (SPEC-004 proved a 1k-node/60fps target) knows to prompt for narrowing. Offset paging is fine on a warm local index — no cursors (Principle II).

**Alternatives offered:**
- Cursor-based paging: correcter under concurrent reindex, but that edge is rare on a local UI and complicates every consumer.
- No paging, caps only: simplest, but a >cap callers list becomes unreachable data.

**User's answer:** Offset paging + hard caps (Recommended)

---

### Q13. Split SPEC-005?

**Branch:** Slice-sizing

**Size signals:** 620 projected reviewable LOC (greenfield warn line 600); ~7 production files (warn threshold 6); ~14 total files; net-new module; primary surface API. Reviewability gate (setup mode): **warn, no blockers**. The plugin's `estimate-spec-size` operation is not shipped in this installed version — the roadmap's recorded estimator output (suggested_slices = 2) was used instead.

**Recommended answer:** 2 vertical slices, one branch
> Slice 1: read API end-to-end (`serve --web`, router, auth, all GET endpoints, openapi.yaml, contract tests) — independently shippable, unblocks SPEC-006. Slice 2: job subsystem (POST reindex, SSE, 409) layered on top. Both stay on this 005 branch as two sequenced, review-markered PRs — each under the ~400-LOC ceiling, no worktree churn. Each slice cuts end-to-end through CLI → server → daemon/library → tests (vertical, INVEST-compliant).

**Alternatives offered:**
- Keep as one spec/PR (accept warn): roadmap pre-recorded "warning accepted"; one-navigable-PR route like SPEC-004. Heavier single review.
- Split into child specs (O5-style): far more process weight than a 620-LOC net-new module warrants.

**User's answer:** 2 vertical slices, one branch (Recommended)

## Open Questions

- **What:** `estimate-spec-size` runner operation is absent from the installed speckit-pro 2.18.1 plugin (script and helper not shipped), so the slice-sizing branch used the roadmap's recorded estimator numbers instead.
  **Why deferred:** tooling gap, not a design ambiguity — the roadmap numbers plus the reviewability gate's live `warn` verdict were sufficient to decide (Q13).
  **Suggested next step:** none required for SPEC-005; report upstream to speckit-pro if the operation is expected to be installable.

## Recommended Next Step

Setup mode — scaffolding has already created the worktree and branch. Next: `/speckit-pro:speckit-autopilot docs/ai/specs/.process/SPEC-005-workflow.md` after reviewing this doc and the workflow file.
