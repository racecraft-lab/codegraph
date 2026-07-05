---
name: embedding-endpoint-provider
description: SPEC-001 EndpointProvider (src/embeddings/endpoint-provider.ts) design facts — retry budget, redaction, fetch credential-URL quirk
metadata:
  type: project
---

`src/embeddings/endpoint-provider.ts` (`EndpointProvider implements EmbeddingProvider`) is the OpenAI-compatible HTTP embedding client for SPEC-001 (Slice A, tasks T014 RED / T015 GREEN).

**Why:** the provider is the seam SPEC-002/003 consume; correctness of retry/redaction is load-bearing and was pinned by contract `specs/001-embedding-infrastructure/contracts/embedding-provider.md`.

**How to apply — non-obvious facts that will bite a future edit:**
- Retry budget = `maxRetries` retries AFTER the initial attempt. Default 3 ⇒ **4 total HTTP requests** on a persistently-failing endpoint (the exhaustion test asserts `requests.length === 4`). Fast-abort (400/401/403/404/422) and malformed-200 ⇒ **1 request** (no budget consumed).
- Node's global `fetch` (undici) **throws synchronously** on a URL with userinfo credentials: `TypeError: Request cannot be constructed from a URL that includes credentials: http://user:secret@...` — the raw message **leaks the creds**. So userinfo URLs never reach a server; they're only usable to test transport-failure redaction. FULL ERROR REPLACEMENT reads only `raw.name`, never `.message/.cause/.stack`, and constructs a fresh `EmbeddingEndpointError` from `redactEndpoint(url)` (scheme+host+port) — never sets `cause`, never echoes the response body.
- Backoff: full jitter `random(0, min(base*2^attempt, cap))`, base 1000ms / cap ~8000ms prod; `Retry-After` (429) honored and capped ~30000ms. Constructor takes optional `EndpointProviderOverrides {baseDelayMs,maxDelayMs,retryAfterCapMs,maxRetries}` so tests inject tiny delays.
- `dims` starts `config.dims ?? 0` (0 = unknown), inferred on first successful vector, then enforced per-vector; a conflict returns a non-retryable failure whose message names `CODEGRAPH_EMBEDDING_DIMS`. **A length-0 embedding is REJECTED in `validate` (pre-PR FIX 5) BEFORE `reconcileDims`** — otherwise reconcileDims reads length 0 as the "unknown" sentinel and silently latches dims=0. So `[]` from the endpoint = non-retryable validation failure, not an inferred dimension.
- **Body read vs JSON parse are SEPARATE trys (pre-PR FIX 3):** `await response.text()` has its OWN try → a transport failure mid-body (200 headers received, socket reset during the body) returns `{retryable:true}` (network error); only a fully-received-but-invalid body hits the JSON-parse try → `{retryable:false}` ('not valid JSON'). Before the split, a mid-body reset was miscaught by the JSON try and fast-aborted. Test technique: node:http mock sends 200 + `content-length` bigger than sent + a partial body, then `setTimeout(()=>res.socket.destroy(),20)` — the DELAY is load-bearing (a synchronous destroy makes `fetch()` itself reject, which is already retryable and misses the FIX-3 path).
- Reuses `redactEndpoint` from [[embedding-config]] `src/embeddings/config.ts` — do not duplicate redaction.
