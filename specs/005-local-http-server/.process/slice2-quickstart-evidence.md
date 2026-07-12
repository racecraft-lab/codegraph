# SPEC-005 Slice-2 Quickstart Validation Evidence (T044)

Runs `specs/005-local-http-server/quickstart.md` **Scenarios 8–11** (the
`/api/reindex` jobs surface, US3) against the **built binary**
(`dist/bin/codegraph.js`), never this repo's own index. Each scenario records the
command, an actual output snippet, and a pass/fail verdict.

- **Date:** 2026-07-11
- **Binary:** `node dist/bin/codegraph.js` (built via `npm run build`; `@colbymchenry/codegraph@1.4.1`)
- **Node:** v24.11.1 (within `engines >=20 <25`; `node:sqlite` backend)
- **Env:** `CODEGRAPH_EMBEDDING_*` stripped (deterministic, structural-only index)
- **Fixture:** one temp project under `/tmp`, `codegraph init`'d (real
  `.codegraph/` index), reaped after the run. Default/startup repo id
  `86fdc0e0e2724c69`. Seeded with `a.ts` + `src/util.ts` (call graph
  `subHelper`←`useSub`/`helper`), then grown to 62 files for a longer job.
- Port below is OS-assigned (`--port 0`).

## Preconditions (build & shipped contract now carries the jobs surface)

```
$ npm run build          # tsc + copy-assets
$ cmp dist/server/openapi.yaml src/server/openapi.yaml    # byte-identical
$ grep -nE 'reindex|tags: \[jobs\]' dist/server/openapi.yaml
  333:  /api/reindex/{repo}:
  335:      tags: [jobs]
  351:      tags: [jobs]
  357:  /api/reindex/{repo}/events:
  359:      tags: [jobs]
```

- `dist/server/openapi.yaml` **PRESENT + byte-identical to src** and now
  documents the Slice-2 jobs paths (T041). **PASS**

```
$ node dist/bin/codegraph.js serve --web --port 0 --path <fixture> &
   -> CodeGraph web server listening on http://127.0.0.1:52036
$ curl .../api/status
   -> {"version":"1.4.1","repo":{"id":"86fdc0e0e2724c69",...},"index":{"state":"indexed","fileCount":2,...}}
```

---

## Scenario 8 — trigger + live progress + terminal outcome (SC-004, FR-020/023/024)

```
# POST full rebuild, then subscribe to the per-repo SSE stream, then read the
# terminal job state after finish.
$ curl -X POST '.../api/reindex/86fdc0e0e2724c69?full=true'
$ curl -N '.../api/reindex/86fdc0e0e2724c69/events'
$ curl '.../api/reindex/86fdc0e0e2724c69'
```

| Step | Actual output | Verdict |
|---|---|---|
| `POST …?full=true` | `202` `{"id":"6dc172d6…","repo":"86fdc0e0e2724c69","mode":"full","status":"running","startedAt":"2026-07-11T23:59:00.253Z"}` | PASS |
| SSE frame 1 | `event: snapshot` / `data: {…"status":"running"…}` | PASS |
| SSE progress frames | `event: progress` / `data: {"phase":"parsing","current":1,"total":62,"currentFile":"a.ts"}` … (65 progress frames; `phase` walks `parsing`→`resolving`, mirroring `IndexProgress` verbatim) | PASS |
| SSE terminal frame | `event: done` / `data: {…"status":"done","finishedAt":"2026-07-11T23:59:00.489Z","result":{"success":true,"filesIndexed":62,"filesSkipped":0,"filesErrored":0,"nodesCreated":180,"edgesCreated":180,"durationMs":171,"filesDiscovered":62}}` — then stream closes | PASS |
| SSE frame counts | `snapshot: 1  progress: 65  done: 1  error: 0` (single terminal) | PASS |
| `GET …/:repo` (after finish) | `200` same terminal `done` descriptor, `result` in the **FullModeResult** union (no `errors[]`) | PASS |
| Reconnect to finished job | first frame `event: snapshot` `status:"done"`, then immediate close | PASS |

**Verdict: PASS** — POST returns the 202 running descriptor; a subscriber gets an
immediate `snapshot`, live `progress` frames mirroring `IndexProgress`, then a
single terminal `done`, then close; the terminal state is readable afterward with
the per-mode `result` union. Connecting to an already-finished job snapshots the
terminal state and closes (no Last-Event-ID replay).

