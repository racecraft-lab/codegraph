# Contract: SPEC-018 Chat Adapter

## Scope

SPEC-006 adds a same-origin backend chat surface over the existing SPEC-018 LLM layer. The browser never receives provider URL, model, key, provider bearer token, raw provider response body, or secret surrogate. The backend owns graph-context assembly, prompt construction, endpoint invocation, fallback, and agent-bundle handling.

## Routes

### `GET /api/chat/status?repo=<repo-id>`

Returns backend-owned chat readiness for the selected repo.

Response shape:

```json
{
  "state": "endpoint_active",
  "active": true,
  "mode": "endpoint",
  "pendingBundles": 0,
  "activationVars": ["CODEGRAPH_LLM_URL", "CODEGRAPH_LLM_MODEL"],
  "message": "Chat is available."
}
```

Allowed `state` values:

- `endpoint_active`
- `agent_pending`
- `dormant`
- `misconfigured`
- `endpoint_fallback`
- `rate_limited`
- `unavailable`
- `error`

Rules:

- `activationVars` may name safe environment variable names but never values.
- `pendingBundles` is present only when agent mode exposes a safe count.
- `repo` is opaque and resolved by the backend.

### `POST /api/chat/messages`

Submits a graph-grounded chat request.

Request shape:

```json
{
  "repoId": "repo-id",
  "prompt": "Where is request routing handled?",
  "selectedNodeId": "optional-node-id",
  "view": "graph",
  "contextHints": {
    "nodeIds": ["optional-node-id"],
    "filters": ["callers", "callees"]
  }
}
```

Response shape:

```json
{
  "state": "answer",
  "text": "Backend-generated answer or fallback text.",
  "handle": null,
  "context": {
    "repoId": "repo-id",
    "selectedNodeId": "optional-node-id",
    "includedSymbols": [],
    "includedFiles": [],
    "limits": {
      "symbols": 25,
      "files": 10
    },
    "truncated": false,
    "reason": null
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

- Browser request carries only repo id, prompt, selected symbol, view, and bounded context hints.
- Backend assembles graph context from existing CodeGraph APIs or direct library access.
- Endpoint mode may call the configured provider only from the backend.
- Agent mode returns fallback text plus an opaque `handle` when SPEC-018 emits a pending bundle.
- Disabled, dormant, misconfigured, and rate-limited states render honest UI states and do not ask the browser for provider keys.

### `GET /api/chat/bundles/{handle}?repo=<repo-id>`

Reads a SPEC-018 agent-bundle redemption state through the backend.

Response shape:

```json
{
  "state": "pending",
  "text": null,
  "handle": "opaque-handle"
}
```

Allowed `state` values:

- `completed`
- `pending`
- `missing`
- `error`

Rules:

- `handle` is opaque and validated by the backend against SPEC-018 containment rules.
- Completed responses return safe completed text only.
- Missing or pending bundles are explicit states, not generic failures.

## SPEC-018 Result Mapping

- SPEC-018 endpoint generation results map to `state: "answer"` with safe answer text and context-boundary metadata.
- SPEC-018 pending-bundle results map to `state: "pending_bundle"` with safe fallback text, an opaque `handle`, and context-boundary metadata.
- SPEC-018 fallback results map to `state: "fallback"` unless the adapter can classify a more specific visible state such as `disabled`, `dormant`, `misconfigured`, or `rate_limited`.
- Dormant and misconfigured SPEC-018 states must not trigger provider calls or agent-bundle writes.
- Endpoint failures degrade through SPEC-018 fallback behavior; bundle emission failures degrade to fallback without exposing filesystem errors.

## Error Handling

- Expected chat readiness or generation states may be success-shaped responses when they are safe for the browser to render, including disabled, dormant, misconfigured, rate-limited, fallback, pending-bundle, and endpoint-fallback states.
- Malformed or missing `repoId`, empty or invalid `prompt`, invalid context hints, unknown repos, unknown bundle handles, non-loopback authorization failures, and backend faults use the existing CodeGraph error envelope instead of a browser-only error protocol.
- Adapter route errors use the existing CodeGraph error envelope.
- Provider failures degrade through SPEC-018 fallback where possible.
- Backend logs may include local diagnostic summaries but must not log provider secrets or browser tokens.

## Acceptance Checks

- Unit tests verify no provider config fields are serialized to browser responses.
- Contract tests verify dormant, misconfigured, endpoint-active, endpoint-fallback, pending-bundle, completed-bundle, and backend-error states.
- Contract tests verify malformed request, unknown repo or bundle, unauthorized, unavailable, and sanitized internal fault envelopes.
- Network inspection in Playwright verifies browser calls stay same-origin and no direct provider request is made by the browser.
