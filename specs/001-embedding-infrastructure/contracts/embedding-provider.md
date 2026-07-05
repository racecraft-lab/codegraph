# Contract: EmbeddingProvider interface + OpenAI-compatible HTTP wire shape

Two layered contracts: the **TypeScript provider interface** that downstream specs
(SPEC-002 bundled model, SPEC-003 retrieval) consume, and the **HTTP wire shape** the
one shipped implementation (`EndpointProvider`) speaks. Plus the deterministic input
composition the pass feeds the provider.

## 1. Provider interface (`src/embeddings/provider.ts`)

```ts
interface EmbeddingProvider {
  /** Stable identifier of the active model (== EmbeddingConfig.model for the endpoint provider). */
  readonly id: string;

  /** Vector dimension. Known after the first successful batch (inferred) or from config. */
  readonly dims: number;

  /**
   * Embed a batch of composed input strings, preserving order.
   * Resolves to one Float32Array per input, each of length `dims`.
   * Rejects on unrecoverable endpoint failure AFTER the bounded retry budget (D5).
   */
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

**Guarantees**:

- Output order matches input order (index i → vector i).
- Every returned `Float32Array` has length `dims`; a length conflict with the enforced
  dimension is surfaced as an actionable error naming `CODEGRAPH_EMBEDDING_DIMS`
  (FR-021).
- `embed` batches, bounds concurrency, applies a per-request timeout, and retries per
  D5 internally; a rejection means the batch is unrecoverable (→ advisory pass abort).

## 2. HTTP wire shape (`EndpointProvider` → OpenAI-compatible `/embeddings`)

### Request

```http
POST {CODEGRAPH_EMBEDDING_URL}          # e.g. .../v1/embeddings
Content-Type: application/json
Authorization: Bearer {CODEGRAPH_EMBEDDING_API_KEY}   # omitted entirely when keyless
```

```json
{
  "model": "{CODEGRAPH_EMBEDDING_MODEL}",
  "input": ["<composed input 1>", "<composed input 2>", "..."]
}
```

- `input` is a batch of up to `batchSize` (default 16) composed strings.
- Request carries `AbortSignal.timeout(timeoutMs)` (default 30,000 ms).
- No vendor-specific fields are sent or required (vendor-neutral; Constitution "License
  hygiene").

### Success response (HTTP 200)

```json
{
  "data": [
    { "index": 0, "embedding": [0.0123, -0.045, "..."] },
    { "index": 1, "embedding": [0.067,  0.0011, "..."] }
  ],
  "model": "…",
  "usage": { "prompt_tokens": 0, "total_tokens": 0 }
}
```

- Only `data[*].embedding` (an array of numbers) is consumed; each becomes a
  `Float32Array`. Results are re-ordered by `index` (or positional if `index` absent).
- **Dimension inference**: on the first successful batch, `dims = embedding.length`;
  persisted to `project_metadata.embedding_dims` (D9). Every subsequent vector must
  match (FR-021).

### Error responses

| Condition | Handling |
|---|---|
| HTTP 5xx | Retry per D5 (backoff + jitter); on exhaustion → reject → advisory pass abort. |
| HTTP 429 | Retry per D5, honoring `Retry-After` (capped ~30 s); on exhaustion → reject. |
| Timeout / network error | Treated as endpoint failure → retry per D5 → reject on exhaustion. |
| HTTP 401/403 (key required but missing/wrong) | Non-retryable endpoint failure — abort the pass fast, without exhausting the retry budget (same bucket as 400/404/422); still advisory, never a fatal index error (FR-003/FR-019). |
| HTTP 400/404/422 (malformed request / wrong path) | Non-retryable — fast advisory abort, no retry budget consumed (FR-019). |
| Vector length ≠ enforced dims | Actionable error naming `CODEGRAPH_EMBEDDING_DIMS`; pass fails advisorily (FR-021). |

In every failure path the enclosing index/sync **still reports success** (FR-014).

## 3. Deterministic embedding-input composition (D11 / FR-007)

The pass composes each symbol's input before calling `embed`; the provider itself is
input-agnostic. Composition is deterministic and character-capped:

```text
composed := join in fixed order:
  "kind: {kind}"
  "name: {name}"
  "signature: {signature}"        # when present
  "doc: {docstring}"              # when present
  "source:\n{snippet}"            # trimmed last, to fit the cap

cap := ~6,000 characters total (snippet trimmed to fit; other fields never dropped)
input_hash := sha256(composed)   # hex; drives change detection (FR-008)
```

**Guarantee**: identical symbol content (same kind/name/signature/docstring/snippet)
always yields byte-identical `composed` text and therefore an identical `input_hash`,
across sync and re-index (FR-007/FR-008). The cap is a fixed constant — no tokenizer
(FR-025).

## Verification

- Unit: interface conformance (order preserved, length == dims); input composition is
  deterministic and stable under the cap (`embeddings-input-hash.test.ts`).
- Integration (mock endpoint, `embeddings-endpoint.test.ts`): success + inference;
  keyless vs `Authorization`-header path; 5xx/429 retry→success and retry→exhaustion;
  timeout; dimension-conflict error names `CODEGRAPH_EMBEDDING_DIMS`.
