/**
 * LLM configuration resolution — unit tests (SPEC-018 slice 1, T003).
 *
 * Pins `loadLlmConfig(env): LlmConfigResult` against contracts/llm-config-resolution.md
 * (the full resolution table) and data-model §2 — the four-state discriminated union
 * `LlmEndpointConfig | LlmAgentConfig | LlmMisconfig | null`, mirroring
 * `loadEmbeddingConfig`. Also pins the OWN redaction/plaintext helpers (research D2 —
 * NOT imported from embeddings) and the `parsePositiveInt` clamp helper kept as the
 * pattern of record with no v1 call site (FR-007 clamp-vacuity).
 *
 * These are pure functions over an INJECTED env object (never process.env), so the
 * suite is hermetic — no filesystem, no DB, no network, no temp dirs, no teardown.
 *
 * Traceability: FR-001 (activate iff URL+MODEL), FR-002 (misconfig names the gap),
 * FR-003 (agent reached ONLY by explicit provider), FR-004 (dormant ⇒ null), FR-005
 * (apiKey memory-only, omitted when blank; never an activation var), FR-006 (endpoint
 * redaction + plaintext-remote advisory), FR-007 (positive-int clamp pattern of record).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// Default import (NOT `import * as fs`): vitest cannot spy on a frozen ESM
// namespace object, but the interop default is the configurable CJS module.
import fs from 'node:fs';
import {
  loadLlmConfig,
  redactEndpoint,
  isPlaintextRemoteEndpoint,
  plaintextRemoteWarning,
  parsePositiveInt,
} from '../src/llm/config';
import type { LlmEndpointConfig, LlmAgentConfig, LlmMisconfig } from '../src/llm/config';

const ENDPOINT_URL = 'https://api.example.com';
const ENDPOINT_MODEL = 'gpt-4o-mini';

/** A base env with BOTH activation variables set, plus optional overrides. */
function endpointEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    CODEGRAPH_LLM_URL: ENDPOINT_URL,
    CODEGRAPH_LLM_MODEL: ENDPOINT_MODEL,
    ...extra,
  };
}

describe('loadLlmConfig — explicit CODEGRAPH_LLM_PROVIDER=agent (FR-003)', () => {
  it('resolves to { mode: "agent" } regardless of URL/MODEL (agent is explicit-only)', () => {
    expect(loadLlmConfig(endpointEnv({ CODEGRAPH_LLM_PROVIDER: 'agent' }))).toEqual({ mode: 'agent' });
    expect(loadLlmConfig({ CODEGRAPH_LLM_PROVIDER: 'agent' })).toEqual({ mode: 'agent' });
  });

  it('carries NO url/model/apiKey on the agent config (a bare mode marker)', () => {
    const cfg = loadLlmConfig(
      endpointEnv({ CODEGRAPH_LLM_PROVIDER: 'agent', CODEGRAPH_LLM_API_KEY: 'sk-secret-key' }),
    ) as LlmAgentConfig;
    expect(cfg).toEqual({ mode: 'agent' });
    expect('apiKey' in cfg).toBe(false);
    // FR-005: an API key present in agent mode is still fully protected — never copied out.
    expect(JSON.stringify(cfg)).not.toContain('sk-secret-key');
  });

  it('agent wins over a fully-configured endpoint — present URL/MODEL is ignored, never auto-endpoint', () => {
    const cfg = loadLlmConfig(endpointEnv({ CODEGRAPH_LLM_PROVIDER: 'agent' })) as LlmAgentConfig;
    expect(cfg.mode).toBe('agent');
    expect('url' in cfg).toBe(false);
  });
});

