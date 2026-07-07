/**
 * Embedding configuration — the user-facing activation surface (SPEC-001 + SPEC-002).
 *
 * Parses the `CODEGRAPH_EMBEDDING_*` environment variables into an in-memory
 * config. Nothing here is ever persisted: the URL and API key live only in the
 * returned object (FR-023 / D16). The feature is active only when BOTH the
 * endpoint URL and the model are set (FR-001); with neither set it is fully
 * dormant (`null`, FR-002); with exactly one set it is a half-configuration
 * that names the missing variable (FR-001a / SC-009).
 *
 * SPEC-002 layers an explicit provider selection — `CODEGRAPH_EMBEDDING_PROVIDER`,
 * or the `--embeddings` CLI flag overriding it for one invocation — ABOVE this
 * SPEC-001 resolution (FR-003): `off` short-circuits to dormant, `local` activates
 * the bundled local provider without requiring a URL, and `endpoint` resolves the
 * SPEC-001 way but never silently downgrades an incomplete config to local. With NO
 * explicit selection, resolution falls through to the SPEC-001 behavior above,
 * unchanged.
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
  /**
   * ALL unset variables, populated ONLY when more than one is missing — i.e. an explicit
   * `CODEGRAPH_EMBEDDING_PROVIDER=endpoint` with BOTH URL and MODEL unset. A renderer uses
   * this to avoid the half-config "X is set but Y is missing" phrasing, which would falsely
   * claim the counterpart is set. Absent for a genuine one-variable half-config.
   */
  missingVariables?: string[];
  /**
   * Set ONLY for an INVALID (not a missing) value — an unrecognized
   * `CODEGRAPH_EMBEDDING_PROVIDER`. Carries the offending value and the recognized
   * set so a renderer can say "X is not a valid provider (must be one of: …)"
   * instead of the misleading "PROVIDER is not set" (the variable IS set). Absent
   * for a genuine SPEC-001 half-config (a missing URL/MODEL), keeping the two
   * misconfig shapes distinct.
   */
  invalidValue?: string;
  allowedValues?: string[];
}

/**
 * Local-provider config (SPEC-002 / FR-006, FR-008): reachable ONLY through an
 * explicit selection (`CODEGRAPH_EMBEDDING_PROVIDER=local` or `--embeddings local`)
 * — never an implicit fallback. In-memory only, never persisted, same as the other
 * arms. `dims` is a compile-time-known literal (the pinned checkpoint's fixed
 * dimension) rather than the endpoint arm's optional/inferred `dims?: number`.
 */
export interface EmbeddingLocalConfig {
  provider: 'local';
  /**
   * The pinned checkpoint id (research.md OQ-2) — the user-facing model shown in `status`
   * and echoed as the provider's `id`. NOT the node_vectors.model storage key: local
   * vectors persist under the provider-qualified {@link LOCAL_VECTOR_MODEL} so they never
   * collide with an endpoint pointed at this same model name (FR-010/FR-022).
   */
  model: string;
  /** Statically known from the checkpoint. Enforced from pass start (no inference). */
  dims: 384;
  /** Batch size per worker message; positive-int clamped to LOCAL-tuned ceilings. */
  batchSize: number;
  /** Super-chunk sizing + commit cadence (batchSize × concurrency) — see data-model.md §1. */
  concurrency: number;
}

/**
 * `loadEmbeddingConfig` result — a discriminated union over exactly four outcomes (FR-004):
 *  - `EmbeddingConfig` — active endpoint provider (URL + MODEL both set),
 *  - `EmbeddingLocalConfig` — active local provider (SPEC-002, explicit selection only),
 *  - `EmbeddingMisconfig` — half-configured / invalid selection,
 *  - `null` — fully dormant. The `null` IS the dormancy signal.
 */
export type EmbeddingConfigResult = EmbeddingConfig | EmbeddingLocalConfig | EmbeddingMisconfig | null;

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

// SPEC-002 local-provider clamp ceilings (data-model.md §1) — deliberately NOT the
// endpoint's 2048/64. Those track an OpenAI-style HTTP endpoint's own documented
// request limits; a single in-process WASM CPU worker has no such protocol limit to
// track, so these are conservative sanity caps against a runaway typo ballooning the
// in-memory super-chunk (composed source strings held at once) on the SAME machine
// that is running codegraph.
const MAX_LOCAL_BATCH_SIZE = 256;
const MAX_LOCAL_CONCURRENCY = 16;

/** The one pinned local checkpoint (research.md OQ-2) — 384-dim, Apache-2.0, no alternative. */
const LOCAL_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const LOCAL_DIMS = 384;

