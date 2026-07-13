/**
 * LlmEndpointClient — OpenAI-compatible chat-completions client (SPEC-018, US2 / T009-T010).
 *
 * Integration tests against a local `node:http` mock endpoint (ephemeral port) exercising the real
 * global `fetch` + `AbortSignal` transport — no fetch mocking. Each case maps to the wire contract in
 * `specs/018-llm-access-layer/contracts/endpoint-wire.md` (the authoritative source) and research D4.
 *
 * Traceability: FR-005 (redaction-safe error; key never leaks; cross-origin redirect drops the key),
 * FR-009a (empty/whitespace completion → failure), FR-015 (minimal request body), FR-015a
 * (vendor-neutral — OpenAI-standard fields only), FR-016 (streaming + non-streaming per call),
 * FR-016a (SSE assembly; `[DONE]` OR clean EOF terminates; aborted-before-clean-close discards the
 * partial), FR-017 (flat total deadline non-streaming; inter-chunk idle deadline streaming; hard
 * response-size ceiling; bounded retry with backoff+jitter honoring Retry-After; fast-abort 4xx),
 * FR-020 (no new dependency — built-in fetch).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LlmEndpointClient } from '../src/llm/client';
import type { LlmEndpointClientOverrides, ChatMessage } from '../src/llm/client';
import type { LlmEndpointConfig } from '../src/llm/config';

// --- mock endpoint --------------------------------------------------------
interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
/** The framework records the request, then hands the raw `res` to the handler for full control
 * (a plain JSON reply, an SSE stream, a hang, a mid-stream socket reset, a redirect, …). */
type Handler = (req: RecordedRequest, res: ServerResponse, count: number) => void;

interface MockServer {
  port: number;
  origin: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

const openServers: MockServer[] = [];

async function startMock(handler: Handler): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  let closed = false;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Swallow the socket errors a deliberate client abort / mid-stream destroy provokes server-side.
    res.on('error', () => {});
    req.on('error', () => {});
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
      try {
        handler(rec, res, requests.length);
      } catch {
        /* a handler write after the client tore down — ignore */
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const mock: MockServer = {
    port,
    origin: `http://127.0.0.1:${port}`,
    requests,
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Reply with a JSON body and a `200` (or a given status). */
function sendJson(res: ServerResponse, status: number, obj: unknown, extraHeaders?: Record<string, string>): void {
  res.writeHead(status, { 'content-type': 'application/json', ...(extraHeaders ?? {}) });
  res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

/** One OpenAI-compatible non-streaming completion body. */
function completion(content: string): { choices: Array<{ message: { content: string } }> } {
  return { choices: [{ message: { content } }] };
}

/** One SSE `data:` payload carrying a single-choice delta (the OpenAI-standard streaming shape). */
function sseDelta(content: string): string {
  return JSON.stringify({ choices: [{ delta: { content } }] });
}

type SseEnd = 'done' | 'clean' | 'destroy';
interface SseEvent {
  data: string;
  delayMs?: number;
}

/** Stream SSE events, then terminate: `[DONE]` sentinel, a clean end WITHOUT it, or an abrupt
 * mid-stream socket reset. Never throws (a write after client abort is swallowed). */
async function sendSse(res: ServerResponse, events: SseEvent[], end: SseEnd): Promise<void> {
  try {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const ev of events) {
      if (ev.delayMs) await sleep(ev.delayMs);
      if (res.writableEnded || res.destroyed) return;
      res.write(`data: ${ev.data}\n\n`);
    }
    if (res.writableEnded || res.destroyed) return;
    if (end === 'done') {
      res.write('data: [DONE]\n\n');
      res.end();
    } else if (end === 'clean') {
      res.end();
    } else {
      res.socket?.destroy();
    }
  } catch {
    /* client aborted mid-stream */
  }
}

/** An ephemeral loopback port guaranteed closed (bind → capture → close) — a real ECONNREFUSED. */
async function getClosedPort(): Promise<number> {
  const mock = await startMock((_req, res) => sendJson(res, 200, {}));
  const { port } = mock;
  await mock.close();
  return port;
}

// --- config + client helpers ---------------------------------------------
function makeConfig(o: Partial<LlmEndpointConfig> & { url: string }): LlmEndpointConfig {
  const config: LlmEndpointConfig = { mode: 'endpoint', url: o.url, model: o.model ?? 'test-model' };
  if (o.apiKey !== undefined) config.apiKey = o.apiKey;
  return config;
}

/** Tiny backoff so retry paths run in milliseconds; the production retry count (3) is kept. */
const FAST: LlmEndpointClientOverrides = { baseDelayMs: 1, maxDelayMs: 4 };

const MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Say hi.' },
];

function parseBody(mock: MockServer, i = 0): any {
  return JSON.parse(mock.requests[i].body);
}

async function captureReject(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

/** Walk an error exhaustively — message, stack, every own property, and the whole `cause` chain —
 * and assert none of the secrets appear anywhere (FR-005). */
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
    /* circular — the per-property pass still covers it */
  }
  for (const name of names) {
    let v: unknown;
    try {
      v = obj[name];
    } catch {
      continue;
    }
    if (name === 'cause') parts.push(collectErrorText(v, seen));
    else parts.push(String(v));
  }
  return parts.join('\n');
}

function assertNoLeak(err: unknown, secrets: string[]): void {
  const blob = collectErrorText(err);
  for (const secret of secrets) expect(blob).not.toContain(secret);
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((m) => m.close()));
});