describe('loadLlmConfig — explicit CODEGRAPH_LLM_PROVIDER=endpoint (strict; FR-001/FR-002)', () => {
  it('activates the endpoint provider when both URL and MODEL are set', () => {
    const cfg = loadLlmConfig(endpointEnv({ CODEGRAPH_LLM_PROVIDER: 'endpoint' })) as LlmEndpointConfig;
    expect(cfg.mode).toBe('endpoint');
    expect(cfg.url).toBe(ENDPOINT_URL);
    expect(cfg.model).toBe(ENDPOINT_MODEL);
  });

  it('is a misconfig naming URL when only MODEL is set', () => {
    expect(
      loadLlmConfig({ CODEGRAPH_LLM_MODEL: ENDPOINT_MODEL, CODEGRAPH_LLM_PROVIDER: 'endpoint' }),
    ).toEqual({ misconfigured: true, missingVariable: 'CODEGRAPH_LLM_URL' });
  });

  it('is a misconfig naming MODEL when only URL is set', () => {
    expect(
      loadLlmConfig({ CODEGRAPH_LLM_URL: ENDPOINT_URL, CODEGRAPH_LLM_PROVIDER: 'endpoint' }),
    ).toEqual({ misconfigured: true, missingVariable: 'CODEGRAPH_LLM_MODEL' });
  });

  it('names BOTH vars (missingVariable + missingVariables) when NEITHER URL nor MODEL is set', () => {
    // Never null, never a silent downgrade: missingVariable stays URL for single-name
    // consumers, missingVariables names both so a renderer never claims one is set.
    expect(loadLlmConfig({ CODEGRAPH_LLM_PROVIDER: 'endpoint' })).toEqual({
      misconfigured: true,
      missingVariable: 'CODEGRAPH_LLM_URL',
      missingVariables: ['CODEGRAPH_LLM_URL', 'CODEGRAPH_LLM_MODEL'],
    });
  });
});

describe('loadLlmConfig — unrecognized CODEGRAPH_LLM_PROVIDER value (FR-002)', () => {
  it('is a misconfig NAMING the invalid value + allowedValues ["endpoint","agent"] — not "missing"', () => {
    const cfg = loadLlmConfig({ CODEGRAPH_LLM_PROVIDER: 'local' }) as LlmMisconfig;
    expect(cfg.misconfigured).toBe(true);
    expect(cfg.missingVariable).toBe('CODEGRAPH_LLM_PROVIDER');
    expect(cfg.invalidValue).toBe('local');
    expect(cfg.allowedValues).toEqual(['endpoint', 'agent']);
  });

  it('rejects an unrecognized value even when a full endpoint config is otherwise present', () => {
    const cfg = loadLlmConfig(endpointEnv({ CODEGRAPH_LLM_PROVIDER: 'off' })) as LlmMisconfig;
    expect(cfg.misconfigured).toBe(true);
    expect(cfg.invalidValue).toBe('off');
    expect(cfg.allowedValues).toEqual(['endpoint', 'agent']);
  });

  it('a genuinely MISSING variable (half-config) carries NO invalidValue/allowedValues — distinct shapes', () => {
    const half = loadLlmConfig({ CODEGRAPH_LLM_URL: ENDPOINT_URL }) as LlmMisconfig;
    expect(half.missingVariable).toBe('CODEGRAPH_LLM_MODEL');
    expect(half.invalidValue).toBeUndefined();
    expect(half.allowedValues).toBeUndefined();
  });
});

describe('loadLlmConfig — no explicit provider: auto-endpoint / half-config / dormant (FR-001/FR-002/FR-004)', () => {
  it('auto-activates the endpoint when BOTH URL and MODEL are set and no provider is given', () => {
    const cfg = loadLlmConfig(endpointEnv()) as LlmEndpointConfig;
    expect(cfg.mode).toBe('endpoint');
    expect(cfg.url).toBe(ENDPOINT_URL);
    expect(cfg.model).toBe(ENDPOINT_MODEL);
  });

  it('is a misconfig naming MODEL when only URL is set', () => {
    expect(loadLlmConfig({ CODEGRAPH_LLM_URL: ENDPOINT_URL })).toEqual({
      misconfigured: true,
      missingVariable: 'CODEGRAPH_LLM_MODEL',
    });
  });

  it('is a misconfig naming URL when only MODEL is set', () => {
    expect(loadLlmConfig({ CODEGRAPH_LLM_MODEL: ENDPOINT_MODEL })).toEqual({
      misconfigured: true,
      missingVariable: 'CODEGRAPH_LLM_URL',
    });
  });

  it('is null (fully dormant) when NEITHER URL nor MODEL is set (FR-004)', () => {
    expect(loadLlmConfig({})).toBeNull();
  });

  it('is null when URL/MODEL are present but blank/whitespace only', () => {
    expect(loadLlmConfig({ CODEGRAPH_LLM_URL: '', CODEGRAPH_LLM_MODEL: '   ' })).toBeNull();
  });

  it('treats a whitespace-only provider as unset — falls through to auto-endpoint', () => {
    const cfg = loadLlmConfig(endpointEnv({ CODEGRAPH_LLM_PROVIDER: '   ' })) as LlmEndpointConfig;
    expect(cfg.mode).toBe('endpoint');
  });

  it('trims surrounding whitespace from url and model', () => {
    const cfg = loadLlmConfig({
      CODEGRAPH_LLM_URL: '  https://api.example.com\n',
      CODEGRAPH_LLM_MODEL: ' gpt-4o-mini ',
    }) as LlmEndpointConfig;
    expect(cfg.url).toBe('https://api.example.com');
    expect(cfg.model).toBe('gpt-4o-mini');
  });
});

