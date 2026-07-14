/**
 * LlmEndpointClient — OpenAI-compatible chat-completions client (SPEC-018 slice 1, US2 / T010).
 *
 * Completes a prose task via one OpenAI-compatible chat-completions request over the platform's
 * built-in global `fetch` + `AbortSignal` — no new dependency (FR-020). It is deliberately the
 * embeddings `EndpointProvider` re-shaped from "batch embed" to "one chat completion": the same
 * bounded retry (5xx / 429 / timeout / network with exponential backoff + full jitter honoring
 * `Retry-After`; fast-abort 4xx), and the same total error redaction — every error leaving this
 * module is a NEW {@link LlmEndpointError} built only from redacted strings (endpoint reduced to
 * scheme+host+port, status a bare integer). The raw transport error is read for its `.name` alone
 * and discarded; it is never chained as `cause`, and no response-body text is ever surfaced (FR-005).
 *
 * Two shapes diverge from the embeddings client, both per `contracts/endpoint-wire.md` / research D4:
 *  - Generation-sized deadlines (FR-017): a flat total-request deadline for non-streaming, an
 *    inter-chunk IDLE deadline (reset on every received chunk) for streaming — a slow-but-alive
 *    stream is never killed by a flat whole-stream cap.
 *  - A hard total-response-size ceiling (FR-017, maintainer security decision): in BOTH modes the
 *    body is read as a stream with a byte counter and aborted the moment `MAX_RESPONSE_BYTES` is
 *    crossed — hardening beyond the embeddings client's unbounded `response.text()` read, since
 *    `max_tokens` is only a hint an endpoint may ignore and neither deadline bounds volume. The
 *    mechanism mirrors the in-repo model-fetch download budget (streamed read + counter + abort).
 *
 * Streaming is an INTERNAL transport detail (FR-016a): `complete()` assembles the SSE
 * `choices[].delta.content` deltas and returns one final string — there is no `onChunk`/iterator.
 * A stream aborted before a clean close (idle-deadline fire or mid-stream transport error) discards
 * the partial and fails; only a clean end-of-stream (with or without `[DONE]`) yields output.
 */
import type { LlmEndpointConfig } from './config';
import { redactEndpoint } from './config';

/** An OpenAI-standard chat message (`{ role, content }`). The client embeds the already-composed
 * `messages` verbatim; it neither builds nor validates them (prompt composition lives elsewhere). */
export interface ChatMessage {
  role: string;
  content: string;
}

/**
 * Test-only knobs so retry / timeout / response-size paths run in ms / small under test; production
 * uses the defaults. Mirrors `EndpointProviderOverrides` plus the FR-017 deadlines and size ceiling.
 */
export interface LlmEndpointClientOverrides {
  /** Retry attempts after the initial request (default 3 → 4 total requests). */
  maxRetries?: number;
  /** Base backoff delay in ms (default 1000). */
  baseDelayMs?: number;
  /** Per-delay backoff cap in ms (default 8000). */
  maxDelayMs?: number;
  /** Ceiling applied to a `Retry-After` in ms (default 30000). */
  retryAfterCapMs?: number;
  /** Non-streaming flat total-request deadline in ms (default 300000). */
  totalTimeoutMs?: number;
  /** Streaming inter-chunk idle deadline in ms (default 45000). */
  idleTimeoutMs?: number;
  /** `max_tokens` sent in the request body (default 1024). */
  maxOutputTokens?: number;
  /** Hard total-response-size ceiling in bytes (default 33554432 = 32 MiB). */
  maxResponseBytes?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 8000;
const DEFAULT_RETRY_AFTER_CAP_MS = 30_000;
/** Non-streaming flat total-request deadline (band 120–600 s). */
const DEFAULT_TOTAL_TIMEOUT_MS = 300_000;
/** Streaming inter-chunk idle deadline (band 30–60 s), reset on every received chunk. */
const DEFAULT_IDLE_TIMEOUT_MS = 45_000;
/** `max_tokens` hint bounding worst-case output — an internal constant, never user-facing (FR-007). */
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
/** Hard total-response-size ceiling — a generous internal constant (32 MiB), test-overridable. */
const MAX_RESPONSE_BYTES = 33_554_432;

/**
 * The only error type this module throws. Its message and every own property are redaction-safe:
 * the endpoint is reduced to scheme+host+port and the status is a bare integer. No raw URL, API key,
 * `cause`, or response body is ever attached (FR-005 — `EmbeddingEndpointError` precedent).
 */
class LlmEndpointError extends Error {
  readonly endpoint: string;
  readonly status?: number;

