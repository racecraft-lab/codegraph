/**
 * EndpointProvider — OpenAI-compatible HTTP embedding client (SPEC-001, T014/T015).
 *
 * Integration tests against a local `node:http` mock endpoint (ephemeral port,
 * deterministic vectors) exercising the real global `fetch` + `AbortSignal.timeout`
 * transport — no fetch mocking. Each case maps to the wire contract in
 * `specs/001-embedding-infrastructure/contracts/embedding-provider.md` §2 and its
 * error table.
 *
 * Traceability: FR-003 (key optional; 401/403 non-retryable), FR-019/FR-019a
 * (bounded retry/abort; per-request timeout on a hang), FR-021 (dims conflict names
 * CODEGRAPH_EMBEDDING_DIMS), FR-021a (response validation / count match),
 * FR-023 (recursive key + URL-credential redaction; full error replacement),
 * FR-025 (no new dependency — built-in fetch).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EndpointProvider } from '../src/embeddings/endpoint-provider';
import type { EndpointProviderOverrides } from '../src/embeddings/endpoint-provider';
import type { EmbeddingProvider } from '../src/embeddings/provider';
import type { EmbeddingConfig } from '../src/embeddings/config';

// --- deterministic vectors ------------------------------------------------
// Content-derived, 4-dim, every component exactly representable in f32 so the
// JSON(float64) → Float32Array round-trip is loss-free and assertions are stable.
function vecForText(text: string): number[] {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return [h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff, 0.5];
}

function expectVecEqual(actual: Float32Array, expected: number[]): void {
  expect(actual).toBeInstanceOf(Float32Array);
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], 5);
  }
}

// --- mock endpoint --------------------------------------------------------
interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
type MockReply = { status: number; headers?: Record<string, string>; body?: string };
// 'hang' = receive but never answer (per-request timeout path). 'destroy-mid-body' =
// send 200 headers + a truncated body then reset the socket (a transport failure DURING
// the body read, distinct from a well-formed-but-invalid-JSON body).
type MockHandler = (req: RecordedRequest, count: number) => MockReply | 'hang' | 'destroy-mid-body';

interface MockServer {
  port: number;
  origin: string;
  requests: RecordedRequest[];
  getMaxInFlight: () => number;
  close: () => Promise<void>;
}

const openServers: MockServer[] = [];

async function startMock(handler: MockHandler, opts: { delayMs?: number } = {}): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let closed = false;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const rec: RecordedRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(rec);
      const reply = handler(rec, requests.length);
      if (reply === 'hang') {
        inFlight--; // received, but deliberately never answered
        return;
      }
      if (reply === 'destroy-mid-body') {
        // Deliver 200 headers + a partial body so `fetch()` RESOLVES the Response, then
        // reset the socket on a LATER tick so the failure lands during `response.text()`
        // (the body read) — NOT during `fetch()` itself, and NOT as a well-formed but
        // invalid-JSON body. content-length promises far more than is ever sent. Swallow
        // the reset we are about to cause on the server side.
        res.socket?.on('error', () => {});
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': '4096' });
        res.write('{"data":[{"index":0,"embedding":[0.1');
        setTimeout(() => res.socket?.destroy(), 20);
        inFlight--;
        return;
      }
      const send = (): void => {
        res.writeHead(reply.status, { 'content-type': 'application/json', ...(reply.headers ?? {}) });
        res.end(reply.body ?? '', () => {
          inFlight--;
        });
      };
      if (opts.delayMs) setTimeout(send, opts.delayMs);
      else send();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const mock: MockServer = {
    port,
    origin: `http://127.0.0.1:${port}`,
    requests,
    getMaxInFlight: () => maxInFlight,
    close: () =>
      new Promise<void>((resolve) => {
        if (closed) return resolve();
        closed = true;
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
  openServers.push(mock);
  return mock;
}

/** Success reply that re-orders `data` (reversed) to prove the provider sorts by `index`. */
function embeddingsReply(req: RecordedRequest): MockReply {
  const parsed = JSON.parse(req.body) as { model: string; input: string[] };
  const data = parsed.input.map((text, index) => ({ index, embedding: vecForText(text) }));
  data.reverse();
  return { status: 200, body: JSON.stringify({ data, model: parsed.model, usage: { prompt_tokens: 0, total_tokens: 0 } }) };
}

/** An ephemeral loopback port that is guaranteed closed (bind → capture → close). */
async function getClosedPort(): Promise<number> {
  const mock = await startMock(() => ({ status: 200, body: '{}' }));
  const { port } = mock;
  await mock.close();
  return port;
}

