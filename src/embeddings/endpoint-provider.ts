/**
 * EndpointProvider — the one shipped `EmbeddingProvider` (SPEC-001, T015).
 *
 * An OpenAI-compatible HTTP embedding client over the platform's built-in global
 * `fetch` + `AbortSignal.timeout` — no new dependency (FR-025). It batches inputs
 * (`batchSize`), bounds in-flight requests (`concurrency`), applies a per-request
 * timeout, retries retryable failures (5xx / 429 / timeout / network) with
 * exponential backoff + full jitter honoring `Retry-After`, and fast-aborts
 * non-retryable ones (400/401/403/404/422) — all per the wire contract in
 * `specs/001-embedding-infrastructure/contracts/embedding-provider.md` §2 (D5).
 *
 * Redaction is total (FR-023): every error leaving this module is a NEW
 * `EmbeddingEndpointError` built only from redacted strings — the raw transport
 * error (whose message/cause can embed the URL and its credentials) is read for
 * its `.name` alone and then discarded; it is never chained as `cause`, and no
 * response-body text is ever surfaced.
 */
import type { EmbeddingProvider } from './provider';
import type { EmbeddingConfig } from './config';
import { redactEndpoint } from './config';

/** Test-only knobs so retry paths run in milliseconds; production uses the defaults. */
export interface EndpointProviderOverrides {
  /** Base backoff delay in ms (default 1000). */
  baseDelayMs?: number;
  /** Per-delay backoff cap in ms (default 8000). */
  maxDelayMs?: number;
  /** Ceiling applied to a 429 `Retry-After` in ms (default 30000). */
  retryAfterCapMs?: number;
  /** Retry attempts after the initial request (default 3 → 4 total requests). */
  maxRetries?: number;
}

const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 8000;
const DEFAULT_RETRY_AFTER_CAP_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * The only error type this module throws. Its message and every own property are
 * redaction-safe: the endpoint is reduced to scheme+host+port and the status is a
 * bare integer. No raw URL, API key, `cause`, or response body is ever attached.
 */
class EmbeddingEndpointError extends Error {
  readonly endpoint: string;
  readonly status?: number;

  constructor(endpoint: string, reason: string, status?: number) {
    super(`embedding request to ${endpoint} failed: ${reason}`);
    this.name = 'EmbeddingEndpointError';
    this.endpoint = endpoint;
    if (status !== undefined) this.status = status;
  }
}

/** Outcome of a single HTTP attempt: success vectors, or a classified failure. */
type AttemptResult =
  | { ok: true; vectors: Float32Array[] }
  | { ok: false; retryable: boolean; reason: string; status?: number; retryAfterMs?: number };

