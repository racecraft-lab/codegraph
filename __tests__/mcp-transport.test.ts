import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCPEngine } from '../src/mcp/engine';
import { MCPSession } from '../src/mcp/session';
import {
  ErrorCodes,
  SocketOutputBudget,
  SocketRequestBudget,
  SocketTransport,
  type JsonRpcTransport,
  type MessageHandler,
} from '../src/mcp/transport';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('MCP socket transport diagnostics', () => {
  it('redacts unexpected codegraph/read failures on the JSON-RPC wire', async () => {
    class SessionTransport implements JsonRpcTransport {
      handler: MessageHandler | null = null;
      error: { id: string | number | null; code: number; message: string } | null = null;
      start(handler: MessageHandler): void { this.handler = handler; }
      stop(): void { /* no-op */ }
      send(): void { /* no-op */ }
      notify(): void { /* no-op */ }
      request(): Promise<unknown> { return Promise.resolve(undefined); }
      sendResult(): void { /* no-op */ }
      sendError(id: string | number | null, code: number, message: string): void {
        this.error = { id, code, message };
      }
    }
    const engine = new MCPEngine({ watch: false });
    vi.spyOn(engine, 'hasDefaultCodeGraph').mockReturnValue(true);
    vi.spyOn(engine, 'executeRead').mockRejectedValue(new Error('private path /secret/repo/index.db'));
    const transport = new SessionTransport();
    new MCPSession(transport, engine).start();
    try {
      await transport.handler!({
        jsonrpc: '2.0', id: 7, method: 'codegraph/read', params: { op: 'status', params: {} },
      } as never);
      expect(transport.error).toEqual({ id: 7, code: ErrorCodes.InternalError, message: 'read failed' });
    } finally {
      engine.stop();
    }
  });

  it('does not emit a structured-read response after cancellation', async () => {
    class SessionTransport implements JsonRpcTransport {
      handler: MessageHandler | null = null;
      results: Array<{ id: string | number; result: unknown }> = [];
      errors: Array<{ id: string | number | null; code: number; message: string }> = [];
      start(handler: MessageHandler): void { this.handler = handler; }
      stop(): void { /* no-op */ }
      send(): void { /* no-op */ }
      notify(): void { /* no-op */ }
      request(): Promise<unknown> { return Promise.resolve(undefined); }
      sendResult(id: string | number, result: unknown): void { this.results.push({ id, result }); }
      sendError(id: string | number | null, code: number, message: string): void {
        this.errors.push({ id, code, message });
      }
    }
    let resolveRead!: (value: unknown) => void;
    const engine = new MCPEngine({ watch: false });
    vi.spyOn(engine, 'hasDefaultCodeGraph').mockReturnValue(true);
    vi.spyOn(engine, 'executeRead').mockReturnValue(new Promise((resolve) => { resolveRead = resolve; }));
    const transport = new SessionTransport();
    new MCPSession(transport, engine).start();
    const controller = new AbortController();
    try {
      const handling = transport.handler!({
        jsonrpc: '2.0', id: 8, method: 'codegraph/read', params: { op: 'status', params: {} },
      } as never, controller.signal);
      await vi.waitFor(() => expect(engine.executeRead).toHaveBeenCalledOnce());

      controller.abort();
      await handling;

      expect(transport.results).toEqual([]);
      expect(transport.errors).toEqual([]);
      resolveRead({ ok: true });
    } finally {
      engine.stop();
    }
  });

  it('keeps shared roots discovery alive when the initiating waiter is cancelled', async () => {
    class RootsTransport implements JsonRpcTransport {
      handler: MessageHandler | null = null;
      requestCount = 0;
      resolveRoots!: () => void;
      results: Array<{ id: string | number; result: unknown }> = [];
      start(handler: MessageHandler): void { this.handler = handler; }
      stop(): void { /* no-op */ }
      send(): void { /* no-op */ }
      notify(): void { /* no-op */ }
      request(_method: string, _params?: unknown, _timeoutMs?: number, signal?: AbortSignal): Promise<unknown> {
        this.requestCount++;
        if (this.requestCount > 1) {
          return Promise.resolve({ roots: [{ uri: 'file:///tmp/codegraph-roots-retry' }] });
        }
        return new Promise((resolve, reject) => {
          this.resolveRoots = () => resolve({
            roots: [{ uri: 'file:///tmp/codegraph-roots-shared' }],
          });
          signal?.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true });
        });
      }
      sendResult(id: string | number, result: unknown): void { this.results.push({ id, result }); }
      sendError(): void { /* no-op */ }
    }

    const engine = new MCPEngine({ watch: false });
    let initialized = false;
    vi.spyOn(engine, 'hasDefaultCodeGraph').mockImplementation(() => initialized);
    const ensureInitialized = vi.spyOn(engine, 'ensureInitialized').mockImplementation(async () => {
      initialized = true;
    });
    const retryInitializeSync = vi.spyOn(engine, 'retryInitializeSync').mockImplementation(() => undefined);
    vi.spyOn(engine.getToolHandler(), 'execute').mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });
    const transport = new RootsTransport();
    new MCPSession(transport, engine).start();

    try {
      await transport.handler!({
        jsonrpc: '2.0', id: 0, method: 'initialize',
        params: { capabilities: { roots: {} } },
      } as never);

      const controller = new AbortController();
      const first = transport.handler!({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'codegraph_status', arguments: {} },
      } as never, controller.signal);
      await vi.waitFor(() => expect(transport.requestCount).toBe(1));
      const surviving = transport.handler!({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'codegraph_status', arguments: {} },
      } as never);

      controller.abort();
      await expect(first).rejects.toThrow('Request aborted');

      expect(transport.requestCount).toBe(1);
      expect(ensureInitialized).not.toHaveBeenCalled();
      expect(retryInitializeSync).not.toHaveBeenCalled();

      transport.resolveRoots();
      await surviving;

      expect(ensureInitialized).toHaveBeenCalledOnce();
      expect(ensureInitialized).toHaveBeenCalledWith('/tmp/codegraph-roots-shared');
      expect(transport.results.some(({ id }) => id === 2)).toBe(true);
    } finally {
      transport.resolveRoots?.();
      engine.stop();
    }
  });

  it('does not release a shared initialization latch when one waiter is cancelled', async () => {
    class SessionTransport implements JsonRpcTransport {
      handler: MessageHandler | null = null;
      results: Array<{ id: string | number; result: unknown }> = [];
      start(handler: MessageHandler): void { this.handler = handler; }
      stop(): void { /* no-op */ }
      send(): void { /* no-op */ }
      notify(): void { /* no-op */ }
      request(): Promise<unknown> { return Promise.resolve(undefined); }
      sendResult(id: string | number, result: unknown): void { this.results.push({ id, result }); }
      sendError(): void { /* no-op */ }
    }

    let releaseInitialization!: () => void;
    const initialization = new Promise<void>((resolve) => { releaseInitialization = resolve; });
    const engine = new MCPEngine({ watch: false });
    let initialized = false;
    const ensureInitialized = vi.spyOn(engine, 'ensureInitialized').mockImplementation(async () => {
      await initialization;
      initialized = true;
    });
    vi.spyOn(engine, 'hasDefaultCodeGraph').mockImplementation(() => initialized);
    const retryInitializeSync = vi.spyOn(engine, 'retryInitializeSync').mockImplementation(() => undefined);
    vi.spyOn(engine.getToolHandler(), 'execute').mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });
    const transport = new SessionTransport();
    new MCPSession(transport, engine).start();

    try {
      await transport.handler!({
        jsonrpc: '2.0', id: 0, method: 'initialize',
        params: { capabilities: {}, rootUri: 'file:///tmp/codegraph-shared-init' },
      } as never);
      expect(ensureInitialized).toHaveBeenCalledOnce();

      const controller = new AbortController();
      const cancelled = transport.handler!({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'codegraph_status', arguments: {} },
      } as never, controller.signal);
      await Promise.resolve();
      controller.abort();
      await expect(cancelled).rejects.toThrow('Request aborted');

      const surviving = transport.handler!({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'codegraph_status', arguments: {} },
      } as never);
      await Promise.resolve();

      expect(ensureInitialized).toHaveBeenCalledOnce();
      expect(retryInitializeSync).not.toHaveBeenCalled();

      releaseInitialization();
      await surviving;
      expect(transport.results.some(({ id }) => id === 2)).toBe(true);
    } finally {
      releaseInitialization();
      engine.stop();
    }
  });

  it('accepts daemon shutdown only through the configured authenticated hook', async () => {
    class ControlTransport implements JsonRpcTransport {
      handler: MessageHandler | null = null;
      results: Array<{ id: string | number; result: unknown }> = [];
      errors: Array<{ id: string | number | null; code: number }> = [];
      start(handler: MessageHandler): void { this.handler = handler; }
      stop(): void { /* no-op */ }
      send(): void { /* no-op */ }
      notify(): void { /* no-op */ }
      request(): Promise<unknown> { return Promise.resolve(undefined); }
      sendResult(id: string | number, result: unknown): void { this.results.push({ id, result }); }
      sendError(id: string | number | null, code: number): void { this.errors.push({ id, code }); }
    }
    const engine = new MCPEngine({ watch: false });
    const transport = new ControlTransport();
    const reserve = vi.fn(() => true);
    const begin = vi.fn();
    new MCPSession(transport, engine, { shutdown: { reserve, begin } }).start();
    try {
      await transport.handler!({
        jsonrpc: '2.0', id: 2, method: 'codegraph/shutdown',
      } as never);

      expect(transport.errors).toEqual([]);
      expect(transport.results).toEqual([{ id: 2, result: { stopping: true } }]);
      expect(reserve).toHaveBeenCalledOnce();
      expect(begin).toHaveBeenCalledOnce();
    } finally {
      engine.stop();
    }
  });

  it('executes an authenticated shutdown notification without a response', async () => {
    class ControlTransport implements JsonRpcTransport {
      handler: MessageHandler | null = null;
      results: Array<{ id: string | number; result: unknown }> = [];
      errors: Array<{ id: string | number | null; code: number }> = [];
      start(handler: MessageHandler): void { this.handler = handler; }
      stop(): void { /* no-op */ }
      send(): void { /* no-op */ }
      notify(): void { /* no-op */ }
      request(): Promise<unknown> { return Promise.resolve(undefined); }
      sendResult(id: string | number, result: unknown): void { this.results.push({ id, result }); }
      sendError(id: string | number | null, code: number): void { this.errors.push({ id, code }); }
    }
    const engine = new MCPEngine({ watch: false });
    const transport = new ControlTransport();
    const reserve = vi.fn(() => true);
    const begin = vi.fn();
    new MCPSession(transport, engine, { shutdown: { reserve, begin } }).start();
    try {
      await transport.handler!({
        jsonrpc: '2.0', method: 'codegraph/shutdown',
      } as never);

      expect(transport.errors).toEqual([]);
      expect(transport.results).toEqual([]);
      expect(reserve).toHaveBeenCalledOnce();
      expect(begin).toHaveBeenCalledOnce();
    } finally {
      engine.stop();
    }
  });

  it('begins daemon shutdown only after the accepted response flushes', async () => {
    let releaseFlush!: () => void;
    const flushed = new Promise<void>((resolve) => { releaseFlush = resolve; });
    class DrainTransport implements JsonRpcTransport {
      handler: MessageHandler | null = null;
      start(handler: MessageHandler): void { this.handler = handler; }
      stop(): void { /* no-op */ }
      send(): void { /* no-op */ }
      notify(): void { /* no-op */ }
      request(): Promise<unknown> { return Promise.resolve(undefined); }
      sendResult(): void { /* sendResultAndWait is the exercised path */ }
      sendResultAndWait(): Promise<void> { return flushed; }
      sendError(): void { /* no-op */ }
    }
    const engine = new MCPEngine({ watch: false });
    const transport = new DrainTransport();
    const reserve = vi.fn(() => true);
    const begin = vi.fn();
    new MCPSession(transport, engine, { shutdown: { reserve, begin } }).start();
    try {
      const handling = transport.handler!({
        jsonrpc: '2.0', id: 3, method: 'codegraph/shutdown',
      } as never);
      await Promise.resolve();
      expect(reserve).toHaveBeenCalledOnce();
      expect(begin).not.toHaveBeenCalled();

      releaseFlush();
      await handling;
      expect(begin).toHaveBeenCalledOnce();
    } finally {
      engine.stop();
    }
  });

  it('reports a stable code without exposing the socket error message', () => {
    vi.stubEnv('CODEGRAPH_MCP_DEBUG', '');
    const socket = new TestSocket();
    const diagnostics = vi.fn();
    const closed = vi.fn();
    const transport = new SocketTransport(socket as unknown as Socket, 'test', diagnostics);
    transport.onClose(closed);
    transport.start(async () => undefined);

    expect(() => socket.emit('error', new Error('private socket path /secret/daemon.sock'))).not.toThrow();

    expect(diagnostics).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith('socket_failure');
    expect(closed).toHaveBeenCalledOnce();
  });

  it('finalizes immediately when the socket closed before start attached listeners', async () => {
    const socket = new TestSocket();
    socket.destroyed = true;
    const closed = vi.fn();
    const transport = new SocketTransport(socket as unknown as Socket, 'test');
    transport.onClose(closed);

    transport.start(async () => undefined);

    expect(closed).toHaveBeenCalledOnce();
    expect(socket.resume).not.toHaveBeenCalled();
    await expect(transport.request('initialize')).rejects.toThrow('Transport stopped');
  });

  it('destroys a session whose unterminated input exceeds the line cap', () => {
    const socket = new TestSocket();
    const diagnostics = vi.fn();
    const transport = new SocketTransport(socket as unknown as Socket, 'test', diagnostics);
    transport.start(async () => undefined);

    socket.emit('data', 'a'.repeat(8 * 1024 * 1024 + 1));

    expect(socket.destroyed).toBe(true);
    expect(diagnostics).toHaveBeenCalledWith('socket_input_overflow');
  });

  it('destroys a session when a valid line leaves an oversized unterminated tail', () => {
    const socket = new TestSocket();
    const diagnostics = vi.fn();
    const handler = vi.fn(async () => undefined);
    const transport = new SocketTransport(socket as unknown as Socket, 'test', diagnostics, {
      maxInputLineBytes: 64,
      maxRetainedInputBytes: 256,
    });
    transport.start(handler);
    const line = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`;

    socket.emit('data', line + 'a'.repeat(65));

    expect(handler).toHaveBeenCalledOnce();
    expect(socket.destroyed).toBe(true);
    expect(diagnostics).toHaveBeenCalledWith('socket_input_overflow');
  });

  it('pauses reads at the handler cap and resumes when one settles', async () => {
    const socket = new TestSocket();
    const releases: Array<() => void> = [];
    const handler = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)));
    const transport = new SocketTransport(socket as unknown as Socket, 'test');
    transport.start(handler);
    const lines = Array.from({ length: 33 }, (_value, index) => JSON.stringify({
      jsonrpc: '2.0', id: index, method: 'tools/list',
    })).join('\n') + '\n';

    socket.emit('data', lines);

    expect(handler).toHaveBeenCalledTimes(32);
    expect(socket.pause).toHaveBeenCalledOnce();
    releases.shift()!();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(33));
    releases.shift()!();
    await vi.waitFor(() => expect(socket.resume).toHaveBeenCalledTimes(2));
    expect(socket.resume).toHaveBeenCalledTimes(2);
    for (const release of releases) release();
  });

  it('shares an active-request semaphore across daemon client transports', async () => {
    const budget = new SocketRequestBudget(1, 1024);
    const firstSocket = new TestSocket();
    const secondSocket = new TestSocket();
    let releaseFirst!: () => void;
    const firstHandler = vi.fn(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    const secondHandler = vi.fn(async () => undefined);
    const first = new SocketTransport(firstSocket as unknown as Socket, 'first', undefined, { requestBudget: budget });
    const second = new SocketTransport(secondSocket as unknown as Socket, 'second', undefined, { requestBudget: budget });
    first.start(firstHandler);
    second.start(secondHandler);
    const firstLine = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`;
    const secondLine = `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`;

    firstSocket.emit('data', firstLine);
    secondSocket.emit('data', secondLine);

    expect(firstHandler).toHaveBeenCalledOnce();
    expect(secondHandler).not.toHaveBeenCalled();
    expect(secondSocket.pause).toHaveBeenCalled();
    expect(budget.snapshot()).toEqual({
      activeMessages: 1,
      retainedBytes: Buffer.byteLength(firstLine + secondLine, 'utf8'),
    });

    releaseFirst();
    await vi.waitFor(() => expect(secondHandler).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(budget.snapshot()).toEqual({ activeMessages: 0, retainedBytes: 0 }));
  });

  it('routes a server-initiated response while the request-handler cap is saturated', async () => {
    const socket = new TestSocket();
    const budget = new SocketRequestBudget(1, 4096);
    const transport = new SocketTransport(socket as unknown as Socket, 'test', undefined, {
      maxActiveMessages: 1,
      requestBudget: budget,
    });
    let received: unknown;
    let finishHandler!: () => void;
    const handlerFinished = new Promise<void>((resolve) => { finishHandler = resolve; });
    transport.start(async () => {
      try {
        received = await transport.request('roots/list', {}, 30_000);
      } finally {
        finishHandler();
      }
    });

    socket.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' })}\n`);
    await vi.waitFor(() => expect(socket.writes).toHaveLength(1));
    const request = JSON.parse(socket.writes[0]!) as { id: string };

    try {
      socket.emit('data', `${JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: { roots: [{ uri: 'file:///tmp/codegraph-control-response' }] },
      })}\n`);

      await vi.waitFor(() => expect(received).toEqual({
        roots: [{ uri: 'file:///tmp/codegraph-control-response' }],
      }), { timeout: 100 });
      await vi.waitFor(() => expect(budget.snapshot()).toEqual({
        activeMessages: 0,
        retainedBytes: 0,
      }));
    } finally {
      transport.stop();
      await handlerFinished;
    }
  });

  it('resumes saturated input when a handler later creates a server request', async () => {
    const socket = new TestSocket();
    const transport = new SocketTransport(socket as unknown as Socket, 'test', undefined, {
      maxActiveMessages: 1,
    });
    let beginRequest!: () => void;
    const requestGate = new Promise<void>((resolve) => { beginRequest = resolve; });
    let received: unknown;
    let finishHandler!: () => void;
    const handlerFinished = new Promise<void>((resolve) => { finishHandler = resolve; });
    transport.start(async () => {
      try {
        await requestGate;
        received = await transport.request('roots/list', {}, 30_000);
      } finally {
        finishHandler();
      }
    });

    socket.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' })}\n`);
    expect(socket.pause).toHaveBeenCalledOnce();

    try {
      beginRequest();
      await vi.waitFor(() => expect(socket.writes).toHaveLength(1));
      expect(socket.resume).toHaveBeenCalledTimes(2);
      const request = JSON.parse(socket.writes[0]!) as { id: string };
      socket.emit('data', `${JSON.stringify({
        jsonrpc: '2.0', id: request.id, result: { roots: [] },
      })}\n`);

      await vi.waitFor(() => expect(received).toEqual({ roots: [] }));
    } finally {
      transport.stop();
      await handlerFinished;
    }
  });

  it('hands released shared request capacity to the oldest waiting socket', async () => {
    const budget = new SocketRequestBudget(1, 4096);
    const busySocket = new TestSocket();
    const waitingSocket = new TestSocket();
    const busyReleases: Array<() => void> = [];
    let releaseWaiting!: () => void;
    const busyHandler = vi.fn(() => new Promise<void>((resolve) => busyReleases.push(resolve)));
    const waitingHandler = vi.fn(() => new Promise<void>((resolve) => { releaseWaiting = resolve; }));
    const busy = new SocketTransport(busySocket as unknown as Socket, 'busy', undefined, {
      requestBudget: budget,
    });
    const waiting = new SocketTransport(waitingSocket as unknown as Socket, 'waiting', undefined, {
      requestBudget: budget,
    });
    busy.start(busyHandler);
    waiting.start(waitingHandler);
    const busyLine = (id: number): string => `${JSON.stringify({
      jsonrpc: '2.0', id, method: 'tools/list',
    })}\n`;
    const waitingLine = `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' })}\n`;

    try {
      busySocket.emit('data', busyLine(1));
      waitingSocket.emit('data', waitingLine);
      busySocket.emit('data', busyLine(2));
      expect(busyHandler).toHaveBeenCalledOnce();
      expect(waitingHandler).not.toHaveBeenCalled();

      busyReleases.shift()!();

      await vi.waitFor(() => expect(waitingHandler).toHaveBeenCalledOnce(), { timeout: 100 });
      expect(busyHandler).toHaveBeenCalledOnce();

      releaseWaiting();
      await vi.waitFor(() => expect(busyHandler).toHaveBeenCalledTimes(2));
    } finally {
      for (const release of busyReleases) release();
      releaseWaiting?.();
      busy.stop();
      waiting.stop();
    }
  });

  it('releases a FIFO grant cancelled before its delivery microtask', async () => {
    const budget = new SocketRequestBudget(1, 1024);
    const ownerRelease = budget.startMessage(() => undefined)!;
    const onGranted = vi.fn((_release: () => void) => undefined);
    expect(budget.startMessage(onGranted)).toBeNull();

    ownerRelease();
    expect(budget.snapshot().activeMessages).toBe(1);
    budget.cancelWait(onGranted);
    expect(budget.snapshot().activeMessages).toBe(0);

    await Promise.resolve();
    expect(onGranted).not.toHaveBeenCalled();
  });

  it('removes cancelled request waiters while shared capacity stays saturated', () => {
    const budget = new SocketRequestBudget(1, 1024);
    const ownerRelease = budget.startMessage(() => undefined)!;

    for (let index = 0; index < 100; index++) {
      const onGranted = vi.fn((_release: () => void) => undefined);
      expect(budget.startMessage(onGranted)).toBeNull();
      budget.cancelWait(onGranted);
    }

    const queue = (budget as unknown as { waiterQueue: unknown[] }).waiterQueue;
    expect(queue).toHaveLength(0);
    ownerRelease();
  });

  it('bounds retained request bytes across multiple daemon client transports', async () => {
    const line = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' })}\n`;
    const lineBytes = Buffer.byteLength(line, 'utf8');
    const budget = new SocketRequestBudget(2, lineBytes);
    const firstSocket = new TestSocket();
    const secondSocket = new TestSocket();
    const diagnostics = vi.fn();
    let releaseFirst!: () => void;
    const first = new SocketTransport(firstSocket as unknown as Socket, 'first', undefined, { requestBudget: budget });
    const second = new SocketTransport(secondSocket as unknown as Socket, 'second', diagnostics, { requestBudget: budget });
    first.start(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    second.start(async () => undefined);

    firstSocket.emit('data', line);
    secondSocket.emit('data', line);

    expect(secondSocket.destroyed).toBe(true);
    expect(diagnostics).toHaveBeenCalledWith('socket_input_overflow');
    expect(budget.snapshot()).toEqual({ activeMessages: 1, retainedBytes: lineBytes });

    releaseFirst();
    await vi.waitFor(() => expect(budget.snapshot()).toEqual({ activeMessages: 0, retainedBytes: 0 }));
  });

  it('rejects a newline-only framing flood before it can monopolize the event loop', async () => {
    const floodedSocket = new TestSocket();
    const healthySocket = new TestSocket();
    const diagnostics = vi.fn();
    const floodedHandler = vi.fn(async () => undefined);
    const healthyHandler = vi.fn(async () => undefined);
    const flooded = new SocketTransport(floodedSocket as unknown as Socket, 'flooded', diagnostics);
    const healthy = new SocketTransport(healthySocket as unknown as Socket, 'healthy');
    flooded.start(floodedHandler);
    healthy.start(healthyHandler);

    floodedSocket.emit('data', '\n'.repeat(4_097));
    healthySocket.emit('data', `${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/list',
    })}\n`);

    expect(floodedSocket.destroyed).toBe(true);
    expect(diagnostics).toHaveBeenCalledWith('socket_input_overflow');
    expect(floodedHandler).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(healthyHandler).toHaveBeenCalledOnce());
  });

  it('aborts disconnected handlers and releases their shared request reservations', async () => {
    const budget = new SocketRequestBudget(1, 1024);
    const firstSocket = new TestSocket();
    const secondSocket = new TestSocket();
    let firstSignal: AbortSignal | undefined;
    const first = new SocketTransport(firstSocket as unknown as Socket, 'first', undefined, {
      requestBudget: budget,
    });
    const secondHandler = vi.fn(async () => undefined);
    const second = new SocketTransport(secondSocket as unknown as Socket, 'second', undefined, {
      requestBudget: budget,
    });
    let releaseFirst!: () => void;
    first.start((_message, signal) => {
      firstSignal = signal;
      return new Promise<void>((resolve) => { releaseFirst = resolve; });
    });
    second.start(secondHandler);
    const firstLine = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`;
    const secondLine = `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`;

    firstSocket.emit('data', firstLine);
    secondSocket.emit('data', secondLine);
    expect(secondHandler).not.toHaveBeenCalled();
    expect(budget.snapshot().activeMessages).toBe(1);

    firstSocket.emit('close');

    expect(firstSignal?.aborted).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(secondHandler).not.toHaveBeenCalled();
    expect(budget.snapshot().activeMessages).toBe(1);

    releaseFirst();

    await vi.waitFor(() => expect(secondHandler).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(budget.snapshot()).toEqual({ activeMessages: 0, retainedBytes: 0 }));
  });

  it('queues bounded output and pauses reads until socket drain', () => {
    const socket = new TestSocket();
    socket.writeResults.push(false, true);
    const transport = new SocketTransport(socket as unknown as Socket, 'test');
    transport.start(async () => undefined);

    transport.sendResult(1, { ok: true });
    transport.sendResult(2, { ok: true });

    expect(socket.writes).toHaveLength(1);
    expect(socket.pause).toHaveBeenCalledOnce();
    socket.drain();
    expect(socket.writes).toHaveLength(2);
    expect(socket.resume).toHaveBeenCalledTimes(2);
  });

  it('preserves a compact overload reply when another client consumes normal output capacity', async () => {
    const firstPayload = `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } })}\n`;
    const emergencyBytes = 1_024;
    const budget = new SocketOutputBudget(
      Buffer.byteLength(firstPayload, 'utf8') + emergencyBytes,
      emergencyBytes,
    );
    const firstSocket = new TestSocket();
    firstSocket.settleWritesAutomatically = false;
    const secondSocket = new TestSocket();
    const diagnostics = vi.fn();
    const first = new SocketTransport(firstSocket as unknown as Socket, 'first', undefined, {
      outputBudget: budget,
    });
    const second = new SocketTransport(secondSocket as unknown as Socket, 'second', diagnostics, {
      outputBudget: budget,
    });
    first.start(async () => undefined);
    second.start(async () => undefined);

    first.sendResult(1, { ok: true });
    expect(budget.snapshot()).toEqual({ retainedBytes: Buffer.byteLength(firstPayload, 'utf8') });

    second.sendResult(2, { ok: true });
    expect(secondSocket.destroyed).toBe(false);
    expect(diagnostics).not.toHaveBeenCalled();
    expect(JSON.parse(secondSocket.writes[0]!)).toMatchObject({
      id: 2,
      error: { code: -32000, data: { reason: 'overloaded' } },
    });
    await vi.waitFor(() => expect(budget.snapshot()).toEqual({
      retainedBytes: Buffer.byteLength(firstPayload, 'utf8'),
    }));

    firstSocket.settleWrites();
    expect(budget.snapshot()).toEqual({ retainedBytes: 0 });
    first.sendResult(3, { ok: true });
    expect(budget.snapshot().retainedBytes).toBeGreaterThan(0);
    first.stop();
    expect(budget.snapshot()).toEqual({ retainedBytes: 0 });
  });

  it.each([7, null] as const)(
    'preserves an accepted shutdown result for id %s when normal output capacity is exhausted',
    async (id) => {
      const firstPayload = `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } })}\n`;
      const emergencyBytes = 1_024;
      const budget = new SocketOutputBudget(
        Buffer.byteLength(firstPayload, 'utf8') + emergencyBytes,
        emergencyBytes,
      );
      const firstSocket = new TestSocket();
      firstSocket.settleWritesAutomatically = false;
      const shutdownSocket = new TestSocket();
      const first = new SocketTransport(firstSocket as unknown as Socket, 'first', undefined, {
        outputBudget: budget,
      });
      const shutdownTransport = new SocketTransport(
        shutdownSocket as unknown as Socket,
        'shutdown',
        undefined,
        { outputBudget: budget },
      );
      const engine = new MCPEngine({ watch: false });
      const reserve = vi.fn(() => true);
      const begin = vi.fn();
      first.start(async () => undefined);
      new MCPSession(shutdownTransport, engine, { shutdown: { reserve, begin } }).start();

      try {
        first.sendResult(1, { ok: true });
        shutdownSocket.emit('data', `${JSON.stringify({
          jsonrpc: '2.0', id, method: 'codegraph/shutdown',
        })}\n`);

        await vi.waitFor(() => expect(shutdownSocket.writes).toHaveLength(1));
        expect(JSON.parse(shutdownSocket.writes[0]!)).toEqual({
          jsonrpc: '2.0', id, result: { stopping: true },
        });
        await vi.waitFor(() => expect(begin).toHaveBeenCalledOnce());
        expect(reserve).toHaveBeenCalledOnce();
      } finally {
        firstSocket.settleWrites();
        first.stop();
        shutdownTransport.stop();
        engine.stop();
      }
    },
  );

  it('destroys a session when output backpressure does not drain before the deadline', () => {
    vi.useFakeTimers();
    const socket = new TestSocket();
    socket.writeResults.push(false);
    const diagnostics = vi.fn();
    const closed = vi.fn();
    const transport = new SocketTransport(socket as unknown as Socket, 'test', diagnostics);
    transport.onClose(closed);
    transport.start(async () => undefined);

    transport.sendResult(1, { ok: true });
    expect(socket.destroyed).toBe(false);
    vi.advanceTimersByTime(5_000);

    expect(socket.destroyed).toBe(true);
    expect(diagnostics).toHaveBeenCalledWith('socket_output_timeout');
    expect(closed).toHaveBeenCalledOnce();
  });

  it('refreshes the output deadline when accepted writes make progress', () => {
    vi.useFakeTimers();
    const socket = new TestSocket();
    socket.settleWritesAutomatically = false;
    socket.writeResults.push(false, false);
    const diagnostics = vi.fn();
    const transport = new SocketTransport(socket as unknown as Socket, 'test', diagnostics);
    transport.start(async () => undefined);

    transport.sendResult(1, { ok: true });
    transport.sendResult(2, { ok: true });
    vi.advanceTimersByTime(4_000);
    socket.settleWrites();
    socket.drain();
    expect(socket.writes).toHaveLength(2);
    expect(socket.destroyed).toBe(false);

    vi.advanceTimersByTime(4_999);
    expect(socket.destroyed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(socket.destroyed).toBe(true);
    expect(diagnostics).toHaveBeenCalledWith('socket_output_timeout');
  });

  it('keeps the output deadline while an accepted write callback is pending', () => {
    vi.useFakeTimers();
    const socket = new TestSocket();
    socket.settleWritesAutomatically = false;
    socket.writeResults.push(true);
    const diagnostics = vi.fn();
    const transport = new SocketTransport(socket as unknown as Socket, 'test', diagnostics);
    transport.start(async () => undefined);

    transport.sendResult(1, { ok: true });
    expect(socket.destroyed).toBe(false);
    vi.advanceTimersByTime(5_000);

    expect(socket.destroyed).toBe(true);
    expect(diagnostics).toHaveBeenCalledWith('socket_output_timeout');
  });

  it('clears the output deadline after every accepted write settles', () => {
    vi.useFakeTimers();
    const socket = new TestSocket();
    socket.settleWritesAutomatically = false;
    const diagnostics = vi.fn();
    const transport = new SocketTransport(socket as unknown as Socket, 'test', diagnostics);
    transport.start(async () => undefined);

    transport.sendResult(1, { ok: true });
    vi.advanceTimersByTime(4_999);
    socket.settleWrites();
    vi.advanceTimersByTime(5_000);

    expect(socket.destroyed).toBe(false);
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it('rejects a waited output when the socket write callback reports an error', async () => {
    const socket = new TestSocket();
    socket.settleWritesAutomatically = false;
    const diagnostics = vi.fn();
    const transport = new SocketTransport(socket as unknown as Socket, 'test', diagnostics);
    transport.start(async () => undefined);

    const flushed = transport.sendResultAndWait(1, { stopping: true });
    socket.settleWrites(new Error('private broken pipe detail'));

    await expect(flushed).rejects.toThrow('Socket closed');
    expect(socket.destroyed).toBe(true);
    expect(diagnostics).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith('socket_failure');
  });

  it('returns a compact error and keeps the session alive when one result exceeds the response cap', () => {
    const socket = new TestSocket();
    const diagnostics = vi.fn();
    const transport = new SocketTransport(socket as unknown as Socket, 'test', diagnostics);
    transport.start(async () => undefined);

    transport.sendResult(1, 'x'.repeat(8 * 1024 * 1024));
    transport.sendResult(2, { ok: true });

    expect(socket.destroyed).toBe(false);
    expect(diagnostics).not.toHaveBeenCalled();
    expect(socket.writes.map((line) => JSON.parse(line))).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: ErrorCodes.InternalError, message: 'Response exceeds transport limit' },
      },
      { jsonrpc: '2.0', id: 2, result: { ok: true } },
    ]);
  });

  it.each([
    ['send', (transport: SocketTransport) => transport.send({
      jsonrpc: '2.0',
      id: 1,
      result: 'x'.repeat(8 * 1024 * 1024),
    })],
    ['sendError', (transport: SocketTransport) => transport.sendError(
      1,
      ErrorCodes.InternalError,
      'x'.repeat(8 * 1024 * 1024),
    )],
  ])('compacts an oversized %s response and keeps the session alive', (_name, sendOversized) => {
    const socket = new TestSocket();
    const diagnostics = vi.fn();
    const transport = new SocketTransport(socket as unknown as Socket, 'test', diagnostics);
    transport.start(async () => undefined);

    sendOversized(transport);
    transport.sendResult(2, { ok: true });

    expect(socket.destroyed).toBe(false);
    expect(diagnostics).not.toHaveBeenCalled();
    expect(socket.writes.map((line) => JSON.parse(line))).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: ErrorCodes.InternalError, message: 'Response exceeds transport limit' },
      },
      { jsonrpc: '2.0', id: 2, result: { ok: true } },
    ]);
  });

  it('fires close handlers exactly once on explicit stop', () => {
    const socket = new TestSocket();
    const closed = vi.fn();
    const transport = new SocketTransport(socket as unknown as Socket, 'test');
    transport.onClose(closed);
    transport.start(async () => undefined);

    transport.stop();
    socket.emit('close');
    transport.stop();

    expect(socket.destroyed).toBe(true);
    expect(closed).toHaveBeenCalledOnce();
  });

  it('rejects an aborted pending round trip and ignores its late response', async () => {
    const socket = new TestSocket();
    const handler = vi.fn(async () => undefined);
    const transport = new SocketTransport(socket as unknown as Socket, 'test');
    transport.start(handler);
    const controller = new AbortController();

    const pending = transport.request('codegraph/read', {}, 30_000, controller.signal);
    const sent = JSON.parse(socket.writes[0] ?? '{}') as { id: string };
    controller.abort();

    await expect(pending).rejects.toThrow('Request aborted');
    socket.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: [] })}\n`);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
  });
});

class TestSocket extends EventEmitter {
  destroyed = false;
  writableLength = 0;
  settleWritesAutomatically = true;
  readonly writes: string[] = [];
  readonly writeResults: boolean[] = [];
  readonly writeCallbacks: Array<(error?: Error) => void> = [];
  readonly pause = vi.fn(() => this);
  readonly resume = vi.fn(() => this);

  setEncoding(): this { return this; }
  write(value: string, callback?: (error?: Error) => void): boolean {
    this.writes.push(value);
    const result = this.writeResults.shift() ?? true;
    if (!result) this.writableLength += Buffer.byteLength(value, 'utf8');
    if (callback) {
      if (this.settleWritesAutomatically) queueMicrotask(callback);
      else this.writeCallbacks.push(callback);
    }
    return result;
  }
  settleWrites(error?: Error): void {
    for (const callback of this.writeCallbacks.splice(0)) callback(error);
  }
  drain(): void {
    this.writableLength = 0;
    this.emit('drain');
  }
  end(): this { return this; }
  destroy(): this { this.destroyed = true; return this; }
}
