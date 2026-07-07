/**
 * Embedding provider selection — unit tests (SPEC-002, T003).
 *
 * Pins the FR-003 resolution table (data-model.md §1, all 7 rows): an explicit
 * selection — `CODEGRAPH_EMBEDDING_PROVIDER`, or the `--embeddings` CLI flag
 * overriding it for one invocation — is layered ABOVE SPEC-001's unchanged
 * endpoint resolution (pinned separately by `embeddings-config.test.ts`, which
 * MUST stay green). These are pure functions over an injected env object (plus
 * an optional override argument) — no filesystem, no DB, no network.
 *
 * Traceability: FR-001 (exactly `endpoint`|`local`|`off`), FR-002 (`--embeddings`
 * one-invocation override), FR-003 (the 7-row precedence table), FR-004 (four-arm
 * discriminated union), FR-005 (fully-unset stays dormant), FR-006 (`local`
 * reachable ONLY by explicit selection; a half-config is never silently
 * downgraded to `off`/`local`).
 */
import { describe, it, expect } from 'vitest';
import { loadEmbeddingConfig, isEmbeddingProviderOff } from '../src/embeddings/config';
import type { EmbeddingConfig, EmbeddingLocalConfig, EmbeddingMisconfig } from '../src/embeddings/config';

const ENDPOINT_URL = 'https://api.example.com';
const ENDPOINT_MODEL = 'text-embedding-3-small';

/** A base env with BOTH endpoint activation variables set, plus optional overrides. */
function endpointEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    CODEGRAPH_EMBEDDING_URL: ENDPOINT_URL,
    CODEGRAPH_EMBEDDING_MODEL: ENDPOINT_MODEL,
    ...extra,
  };
}

describe('loadEmbeddingConfig — FR-003 row 1: explicit `off` short-circuits to dormant', () => {
  it('resolves to null when neither URL nor MODEL is set', () => {
    expect(loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_PROVIDER: 'off' })).toBeNull();
  });

  it('resolves to null even when BOTH URL and MODEL are set — present config is ignored', () => {
    expect(loadEmbeddingConfig(endpointEnv({ CODEGRAPH_EMBEDDING_PROVIDER: 'off' }))).toBeNull();
  });

  it('resolves to null even when only ONE of URL/MODEL is set — present config is ignored', () => {
    expect(
      loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_URL: ENDPOINT_URL, CODEGRAPH_EMBEDDING_PROVIDER: 'off' }),
    ).toBeNull();
  });

  it('isEmbeddingProviderOff detects an explicit off (env or --embeddings override) that loadEmbeddingConfig collapses to null', () => {
    // config still returns null (above), but status must be able to tell explicit-off apart
    // from an unset dormancy — that distinction lives in isEmbeddingProviderOff.
    expect(isEmbeddingProviderOff({ CODEGRAPH_EMBEDDING_PROVIDER: 'off' })).toBe(true);
    expect(isEmbeddingProviderOff({ CODEGRAPH_EMBEDDING_PROVIDER: ' off ' })).toBe(true); // trimmed
    expect(isEmbeddingProviderOff({ CODEGRAPH_EMBEDDING_PROVIDER: 'local' }, 'off')).toBe(true); // override wins
    expect(isEmbeddingProviderOff({})).toBe(false); // unset dormancy is NOT explicit-off
    expect(isEmbeddingProviderOff({ CODEGRAPH_EMBEDDING_PROVIDER: 'endpoint' })).toBe(false);
  });
});