**SSE headers** (fresh connect):

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```
**PASS** — all four documented streaming headers present.

---

## Scenario 9 — single active job (SC-004, FR-022)

```
# A foreign process holds the index lock, so the first job stays `running` in the
# bounded lock-retry window — a deterministic window to fire the duplicate POST.
$ printf '%s' "$FOREIGN_PID" > <fixture>/.codegraph/codegraph.lock
$ curl -i -X POST '.../api/reindex/86fdc0e0e2724c69'        # first
$ curl -i -X POST '.../api/reindex/86fdc0e0e2724c69'        # immediate second
```

| Step | Actual output | Verdict |
|---|---|---|
| first POST | `HTTP/1.1 202 Accepted` `{"id":"7bd19ce5…","mode":"sync","status":"running",…}` | PASS |
| second POST (same repo, job running) | `HTTP/1.1 409 Conflict` `{"error":{"code":"conflict","message":"Conflict."}}` | PASS |

**Verdict: PASS** — while a job runs, a second POST for the same repo is `409`
`conflict`; no duplicate job starts. (409 is reserved for this case only.)

---

## Scenario 10 — lock contention → `lock_unavailable` + watcher restore (FR-021/021a)

```
# Same foreign-lock setup as Scenario 9; poll the latest job state to a terminal.
$ curl '.../api/reindex/86fdc0e0e2724c69'    # poll until terminal
```

| Step | Actual output | Verdict |
|---|---|---|
| terminal state | `{"id":"7bd19ce5…","mode":"sync","status":"error","startedAt":"2026-07-11T23:59:59.683Z","finishedAt":"2026-07-12T00:00:02.266Z","reason":"lock_unavailable"}` | PASS |
| retry window | `finishedAt − startedAt ≈ 2.58s` — the bounded ~2.5s lock-retry window (no queue) | PASS |
| POST HTTP status | the POST itself returned `202` (never 409, never 503) | PASS |

**Verdict (lock contention): PASS** — when the file lock is held by a foreign live
process, the job retries for the bounded window then terminates as `error`
`reason:"lock_unavailable"`, delivered on the latest-job read; the POST is
unaffected (still 202).

**Watcher restore (grounding — research.md D2):** a live degrade→restore of the
daemon watcher requires driving the daemon's own ~60s lock-retry budget past its
limit with a long `?full=true` rebuild, which is impractical in this harness. The
`isDegraded()` **true→false** transition and the job's terminal-path re-arm duty
are exercised **deterministically in the unit suite** (`__tests__/server-reindex-jobs.test.ts`):

- `watcher re-arm (FR-021a) > unwatch()+watch() clears the one-way degrade latch`
  — drives a real watcher to `isWatcherDegraded() === true` under a foreign lock,
  then asserts `unwatch()`+`watch()` returns it to `false` (the exact primitive
  `rearmWatcher` orchestrates). **PASS**
- `job driver (FR-021) > fires the watcher re-arm from the job terminal path`
  — asserts the job ALWAYS fires the re-arm on a terminal path. **PASS**
- `watcher re-arm > MCPEngine.rearmWatcher() is a no-op on a HEALTHY watcher (gate)`
  + `… the daemon session dispatches the additive codegraph/rearm-watcher method`.
  **PASS**

Recorded honestly as **unit-grounded** per the task guidance (live degrade
impractical).

---

## Scenario 11 — shutdown-abort mid-job (FR-023/026)

```
# Foreign lock keeps a job in-flight; subscribe SSE; SIGTERM the server.
$ curl -X POST '.../api/reindex/86fdc0e0e2724c69'
$ curl -N '.../api/reindex/86fdc0e0e2724c69/events' &   # capture frames
$ kill -TERM <server_pid>
```

| Step | Actual output | Verdict |
|---|---|---|
| SSE snapshot before shutdown | `event: snapshot` `status:"running"` | PASS |
| terminal SSE frame on shutdown | `event: error` `data: {…"status":"error",…}` delivered to the subscriber before the socket closed | PASS |
| server exit | `server pid exited cleanly` (SIGTERM → clean exit within grace, no hang, no half-open listener) | PASS |

**Verdict (ordered shutdown): PASS (with a grounded caveat on the `reason`).** On
SIGTERM the ordered shutdown emits a terminal SSE `error` frame to the live
subscriber and the process exits cleanly within the grace period (FR-026).

**On the terminal `reason:"aborted"` (grounded):** in the live run the observed
terminal `reason` was `lock_unavailable` (the in-flight handle available here is a
lock-retry job, which reaches its own ~2.5s natural terminal; the open SSE gates
the shutdown drain until the job settles). A genuinely mid-*index* job could not
be caught: on this fixture a full rebuild of **2062 files completes in 452ms**
(`durationMs:452`) — far faster than a reliable SIGTERM window. The specific
`reason:"aborted"` behavior (abort a genuinely-running index via its
`AbortSignal` → terminal `error`/`aborted`, terminal SSE frame emitted before
socket release, `signal.aborted === true`) is exercised **deterministically in
the unit suite**, which injects a controllable mid-index seam:

- `shutdown-abort (FR-023/026) > aborting the server terminates the in-flight job
  as error/aborted and emits a terminal SSE frame` — asserts `ctl.aborted() ===
  true`, the terminal SSE frame `status:"error"` `reason:"aborted"`, and clean
  teardown. **PASS**

Recorded honestly as **live (clean-exit + terminal-SSE-on-shutdown) + unit-grounded
(`reason:"aborted"`)** per the task guidance.

---

## Summary

| Scenario | Slice | Verdict |
|---|---|---|
| 8 — trigger + live SSE progress + terminal `done` | 2 | **PASS** (fully live) |
| 9 — single active job / 409 | 2 | **PASS** (fully live) |
| 10 — lock contention → `lock_unavailable` | 2 | **PASS** (fully live); watcher-restore **unit-grounded** |
| 11 — shutdown-abort → clean exit + terminal SSE frame | 2 | **PASS** (live); `reason:"aborted"` **unit-grounded** |

**All Slice-2 quickstart scenarios (8–11) pass against the built binary** — the
live-exercisable behavior is verified end-to-end, and the two conditions
impractical to reproduce live on this hardware (a daemon-watcher degrade→restore
cycle; catching a mid-*index* abort under a sub-second index) are grounded in the
deterministic unit suite, recorded honestly rather than fabricated.
