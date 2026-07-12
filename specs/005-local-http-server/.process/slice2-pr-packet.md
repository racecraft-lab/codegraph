# SPEC-005 Slice 2 — PR Review Packet (draft)

Local HTTP Server & REST API, **Slice 2 (re-index jobs, US3)**. Branch:
`005-local-http-server`. Factual draft for a reviewer; numbers from
`git diff 17cef94..HEAD` (committed Slice-2 impl, T033–T040) plus the working-tree
close-out (T041/T043/T044/T045).

## What changed

The **write half** of `codegraph serve --web`: an on-demand re-index that runs in
the serve process and streams live progress over SSE. Three new job endpoints,
layered on the Slice-1 router/shutdown seams:

- `POST /api/reindex/:repo` — start a re-index (incremental `sync()` default;
  `?full=true` → full `indexAll()` rebuild). **URL-only params, reads no body.**
  Returns `202` `{id,repo,mode,status:"running",startedAt}`; a second POST while a
  job is active → `409 conflict`; an unregistered repo → `404 resource:repo`.
- `GET /api/reindex/:repo` — the latest job state (terminal outcome readable until
  restart); registered-repo-with-no-job → `404 resource:repo` (deliberately
  indistinguishable from unregistered).
- `GET /api/reindex/:repo/events` — per-repo SSE stream: `snapshot` on every
  connect, live `progress` (mirroring `IndexProgress`), one terminal `done`/`error`,
  then close; `~15s` heartbeat; per-subscriber backpressure coalescing.

Supporting subsystem:

- `src/server/jobs.ts` — in-memory latest-job-per-repo registry, the job driver
  (`sync()`/`indexAll()` under the cross-process file lock with an `AbortSignal`),
  bounded lock-retry → terminal `lock_unavailable` (no queue), FR-015a result
  whitelisting (drops `changedFilePaths` / `errors[]`), and the terminal-path
  watcher re-arm.
- `src/server/sse.ts` — the `SseWriter` (streaming headers, snapshot/progress/
  terminal frames, heartbeat, backpressure coalescing) + `streamJobToResponse`.
- `src/mcp/engine.ts` + `src/mcp/session.ts` — the **additive** control op
  `MCPEngine.rearmWatcher()` and its `codegraph/rearm-watcher` daemon session case
  (only clears the one-way degrade latch; **no indexing RPC**, FR-021 held).
- `src/server/index.ts` — the ordered shutdown (step 2) now aborts the in-flight
  job via its `AbortSignal` before releasing the port (FR-026).
- `src/server/routes.ts` — a **separate** `buildJobRoutes` builder (kept apart from
  `buildReadRoutes` so the read contract-walk bijection is untouched).
- `src/server/openapi.yaml` — extended with the jobs-tagged paths + Job/
  SyncModeResult/FullModeResult schemas + the RepoId path param (T041).

The whole feature stays dormant unless `--web` is passed; new logic is confined to
the `src/server/` module; the `src/mcp/*` edits are additive and control-plane only.

## Why

Slice 1 shipped the read API; Slice 2 completes SPEC-005's US3 so a non-MCP
consumer (a dashboard, a CI script) can refresh a project's graph over HTTP and
watch progress, instead of shelling out to `codegraph sync`. Jobs run **in the
serve process** (not via a daemon indexing RPC — FR-021 bans those); the daemon is
only nudged to re-arm its file watcher after a long rebuild drives it past its
lock-retry budget (research.md D2). Plan-time decisions (FR-023/024 per-mode result
union, FR-021a watcher re-arm, FR-015a result whitelist) live in
`specs/005-local-http-server/plan.md`.

## Non-goals (Slice 2)

- **No daemon indexing RPC** — jobs run in the serve process; `codegraph/rearm-watcher`
  is a control-plane re-arm, not indexing (FR-021 invariant).
- **No job history / persistence** — latest-job-per-repo only, in memory, lost on restart.
- **No queue** — a duplicate is 409'd; lock contention retries a bounded window then
  fails `lock_unavailable` (never queued).
