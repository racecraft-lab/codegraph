# Local Web UI & REST API

CodeGraph can expose your indexed project through a packaged **local web UI**
and the same **local REST API**. The browser app lets you inspect repository
status, search symbols, open symbol detail pages, explore graph neighborhoods,
review impact radius, watch re-index jobs, and use graph-grounded chat states.
The REST API serves the same read intelligence for tools, scripts, and
dashboards.

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

## Built-in web UI

Visiting `/` opens the packaged graph browser. Extensionless browser routes such
as `/search`, `/symbol/<id>`, `/graph/<id>`, `/impact/<id>`, `/reindex`, and
`/chat` serve the same SPA shell so refreshes and direct links work.

Static assets ship from the installed package under `dist/web/`. The runtime app
does not require a CDN, hosted asset server, hosted auth/database service, remote
telemetry endpoint, or direct browser call to an LLM provider. Missing asset
URLs with file extensions return `404`; they do not silently fall back to the
SPA shell.

The API namespace stays separate from browser fallback: `/api/*` always returns
JSON API responses or JSON API errors, never `index.html`.

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

  On a loopback bind the token is a no-op — Bearer auth is not enforced. Static
  shell serving does not weaken API auth; token enforcement remains on `/api/*`.

- Every request's **`Host` header is validated** against an allowlist for the
  address the server bound to. A request with an unexpected `Host` is rejected,
  which protects the loopback server from DNS-rebinding attacks by other pages in
  your browser.

## Endpoints

All responses are JSON, except the events endpoint
(`GET /api/reindex/:repo/events`), which is a Server-Sent Events stream
(`text/event-stream`). Read endpoints accept an optional **`?repo=<id>`** query
parameter to target a specific indexed project (the `id` comes from
`/api/repos`); omit it to use the project the server was started for.
`/api/status` and `/api/repos` are not repo-scoped and ignore `?repo`.

### Read

| Method & path | Purpose |
|---------------|---------|
| `GET /api/status` | Server version and index health/counts for the default project |
| `GET /api/repos` | The indexed projects the server can address; the startup project is the default |
| `GET /api/search?q=<text>&mode=<mode>` | Symbol search. `mode` is one of `keyword`, `semantic`, `hybrid`, `auto` (default `auto`) |
| `GET /api/node/:id` | One symbol's own fields (identity, kind, name, location, signature, doc); relationships come from `callers`/`callees`/`impact`/`graph` |
| `GET /api/callers/:id` | What calls a symbol |
| `GET /api/callees/:id` | What a symbol calls |
| `GET /api/impact/:id?depth=<n>` | What is affected by changing a symbol |
| `GET /api/graph/:id?depth=<n>` | The graph neighborhood around a symbol |

### Chat

Browser chat uses same-origin backend routes over the configured local LLM
layer. Provider URLs, models, API keys, bearer tokens, and raw provider response
bodies are not sent to the browser.

| Method & path | Purpose |
|---------------|---------|
| `GET /api/chat/status` | Current chat availability: enabled, dormant, misconfigured, disabled, or rate-limited |
| `POST /api/chat/messages` | Ask a graph-grounded question with repo, selected symbol, and view hints |
| `GET /api/chat/bundles/:handle` | Redeem or inspect an agent-mode bundle handle emitted by chat |

Symbol ids can contain characters that must be URL-encoded when placed in the
path.

### Re-index jobs

| Method & path | Purpose |
|---------------|---------|
| `POST /api/reindex/:repo` | Start an incremental sync (default) or a full rebuild with `?full=true`. Returns **202** with a job descriptor. Only re-indexes projects already in the registry; never initializes a new one |
| `GET /api/reindex/:repo` | The latest job's state for that project (readable after it finishes) |
| `GET /api/reindex/:repo/events` | A **Server-Sent Events** stream of that project's job progress — a snapshot, then progress events, then one terminal event. A fast or already-finished job may deliver the terminal status inside the initial snapshot and close, so clients must not block waiting for a separate `done`/`error` event |

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

## Package validation

`npm run build` copies the browser output into `dist/web/` and fails if
`dist/web/index.html` is missing. Use `codegraph serve --web --path <repo>` to
validate the packaged app exactly as users receive it.
