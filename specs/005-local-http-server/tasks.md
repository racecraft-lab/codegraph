# Tasks: Local HTTP Server & REST API

**Input**: Design documents from `/specs/005-local-http-server/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml, quickstart.md

**Tests**: Included and required. The workflow requests TDD-shaped tasks — every
implementation task names the failing test written first, and the five `server-*`
suites (real files, real SQLite, `fs.mkdtempSync` + `afterEach` cleanup, **no
mocking** — repo convention) are first-class tasks.

**Unit-test command** (embedding env stripped, per plan Technical Context):

```bash
env -u CODEGRAPH_EMBEDDING_URL -u CODEGRAPH_EMBEDDING_MODEL -u CODEGRAPH_EMBEDDING_DIMS -u CODEGRAPH_EMBEDDING_TIMEOUT_MS npm test
```

## Slice partition (HARD boundary — two sequenced PRs on branch `005-local-http-server`)

The reviewability budget (~620 LOC) trips the greenfield warn line, resolved by a
ratified **2-slice split** (plan Split Decision; each slice < ~400 LOC). The slice
boundary is a hard partition — **two separate PRs**:

- **Slice 1 (PR 1) — read API end-to-end**: Foundation + **US1** (P1) + **US4** (P2)
  + **US2** (P3). Independently shippable; unblocks SPEC-006. Phases 1–5 (T001–T032).
- **Slice 2 (PR 2) — job subsystem**: **US3** (P4), layered on Slice 1's exposed
  seams. Phases 6–8 (T033–T047) — **Polish (Phase 8) lands within PR 2**.
- **Polish** (Phase 8) closes out cross-cutting + the self-repo dogfood; it **ships in
  PR 2** — the ratified 2-PR marker plan (`.process/autopilot-state.json`) folds
  T046–T047 into Slice 2, and T047's self-repo dogfood depends on both slices, so it
  can only land with/after PR 2.

**User-story → slice map**: US1/US2/US4 → Slice 1; US3 → Slice 2.

### Slice-boundary check (straddler audit)

**No task straddles the boundary** (no unit of work mixes Slice-1 and Slice-2
deliverables). The plan designed Slice 2 to *attach to seams Slice 1 exposes*, so
several **wholly-Slice-2** tasks edit files first created in Slice 1 — these are
**seam attachments, not straddlers** (each lands entirely in PR 2):

- **T038** registers the job routes on the router seam created by T004 (`routes.ts`).
- **T040** inserts the in-flight-job abort into the ordered-shutdown seam T006
  exposed in `index.ts`.
- **T041** extends `src/server/openapi.yaml` (T009) and the contract test (T029)
  with the jobs surface.
- **T039** edits upstream-owned `src/mcp/engine.ts` + daemon handler (not
  slice-owned files) — additive control op only.

Each is flagged inline with **[seam→Slice1]**.

---

## Phase 1: Setup & Foundation (Shared Infrastructure)

**Purpose**: The blocking prerequisites for every Slice-1 story — the `src/server/`
skeleton, the shared loopback util, the error envelope, the router matcher, the
daemon-client core, the bootstrap/lifecycle, CLI activation, the fixture harness,
and the shipped `openapi.yaml`. **No user-story work begins until this phase is
complete.**

- [ ] T001 Create the `src/server/` module skeleton — exported stubs + shared wire
  types for `src/server/index.ts`, `routes.ts`, `auth.ts`, `daemon-client.ts`,
  `static.ts`, `errors.ts` so cross-imports resolve and `npm run typecheck` passes
  (plan Project Structure).
- [ ] T002 [P] Extract the loopback predicate (FR-012, research D1): move
  `isLoopbackHost` out of `src/embeddings/config.ts` into `src/utils.ts` as an
  exported function, delete the private copy, and import the shared one in
  `src/embeddings/config.ts`. Guard: existing embeddings-config tests + `npm run
  typecheck` stay green (no behavior change; upstream diff minimal).
- [ ] T003 Implement the error-envelope module in `src/server/errors.ts` — the
  closed six-code vocabulary (`invalid_request` 400, `unauthorized` 401,
  `not_found` 404 with `details.resource ∈ node|repo|route`, `conflict` 409,
  `unavailable` 503 + `Retry-After`, `internal` 500), the `{ error: { code,
  message, details? } }` builder, and whitelisted-fields-only enforcement (never
  raw exception text / absolute paths / stacks). **Failing test first** in
  `__tests__/server-read-api.test.ts` (code→status map + envelope shape). Depends
  on T001. (FR-015/015a)
- [ ] T004 Implement the request router matcher in `src/server/routes.ts` —
  method+path matching with `:id`/`:repo` params; the **single-site decode
  chokepoint** (split the raw path on literal `/` **first**, then exactly one
  `decodeURIComponent` on the matched id segment — the whole path is never decoded,
  FR-004a); the route-miss rule (unknown `/api/*` **or** unsupported method on a
  known path → 404 `not_found`, `details.resource: route`, no 405, FR-018); and a
  **top-level per-handler catch** turning any unanticipated throw into the
  `internal` 500 envelope (FR-015a). Depends on T003. (FR-004a/015a/018)
- [ ] T005 [P] Implement the daemon-client core in `src/server/daemon-client.ts` —
  attach-or-spawn the startup repo's daemon via the MCP proxy machinery
  (`src/mcp/proxy.ts`), forward a read query over its socket, and map an
  attach/spawn failure to a 503 `unavailable` envelope carrying `Retry-After`
  (transient, never a crash — Edge Cases). Depends on T003. (FR-002/008/015a)
- [ ] T006 Implement the bootstrap + lifecycle in `src/server/index.ts` — `node:http`
  `createServer`; bind `--host`/`--port` (default `127.0.0.1:11235`) with `--port 0`
  ephemeral (print the actual bound port) and `EADDRINUSE` → clear error naming the
  port + suggest `--port <n>`/`--port 0` + non-zero exit with **no half-open
  listener**; dispatch `'request'` to the router; expose the reserved `'upgrade'`
  attach point **wired to nothing** (SPEC-009 reservation, no WebSocket impl);
  ordered SIGINT/SIGTERM shutdown (stop accepting → release the port → close daemon
  client sockets decrementing refcounts, **never killing a shared daemon** → exit
  within a bounded grace). **Failing lifecycle test first** in
  `__tests__/server-read-api.test.ts` (bind on `--port 0`, 404 envelope for any
  path, clean stop, subsequent re-bind, `EADDRINUSE` shape). Depends on T004, T005.
  (FR-002/026)
- [ ] T007 Wire CLI activation in `src/bin/codegraph.ts` (**minimal upstream diff**)
  — add the `--web` option + action branch calling `src/server/index.ts`'s start,
  and the `--web`/`--mcp` mutual-exclusion guard failing startup with a "choose one
  mode" error; keep the `serve` command `hidden` so `--help` is byte-identical.
  **Failing dormancy test first** in `__tests__/server-read-api.test.ts` (bare
  `serve` / `serve --mcp` byte-identical; no bind without `--web`; `serve --web
  --mcp` fails). Depends on T006. (FR-001, SC-006)
- [ ] T008 Create the shared fixture harness `__tests__/helpers/server-fixture.ts` —
  build a real fixture index in an `fs.mkdtempSync` temp dir (real files, real
  SQLite via `CodeGraph.init`+`indexAll`, no mocking), start `serve --web` on
  `--port 0`, and return the base URL + a teardown that stops the server and removes
  the temp dir in `afterEach` (repo test convention). MUST support an **optional
  synthetic web root** (seed a temp `dist/web/` with `index.html` + a probe asset and
  point the server's injectable web-root at it, per T019) so T012 case (b) can
  exercise the `dist/web/`-present path. Depends on T006.
- [ ] T009 [P] Create the shipped contract artifact `src/server/openapi.yaml` (the
  **read-API subset** copied from the design source
  `specs/005-local-http-server/contracts/openapi.yaml` — read-tagged paths only;
  jobs paths land in Slice 2 via T041) **and** wire `copy-assets` in `package.json`
  to copy it into `dist/server/`. **Failing ship-check test first** in
  `__tests__/server-read-api.test.ts` asserting `dist/server/openapi.yaml` exists
  after build. (Constitution VII, FR-025)
- [ ] T010 Reviewability checkpoint — confirm the planned task/file scope keeps
  **each slice under ~400 reviewable LOC** (Slice 1 read API; Slice 2 jobs), that
  **zero new runtime dependencies** are introduced (FR-003), and that the ratified
  2-slice split still holds; record the check before implementation (tasks-template
  Reviewability gate; plan Split Decision). No file changes.

**Checkpoint**: server binds on `--port 0`, returns the 404 envelope, starts/stops
cleanly, ships `openapi.yaml` — Slice-1 stories can begin.

---

## Phase 2: [Slice 1] User Story 1 — Query the graph over a local REST API (P1) 🎯 MVP

**Goal**: Every read capability the graph exposes (status, search, node detail,
callers, callees, impact, graph neighborhood) reachable as JSON over documented
endpoints, served from the shared warm daemon index.

**Independent Test**: Start `serve --web` in an indexed repo; retrieve status, a
symbol search, callers, callees, impact, and a graph neighborhood over the
documented endpoints — each returns the expected graph data as JSON with **zero
source files read by hand**. (On a loopback bind auth is a no-op, so US1 is
testable before US4 lands.)

### Tests for User Story 1 (write FIRST — must FAIL)

- [ ] T011 [P] [US1] Failing read-endpoint tests in
  `__tests__/server-read-api.test.ts` — status body (FR-005 fields), symbol-search
  paging `{items,total,limit,offset}` (FR-006), node-detail own-fields-only
  (FR-004), callers/callees paged, impact + graph subgraph `{nodes,edges,truncated}`
  with the 2000-node cap + `truncated` (FR-004/007), the **divergent default depths**
  (a no-`depth` `/api/impact/:id` traverses to depth **3**, a no-`depth`
  `/api/graph/:id` to depth **1**; a malformed/negative `depth` on either → 400,
  FR-004/007/015a), and a `file:`-shaped id with an
  encoded `%2F` round-tripping to the correct node + an unknown/malformed id → 404
  `not_found` (`details.resource: node`) (FR-004a). Uses the T008 harness.
- [ ] T012 [P] [US1] Failing static/fallback tests in
  `__tests__/server-static-fallback.test.ts`, exercising **both** web-root states.
  **(a) `dist/web/` absent** (SPEC-005's production reality): `/` placeholder present
  + data-free/byte-identical regardless of registered repos (FR-017/017a); an
  **extensionless non-root route** (`GET /graph`) → the **same** placeholder, not 404
  (FR-017/018 app-shell stand-in); unknown `/api/*` → 404 envelope; missing
  `.js`/`.css` asset → 404 (no shell fallback); **no CORS headers** on any response
  (FR-018/019). **(b) synthetic `dist/web/` present** — seed a temp web root
  (`index.html` + a probe `.js` asset) via the T008 harness's injectable web-root
  (T019): the probe asset is served with the right content-type, and an extensionless
  route → that `index.html` shell (FR-017 "serve when present"). The **traversal
  probe** (`GET /..%2f..%2f..%2fetc%2fpasswd`) → 404 reading no out-of-root file in
  **both** states (FR-017b).

### Implementation for User Story 1

> **Amendment (human-ratified 2026-07-11, plan Constitution III updated):** T013's
> wrappers ride a new **additive structured read RPC** (`codegraph/read`) added to the
> daemon session dispatch (`src/mcp/session.ts` + engine/query-pool wiring), because
> the socket's `tools/call` surface returns id-less markdown unusable for the REST
> wire shapes. Read-only; FR-002/Q1 upheld (daemon executes all reads, one warm
> index); FR-021 untouched (bans indexing RPCs only). The retrieval-guardian check
> (T042) now also verifies this addition changes no MCP tool output.

- [ ] T013 [US1] Read-query forwarding wrappers in `src/server/daemon-client.ts` —
  typed methods over the daemon socket for `searchNodes` / `getNode` / `getCallers`
  / `getCallees` / `getImpactRadius` / graph-neighborhood + status/index-health,
  mapping library results to the wire `Node`/`Edge` shapes (data-model Read query
  result). Depends on T005. (FR-004/008)
- [ ] T014 [US1] `GET /api/status` handler on the T004 router — `version` + default
  repo `{id,root,name}` + `index {state,fileCount,nodeCount,edgeCount,lastIndexed}`
  + `hybridSearch {available,reason}` + `lsp {available}`; reports an
  un-indexed/absent startup index via `index.state` **without refusing startup**
  (Edge Cases); version is carried here, **not** a URL prefix. Depends on T013.
  (FR-005/016) — `src/server/routes.ts`.
- [ ] T015 [US1] `GET /api/search` handler — **required** `q` (absent/empty → 400
  `invalid_request`); optional `mode ∈ {keyword,semantic,hybrid,auto}` defaulting to
  `auto` **only when omitted** (invalid value → 400, deliberately diverging from
  MCP/CLI coercion); offset paging (`limit` 100/500 **clamp**, `offset`, `total`);
  degradation → **200** with `degraded:true`+`degradationReason` (never an HTTP
  error). Depends on T013. (FR-004/006/006a) — `src/server/routes.ts`.
- [ ] T016 [US1] Shared offset-paging helper + `GET /api/callers/:id` and
  `GET /api/callees/:id` handlers — `limit` default 100 / max 500 (clamped, not
  errored), `offset`, `total`, over the decoded node id; unknown id → 404
  `not_found` (`details.resource: node`). Depends on T013. (FR-004/006) —
  `src/server/routes.ts`.
- [ ] T017 [US1] `GET /api/node/:id` handler — the node's **own fields only**
  (identity/kind/name/location/signature/doc), bounded regardless of fan-in
  (relationships come from the paged/subgraph endpoints). Depends on T013.
  (FR-004/004a) — `src/server/routes.ts`.
- [ ] T018 [US1] `GET /api/impact/:id` and `GET /api/graph/:id` handlers — the shared
  `{nodes,edges,truncated}` subgraph shape with the **2000-node cap** + `truncated`
  flag; `graph` depth default **1** / max 3 (over-max clamps); `impact` depth
  default **3** / max 3 (its own natural default, NOT the neighborhood default).
  Depends on T013. (FR-004/007) — `src/server/routes.ts`.
- [ ] T019 [P] [US1] Static mount + placeholder in `src/server/static.ts` — serve
  `dist/web/` when present; while absent, `/` **and every extensionless browser
  route** return the minimal **data-free** placeholder pointing at `/api/status`
  (byte-identical regardless of registered repos — the app-shell stand-in,
  FR-017/018); apply the strict fallback rules (missing asset-extension + `/api/*`
  still 404, FR-018) and emit **no CORS headers** (FR-019). The web-root path MUST be
  **resolvable/injectable** (not hard-pinned to the process's own `dist/web/`) so the
  T008 harness can point it at a synthetic temp web root for the T012 case-(b)
  present-`dist/web/` assertions. (FR-017/017a/018/019)
- [ ] T020 [US1] Path-traversal confinement in `src/server/static.ts` — decode the
  request path **once** (bounded against multiply-encoded input) and route every
  resolved path through `validatePathWithinRoot` (`src/utils.ts`), returning null →
  404 `not_found` (`details.resource: route`) on any `..`/absolute/encoded-separator
  (`%2e%2e`,`%2f`,double-encoding)/NUL escape; **never 403, never file contents**.
  Depends on T019. Makes the T012 traversal probe pass. (FR-017b)

**Checkpoint**: US1 read API fully functional on a loopback fixture — SC-001
reachable; MVP demonstrable.

---

## Phase 3: [Slice 1] User Story 4 — Safe-by-default binding & token auth (P2)

**Goal**: Loopback bind needs no auth; a non-loopback bind fails closed without
`CODEGRAPH_SERVER_TOKEN`, then enforces it as a Bearer on every `/api/*` request;
the `Host` header is allowlisted even on loopback (DNS-rebinding defense).

**Independent Test**: Defaults → loopback, `/api/*` served with no credentials;
non-loopback + no token → startup refused (nothing binds); token set + non-loopback
→ `/api/*` without a valid Bearer rejected 401, with it succeeds.

**Note**: US4 hardens the request pipeline US1/US2 ride on. On loopback the Bearer
gate is a no-op, so US1/US2 stay independently testable; the Host-allowlist (T023)
is additive and US1/US2 tests use an allowlisted `Host`.

### Tests for User Story 4 (write FIRST — must FAIL)

- [ ] T021 [P] [US4] Failing auth/binding tests in
  `__tests__/server-auth-binding.test.ts` — the shared `isLoopbackHost` set
  (`localhost`/`::1`/`127.0.0.0/8` → true; `0.0.0.0`/`::`/remote → false, FR-012);
  loopback default serves `/api/*` with no credentials (SC-002); non-loopback + no
  token → startup refused, nothing binds (FR-013/SC-002); non-loopback + token →
  missing/invalid Bearer → **401** generic body, valid → 200 (FR-014/SC-003);
  non-allowlisted `Host` → **400** `invalid_request` even on loopback (FR-012);
  token value never appears in captured logs (FR-014a).

### Implementation for User Story 4

- [ ] T022 [US4] Fail-closed bind gate in `src/server/auth.ts` — using the shared
  `isLoopbackHost` (T002), refuse startup when the bind host is non-loopback and
  `CODEGRAPH_SERVER_TOKEN` is unset (nothing binds); `0.0.0.0`/`::` are
  non-loopback. Wire into the T006 bootstrap **before** `listen`. Depends on T002,
  T006. (FR-012/013) — `src/server/auth.ts`, `src/server/index.ts`.
- [ ] T023 [US4] Host-header allowlist in `src/server/auth.ts` — validate every
  request's `Host` against `{localhost, 127.0.0.1, [::1], bound host}` × bound port
  **even on loopback**; non-allowlisted → 400 `invalid_request` naming the offending
  header in `details` (no 403; vocabulary stays closed). Depends on T004. (FR-012)
- [ ] T024 [US4] Constant-time Bearer check in `src/server/auth.ts` — scope **every
  `/api/*` route** (incl. the future SSE endpoint) to the token on a token-bound
  bind; reject empty/missing **before** comparison, then compare **SHA-256 digests**
  of presented vs configured (UTF-8) with `crypto.timingSafeEqual` (digest-first →
  equal-length, never throws, hides length); 401 body **generic + identical**
  regardless of reason (enumeration prevention); the static mount + `/` placeholder
  sit **outside** the auth boundary. Depends on T004. (FR-014) — `src/server/auth.ts`,
  `src/server/routes.ts`.
- [ ] T025 [US4] Request-log redaction at the dispatch seam in `src/server/index.ts`
  — the request/diagnostic logger stays local (no egress) and MUST NOT serialize the
  `Authorization` header, the presented Bearer, or `CODEGRAPH_SERVER_TOKEN` in any
  reversible form; assert no token substring in captured logs. Depends on T006.
  (FR-014a)

**Checkpoint**: safe binding + auth hold 100% (SC-002/003); token never leaks.

---

## Phase 4: [Slice 1] User Story 2 — Discover & address multiple indexed repos (P3)

**Goal**: `/api/repos` lists indexed projects (startup repo = default); repo-scoped
reads address any listed repo by 16-hex id via an optional `?repo=`, attaching a
non-default repo's daemon lazily on first touch.

**Independent Test**: With two indexed projects registered, `/api/repos` lists both
(startup = default); a repo-scoped read against the second attaches its daemon on
demand and returns its data; an unregistered/malformed id → 404 `not_found`
(`details.resource: repo`).

### Tests for User Story 2 (write FIRST — must FAIL)

- [ ] T026 [P] [US2] Failing multi-repo tests in the repos section of
  `__tests__/server-read-api.test.ts` — `/api/repos` lists registered projects with
  the startup repo `default:true` (FR-009); a repo-scoped read with `?repo=<16hex>`
  against a second repo attaches its daemon **lazily on first access** (not at
  startup) and returns that repo's data (FR-010/010a); an unregistered **or**
  malformed (`^[0-9a-f]{16}$` fail) `repo` → 404 `not_found` (`details.resource:
  repo`), **never 400** (FR-011); `/api/status` and `/api/repos` reject `repo`.

### Implementation for User Story 2

- [ ] T027 [US2] `GET /api/repos` handler + registry listing in
  `src/server/daemon-client.ts` — from `listDaemons()`
  (`src/mcp/daemon-registry.ts`) return each repo `{id,root,name,default}` with
  exactly one `default:true` (the startup repo); the 16-hex id is the registry's
  realpath key **by construction**. Depends on T013. (FR-009/010) —
  `src/server/daemon-client.ts`, `src/server/routes.ts`.
- [ ] T028 [US2] Optional `repo` query-param resolution + lazy multi-repo attach in
  `src/server/daemon-client.ts` — the six repo-scoped read endpoints accept an
  optional 16-hex `repo` selecting the target (omitted → default/startup repo);
  first access **lazily attaches** that repo's daemon (never eager); malformed or
  unregistered → 404 `not_found` (`details.resource: repo`) per FR-011; `/api/status`
  and `/api/repos` are not repo-scoped. Depends on T027. (FR-010/010a/011) —
  `src/server/daemon-client.ts`, `src/server/routes.ts`.

**Checkpoint**: all three Slice-1 stories independently functional.

---

## Phase 5: [Slice 1] Contract test & PR close-out (cross-cutting within Slice 1)

**Purpose**: Prove contract honesty across the whole read surface and package Slice
1 as PR 1. (Cross-story tasks — no `[USx]` label, like Polish.)

- [ ] T029 [Slice 1] OpenAPI contract test in
  `__tests__/server-openapi-contract.test.ts` — start a fixture server on `--port 0`
  and walk **every read-tagged path/method/status** in `src/server/openapi.yaml`,
  including the **503 `unavailable`** (+ `Retry-After`) on every daemon-forwarding
  read, the **400 `invalid_request`** on every parameter endpoint, the FR-004a
  `file:`+`%2F` round-trip case, and the FR-017b traversal probe; fail on any
  undocumented route or mismatched shape (CI tolerates zero). Depends on
  T014–T020, T027–T028. (FR-025, SC-005)
- [ ] T030 [Slice 1] Add the Slice-1 CHANGELOG entry under `## [Unreleased]` —
  user-facing (`codegraph serve --web` local REST API over the warm index; loopback
  default; token-guarded network bind); no internal paths/symbols/benchmarks.
  `CHANGELOG.md`. (Constitution "Writing changelog entries")
- [ ] T031 [Slice 1] Run the Slice-1 quickstart validation — `npm run build` (assert
  `dist/server/openapi.yaml` present) + `npm run typecheck` + the embedding-stripped
  `npm test`, then quickstart Scenarios 1–7 against the built binary; record
  evidence. (quickstart.md; SC-001/002/003/005/006)
- [ ] T032 [Slice 1] Generate the Slice-1 PR review packet — what changed, why,
  non-goals, review order, scope budget (< ~400 LOC), traceability (each major FR/SC
  → changed files + verification evidence, incl. dormancy SC-006), known gaps, and
  the rollback lever (the `--web` flag). Name deferred follow-up: SPEC-006.
  (plan PR Review Packet Requirements, SC-007)

**Checkpoint / ⛔ SLICE BOUNDARY**: Slice 1 is independently shippable as **PR 1**
(unblocks SPEC-006). Slice 2 opens a **fresh PR** on the same branch.

---

## Phase 6: [Slice 2] User Story 3 — Trigger a re-index & watch live progress (P4)

**Goal**: `POST /api/reindex/:repo` starts an in-process re-index (incremental sync
default, `?full=true` rebuild); progress streams over per-repo SSE; a duplicate is
409'd; the last outcome is readable until restart; lock contention and shutdown are
contained; a long rebuild re-arms the daemon watcher.

**Independent Test**: With the read API in place, POST a re-index, subscribe to the
stream (immediate `snapshot` → `progress` → terminal), POST a second for the same
repo mid-run (→ 409), then read the finished job's terminal outcome.

### Tests for User Story 3 (write FIRST — must FAIL)

- [ ] T033 [P] [US3] Failing job tests in `__tests__/server-reindex-jobs.test.ts` —
  POST → **202** `{id,repo,mode,status:"running",startedAt}` (sync default;
  `?full=true` → `mode:"full"`); SSE `snapshot`→`progress`→ single terminal
  `done`/`error` then close, `progress` `{phase,current,total,currentFile?}`
  mirroring `IndexProgress`, per-mode `result` (FR-023/024); a second POST while
  running → **409** `conflict` (FR-022); registered-repo-with-no-job → 404
  `not_found` (`details.resource: repo`) (FR-024); unregistered-repo POST → 404
  (FR-011/020); lock contention → `error` `reason:"lock_unavailable"` while the POST
  still returned 202 (FR-021a); mid-job reconnect re-snapshots; client disconnect
  does **not** cancel the job; shutdown-abort → terminal `error` `reason:"aborted"`
  + lock released (FR-023/026).

### Implementation for User Story 3

- [ ] T034 [US3] In-memory job registry in `src/server/jobs.ts` — latest-job-per-repo
  map, `crypto.randomUUID()` id, lifecycle `running` → terminal `done`/`error` (no
  `queued` state), single-active-job guard backing the 409, and the **per-mode
  terminal `result` union** (`sync` vs `full`, FR-015a whitelist — drop
  `changedFilePaths` and `errors[]`; a partial full → `success:false` /
  `filesDiscovered` shortfall). (FR-022/024, research D3)
- [ ] T035 [US3] Job driver in `src/server/jobs.ts` — run the re-index in the serve
  process via the library `sync()` (default) / `indexAll()` (`?full=true`) under the
  existing cross-process file lock, wiring an `AbortSignal`; **contain** every
  non-lock, non-abort failure as a terminal `error` with a whitelisted `reason`
  (never crash the process, never a 5xx on the returned 202, never stuck `running`).
  Depends on T034. (FR-020/021)
- [ ] T036 [US3] Lock-contention handling in `src/server/jobs.ts` — when
  `sync()`/`indexAll()` cannot acquire the file lock, retry for a bounded ~2–3s
  window (**no queue**) then terminate as `error` `reason:"lock_unavailable"` (the
  POST still returned 202 — **not 409, not 503**). Depends on T035. (FR-021a)
- [ ] T037 [P] [US3] SSE writer in `src/server/sse.ts` — `text/event-stream` +
  `Cache-Control:no-cache` + `Connection:keep-alive` + `X-Accel-Buffering:no`; emit
  `snapshot` on **every** connect (terminal-and-close if the job already finished),
  live `progress`, one terminal `done`/`error`; a `~15s` `:`-comment heartbeat;
  **per-subscriber backpressure coalescing** to the latest pending `progress` on
  `res.write()===false` (bounded memory; always deliver `snapshot` + terminal);
  multiple concurrent subscribers each snapshot independently; a slow/disconnected
  subscriber never stalls the job or the others; **no** `id:`/Last-Event-ID. Final
  wiring to the response seam is T038. (FR-023)
- [ ] T038 [US3] **[seam→Slice1]** Job routes on the T004 router seam
  (`src/server/routes.ts`) — `POST /api/reindex/:repo` (**URL-only params, reads no
  body**; registry repos only → 404 if unregistered; 202 + descriptor; 409 if
  active), `GET /api/reindex/:repo` (latest job state; registered-no-job → 404
  `resource:repo`), `GET /api/reindex/:repo/events` (SSE, token-scoped like other
  `/api/*`). Depends on T034–T037. (FR-020/022/023/024)
- [ ] T039 [US3] Watcher re-arm (research D2) — add the additive
  `MCPEngine.rearmWatcher()` (only when `cg.isDegraded()`: `unwatch()`+`watch()` to
  clear the one-way degrade latch) + a one-line daemon request-handler case in
  `src/mcp/`, and fire a **narrow daemon CONTROL message** from the job's
  completion/abort `finally` path (after lock release), gated by `isDegraded()` so
  it is a cheap no-op on a healthy watcher. Control-plane only — **no indexing RPC**
  (FR-021 invariant holds). Depends on T035. (FR-021a) — `src/mcp/engine.ts`,
  `src/mcp/daemon.ts`, `src/server/jobs.ts`.
- [ ] T040 [US3] **[seam→Slice1]** Shutdown-abort integration into the T006 ordered
  shutdown (`src/server/index.ts`, step 2) — abort the in-flight job via its
  `AbortSignal` → record terminal `error` `reason:"aborted"` → emit the terminal SSE
  event → release the lock in cleanup → exit within the grace period (an aborted
  full rebuild leaves the index partial/recoverable). Depends on T035, T037.
  (FR-023/026)

**Checkpoint**: jobs + live SSE + 409 + `lock_unavailable` + watcher restore +
shutdown-abort (SC-004).

---

## Phase 7: [Slice 2] Contract extension & PR close-out

- [ ] T041 [Slice 2] **[seam→Slice1]** Extend `src/server/openapi.yaml` with the
  jobs-tagged paths (`POST`/`GET /api/reindex/{repo}`, `GET
  /api/reindex/{repo}/events`) from the design source, and extend
  `__tests__/server-openapi-contract.test.ts` to walk the jobs surface (202
  descriptor, 409 shape, 404 `resource:repo`, SSE headers). Depends on T038.
  (FR-025)
- [ ] T042 [P] [Slice 2] Run the retrieval-guardian check — Slice 2 touches
  `src/mcp/` (the additive `rearmWatcher` control op, T039); confirm **no change** to
  MCP tool output, `getExploreBudget`/`getExploreOutputBudget`, error shaping, or
  edge synthesis (plan Constitution VI guardrail). Advisory evidence only.
- [ ] T043 [Slice 2] Add the Slice-2 CHANGELOG entry under `## [Unreleased]` —
  user-facing (on-demand re-index with live progress over `serve --web`); no
  internals. `CHANGELOG.md`.
- [ ] T044 [Slice 2] Run the Slice-2 quickstart validation — quickstart Scenarios
  8–11 (trigger + progress + terminal, 409, `lock_unavailable` + watcher restore
  incl. the `isDegraded()` true→false grounding check, shutdown-abort) against the
  built binary; record evidence. (quickstart.md; SC-004)
- [ ] T045 [Slice 2] Generate the Slice-2 PR review packet — what changed, why,
  non-goals, review order, scope budget (< ~400 LOC), traceability (SC-004,
  FR-020–024/026 → files + evidence), known gaps, rollback; name deferred
  follow-ups: SPEC-006 (web UI), SPEC-009 (LSP-over-WebSocket). (SC-007)

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T046 [P] Document `codegraph serve --web` for users — flags (`--web`,
  `--host`, `--port`, `--port 0`), `CODEGRAPH_SERVER_TOKEN`, the loopback default,
  and the endpoint list — in the appropriate user doc; no internal symbols/paths.
- [ ] T047 Self-repo dogfood (SC-008, Constitution "Dogfooding (binding)") — the
  **final** validation: run `node dist/bin/codegraph.js serve --web --port 0`
  against **this repository's own index**; confirm `GET /api/status` reports this
  project's health and `GET /api/search?q=ExtractionOrchestrator` returns this
  repo's own symbols (Slice 1), and a `POST /api/reindex/:repo` runs an incremental
  sync with live progress (Slice 2); record the outcome in the spec UAT runbook +
  retrospective. Depends on all prior.

---

## Dependencies & Execution Order

### Phase dependencies

- **Foundation (Phase 1)** — no dependencies; blocks everything.
- **Slice 1 stories (Phases 2–4)** — depend on Foundation. Priority order US1 (P1) →
  US4 (P2) → US2 (P3); each is independently testable (auth is a loopback no-op).
- **Slice 1 close-out (Phase 5)** — T029 depends on all Slice-1 endpoints
  (T014–T020, T027–T028). **Ships as PR 1.**
- **Slice 2 (Phases 6–7)** — depends on Slice 1 (the read API + router/shutdown
  seams). **Ships as PR 2.**
- **Polish (Phase 8)** — after both slices; **ships within PR 2** (folded into Slice 2
  per the ratified 2-PR marker plan).

### Key intra-phase dependencies

- T003 → T004, T005 → T006 → T007, T008; T002 → T022.
- US1: T013 → T014/T015/T016/T017/T018; T019 → T020.
- US4: T022 needs T002+T006; T023/T024 need T004.
- US2: T027 → T028.
- US3: T034 → T035 → T036; T037 ∥ T034–T036; T038 needs T034–T037; T039 needs T035;
  T040 needs T035+T037. T041 needs T038.

### Parallel opportunities ([P] = different files, no incomplete-task dep)

- **Foundation**: T002, T005, T009 in parallel (distinct files).
- **US1**: T011 ∥ T012 (test files); T019 (static.ts) ∥ the routes handlers.
- **US4 / US2 / US3 tests**: T021, T026, T033 each parallel-safe within their phase.
- **US3 impl**: T037 (`sse.ts`) ∥ T034–T036 (`jobs.ts`).
- **Close-out/Polish**: T042 ∥ T043; T046 ∥ T047 prep.

### Parallel example — User Story 1

```bash
# Tests first (distinct files, run together):
Task T011: read-endpoint tests in __tests__/server-read-api.test.ts
Task T012: static/fallback tests in __tests__/server-static-fallback.test.ts

# Then implementation — static mount parallel to the route handlers:
Task T019: static mount + placeholder in src/server/static.ts   # [P]
# (T014–T018 share src/server/routes.ts → sequential after T013)
```

---

## Implementation Strategy

### MVP first (Slice 1 · User Story 1)

1. Phase 1 Foundation → 2. Phase 2 US1 → **STOP & VALIDATE** the read API on a
   loopback fixture (SC-001) → demoable via `curl`/browser.

### Incremental delivery

1. Foundation → US1 (MVP) → US4 (safe binding) → US2 (multi-repo) → Slice-1
   close-out → **ship PR 1** (unblocks SPEC-006).
2. US3 jobs + SSE → Slice-2 close-out → **ship PR 2**.
3. Polish + self-repo dogfood.

Each slice stays under the ~400 reviewable-LOC ceiling (SC-007) and cuts
end-to-end through CLI → server → daemon/library → tests.

---

## Notes

- **Non-goals (do NOT generate tasks)**: daemon indexing RPC (jobs run in the serve
  process; T039 is a control-plane re-arm, not indexing), job history/persistence,
  CORS, cursor paging, `/api/v1` prefix, `sirv`/router deps, TLS, WebSocket impl
  (T006 reserves the `'upgrade'` hook only). (spec Out of Scope; FR-003 zero new
  deps.)
- **[P]** = different files, no incomplete-task dependency. Tasks sharing
  `src/server/routes.ts` or `src/server/daemon-client.ts` are **not** mutually [P].
- Tests write real files + real SQLite (`fs.mkdtempSync`, `afterEach` cleanup, no
  mocking). Platform-divergent assertions gate with `it.runIf(...)`.
- Every implementation task has its guarding test written first and seen to FAIL
  (TDD; Constitution IV).
- Upstream-owned diffs stay minimal (`src/bin/codegraph.ts` T007; `src/mcp/*` T039;
  `src/embeddings/config.ts` T002) — fork discipline (Constitution III).