describe('loadLlmConfig — CODEGRAPH_LLM_API_KEY (FR-005: memory-only, not an activation var)', () => {
  it('API-key-only (no URL/MODEL/provider) resolves to null dormant — the key is never an activation var', () => {
    expect(loadLlmConfig({ CODEGRAPH_LLM_API_KEY: 'sk-secret-key' })).toBeNull();
  });

  it('attaches apiKey in memory in endpoint mode when set', () => {
    const cfg = loadLlmConfig(endpointEnv({ CODEGRAPH_LLM_API_KEY: 'sk-secret-key' })) as LlmEndpointConfig;
    expect(cfg.apiKey).toBe('sk-secret-key');
  });

  it('omits apiKey entirely when unset (keyless local endpoints)', () => {
    const cfg = loadLlmConfig(endpointEnv()) as LlmEndpointConfig;
    expect(cfg.apiKey).toBeUndefined();
    expect('apiKey' in cfg).toBe(false);
  });

  it('omits apiKey entirely when blank/whitespace', () => {
    const blank = loadLlmConfig(endpointEnv({ CODEGRAPH_LLM_API_KEY: '' })) as LlmEndpointConfig;
    const spaces = loadLlmConfig(endpointEnv({ CODEGRAPH_LLM_API_KEY: '   ' })) as LlmEndpointConfig;
    expect('apiKey' in blank).toBe(false);
    expect('apiKey' in spaces).toBe(false);
  });

  it('trims the apiKey value when set', () => {
    const cfg = loadLlmConfig(endpointEnv({ CODEGRAPH_LLM_API_KEY: '  sk-secret-key  ' })) as LlmEndpointConfig;
    expect(cfg.apiKey).toBe('sk-secret-key');
  });
});

