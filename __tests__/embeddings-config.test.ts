/**
 * Embedding configuration — unit tests (SPEC-001, T002).
 *
 * Pins the activation / half-config / redaction surface parsed from the
 * `CODEGRAPH_EMBEDDING_*` environment variables in `src/embeddings/config.ts`.
 * These are pure functions over an injected env object — no filesystem, no DB,
 * no network — so the suite needs no temp dirs or teardown.
 *
 * Traceability: FR-001 (activate iff URL+MODEL), FR-002 (dormant ⇒ null),
 * FR-001a/SC-009 (half-config names the missing variable), FR-003 (optional
 * key), FR-004 (optional dims + tunable clamp), FR-023 (endpoint redaction /
 * no credential leak). Env parse+clamp follows the `resolveParsePoolSize`
 * positive-int precedent in `src/extraction/parse-pool.ts`.
 */
import { describe, it, expect } from 'vitest';
import { loadEmbeddingConfig, redactEndpoint, isPlaintextRemoteEndpoint, plaintextRemoteWarning } from '../src/embeddings/config';
import type { EmbeddingConfig } from '../src/embeddings/config';

/** A base env with BOTH activation variables set, plus optional overrides. */
function activeEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    CODEGRAPH_EMBEDDING_URL: 'https://api.example.com',
    CODEGRAPH_EMBEDDING_MODEL: 'text-embedding-3-small',
    ...extra,
  };
}

describe('loadEmbeddingConfig — activation (FR-001 / FR-002 / FR-001a)', () => {
  it('is active when BOTH url and model are set (FR-001)', () => {
    const cfg = loadEmbeddingConfig(activeEnv()) as EmbeddingConfig;
    expect(cfg.url).toBe('https://api.example.com');
    expect(cfg.model).toBe('text-embedding-3-small');
  });

  it('returns null (fully dormant) when NEITHER url nor model is set (FR-002)', () => {
    expect(loadEmbeddingConfig({})).toBeNull();
  });

  it('returns null when both are present but blank/whitespace (FR-002)', () => {
    expect(loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_URL: '', CODEGRAPH_EMBEDDING_MODEL: '   ' })).toBeNull();
  });

  it('flags a half-config naming MODEL when only URL is set (FR-001a / SC-009)', () => {
    expect(loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_URL: 'https://api.example.com' })).toEqual({
      misconfigured: true,
      missingVariable: 'CODEGRAPH_EMBEDDING_MODEL',
    });
  });

  it('flags a half-config naming URL when only MODEL is set (FR-001a / SC-009)', () => {
    expect(loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_MODEL: 'text-embedding-3-small' })).toEqual({
      misconfigured: true,
      missingVariable: 'CODEGRAPH_EMBEDDING_URL',
    });
  });

  it('treats a whitespace-only URL alongside a real MODEL as a missing URL (half-config)', () => {
    expect(loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_URL: '   ', CODEGRAPH_EMBEDDING_MODEL: 'm' })).toEqual({
      misconfigured: true,
      missingVariable: 'CODEGRAPH_EMBEDDING_URL',
    });
  });

  it('distinguishes the half-config state from fully-dormant (SC-009)', () => {
    const dormant = loadEmbeddingConfig({});
    const half = loadEmbeddingConfig({ CODEGRAPH_EMBEDDING_URL: 'https://api.example.com' });
    expect(dormant).toBeNull();
    expect(half).not.toBeNull();
    expect(half).toHaveProperty('misconfigured', true);
  });

  it('trims surrounding whitespace from a stored url and model', () => {
    const cfg = loadEmbeddingConfig({
      CODEGRAPH_EMBEDDING_URL: '  https://api.example.com\n',
      CODEGRAPH_EMBEDDING_MODEL: ' text-embedding-3-small ',
    }) as EmbeddingConfig;
    expect(cfg.url).toBe('https://api.example.com');
    expect(cfg.model).toBe('text-embedding-3-small');
  });
});

