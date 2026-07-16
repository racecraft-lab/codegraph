# Server - Local Rules

Full detail: root `AGENTS.md` and `src/server/openapi.yaml`.

- The web server is dormant unless launched with `serve --web`.
- Preserve loopback-only packaged UI serving and pre-listen rejection for
  non-loopback binds until browser-compatible API/SSE session auth exists.
- Keep API behavior, OpenAPI, REST mirrors, and tests in sync.
- Static asset serving must preserve path containment; do not weaken traversal
  protections for convenience.
- Re-index jobs, SSE, and WebSocket surfaces need lifecycle tests for cleanup
  and cancellation behavior.