describe('redactEndpoint (FR-006 — own copy, not imported from embeddings)', () => {
  const dirty = 'https://user:secret@api.example.com:8443/v1/chat/completions?token=abc';

  it('strips userinfo, path, and query to scheme + host + port', () => {
    expect(redactEndpoint(dirty)).toBe('https://api.example.com:8443');
  });

  it('never leaks embedded credentials, path, or query', () => {
    const out = redactEndpoint(dirty);
    for (const leak of ['user', 'secret', 'token', 'abc', 'v1', 'chat', 'completions']) {
      expect(out).not.toContain(leak);
    }
  });

  it('omits the port when it is the scheme default', () => {
    expect(redactEndpoint('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com');
  });

  it('keeps a non-default port (local endpoint)', () => {
    expect(redactEndpoint('http://localhost:11434/v1/chat/completions')).toBe('http://localhost:11434');
  });

  it('renders an unparseable URL as a safe placeholder — never the raw string', () => {
    const out = redactEndpoint('::://not-a-real-url');
    expect(out).not.toContain('not-a-real-url');
    expect(out).toBe('<invalid endpoint URL>');
  });

  it('never echoes a secret embedded in an unparseable URL (no err.input leak)', () => {
    const out = redactEndpoint('http://user:supersecret@');
    expect(out).not.toContain('supersecret');
    expect(out).toBe('<invalid endpoint URL>');
  });
});

describe('isPlaintextRemoteEndpoint (FR-006 — own copy)', () => {
  it('flags plaintext http to a non-loopback host', () => {
    expect(isPlaintextRemoteEndpoint('http://10.0.0.5:11434/v1/chat')).toBe(true);
  });

  it('flags a plaintext remote even when it carries credentials', () => {
    expect(isPlaintextRemoteEndpoint('http://user:secret@10.0.0.5:11434')).toBe(true);
  });

  it('does not flag loopback http endpoints (the designed local case)', () => {
    expect(isPlaintextRemoteEndpoint('http://localhost:11434')).toBe(false);
    expect(isPlaintextRemoteEndpoint('http://127.0.0.1')).toBe(false);
    expect(isPlaintextRemoteEndpoint('http://[::1]:11434')).toBe(false);
  });

  it('does not flag any https endpoint (encrypted in transit)', () => {
    expect(isPlaintextRemoteEndpoint('https://api.example.com')).toBe(false);
    expect(isPlaintextRemoteEndpoint('https://10.0.0.5:8443')).toBe(false);
  });

  it('does not throw on an unparseable URL (returns false)', () => {
    expect(isPlaintextRemoteEndpoint('not a url')).toBe(false);
  });
});

describe('plaintextRemoteWarning (FR-006 — LLM-worded advisory, advisory-only)', () => {
  it('returns null for any https endpoint (no advisory)', () => {
    expect(plaintextRemoteWarning('https://api.example.com')).toBeNull();
    expect(plaintextRemoteWarning('https://10.1.2.3:8443')).toBeNull();
  });

  it('returns null for loopback-http endpoints (the designed local case)', () => {
    expect(plaintextRemoteWarning('http://localhost:11434')).toBeNull();
    expect(plaintextRemoteWarning('http://127.0.0.1:11434/v1')).toBeNull();
    expect(plaintextRemoteWarning('http://[::1]:11434')).toBeNull();
  });

  it('returns a one-line LLM-worded cleartext advisory for plaintext http to a non-loopback host', () => {
    const msg = plaintextRemoteWarning('http://10.1.2.3:11434');
    expect(msg).not.toBeNull();
    const line = msg as string;
    expect(line).not.toContain('\n'); // single line
    expect(line).toMatch(/cleartext|plaintext/i); // names the transport risk
    expect(line).toContain('LLM'); // LLM-worded, NOT "embedding" (research D2)
    expect(line).not.toMatch(/embedding/i);
    expect(line).toContain('10.1.2.3'); // the redacted endpoint host
    expect(line).toContain('https'); // suggests the fix
  });

  it('embeds the REDACTED endpoint, never userinfo or query credentials from the raw URL', () => {
    const msg = plaintextRemoteWarning('http://alice:s3cr3t@10.1.2.3:11434/v1/chat?apikey=leak789');
    expect(msg).not.toBeNull();
    const line = msg as string;
    expect(line).toContain('http://10.1.2.3:11434'); // scheme + host + port only
    for (const credential of ['alice', 's3cr3t', 'leak789']) {
      expect(line).not.toContain(credential);
    }
  });
});

describe('parsePositiveInt (FR-007 — pattern of record; no v1 call site)', () => {
  it('parses a valid positive integer', () => {
    expect(parsePositiveInt('32', 8, 2048)).toBe(32);
  });

  it('floors a fractional value', () => {
    expect(parsePositiveInt('8.9', 4, 2048)).toBe(8);
  });

  it('clamps a pathologically large value to the ceiling', () => {
    expect(parsePositiveInt('999999', 4, 2048)).toBe(2048);
  });

  it.each([
    ['undefined', undefined],
    ['blank', ''],
    ['whitespace', '   '],
    ['non-numeric', 'abc'],
    ['negative', '-5'],
    ['zero', '0'],
  ])('falls back to the default when the raw value is %s', (_label, value) => {
    expect(parsePositiveInt(value, 4, 2048)).toBe(4);
  });
});

describe('loadLlmConfig — hermetic: zero network, zero filesystem at resolution', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never opens a socket or touches the filesystem across every resolution branch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const readFileSpy = vi.spyOn(fs, 'readFileSync');
    const statSpy = vi.spyOn(fs, 'statSync');
    const readdirSpy = vi.spyOn(fs, 'readdirSync');
    const existsSpy = vi.spyOn(fs, 'existsSync');
    const openSpy = vi.spyOn(fs, 'openSync');

    loadLlmConfig({}); // dormant
    loadLlmConfig(endpointEnv()); // auto-endpoint
    loadLlmConfig(endpointEnv({ CODEGRAPH_LLM_PROVIDER: 'agent' })); // agent
    loadLlmConfig(endpointEnv({ CODEGRAPH_LLM_API_KEY: 'sk-secret-key' })); // endpoint + key
    loadLlmConfig({ CODEGRAPH_LLM_PROVIDER: 'endpoint' }); // misconfig
    loadLlmConfig({ CODEGRAPH_LLM_PROVIDER: 'nonsense' }); // invalid provider
    loadLlmConfig({ CODEGRAPH_LLM_URL: ENDPOINT_URL }); // half-config

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readFileSpy).not.toHaveBeenCalled();
    expect(statSpy).not.toHaveBeenCalled();
    expect(readdirSpy).not.toHaveBeenCalled();
    expect(existsSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});