/**
 * The `node_vectors.model` storage key for LOCALLY-computed vectors: the checkpoint id
 * ({@link LOCAL_MODEL_ID}), provider-qualified with a `local:` prefix. This keeps the local
 * vector identity DISTINCT from an ENDPOINT the user pointed at the same model name —
 * without it, endpoint vectors persisted under the bare `Xenova/all-MiniLM-L6-v2` would be
 * silently reused when switching to `local` (the model-column re-embed trigger,
 * D3/FR-010/FR-022, would see a false match) and status would count them as local coverage.
 * The endpoint arm is unchanged (it persists the raw model name), so existing endpoint
 * vectors are never disturbed. `status` still DISPLAYS the unprefixed model (see
 * {@link displayEmbeddingModel}); this key is storage-only.
 *
 * Residual (accepted): `local:` is a reserved storage namespace, but the endpoint arm still
 * persists RAW user-supplied model names, so an endpoint whose model is literally named
 * `local:Xenova/all-MiniLM-L6-v2` would re-collide. That is a same-user, self-inflicted
 * config (no privilege boundary) and vanishingly unlikely for a real embeddings endpoint;
 * fully provider-disjoint keys would need a `node_vectors` provider column — a larger
 * structural change touching the SPEC-001 endpoint path, deliberately out of scope here.
 */
export const LOCAL_VECTOR_MODEL = `local:${LOCAL_MODEL_ID}`;

/**
 * Map a persisted `node_vectors.model` key to its user-facing display name: strips the
 * `local:` provenance prefix {@link LOCAL_VECTOR_MODEL} adds, so `status` shows the bare
 * checkpoint id for a local run (the surrounding `provider`/context already conveys
 * `local`). Endpoint keys carry no prefix and pass through unchanged.
 */
export function displayEmbeddingModel(storedModel: string): string {
  return storedModel === LOCAL_VECTOR_MODEL ? LOCAL_MODEL_ID : storedModel;
}

/**
 * The recognized explicit-selection values (FR-001) — the single source of truth
 * shared by config resolution, the `status` "must be one of" guidance, and the CLI
 * `--embeddings` validator, so the two runtime checks can never drift apart.
 */
export const EMBEDDING_PROVIDER_VALUES = ['local', 'endpoint', 'off'] as const;

/** A validated explicit `--embeddings` / `CODEGRAPH_EMBEDDING_PROVIDER` selection. */
export type EmbeddingProviderSelection = (typeof EMBEDDING_PROVIDER_VALUES)[number];

/** Membership set derived from {@link EMBEDDING_PROVIDER_VALUES} (FR-001). */
const VALID_PROVIDERS = new Set<string>(EMBEDDING_PROVIDER_VALUES);

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
 * Build the active endpoint config from a validated (both-present) url/model pair.
 * Shared by the explicit-`endpoint`-selection path and the no-explicit-selection
 * fallthrough (SPEC-001) so the construction logic is never duplicated.
 */
