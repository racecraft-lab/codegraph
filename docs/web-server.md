# Local HTTP Server & REST API

CodeGraph can expose your indexed project over a small **local REST API**, so
tools, scripts, and dashboards can query the graph over HTTP instead of the CLI
or MCP. It serves the same read intelligence CodeGraph already builds — symbol
search, node detail, callers/callees, impact, and graph neighborhoods — plus
re-index jobs with live progress.

## Starting the server

```bash
codegraph serve --web
```

This starts an HTTP server bound to **`127.0.0.1:11235`** (loopback only) for the
project in the current directory. The project must already be initialized
(`codegraph init`) so it has an index to serve. Press `Ctrl+C` to stop; the
server also shuts down cleanly on `SIGTERM`.

### Flags

| Flag | What it does | Default |
|------|--------------|---------|
| `--web` | Run as a local HTTP server (instead of the MCP stdio server) | — |
| `--host <host>` | Bind address. Any non-loopback host requires a token (see below) | `127.0.0.1` |
| `--port <port>` | Bind port | `11235` |
| `--port 0` | Bind an OS-assigned ephemeral port — the actual port is printed on startup | — |
| `-p, --path <path>` | Serve a different project directory | current directory |

On startup the server prints the address it bound to, e.g.:

```
CodeGraph web server listening on http://127.0.0.1:11235
Press Ctrl+C to stop.
```

When you pass `--port 0`, read the printed line to discover the assigned port.

## Security

The server is **loopback-first and fail-closed**:

- **Loopback (the default `127.0.0.1`)** serves with no authentication — it is
  only reachable from your own machine.
- **Any non-loopback host** (binding `--host 0.0.0.0`, a LAN address, etc.)
  **requires an authentication token**. Set it in the environment:

  ```bash
  export CODEGRAPH_SERVER_TOKEN=your-secret-token
  codegraph serve --web --host 0.0.0.0
  ```

  If you bind a non-loopback host **without** `CODEGRAPH_SERVER_TOKEN`, the
  server refuses to start — nothing binds. This is deliberate: it is never
  possible to expose the API off-machine unauthenticated.

- When a token is set, every `/api/*` request must send it as a **Bearer**
  header:

  ```bash
  curl -H "Authorization: Bearer $CODEGRAPH_SERVER_TOKEN" \
    http://your-host:11235/api/status
  ```

  On a loopback bind the token is a no-op — Bearer auth is not enforced.

- Every request's **`Host` header is validated** against an allowlist for the
  address the server bound to. A request with an unexpected `Host` is rejected,
  which protects the loopback server from DNS-rebinding attacks by other pages in
  your browser.

## Endpoints

All responses are JSON. Read endpoints accept an optional **`?repo=<id>`** query
parameter to target a specific indexed project (the `id` comes from
`/api/repos`); omit it to use the project the server was started for.
`/api/status` and `/api/repos` are not repo-scoped and ignore `?repo`.

### Read

| Method & path | Purpose |
|---------------|---------|
| `GET /api/status` | Server version and index health/counts for the default project |
| `GET /api/repos` | The indexed projects the server can address; the startup project is the default |
| `GET /api/search?q=<text>&mode=<mode>` | Symbol search. `mode` is one of `keyword`, `semantic`, `hybrid`, `auto` (default `auto`) |
| `GET /api/node/:id` | One symbol's detail (source + call trail) |
| `GET /api/callers/:id` | What calls a symbol |
| `GET /api/callees/:id` | What a symbol calls |
| `GET /api/impact/:id?depth=<n>` | What is affected by changing a symbol |
| `GET /api/graph/:id?depth=<n>&limit=<n>` | The graph neighborhood around a symbol |

Symbol ids can contain characters that must be URL-encoded when placed in the
path.

### Re-index jobs

| Method & path | Purpose |
|---------------|---------|
| `POST /api/reindex/:repo` | Start an incremental sync (default) or a full rebuild with `?full=true`. Returns **202** with a job descriptor. Only re-indexes projects already in the registry; never initializes a new one |
| `GET /api/reindex/:repo` | The latest job's state for that project (readable after it finishes) |
| `GET /api/reindex/:repo/events` | A **Server-Sent Events** stream of that project's job progress — a snapshot, then progress events, then one terminal event |

Only one job runs per project at a time; starting a second while one is active
returns **409**.

Stream progress with `curl -N`:

```bash
# Kick off an incremental re-index
curl -X POST http://127.0.0.1:11235/api/reindex/<repo-id>

# Follow live progress until the terminal event
curl -N http://127.0.0.1:11235/api/reindex/<repo-id>/events
```

## OpenAPI specification

The full API contract ships with CodeGraph as an OpenAPI document at
**`server/openapi.yaml`** inside the installed package (in a source build,
`dist/server/openapi.yaml`). Point any OpenAPI-aware client or code generator at
it for the complete request/response schemas.

## Note

Visiting `/` in a browser currently returns a small placeholder page — a
built-in web UI is planned for a future release. Until then, the REST API above
is the interface.