  constructor(endpoint: string, reason: string, status?: number) {
    super(`LLM request to ${endpoint} failed: ${reason}`);
    this.name = 'LlmEndpointError';
    this.endpoint = endpoint;
    if (status !== undefined) this.status = status;
  }
}

/** Outcome of a single HTTP attempt: the assembled completion, or a classified failure. */
type AttemptResult =
  | { ok: true; text: string }
  | { ok: false; retryable: boolean; reason: string; status?: number; retryAfterMs?: number };

/** Signal parsed from a single SSE line: whether it was the `[DONE]` sentinel, and any delta text. */
type SseSignal = { done: boolean; text: string };

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

/** Narrow an `unknown` to a plain object for defensive field access (vendor-neutral tolerance). */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** Non-streaming: `choices[0].message.content`, or `''` when absent (FR-015a tolerance → FR-009a). */
function firstMessageContent(payload: unknown): string {
  const choices = asRecord(payload)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const message = asRecord(asRecord(choices[0])?.message);
  const content = message?.content;
  return typeof content === 'string' ? content : '';
}

/** Streaming: concatenate every `choices[].delta.content` string in one SSE chunk (FR-015a/FR-016). */
function deltaContent(payload: unknown): string {
  const choices = asRecord(payload)?.choices;
  if (!Array.isArray(choices)) return '';
  let out = '';
  for (const choice of choices) {
    const content = asRecord(asRecord(choice)?.delta)?.content;
    if (typeof content === 'string') out += content;
  }
  return out;
}

export class LlmEndpointClient {
  private readonly url: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly redactedEndpoint: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly retryAfterCapMs: number;
  private readonly totalTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly maxResponseBytes: number;

  constructor(config: LlmEndpointConfig, overrides: LlmEndpointClientOverrides = {}) {
    this.url = config.url;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.redactedEndpoint = redactEndpoint(config.url);
    this.maxRetries = overrides.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = overrides.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = overrides.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.retryAfterCapMs = overrides.retryAfterCapMs ?? DEFAULT_RETRY_AFTER_CAP_MS;
    this.totalTimeoutMs = overrides.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    this.idleTimeoutMs = overrides.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.maxOutputTokens = overrides.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.maxResponseBytes = overrides.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  }

  /**
   * Complete a prose task from already-composed `messages`. `stream` selects the transport per call
   * (FR-016) but is invisible to the caller: both modes return one final assembled string. On
   * ultimate failure (retry-exhaustion, a non-retryable status, an empty completion, a size-ceiling
   * breach) it throws the redaction-safe {@link LlmEndpointError} for `generate()` to catch (FR-009).
   */
  async complete(promptParts: ChatMessage[], options: { stream: boolean }): Promise<string> {
    const { stream } = options;
    for (let attempt = 0; ; attempt++) {
      let outcome: AttemptResult;
      try {
        outcome = await this.attempt(promptParts, stream);
      } catch (raw) {
        // A raw transport/timeout/abort error. Read ONLY `.name` — never its message, cause, or
        // stack, which can embed the URL and its credentials (FR-005) — then discard it. A deadline
        // abort surfaces as AbortError; both timeout and network errors are retryable.
        const name = raw instanceof Error ? raw.name : '';
        const reason = name === 'TimeoutError' || name === 'AbortError' ? 'request timed out' : 'network or transport error';
        outcome = { ok: false, retryable: true, reason };
      }

      if (outcome.ok) return outcome.text;

      const canRetry = outcome.retryable && attempt < this.maxRetries;
      if (!canRetry) throw new LlmEndpointError(this.redactedEndpoint, outcome.reason, outcome.status);

      const delayMs =
        outcome.retryAfterMs !== undefined
          ? Math.min(outcome.retryAfterMs, this.retryAfterCapMs)
          : this.backoffDelay(attempt);
      await delay(delayMs);
    }
  }

  /**
   * A single HTTP attempt. Arms the mode's deadline (a flat total for non-streaming; an idle window,
   * reset per chunk, for streaming) on one `AbortController`, POSTs the minimal chat-completions
   * body, then reads the response as a byte-counted stream. The `fetch`/body read may throw (→ a
   * transport failure classified by {@link complete}); a size-ceiling breach and a validation
   * failure return a non-retryable outcome; the FR-009a empty-completion gate is applied last.
   */
  private async attempt(promptParts: ChatMessage[], stream: boolean): Promise<AttemptResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearTimer = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    // Non-streaming: one flat total deadline over the whole request (fetch + body read), never reset.
    // Streaming: an idle deadline re-armed on every received chunk, so only sustained silence aborts.
    const armIdle = (): void => {
      clearTimer();
      timer = setTimeout(() => controller.abort(), this.idleTimeoutMs);
    };
    const armTotal = (): void => {
      clearTimer();
      timer = setTimeout(() => controller.abort(), this.totalTimeoutMs);
    };
    if (stream) armIdle();
    else armTotal();
    const resetIdle = stream ? armIdle : undefined;

    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      // The key is sent ONLY here, to the configured host; the platform strips it on a cross-origin
      // redirect (WHATWG Fetch — undici conforms), so a redirect target never receives it (FR-005).
      if (this.apiKey !== undefined) headers['authorization'] = `Bearer ${this.apiKey}`;

      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        // Minimal, vendor-neutral body (FR-015/FR-015a): model + composed messages + per-call stream
        // + max_tokens. `temperature` is omitted → the endpoint default.
        body: JSON.stringify({ model: this.model, messages: promptParts, stream, max_tokens: this.maxOutputTokens }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const status = response.status;
        // Release the socket WITHOUT reading the body — its text is never surfaced (FR-005), and a
        // hostile endpoint could attach an unbounded body to a non-2xx.
        await response.body?.cancel().catch(() => undefined);
        if (status >= 500) return { ok: false, retryable: true, reason: `endpoint returned HTTP ${status}`, status };
        if (status === 429) {
          const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
          return { ok: false, retryable: true, reason: 'endpoint returned HTTP 429', status, retryAfterMs };
        }
        // 4xx (and any other non-2xx that is neither 5xx nor 429): non-retryable fast-abort.
        return { ok: false, retryable: false, reason: `endpoint returned HTTP ${status}`, status };
      }