// =========================================================================
describe('LlmEndpointClient — request shape (FR-015 / FR-015a)', () => {
  it('POSTs a minimal chat-completions body (model, messages, stream:false, max_tokens) with no temperature', async () => {
    const mock = await startMock((_req, res) => sendJson(res, 200, completion('hi')));
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions`, model: 'my-model' }), FAST);

    const out = await client.complete(MESSAGES, { stream: false });
    expect(out).toBe('hi');

    expect(mock.requests).toHaveLength(1);
    const req = mock.requests[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/v1/chat/completions');
    expect(String(req.headers['content-type'])).toContain('application/json');

    const body = parseBody(mock);
    expect(body.model).toBe('my-model');
    expect(body.messages).toEqual(MESSAGES);
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(1024); // DEFAULT_MAX_OUTPUT_TOKENS
    expect('temperature' in body).toBe(false); // left to the endpoint default (FR-015)
  });

  it('sets stream:true and honors the maxOutputTokens override', async () => {
    const mock = await startMock((_req, res) => void sendSse(res, [{ data: sseDelta('ok') }], 'done'));
    const client = new LlmEndpointClient(
      makeConfig({ url: `${mock.origin}/v1/chat/completions` }),
      { ...FAST, maxOutputTokens: 256 },
    );

    await client.complete(MESSAGES, { stream: true });

    const body = parseBody(mock);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(256);
    expect('temperature' in body).toBe(false);
  });

  it('sends Authorization: Bearer when a key is configured', async () => {
    const mock = await startMock((_req, res) => sendJson(res, 200, completion('hi')));
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions`, apiKey: 'sk-abc-123' }), FAST);
    await client.complete(MESSAGES, { stream: false });
    expect(mock.requests[0].headers['authorization']).toBe('Bearer sk-abc-123');
  });

  it('omits the Authorization header entirely when keyless (FR-015)', async () => {
    const mock = await startMock((_req, res) => sendJson(res, 200, completion('hi')));
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions` }), FAST);
    await client.complete(MESSAGES, { stream: false });
    expect(mock.requests[0].headers['authorization']).toBeUndefined();
  });

  it('is vendor-neutral: a non-streaming reply carrying ONLY choices[0].message.content works (FR-015a)', async () => {
    // No id / model / usage / system_fingerprint — none of the proprietary fields is required.
    const mock = await startMock((_req, res) => sendJson(res, 200, { choices: [{ message: { content: 'neutral' } }] }));
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions` }), FAST);
    expect(await client.complete(MESSAGES, { stream: false })).toBe('neutral');
  });

  it('is vendor-neutral: a streamed reply carrying ONLY choices[].delta.content works (FR-015a)', async () => {
    const mock = await startMock((_req, res) => void sendSse(res, [{ data: sseDelta('neutral') }], 'done'));
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions` }), FAST);
    expect(await client.complete(MESSAGES, { stream: true })).toBe('neutral');
  });
});

describe('LlmEndpointClient — non-streaming response (FR-016)', () => {
  it('returns choices[0].message.content', async () => {
    const mock = await startMock((_req, res) => sendJson(res, 200, completion('the answer')));
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions` }), FAST);
    expect(await client.complete(MESSAGES, { stream: false })).toBe('the answer');
    expect(mock.requests).toHaveLength(1);
  });

  it('fails a 200 whose body is not valid JSON (non-retryable, no retry storm)', async () => {
    const mock = await startMock((_req, res) => sendJson(res, 200, 'not json <html>error</html>'));
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions` }), FAST);
    const err = await captureReject(client.complete(MESSAGES, { stream: false }));
    expect(err.name).toBe('LlmEndpointError');
    expect(mock.requests).toHaveLength(1);
  });
});

describe('LlmEndpointClient — streaming assembly (FR-016 / FR-016a)', () => {
  it('assembles choices[].delta.content across chunks and terminates on data: [DONE]', async () => {
    const mock = await startMock((_req, res) =>
      void sendSse(res, [{ data: sseDelta('Hello, ') }, { data: sseDelta('world') }, { data: sseDelta('!') }], 'done'),
    );
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions` }), FAST);
    expect(await client.complete(MESSAGES, { stream: true })).toBe('Hello, world!');
  });

  it('returns the assembled deltas on a CLEAN end-of-stream that never sends [DONE] (FR-016a)', async () => {
    const mock = await startMock((_req, res) =>
      void sendSse(res, [{ data: sseDelta('no ') }, { data: sseDelta('sentinel') }], 'clean'),
    );
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions` }), FAST);
    expect(await client.complete(MESSAGES, { stream: true })).toBe('no sentinel');
  });

  it('completes a slow-but-steady stream whose inter-chunk gaps stay under the idle deadline (FR-017)', async () => {
    const mock = await startMock((_req, res) =>
      void sendSse(
        res,
        [{ data: sseDelta('a') }, { data: sseDelta('b'), delayMs: 15 }, { data: sseDelta('c'), delayMs: 15 }],
        'done',
      ),
    );
    const client = new LlmEndpointClient(
      makeConfig({ url: `${mock.origin}/v1/chat/completions` }),
      { ...FAST, idleTimeoutMs: 200 }, // each 15ms gap is well under 200ms — a flat cap would wrongly kill it
    );
    expect(await client.complete(MESSAGES, { stream: true })).toBe('abc');
  });

  it('discards the partial and fails when the stream is reset mid-flight before a clean close (FR-016a)', async () => {
    const mock = await startMock((_req, res) =>
      void sendSse(res, [{ data: sseDelta('par') }, { data: sseDelta('tial') }], 'destroy'),
    );
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions` }), { ...FAST, maxRetries: 0 });
    const err = await captureReject(client.complete(MESSAGES, { stream: true }));
    expect(err.name).toBe('LlmEndpointError'); // never resolves with the partial 'partial'
  });

  it('aborts a stream whose inter-chunk gap exceeds the idle deadline (FR-017)', async () => {
    const mock = await startMock((_req, res) =>
      void sendSse(res, [{ data: sseDelta('hi') }, { data: sseDelta('late'), delayMs: 300 }], 'done'),
    );
    const client = new LlmEndpointClient(
      makeConfig({ url: `${mock.origin}/v1/chat/completions` }),
      { ...FAST, idleTimeoutMs: 60, maxRetries: 0 },
    );
    const start = Date.now();
    const err = await captureReject(client.complete(MESSAGES, { stream: true }));
    const elapsed = Date.now() - start;
    expect(err.name).toBe('LlmEndpointError');
    expect(elapsed).toBeLessThan(250); // aborted at the ~60ms idle deadline, not after the 300ms gap
    expect(mock.requests).toHaveLength(1); // maxRetries:0 → single shot
  });
});