- **No Last-Event-ID / SSE replay** — every connect re-snapshots.
- **No cancellation endpoint** — a client disconnect never cancels the job; only
  process shutdown aborts it.
- No web UI (**SPEC-006**); no WebSocket (**SPEC-009** reserves the `upgrade` hook).

## Review order (suggested)

1. `src/server/openapi.yaml` — the jobs contract (the surface before the code); note
   the **no-503** adaptation (in-process jobs, no daemon forwarding at request time).
2. `src/server/jobs.ts` — registry → driver → lock-retry → result whitelist → re-arm
   (the heart of the slice; read top-down).
3. `src/server/sse.ts` — the `SseWriter` frame protocol + backpressure coalescing.
4. `src/server/routes.ts` — `buildJobRoutes` (POST/GET/events handlers).
5. `src/server/index.ts` — the shutdown-abort integration (step 2).
6. `src/mcp/engine.ts`, `src/mcp/session.ts` — the additive `rearmWatcher` control op.
7. Tests: `server-reindex-jobs` (the behavior suite) → `server-openapi-contract`
   (the jobs contract walk) → `helpers/server-fixture` (jobDeps seam).

## Scope budget

**Honest accounting (mirrors Slice 1, which also overran the ~400 estimate — a
size-only finding).**

Production `src/` diff, committed Slice-2 (`git diff 17cef94..HEAD -- src/`) +
working close-out (`git diff -- src/`):

| Bucket | Insertions |
|---|---|
| `src/server/jobs.ts` (registry + driver + lock-retry + whitelist + re-arm) | 512 |
| `src/server/sse.ts` (writer + stream wiring) | 195 |
| `src/server/routes.ts` (`buildJobRoutes` + 3 handlers) | 105 |
| `src/server/index.ts` (shutdown-abort wiring) | 63 (−9) |
| `src/mcp/session.ts` + `src/mcp/engine.ts` (additive `rearm-watcher` op) | 47 |
| **Production code subtotal** | **922** (−9) |
| `src/server/openapi.yaml` (shipped contract doc, T041 — not code) | 117 (−6) |
| **Total `src/`** | **1039** (−15) |

- Excluding the OpenAPI contract doc: **922** code insertions; net **~913**.
- Rough **logic LOC** (added lines that are neither blank nor comment-only): **~560**
  — `jobs.ts` in particular is ~40% JSDoc under the repo house style.

**Over the ~400 target — noted (size-only finding, as with Slice 1).** Two
mitigating facts for the reviewer: (1) the heavy-JSDoc house style roughly doubles
line count — the ~560 logic-LOC figure is the fairer read; and (2) **812 of the 922
code lines are new, self-contained `src/server/` files** (`jobs.ts`, `sse.ts`, and
the additive `buildJobRoutes` in `routes.ts`) with near-zero blast radius — the
upstream-owned edits total ~47 lines (the additive `rearm-watcher` engine/session
case), and the `index.ts` change is +63/−9 of additive shutdown wiring.

Test diff (context, not counted against the production budget):
- Committed (`__tests__/`, 17cef94..HEAD): **+754 / −2** — `server-reindex-jobs.test.ts`
  (728, **27 tests**) + `helpers/server-fixture.ts` (+28 jobDeps seam).
- Working close-out (`__tests__/`): **+243 / −33** — `server-openapi-contract.test.ts`
  grows the jobs contract walk (now **43 tests**, up from 35).

## Traceability (SC-004, FR-020–024/026 → files + verification evidence)

