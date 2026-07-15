# Server - Local Rules

Full detail: root `AGENTS.md` and `src/server/openapi.yaml`.

- The web server is dormant unless launched with `serve --web`.
- Preserve loopback-default behavior and token auth for non-loopback binding.
- Keep API behavior, OpenAPI, REST mirrors, and tests in sync.
- Static asset serving must preserve path containment; do not weaken traversal
  protections for convenience.
- Re-index jobs, SSE, and WebSocket surfaces need lifecycle tests for cleanup
  and cancellation behavior.