describe('LlmEndpointClient — empty completion → failure (FR-009a)', () => {
  it('rejects a non-streaming completion whose content is whitespace-only', async () => {
    const mock = await startMock((_req, res) => sendJson(res, 200, completion('   ')));
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions` }), { ...FAST, maxRetries: 0 });
    const err = await captureReject(client.complete(MESSAGES, { stream: false }));
    expect(err.name).toBe('LlmEndpointError');
    expect(mock.requests).toHaveLength(1); // non-retryable validation failure — no retry storm
  });

  it('rejects a non-streaming 200 that carries no content at all (vendor tolerance → empty → fallback)', async () => {
    const mock = await startMock((_req, res) => sendJson(res, 200, { choices: [{ message: {} }] }));
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions` }), { ...FAST, maxRetries: 0 });
    const err = await captureReject(client.complete(MESSAGES, { stream: false }));
    expect(err.name).toBe('LlmEndpointError');
  });

  it('rejects a stream that assembles to whitespace-only', async () => {
    const mock = await startMock((_req, res) => void sendSse(res, [{ data: sseDelta('   ') }], 'done'));
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions` }), { ...FAST, maxRetries: 0 });
    const err = await captureReject(client.complete(MESSAGES, { stream: true }));
    expect(err.name).toBe('LlmEndpointError');
    expect(mock.requests).toHaveLength(1);
  });
});

describe('LlmEndpointClient — flat total deadline, non-streaming (FR-017)', () => {
  it('bounds a hanging endpoint by the flat total-request deadline, retries, then fails', async () => {
    const mock = await startMock(() => {
      /* receive but never answer */
    });
    const client = new LlmEndpointClient(
      makeConfig({ url: `${mock.origin}/v1/chat/completions?api_key=xyz`, apiKey: 'sk-topsecret-KEY' }),
      { ...FAST, totalTimeoutMs: 60 },
    );
    const start = Date.now();
    const err = await captureReject(client.complete(MESSAGES, { stream: false }));
    const elapsed = Date.now() - start;
    expect(err.name).toBe('LlmEndpointError');
    expect(mock.requests).toHaveLength(4); // 1 initial + 3 retries, each timed out
    expect(elapsed).toBeLessThan(3000); // bounded, not an unbounded hang
    assertNoLeak(err, ['sk-topsecret-KEY', 'xyz']);
  });
});

describe('LlmEndpointClient — response-size ceiling (FR-017)', () => {
  it('aborts and fails a non-streaming body that exceeds the size ceiling (non-retryable)', async () => {
    const mock = await startMock((_req, res) => sendJson(res, 200, completion('x'.repeat(5000))));
    const client = new LlmEndpointClient(
      makeConfig({ url: `${mock.origin}/v1/chat/completions` }),
      { ...FAST, maxResponseBytes: 100 },
    );
    const err = await captureReject(client.complete(MESSAGES, { stream: false }));
    expect(err.name).toBe('LlmEndpointError');
    expect(mock.requests).toHaveLength(1); // ceiling-exceeded is an ultimate failure, not retried
  });

  it('aborts and fails a streamed body that exceeds the size ceiling', async () => {
    const mock = await startMock((_req, res) => void sendSse(res, [{ data: sseDelta('y'.repeat(5000)) }], 'done'));
    const client = new LlmEndpointClient(
      makeConfig({ url: `${mock.origin}/v1/chat/completions` }),
      { ...FAST, maxResponseBytes: 100 },
    );
    const err = await captureReject(client.complete(MESSAGES, { stream: true }));
    expect(err.name).toBe('LlmEndpointError');
    expect(mock.requests).toHaveLength(1);
  });
});

describe('LlmEndpointClient — retry & backoff (FR-017)', () => {
  it('retries a transient 5xx and then succeeds', async () => {
    const mock = await startMock((_req, res, count) =>
      count === 1 ? sendJson(res, 500, { error: 'oops' }) : sendJson(res, 200, completion('recovered')),
    );
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions` }), FAST);
    expect(await client.complete(MESSAGES, { stream: false })).toBe('recovered');
    expect(mock.requests).toHaveLength(2);
  });

  it('honors (and caps) Retry-After on a 429, then succeeds', async () => {
    const mock = await startMock((_req, res, count) =>
      count === 1
        ? sendJson(res, 429, { error: 'slow down' }, { 'retry-after': '1' })
        : sendJson(res, 200, completion('ok')),
    );
    const client = new LlmEndpointClient(
      makeConfig({ url: `${mock.origin}/v1/chat/completions` }),
      { baseDelayMs: 1, maxDelayMs: 4, retryAfterCapMs: 80 }, // Retry-After: 1s → capped to 80ms
    );
    const start = Date.now();
    expect(await client.complete(MESSAGES, { stream: false })).toBe('ok');
    const elapsed = Date.now() - start;
    expect(mock.requests).toHaveLength(2);
    expect(elapsed).toBeGreaterThanOrEqual(50); // honored — far above the ~1ms base backoff
    expect(elapsed).toBeLessThan(900); // capped — far below the 1000ms Retry-After
  });

  it('exhausts the bounded retry budget on a persistent 5xx and rejects (1 initial + 3 retries)', async () => {
    const mock = await startMock((_req, res) => sendJson(res, 503, { error: 'unavailable' }));
    const client = new LlmEndpointClient(
      makeConfig({ url: `${mock.origin}/v1/chat/completions?api_key=xyz`, apiKey: 'sk-topsecret-KEY' }),
      FAST,
    );
    const err = await captureReject(client.complete(MESSAGES, { stream: false }));
    expect(err.name).toBe('LlmEndpointError');
    expect(err.status).toBe(503);
    expect(mock.requests).toHaveLength(4);
    assertNoLeak(err, ['sk-topsecret-KEY', 'xyz']);
  });

  it.each([400, 401, 403, 404, 422])('fast-aborts on non-retryable HTTP %i without consuming the retry budget', async (status) => {
    const mock = await startMock((_req, res) => sendJson(res, status, { error: 'nope' }));
    const client = new LlmEndpointClient(
      makeConfig({ url: `${mock.origin}/v1/chat/completions?api_key=xyz`, apiKey: 'sk-topsecret-KEY' }),
      FAST,
    );
    const err = await captureReject(client.complete(MESSAGES, { stream: false }));
    expect(err.name).toBe('LlmEndpointError');
    expect(err.status).toBe(status);
    expect(mock.requests).toHaveLength(1);
    assertNoLeak(err, ['sk-topsecret-KEY', 'xyz']);
  });
});