// --- config + provider helpers -------------------------------------------
function makeConfig(overrides: Partial<EmbeddingConfig> & { url: string }): EmbeddingConfig {
  return {
    url: overrides.url,
    model: overrides.model ?? 'test-model',
    apiKey: overrides.apiKey,
    dims: overrides.dims,
    batchSize: overrides.batchSize ?? 16,
    concurrency: overrides.concurrency ?? 4,
    timeoutMs: overrides.timeoutMs ?? 1000,
  };
}

/** Tiny backoff so retry paths run in milliseconds; production retry count (3) kept. */
const FAST: EndpointProviderOverrides = { baseDelayMs: 1, maxDelayMs: 4 };

/** Await a promise expected to reject; return the rejection value. */
async function captureReject(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

/**
 * Walk an error exhaustively — message, stack, every own property (JSON view over
 * `Object.getOwnPropertyNames`, enumerable or not), and the entire `cause` chain —
 * and assert none of the secrets appear anywhere (FR-023).
 */
function collectErrorText(value: unknown, seen: Set<unknown> = new Set()): string {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return String(value);
  }
  if (seen.has(value)) return '';
  seen.add(value);
  const obj = value as Record<string, unknown>;
  const names = Object.getOwnPropertyNames(obj);
  const parts: string[] = [];
  try {
    parts.push(JSON.stringify(obj, names));
  } catch {
    /* circular — the per-property pass below still covers it */
  }
  for (const name of names) {
    let v: unknown;
    try {
      v = obj[name];
    } catch {
      continue;
    }
    if (name === 'cause') {
      parts.push(collectErrorText(v, seen));
    } else {
      parts.push(String(v));
    }
  }
  return parts.join('\n');
}

function assertNoLeak(err: unknown, secrets: string[]): void {
  const blob = collectErrorText(err);
  for (const secret of secrets) {
    expect(blob).not.toContain(secret);
  }
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((m) => m.close()));
});

// =========================================================================
describe('EndpointProvider — interface conformance', () => {
  it('conforms to EmbeddingProvider (id, dims, embed)', () => {
    const provider = new EndpointProvider(
      makeConfig({ url: 'http://127.0.0.1:9/v1/embeddings', model: 'my-model' }),
      FAST,
    );
    const asProvider: EmbeddingProvider = provider; // structural conformance (compile-time)
    expect(asProvider.id).toBe('my-model');
    expect(asProvider.dims).toBe(0); // unknown until the first successful batch
    expect(typeof asProvider.embed).toBe('function');
  });
});

describe('EndpointProvider — success, ordering, dimension inference', () => {
  it('embeds a batch, preserves order despite shuffled response indices, infers dims, and sends the §2 wire shape', async () => {
    const mock = await startMock((req) => embeddingsReply(req));
    const provider = new EndpointProvider(
      makeConfig({ url: `${mock.origin}/v1/embeddings`, model: 'text-embedding-3-small' }),
      FAST,
    );
    expect(provider.dims).toBe(0);

    const inputs = ['first-input', 'second-input', 'third-input'];
    const result = await provider.embed(inputs);

    // request wire shape (contract §2)
    const req = mock.requests[0];
    expect(mock.requests).toHaveLength(1);
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/v1/embeddings');
    expect(String(req.headers['content-type'])).toContain('application/json');
    expect(JSON.parse(req.body)).toEqual({ model: 'text-embedding-3-small', input: inputs });

    // order preserved even though the mock reversed `data`
    expect(result).toHaveLength(3);
    for (let i = 0; i < inputs.length; i++) expectVecEqual(result[i], vecForText(inputs[i]));

    // dims inferred from the first successful batch
    expect(provider.dims).toBe(4);
  });

  it('splits inputs into batchSize-bounded requests and reassembles the global order', async () => {
    const mock = await startMock((req) => embeddingsReply(req));
    const provider = new EndpointProvider(
      makeConfig({ url: `${mock.origin}/v1/embeddings`, batchSize: 2 }),
      FAST,
    );
    const inputs = ['t0', 't1', 't2', 't3', 't4']; // 5 inputs, batchSize 2 → 3 requests
    const result = await provider.embed(inputs);

    expect(mock.requests).toHaveLength(3);
    for (const r of mock.requests) {
      expect((JSON.parse(r.body).input as string[]).length).toBeLessThanOrEqual(2);
    }
    expect(result).toHaveLength(5);
    for (let i = 0; i < inputs.length; i++) expectVecEqual(result[i], vecForText(inputs[i]));
  });

  it('bounds in-flight requests to the configured concurrency', async () => {
    const mock = await startMock((req) => embeddingsReply(req), { delayMs: 40 });
    const provider = new EndpointProvider(
      makeConfig({ url: `${mock.origin}/v1/embeddings`, batchSize: 1, concurrency: 2 }),
      FAST,
    );
    const inputs = ['a', 'b', 'c', 'd', 'e', 'f']; // 6 batches
    const result = await provider.embed(inputs);

    expect(mock.requests).toHaveLength(6);
    expect(mock.getMaxInFlight()).toBeLessThanOrEqual(2); // hard bound
    expect(mock.getMaxInFlight()).toBeGreaterThan(1); // actually parallelized
    for (let i = 0; i < inputs.length; i++) expectVecEqual(result[i], vecForText(inputs[i]));
  });
});

