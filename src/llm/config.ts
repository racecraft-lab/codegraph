/**
 * LLM access-layer configuration — the user-facing activation surface (SPEC-018 slice 1).
 *
 * Parses the `CODEGRAPH_LLM_*` environment variables into an in-memory config
 * (data-model §2), mirroring `loadEmbeddingConfig`. Nothing here is ever
 * persisted: the URL and API key live only in the returned object (FR-005).
 * The result is a four-state discriminated union — the `null` IS the dormancy
 * signal (FR-004):
 *  - `LlmEndpointConfig` — endpoint provider (URL + MODEL both set),
 *  - `LlmAgentConfig`    — agent provider (reached ONLY by an explicit
 *                          `CODEGRAPH_LLM_PROVIDER=agent`, never an implicit fallback — FR-003),
 *  - `LlmMisconfig`      — half-configured, or an unrecognized provider value,
 *  - `null`              — fully dormant (the default — FR-001/FR-004).
 *
 * Activation variables are `CODEGRAPH_LLM_URL` + `CODEGRAPH_LLM_MODEL`;
 * `CODEGRAPH_LLM_API_KEY` is NOT one (API-key-only resolves to dormant `null`,
 * and the key is memory-only in every state — FR-005). Valid providers are
 * `{ endpoint, agent }` — there is no embeddings-style `local`/`off`.
 *
 * Per research D2, this module imports only `isLoopbackHost` from `../utils` and
 * defines its OWN redaction + plaintext-remote helpers (never imported from
 * `src/embeddings/config`) so the two opt-in modules stay independent and the
 * advisory is LLM-worded.
 */

import { isLoopbackHost } from '../utils';

/** Parsed, in-memory endpoint config (data-model §2). Never persisted (FR-005). */
export interface LlmEndpointConfig {
  mode: 'endpoint';
  /** OpenAI-compatible chat-completions endpoint URL. Required to activate. */
  url: string;
  /** Model name sent in each request. Required to activate. */
  model: string;
  /** Optional bearer key; memory-only, omitted entirely when keyless (FR-005). */
  apiKey?: string;
  // retry/timeout/idle/max_tokens are internal constants, NOT config fields (FR-007).
}

/** Agent-mode marker — reached ONLY by an explicit `CODEGRAPH_LLM_PROVIDER=agent` (FR-003). */
export interface LlmAgentConfig {
  mode: 'agent';
}

/**
 * Half-configuration / invalid-selection descriptor. Distinct from the
 * fully-dormant `null` of FR-004.
 */
export interface LlmMisconfig {
  misconfigured: true;
  /** The single missing activation var (or `CODEGRAPH_LLM_PROVIDER` for an invalid value). */
  missingVariable: string;
  /**
   * ALL unset activation vars, populated ONLY when BOTH URL and MODEL are missing under an
   * explicit `CODEGRAPH_LLM_PROVIDER=endpoint` — lets a renderer avoid the "X is set but Y is
   * missing" phrasing that would falsely claim the counterpart is set. Absent for a genuine
   * one-variable half-config.
   */
  missingVariables?: string[];
  /**
   * Set ONLY for an unrecognized `CODEGRAPH_LLM_PROVIDER` value — the offending value plus the
   * recognized set, so a renderer says "must be one of: …" rather than the misleading "not set"
   * (the variable IS set). Absent for a genuine URL/MODEL half-config, keeping the two misconfig
   * shapes distinct.
   */
  invalidValue?: string;
  allowedValues?: string[];
}

/**
 * `loadLlmConfig` result — a discriminated union over exactly four outcomes (FR-001).
 * The `null` IS the dormancy signal (FR-004).
 */
export type LlmConfigResult = LlmEndpointConfig | LlmAgentConfig | LlmMisconfig | null;

/**
 * The recognized `CODEGRAPH_LLM_PROVIDER` values (FR-003) — the single source of truth shared by
 * config resolution and the status "must be one of" guidance. No embeddings-style `local`/`off`:
 * the LLM layer has no bundled local provider, and dormant is the unset default.
 */
export const LLM_PROVIDER_VALUES = ['endpoint', 'agent'] as const;

/** Membership set derived from {@link LLM_PROVIDER_VALUES}. */
const VALID_PROVIDERS = new Set<string>(LLM_PROVIDER_VALUES);

/** Rendered in place of any endpoint URL that cannot be parsed (FR-006). */
const INVALID_ENDPOINT_PLACEHOLDER = '<invalid endpoint URL>';

/**
 * Parse a positive-integer env tunable, clamping to `[1, max]`; blank, unset, non-numeric, and
 * non-positive values fall back to `fallback`. Mirrors the embeddings `parsePositiveInt` /
 * `resolveParsePoolSize` precedent.
 *
 * FR-007 clamp-vacuity (research D3): the LLM endpoint config exposes NO user-facing numeric env
 * tunables (url/model/apiKey only) — retry/timeout/idle/token-budget/max_tokens are all internal
 * constants. This helper is therefore the pattern of record for any FUTURE numeric knob; it has
 * no production call site in slice 1. Exported so the pattern is available (and directly testable)
 * without tripping `noUnusedLocals`.
 */