/** Structural validation of a decoded 200 body. */
type ValidationResult = { ok: true; vectors: Float32Array[] } | { ok: false; reason: string };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) to ms; `undefined` if absent/unparseable. */
function parseRetryAfter(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

export class EndpointProvider implements EmbeddingProvider {
  readonly id: string;

  private _dims: number;
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly redactedEndpoint: string;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly retryAfterCapMs: number;
  private readonly maxRetries: number;

  constructor(config: EmbeddingConfig, overrides: EndpointProviderOverrides = {}) {
    this.id = config.model;
    this._dims = config.dims ?? 0; // 0 = unknown; inferred from the first successful batch
    this.url = config.url;
    this.apiKey = config.apiKey;
    this.batchSize = config.batchSize;
    this.concurrency = config.concurrency;
    this.timeoutMs = config.timeoutMs;
    this.redactedEndpoint = redactEndpoint(config.url);
    this.baseDelayMs = overrides.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = overrides.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.retryAfterCapMs = overrides.retryAfterCapMs ?? DEFAULT_RETRY_AFTER_CAP_MS;
    this.maxRetries = overrides.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /**
   * The inferred/enforced vector dimension, or `0` while it is not yet known — the pass
   * infers it from the first successful batch. `0` is strictly a "dimension unknown"
   * sentinel, never a real embedding width: a length-0 embedding is rejected as a
   * malformed response (see {@link validate}) rather than latched as dims=0.
   */
  get dims(): number {
    return this._dims;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const batches: Array<{ offset: number; texts: string[] }> = [];
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      batches.push({ offset, texts: texts.slice(offset, offset + this.batchSize) });
    }

    const results = new Array<Float32Array>(texts.length);
    let nextBatch = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = nextBatch++;
        if (i >= batches.length) return;
        const batch = batches[i];
        if (batch === undefined) return;
        const vectors = await this.embedBatchWithRetry(batch.texts);
        for (const [k, vec] of vectors.entries()) results[batch.offset + k] = vec;
      }
    };

    // Bound concurrency to in-flight HTTP only: at most `concurrency` workers,
    // never more than there are batches.
    const workerCount = Math.min(this.concurrency, batches.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  /** One batch → one POST, with the D5 retry loop around it. */
  private async embedBatchWithRetry(texts: string[]): Promise<Float32Array[]> {
    for (let attempt = 0; ; attempt++) {
      let outcome: AttemptResult;
      try {
        outcome = await this.attemptBatch(texts);
      } catch (raw) {
        // A raw transport/timeout error. Read ONLY `.name` — never its message,
        // cause, or stack, which can embed the URL and its credentials (FR-023) —
        // then discard it. Timeout and network errors are both retryable.
        const name = raw instanceof Error ? raw.name : '';
        const reason = name === 'TimeoutError' || name === 'AbortError' ? 'request timed out' : 'network or transport error';
        outcome = { ok: false, retryable: true, reason };
      }

      if (outcome.ok) return outcome.vectors;

      const canRetry = outcome.retryable && attempt < this.maxRetries;
      if (!canRetry) throw new EmbeddingEndpointError(this.redactedEndpoint, outcome.reason, outcome.status);

      const delayMs =
        outcome.retryAfterMs !== undefined
          ? Math.min(outcome.retryAfterMs, this.retryAfterCapMs)
          : this.backoffDelay(attempt);
      await delay(delayMs);
    }
  }

  /** A single HTTP attempt. Only the `fetch`/body read may throw (→ transport failure). */
  private async attemptBatch(texts: string[]): Promise<AttemptResult> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey !== undefined) headers['authorization'] = `Bearer ${this.apiKey}`;

    const response = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.id, input: texts }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const status = response.status;
      // Drain the body so the socket is released; its text is never surfaced (FR-023).
      await response.text().catch(() => undefined);
      if (status >= 500) return { ok: false, retryable: true, reason: `endpoint returned HTTP ${status}`, status };
      if (status === 429) {
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        return { ok: false, retryable: true, reason: 'endpoint returned HTTP 429', status, retryAfterMs };
      }
      // 4xx (and any other non-2xx that is neither 5xx nor 429): non-retryable.
      return { ok: false, retryable: false, reason: `endpoint returned HTTP ${status}`, status };
    }

    // Read the body and parse it in SEPARATE try blocks: a failure DURING the read is a
    // transport failure (the socket reset mid-body on an otherwise-200 response), which is
    // RETRYABLE — not the same as a fully-received body that simply isn't valid JSON. Both
    // reference nothing off the caught error, keeping redaction total (FR-023).
    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch {
      // Transport failure while reading the 200 body — retry it like any network error.
      return { ok: false, retryable: true, reason: 'network error reading the response body' };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      // Malformed/non-JSON body that WAS fully received — non-retryable (never echo it).
      return { ok: false, retryable: false, reason: 'response body was not valid JSON' };
    }

    const validated = this.validate(payload, texts.length);
    if (!validated.ok) return { ok: false, retryable: false, reason: validated.reason };
    return { ok: true, vectors: validated.vectors };
  }

  /**
   * Validate the decoded body and extract vectors in input order (FR-021a):
   * data must be an array of exactly `expectedCount` entries; each `embedding` is
   * re-ordered by its `index` (positional fallback) and enforced against `dims`.
   */
  private validate(payload: unknown, expectedCount: number): ValidationResult {
    if (typeof payload !== 'object' || payload === null) {
      return { ok: false, reason: 'response was not a JSON object' };
    }
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data)) return { ok: false, reason: 'response is missing the data array' };
    if (data.length !== expectedCount) {
      return { ok: false, reason: `response returned ${data.length} embeddings for ${expectedCount} inputs` };
    }

    const vectors = new Array<Float32Array>(expectedCount);
    for (let pos = 0; pos < data.length; pos++) {
      const entry = data[pos];
      if (typeof entry !== 'object' || entry === null) return { ok: false, reason: 'response entry was not an object' };
      const rawEmbedding = (entry as { embedding?: unknown }).embedding;
      if (!Array.isArray(rawEmbedding)) return { ok: false, reason: 'response entry is missing an embedding array' };

      const rawIndex = (entry as { index?: unknown }).index;
      const idx = typeof rawIndex === 'number' && Number.isInteger(rawIndex) ? rawIndex : pos;
      if (idx < 0 || idx >= expectedCount) return { ok: false, reason: 'response entry index out of range' };
      if (vectors[idx] !== undefined) return { ok: false, reason: 'response entry index was duplicated' };

      const vec = Float32Array.from(rawEmbedding as number[]);
      // A zero-length embedding is a malformed response, not a dimension. Reject it here
      // rather than letting reconcileDims read length 0 as the "dimension unknown"
      // sentinel and silently latch dims=0 (FR-021a).
      if (vec.length === 0) return { ok: false, reason: 'response entry had an empty embedding array' };
      const conflict = this.reconcileDims(vec.length);
      if (conflict !== undefined) return { ok: false, reason: conflict };
      vectors[idx] = vec;
    }

    for (let i = 0; i < expectedCount; i++) {
      if (vectors[i] === undefined) return { ok: false, reason: 'response was missing an embedding for some input' };
    }
    return { ok: true, vectors };
  }

  /** Infer `dims` on the first vector, then enforce it; a mismatch names CODEGRAPH_EMBEDDING_DIMS (FR-021). */
  private reconcileDims(length: number): string | undefined {
    if (this._dims === 0) {
      this._dims = length;
      return undefined;
    }
    if (length !== this._dims) {
      return `embedding dimension ${length} conflicts with the established dimension ${this._dims} (CODEGRAPH_EMBEDDING_DIMS)`;
    }
    return undefined;
  }

  /** Full-jitter exponential backoff: random in [0, min(base·2^attempt, cap)). */
  private backoffDelay(attempt: number): number {
    const exponential = this.baseDelayMs * 2 ** attempt;
    const capped = Math.min(exponential, this.maxDelayMs);
    return Math.random() * capped;
  }
}