describe('loadEmbeddingConfig — optional apiKey & dims (FR-003 / FR-004)', () => {
  it('omits apiKey when unset (keyless local endpoints — FR-003)', () => {
    const cfg = loadEmbeddingConfig(activeEnv()) as EmbeddingConfig;
    expect(cfg.apiKey).toBeUndefined();
  });

  it('captures apiKey when set (held in memory — FR-003)', () => {
    const cfg = loadEmbeddingConfig(activeEnv({ CODEGRAPH_EMBEDDING_API_KEY: 'sk-secret-key' })) as EmbeddingConfig;
    expect(cfg.apiKey).toBe('sk-secret-key');
  });

  it('omits dims when unset — to be inferred from the first batch (FR-004)', () => {
    const cfg = loadEmbeddingConfig(activeEnv()) as EmbeddingConfig;
    expect(cfg.dims).toBeUndefined();
  });

  it('parses a valid dims override (FR-004)', () => {
    const cfg = loadEmbeddingConfig(activeEnv({ CODEGRAPH_EMBEDDING_DIMS: '1536' })) as EmbeddingConfig;
    expect(cfg.dims).toBe(1536);
  });

  it('ignores an invalid dims, falling back to inference (FR-004)', () => {
    const cfg = loadEmbeddingConfig(activeEnv({ CODEGRAPH_EMBEDDING_DIMS: 'not-a-number' })) as EmbeddingConfig;
    expect(cfg.dims).toBeUndefined();
  });
});

describe('loadEmbeddingConfig — tunable parse + clamp (positive-int precedent)', () => {
  it('defaults batchSize=16, concurrency=4, timeoutMs=30000 when unset', () => {
    const cfg = loadEmbeddingConfig(activeEnv()) as EmbeddingConfig;
    expect(cfg.batchSize).toBe(16);
    expect(cfg.concurrency).toBe(4);
    expect(cfg.timeoutMs).toBe(30000);
  });

  it('parses valid positive-int tunables', () => {
    const cfg = loadEmbeddingConfig(
      activeEnv({
        CODEGRAPH_EMBEDDING_BATCH_SIZE: '32',
        CODEGRAPH_EMBEDDING_CONCURRENCY: '8',
        CODEGRAPH_EMBEDDING_TIMEOUT_MS: '60000',
      }),
    ) as EmbeddingConfig;
    expect(cfg.batchSize).toBe(32);
    expect(cfg.concurrency).toBe(8);
    expect(cfg.timeoutMs).toBe(60000);
  });

  it('floors a fractional tunable', () => {
    const cfg = loadEmbeddingConfig(activeEnv({ CODEGRAPH_EMBEDDING_BATCH_SIZE: '8.9' })) as EmbeddingConfig;
    expect(cfg.batchSize).toBe(8);
  });

  it.each([
    ['blank', ''],
    ['whitespace', '   '],
    ['non-numeric', 'abc'],
    ['negative', '-5'],
    ['zero', '0'],
  ])('falls back to defaults when a tunable is %s', (_label, value) => {
    const cfg = loadEmbeddingConfig(
      activeEnv({
        CODEGRAPH_EMBEDDING_BATCH_SIZE: value,
        CODEGRAPH_EMBEDDING_CONCURRENCY: value,
        CODEGRAPH_EMBEDDING_TIMEOUT_MS: value,
      }),
    ) as EmbeddingConfig;
    expect(cfg.batchSize).toBe(16);
    expect(cfg.concurrency).toBe(4);
    expect(cfg.timeoutMs).toBe(30000);
  });

  it('clamps a pathologically large tunable to its ceiling', () => {
    const cfg = loadEmbeddingConfig(
      activeEnv({
        CODEGRAPH_EMBEDDING_BATCH_SIZE: '999999',
        CODEGRAPH_EMBEDDING_CONCURRENCY: '999999',
        CODEGRAPH_EMBEDDING_TIMEOUT_MS: '999999999',
      }),
    ) as EmbeddingConfig;
    expect(cfg.batchSize).toBe(2048);
    expect(cfg.concurrency).toBe(64);
    expect(cfg.timeoutMs).toBe(600000);
  });
});