describe('EndpointProvider — authorization (FR-003)', () => {
  it('sends Authorization: Bearer when an API key is configured', async () => {
    const mock = await startMock((req) => embeddingsReply(req));
    const provider = new EndpointProvider(
      makeConfig({ url: `${mock.origin}/v1/embeddings`, apiKey: 'sk-abc-123' }),
      FAST,
    );
    await provider.embed(['x']);
    expect(mock.requests[0].headers['authorization']).toBe('Bearer sk-abc-123');
  });

  it('omits the Authorization header entirely when keyless', async () => {
    const mock = await startMock((req) => embeddingsReply(req));
    const provider = new EndpointProvider(makeConfig({ url: `${mock.origin}/v1/embeddings` }), FAST);
    await provider.embed(['x']);
    expect(mock.requests[0].headers['authorization']).toBeUndefined();
  });
});

describe('EndpointProvider — retry & backoff (FR-019)', () => {
  it('retries a transient 5xx and then succeeds (budget consumed)', async () => {
    const mock = await startMock((req, count) =>
      count === 1 ? { status: 500, body: 'oops' } : embeddingsReply(req),
    );
    const provider = new EndpointProvider(makeConfig({ url: `${mock.origin}/v1/embeddings` }), FAST);
    const result = await provider.embed(['alpha', 'beta']);

    expect(mock.requests).toHaveLength(2); // 1 failure + 1 success
    expectVecEqual(result[0], vecForText('alpha'));
    expectVecEqual(result[1], vecForText('beta'));
  });

  it('honors (and caps) Retry-After on a 429, then succeeds', async () => {
    const mock = await startMock((req, count) =>
      count === 1 ? { status: 429, headers: { 'retry-after': '1' }, body: 'slow down' } : embeddingsReply(req),
    );
    const provider = new EndpointProvider(
      makeConfig({ url: `${mock.origin}/v1/embeddings` }),
      { baseDelayMs: 1, maxDelayMs: 4, retryAfterCapMs: 80 }, // Retry-After: 1s → capped to 80ms
    );
    const start = Date.now();
    const result = await provider.embed(['x']);
    const elapsed = Date.now() - start;

    expect(mock.requests).toHaveLength(2);
    expect(elapsed).toBeGreaterThanOrEqual(50); // honored — far above the ~1ms base backoff
    expect(elapsed).toBeLessThan(900); // capped — far below the 1000ms Retry-After
    expectVecEqual(result[0], vecForText('x'));
  });

  it('exhausts the bounded retry budget on a persistent 5xx and rejects (1 initial + 3 retries)', async () => {
    const mock = await startMock(() => ({ status: 503, body: '{"error":"unavailable"}' }));
    const provider = new EndpointProvider(
      makeConfig({ url: `${mock.origin}/v1/embeddings?api_key=xyz`, apiKey: 'sk-topsecret-KEY' }),
      FAST,
    );
    const err = await captureReject(provider.embed(['x']));

    expect(err.name).toBe('EmbeddingEndpointError');
    expect(err.status).toBe(503);
    expect(mock.requests).toHaveLength(4);
    assertNoLeak(err, ['sk-topsecret-KEY', 'xyz']);
  });

  it('converts a hanging endpoint into a bounded per-request timeout failure (FR-019a)', async () => {
    const mock = await startMock(() => 'hang');
    const provider = new EndpointProvider(
      makeConfig({ url: `${mock.origin}/v1/embeddings?api_key=xyz`, apiKey: 'sk-topsecret-KEY', timeoutMs: 60 }),
      FAST,
    );
    const start = Date.now();
    const err = await captureReject(provider.embed(['x']));
    const elapsed = Date.now() - start;

    expect(err.name).toBe('EmbeddingEndpointError');
    expect(mock.requests).toHaveLength(4); // every attempt hung then timed out
    expect(elapsed).toBeLessThan(2000); // bounded, not an unbounded hang
    assertNoLeak(err, ['sk-topsecret-KEY', 'xyz']);
  });
});