export function parsePositiveInt(raw: string | undefined, fallback: number, max: number): number {
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
 * Build the endpoint config from a validated (both-present) url/model pair. The API key is
 * attached in memory only, and omitted entirely when blank/unset (FR-005).
 */
function buildEndpointConfig(env: NodeJS.ProcessEnv, url: string, model: string): LlmEndpointConfig {
  const config: LlmEndpointConfig = { mode: 'endpoint', url, model };
  const apiKey = env.CODEGRAPH_LLM_API_KEY?.trim();
  if (apiKey) config.apiKey = apiKey; // omit entirely when keyless (FR-005)
  return config;
}

/**
 * Load and validate the LLM configuration from an environment object (data-model §2 /
 * contracts/llm-config-resolution.md). Resolution order (research D3):
 *  1. Explicit `CODEGRAPH_LLM_PROVIDER`: `agent` → agent; `endpoint` → strict URL+MODEL (a
 *     missing one is a misconfig naming the gap, never a silent downgrade); unrecognized →
 *     misconfig carrying `invalidValue` + `allowedValues`.
 *  2. No explicit provider: URL+MODEL both set → endpoint; exactly one → misconfig; neither →
 *     `null` (dormant).
 * Pure over `env` — no filesystem, no network, no cross-call state (FR-024a).
 */
export function loadLlmConfig(env: NodeJS.ProcessEnv): LlmConfigResult {
  const url = (env.CODEGRAPH_LLM_URL ?? '').trim();
  const model = (env.CODEGRAPH_LLM_MODEL ?? '').trim();
  const hasUrl = url !== '';
  const hasModel = model !== '';

  const explicit = (env.CODEGRAPH_LLM_PROVIDER ?? '').trim();
  if (explicit !== '') {
    // An unrecognized value doesn't crash — it's a misconfig naming the offending variable AND
    // the invalid value + allowed set, so a renderer says "must be one of: …" (the var IS set).
    if (!VALID_PROVIDERS.has(explicit)) {
      return {
        misconfigured: true,
        missingVariable: 'CODEGRAPH_LLM_PROVIDER',
        invalidValue: explicit,
        allowedValues: [...LLM_PROVIDER_VALUES],
      };
    }
    // Agent is explicit-only — a present URL/MODEL is ignored, never auto-endpoint (FR-003).
    if (explicit === 'agent') return { mode: 'agent' };
    // Explicit `endpoint` resolves strictly — an incomplete URL/MODEL is a misconfig naming the
    // missing variable(s), NEVER a silent downgrade. When BOTH are missing, name both
    // (missingVariables) so a renderer never claims the counterpart is set; missingVariable stays
    // URL for single-name consumers.
    if (!hasUrl && !hasModel) {
      return {
        misconfigured: true,
        missingVariable: 'CODEGRAPH_LLM_URL',
        missingVariables: ['CODEGRAPH_LLM_URL', 'CODEGRAPH_LLM_MODEL'],
      };
    }
    if (!hasUrl) return { misconfigured: true, missingVariable: 'CODEGRAPH_LLM_URL' };
    if (!hasModel) return { misconfigured: true, missingVariable: 'CODEGRAPH_LLM_MODEL' };
    return buildEndpointConfig(env, url, model);
  }

  // No explicit selection.
  // Fully dormant — byte-identical to a build without the feature (FR-004). The API key is never
  // an activation variable, so API-key-only lands here (dormant) with the key untouched (FR-005).
  if (!hasUrl && !hasModel) return null;

  // Half-config — feature off, but name the missing variable (FR-002).
  if (!hasUrl) return { misconfigured: true, missingVariable: 'CODEGRAPH_LLM_URL' };
  if (!hasModel) return { misconfigured: true, missingVariable: 'CODEGRAPH_LLM_MODEL' };

  // Both set — auto-activate the endpoint (FR-001).
  return buildEndpointConfig(env, url, model);
}

/**
 * Render an endpoint URL redacted to scheme + host + port only — userinfo, path, and query
 * stripped (FR-006). An unparseable URL renders as a safe placeholder; the raw string (which
 * `new URL` echoes on `err.input`) never escapes, so no embedded credential can leak.
 */
export function redactEndpoint(url: string): string {
  try {
    const u = new URL(url);
    // `host` is scheme-authority host+port with NO userinfo/path/query/fragment, and it
    // preserves IPv6 brackets (e.g. `[::1]:11434`) — unlike a manual `hostname` + `:port`,
    // which for an IPv6 host would emit the ambiguous `::1:11434`.
    return `${u.protocol}//${u.host}`;
  } catch {
    // Deliberately reference nothing off the caught error — its `.input` carries the raw URL.
    return INVALID_ENDPOINT_PLACEHOLDER;
  }
}

/**
 * True when the endpoint is plaintext `http` to a non-loopback host — the case that warrants a
 * cleartext advisory (prompts and any bearer key would cross the network unencrypted). Loopback
 * `http` (the designed local case) and any `https` endpoint return false; an unparseable URL
 * returns false (handled elsewhere).
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
 * One-line, SHOULD-level transport advisory for a plaintext-remote endpoint — the
 * {@link isPlaintextRemoteEndpoint} case: `http` to a non-loopback host, so the task prompts sent
 * for completion (and any bearer key) would cross the network in cleartext. Returns `null` for
 * every endpoint that does NOT warrant it (any `https`, or loopback `http`), so a caller can
 * `const w = plaintextRemoteWarning(url); if (w) print(w)` with no branching of its own. Advisory
 * only — it never blocks activation.
 *
 * LLM-worded (not "embedding" — research D2). The endpoint is embedded via {@link redactEndpoint}
 * (scheme + host + port only) — never the raw URL, whose userinfo/query could carry credentials
 * that must not leak into a printed warning (FR-005/FR-006).
 */
export function plaintextRemoteWarning(url: string): string | null {
  if (!isPlaintextRemoteEndpoint(url)) return null;
  return (
    `Warning: LLM endpoint ${redactEndpoint(url)} uses plaintext http to a ` +
    'non-loopback host — task prompts and any bearer key would cross the network ' +
    'in cleartext; use https instead.'
  );
}

/**
 * LLM status snapshot (data-model §8 / contracts/status-llm-json.md) — a discriminated union
 * mirroring `EmbeddingStatus`, computed purely from `env` (network-free — SC-002/SC-004).
 * `CodeGraph.getLlmStatus()` (Group D) delegates to {@link resolveLlmStatus}. Slice 1 renders
 * endpoint-active / agent-stub / dormant / misconfigured; the agent branch gains a pending-bundle
 * count in slice 2.
 */

/** Endpoint configured — the redacted endpoint + model, and the in-status plaintext advisory. */
export interface LlmStatusActive {
  active: true;
  mode: 'endpoint';
  endpoint: string;
  model: string;
  plaintextWarning?: string;
}
export interface LlmStatusAgent {
  active: true;
  mode: 'agent';
  pendingBundles?: number;
}
export interface LlmStatusDormant {
  active: false;
  activationVars: string[];
}
export interface LlmStatusMisconfigured {
  active: false;
  misconfigured: true;
  missingVariable: string;
  missingVariables?: string[];
  invalidValue?: string;
  allowedValues?: string[];
}
export type LlmStatus = LlmStatusActive | LlmStatusAgent | LlmStatusDormant | LlmStatusMisconfigured;

/** The two environment variables that activate the endpoint provider (FR-001). */
const LLM_ACTIVATION_VARS = ['CODEGRAPH_LLM_URL', 'CODEGRAPH_LLM_MODEL'];

/**
 * Compute the observability snapshot for `codegraph status` (data-model §8 / D12). Pure and
 * network-free in every state: it reads the activation config from `env` and nothing else —
 * dormancy is never broken to produce it (SC-002/SC-004). The API key is never surfaced in any
 * field (FR-005): endpoint status carries only the redacted URL + model, and the plaintext-remote
 * advisory (built from {@link plaintextRemoteWarning}) is itself redaction-safe.
 */
export function resolveLlmStatus(env: NodeJS.ProcessEnv): LlmStatus {
  const config = loadLlmConfig(env);

  // Misconfigured — half-config or unrecognized provider: mirror the misconfig fields (D12).
  if (config !== null && 'misconfigured' in config) {
    const status: LlmStatusMisconfigured = {
      active: false,
      misconfigured: true,
      missingVariable: config.missingVariable,
    };
    if (config.missingVariables !== undefined) status.missingVariables = config.missingVariables;
    if (config.invalidValue !== undefined) {
      status.invalidValue = config.invalidValue;
      if (config.allowedValues !== undefined) status.allowedValues = config.allowedValues;
    }
    return status;
  }

  // Agent mode — slice 1 bare stub (no pendingBundles until slice 2).
  if (config !== null && config.mode === 'agent') {
    return { active: true, mode: 'agent' };
  }

  // Endpoint active — redacted endpoint + model. FR-006's deliberate divergence from embeddings:
  // the plaintext-remote advisory lives IN status (not pass-time-only), and is redaction-safe.
  if (config !== null && config.mode === 'endpoint') {
    const status: LlmStatusActive = {
      active: true,
      mode: 'endpoint',
      endpoint: redactEndpoint(config.url),
      model: config.model,
    };
    const warning = plaintextRemoteWarning(config.url);
    if (warning) status.plaintextWarning = warning;
    return status;
  }

  // Dormant — config resolved to null (FR-004).
  return { active: false, activationVars: [...LLM_ACTIVATION_VARS] };
}
