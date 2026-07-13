# SPEC-005 Slice 1 — PR Review Packet (draft)

Local HTTP Server & REST API, **Slice 1 (read API)**. Branch: `005-local-http-server`.
Factual draft for a reviewer; numbers from `git diff main` on this branch.

## What changed

A new, **opt-in** local HTTP server — `codegraph serve --web` — that exposes a
read-only REST API over the same per-project daemon index the MCP sessions
already share. Eight read endpoints:

- `GET /api/status` — server + index health (the version channel).
- `GET /api/repos` — the machine's registered projects (startup repo `default:true`).
- `GET /api/search?q=…&mode=…&limit=&offset=&repo=` — paged symbol search.
- `GET /api/node/:id` — a node's own fields (opaque, percent-encoded id).
- `GET /api/callers/:id`, `GET /api/callees/:id` — paged relationships.
- `GET /api/impact/:id`, `GET /api/graph/:id` — node+edge subgraphs.

Plus the supporting surface: a closed six-code error envelope; fail-closed bind
security (loopback default, Host-header allowlist, Bearer on network binds); a
static mount that serves a data-free placeholder (real UI is SPEC-006); and an
**additive** daemon read RPC (`codegraph/read`) so the web process forwards
structured reads over the existing daemon socket without opening a second
in-process index.

Reads are served by a daemon **client** (the serve process attaches to, or lazily
spawns, the per-project daemon). Non-default repos attach lazily on first `?repo`
access. The whole feature is dormant unless `--web` is passed.

New code is confined to a new `src/server/` module (fork discipline); upstream-owned
files get minimal, additive edits.

## Why

SPEC-005 gives non-MCP consumers (scripts, dashboards, other tools) HTTP access to
the code graph while reusing the existing warm daemon index — no second index, no
new runtime dependency (`node:http`/`node:crypto`/`node:net` only). Slice 1 is the
read half (US1 read, US2 multi-repo, US4 network security); Slice 2 (re-index jobs,
US3) is separate. The plan-time decisions (FR-012 shared loopback util, FR-023/024
result union, FR-021a watcher re-arm) live in `specs/005-local-http-server/plan.md`.

## Non-goals (Slice 1)

- No write/mutation endpoints — the `/api/reindex` jobs surface is **Slice 2**.
- No web UI — the static mount serves only the placeholder until **SPEC-006**.
- No WebSocket/SSE — the `upgrade` attach point is reserved for **SPEC-009**, wired to nothing.
- No CORS / cross-origin — same-origin only (FR-019).
- No auth on a loopback bind — deliberate (SC-002); Bearer applies only to network binds.
- No new runtime dependency; no second in-process index copy (FR-002).

## Review order (suggested)

1. `src/server/openapi.yaml` — the contract; read the surface before the code.
2. `src/server/errors.ts` — the closed six-code error envelope (foundational).
3. `src/server/auth.ts` — bind security, Host allowlist, constant-time Bearer.
4. `src/server/routes.ts` — router (single decode chokepoint) + the read handlers.
5. `src/server/daemon-client.ts` — attach-or-spawn + typed read wrappers + `listRepos`.
6. `src/mcp/read-ops.ts`, `src/mcp/session.ts`, `src/mcp/engine.ts` — the additive `codegraph/read` RPC.
7. `src/index.ts` — `getNeighborhood` delegate (the only new library method).
8. `src/server/static.ts` — static mount + strict fallback + traversal guard.
9. `src/server/index.ts` — the bootstrap that wires it together + lifecycle/shutdown.
10. `src/bin/codegraph.ts` — the thin `serve --web` option + branch.
11. `src/utils.ts` (+ `src/embeddings/config.ts`) — shared `isLoopbackHost` extraction.
12. Tests: `server-openapi-contract` → `server-read-api` → `server-auth-binding` → `server-static-fallback` → `helpers/server-fixture`.

## Scope budget

Production diff, `git diff main --stat -- src/`: **2356 insertions / 9 deletions / 14 files.**

| Bucket | Insertions |
|---|---|
| New `src/server/*.ts` (auth, daemon-client, errors, index, routes, static) | 1791 |
| `src/server/openapi.yaml` (shipped contract, not code) | 276 |
| Additive daemon read RPC (`src/mcp/read-ops.ts` 189, `session.ts` 38, `engine.ts` 19) | 246 |
| `src/index.ts` `getNeighborhood` | 15 |
| CLI + shared util (`bin/codegraph.ts` 18, `utils.ts` 8, `embeddings/config.ts` 2/−8) | 28 |
| **Total** | **2356** |

- Excluding the OpenAPI contract doc: **2080** code insertions.
- Rough **logic LOC** (added lines that are neither blank nor comment-only): **~1280**.

**Over the ~400 target — noted.** Slice 1 stands up a whole HTTP read surface
(8 endpoints + error envelope + bind-security/auth + static mount + an additive
daemon read RPC) across three user stories, so ~400 was never realistic for the
production slice. Two mitigating facts for the reviewer: (1) the repo's heavy
JSDoc house style roughly doubles line count — e.g. `errors.ts` is 159 lines of
which ~half is doc-comment; the ~1280 logic-LOC figure is the fairer read; and
(2) 1791 of the 2356 lines are a **new, self-contained module** (`src/server/`)
with near-zero blast radius on upstream files — the upstream-owned edits total
~50 lines (CLI option+branch, one library delegate, the additive RPC case, the
shared-util move). Reviewable in the order above; the new module reads top-down.

