# Quickstart & Validation Guide: Local HTTP Server & REST API

A run/validation guide that proves the feature end-to-end. Endpoint shapes live
in [`contracts/openapi.yaml`](./contracts/openapi.yaml); entities in
[`data-model.md`](./data-model.md); the "why" in [`research.md`](./research.md).
Each scenario names the Success Criteria (SC) and requirements it validates.

## Prerequisites

- Node `>=22.5` from source; `npm install && npm run build` in this worktree.
- An indexed project (a `.codegraph/` index). For the self-repo dogfood, this
  repository itself (Constitution "Dogfooding (binding)", SC-008).
- Unit tests run with embedding env stripped:
  `env -u CODEGRAPH_EMBEDDING_URL -u CODEGRAPH_EMBEDDING_MODEL -u CODEGRAPH_EMBEDDING_DIMS -u CODEGRAPH_EMBEDDING_TIMEOUT_MS npm test`

## Build & unit gate

```bash
npm run build            # tsc + copy-assets (must copy src/server/openapi.yaml into dist/)
npm run typecheck
env -u CODEGRAPH_EMBEDDING_URL -u CODEGRAPH_EMBEDDING_MODEL -u CODEGRAPH_EMBEDDING_DIMS -u CODEGRAPH_EMBEDDING_TIMEOUT_MS npm test
```

Expected: build green; `dist/server/openapi.yaml` exists (fail-loud if the
copy-assets wiring is missing — Constitution VII); all suites pass, including the
new `server-*` suites.

---

## Slice 1 — read API (US1, US2, US4)

### Scenario 1 — read the graph over HTTP (SC-001, FR-004/005/008)

```bash
node dist/bin/codegraph.js serve --web --port 0 &   # prints the actual bound port
# GET /api/status, /api/search?q=..., /api/node/:id, /api/callers/:id,
# /api/callees/:id, /api/impact/:id, /api/graph/:id, /api/repos
```

Expected: `GET /api/status` reports `version` + `index` health and the default
`repo`; a symbol search returns paged `{ items, total, limit, offset }` from the
shared daemon index; callers/callees/impact/graph return graph relationships
consistent with the same query over MCP/CLI — **zero source files read by hand**.
`GET /api/graph/:id` sets `truncated` when the 2000-node cap is hit. A
`file:`-shaped node id with an encoded `%2F` round-trips to the correct node
(FR-004a); an unknown/malformed id → 404 `not_found` (`details.resource: node`).

### Scenario 2 — multi-repo discovery + lazy attach (US2, FR-009/010/011)

Expected: with two indexed projects registered, `GET /api/repos` lists both with
the startup repo `default: true`; a repo-scoped read against the **second** repo
attaches its daemon **on demand** (not at startup) and returns that repo's data;
an unregistered repo id → 404 `not_found` (`details.resource: repo`).

### Scenario 3 — safe-by-default binding + token auth (SC-002/003, FR-012/013/014)

Expected, 100% of the time:
- Defaults → binds `127.0.0.1:11235`, serves `/api/*` with **no** credentials.
- `--host 0.0.0.0` with **no** `CODEGRAPH_SERVER_TOKEN` → **startup refused**,
  nothing binds (fail-closed).
- `--host 0.0.0.0` **with** the token → `/api/*` without a valid
  `Authorization: Bearer` → **401** (generic body); with the valid token → 200.
- A request whose `Host` header is not on the allowlist (bound host/port,
  `localhost`, `127.0.0.1`, `[::1]`) → **400** `invalid_request`, even on loopback
  (DNS-rebinding defense).

### Scenario 4 — static placeholder + strict fallback (FR-017/017a/018/019)

Expected: with no `dist/web/`, `GET /` returns the minimal placeholder page
pointing at `/api/status` (byte-identical regardless of registered repos, no
repo-identifying data). Unknown `/api/*` → 404 JSON envelope; a missing
`.js`/`.css` asset → 404 (no shell fallback); an extensionless browser route →
the app shell. No CORS headers on any response.

### Scenario 5 — contract honesty (SC-005, FR-025)

```bash
env -u CODEGRAPH_EMBEDDING_URL npx vitest run __tests__/server-openapi-contract.test.ts
```

Expected: the contract test starts a fixture server on `--port 0` and walks every
path/method/status in `openapi.yaml`; it **fails on any undocumented route or
mismatched response shape**. CI tolerates zero undocumented endpoints.

### Scenario 6 — dormancy (SC-006, FR-001, Constitution VII)