      const read = await this.readBody(response, stream, resetIdle);
      if (!read.ok) return read;
      // FR-009a: an empty/whitespace assembled completion (either mode) is a failed generation, never
      // usable text — a non-retryable failure that degrades to the consumer fallback.
      if (read.text.trim() === '') return { ok: false, retryable: false, reason: 'endpoint returned an empty completion' };
      return read;
    } finally {
      clearTimer();
    }
  }

  /**
   * Read the 200 response body as a byte-counted stream, aborting the moment `maxResponseBytes` is
   * crossed (FR-017 — mirrors the model-fetch download budget). Non-streaming: accumulate the bytes,
   * `JSON.parse`, take `choices[0].message.content`. Streaming: parse SSE `data:` lines, concatenate
   * `choices[].delta.content`, and terminate on `data: [DONE]` OR a clean end-of-stream without it
   * (a missing sentinel at a clean close is NOT an error — FR-016a). A mid-stream transport error or
   * a deadline abort throws out of the read (→ discarded partial, ultimate failure — FR-016a).
   */
  private async readBody(
    response: Response,
    stream: boolean,
    resetIdle: (() => void) | undefined,
  ): Promise<AttemptResult> {
    const body = response.body;
    if (body === null) return { ok: true, text: '' }; // no body → empty → the FR-009a gate handles it
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    resetIdle?.(); // start the idle window now that headers have arrived (streaming)

    if (stream) {
      let buffer = '';
      let assembled = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value === undefined) continue;
        total += value.byteLength;
        if (total > this.maxResponseBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, retryable: false, reason: 'response exceeded the maximum size' };
        }
        resetIdle?.();
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          const signal = consumeSseLine(line);
          if (signal.done) {
            // Clean terminal sentinel — release the socket and return the assembly.
            await reader.cancel().catch(() => undefined);
            return { ok: true, text: assembled };
          }
          assembled += signal.text;
        }
      }
      // Clean end-of-stream WITHOUT [DONE] (FR-016a) — flush the decoder and any trailing line.
      buffer += decoder.decode();
      assembled += consumeSseLine(buffer).text;
      return { ok: true, text: assembled };
    }

    // Non-streaming: accumulate the whole (byte-bounded) body, then parse one JSON object.
    let raw = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > this.maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, retryable: false, reason: 'response exceeded the maximum size' };
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      // A fully-received but non-JSON body — non-retryable (never echo it).
      return { ok: false, retryable: false, reason: 'response body was not valid JSON' };
    }
    return { ok: true, text: firstMessageContent(payload) };
  }

  /** Full-jitter exponential backoff: random in [0, min(base·2^attempt, cap)). */
  private backoffDelay(attempt: number): number {
    const exponential = this.baseDelayMs * 2 ** attempt;
    const capped = Math.min(exponential, this.maxDelayMs);
    return Math.random() * capped;
  }
}

/**
 * Interpret one raw SSE line. Only `data:` lines carry content; a `[DONE]` payload signals a clean
 * terminal sentinel; a non-JSON `data:` payload is tolerated and contributes no text (vendor
 * neutrality). Comments (`:`), blank separators, and unknown fields yield no text.
 */
function consumeSseLine(rawLine: string): SseSignal {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine; // tolerate CRLF framing
  if (!line.startsWith('data:')) return { done: false, text: '' };
  const payloadText = line.slice(5).replace(/^ /, ''); // SSE strips one leading space after the colon
  if (payloadText === '[DONE]') return { done: true, text: '' };
  if (payloadText === '') return { done: false, text: '' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    return { done: false, text: '' }; // a non-JSON keep-alive / proprietary line — tolerate it
  }
  return { done: false, text: deltaContent(parsed) };
}
