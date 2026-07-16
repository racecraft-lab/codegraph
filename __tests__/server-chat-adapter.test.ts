import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const generateMock = vi.hoisted(() => vi.fn());

vi.mock('../src/llm/generate', () => ({
  generate: generateMock,
}));

import { buildChatRoutes } from '../src/server/chat';
import { handleApiRequest, type RouteContext } from '../src/server/routes';

const repo = {
  id: '0123456789abcdef',
  root: process.cwd(),
  name: 'codegraph',
};

const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
  generateMock.mockReset();
  vi.restoreAllMocks();
});

class BodyReq extends EventEmitter {
  constructor(body: string) {
    super();
    queueMicrotask(() => {
      this.emit('data', Buffer.from(body));
      this.emit('end');
    });
  }
}

class ChunkedReq extends EventEmitter {
  constructor(chunks: Buffer[]) {
    super();
    queueMicrotask(() => {
      for (const chunk of chunks) {
        this.emit('data', chunk);
      }
      this.emit('end');
    });
  }
}

function routes() {
  return buildChatRoutes({
    defaultRepo: repo,
    resolveRepo(repoId) {
      if (repoId === undefined || repoId === '' || repoId === repo.id) return repo;
      return null;
    },
    getClient: vi.fn(async () => {
      throw new Error('getClient should not run while chat is dormant');
    }),
    evictClient: vi.fn(),
  });
}

async function request(method: string, rawPath: string, body?: string | EventEmitter) {
  const ctx: RouteContext = {
    method,
    rawPath,
    params: {},
    query: new URLSearchParams(),
    headers: {},
    req: typeof body === 'string' ? new BodyReq(body) : body,
  };
  return handleApiRequest(routes(), ctx);
}

describe('SPEC-006 chat adapter routes', () => {
  it('reports dormant status without provider configuration', async () => {
    delete process.env.CODEGRAPH_LLM_PROVIDER;
    delete process.env.CODEGRAPH_LLM_URL;
    delete process.env.CODEGRAPH_LLM_MODEL;

    const result = await request('GET', '/api/chat/status');

    expect(result?.status).toBe(200);
    expect(result?.body).toMatchObject({
      state: 'dormant',
      providerConfigured: false,
      repo: repo.id,
    });
  });

  it('returns a dormant fallback answer without touching the daemon or provider', async () => {
    delete process.env.CODEGRAPH_LLM_PROVIDER;
    delete process.env.CODEGRAPH_LLM_URL;
    delete process.env.CODEGRAPH_LLM_MODEL;

    const result = await request('POST', '/api/chat/messages', JSON.stringify({ message: 'What calls parseConfig?' }));

    expect(result?.status).toBe(200);
    expect(result?.body).toMatchObject({
      state: 'dormant',
      message: 'LLM provider is not configured.',
    });
  });

  it('does not confuse user-supplied status fields with internal router errors', async () => {
    delete process.env.CODEGRAPH_LLM_PROVIDER;
    delete process.env.CODEGRAPH_LLM_URL;
    delete process.env.CODEGRAPH_LLM_MODEL;

    const result = await request('POST', '/api/chat/messages', JSON.stringify({ status: 418, message: 'hello' }));

    expect(result?.status).toBe(200);
    expect(result?.body).toMatchObject({
      state: 'dormant',
      message: 'LLM provider is not configured.',
    });
  });

  it('rejects malformed chat JSON through the standard error envelope', async () => {
    const result = await request('POST', '/api/chat/messages', '{not-json');

    expect(result?.status).toBe(400);
    expect(result?.body).toMatchObject({
      error: { code: 'invalid_request' },
    });
  });

  it('rejects oversized streaming request bodies while draining the request', async () => {
    const result = await request('POST', '/api/chat/messages', new ChunkedReq([
      Buffer.from('{"message":"'),
      Buffer.alloc(70 * 1024, 'a'),
      Buffer.from('"}'),
      Buffer.alloc(1024, 'b'),
    ]));

    expect(result?.status).toBe(400);
    expect(result?.body).toMatchObject({
      error: { code: 'invalid_request', message: 'Request body is too large.' },
    });
  });

  it('rejects non-string optional chat fields before daemon access', async () => {
    const result = await request('POST', '/api/chat/messages', JSON.stringify({ message: 'hello', view: 1 }));

    expect(result?.status).toBe(400);
    expect(result?.body).toMatchObject({
      error: { code: 'invalid_request', details: { param: 'view' } },
    });
  });

  it('passes missing selected-symbol context limitations into endpoint generation', async () => {
    process.env.CODEGRAPH_LLM_URL = 'http://127.0.0.1:9/v1/chat/completions';
    process.env.CODEGRAPH_LLM_MODEL = 'test-model';
    generateMock.mockResolvedValue({ source: 'endpoint', text: 'Endpoint answer.' });
    const localRoutes = buildChatRoutes({
      defaultRepo: repo,
      resolveRepo(repoId) {
        if (repoId === undefined || repoId === '' || repoId === repo.id) return repo;
        return null;
      },
      getClient: vi.fn(async () => ({
        request: vi.fn(),
        read: vi.fn(async () => ({ node: null })),
        close: vi.fn(),
      })),
      evictClient: vi.fn(),
    });
    const ctx: RouteContext = {
      method: 'POST',
      rawPath: '/api/chat/messages',
      params: {},
      query: new URLSearchParams(),
      headers: {},
      req: new BodyReq(JSON.stringify({ message: 'Explain this symbol', selectedNodeId: 'missing-node' })),
    };

    const result = await handleApiRequest(localRoutes, ctx);

    expect(result?.status).toBe(200);
    expect(result?.body).toMatchObject({ state: 'answer', answer: 'Endpoint answer.' });
    expect(generateMock).toHaveBeenCalledWith(
      repo.root,
      expect.objectContaining({
        graphContext: expect.arrayContaining(['Context limitation: Selected symbol was not found in the local graph.']),
      }),
    );
  });

  it('404s unknown chat repos as repo misses', async () => {
    const result = await request('POST', '/api/chat/messages', JSON.stringify({ repo: 'ffffffffffffffff', message: 'hello' }));

    expect(result?.status).toBe(404);
    expect(result?.body).toMatchObject({
      error: { code: 'not_found', details: { resource: 'repo' } },
    });
  });

  it('404s missing bundle handles without leaking filesystem details', async () => {
    const result = await request('GET', '/api/chat/bundles/missing-handle');

    expect(result?.status).toBe(404);
    expect(result?.body).toMatchObject({
      error: { code: 'not_found', details: { resource: 'route' } },
    });
  });
});
