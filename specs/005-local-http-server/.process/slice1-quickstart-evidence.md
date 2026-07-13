# SPEC-005 Slice-1 Quickstart Validation Evidence (T031)

Runs `specs/005-local-http-server/quickstart.md` **Scenarios 1–7** against the
**built binary** (`dist/bin/codegraph.js`), never this repo's own index. Each
scenario records the command, an actual output snippet, and a pass/fail verdict.

- **Date:** 2026-07-11
- **Binary:** `node dist/bin/codegraph.js` (built via `npm run build`; `@colbymchenry/codegraph@1.4.1`)
- **Node:** v24.11.1 (within `engines >=20 <25`; `node:sqlite` backend)
- **Env:** `CODEGRAPH_EMBEDDING_*` stripped (deterministic, structural-only index)
- **Fixtures:** two temp projects under the scratchpad, each `codegraph init`'d
  (real `.codegraph/` index), reaped after the run. `fixA` = default/startup
  repo; `fixB` = second registered repo. Call graph: `subHelper` (in
  `src/util.ts`) is called by `helper`, `useSub`, and imported by `a.ts`.
- Ports below are OS-assigned (`--port 0`); values are illustrative of a run.

## Preconditions (build & shipped contract)

```
$ npm run build          # tsc + copy-assets
$ cmp dist/server/openapi.yaml src/server/openapi.yaml
```

- `dist/server/openapi.yaml` **PRESENT + byte-identical to src** (13560 bytes) —
  copy-assets ships the contract (Constitution VII). **PASS**

---

## Scenario 1 — read the graph over HTTP (SC-001, FR-004/005/008)

```
$ node dist/bin/codegraph.js serve --web --port 0 --path <fixA> &
   -> CodeGraph web server listening on http://127.0.0.1:61169
```

| Request | Actual output | Verdict |
|---|---|---|
| `GET /api/status` | `{"version":"1.4.1","repo":{"id":"abf9f772034ff2e9","name":"fixA"},"index":{"state":"indexed","fileCount":2,"nodeCount":7,"edgeCount":10,"lastIndexed":"2026-07-11T22:40:41.415Z"}}` | PASS |
| `GET /api/search?q=subHelper` | `{"total":2,"limit":100,"offset":0,"names":["subHelper","./src/util"]}` | PASS |
| `GET /api/node/:id` (subHelper) | `{"id":"function:95a3e23e…","kind":"function","name":"subHelper","file":"src/util.ts","line":1}` | PASS |
| `GET /api/callers/:id` | `{"total":3,"names":["helper","useSub","a.ts"]}` | PASS |
| `GET /api/graph/:id` | `{"nodes":5,"edges":4,"truncated":false}` | PASS |
| `GET /api/node/file:src%2Futil.ts` (FR-004a %2F round-trip) | `{"id":"file:src/util.ts","kind":"file"}` | PASS |
| `GET /api/node/function:00…00` (unknown id) | `404 {"error":{"code":"not_found","message":"Not found.","details":{"resource":"node"}}}` | PASS |

**Verdict: PASS** — reads resolve against the shared warm daemon index with zero
files read by hand; paged lists, subgraph shape, `%2F` round-trip, and the 404
`resource:node` all conform.

---

## Scenario 2 — multi-repo discovery + lazy attach (US2, FR-009/010/011)

```
# fixB daemon started with CODEGRAPH_DAEMON_INTERNAL=1 so it binds + registers
$ node dist/bin/codegraph.js serve --mcp --path <fixB> &     # idB registered
$ curl .../api/repos ; curl '.../api/search?q=useSub&repo=<id>'
```

| Request | Actual output | Verdict |
|---|---|---|
| `GET /api/repos` | `{"count":15,"defaults":1,"fixA":{"id":"f6f532bc68e6658d","name":"fixA","default":true},"fixB":{"id":"b4373a255325c1bd","name":"fixB","default":false}}` | PASS |
| `GET /api/search?q=useSub&repo=<A>` | `["useSub"]` | PASS |
| `GET /api/search?q=useSub&repo=<B>` (lazy attach B) | `200 ["useSub"]` | PASS |
| `GET /api/search?q=x&repo=0123456789abcdef` (unregistered) | `404 {"error":{"code":"not_found",…,"details":{"resource":"repo"}}}` | PASS |

**Verdict: PASS** — the startup repo is `default:true` and exactly one default is
present; a `?repo=<second>` read lazily attaches that repo's daemon on demand and
returns ITS data; an unregistered id is 404 `resource:repo`. (The registry is
global, so `/api/repos` also lists this machine's other live daemons — `count:15`
here — which is expected; the assertion is CONTAINS the two fixtures, not EQUALS.)

---

## Scenario 3 — safe-by-default binding + token auth (SC-002/003, FR-012/013/014)

**3a — non-loopback bind without a token is fail-closed:**

```
$ (unset CODEGRAPH_SERVER_TOKEN) node dist/bin/codegraph.js serve --web --host 0.0.0.0 --port 0 --path <fixA>
   -> ✗ Failed to start server: Refusing to start the CodeGraph web server:
        binding to non-loopback host "0.0.0.0" requires CODEGRAPH_SERVER_TOKEN
        to be set (fail-closed, FR-013).
   exit=1 ; bound-a-port? none (process exited, nothing bound)
```
**PASS** — startup refused, no port bound.

**3b — Host-header allowlist (DNS-rebinding defense), even on loopback:**

```
$ curl -H 'Host: evil.example:61169' http://127.0.0.1:61169/api/status
   -> 400 {"error":{"code":"invalid_request","message":"Invalid Host header","details":{"header":"Host"}}}
$ curl http://127.0.0.1:61169/api/status                 # default Host 127.0.0.1
   -> 200
```
**PASS** — a non-allowlisted `Host` is 400 `invalid_request`; the allowlisted Host is 200.