function buildEndpointConfig(env: NodeJS.ProcessEnv, url: string, model: string): EmbeddingConfig {
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
 * Build the local-provider config (SPEC-002 / FR-006): no URL required, `dims` fixed
 * at the pinned checkpoint's 384 rather than inferred. Reuses the SAME batch-size /
 * concurrency env vars as the endpoint arm, clamped to the LOCAL-tuned ceilings.
 */
function buildLocalConfig(env: NodeJS.ProcessEnv): EmbeddingLocalConfig {
  return {
    provider: 'local',
    model: LOCAL_MODEL_ID,
    dims: LOCAL_DIMS,
    batchSize: parsePositiveInt(env.CODEGRAPH_EMBEDDING_BATCH_SIZE, DEFAULT_BATCH_SIZE, MAX_LOCAL_BATCH_SIZE),
    concurrency: parsePositiveInt(env.CODEGRAPH_EMBEDDING_CONCURRENCY, DEFAULT_CONCURRENCY, MAX_LOCAL_CONCURRENCY),
  };
}

/**
 * Load and validate the embedding configuration from an environment object, layering
 * the SPEC-002 FR-003 explicit-selection precedence above SPEC-001's unchanged
 * endpoint resolution. See {@link EmbeddingConfigResult} for the four outcomes.
 *
 * @param env process.env (or an injected test env).
 * @param providerOverride the `--embeddings` CLI flag's value for this single
 *   invocation, if passed — overrides `CODEGRAPH_EMBEDDING_PROVIDER` (FR-002).
 *   `undefined` (the default) means no CLI override was given.
 */
export function loadEmbeddingConfig(env: NodeJS.ProcessEnv, providerOverride?: string): EmbeddingConfigResult {
  const url = (env.CODEGRAPH_EMBEDDING_URL ?? '').trim();
  const model = (env.CODEGRAPH_EMBEDDING_MODEL ?? '').trim();
  const hasUrl = url !== '';
  const hasModel = model !== '';

  // FR-003: an explicit selection — CODEGRAPH_EMBEDDING_PROVIDER, or the --embeddings
  // flag overriding it for this invocation — wins over SPEC-001's URL/MODEL-driven
  // resolution below.
  const explicit = (providerOverride ?? env.CODEGRAPH_EMBEDDING_PROVIDER ?? '').trim();
  if (explicit !== '') {
    // An unrecognized value doesn't crash — it's a misconfig naming the offending
    // variable AND the invalid value + allowed set (spec.md Edge Cases
    // "Misconfiguration": "...or an unrecognized provider value"). Distinct from a
    // half-config: the variable IS set, just to something bad, so a renderer must say
    // "must be one of: …" rather than "not set".
    if (!VALID_PROVIDERS.has(explicit)) {
      return {
        misconfigured: true,
        missingVariable: 'CODEGRAPH_EMBEDDING_PROVIDER',
        invalidValue: explicit,
        allowedValues: [...VALID_PROVIDERS],
      };
    }
    // Row 1: `off` short-circuits to dormant — a present URL/MODEL is ignored.
    if (explicit === 'off') return null;
    // Row 2: `local` needs no URL (FR-006) — never falls through to SPEC-001 below.
    if (explicit === 'local') return buildLocalConfig(env);
    // Rows 3-4: explicit `endpoint` resolves strictly — an incomplete URL/MODEL is a
    // misconfig naming the missing variable(s), NEVER a silent downgrade to local (FR-006).
    // When BOTH are missing, name both (missingVariables) so a renderer never claims the
    // counterpart is set; missingVariable stays URL for existing single-name consumers.
    if (!hasUrl && !hasModel) {
      return {
        misconfigured: true,
        missingVariable: 'CODEGRAPH_EMBEDDING_URL',
        missingVariables: ['CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL'],
      };
    }
    if (!hasUrl) return { misconfigured: true, missingVariable: 'CODEGRAPH_EMBEDDING_URL' };
    if (!hasModel) return { misconfigured: true, missingVariable: 'CODEGRAPH_EMBEDDING_MODEL' };
    return buildEndpointConfig(env, url, model);
  }

  // Rows 5-7: no explicit selection — SPEC-001's resolution, UNCHANGED.

  // Fully dormant — byte-identical to a build without the feature (FR-002).
  if (!hasUrl && !hasModel) return null;

  // Half-config — feature off, but name the missing variable (FR-001a / SC-009).
  if (hasUrl && !hasModel) return { misconfigured: true, missingVariable: 'CODEGRAPH_EMBEDDING_MODEL' };
  if (!hasUrl && hasModel) return { misconfigured: true, missingVariable: 'CODEGRAPH_EMBEDDING_URL' };

  // Both set — active (FR-001).
  return buildEndpointConfig(env, url, model);
}

/**
 * Whether an explicit `off` selection is in effect (`CODEGRAPH_EMBEDDING_PROVIDER=off`, or an
 * `--embeddings off` override). {@link loadEmbeddingConfig} collapses `off` to `null` (FR-003)
 * so the indexing pass stays byte-identically dormant (FR-002); a STATUS consumer that must
 * distinguish an explicit disable ("off") from an unset dormancy asks here rather than
 * re-deriving the raw env, so "what counts as off" lives in one place.
 */
export function isEmbeddingProviderOff(env: NodeJS.ProcessEnv, providerOverride?: string): boolean {
  return (providerOverride ?? env.CODEGRAPH_EMBEDDING_PROVIDER ?? '').trim() === 'off';
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

/**
 * One-line, SHOULD-level transport advisory for a plaintext-remote endpoint —
 * the {@link isPlaintextRemoteEndpoint} case: `http` to a non-loopback host, so
 * the source code sent for embedding (and any bearer key) would cross the
 * network in cleartext. Returns `null` for every endpoint that does NOT warrant
 * it (any `https`, or loopback `http` — the designed local case), so a caller
 * can `const w = plaintextRemoteWarning(url); if (w) print(w)` with no branching
 * of its own. Advisory only — it never blocks activation.
 *
 * The endpoint is embedded via {@link redactEndpoint} (scheme + host + port
 * only) — never the raw URL, whose userinfo/query could carry credentials that
 * must not leak into a printed warning (FR-023).
 */
export function plaintextRemoteWarning(url: string): string | null {
  if (!isPlaintextRemoteEndpoint(url)) return null;
  return (
    `Warning: embedding endpoint ${redactEndpoint(url)} uses plaintext http to a ` +
    'non-loopback host — source code and any bearer key would cross the network ' +
    'in cleartext; use https instead.'
  );
}