describe('loadEmbeddingConfig — FR-003/FR-006 row 2: explicit `local` needs no URL', () => {
  it('activates the local provider with no URL/MODEL set at all, using the pinned checkpoint + dims', () => {
    const cfg = loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_PROVIDER: 'local' }) as EmbeddingLocalConfig;
    expect(cfg.provider).toBe('local');
    expect(cfg.model).toBe('Xenova/all-MiniLM-L6-v2');
    expect(cfg.dims).toBe(384);
    expect(cfg.batchSize).toBe(16);
    expect(cfg.concurrency).toBe(4);
  });

  it('wins over a fully-configured endpoint — explicit local beats a present URL/MODEL', () => {
    const cfg = loadEmbeddingConfig(endpointEnv({ CODEGRAPH_EMBEDDING_PROVIDER: 'local' })) as EmbeddingLocalConfig;
    expect(cfg.provider).toBe('local');
    expect(cfg.dims).toBe(384);
  });

  it('wins over a half-configured endpoint too (only URL set)', () => {
    const cfg = loadEmbeddingConfig({
      CODEGRAPH_EMBEDDING_URL: ENDPOINT_URL,
      CODEGRAPH_EMBEDDING_PROVIDER: 'local',
    }) as EmbeddingLocalConfig;
    expect(cfg.provider).toBe('local');
  });

  it('clamps batchSize/concurrency with LOCAL-tuned ceilings — NOT the endpoint 2048/64', () => {
    const cfg = loadEmbeddingConfig({
      CODEGRAPH_EMBEDDING_PROVIDER: 'local',
      CODEGRAPH_EMBEDDING_BATCH_SIZE: '999999',
      CODEGRAPH_EMBEDDING_CONCURRENCY: '999999',
    }) as EmbeddingLocalConfig;
    expect(cfg.batchSize).toBeLessThan(2048);
    expect(cfg.concurrency).toBeLessThan(64);
  });

  it('parses a valid batchSize/concurrency override within the local ceilings', () => {
    const cfg = loadEmbeddingConfig({
      CODEGRAPH_EMBEDDING_PROVIDER: 'local',
      CODEGRAPH_EMBEDDING_BATCH_SIZE: '8',
      CODEGRAPH_EMBEDDING_CONCURRENCY: '2',
    }) as EmbeddingLocalConfig;
    expect(cfg.batchSize).toBe(8);
    expect(cfg.concurrency).toBe(2);
  });
});

describe('loadEmbeddingConfig — FR-003 rows 3-4: explicit `endpoint` is strict, never downgrades to local', () => {
  it('row 3: activates the endpoint provider when both URL and MODEL are set', () => {
    const cfg = loadEmbeddingConfig(endpointEnv({ CODEGRAPH_EMBEDDING_PROVIDER: 'endpoint' })) as EmbeddingConfig;
    expect(cfg.url).toBe(ENDPOINT_URL);
    expect(cfg.model).toBe(ENDPOINT_MODEL);
  });

  it('row 4: is a misconfig naming MODEL when only URL is set — never downgraded to local', () => {
    const cfg = loadEmbeddingConfig({
      CODEGRAPH_EMBEDDING_URL: ENDPOINT_URL,
      CODEGRAPH_EMBEDDING_PROVIDER: 'endpoint',
    });
    expect(cfg).toEqual({ misconfigured: true, missingVariable: 'CODEGRAPH_EMBEDDING_MODEL' });
  });

  it('row 4: is a misconfig naming URL when only MODEL is set — never downgraded to local', () => {
    const cfg = loadEmbeddingConfig({
      CODEGRAPH_EMBEDDING_MODEL: ENDPOINT_MODEL,
      CODEGRAPH_EMBEDDING_PROVIDER: 'endpoint',
    });
    expect(cfg).toEqual({ misconfigured: true, missingVariable: 'CODEGRAPH_EMBEDDING_URL' });
  });

  it('row 4: is a misconfig (never null, never local) naming BOTH vars when NEITHER URL nor MODEL is set', () => {
    // Both omitted still resolves to misconfig, not dormant — dormancy is reserved for
    // the "off" tail (explicit `off`, or no explicit selection with neither var set).
    // missingVariable stays CODEGRAPH_EMBEDDING_URL (checked first) for single-name
    // consumers, but missingVariables names BOTH so a renderer never claims the
    // counterpart is set. It must never be null and never carry `provider: 'local'`.
    const cfg = loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_PROVIDER: 'endpoint' });
    expect(cfg).toEqual({
      misconfigured: true,
      missingVariable: 'CODEGRAPH_EMBEDDING_URL',
      missingVariables: ['CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL'],
    });
  });
});

describe('loadEmbeddingConfig — FR-003 rows 5-7: NO explicit selection falls through to SPEC-001 UNCHANGED', () => {
  it('row 5: both URL and MODEL set → EmbeddingConfig (endpoint)', () => {
    const cfg = loadEmbeddingConfig(endpointEnv()) as EmbeddingConfig;
    expect(cfg.url).toBe(ENDPOINT_URL);
    expect(cfg.model).toBe(ENDPOINT_MODEL);
  });

  it('row 6: exactly one set → EmbeddingMisconfig naming the missing variable', () => {
    expect(loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_URL: ENDPOINT_URL })).toEqual({
      misconfigured: true,
      missingVariable: 'CODEGRAPH_EMBEDDING_MODEL',
    });
    expect(loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_MODEL: ENDPOINT_MODEL })).toEqual({
      misconfigured: true,
      missingVariable: 'CODEGRAPH_EMBEDDING_URL',
    });
  });

  it('row 7: neither set → null (dormant)', () => {
    expect(loadEmbeddingConfig({})).toBeNull();
  });
});