describe('LlmEndpointClient — redaction (FR-005)', () => {
  it('replaces a genuine network error and leaks neither the key nor the query credential', async () => {
    const port = await getClosedPort();
    const client = new LlmEndpointClient(
      makeConfig({ url: `http://127.0.0.1:${port}/v1/chat/completions?api_key=xyz`, apiKey: 'sk-topsecret-KEY' }),
      FAST,
    );
    const err = await captureReject(client.complete(MESSAGES, { stream: false }));
    expect(err.name).toBe('LlmEndpointError');
    assertNoLeak(err, ['sk-topsecret-KEY', 'xyz']);
  });

  it('scrubs userinfo, query credential, and key from an error on a credentialed URL (redacted host is fine)', async () => {
    const client = new LlmEndpointClient(
      makeConfig({ url: 'http://user:secret@127.0.0.1:8080/v1/chat/completions?api_key=xyz', apiKey: 'sk-topsecret-KEY' }),
      FAST,
    );
    const err = await captureReject(client.complete(MESSAGES, { stream: false }));
    expect(err.name).toBe('LlmEndpointError');
    expect(String(err.message)).toContain('127.0.0.1'); // redacted scheme+host+port is safe
    assertNoLeak(err, ['sk-topsecret-KEY', 'secret', 'xyz']);
  });

  it('never surfaces a key echoed back inside a 401 response body, and never chains a cause', async () => {
    const key = 'sk-topsecret-KEY';
    const mock = await startMock((_req, res) => sendJson(res, 401, { error: `invalid api key ${key}` }));
    const client = new LlmEndpointClient(makeConfig({ url: `${mock.origin}/v1/chat/completions`, apiKey: key }), FAST);
    const err = await captureReject(client.complete(MESSAGES, { stream: false }));
    expect(err.name).toBe('LlmEndpointError');
    expect(err.cause).toBeUndefined(); // the raw transport error is never chained (FR-005)
    expect(mock.requests).toHaveLength(1);
    assertNoLeak(err, [key]);
  });
});

describe('LlmEndpointClient — cross-origin redirect drops the key (FR-005)', () => {
  // POSIX-gated: relies on the platform fetch (undici) WHATWG "remove Authorization on cross-origin
  // redirect" behavior; validated on the POSIX dev machine per the repo's platform-gating rule.
  it.runIf(process.platform !== 'win32')('sends the key to the configured host but NOT to a cross-origin redirect target', async () => {
    const target = await startMock((_req, res) => sendJson(res, 200, completion('from-target')));
    const entry = await startMock((_req, res) => {
      res.writeHead(307, { location: `${target.origin}/v1/chat/completions` }); // 307 preserves POST+body
      res.end();
    });
    const client = new LlmEndpointClient(
      makeConfig({ url: `${entry.origin}/v1/chat/completions`, apiKey: 'sk-redirect-KEY' }),
      FAST,
    );

    expect(await client.complete(MESSAGES, { stream: false })).toBe('from-target');
    expect(String(entry.requests[0].headers['authorization'])).toBe('Bearer sk-redirect-KEY'); // configured host
    expect(target.requests[0].headers['authorization']).toBeUndefined(); // cross-origin target — key stripped
  });
});