Test diff (context, not counted against the production budget):
`git diff main --numstat -- __tests__/` = **2742 insertions / 69 deletions**
across `server-read-api` (1346), `server-openapi-contract` (513),
`server-static-fallback` (365), `server-auth-binding` (336), and
`helpers/server-fixture` (182).

## Traceability (major FR/SC → files + test evidence)

| Requirement | Files | Test evidence |
|---|---|---|
| FR-001 dormancy / `serve --web` mode | `bin/codegraph.ts`, `server/index.ts` (`runWebServerCli`) | `server-read-api` T007; quickstart S6 |
| FR-002/008 daemon client, shared warm index | `server/daemon-client.ts`, `mcp/read-ops.ts`,`session.ts`,`engine.ts` | `server-read-api` T005/T011; quickstart S1 |
| FR-004/004a reads + `%2F` id round-trip | `server/routes.ts`, `server/daemon-client.ts` | `server-read-api` T011; `server-openapi-contract` FR-004a |
| FR-005/016 status + version | `server/routes.ts` (`statusHandler`) | `server-read-api` T011/T014; quickstart S1 |
| FR-006/006a search paging + degradation | `server/routes.ts`, `server/daemon-client.ts` (`readSearch`) | `server-read-api` T011 |
| FR-007 subgraph node cap + `truncated` | `server/routes.ts`, `mcp/read-ops.ts`, `index.ts` | `server-read-api` T011 |
| FR-009/010/010a/011 multi-repo `/api/repos` + `?repo` | `server/daemon-client.ts` (`listRepos`), `server/index.ts` (`resolveRepo`) | `server-read-api` T026; quickstart S2 |
| FR-012/013/014 bind security, Host allowlist, Bearer | `server/auth.ts`, `utils.ts` (`isLoopbackHost`) | `server-auth-binding`; quickstart S3 |
| FR-015/015a closed error envelope (no leaks) | `server/errors.ts`, `server/routes.ts` | `server-read-api` T003; `server-openapi-contract` walk |
| FR-017/017a/017b/018/019 static, placeholder, traversal, fallback, no-CORS | `server/static.ts` | `server-static-fallback`; quickstart S4 |
| FR-025 contract honesty | `server/openapi.yaml`, copy-assets | `server-openapi-contract` (T009 ship + T029 walk); quickstart S5 |
| FR-026 lifecycle (bind/EADDRINUSE/shutdown) | `server/index.ts` | `server-read-api` T006/T007; quickstart S7 |
| SC-001/002/003/005/006 | (as above) | quickstart S1/S3/S5/S6 |

Suite totals (per orchestrator COMPLETED_TASKS + verified here): `server-read-api`
90, `server-auth-binding` 55, `server-static-fallback` 25, `server-openapi-contract`
**35** (verified this task) ≈ **205** Slice-1 tests.

## Known gaps / accepted deviations

1. **Reads run on the daemon MAIN thread (accepted deviation).** The `codegraph/read`
   op dispatches against the warm index on the daemon's main thread, not the
   query-pool workers. Rationale: graph reads are sub-millisecond point queries, and
   the query-pool workers only speak `executeReadTool → ToolResult` text — extending
   them to structured reads would be a non-additive change to upstream-owned worker
   code. Keeping reads main-thread keeps the daemon diff minimal and additive
   (FR-002 held: no second in-process index). Revisit only if a read is shown to
   block the daemon event loop.
2. **No PPID/liveness watchdog on the `serve --web` process (deferred).** The web
   process is a foreground daemon *client*, reaped by its terminal via SIGINT/SIGTERM
   (FR-026), not by the daemon's `#277` PPID-watchdog / orphan-reaping machinery.
   Daemons it lazily spawns are reaped by their own idle-timeout/watchdog, and the
   web process never kills a shared daemon (FR-026). No orphan-reaping watchdog was
   added for Slice 1; if `serve --web` is ever daemonized, this needs revisiting.
3. **Static mount serves only the placeholder** — real assets land with SPEC-006
   (the `dist/web/` present-path is already implemented and test-covered via an
   injected synthetic web root).

## Rollback

The feature is gated behind `--web`. Without it, nothing binds and `codegraph serve`
/ `serve --mcp` behave byte-identically to the prior release (verified: quickstart
S6, `server-read-api` T007). Almost all code is the new `src/server/` module; the
additive `codegraph/read` daemon RPC is only reached by the web client, so it is
inert without `serve --web`. Rolling back = revert the branch: the `--web` surface
disappears and dormancy guarantees no behavior change elsewhere. No schema/data
migration, no persisted state, no new dependency to unwind.

## Deferred follow-ups

- **Slice 2 (US3)** — `POST /api/reindex/:repo` jobs: 202 + SSE progress + terminal
  outcome, single-active-job 409, lock-contention `lock_unavailable`, and the
  FR-021a daemon watcher re-arm (`src/server/openapi.yaml` already documents the
  jobs surface as omitted-until-Slice-2).
- **SPEC-006** — the web UI: the SPA built into `dist/web/`, which the static mount
  composes in automatically (placeholder → app shell).
- **SPEC-009** — LSP over WebSocket: the reserved `upgrade` attach point (currently
  destroys the socket) is where it wires in.
