/**
 * Embedding configuration — the user-facing activation surface (SPEC-001).
 *
 * Parses the `CODEGRAPH_EMBEDDING_*` environment variables into an in-memory
 * config. Nothing here is ever persisted: the URL and API key live only in the
 * returned object (FR-023 / D16). The feature is active only when BOTH the
 * endpoint URL and the model are set (FR-001); with neither set it is fully
 * dormant (`null`, FR-002); with exactly one set it is a half-configuration
 * that names the missing variable (FR-001a / SC-009).
 *
 * Tunable parsing follows the positive-int parse+clamp precedent of
 * `resolveParsePoolSize` in `src/extraction/parse-pool.ts`.
 */

/** Parsed, in-memory embedding config. Never persisted (FR-023). */
export interface EmbeddingConfig {
  /** OpenAI-compatible embeddings endpoint base URL. Required to activate. */
  url: string;
  /** Model name sent in each request. Required to activate. */
  model: string;
  /** Optional bearer key; memory-only, never persisted/logged/echoed (FR-003/FR-023). */
  apiKey?: string;
  /** Optional; when omitted, inferred from the first successful batch (FR-004). */
  dims?: number;
  /** Batch size per request; default 16, positive-int clamped. */
  batchSize: number;
  /** In-flight request concurrency; default 4, positive-int clamped. */
  concurrency: number;
  /** Per-request timeout budget in ms; default 30000, positive-int clamped. */
  timeoutMs: number;
}

/**
 * Half-configuration descriptor (FR-001a / SC-009): exactly one activation
 * variable is set, so the feature stays off but names the missing variable.
 * Distinct from the fully-dormant `null` of FR-002.
 */
export interface EmbeddingMisconfig {
  misconfigured: true;
  missingVariable: string;
}

/**
 * `loadEmbeddingConfig` result:
 *  - `EmbeddingConfig` — active (URL + MODEL both set),
 *  - `EmbeddingMisconfig` — half-configured (exactly one set),
 *  - `null` — fully dormant (neither set). The `null` IS the dormancy signal.
 */
export type EmbeddingConfigResult = EmbeddingConfig | EmbeddingMisconfig | null;

const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30_000;

// Sane ceilings for the clamp. Batch tracks the OpenAI `/v1/embeddings`
// documented 2048-inputs-per-request hard limit (anything larger is a
// guaranteed 400); concurrency and timeout ceilings turn a runaway typo
// (e.g. an extra digit) into a bounded value rather than socket exhaustion
// or a multi-hour hang.
const MAX_BATCH_SIZE = 2048;
const MAX_CONCURRENCY = 64;
const MAX_TIMEOUT_MS = 600_000;

/** Rendered in place of any endpoint URL that cannot be parsed (FR-023). */
const INVALID_ENDPOINT_PLACEHOLDER = '<invalid endpoint URL>';

/**
 * Parse a positive-integer env tunable, clamping to `[1, max]`; blank, unset,
 * non-numeric, and non-positive values fall back to `fallback`. Mirrors the
 * `resolveParsePoolSize` precedent.
 */
function parsePositiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) {
      return Math.min(Math.floor(n), max);
    }
    // non-numeric / < 1 → fall through to the default
  }
  return fallback;
}

/**
 * Parse an optional positive-integer env value (the dimension, FR-004).
 * Returns `undefined` for blank/unset/invalid so the caller infers it from the
 * first successful batch. Unclamped — the model, not CodeGraph, sets the range.
 */
function parseOptionalPositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return undefined;
}

/** Loopback host per FR: `localhost`, `127.0.0.0/8`, or IPv6 `::1`. */
function isLoopbackHost(hostname: string): boolean {
  // URL.hostname keeps IPv6 brackets (`[::1]`); strip them before comparing.
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * Load and validate the embedding configuration from an environment object.
 * See {@link EmbeddingConfigResult} for the three outcomes.
 */
export function loadEmbeddingConfig(env: NodeJS.ProcessEnv): EmbeddingConfigResult {
  const url = (env.CODEGRAPH_EMBEDDING_URL ?? '').trim();
  const model = (env.CODEGRAPH_EMBEDDING_MODEL ?? '').trim();
  const hasUrl = url !== '';
  const hasModel = model !== '';

  // Fully dormant — byte-identical to a build without the feature (FR-002).
  if (!hasUrl && !hasModel) return null;

  // Half-config — feature off, but name the missing variable (FR-001a / SC-009).
  if (hasUrl && !hasModel) return { misconfigured: true, missingVariable: 'CODEGRAPH_EMBEDDING_MODEL' };
  if (!hasUrl && hasModel) return { misconfigured: true, missingVariable: 'CODEGRAPH_EMBEDDING_URL' };

  // Both set — active (FR-001).
  const config: EmbeddingConfig = {
    url,
    model,
    batchSize: parsePositiveInt(env.CODEGRAPH_EMBEDDING_BATCH_SIZE, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE),
    concurrency: parsePositiveInt(env.CODEGRAPH_EMBEDDING_CONCURRENCY, DEFAULT_CONCURRENCY, MAX_CONCURRENCY),
    timeoutMs: parsePositiveInt(env.CODEGRAPH_EMBEDDING_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
  };

  const apiKey = env.CODEGRAPH_EMBEDDING_API_KEY?.trim();
  if (apiKey) config.apiKey = apiKey; // omit entirely when keyless (FR-003)

  const dims = parseOptionalPositiveInt(env.CODEGRAPH_EMBEDDING_DIMS);
  if (dims !== undefined) config.dims = dims; // else inferred from first batch (FR-004)

  return config;
}

/**
 * Render an endpoint URL redacted to scheme + host + port only — userinfo,
 * path, and query stripped (FR-023). An unparseable URL renders as a safe
 * placeholder; the raw string (which `new URL` echoes on `err.input`) never
 * escapes, so no embedded credential can leak through this path.
 */
export function redactEndpoint(url: string): string {
  try {
    const u = new URL(url);
    const port = u.port ? `:${u.port}` : '';
    return `${u.protocol}//${u.hostname}${port}`;
  } catch {
    // Deliberately reference nothing off the caught error — its `.input`
    // property carries the raw URL string verbatim.
    return INVALID_ENDPOINT_PLACEHOLDER;
  }
}

/**
 * True when the endpoint is plaintext `http` to a non-loopback host — the case
 * that warrants a one-line cleartext advisory (source code and any bearer key
 * would cross the network unencrypted). Loopback `http` (the designed local
 * case) and any `https` endpoint return false; an unparseable URL returns false
 * (its failure is handled elsewhere).
 */
export function isPlaintextRemoteEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:') return false;
    return !isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}
