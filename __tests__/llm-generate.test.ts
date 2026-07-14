/**
 * The `generate()` library seam — unit tests (SPEC-018 slice 1, T011).
 *
 * Pins the dispatch contract in `contracts/generate-seam.md` / research D6: one
 * `generate(root, task, overrides?)` free function that resolves config ONCE and
 * dispatches over the four config states, ALWAYS returning usable text and NEVER
 * throwing for absent/partial config (FR-008 / SC-001):
 *   - dormant (null) / misconfig → { source:'fallback', text: task.fallback };
 *     ZERO network + ZERO filesystem writes (FR-004/FR-011, SC-002).
 *   - endpoint success            → { source:'endpoint', text }               (FR-009).
 *   - endpoint ultimate failure   → { source:'fallback', text: task.fallback } (FR-009, US1 AS-2).
 *   - endpoint empty completion   → { source:'fallback', text: task.fallback } (FR-009a).
 *   - agent (slice 1, pre-emitter)→ { source:'fallback', text: task.fallback } (documented stub).
 *
 * Invariants: the fallback is ALWAYS the consumer-supplied `task.fallback` string —
 * no heuristic registry (FR-013); `result.source` distinguishes every source (FR-012);
 * the seam writes nothing to the filesystem outside the endpoint request path and never
 * opens the graph DB (FR-014); it holds no cross-call state (FR-024a).
 *
 * Endpoint arms run against a real `node:http` loopback mock on an ephemeral port with
 * FAST client overrides (ms retries) so the failure path is quick. The no-network arms
 * install a THROWING `fetch` guard — `LlmEndpointClient` is the only `fetch` call site, so
 * a call count of 0 there is a whole-seam proof that a dormant/misconfig/agent call never
 * reached the network. Env is INJECTED via `overrides.env` so every arm is hermetic.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generate } from '../src/llm/generate';
import type { ProseTask, GenerationResult } from '../src/llm/generate';
import type { LlmEndpointClientOverrides } from '../src/llm/client';

// --- mock endpoint --------------------------------------------------------
interface MockServer {
  origin: string;
  requestCount: () => number;
  close: () => Promise<void>;
}
const openServers: MockServer[] = [];

/** Start a loopback mock; `handler` gets full control of each response and the 1-based attempt count. */
async function startMock(handler: (res: ServerResponse, count: number) => void): Promise<MockServer> {
  let count = 0;
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.on('error', () => {});
    req.on('error', () => {});
    req.on('data', () => {});
    req.on('end', () => {
      count += 1;
      try {
        handler(res, count);
      } catch {
        /* the client tore the socket down — ignore */
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const mock: MockServer = {
    origin: `http://127.0.0.1:${port}`,
    requestCount: () => count,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
  openServers.push(mock);
  return mock;
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

/** One OpenAI-compatible non-streaming completion body. */
function completion(content: string): { choices: Array<{ message: { content: string } }> } {
  return { choices: [{ message: { content } }] };
}

// --- fetch guard (no-network arms) ----------------------------------------
/** Replace the global `fetch` with a throwing counter so any stray outbound call is a hard failure. */
function installFetchGuard(): { calls: () => number; restore: () => void } {
  const real = globalThis.fetch;
  let calls = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = (...args: unknown[]) => {
    calls += 1;
    throw new Error(`llm-generate: unexpected outbound fetch while dormant/misconfig/agent: ${String(args[0])}`);
  };
  return {
    calls: () => calls,
    restore: () => {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = real;
    },
  };
}

// --- temp roots -----------------------------------------------------------
const tempDirs: string[] = [];
/** A fresh, EMPTY project root; the zero-fs arms assert it stays empty (no `.codegraph`, no bundle). */
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-llm-generate-'));
  tempDirs.push(dir);
  return dir;
}

function makeTask(fallback = 'HEURISTIC FALLBACK'): ProseTask {
  return {
    instructions: 'Summarize the change.',
    graphContext: ['ctx-item-a', 'ctx-item-b'],
    outputContract: { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] },
    fallback,
  };
}

/** FAST client knobs so the retry/backoff path completes in milliseconds under test. */
const FAST: LlmEndpointClientOverrides = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, totalTimeoutMs: 2000 };

function endpointEnv(origin: string): NodeJS.ProcessEnv {
  return { CODEGRAPH_LLM_URL: origin, CODEGRAPH_LLM_MODEL: 'test-model' };
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((m) => m.close()));
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
describe('generate — dormant / misconfig (zero network, zero fs, consumer fallback)', () => {
  it('dormant (empty env) returns { source:"fallback", text: task.fallback } with zero fetch and an untouched root', async () => {
    const guard = installFetchGuard();
    try {
      const root = makeRoot();
      const task = makeTask();
      const result = await generate(root, task, { env: {} });
      expect(result).toEqual({ source: 'fallback', text: task.fallback });
      expect(guard.calls()).toBe(0);
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      guard.restore();
    }
  });

  it('half-config (URL set, MODEL missing) is behaviorally dormant → fallback, zero fetch, empty root', async () => {
    const guard = installFetchGuard();
    try {
      const root = makeRoot();
      const task = makeTask('URL-ONLY FALLBACK');
      const result = await generate(root, task, { env: { CODEGRAPH_LLM_URL: 'http://example.test' } });
      expect(result).toEqual({ source: 'fallback', text: 'URL-ONLY FALLBACK' });
      expect(guard.calls()).toBe(0);
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      guard.restore();
    }
  });

  it('an unrecognized CODEGRAPH_LLM_PROVIDER is a misconfig → fallback, zero fetch, empty root', async () => {
    const guard = installFetchGuard();
    try {
      const root = makeRoot();
      const task = makeTask();
      const result = await generate(root, task, { env: { CODEGRAPH_LLM_PROVIDER: 'bogus-provider' } });
      expect(result).toEqual({ source: 'fallback', text: task.fallback });
      expect(guard.calls()).toBe(0);
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      guard.restore();
    }
  });
});

describe('generate — endpoint mode (FR-009 / FR-009a)', () => {
  it('returns { source:"endpoint", text } on a successful completion', async () => {
    const mock = await startMock((res) => sendJson(res, 200, completion('endpoint-produced prose')));
    const root = makeRoot();
    const task = makeTask();
    const result = await generate(root, task, { env: endpointEnv(mock.origin), client: FAST });
    expect(result).toEqual({ source: 'endpoint', text: 'endpoint-produced prose' });
    expect(mock.requestCount()).toBe(1);
  });

  it('degrades to { source:"fallback" } after the endpoint ultimately fails (5xx retries exhausted) and NEVER throws', async () => {
    const mock = await startMock((res) => sendJson(res, 500, { error: 'boom' }));
    const root = makeRoot();
    const task = makeTask('AFTER-FAILURE FALLBACK');
    // Must resolve (not reject): US1 AS-2 — the seam never throws for a failed endpoint call.
    const result = await generate(root, task, { env: endpointEnv(mock.origin), client: FAST });
    expect(result).toEqual({ source: 'fallback', text: 'AFTER-FAILURE FALLBACK' });
    // The endpoint was genuinely attempted with retries (initial + 2), distinguishing this from dormant.
    expect(mock.requestCount()).toBe(3);
  });

  it('degrades to { source:"fallback" } on an empty (whitespace-only) completion — FR-009a', async () => {
    const mock = await startMock((res) => sendJson(res, 200, completion('   ')));
    const root = makeRoot();
    const task = makeTask('EMPTY-COMPLETION FALLBACK');
    const result = await generate(root, task, { env: endpointEnv(mock.origin), client: FAST });
    expect(result).toEqual({ source: 'fallback', text: 'EMPTY-COMPLETION FALLBACK' });
    // FR-009a empty is a NON-retryable failure — exactly one request, no retries.
    expect(mock.requestCount()).toBe(1);
  });

  it('degrades to fallback on a non-retryable 4xx without throwing', async () => {
    const mock = await startMock((res) => sendJson(res, 400, { error: 'bad request' }));
    const root = makeRoot();
    const task = makeTask('4XX FALLBACK');
    const result = await generate(root, task, { env: endpointEnv(mock.origin), client: FAST });
    expect(result).toEqual({ source: 'fallback', text: '4XX FALLBACK' });
    expect(mock.requestCount()).toBe(1);
  });
});

describe('generate — agent mode (slice-1 documented stub)', () => {
  it('returns { source:"fallback" } WITHOUT emitting a bundle (zero fs) or reaching the network (zero fetch)', async () => {
    const guard = installFetchGuard();
    try {
      const root = makeRoot();
      const task = makeTask('AGENT-STUB FALLBACK');
      const result = await generate(root, task, { env: { CODEGRAPH_LLM_PROVIDER: 'agent' } });
      // Slice 1 has no bundle emitter, so agent mode degrades to the consumer fallback (US1 preserved).
      expect(result).toEqual({ source: 'fallback', text: 'AGENT-STUB FALLBACK' });
      expect(guard.calls()).toBe(0);
      // No `.codegraph/tasks/<id>/` bundle directory is created in slice 1.
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      guard.restore();
    }
  });
});

describe('generate — seam invariants (FR-012 / FR-013 / FR-014 / FR-024a)', () => {
  it('the fallback text is ALWAYS the exact consumer-supplied string — no heuristic registry (FR-013)', async () => {
    const guard = installFetchGuard();
    try {
      const sentinel = 'CONSUMER-OWNED-VERBATIM-Ω-42';
      const result = await generate(makeRoot(), makeTask(sentinel), { env: {} });
      expect(result.text).toBe(sentinel);
      expect(result.source).toBe('fallback');
    } finally {
      guard.restore();
    }
  });

  it('result.source discriminates endpoint output from consumer fallback (FR-012)', async () => {
    const okMock = await startMock((res) => sendJson(res, 200, completion('from-endpoint')));
    const okRoot = makeRoot();
    const endpointResult: GenerationResult = await generate(okRoot, makeTask(), {
      env: endpointEnv(okMock.origin),
      client: FAST,
    });
    const dormantResult: GenerationResult = await generate(makeRoot(), makeTask(), { env: {} });
    expect(endpointResult.source).toBe('endpoint');
    expect(dormantResult.source).toBe('fallback');
    expect(endpointResult.source).not.toBe(dormantResult.source);
  });

  it('never opens the graph DB or writes graph structure — a fresh root has no .codegraph after dormant + agent calls (FR-014)', async () => {
    const guard = installFetchGuard();
    try {
      const root = makeRoot();
      await generate(root, makeTask(), { env: {} });
      await generate(root, makeTask(), { env: { CODEGRAPH_LLM_PROVIDER: 'agent' } });
      expect(fs.existsSync(path.join(root, '.codegraph'))).toBe(false);
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      guard.restore();
    }
  });

  it('holds no cross-call state — repeated agent-mode calls each return the fallback independently with no accumulation (FR-024a)', async () => {
    const guard = installFetchGuard();
    try {
      const root = makeRoot();
      const task = makeTask('NO-STATE FALLBACK');
      const env = { CODEGRAPH_LLM_PROVIDER: 'agent' };
      const first = await generate(root, task, { env });
      const second = await generate(root, task, { env });
      const third = await generate(root, task, { env });
      for (const r of [first, second, third]) {
        expect(r).toEqual({ source: 'fallback', text: 'NO-STATE FALLBACK' });
      }
      // No dedup/coalesce store and no emitted bundles accreted across calls.
      expect(fs.readdirSync(root)).toEqual([]);
      expect(guard.calls()).toBe(0);
    } finally {
      guard.restore();
    }
  });
});