| Requirement | Files | Test / quickstart evidence |
|---|---|---|
| FR-020 POST URL-only start (sync default / `?full` rebuild); registry repos only | `server/routes.ts` (`reindexPostHandler`), `server/jobs.ts` (`defaultRunIndex`) | `server-reindex-jobs` POST 202/mode/404 tests; **T044 quickstart S8** (202 `mode:"full"`) |
| FR-021 jobs run in serve process; every non-lock/non-abort failure contained | `server/jobs.ts` (`ReindexJob.run`, `INDEX_FAILED_REASON`) | `server-reindex-jobs` "failure CONTAINED — terminal error, POST still 202"; real sync/full driver tests |
| FR-021a lock contention → `lock_unavailable` (bounded retry, no queue) + watcher re-arm | `server/jobs.ts` (`runWithLockRetry`, terminal re-arm), `mcp/engine.ts`, `mcp/session.ts` | `server-reindex-jobs` lock-contention + watcher-re-arm/degrade-latch tests; **T044 quickstart S10** (live `lock_unavailable` after ~2.58s; watcher-restore unit-grounded) |
| FR-022 single active job → 409 | `server/jobs.ts` (`JobRegistry.start`/`JobConflictError`), `server/routes.ts` | `server-reindex-jobs` "second POST → 409"; **T044 quickstart S9** (live 202 then 409) |
| FR-023 SSE snapshot→progress→terminal; headers; heartbeat; backpressure | `server/sse.ts`, `server/routes.ts` (`reindexEventsHandler`) | `server-reindex-jobs` SSE + `SseWriter` backpressure tests; **T044 quickstart S8** (live snapshot + 65 progress + single done; all 4 headers) |
| FR-024 latest-per-repo; registered-no-job → 404 repo; per-mode `result` union | `server/jobs.ts` (`whitelistResult`, `latest`), `server/routes.ts` (`reindexGetHandler`) | `server-reindex-jobs` GET 404 + SyncResult/IndexResult union tests; **T044 quickstart S8** (FullModeResult, no `errors[]`) |
| FR-026 ordered shutdown aborts in-flight job → terminal `error`/`aborted` | `server/index.ts` (shutdown step 2), `server/jobs.ts` (`abortAll`) | `server-reindex-jobs` shutdown-abort test; **T044 quickstart S11** (live clean-exit + terminal SSE frame; `aborted` unit-grounded) |
| FR-025 contract honesty (jobs surface) | `server/openapi.yaml`, `__tests__/server-openapi-contract.test.ts` | **T041** jobs contract walk — 43/43 green; read+jobs (path,method) bijection |
| SC-004 (jobs + SSE + 409 + lock_unavailable + watcher restore + shutdown-abort) | (all above) | **T044 quickstart S8/S9/S10/S11** |

Suite totals verified this task: `server-reindex-jobs` **27**, `server-openapi-contract`
**43** (was 35), `server-read-api` **90** (unchanged, re-verified green).

## Known gaps / accepted deviations

1. **No 503 on the jobs surface (deliberate contract adaptation).** Unlike every
   read path, the jobs POST/GET run wholly in the serve process against the
   in-memory registry — there is no daemon forwarding at request time, so no attach
   failure and no 503. The shipped `openapi.yaml` documents this and the contract
   walk enforces it (no undocumented/undeliverable status).
2. **Watcher degrade→restore not exercised live (unit-grounded).** A live
   `isDegraded()` true→false cycle needs a rebuild long enough to drive the daemon's
   own ~60s lock-retry budget past its limit — impractical in the harness. The latch
   clear (`unwatch()`+`watch()`), the `rearmWatcher` gate, the session dispatch, and
   the job's terminal-path re-arm duty are covered deterministically in
   `server-reindex-jobs.test.ts` (see T044 S10). Recorded honestly, not fabricated.
3. **Live `reason:"aborted"` not caught under a sub-second index (unit-grounded).**
   On the test hardware a full rebuild of 2062 files completes in 452ms — faster than
   a reliable SIGTERM window — so the live shutdown-abort observed `lock_unavailable`
   (a lock-retry job reaching its natural terminal) while confirming clean exit +
   terminal SSE frame. The specific abort→`aborted` path is deterministically covered
   by the `shutdown-abort` unit test (controllable mid-index seam). See T044 S11.
4. **In-memory job state, lost on restart** — no history/persistence by design
   (non-goal); the latest terminal outcome is readable only until the serve process
   restarts.

