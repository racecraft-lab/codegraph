# Contract: OpenAI-compatible chat-completions wire behavior

**Surface**: harness/adapter (`src/llm/client.ts`, `LlmEndpointClient`). **Slice**: 1. Built on the
platform's global `fetch` + `AbortSignal` — no new dependency (FR-020). Mirrors
`EndpointProvider` (retry/backoff/redaction) with a chat-completion payload and generation-sized
deadlines.

## Request (FR-015 — minimal body)

`POST <CODEGRAPH_LLM_URL>` with `content-type: application/json`, and `authorization: Bearer <key>`
only when a key is configured.

**Key transmitted only to the configured host (FR-005)**: `fetch` follows redirects with the platform
default, and the platform drops the `Authorization` header on a **cross-origin** redirect (WHATWG Fetch,
"Remove Authorization header upon cross-origin redirect"; Node's undici already conforms), so a redirect
to a different host never carries the Bearer key. A POSIX test asserts the key is absent from the request
a cross-origin redirect target receives.

```jsonc
{
  "model":  "<CODEGRAPH_LLM_MODEL>",
  "messages": [ /* composed prompt, priority order: instructions > output contract > graph context */ ],
  "stream": true | false,          // per-call (FR-016)
  "max_tokens": 1024               // DEFAULT_MAX_OUTPUT_TOKENS, internal constant
  // temperature omitted → endpoint default
}
```

## Token budget guard (FR-018 / FR-019) — applied before the request

- `estimateTokens(s) = ceil(s.length / CHARS_PER_TOKEN)`, `CHARS_PER_TOKEN = 4`. No external tokenizer.
- Only the graph-context tier is trimmed, to `GRAPH_CONTEXT_CHAR_BUDGET` = 8000 (2000 tokens × 4).
- Trimming drops whole trailing graph-context items, then appends `[context truncated: N of M]`
  (N kept of M total items). Identical input → identical trimmed output (SC-003).
- Never auto-chunk / map-reduce (FR-019).

## Response

- **Non-streaming**: read one JSON body; return `choices[0].message.content`.
- **Streaming** (FR-016a): parse SSE `data:` lines, concatenate `choices[].delta.content`, stop on
  `data: [DONE]` OR on a clean end-of-stream without it; return the single assembled string. Streaming
  is an **internal transport detail** — the seam returns one final `GenerationResult`; no
  `onChunk`/iterator/partial channel exists.
- **Streaming aborted before a clean close** (FR-016a / FR-017): an abort by the idle deadline or any
  mid-stream transport error is an ultimate failure — the partial assembly is **discarded**, the client
  throws `LlmEndpointError` on retry-exhaustion, and `generate()` degrades to the consumer fallback
  (FR-009). A partial assembly is never returned as `endpoint` output.

## Deadlines (FR-017)

| Mode | Deadline | Constant |
|---|---|---|
| non-streaming | flat total-request deadline (`AbortSignal.timeout`) | `DEFAULT_TOTAL_TIMEOUT_MS` = 300_000 (band 120–600 s) |
| streaming | inter-chunk idle deadline: timer reset on every chunk; abort on sustained silence, never a flat whole-stream cap | `DEFAULT_IDLE_TIMEOUT_MS` = 45_000 (band 30–60 s) |

**Response size (hard ceiling — maintainer security-consensus decision, 2026-07-13)**: the assembled
completion is bounded by the deadlines above, the requested `max_tokens` hint, AND a hard total-response-size
ceiling: the body is read as a stream with a byte counter and aborted (existing AbortController) the moment
the ceiling is crossed — a ceiling-exceeded response is an ultimate failure degrading to the consumer
fallback (FR-017/FR-009). Mechanism mirrors the in-repo model-fetch download budget (streamed read +
byte counter + abort-on-exceed). The ceiling is a generous internal constant (tens of MB; e.g.
`MAX_RESPONSE_BYTES = 33_554_432`), test-overridable via the overrides interface, never user-facing (FR-007).
This deliberately hardens beyond the embeddings client's unbounded `response.text()` read.

## Retry (mirror `EndpointProvider` exactly)

Retry 5xx / 429 / timeout / network with exponential backoff + full jitter honoring `Retry-After`;
fast-abort 4xx (400/401/403/404/422). `DEFAULT_MAX_RETRIES` = 3 (→ 4 total requests); base 1000 ms,
max 8000 ms, `Retry-After` cap 30_000 ms. On ultimate failure the client throws `LlmEndpointError`;
`generate()` catches it and degrades to the consumer fallback (FR-009) — the seam never throws.

## Redaction (FR-005)

The only error type leaving the module is `LlmEndpointError` — message + own props are redaction-safe
(endpoint = scheme+host+port, status = bare integer). The raw transport error is read for `.name`
only, never chained as `cause`; no response-body text is ever surfaced. `EmbeddingEndpointError`
precedent.

## Test seam

`LlmEndpointClientOverrides { maxRetries?, baseDelayMs?, maxDelayMs?, retryAfterCapMs?,
totalTimeoutMs?, idleTimeoutMs?, maxOutputTokens?, maxResponseBytes? }` — mirrors
`EndpointProviderOverrides` plus the FR-017 response-size ceiling (`maxResponseBytes?` shrinks
`MAX_RESPONSE_BYTES` so the abort-on-exceed path is testable). Tests drive a local `http.createServer`
fake (embeddings-endpoint precedent), never a live endpoint.