describe('EndpointProvider — non-retryable fast-abort (FR-003 / FR-019)', () => {
  it.each([401, 403])('fast-aborts on HTTP %i without consuming the retry budget', async (status) => {
    const mock = await startMock(() => ({ status, body: '{"error":"nope"}' }));
    const provider = new EndpointProvider(
      makeConfig({ url: `${mock.origin}/v1/embeddings?api_key=xyz`, apiKey: 'sk-topsecret-KEY' }),
      FAST,
    );
    const err = await captureReject(provider.embed(['x']));

    expect(err.name).toBe('EmbeddingEndpointError');
    expect(err.status).toBe(status);
    expect(mock.requests).toHaveLength(1); // no retries
    assertNoLeak(err, ['sk-topsecret-KEY', 'xyz']);
  });

  it.each([400, 404, 422])('fast-aborts on non-retryable HTTP %i', async (status) => {
    const mock = await startMock(() => ({ status, body: '{"error":"bad request"}' }));
    const provider = new EndpointProvider(makeConfig({ url: `${mock.origin}/v1/embeddings` }), FAST);
    const err = await captureReject(provider.embed(['x']));

    expect(err.name).toBe('EmbeddingEndpointError');
    expect(err.status).toBe(status);
    expect(mock.requests).toHaveLength(1);
  });

  it('never leaks an API key echoed back inside a 401 response body', async () => {
    const key = 'sk-topsecret-KEY';
    const mock = await startMock(() => ({ status: 401, body: JSON.stringify({ error: `invalid api key ${key}` }) }));
    const provider = new EndpointProvider(makeConfig({ url: `${mock.origin}/v1/embeddings`, apiKey: key }), FAST);
    const err = await captureReject(provider.embed(['x']));

    expect(mock.requests).toHaveLength(1);
    assertNoLeak(err, [key]);
  });
});

describe('EndpointProvider — response validation (FR-021a)', () => {
  it('fails the batch on a 200 with a non-JSON body (nothing returned)', async () => {
    const mock = await startMock(() => ({ status: 200, body: 'not json <html>error</html>' }));
    const provider = new EndpointProvider(
      makeConfig({ url: `${mock.origin}/v1/embeddings?api_key=xyz`, apiKey: 'sk-topsecret-KEY' }),
      FAST,
    );
    const err = await captureReject(provider.embed(['x']));

    expect(err.name).toBe('EmbeddingEndpointError');
    expect(mock.requests).toHaveLength(1); // malformed → fast advisory abort
    assertNoLeak(err, ['sk-topsecret-KEY', 'xyz']);
  });

  it('fails the batch when the 200 response has no data array', async () => {
    const mock = await startMock(() => ({ status: 200, body: JSON.stringify({ model: 'm', usage: {} }) }));
    const provider = new EndpointProvider(makeConfig({ url: `${mock.origin}/v1/embeddings` }), FAST);
    const err = await captureReject(provider.embed(['x']));

    expect(err.name).toBe('EmbeddingEndpointError');
    expect(mock.requests).toHaveLength(1);
  });

  it('fails the batch when the embedding count does not match the input count', async () => {
    const mock = await startMock(() => ({ status: 200, body: JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }] }) }));
    const provider = new EndpointProvider(makeConfig({ url: `${mock.origin}/v1/embeddings` }), FAST);
    const err = await captureReject(provider.embed(['a', 'b', 'c'])); // 3 inputs, 1 embedding

    expect(err.name).toBe('EmbeddingEndpointError');
    expect(mock.requests).toHaveLength(1);
  });
});

describe('EndpointProvider — mid-body transport failure on a 200 (FIX 3 / FR-019)', () => {
  it('classifies a socket reset DURING the 200-body read as a RETRYABLE network error, not a non-retryable malformed-body abort', async () => {
    // Headers say 200 (response.ok), so we enter the body-read path — then the socket is
    // reset mid-body. That read failure is a transport error, and it must be retried like
    // any other network failure, NOT misclassified as "response body was not valid JSON".
    const mock = await startMock(() => 'destroy-mid-body');
    const provider = new EndpointProvider(
      makeConfig({ url: `${mock.origin}/v1/embeddings?api_key=xyz`, apiKey: 'sk-topsecret-KEY' }),
      FAST,
    );
    const err = await captureReject(provider.embed(['x']));

    expect(err.name).toBe('EmbeddingEndpointError');
    // The full bounded budget (1 initial + 3 retries) was consumed — proof the read
    // failure was treated as retryable, not fast-aborted after a single request.
    expect(mock.requests).toHaveLength(4);
    assertNoLeak(err, ['sk-topsecret-KEY', 'xyz']);
  });
});