describe('redactEndpoint (FR-023)', () => {
  const dirty = 'https://user:secret@api.example.com:8443/v1/embeddings?token=abc';

  it('strips userinfo, path, and query to scheme + host + port', () => {
    expect(redactEndpoint(dirty)).toBe('https://api.example.com:8443');
  });

  it('never leaks embedded credentials, path, or query in the redacted form', () => {
    const out = redactEndpoint(dirty);
    for (const leak of ['user', 'secret', 'token', 'abc', 'v1', 'embeddings']) {
      expect(out).not.toContain(leak);
    }
  });

  it('omits the port when it is the scheme default', () => {
    expect(redactEndpoint('https://api.example.com/v1/embeddings')).toBe('https://api.example.com');
  });

  it('keeps a non-default port (local endpoint)', () => {
    expect(redactEndpoint('http://localhost:11434/v1/embeddings')).toBe('http://localhost:11434');
  });

  it('renders an unparseable URL as a safe placeholder — never the raw string', () => {
    const raw = '::://not-a-real-url';
    const out = redactEndpoint(raw);
    expect(out).not.toBe(raw);
    expect(out).not.toContain('not-a-real-url');
    expect(out).toBe('<invalid endpoint URL>');
  });

  it('never echoes a secret embedded in an unparseable URL (no err.input leak — FR-023)', () => {
    // `new URL('http://user:supersecret@')` throws ERR_INVALID_URL with the raw
    // string on `err.input`; the redactor must not let that string escape.
    const out = redactEndpoint('http://user:supersecret@');
    expect(out).not.toContain('supersecret');
    expect(out).toBe('<invalid endpoint URL>');
  });
});

describe('isPlaintextRemoteEndpoint (plaintext-remote advisory)', () => {
  it('flags plaintext http to a non-loopback host', () => {
    expect(isPlaintextRemoteEndpoint('http://10.0.0.5:11434/v1/embeddings')).toBe(true);
  });

  it('flags a plaintext remote even when it carries credentials', () => {
    expect(isPlaintextRemoteEndpoint('http://user:secret@10.0.0.5:11434')).toBe(true);
  });

  it('does not flag loopback http endpoints', () => {
    expect(isPlaintextRemoteEndpoint('http://localhost:11434')).toBe(false);
    expect(isPlaintextRemoteEndpoint('http://127.0.0.1')).toBe(false);
    expect(isPlaintextRemoteEndpoint('http://127.0.0.1:11434/v1')).toBe(false);
    expect(isPlaintextRemoteEndpoint('http://127.5.5.5:11434')).toBe(false);
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

describe('plaintextRemoteWarning (plaintext-remote advisory message — SHOULD-level, advisory-only)', () => {
  it('returns null for any https endpoint (encrypted in transit — no advisory)', () => {
    expect(plaintextRemoteWarning('https://api.example.com')).toBeNull();
    expect(plaintextRemoteWarning('https://10.1.2.3:8443')).toBeNull();
  });

  it('returns null for loopback-http endpoints (the designed local case)', () => {
    expect(plaintextRemoteWarning('http://localhost:11434')).toBeNull();
    expect(plaintextRemoteWarning('http://127.0.0.1:11434/v1')).toBeNull();
    expect(plaintextRemoteWarning('http://[::1]:11434')).toBeNull();
  });

  it('returns a one-line cleartext advisory for plaintext http to a non-loopback host', () => {
    const msg = plaintextRemoteWarning('http://10.1.2.3:11434');
    expect(msg).not.toBeNull();
    const line = msg as string;
    expect(line).not.toContain('\n'); // single line
    expect(line).toMatch(/cleartext|plaintext/i); // names the transport risk
    expect(line).toContain('10.1.2.3'); // the redacted endpoint host
    expect(line).toContain('https'); // suggests the fix
  });

  it('embeds the REDACTED endpoint, never userinfo or query credentials from the raw URL', () => {
    const msg = plaintextRemoteWarning('http://alice:s3cr3t@10.1.2.3:11434/v1/embeddings?apikey=leak789');
    expect(msg).not.toBeNull();
    const line = msg as string;
    expect(line).toContain('http://10.1.2.3:11434'); // scheme + host + port only
    for (const credential of ['alice', 's3cr3t', 'leak789']) {
      expect(line).not.toContain(credential);
    }
  });
});
