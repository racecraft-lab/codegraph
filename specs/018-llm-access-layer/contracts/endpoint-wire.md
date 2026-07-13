# Contract: OpenAI-compatible chat-completions wire behavior

**Surface**: harness/adapter (`src/llm/client.ts`, `LlmEndpointClient`). **Slice**: 1. Built on the
platform's global `fetch` + `AbortSignal` — no new dependency (FR-020). Mirrors
`EndpointProvider` (retry/backoff/redaction) with a chat-completion payload and generation-sized
deadlines.

## Request (FR-015 — minimal body)

`POST <CODEGRAPH_LLM_URL>` with `content-type: application/json`, and `authorization: Bearer <key>`
only when a key is configured.

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
  `data: [DONE]`; return the single assembled string. Streaming is an **internal transport detail** —
  the seam returns one final `GenerationResult`; no `onChunk`/iterator/partial channel exists.

## Deadlines (FR-017)

| Mode | Deadline | Constant |
|---|---|---|
| non-streaming | flat total-request deadline (`AbortSignal.timeout`) | `DEFAULT_TOTAL_TIMEOUT_MS` = 300_000 (band 120–600 s) |
| streaming | inter-chunk idle deadline: timer reset on every chunk; abort on sustained silence, never a flat whole-stream cap | `DEFAULT_IDLE_TIMEOUT_MS` = 45_000 (band 30–60 s) |

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
totalTimeoutMs?, idleTimeoutMs?, maxOutputTokens? }` — mirrors `EndpointProviderOverrides`. Tests
drive a local `http.createServer` fake (embeddings-endpoint precedent), never a live endpoint.
