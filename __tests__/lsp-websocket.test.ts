import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import CodeGraph from '../src/index';
import { stopDaemonAt } from '../src/mcp/daemon-registry';
import { attachLspWebSocket, type LspWebSocketAdapter } from '../src/server/lsp-websocket';
import { repoIdForRoot, type DaemonReadClient } from '../src/server/daemon-client';
import type { BindSecurity } from '../src/server/auth';

const repo = { id: '0123456789abcdef', root: '/repo', name: 'repo' };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('LSP WebSocket adapter', () => {
  it('serves same-origin text JSON-RPC with lifecycle parity and recoverable parse errors', async () => {
    const fixture = await startFixture();
    const socket = await openSocket(fixture.url, { Origin: fixture.origin });

    expect(await request(socket, 1, 'initialize', {})).toMatchObject({
      result: { capabilities: { positionEncoding: 'utf-16' } },
    });
    socket.send('{');
    expect(await nextMessage(socket)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
    expect(await request(socket, 2, 'shutdown')).toEqual({ jsonrpc: '2.0', id: 2, result: null });
    const closed = onceClose(socket);
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'exit' }));
    expect(await closed).toMatchObject({ code: 1000, reason: 'lsp exit' });
  });

  it('applies Host/Origin policy before repository resolution and allows absent Origin scripts', async () => {
    const fixture = await startFixture();

    expect(await rejectedStatus(fixture.url, { Origin: 'https://evil.example' })).toBe(400);
    expect(await rejectedStatus(fixture.url, { Origin: 'null' })).toBe(400);
    expect(await rejectedStatus(fixture.url, { Origin: `${fixture.origin}, ${fixture.origin}` })).toBe(400);
    expect(await rejectedStatus(fixture.url, { Origin: fixture.origin.replace('http://', 'http://user@') })).toBe(400);
    expect(await rejectedStatus(fixture.url, { Host: 'evil.example', Origin: fixture.origin })).toBe(400);
    expect(await rejectedStatus(fixture.url, {
      Host: `localhost:${fixture.port}`,
      Origin: fixture.origin,
    })).toBe(400);
    expect(fixture.resolveRepo).not.toHaveBeenCalled();
    expect(await rejectedStatus(fixture.url.replace(repo.id, 'ffffffffffffffff'), { Origin: fixture.origin })).toBe(404);
    expect(fixture.resolveRepo).toHaveBeenCalledOnce();

    const alias = await openSocket(fixture.url, {
      Host: `localhost:${fixture.port}`,
      Origin: `http://localhost:${fixture.port}`,
    });
    expect(await request(alias, 1, 'initialize', {})).toMatchObject({ result: { capabilities: {} } });
    alias.close();

    const scripted = await openSocket(fixture.url);
    expect(await request(scripted, 1, 'initialize', {})).toMatchObject({ result: { capabilities: {} } });
    scripted.close();
  });

  it('accepts the HTTPS same-origin form used behind TLS termination', async () => {
    const fixture = await startFixture();
    const socket = await openSocket(fixture.url, {
      Origin: fixture.origin.replace('http:', 'https:'),
    });

    expect(await request(socket, 1, 'initialize', {})).toMatchObject({ result: { capabilities: {} } });
    socket.close();
  });

  it('requires the bind token before repository admission on a non-loopback posture', async () => {
    const security: BindSecurity = { loopback: false, requireToken: true, token: 'private-server-token' };
    const fixture = await startFixture(async () => [], undefined, security, '0.0.0.0');

    expect(await rejectedStatus(fixture.url)).toBe(401);
    expect(await rejectedStatus(fixture.url, { Authorization: 'Bearer wrong-token' })).toBe(401);
    expect(fixture.resolveRepo).not.toHaveBeenCalled();
    expect(fixture.getClient).not.toHaveBeenCalled();

    const authenticated = await openSocket(fixture.url, { Authorization: 'Bearer private-server-token' });
    expect(await request(authenticated, 1, 'initialize', {})).toMatchObject({ result: { capabilities: {} } });
    expect(fixture.getClient).toHaveBeenCalledOnce();
    authenticated.close();
  });

  it('contains repository-resolution failures at the upgrade boundary', async () => {
    const fixture = await startFixture();
    fixture.resolveRepo.mockImplementation(() => { throw new Error('registry failure'); });

    expect(await rejectedStatus(fixture.url)).toBe(503);
    expect(fixture.getClient).not.toHaveBeenCalled();
    expect(fixture.server.listening).toBe(true);
  });

  it('rejects session 65 before allocating another daemon client', async () => {
    const fixture = await startFixture();
    const sockets: WebSocket[] = [];
    try {
      for (let index = 0; index < 64; index++) sockets.push(await openSocket(fixture.url));
      expect(await rejectedStatus(fixture.url)).toBe(503);
      expect(fixture.getClient).toHaveBeenCalledTimes(64);
    } finally {
      for (const socket of sockets) socket.terminate();
    }
  }, 8_000);

  it('aborts and awaits a pending daemon admission during shutdown', async () => {
    let admissionSignal: AbortSignal | null = null;
    const fixture = await startFixture(
      async () => [],
      undefined,
      { loopback: true, requireToken: false, token: null },
      '127.0.0.1',
      async (_repo, signal) => new Promise<DaemonReadClient>((_resolve, reject) => {
        admissionSignal = signal;
        signal.addEventListener('abort', () => reject(new Error('admission aborted')), { once: true });
      }),
    );
    const socket = new WebSocket(fixture.url);
    socket.on('error', () => { /* shutdown rejects this pre-upgrade client */ });
    await vi.waitFor(() => expect(fixture.getClient).toHaveBeenCalledOnce());

    const started = Date.now();
    await fixture.adapter.close(started + 300);

    expect(admissionSignal?.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(fixture.releaseClient).not.toHaveBeenCalled();
    socket.terminate();
  });

  it('returns by the shutdown deadline while retaining active daemon work', async () => {
    let resolveRead!: (value: unknown) => void;
    const fixture = await startFixture(() => new Promise((resolve) => { resolveRead = resolve; }));
    const socket = await openSocket(fixture.url);
    await request(socket, 1, 'initialize', {});
    socket.send(JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'held' },
    }));
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledOnce());

    const started = Date.now();
    await fixture.adapter.close(started + 75);

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(fixture.releaseClient).not.toHaveBeenCalled();
    expect(fixture.clients[0]?.close).not.toHaveBeenCalled();
    expect(fixture.adapter.sessionCount).toBe(1);

    resolveRead([]);
    await vi.waitFor(() => expect(fixture.releaseClient).toHaveBeenCalledOnce());
    expect(fixture.clients[0]?.close).toHaveBeenCalledOnce();
    expect(fixture.adapter.sessionCount).toBe(0);
    socket.terminate();
  });

  it('times out stalled daemon admission and releases a client acquired after the deadline', async () => {
    let admissionSignal: AbortSignal | null = null;
    let resolveClient!: (client: DaemonReadClient) => void;
    const lateClient = { read: vi.fn(async () => []), close: vi.fn() } as unknown as DaemonReadClient;
    const fixture = await startFixture(
      async () => [],
      undefined,
      { loopback: true, requireToken: false, token: null },
      '127.0.0.1',
      async (_repo, signal) => new Promise<DaemonReadClient>((resolve) => {
        admissionSignal = signal;
        resolveClient = resolve;
      }),
      50,
    );

    expect(await rejectedStatus(fixture.url)).toBe(503);
    expect(admissionSignal?.aborted).toBe(true);
    expect(fixture.adapter.sessionCount).toBe(0);

    resolveClient(lateClient);
    await vi.waitFor(() => expect(fixture.releaseClient).toHaveBeenCalledWith(repo, lateClient));
    expect(fixture.releaseClient).toHaveBeenCalledOnce();
  });

  it('rejects normalized dot-segment aliases instead of admitting them as the raw /lsp path', async () => {
    const fixture = await startFixture();
    for (const target of [
      `/x/../lsp?repo=${repo.id}`,
      `/%2e/lsp?repo=${repo.id}`,
      `/a/%2e%2e/lsp?repo=${repo.id}`,
    ]) {
      expect(await rejectedRawStatus(fixture.port, target)).toBe(400);
    }
    expect(fixture.resolveRepo).not.toHaveBeenCalled();
  });

  it('closes a rejected raw upgrade while the client write side remains open', async () => {
    const fixture = await startFixture();
    const socket = await connectRawSocket(fixture.port, true);
    socket.on('error', () => { /* forced rejection teardown may reset the peer */ });
    try {
      const response = new Promise<string>((resolve) => {
        let received = '';
        socket.on('data', (chunk) => {
          received += chunk.toString('latin1');
          if (received.includes('\r\n\r\n')) resolve(received);
        });
      });
      socket.write(rawUpgradeRequest(fixture.port, `/not-lsp?repo=${repo.id}`));
      expect(await response).toMatch(/^HTTP\/1\.1 400 /);
      expect(socket.writableEnded).toBe(false);
      await vi.waitFor(async () => {
        const count = await new Promise<number>((resolve, reject) => {
          fixture.server.getConnections((error, connections) => {
            if (error) reject(error);
            else resolve(connections);
          });
        });
        expect(count).toBe(0);
      }, { timeout: 2_000, interval: 25 });
    } finally {
      socket.destroy();
    }
  });

  it('rejects every offered subprotocol before repository admission', async () => {
    const diagnostics = vi.fn();
    const fixture = await startFixture(async () => [], diagnostics);
    expect(await rejectedRawStatus(fixture.port, `/lsp?repo=${repo.id}`, [
      'Sec-WebSocket-Protocol: graphql-ws',
    ])).toBe(400);
    expect(await rejectedRawStatus(fixture.port, `/lsp?repo=${repo.id}`, [
      'Sec-WebSocket-Protocol: private invalid value',
    ])).toBe(400);
    expect(await rejectedRawStatus(fixture.port, `/lsp?repo=${repo.id}`, [
      'Sec-WebSocket-Protocol: codegraph-lsp',
      'Sec-WebSocket-Protocol: second-protocol',
    ])).toBe(400);
    expect(await rejectedRawStatus(fixture.port, `/lsp?repo=${repo.id}`, [
      'Sec-WebSocket-Protocol: codegraph-lsp,,second-protocol',
    ])).toBe(400);
    expect(await rejectedRawStatus(fixture.port, `/lsp?repo=${repo.id}`, [
      'Sec-WebSocket-Protocol: duplicate, duplicate',
    ])).toBe(400);
    expect(fixture.resolveRepo).not.toHaveBeenCalled();
    expect(fixture.getClient).not.toHaveBeenCalled();
    expect(fixture.releaseClient).not.toHaveBeenCalled();
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it('contains a throwing diagnostic sink during daemon admission', async () => {
    const diagnostics = vi.fn(() => { throw new Error('observer failure'); });
    let admissions = 0;
    const client = { read: vi.fn(async () => []), close: vi.fn() } as unknown as DaemonReadClient;
    const fixture = await startFixture(
      async () => [],
      diagnostics,
      { loopback: true, requireToken: false, token: null },
      '127.0.0.1',
      async () => {
        admissions += 1;
        if (admissions === 1) throw new Error('daemon unavailable');
        return client;
      },
    );

    expect(await rejectedStatus(fixture.url)).toBe(503);
    expect(diagnostics).toHaveBeenCalledOnce();
    expect(fixture.server.listening).toBe(true);
  });

  it('closes binary and oversized inputs with stable protocol codes', async () => {
    const fixture = await startFixture();
    const binary = await openSocket(fixture.url);
    const binaryClose = onceClose(binary);
    binary.send(Buffer.from('not text'));
    expect(await binaryClose).toMatchObject({ code: 1003, reason: 'text messages required' });

    const oversized = await openSocket(fixture.url);
    const oversizedClose = onceClose(oversized);
    oversized.send('a'.repeat(1024 * 1024 + 1));
    expect(await oversizedClose).toMatchObject({ code: 1009 });

    const invalidUtf8 = await openSocket(fixture.url);
    const invalidUtf8Close = onceClose(invalidUtf8);
    invalidUtf8.send(Buffer.from([0xff]), { binary: false });
    expect(await invalidUtf8Close).toMatchObject({ code: 1007 });
  });

  it('ignores request-only methods sent as notifications without starting daemon reads', async () => {
    const fixture = await startFixture();
    const socket = await openSocket(fixture.url);
    await request(socket, 1, 'initialize', {});

    for (let index = 0; index < 100; index++) {
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'workspace/symbol',
        params: { query: `notification-${index}` },
      }));
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fixture.read).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it('cancels active requests promptly while retaining admission until daemon work settles', async () => {
    const pending = new Map<string, { resolve: (value: unknown) => void; signal?: AbortSignal }>();
    const fixture = await startFixture((_operation, params, signal) => new Promise((resolve) => {
      pending.set(String(params.query), { resolve, signal });
    }), undefined, { loopback: true, requireToken: false, token: null }, '127.0.0.1', undefined, undefined, 1_000);
    const socket = await openSocket(fixture.url);
    await request(socket, 1, 'initialize', {});

    const requestIds = [2, 3, 4, 5];
    const held = requestIds.map((id, index) => request(
      socket,
      id,
      'workspace/symbol',
      { query: `held-${index}` },
    ));
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(4));

    socket.send(JSON.stringify({
      jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 2 },
    }));
    expect(await held[0]).toEqual({
      jsonrpc: '2.0', id: 2, error: { code: -32800, message: 'Request cancelled' },
    });
    expect(pending.get('held-0')?.signal?.aborted).toBe(true);

    const recovered = request(socket, 6, 'workspace/symbol', { query: 'recovered' });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fixture.read).toHaveBeenCalledTimes(4);

    pending.get('held-0')?.resolve([]);
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(5));
    pending.get('recovered')?.resolve([]);
    expect(await recovered).toMatchObject({ id: 6, result: [] });

    for (let index = 1; index < 4; index++) pending.get(`held-${index}`)?.resolve([]);
    await expect(Promise.all(held.slice(1))).resolves.toEqual([
      expect.objectContaining({ id: 3, result: [] }),
      expect.objectContaining({ id: 4, result: [] }),
      expect.objectContaining({ id: 5, result: [] }),
    ]);
    socket.close();
  });

  it('retains per-session slots for cancelled admitted work until the daemon settles', async () => {
    const pending = new Map<string, () => void>();
    const fixture = await startFixture((_operation, params) => new Promise((resolve) => {
      pending.set(String(params.query), () => resolve([]));
    }), undefined, { loopback: true, requireToken: false, token: null }, '127.0.0.1', undefined, undefined, 1_000);
    const socket = await openSocket(fixture.url);
    await request(socket, 1, 'initialize', {});

    const admittedIds = [2, 3, 4, 5];
    const admitted = admittedIds.map((id) => request(
      socket,
      id,
      'workspace/symbol',
      { query: `admitted-${id}` },
    ));
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(4));
    for (const id of admittedIds) {
      socket.send(JSON.stringify({
        jsonrpc: '2.0', method: '$/cancelRequest', params: { id },
      }));
    }
    await expect(Promise.all(admitted)).resolves.toEqual(admittedIds.map((id) => ({
      jsonrpc: '2.0', id, error: { code: -32800, message: 'Request cancelled' },
    })));

    for (let id = 6; id <= 17; id++) {
      socket.send(JSON.stringify({
        jsonrpc: '2.0', id, method: 'workspace/symbol', params: { query: `queued-${id}` },
      }));
    }
    const overloaded = await request(socket, 18, 'workspace/symbol', { query: 'must-overload' });
    expect(overloaded).toMatchObject({
      id: 18,
      error: { code: -32803, data: { reason: 'overloaded' } },
    });
    expect(fixture.read).toHaveBeenCalledTimes(4);

    const closed = onceClose(socket);
    socket.close();
    await closed;
    for (const release of pending.values()) release();
  }, 5_000);

  it('rejects request 17 without queueing when all sixteen slots are occupied', async () => {
    const reads: Array<() => void> = [];
    const fixture = await startFixture(() => new Promise<never>((_resolve, reject) => reads.push(() => reject(new Error('released')))));
    const socket = await openSocket(fixture.url);
    await request(socket, 1, 'initialize', {});
    for (let id = 2; id <= 18; id++) {
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'workspace/symbol', params: { query: 'held' } }));
    }
    const overloaded = await nextMessage(socket, (message) => isRecord(message) && message.id === 18);
    expect(overloaded).toMatchObject({
      id: 18,
      error: { code: -32803, data: { reason: 'overloaded' } },
    });
    expect(fixture.read).toHaveBeenCalledTimes(4);
    expect(await request(socket, 19, 'shutdown')).toEqual({ jsonrpc: '2.0', id: 19, result: null });
    expect(fixture.read).toHaveBeenCalledTimes(4);
    for (const release of reads) release();
  });

  it('admits at most four daemon reads server-wide and advances a bounded queue', async () => {
    const releases: Array<() => void> = [];
    const fixture = await startFixture(() => new Promise((resolve) => {
      releases.push(() => resolve([]));
    }));
    const first = await openSocket(fixture.url);
    const second = await openSocket(fixture.url);
    const local = await openSocket(fixture.url);
    await request(first, 1, 'initialize', {});
    await request(second, 1, 'initialize', {});
    const pending = [
      request(first, 2, 'workspace/symbol', { query: 'first-2' }),
      request(first, 3, 'workspace/symbol', { query: 'first-3' }),
      request(second, 2, 'workspace/symbol', { query: 'second-2' }),
      request(second, 3, 'workspace/symbol', { query: 'second-3' }),
      request(first, 4, 'workspace/symbol', { query: 'queued' }),
    ];

    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(4));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fixture.read).toHaveBeenCalledTimes(4);

    expect(await request(local, 1, 'initialize', {})).toMatchObject({
      result: { capabilities: { positionEncoding: 'utf-16' } },
    });
    expect(await request(local, 2, 'initialize', {})).toMatchObject({ error: { code: -32600 } });
    expect(await request(local, 3, 'unsupported/method')).toMatchObject({ error: { code: -32601 } });
    expect(await request(local, 4, 'shutdown')).toEqual({ jsonrpc: '2.0', id: 4, result: null });
    expect(await request(first, 5, 'shutdown')).toEqual({ jsonrpc: '2.0', id: 5, result: null });
    expect(fixture.read).toHaveBeenCalledTimes(4);

    releases.shift()!();
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(5));
    for (const release of releases.splice(0)) release();
    await expect(Promise.all(pending)).resolves.toEqual([
      expect.objectContaining({ result: [] }),
      expect.objectContaining({ result: [] }),
      expect.objectContaining({ result: [] }),
      expect.objectContaining({ result: [] }),
      expect.objectContaining({ result: [] }),
    ]);
  });

  it('retains global admission and daemon leases until timed-out work settles', async () => {
    const signals: AbortSignal[] = [];
    const settleReads: Array<() => void> = [];
    const fixture = await startFixture((_operation, params, signal) => {
      if (String(params.query).startsWith('held-')) {
        if (signal) signals.push(signal);
        return new Promise((resolve) => settleReads.push(() => resolve([])));
      }
      return Promise.resolve([]);
    }, undefined, { loopback: true, requireToken: false, token: null }, '127.0.0.1', undefined, undefined, 200);
    const sockets = await Promise.all(Array.from({ length: 4 }, () => openSocket(fixture.url)));
    const recovered = await openSocket(fixture.url);
    for (const socket of sockets) await request(socket, 1, 'initialize', {});
    await request(recovered, 1, 'initialize', {});

    const held = sockets.map((socket, index) => request(
      socket,
      2,
      'workspace/symbol',
      { query: `held-${index}` },
    ));
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(4));
    await expect(Promise.all(held)).resolves.toEqual(Array.from({ length: 4 }, () => expect.objectContaining({
      error: expect.objectContaining({ data: { reason: 'timeout' } }),
    })));
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(fixture.releaseClient).not.toHaveBeenCalled();

    const recovery = request(recovered, 2, 'workspace/symbol', { query: 'recovered' });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fixture.read).toHaveBeenCalledTimes(4);

    for (const settleRead of settleReads) settleRead();
    await vi.waitFor(() => expect(fixture.releaseClient).toHaveBeenCalledTimes(4));
    expect(fixture.read).toHaveBeenCalledTimes(5);
    expect(await recovery).toMatchObject({ result: [] });
    recovered.close();
  }, 3_000);

  it('bounds retained source validation across concurrent requests, sessions, and the server', async () => {
    const oneMiB = 'a'.repeat(1024 * 1024);
    const heldReads: Array<() => void> = [];
    const snapshot = (filePath: string) => ({
      ok: true as const,
      snapshot: {
        filePath,
        text: oneMiB,
        languageId: 'typescript',
        contentHash: filePath,
        snapshotToken: filePath,
      },
    });
    const fixture = await startFixture(async (operation, params) => {
      if (operation === 'lspWorkspaceSymbols') {
        const query = String(params.query);
        const count = query.startsWith('hold-') ? 17 : 1;
        return Array.from({ length: count }, (_unused, index) => {
          const filePath = `${query}-${index}.ts`;
          return {
            node: {
              id: filePath,
              kind: 'function',
              name: 'missing',
              qualifiedName: `${query}.missing`,
              filePath,
              language: 'typescript',
              startLine: 2,
              endLine: 2,
              startColumn: 0,
              endColumn: 7,
              updatedAt: 1,
            },
            snapshotToken: filePath,
            searchScore: 0,
          };
        });
      }
      if (operation === 'lspSourceSnapshot') {
        const filePath = String(params.filePath);
        if (/^hold-[ab]-16\.ts$/.test(filePath)) {
          return new Promise((resolve) => heldReads.push(() => resolve(snapshot(filePath))));
        }
        return snapshot(filePath);
      }
      return [];
    });
    const first = await openSocket(fixture.url);
    const second = await openSocket(fixture.url);
    const third = await openSocket(fixture.url);
    await request(first, 1, 'initialize', {});
    await request(second, 1, 'initialize', {});
    await request(third, 1, 'initialize', {});

    const heldFirst = request(first, 2, 'workspace/symbol', { query: 'hold-a' });
    await vi.waitFor(() => expect(sourceReadCount(fixture.read)).toBe(17));
    expect(await request(first, 3, 'workspace/symbol', { query: 'session-probe' })).toMatchObject({
      error: { code: -32803, data: { reason: 'too_large' } },
    });

    const heldSecond = request(second, 2, 'workspace/symbol', { query: 'hold-b' });
    await vi.waitFor(() => expect(sourceReadCount(fixture.read)).toBe(35));
    expect(await request(third, 2, 'workspace/symbol', { query: 'server-probe' })).toMatchObject({
      error: { code: -32803, data: { reason: 'too_large' } },
    });

    for (const release of heldReads) release();
    await expect(Promise.all([heldFirst, heldSecond])).resolves.toEqual([
      expect.objectContaining({ error: expect.objectContaining({ data: { reason: 'too_large' } }) }),
      expect.objectContaining({ error: expect.objectContaining({ data: { reason: 'too_large' } }) }),
    ]);
    expect(await request(third, 3, 'workspace/symbol', { query: 'recovered' })).toMatchObject({ result: [] });
  }, 8_000);

  it('settles a timed-out response but retains its lease until daemon work settles', async () => {
    const resolveReads: Array<(value: unknown) => void> = [];
    const fixture = await startFixture(() => new Promise((resolve) => { resolveReads.push(resolve); }));
    const socket = await openSocket(fixture.url);
    await request(socket, 1, 'initialize', {});
    const closed = onceClose(socket);
    const started = Date.now();
    const timedOut = request(socket, 2, 'workspace/symbol', { query: 'held' });
    expect(await timedOut).toMatchObject({ id: 2, error: { code: -32803, data: { reason: 'timeout' } } });
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_900);
    expect(await closed).toMatchObject({ code: 1011, reason: 'request timeout' });
    expect(fixture.releaseClient).not.toHaveBeenCalled();
    expect(fixture.read).toHaveBeenCalledOnce();
    for (const resolveRead of resolveReads) resolveRead([]);
    await vi.waitFor(() => expect(fixture.releaseClient).toHaveBeenCalledOnce());
  }, 8_000);

  it('retains timed-out daemon work beyond the browser close deadline', async () => {
    let resolveRead!: (value: unknown) => void;
    const fixture = await startFixture(
      () => new Promise((resolve) => { resolveRead = resolve; }),
      undefined,
      { loopback: true, requireToken: false, token: null },
      '127.0.0.1',
      undefined,
      undefined,
      50,
    );
    const socket = await openSocket(fixture.url);
    await request(socket, 1, 'initialize', {});
    const closed = onceClose(socket);

    expect(await request(socket, 2, 'workspace/symbol', { query: 'held' })).toMatchObject({
      error: { code: -32803, data: { reason: 'timeout' } },
    });
    expect(await closed).toMatchObject({ code: 1011, reason: 'request timeout' });
    await new Promise((resolve) => setTimeout(resolve, 5_100));
    expect(fixture.releaseClient).not.toHaveBeenCalled();

    resolveRead([]);
    await vi.waitFor(() => expect(fixture.releaseClient).toHaveBeenCalledOnce());
  }, 7_000);

  it('does not release a timed-out session twice when daemon failure arrives late', async () => {
    let rejectRead!: (error: Error) => void;
    const fixture = await startFixture(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
    const socket = await openSocket(fixture.url);
    await request(socket, 1, 'initialize', {});
    const closed = onceClose(socket);
    expect(await request(socket, 2, 'workspace/symbol', { query: 'held' })).toMatchObject({
      id: 2,
      error: { code: -32803, data: { reason: 'timeout' } },
    });
    expect(await closed).toMatchObject({ code: 1011, reason: 'request timeout' });
    expect(fixture.releaseClient).not.toHaveBeenCalled();
    rejectRead(new Error('private daemon failure'));
    await vi.waitFor(() => expect(fixture.releaseClient).toHaveBeenCalledOnce());
    expect(fixture.clients[0]?.close).toHaveBeenCalledOnce();
  }, 8_000);

  it('diagnoses and releases a failed daemon lease without closing another session transport', async () => {
    const diagnostics = vi.fn();
    const fixture = await startFixture(async (_operation, params) => {
      if (params.query === 'fail') throw new Error('private daemon failure');
      return [];
    }, diagnostics);
    const failed = await openSocket(fixture.url);
    const healthy = await openSocket(fixture.url);
    await request(failed, 1, 'initialize', {});
    await request(healthy, 1, 'initialize', {});
    const closed = onceClose(failed);
    failed.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'fail' } }));
    expect(await closed).toMatchObject({ code: 1011, reason: 'daemon unavailable' });
    expect(fixture.getClient).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(fixture.releaseClient).toHaveBeenCalledTimes(1));
    expect(fixture.releaseClient).toHaveBeenCalledTimes(1);
    expect(fixture.clients[0]?.close).toHaveBeenCalledOnce();
    expect(fixture.clients[1]?.close).not.toHaveBeenCalled();
    expect(diagnostics).toHaveBeenCalledWith('[codegraph:lsp] daemon_unavailable');
    expect(await request(healthy, 2, 'workspace/symbol', { query: 'healthy' })).toMatchObject({ id: 2, result: [] });
    expect(healthy.readyState).toBe(WebSocket.OPEN);
  });

  it('closes with 1013 when outbound backpressure cannot drain for five seconds', async () => {
    const buffered = vi.spyOn(WebSocket.prototype, 'bufferedAmount', 'get').mockReturnValue(2 * 1024 * 1024);
    try {
      const fixture = await startFixture();
      const socket = await openSocket(fixture.url);
      const closed = onceClose(socket);
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
      expect(await closed).toMatchObject({ code: 1013, reason: 'backpressure' });
    } finally {
      buffered.mockRestore();
    }
  }, 8_000);

  it('closes binary input with 1003 even while outbound traffic is backpressured', async () => {
    const buffered = vi.spyOn(WebSocket.prototype, 'bufferedAmount', 'get').mockReturnValue(2 * 1024 * 1024);
    try {
      const fixture = await startFixture();
      const socket = await openSocket(fixture.url);
      const closed = onceClose(socket);
      socket.send(Buffer.from('not text'));
      expect(await closed).toMatchObject({ code: 1003, reason: 'text messages required' });
    } finally {
      buffered.mockRestore();
    }
  });

  it('closes repeated traffic during outbound backpressure as policy abuse', async () => {
    const buffered = vi.spyOn(WebSocket.prototype, 'bufferedAmount', 'get').mockReturnValue(2 * 1024 * 1024);
    try {
      const fixture = await startFixture();
      const socket = await openSocket(fixture.url);
      const closed = onceClose(socket);
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }));
      expect(await closed).toMatchObject({ code: 1008, reason: 'backpressure abuse' });
    } finally {
      buffered.mockRestore();
    }
  });

  it('queues concurrent accepted responses under backpressure without treating them as client abuse', async () => {
    let blocked = false;
    const buffered = vi.spyOn(WebSocket.prototype, 'bufferedAmount', 'get')
      .mockImplementation(() => blocked ? 2 * 1024 * 1024 : 0);
    const releases: Array<() => void> = [];
    try {
      const fixture = await startFixture(() => new Promise((resolve) => releases.push(() => resolve([]))));
      const socket = await openSocket(fixture.url);
      await request(socket, 1, 'initialize', {});
      const second = nextMessage(socket, (message) => isRecord(message) && message.id === 2);
      const third = nextMessage(socket, (message) => isRecord(message) && message.id === 3);
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'two' } }));
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'workspace/symbol', params: { query: 'three' } }));
      await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(2));

      blocked = true;
      for (const release of releases) release();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(socket.readyState).toBe(WebSocket.OPEN);

      blocked = false;
      await expect(Promise.all([second, third])).resolves.toEqual([
        { jsonrpc: '2.0', id: 2, result: [] },
        { jsonrpc: '2.0', id: 3, result: [] },
      ]);
      expect(socket.readyState).toBe(WebSocket.OPEN);
      socket.close();
    } finally {
      buffered.mockRestore();
    }
  });

  it('returns a typed too-large error when one serialized response cannot fit', async () => {
    const text = '\0'.repeat(2 * 1024 * 1024);
    const fixture = await startFixture(async (operation) => operation === 'lspSourceSnapshot' ? {
      ok: true,
      snapshot: {
        filePath: 'large.ts', text, languageId: 'typescript', contentHash: 'hash', snapshotToken: 'snapshot',
      },
    } : []);
    const socket = await openSocket(fixture.url);
    await request(socket, 1, 'initialize', {});

    expect(await request(socket, 2, 'codegraph/textDocumentContent', {
      textDocument: { uri: pathToFileURL('/repo/large.ts').href },
    })).toMatchObject({
      id: 2,
      error: { code: -32803, data: { reason: 'too_large' } },
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(await request(socket, 3, 'workspace/symbol', { query: 'healthy' })).toMatchObject({ id: 3, result: [] });
  });

  it('closes before concurrent escape-heavy source responses exceed the outbound byte budget', async () => {
    const text = '\0'.repeat(1024 * 1024);
    const releases: Array<() => void> = [];
    const fixture = await startFixture((operation) => new Promise((resolve) => {
      releases.push(() => resolve(operation === 'lspSourceSnapshot' ? {
          ok: true,
          snapshot: {
            filePath: 'large.ts', text, languageId: 'typescript', contentHash: 'hash', snapshotToken: 'snapshot',
          },
        }
        : []));
    }));
    const socket = await openSocket(fixture.url);
    await request(socket, 1, 'initialize', {});
    for (let id = 2; id <= 5; id++) {
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'codegraph/textDocumentContent',
        params: { textDocument: { uri: pathToFileURL('/repo/large.ts').href } },
      }));
    }
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(4));
    const buffered = vi.spyOn(WebSocket.prototype, 'bufferedAmount', 'get')
      .mockReturnValue(2 * 1024 * 1024);
    try {
      const closed = onceClose(socket);
      for (const release of releases) release();
      expect(await closed).toMatchObject({ code: 1013, reason: 'backpressure' });
    } finally {
      buffered.mockRestore();
    }
  }, 8_000);

  it('bounds queued outbound response bytes across all sessions', async () => {
    const text = '\0'.repeat(1024 * 1024);
    const releases: Array<() => void> = [];
    const fixture = await startFixture((operation) => new Promise((resolve) => {
      releases.push(() => resolve(operation === 'lspSourceSnapshot' ? {
        ok: true,
        snapshot: {
          filePath: 'large.ts', text, languageId: 'typescript', contentHash: 'hash', snapshotToken: 'snapshot',
        },
      } : []));
    }));
    const sockets = await Promise.all(Array.from({ length: 6 }, () => openSocket(fixture.url)));
    for (const socket of sockets) await request(socket, 1, 'initialize', {});
    const closed = sockets.map((socket) => onceClose(socket));
    for (const socket of sockets) {
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'codegraph/textDocumentContent',
        params: { textDocument: { uri: pathToFileURL('/repo/large.ts').href } },
      }));
    }
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(4));
    const buffered = vi.spyOn(WebSocket.prototype, 'bufferedAmount', 'get')
      .mockReturnValue(2 * 1024 * 1024);
    try {
      for (const release of releases.splice(0)) release();
      await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(6));
      const started = Date.now();
      for (const release of releases.splice(0)) release();

      await expect(Promise.race(closed)).resolves.toMatchObject({ code: 1013, reason: 'backpressure' });
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      buffered.mockRestore();
      for (const socket of sockets) socket.terminate();
    }
  }, 8_000);

  it('terminates a peer that does not answer the close handshake within five seconds', async () => {
    const fixture = await startFixture();
    const socket = await openRawSocket(fixture.port, `/lsp?repo=${repo.id}`);
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    expect(fixture.adapter.sessionCount).toBe(1);
    const started = Date.now();
    await fixture.adapter.close();
    await closed;
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_900);
    expect(fixture.adapter.sessionCount).toBe(0);
  }, 8_000);

  it('uses an externally supplied shutdown deadline for an unresponsive peer', async () => {
    const fixture = await startFixture();
    const socket = await openRawSocket(fixture.port, `/lsp?repo=${repo.id}`);
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    const started = Date.now();
    await fixture.adapter.close(started + 150);
    await closed;
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(1_000);
    expect(fixture.adapter.sessionCount).toBe(0);
  });

  it('terminates a peer that does not answer two ping intervals', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const fixture = await startFixture();
      const socket = new WebSocket(fixture.url, { autoPong: false });
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      const closed = onceClose(socket);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await closed).toMatchObject({ code: 1006 });
      expect(fixture.adapter.sessionCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains a disconnected session lease until late daemon work settles', async () => {
    let resolveRead!: (value: unknown) => void;
    const fixture = await startFixture(() => new Promise((resolve) => { resolveRead = resolve; }));
    const socket = await openSocket(fixture.url);
    await request(socket, 1, 'initialize', {});
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'held' } }));
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledOnce());
    const closed = onceClose(socket);
    socket.terminate();
    await closed;
    expect(fixture.adapter.sessionCount).toBe(1);
    expect(fixture.releaseClient).not.toHaveBeenCalled();
    expect(fixture.clients[0]?.close).not.toHaveBeenCalled();
    resolveRead([]);
    await vi.waitFor(() => expect(fixture.adapter.sessionCount).toBe(0));
    expect(fixture.releaseClient).toHaveBeenCalledOnce();
    expect(fixture.clients[0]?.close).toHaveBeenCalledOnce();
  });

  it('stops upgrades and closes owned sessions before HTTP shutdown', async () => {
    const fixture = await startFixture();
    const socket = await openSocket(fixture.url);
    expect(fixture.adapter.sessionCount).toBe(1);
    const closed = onceClose(socket);
    await fixture.adapter.close();
    expect(await closed).toMatchObject({ code: 1001, reason: 'server shutdown' });
    expect(fixture.adapter.sessionCount).toBe(0);
    expect(await rejectedStatus(fixture.url)).not.toBe(101);
  });

  it('serves verified source through the built packaged web command', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-web-'));
    fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 1; }\nalpha();\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    cg.close();
    const child = spawn(process.execPath, [
      path.join(process.cwd(), 'dist/bin/codegraph.js'),
      'serve', '--web', '--path', root, '--port', '0', '--no-watch',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    try {
      const port = await waitForServerPort(child, () => stderr);
      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('CodeGraph');

      const socket = await openSocket(`ws://127.0.0.1:${port}/lsp?repo=${repoIdForRoot(fs.realpathSync(root))}`, {
        Origin: `http://127.0.0.1:${port}`,
      });
      expect(await request(socket, 1, 'initialize', {})).toMatchObject({ result: { capabilities: { positionEncoding: 'utf-16' } } });
      expect(await request(socket, 2, 'codegraph/textDocumentContent', {
        textDocument: { uri: pathToFileURL(path.join(fs.realpathSync(root), 'sample.ts')).href },
      })).toMatchObject({
        result: { text: expect.stringContaining('function alpha'), languageId: 'typescript', snapshotToken: expect.any(String) },
      });
      expect(await request(socket, 3, 'workspace/symbol', { query: 'alpha' })).toMatchObject({
        result: expect.arrayContaining([expect.objectContaining({ name: 'alpha' })]),
      });
      await request(socket, 4, 'shutdown');
      const closed = onceClose(socket);
      socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'exit' }));
      expect(await closed).toMatchObject({ code: 1000 });
    } catch (error) {
      throw new Error(`packaged WebSocket UAT failed; stderr=${JSON.stringify(stderr)}`, { cause: error });
    } finally {
      child.kill('SIGTERM');
      await waitForChildExit(child);
      await stopDaemonAt(fs.realpathSync(root));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

async function startFixture(
  readImpl: (op: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> = async () => [],
  diagnostics?: (message: string) => void,
  security: BindSecurity = { loopback: true, requireToken: false, token: null },
  advertisedHost = '127.0.0.1',
  getClientImpl?: (repo: typeof repo, signal: AbortSignal) => Promise<DaemonReadClient>,
  admissionDeadlineMs?: number,
  requestDeadlineMs?: number,
) {
  const server = http.createServer((_req, response) => response.end('ok'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  const read = vi.fn(readImpl);
  const clients: Array<DaemonReadClient & { close: ReturnType<typeof vi.fn> }> = [];
  const getClient = vi.fn(async (requestedRepo: typeof repo, signal: AbortSignal) => {
    if (getClientImpl) return getClientImpl(requestedRepo, signal);
    const client = { read, close: vi.fn() } as unknown as DaemonReadClient & { close: ReturnType<typeof vi.fn> };
    clients.push(client);
    return client;
  });
  const resolveRepo = vi.fn((id: string | undefined) => id === repo.id ? repo : null);
  const releaseClient = vi.fn((_repo, client: DaemonReadClient) => client.close());
  const adapter = attachLspWebSocket({
    server,
    host: advertisedHost,
    port: address.port,
    security,
    resolveRepo,
    getClient,
    releaseClient,
    diagnostics,
    admissionDeadlineMs,
    requestDeadlineMs,
  });
  let cleaned = false;
  cleanups.push(async () => {
    if (cleaned) return;
    cleaned = true;
    await adapter.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    url: `ws://127.0.0.1:${address.port}/lsp?repo=${repo.id}`,
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    server,
    adapter,
    read,
    resolveRepo,
    getClient,
    releaseClient,
    clients,
  };
}

async function openRawSocket(port: number, target: string): Promise<net.Socket> {
  const socket = await connectRawSocket(port);
  socket.write(rawUpgradeRequest(port, target));
  const response = await new Promise<string>((resolve, reject) => {
    let received = '';
    const onData = (chunk: Buffer): void => {
      received += chunk.toString('latin1');
      if (!received.includes('\r\n\r\n')) return;
      cleanup();
      resolve(received);
    };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
  if (!response.startsWith('HTTP/1.1 101 ')) {
    socket.destroy();
    throw new Error(`expected WebSocket upgrade, received ${response.split('\r\n', 1)[0]}`);
  }
  return socket;
}

async function connectRawSocket(port: number, allowHalfOpen = false): Promise<net.Socket> {
  const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function rawUpgradeRequest(port: number, target: string, extraHeaders: string[] = []): string {
  return [
    `GET ${target} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    ...extraHeaders,
    '',
    '',
  ].join('\r\n');
}

async function rejectedRawStatus(port: number, target: string, extraHeaders: string[] = []): Promise<number> {
  const socket = await connectRawSocket(port);
  socket.write(rawUpgradeRequest(port, target, extraHeaders));
  const status = await new Promise<number>((resolve, reject) => {
    let response = '';
    socket.on('data', (chunk) => {
      response += chunk.toString('latin1');
      if (!response.includes('\r\n\r\n')) return;
      const match = response.match(/^HTTP\/1\.1 (\d{3}) /);
      socket.destroy();
      resolve(match ? Number(match[1]) : 0);
    });
    socket.once('error', reject);
  });
  return status;
}

async function openSocket(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  const socket = new WebSocket(url, { headers });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function request(socket: WebSocket, id: number, method: string, params?: object): Promise<Record<string, unknown>> {
  const response = nextMessage(socket, (message) => isRecord(message) && message.id === id);
  socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }));
  return response as Promise<Record<string, unknown>>;
}

function sourceReadCount(read: ReturnType<typeof vi.fn>): number {
  return read.mock.calls.filter(([operation]) => operation === 'lspSourceSnapshot').length;
}

function nextMessage(socket: WebSocket, accept: (message: unknown) => boolean = () => true): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: Buffer): void => {
      try {
        const message: unknown = JSON.parse(data.toString('utf8'));
        if (!accept(message)) return;
        cleanup();
        resolve(message);
      } catch (error) { cleanup(); reject(error); }
    };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => {
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    socket.on('message', onMessage);
    socket.on('error', onError);
  });
}

function onceClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => socket.once('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') })));
}

function rejectedStatus(url: string, headers?: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.once('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') return;
      reject(error);
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function waitForServerPort(child: ChildProcessWithoutNullStreams, stderr: () => string): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('packaged web server did not bind')), 15_000);
    const inspect = (): void => {
      const match = stderr().match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      child.stderr.off('data', inspect);
      resolve(Number(match[1]));
    };
    child.stderr.on('data', inspect);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`packaged web server exited early (${code})`));
    });
    inspect();
  });
}

function waitForChildExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}