## Rollback

The jobs surface is reached only through `codegraph serve --web`; without `--web`
nothing binds and `serve` / `serve --mcp` behave byte-identically (Slice-1 dormancy,
re-verified). The `codegraph/rearm-watcher` daemon op is additive and control-plane
only — inert unless a job's terminal path fires it, which only happens under
`serve --web`. Rolling back = revert the branch: the jobs endpoints disappear, the
additive daemon op is unreachable, and no schema/data migration, persisted state, or
new dependency needs unwinding (`node:http`/`node:crypto` only).

## Deferred follow-ups

- **SPEC-006** — the web UI (SPA built into `dist/web/`), which the Slice-1 static
  mount composes in automatically (placeholder → app shell). A dashboard consuming
  these jobs endpoints is its first client.
- **SPEC-009** — LSP over WebSocket: the reserved `upgrade` attach point (Slice 1,
  currently wired to nothing) is where it lands; the SSE endpoint here is the
  streaming precedent.

---

## T042 — SPEC-005 retrieval do-not-regress review (retrieval-guardian, 2026-07-11)

Scope: `git diff main...HEAD` over `src/mcp/`, `src/utils.ts`, `src/embeddings/config.ts`, `src/index.ts`. Read-only advisory.

**OVERALL: PASS** — additive, off the tool surface, no retrieval regression. Zero blocking findings.

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | MCP tool output unchanged (tools/list, tools/call, explore/node shaping) | **PASS** | `src/mcp/tools.ts` empty branch diff (`git diff main...HEAD --stat` returns nothing). No tool schema/output touched. |
| 2 | Explore budgets untouched + monotonic | **PASS** | tools.ts untouched; per-file tiers non-decreasing `3800→3800→6500→7000→7000` (tools.ts:236,252,270,289,303); no `maxOutputChars`>25K (≤24000; hardCeiling `min(…,25000)` :3730). |
| 3 | Error shaping unchanged (isError reserved; NotIndexedError success-shaped) | **PASS** | No `isError` introduced. New methods OFF the tool surface — `sendError(InvalidParams/InternalError)` (session.ts:317,335) are JSON-RPC errors on `codegraph/read`, never `isError` on a tools/call result. Missing-index read returns success-shaped empties (read-ops.ts:70-90). |
| 4 | server-instructions.ts untouched | **PASS** | Empty branch diff. |
| 5 | No edge-synthesis / resolution changes | **PASS** | Diff touches only the 4 scoped files; no `src/resolution/`. `getNeighborhood` (index.ts:2670) delegates to existing `traverser.traverseBFS` — no new edges. |
| 6 | codegraph/read + codegraph/rearm-watcher unreachable from tool surface; -32601 preserved | **PASS** | Namespaced JSON-RPC cases (session.ts:159,165) dispatch only to `executeRead`/`rearmWatcher`; `handleToolsCall` (:275) routes solely to ToolHandler. `read-ops` imported by nothing in tools.ts/server-instructions.ts. New cases precede `default`, which still returns `MethodNotFound` for all other methods (session.ts:188-195). |
| 7 | No hot-path additions (imports, init) | **PASS** | `engine.ts` imports from `read-ops.ts`, whose imports are type-only (read-ops.ts:18-19) — erased at compile, zero runtime chain. `executeRead`/`rearmWatcher` run only when their own method fires. `isLoopbackHost` is a byte-identical body move to utils.ts — no behavior change. |

**BLOCKING:** none.

**ADVISORY:** (a) Check 8 Sonnet-floor A/B is **N/A** — no retrieval-affecting surface changed, gate not triggered. (b) Out of scope: `src/server/auth.ts:44` also consumes `isLoopbackHost` — new slice-1 file, not a retrieval surface. (c) Minor non-retrieval: `searchOp` caps `total` at `SEARCH_SCAN_CEILING=500` (read-ops.ts:38) — intended per FR-006; flagged so the REST-contract reviewer confirms the paging contract expects a capped total.