**3c — token auth on a non-loopback bind:**

```
$ CODEGRAPH_SERVER_TOKEN=secret123 node dist/bin/codegraph.js serve --web --host 0.0.0.0 --port 0 --path <fixA> &
   -> listening on http://0.0.0.0:61193
$ curl http://127.0.0.1:61193/api/status                                  -> 401 {"error":{"code":"unauthorized","message":"Unauthorized."}}
$ curl -H 'Authorization: Bearer nope'      http://127.0.0.1:61193/api/status  -> 401
$ curl -H 'Authorization: Bearer secret123' http://127.0.0.1:61193/api/status  -> 200
```
**PASS** — with a token on a network bind, `/api/*` without/with a wrong Bearer is
401 (generic body), and the valid Bearer is 200.

**Verdict: PASS (all three sub-cases).**

---

## Scenario 4 — static placeholder + strict fallback (FR-017/017a/018/019)

| Request | Actual output | Verdict |
|---|---|---|
| `GET /` (no `dist/web/` shipped) | placeholder HTML: `<title>CodeGraph</title> … The web interface has not been built yet … <a href="/api/status">` | PASS |
| CORS headers on `/` | none (`no access-control-* headers`) | PASS |
| `GET /api/nope` (unknown /api) | `404 {"error":{"code":"not_found",…,"details":{"resource":"route"}}}` | PASS |
| `GET /app.js` (missing asset) | `404 {"error":{"code":"not_found",…,"resource":"route"}}` — no shell fallback | PASS |
| `GET /some/route` (extensionless) | `200` app shell (`<!doctype html>` placeholder) | PASS |
| `GET /%2e%2e%2f%2e%2e%2fetc%2fpasswd` (FR-017b traversal) | `404 {"error":{"code":"not_found",…,"resource":"route"}}` — never file bytes | PASS |

**Verdict: PASS** — data-free placeholder at `/`, no CORS on any response, strict
`/api` 404 envelope, missing assets 404 (no shell), extensionless → shell, and a
traversal probe is an ordinary 404 route miss.

---

## Scenario 5 — contract honesty (SC-005, FR-025)

```
$ env -u CODEGRAPH_EMBEDDING_URL … npx vitest run __tests__/server-openapi-contract.test.ts
   -> Test Files  1 passed (1)
      Tests  35 passed (35)          # 2.76s
```

**Verdict: PASS** — the T029 contract walk stands up a fixture server on `--port 0`
and walks every documented path×method×status (2xx shapes + non-2xx envelope +
503/Retry-After + 400 params + FR-004a + FR-017b) and the inverse route table
(no undocumented routes). Zero mismatches.

---

## Scenario 6 — dormancy (SC-006, FR-001, Constitution VII)

```
$ node dist/bin/codegraph.js serve --web --mcp
   -> ✗ Choose one server mode: pass --web (HTTP) or --mcp (stdio), not both.   exit=1
$ node dist/bin/codegraph.js serve                # bare serve
   -> CodeGraph MCP Server / ℹ Use --mcp flag to start the MCP server   (no 'listening on http'; nothing binds)
$ node dist/bin/codegraph.js --help | grep -iE 'serve command / --web'
   -> (absent — `serve` is hidden, `--web` is not advertised)
```

**Verdict: PASS** — `--web --mcp` is refused with the choose-one error; bare
`serve` prints the unchanged info block and binds nothing; the top-level `--help`
neither lists the hidden `serve` command nor advertises `--web`.

---

## Scenario 7 — clean lifecycle (FR-026)

```
-- 7a: SIGTERM --
$ node … serve --web --port 0 --path <fixB> &   -> bound 61200 ; /api/status = 200
$ (SIGTERM the server)                          -> /api/status = 000 (connection refused — port released)

-- 7b: EADDRINUSE --
$ node … serve --web --port 0 …   -> first bound 61206
$ node … serve --web --port 61206 …
   -> ✗ Failed to start server: Cannot start the CodeGraph web server: port 61206
        on 127.0.0.1 is already in use. Choose a free port with --port <n>, or
        --port 0 for an OS-assigned one.
   exit=1 ; first server still serving = 200 (no half-open listener)

-- 7c: re-bind after close --
$ (stop first server) ; node … serve --web --port 61206 …
   -> re-bound 61206 ; /api/status = 200
```

**Verdict: PASS** — SIGTERM stops the server and releases the port; a busy port
yields a clear `EADDRINUSE` error naming the port + suggesting `--port`, exits
non-zero, and leaves the original server intact; the port re-binds after close.

---

## Slice-2 scenarios (8–11) — N/A-slice-2

Scenarios 8 (trigger + SSE progress), 9 (single active job / 409), 10 (lock
contention + watcher restore), and 11 (shutdown-abort) exercise the `/api/reindex`
jobs surface, which is **Slice 2 (US3)** and out of scope for this Slice-1
validation. **N/A-slice-2.**

## Summary

| Scenario | Slice | Verdict |
|---|---|---|
| 1 — read over HTTP | 1 | **PASS** |
| 2 — multi-repo + lazy attach | 1 | **PASS** |
| 3 — safe-by-default bind + token auth | 1 | **PASS** |
| 4 — static placeholder + strict fallback | 1 | **PASS** |
| 5 — contract honesty (contract walk) | 1 | **PASS** |
| 6 — dormancy | 1 | **PASS** |
| 7 — clean lifecycle | 1 | **PASS** |
| 8–11 — re-index jobs | 2 | N/A-slice-2 |

**All Slice-1 quickstart scenarios (1–7) pass against the built binary.**
