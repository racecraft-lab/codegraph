# Contract: SPEC-018 Chat Adapter

## Scope

SPEC-006 adds a same-origin backend chat surface over the existing SPEC-018 LLM layer. The browser never receives provider URL, model, key, provider bearer token, raw provider response body, or secret surrogate. The backend owns graph-context assembly, prompt construction, endpoint invocation, fallback, and agent-bundle handling.

## Routes

### `GET /api/chat/status?repo=<repo-id>`

Returns backend-owned chat readiness for the selected repo.

Response shape:

```json
{
  "state": "enabled",
  "message": "Endpoint mode is configured. Browser requests remain same-origin.",
  "providerConfigured": true,
  "repo": "repo-id"
}
```

Allowed `state` values:

- `enabled`
- `dormant`
- `misconfigured`
- `disabled`
- `rate_limited`

Rules:

- Provider URL, model, key, bearer token, raw response body, and activation values are never serialized.
- `repo` is opaque and resolved by the backend.

### `POST /api/chat/messages`

Submits a graph-grounded chat request.

Request shape:

```json
{
  "repo": "repo-id",
  "message": "Where is request routing handled?",
  "selectedNodeId": "optional-node-id",
  "view": "graph"
}
```

Response shape:

```json
{
  "state": "answer",
  "answer": "Backend-generated answer or fallback text.",
  "bundleHandle": null,
  "context": {
    "repo": {
      "id": "repo-id",
      "name": "codegraph"
    },
    "view": "graph",
    "selectedNodeId": "optional-node-id",
    "symbols": [],
    "files": [],
    "truncated": false,
    "insufficiencyReason": null
  }
}
```

Allowed `state` values:

- `answer`
- `fallback`
- `pending_bundle`
- `disabled`
- `dormant`
- `misconfigured`
- `rate_limited`
- `error`

Rules:

- Browser request carries only repo id, message, selected symbol, and view.
- Backend assembles graph context from existing CodeGraph APIs or direct library access.
- Endpoint mode may call the configured provider only from the backend.
- Agent mode returns fallback text plus an opaque `bundleHandle` when SPEC-018 emits a pending bundle.
- Disabled, dormant, misconfigured, and rate-limited states render honest UI states and do not ask the browser for provider keys.

### `GET /api/chat/bundles/{handle}?repo=<repo-id>`

Reads a SPEC-018 agent-bundle redemption state through the backend.

Response shape:

```json
{
  "state": "pending_bundle",
  "message": "Agent bundle is still pending.",
  "bundleHandle": "opaque-handle"
}
```

Allowed `state` values:

- `answer`
- `pending_bundle`
- `error`

Rules:

- `handle` is opaque and validated by the backend against SPEC-018 containment rules.
- Completed responses return `state: "answer"` with safe completed text in `answer`.
- Pending bundles return `state: "pending_bundle"` with the same opaque `bundleHandle`.
- Missing bundles use the standard CodeGraph `not_found` error envelope.

## SPEC-018 Result Mapping

- SPEC-018 endpoint generation results map to `state: "answer"` with safe `answer` text and context-boundary metadata.
- SPEC-018 pending-bundle results map to `state: "pending_bundle"` with safe fallback text, an opaque `bundleHandle`, and context-boundary metadata.
- SPEC-018 fallback results map to `state: "fallback"` unless the adapter can classify a more specific visible state such as `disabled`, `dormant`, `misconfigured`, or `rate_limited`.
- Dormant and misconfigured SPEC-018 states must not trigger provider calls or agent-bundle writes.
- Endpoint failures degrade through SPEC-018 fallback behavior; bundle emission failures degrade to fallback without exposing filesystem errors.

## Error Handling

- Expected chat readiness or generation states may be success-shaped responses when they are safe for the browser to render, including disabled, dormant, misconfigured, rate-limited, fallback, pending-bundle, and endpoint-fallback states.
- Malformed `repo`, empty or invalid `message`, invalid optional fields, unknown repos, unknown bundle handles, non-loopback authorization failures, and backend faults use the existing CodeGraph error envelope instead of a browser-only error protocol.
- Adapter route errors use the existing CodeGraph error envelope.
- Provider failures degrade through SPEC-018 fallback where possible.
- Backend logs may include local diagnostic summaries but must not log provider secrets or browser tokens.

## Acceptance Checks

- Unit tests verify no provider config fields are serialized to browser responses.
- Contract tests verify dormant, misconfigured, enabled endpoint/agent modes, fallback, pending-bundle, completed-bundle, and backend-error states.
- Contract tests verify malformed request, unknown repo or bundle, unauthorized, unavailable, and sanitized internal fault envelopes.
- Network inspection in Playwright verifies browser calls stay same-origin and no direct provider request is made by the browser.
