# Contract: Embedding Configuration (`CODEGRAPH_EMBEDDING_*`)

The user-facing activation surface, sourced from environment variables and parsed in
`src/embeddings/config.ts`. This is a **configuration contract** — the variable names,
types, defaults, validation, activation rule, and redaction behavior are stable and
downstream-observable. Values are never persisted (FR-023/D16).

## Variables

| Variable | Type | Required | Default | Validation / behavior |
|---|---|---|---|---|
| `CODEGRAPH_EMBEDDING_URL` | string | to activate | — | Non-empty. Base URL of an OpenAI-compatible embeddings endpoint. |
| `CODEGRAPH_EMBEDDING_MODEL` | string | to activate | — | Non-empty. Model name sent in each request. |
| `CODEGRAPH_EMBEDDING_API_KEY` | string | no | unset | Optional (keyless local endpoints work). Sent as `Authorization: Bearer <key>`. **Never** persisted, logged, or echoed. |
| `CODEGRAPH_EMBEDDING_DIMS` | positive int | no | inferred | When unset, inferred from the first successful batch and persisted; when set, enforced from the start. |
| `CODEGRAPH_EMBEDDING_BATCH_SIZE` | positive int | no | `16` | Parsed via the positive-int-clamp precedent (`resolveParsePoolSize`); invalid/blank → default. |
| `CODEGRAPH_EMBEDDING_CONCURRENCY` | positive int | no | `4` | Parsed + clamped as above. |
| `CODEGRAPH_EMBEDDING_TIMEOUT_MS` | positive int | no | `30000` | Per-request `AbortSignal.timeout` budget; parsed + clamped as above. |

## Activation rule (FR-001/FR-002)

```text
active  ⇔  CODEGRAPH_EMBEDDING_URL is non-empty  AND  CODEGRAPH_EMBEDDING_MODEL is non-empty
```

- **Active** → the embed pass is constructed and runs (inline, post-resolution).
- **Inactive (dormant)** → the pass is never constructed: zero network requests, zero
  `node_vectors` writes, zero new log lines — byte-identical to a build without the
  feature (SC-002). Setting only one of URL/MODEL stays dormant (edge case).

## Parsed configuration shape (in-memory only)

```ts
interface EmbeddingConfig {
  url: string;            // required to be active
  model: string;          // required to be active
  apiKey?: string;        // optional; memory-only
  dims?: number;          // optional; undefined ⇒ infer from first batch
  batchSize: number;      // default 16, clamped
  concurrency: number;    // default 4, clamped
  timeoutMs: number;      // default 30000, clamped
}

// Returns null when dormant (URL or MODEL missing) — the null return IS the dormancy signal.
function loadEmbeddingConfig(env: NodeJS.ProcessEnv): EmbeddingConfig | null;
```

## Redaction contract (FR-023 / D16)

- The API key is held in memory only and transmitted solely in the `Authorization`
  header; it appears in **no** persisted file, log line, or error message.
- Any rendering of the endpoint (status output, errors, logs) is redacted to
  **scheme + host + port only** — userinfo, path, and query are stripped. Example:
  `https://user:secret@api.example.com:8443/v1/embeddings?token=abc` →
  `https://api.example.com:8443`.

## Retry/backoff constants (fixed — not configurable, D5)

Documented here for completeness; these are constants in `endpoint-provider.ts`, not
environment variables:

- Base delay 1,000 ms, ×2 growth, full jitter, ~8 s per-delay cap.
- 3 retries per batch (4 attempts total) on 5xx / 429 / timeout / network error.
- Honor `Retry-After` on 429 (capped ~30 s).
- On exhaustion: abort the whole pass advisorily (the enclosing index/sync still
  succeeds).

## Verification

- Unit: parse/validate/clamp each variable; assert dormancy when URL or MODEL is
  missing; assert redaction strips userinfo/path/query (`embeddings-config.test.ts`).
- Integration: a keyless config succeeds against the keyless mock endpoint (Acceptance
  US1-3); the key never appears in any output (SC-007).
