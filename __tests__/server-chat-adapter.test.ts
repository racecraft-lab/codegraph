import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  });
}

async function request(method: string, rawPath: string, body?: string) {
  const ctx: RouteContext = {
    method,
    rawPath,
    params: {},
    query: new URLSearchParams(),
    headers: {},
    req: body === undefined ? undefined : new BodyReq(body),
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