Expected: without `--web`, no HTTP listener opens and no port binds; bare
`codegraph serve` and `codegraph serve --mcp` behave **byte-identically** to the
prior release (the `serve` command stays hidden — `--help` is unchanged).
`serve --web --mcp` → startup fails with a "choose one mode" error.

### Scenario 7 — clean lifecycle (FR-026)

Expected: SIGINT/SIGTERM → stop accepting connections, end idle SSE responses,
release the bound port, close daemon client sockets (decrementing refcounts; the
serve process never kills a daemon), exit within a bounded grace period. A
subsequent start re-binds. `--port <n>` in use → a clear `EADDRINUSE` error naming
the port, suggesting `--port <n>`/`--port 0`, non-zero exit, no half-open listener.

---

## Slice 2 — re-index jobs (US3)

### Scenario 8 — trigger + live progress + terminal outcome (SC-004, FR-020/023/024)

```bash
# POST /api/reindex/:repo            -> 202 { id, repo, mode:"sync", status:"running", startedAt }
# POST /api/reindex/:repo?full=true  -> 202 mode:"full"
# GET  /api/reindex/:repo/events     -> SSE: snapshot, progress..., terminal done/error
# GET  /api/reindex/:repo            -> latest job state (readable after finish)
```

Expected: subscribing yields an immediate `snapshot`, then `progress`
(`{ phase, current, total, currentFile? }` mirroring `IndexProgress` verbatim),
then a single terminal `done`/`error`; the stream then closes. After completion
the latest-job-state read returns the terminal outcome, with `result` shaped
**per mode** (`sync` vs `full`, FR-023/024 — see data-model.md). A mid-job
reconnect re-snapshots (no Last-Event-ID replay). A client disconnect does not
cancel the running job.

### Scenario 9 — single active job (SC-004, FR-022)

Expected: while a job runs, a second `POST /api/reindex/:repo` for the **same**
repo → **409** `conflict`; no duplicate job starts. (409 is reserved for this case
only — never lock contention, never daemon-attach failure.)

### Scenario 10 — lock contention → `lock_unavailable` + watcher restore (FR-021/021a)

Expected: when the underlying `sync()`/`indexAll()` cannot acquire the
cross-process file lock (held by the daemon watcher or a concurrent CLI
`index`/`sync`), the job retries for ~2–3s then terminates as `error` with
`reason: "lock_unavailable"`, delivered over SSE and the latest-job-state read;
the `POST` itself still returned 202 (no new HTTP status; not 409, not 503). After
a long `?full=true` rebuild that drives the daemon watcher past its ~60s
lock-retry budget, the job's completion/abort path **re-arms the daemon watcher**
(D2) — auto-sync is restored for every MCP session sharing that daemon.

Grounding check (research.md D2): assert the daemon reports `isDegraded() == true`
mid-rebuild, then `false` after the job's terminal path fires the re-arm.

### Scenario 11 — shutdown-abort mid-job (FR-023/026)

Expected: on process shutdown with a job in flight, the server aborts via the
job's `AbortSignal`, records a terminal `error` with `reason: "aborted"`, emits
the terminal SSE event, releases the lock in cleanup, and exits within the grace
period. An aborted full rebuild leaves the index partial and recoverable by
re-running the job.

---

## Self-repo dogfood (SC-008, Constitution "Dogfooding")

```bash
node dist/bin/codegraph.js serve --web --port 0 &   # in this repository
# GET /api/status  -> this project's index health
# GET /api/search?q=ExtractionOrchestrator  -> this project's own symbols
```

Expected: `serve --web` here answers `/api/status` and a symbol search with this
repository's own graph data. Record the outcome in the spec's UAT runbook and the
retrospective (binding dogfood step).

## Traceability (for the PR review packet)

| Requirement / SC | Scenario(s) | Slice |
|---|---|---|
| SC-001 · FR-004/005/008 | 1 | 1 |
| US2 · FR-009/010/011 | 2 | 1 |
| SC-002/003 · FR-012/013/014 | 3 | 1 |
| FR-017/018/019 | 4 | 1 |
| SC-005 · FR-025 | 5 | 1 |
| SC-006 · FR-001 (dormancy) | 6 | 1 |
| FR-026 (lifecycle) | 7 | 1 |
| SC-004 · FR-020/023/024 | 8, 9 | 2 |
| FR-021/021a (lock + watcher restore) | 10 | 2 |
| FR-023/026 (abort) | 11 | 2 |
| SC-008 (dogfood) | Self-repo | both |