describe('EndpointProvider — empty embedding rejected (FIX 5 / FR-021a)', () => {
  it('rejects a 200 whose embedding array is empty instead of accepting length 0 as an inferred dimension', async () => {
    // A zero-length embedding is a malformed response, not "dimension unknown". It must be
    // a non-retryable validation failure — never latched as dims=0 (which the pass would
    // then persist as a bogus embedding_dims=0 scalar).
    const mock = await startMock(() => ({ status: 200, body: JSON.stringify({ data: [{ index: 0, embedding: [] }] }) }));
    const provider = new EndpointProvider(makeConfig({ url: `${mock.origin}/v1/embeddings` }), FAST);

    const err = await captureReject(provider.embed(['x']));

    expect(err.name).toBe('EmbeddingEndpointError');
    expect(mock.requests).toHaveLength(1); // non-retryable validation failure — no retry storm
    expect(provider.dims).toBe(0);         // the empty array was NOT latched as a real dimension
  });

  it('rejects a 200 whose embedding contains a non-finite value (null/NaN would persist as garbage bytes)', async () => {
    // A non-numeric JSON element becomes NaN under Float32Array.from (note: null coerces
    // to 0, so a string is the real NaN carrier); persisting it would store garbage
    // vector bytes. Must fail validation, non-retryable.
    const mock = await startMock(() => ({ status: 200, body: JSON.stringify({ data: [{ index: 0, embedding: [0.1, 'not-a-number', 0.3] }] }) }));
    const provider = new EndpointProvider(makeConfig({ url: `${mock.origin}/v1/embeddings` }), FAST);

    const err = await captureReject(provider.embed(['x']));

    expect(err.name).toBe('EmbeddingEndpointError');
    expect(err.message).toContain('non-finite');
    expect(mock.requests).toHaveLength(1); // validation failure — no retry budget consumed
  });
});

describe('EndpointProvider — dimension enforcement (FR-021)', () => {
  it('rejects with a CODEGRAPH_EMBEDDING_DIMS error when a later vector length conflicts', async () => {
    const mock = await startMock((req, count) => {
      const parsed = JSON.parse(req.body) as { input: string[] };
      const dims = count === 1 ? 4 : 5; // first batch establishes 4, second returns 5
      const data = parsed.input.map((_t, index) => ({
        index,
        embedding: Array.from({ length: dims }, (_v, k) => k * 0.5),
      }));
      return { status: 200, body: JSON.stringify({ data }) };
    });
    const provider = new EndpointProvider(makeConfig({ url: `${mock.origin}/v1/embeddings` }), FAST);

    const first = await provider.embed(['a']);
    expect(first[0].length).toBe(4);
    expect(provider.dims).toBe(4);

    const err = await captureReject(provider.embed(['b']));
    expect(String(err.message)).toContain('CODEGRAPH_EMBEDDING_DIMS');
  });
});

describe('EndpointProvider — full error replacement / redaction (FR-023)', () => {
  it('replaces a genuine network error and leaks neither the key nor the query credential', async () => {
    const port = await getClosedPort();
    const provider = new EndpointProvider(
      makeConfig({ url: `http://127.0.0.1:${port}/v1/embeddings?api_key=xyz`, apiKey: 'sk-topsecret-KEY' }),
      FAST,
    );
    const err = await captureReject(provider.embed(['x']));

    expect(err.name).toBe('EmbeddingEndpointError');
    assertNoLeak(err, ['sk-topsecret-KEY', 'xyz']);
  });

  it('scrubs userinfo, query credential, and key from an error raised on a credentialed URL', async () => {
    // Node's fetch throws a TypeError whose raw message embeds the full URL (creds
    // and all) for a userinfo URL; the provider must replace it wholesale.
    const provider = new EndpointProvider(
      makeConfig({ url: 'http://user:secret@127.0.0.1:8080/v1/embeddings?api_key=xyz', apiKey: 'sk-topsecret-KEY' }),
      FAST,
    );
    const err = await captureReject(provider.embed(['x']));

    expect(err.name).toBe('EmbeddingEndpointError');
    expect(String(err.message)).toContain('127.0.0.1'); // redacted scheme+host+port is fine
    assertNoLeak(err, ['sk-topsecret-KEY', 'secret', 'xyz']);
  });
});