describe('loadEmbeddingConfig — `--embeddings` CLI flag override (FR-002)', () => {
  it('overrides CODEGRAPH_EMBEDDING_PROVIDER for one invocation: flag=local wins over env=endpoint', () => {
    const cfg = loadEmbeddingConfig(
      endpointEnv({ CODEGRAPH_EMBEDDING_PROVIDER: 'endpoint' }),
      'local',
    ) as EmbeddingLocalConfig;
    expect(cfg.provider).toBe('local');
  });

  it('overrides CODEGRAPH_EMBEDDING_PROVIDER for one invocation: flag=off wins over env=local', () => {
    expect(loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_PROVIDER: 'local' }, 'off')).toBeNull();
  });

  it('the flag alone is enough to select a provider when the env var is entirely unset', () => {
    const cfg = loadEmbeddingConfig({}, 'local') as EmbeddingLocalConfig;
    expect(cfg.provider).toBe('local');
  });

  it('falls back to the env var when no override is passed for this invocation', () => {
    const cfg = loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_PROVIDER: 'local' }) as EmbeddingLocalConfig;
    expect(cfg.provider).toBe('local');
  });
});

describe('loadEmbeddingConfig — a half-config is NEVER silently downgraded to off/local (FR-006 invariant)', () => {
  it('an explicit-endpoint half-config never resolves to null', () => {
    const cfg = loadEmbeddingConfig({
      CODEGRAPH_EMBEDDING_URL: ENDPOINT_URL,
      CODEGRAPH_EMBEDDING_PROVIDER: 'endpoint',
    });
    expect(cfg).not.toBeNull();
  });

  it('an explicit-endpoint half-config never carries `provider: "local"`', () => {
    const cfg = loadEmbeddingConfig({
      CODEGRAPH_EMBEDDING_URL: ENDPOINT_URL,
      CODEGRAPH_EMBEDDING_PROVIDER: 'endpoint',
    }) as EmbeddingMisconfig;
    expect('provider' in cfg).toBe(false);
  });

  it('an implicit half-config (no explicit selection) never resolves to null or local', () => {
    const cfg = loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_URL: ENDPOINT_URL }) as EmbeddingMisconfig;
    expect(cfg).not.toBeNull();
    expect('provider' in cfg).toBe(false);
  });
});

describe('loadEmbeddingConfig — unrecognized CODEGRAPH_EMBEDDING_PROVIDER value (spec.md Edge Cases "Misconfiguration")', () => {
  // Beyond the FR-003 7-row table itself, but part of FR-001's "exactly one of endpoint,
  // local, or off" contract: spec.md's Edge Cases section lists "an unrecognized provider
  // value" alongside URL/MODEL half-config as a Misconfiguration trigger — the structural
  // index still completes and the operator gets an actionable message rather than a crash.
  it('is a misconfig that NAMES the invalid value + the allowed set — not "missing"/"not set" (the variable IS set) (P2-1)', () => {
    const cfg = loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_PROVIDER: 'bogus' }) as EmbeddingMisconfig;
    expect(cfg.misconfigured).toBe(true);
    expect(cfg.missingVariable).toBe('CODEGRAPH_EMBEDDING_PROVIDER');
    // The distinct invalid-value shape: the offending value + the recognized set, so the
    // rendered guidance can say "must be one of: …" rather than the misleading "not set".
    expect(cfg.invalidValue).toBe('bogus');
    expect(cfg.allowedValues).toEqual(expect.arrayContaining(['local', 'endpoint', 'off']));
  });

  it('is a misconfig (still carrying the invalid value) even when a full endpoint config is otherwise present', () => {
    const cfg = loadEmbeddingConfig(endpointEnv({ CODEGRAPH_EMBEDDING_PROVIDER: 'bogus' })) as EmbeddingMisconfig;
    expect(cfg.misconfigured).toBe(true);
    expect(cfg.missingVariable).toBe('CODEGRAPH_EMBEDDING_PROVIDER');
    expect(cfg.invalidValue).toBe('bogus');
  });

  it('a genuinely MISSING variable (URL/MODEL half-config) carries NO invalidValue — the two misconfig shapes stay distinct (SPEC-001 unchanged)', () => {
    const half = loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_URL: ENDPOINT_URL }) as EmbeddingMisconfig;
    expect(half.missingVariable).toBe('CODEGRAPH_EMBEDDING_MODEL');
    expect(half.invalidValue).toBeUndefined();
    expect(half.allowedValues).toBeUndefined();
  });
});
