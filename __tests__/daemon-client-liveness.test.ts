/**
 * Unit coverage for the daemon-side client-liveness primitives (#692, Layer 2).
 *
 * These back the daemon's defense against a phantom client — one whose process
 * died without the socket ever signalling close (a Windows named-pipe hazard).
 * The wire parsing and the liveness decision are pure, so they're tested here;
 * the full handshake + sweep is exercised end-to-end in `mcp-daemon.test.ts`.
 */
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createDaemonClientProof, normalizeDaemonHostPid } from '../src/mcp/daemon-auth';
import { SocketRequestBudget } from '../src/mcp/transport';
import {
  Daemon,
  MAX_HELLO_LINE_BYTES,
  MAX_DAEMON_CLIENT_CONNECTIONS,
  parseClientHelloLine,
  peerIsDead,
} from '../src/mcp/daemon';

afterEach(() => {
  vi.useRealTimers();
});

describe('parseClientHelloLine', () => {
  const expected = {
    instanceId: '123e4567-e89b-42d3-a456-426614174000',
    authSecret: 'ab'.repeat(32),
    serverNonce: 'cd'.repeat(32),
  };
  const hello = (pid: number, hostPid?: number | null, overrides: Record<string, unknown> = {}) => {
    const nonce = 'ef'.repeat(32);
    const normalizedHostPid = hostPid ?? null;
    return JSON.stringify({
      codegraph_client: 1,
      pid,
      ...(hostPid === undefined ? {} : { hostPid }),
      instanceId: expected.instanceId,
      nonce,
      proof: createDaemonClientProof(expected.authSecret, {
        pid,
        hostPid: normalizedHostPid,
        instanceId: expected.instanceId,
        serverNonce: expected.serverNonce,
        nonce,
      }),
      ...overrides,
    });
  };

  it('parses a well-formed client-hello', () => {
    expect(parseClientHelloLine(hello(1234, 56), expected))
      .toEqual({ pid: 1234, hostPid: 56 });
  });

  it('accepts a null host pid and a missing host pid', () => {
    expect(parseClientHelloLine(hello(1234, null), expected))
      .toEqual({ pid: 1234, hostPid: null });
    expect(parseClientHelloLine(hello(1234), expected))
      .toEqual({ pid: 1234, hostPid: null });
  });

  it('rejects a JSON-RPC message before authentication', () => {
    expect(parseClientHelloLine('{"jsonrpc":"2.0","id":1,"method":"initialize"}', expected)).toBeNull();
  });

  it('rejects a wrong-typed marker, a non-numeric pid, and a non-integer marker', () => {
    expect(parseClientHelloLine('{"codegraph_client":true,"pid":1}', expected)).toBeNull();
    expect(parseClientHelloLine('{"codegraph_client":2,"pid":1}', expected)).toBeNull();
    expect(parseClientHelloLine('{"codegraph_client":1,"pid":"1"}', expected)).toBeNull();
  });

  it('never accepts process-group or non-safe-integer pid values', () => {
    for (const pid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseClientHelloLine(hello(pid, null), expected)).toBeNull();
    }
    for (const hostPid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseClientHelloLine(hello(1234, hostPid), expected)).toBeNull();
    }
  });

  it('rejects the wrong instance or client proof', () => {
    expect(parseClientHelloLine(hello(1234, null, { instanceId: randomUUID() }), expected)).toBeNull();
    expect(parseClientHelloLine(hello(1234, null, { proof: '00'.repeat(32) }), expected)).toBeNull();
  });

  it('returns null for invalid / empty / non-object JSON', () => {
    expect(parseClientHelloLine('not json', expected)).toBeNull();
    expect(parseClientHelloLine('', expected)).toBeNull();
    expect(parseClientHelloLine('42', expected)).toBeNull();
    expect(parseClientHelloLine('null', expected)).toBeNull();
  });
});

describe('normalizeDaemonHostPid', () => {
  it('omits init, process-group, and malformed host pids from the hello', () => {
    expect(normalizeDaemonHostPid(1)).toBeNull();
    expect(normalizeDaemonHostPid(0)).toBeNull();
    expect(normalizeDaemonHostPid(-1)).toBeNull();
    expect(normalizeDaemonHostPid(1.5)).toBeNull();
    expect(normalizeDaemonHostPid(42)).toBe(42);
  });
});

describe('peerIsDead', () => {
  const aliveAll = () => true;
  const deadAll = () => false;
  const deadOnly = (...pids: number[]) => (pid: number) => !pids.includes(pid);

  it('never reaps a client with an unknown pid (no client-hello)', () => {
    expect(peerIsDead({ pid: null, hostPid: null }, deadAll)).toBe(false);
    expect(peerIsDead({ pid: null, hostPid: 99 }, deadAll)).toBe(false);
  });

  it('keeps a client whose proxy is alive', () => {
    expect(peerIsDead({ pid: 100, hostPid: null }, aliveAll)).toBe(false);
  });

  it('reaps a client whose proxy process is gone', () => {
    expect(peerIsDead({ pid: 100, hostPid: null }, deadOnly(100))).toBe(true);
  });

  it('reaps when the proxy is alive but its host is gone', () => {
    // proxy 100 alive, host 42 dead
    expect(peerIsDead({ pid: 100, hostPid: 42 }, deadOnly(42))).toBe(true);
  });

  it('keeps a client when both proxy and host are alive', () => {
    expect(peerIsDead({ pid: 100, hostPid: 42 }, aliveAll)).toBe(false);
  });
});

describe('Daemon.reapDeadClients', () => {
  // Construct with idleTimeoutMs:0 so dropping the last client doesn't arm a real
  // idle timer. The constructor opens no sockets/DB, so this stays a fast unit test.
  const makeDaemon = () => new Daemon('/tmp/codegraph-reap-unit-test', { idleTimeoutMs: 0 }) as any;
  const fakeSession = () => ({ stopped: false, stop() { this.stopped = true; } });

  it('drops clients with a dead peer and leaves live ones attached', () => {
    const d = makeDaemon();
    const dead = fakeSession();
    const live = fakeSession();
    d.clients.add(dead); d.clientPeers.set(dead, { pid: 111, hostPid: null });
    d.clients.add(live); d.clientPeers.set(live, { pid: 222, hostPid: null });

    const reaped = d.reapDeadClients((pid: number) => pid !== 111); // 111 dead, 222 alive

    expect(reaped).toBe(1);
    expect(dead.stopped).toBe(true);
    expect(d.clients.has(dead)).toBe(false);
    expect(d.clientPeers.has(dead)).toBe(false); // peer record cleaned up too
    expect(d.clients.has(live)).toBe(true);
  });

  it('never reaps a client with an unknown pid (no client-hello)', () => {
    const d = makeDaemon();
    const s = fakeSession();
    d.clients.add(s); d.clientPeers.set(s, { pid: null, hostPid: null });

    expect(d.reapDeadClients(() => false)).toBe(0); // everything "dead", but pid unknown
    expect(d.clients.has(s)).toBe(true);
  });

  it('reaps a client whose host pid is gone even if its proxy pid is alive', () => {
    const d = makeDaemon();
    const s = fakeSession();
    d.clients.add(s); d.clientPeers.set(s, { pid: 100, hostPid: 42 });

    expect(d.reapDeadClients((pid: number) => pid !== 42)).toBe(1); // proxy 100 alive, host 42 dead
    expect(d.clients.has(s)).toBe(false);
  });
});

describe('Daemon pending client handshakes', () => {
  class PendingSocket extends EventEmitter {
    destroyed = false;
    readableFlowing: boolean | null = null;
    write = vi.fn(() => true);
    pause = vi.fn(() => this);
    resume = vi.fn(() => this);
    setEncoding = vi.fn(() => this);
    unshift = vi.fn(() => true);

    end(data?: string | Buffer | (() => void), callback?: () => void): this {
      if (typeof data === 'function') callback = data;
      else if (data !== undefined) this.write(data);
      callback?.();
      return this.destroy();
    }

    destroy(): this {
      if (this.destroyed) return this;
      this.destroyed = true;
      this.emit('close');
      return this;
    }
  }

  class HangingControlSocket extends PendingSocket {
    override end(data?: string | Buffer | (() => void)): this {
      if (typeof data !== 'function' && data !== undefined) this.write(data);
      return this;
    }
  }

  it('destroys a pre-session socket during shutdown without creating a phantom client', async () => {
    const daemon = new Daemon('/tmp/codegraph-pending-handshake-unit-test', { idleTimeoutMs: 0 }) as any;
    const socket = new PendingSocket();

    daemon.handleConnection(socket as unknown as Socket);
    expect(daemon.pendingClientSockets.has(socket)).toBe(true);

    daemon.stopping = true;
    daemon.closePendingClientSockets();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(socket.destroyed).toBe(true);
    expect(daemon.pendingClientSockets.size).toBe(0);
    expect(daemon.clients.size).toBe(0);
  });

  it('promotes an authenticated normal client before its first application message', async () => {
    const daemon = new Daemon('/tmp/codegraph-authenticated-idle-unit-test', { idleTimeoutMs: 0 }) as any;
    const socket = new PendingSocket();

    daemon.handleConnection(socket as unknown as Socket);
    const serverHello = JSON.parse(String(socket.write.mock.calls[0]![0]).trim()) as {
      instanceId: string;
      nonce: string;
    };
    const pid = 4242;
    const nonce = 'ef'.repeat(32);
    socket.emit('data', Buffer.from(`${JSON.stringify({
      codegraph_client: 1,
      pid,
      hostPid: null,
      instanceId: serverHello.instanceId,
      nonce,
      proof: createDaemonClientProof(daemon.authSecret, {
        pid,
        hostPid: null,
        instanceId: serverHello.instanceId,
        serverNonce: serverHello.nonce,
        nonce,
      }),
    })}\n`));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(socket.destroyed).toBe(false);
    expect(daemon.pendingClientSockets.size).toBe(0);
    expect(daemon.clients.size).toBe(1);

    socket.destroy();
    await new Promise<void>((resolve) => setImmediate(resolve));
    daemon.engine.stop();
  });

  it('reserves one bounded handshake slot for lifecycle control at the normal client cap', async () => {
    const daemon = new Daemon('/tmp/codegraph-client-cap-unit-test', { idleTimeoutMs: 0 }) as any;
    daemon.clients.add({});
    const accepted = Array.from(
      { length: MAX_DAEMON_CLIENT_CONNECTIONS - 1 },
      () => new PendingSocket(),
    );
    for (const socket of accepted) daemon.handleConnection(socket as unknown as Socket);

    const excess = new PendingSocket();
    daemon.handleConnection(excess as unknown as Socket);
    const secondExcess = new PendingSocket();
    daemon.handleConnection(secondExcess as unknown as Socket);

    expect(daemon.pendingClientSockets.size + daemon.clients.size).toBe(MAX_DAEMON_CLIENT_CONNECTIONS);
    expect(daemon.pendingControlSocket).toBe(excess);
    expect(excess.destroyed).toBe(false);
    expect(excess.write).toHaveBeenCalledOnce();
    expect(secondExcess.destroyed).toBe(true);
    expect(secondExcess.write).not.toHaveBeenCalled();

    daemon.stopping = true;
    daemon.closePendingClientSockets();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(daemon.clients.size).toBe(1);
    daemon.clients.clear();
  });

  it('serves an authenticated first-message shutdown when requests saturate below the client cap', async () => {
    const daemon = new Daemon('/tmp/codegraph-control-reserve-unit-test', { idleTimeoutMs: 0 }) as any;
    daemon.clients.add({ index: 0 });
    daemon.requestBudget = new SocketRequestBudget(0, 0);
    daemon.scheduleAuthenticatedShutdown = vi.fn(() => true);
    const socket = new PendingSocket();

    daemon.handleConnection(socket as unknown as Socket);
    const serverHello = JSON.parse(String(socket.write.mock.calls[0]![0]).trim()) as {
      instanceId: string;
      nonce: string;
    };
    const pid = 4242;
    const nonce = 'ef'.repeat(32);
    socket.emit('data', Buffer.from(`${JSON.stringify({
      codegraph_client: 1,
      pid,
      hostPid: null,
      instanceId: serverHello.instanceId,
      nonce,
      proof: createDaemonClientProof(daemon.authSecret, {
        pid,
        hostPid: null,
        instanceId: serverHello.instanceId,
        serverNonce: serverHello.nonce,
        nonce,
      }),
    })}\n`));
    await new Promise<void>((resolve) => setImmediate(resolve));
    socket.emit('data', Buffer.from(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'stop-1',
      method: 'codegraph/shutdown',
    })}\n`));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const response = socket.write.mock.calls
      .map(([value]) => String(value).trim())
      .map((value) => { try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; } })
      .find((value) => value?.id === 'stop-1');
    expect(response).toMatchObject({ id: 'stop-1', result: { stopping: true } });
    expect(daemon.scheduleAuthenticatedShutdown).toHaveBeenCalledWith();
    expect(daemon.pendingControlSocket).toBeNull();
    expect(daemon.clients.size).toBe(1);
    daemon.clients.clear();
  });

  it('serves shutdown when request capacity saturates after socket authentication', async () => {
    const daemon = new Daemon('/tmp/codegraph-control-race-unit-test', { idleTimeoutMs: 0 }) as any;
    const budget = new SocketRequestBudget(1, 4_096);
    daemon.requestBudget = budget;
    daemon.scheduleAuthenticatedShutdown = vi.fn(() => true);
    const socket = new PendingSocket();

    daemon.handleConnection(socket as unknown as Socket);
    const serverHello = JSON.parse(String(socket.write.mock.calls[0]![0]).trim()) as {
      instanceId: string;
      nonce: string;
    };
    const pid = 4242;
    const nonce = 'ef'.repeat(32);
    socket.emit('data', Buffer.from(`${JSON.stringify({
      codegraph_client: 1,
      pid,
      hostPid: null,
      instanceId: serverHello.instanceId,
      nonce,
      proof: createDaemonClientProof(daemon.authSecret, {
        pid,
        hostPid: null,
        instanceId: serverHello.instanceId,
        serverNonce: serverHello.nonce,
        nonce,
      }),
    })}\n`));
    await new Promise<void>((resolve) => setImmediate(resolve));

    // The connection was admitted while capacity was available. Saturate only
    // after authentication, before the first application message arrives.
    const releaseRequest = budget.startMessage(() => undefined)!;
    socket.emit('data', Buffer.from(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'stop-race',
      method: 'codegraph/shutdown',
    })}\n`));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const response = socket.write.mock.calls
      .map(([value]) => String(value).trim())
      .map((value) => { try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; } })
      .find((value) => value?.id === 'stop-race');
    expect(response).toMatchObject({ id: 'stop-race', result: { stopping: true } });
    expect(daemon.scheduleAuthenticatedShutdown).toHaveBeenCalledWith();
    expect(daemon.pendingControlSocket).toBeNull();
    expect(daemon.clients.size).toBe(0);

    releaseRequest();
  });

  it('preserves an ordinary first message after probing the saturated request control lane', async () => {
    const daemon = new Daemon('/tmp/codegraph-control-promote-unit-test', { idleTimeoutMs: 0 }) as any;
    const budget = new SocketRequestBudget(1, 4_096);
    const releaseRequest = budget.startMessage(() => undefined)!;
    daemon.requestBudget = budget;
    const socket = new PendingSocket();

    daemon.handleConnection(socket as unknown as Socket);
    const serverHello = JSON.parse(String(socket.write.mock.calls[0]![0]).trim()) as {
      instanceId: string;
      nonce: string;
    };
    const pid = 4242;
    const nonce = 'ef'.repeat(32);
    socket.emit('data', Buffer.from(`${JSON.stringify({
      codegraph_client: 1,
      pid,
      hostPid: null,
      instanceId: serverHello.instanceId,
      nonce,
      proof: createDaemonClientProof(daemon.authSecret, {
        pid,
        hostPid: null,
        instanceId: serverHello.instanceId,
        serverNonce: serverHello.nonce,
        nonce,
      }),
    })}\n`));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const firstMessage = Buffer.from(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} },
    })}\n`);
    socket.emit('data', firstMessage);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(socket.destroyed).toBe(false);
    expect(socket.unshift).toHaveBeenCalledWith(firstMessage);
    expect(daemon.pendingControlSocket).toBeNull();
    expect(daemon.clients.size).toBe(1);

    releaseRequest();
    socket.destroy();
    await new Promise<void>((resolve) => setImmediate(resolve));
    daemon.engine.stop();
  });

  it('keeps control sockets bounded until response flush and destroys stalled peers', async () => {
    vi.useFakeTimers();
    const daemon = new Daemon('/tmp/codegraph-control-lifecycle-unit-test', { idleTimeoutMs: 0 }) as any;
    daemon.scheduleAuthenticatedShutdown = vi.fn(() => false);
    for (let index = 0; index < MAX_DAEMON_CLIENT_CONNECTIONS; index++) daemon.clients.add({ index });
    const socket = new HangingControlSocket();
    const handled = daemon.handleAuthenticatedControl(socket as unknown as Socket, Buffer.from(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'stop-wrong',
      method: 'codegraph/shutdown',
    })}\n`));

    expect(handled).toBe(true);
    expect(socket.destroyed).toBe(false);
    expect(daemon.controlSockets.has(socket)).toBe(true);

    const excess = new PendingSocket();
    daemon.handleConnection(excess as unknown as Socket);
    expect(excess.destroyed).toBe(true);
    expect(excess.write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.destroyed).toBe(true);
    expect(daemon.controlSockets.size).toBe(0);
    daemon.clients.clear();
  });

  it('waits for response drain or its deadline before starting accepted shutdown', async () => {
    vi.useFakeTimers();
    const daemon = new Daemon('/tmp/codegraph-control-drain-unit-test', { idleTimeoutMs: 0 }) as any;
    const stop = vi.spyOn(daemon, 'stop').mockResolvedValue(undefined);
    const socket = new HangingControlSocket();

    expect(daemon.handleAuthenticatedControl(socket as unknown as Socket, Buffer.from(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'stop-drain',
      method: 'codegraph/shutdown',
    })}\n`))).toBe(true);

    await vi.advanceTimersByTimeAsync(25);
    expect(stop).not.toHaveBeenCalled();
    expect(socket.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(975);
    expect(stop).toHaveBeenCalledOnce();
    expect(socket.destroyed).toBe(true);
  });

  it('starts accepted shutdown as soon as the response flushes', () => {
    const daemon = new Daemon('/tmp/codegraph-control-flush-unit-test', { idleTimeoutMs: 0 }) as any;
    const stop = vi.spyOn(daemon, 'stop').mockResolvedValue(undefined);
    const socket = new PendingSocket();

    expect(daemon.handleAuthenticatedControl(socket as unknown as Socket, Buffer.from(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'stop-flushed',
      method: 'codegraph/shutdown',
    })}\n`))).toBe(true);

    expect(stop).toHaveBeenCalledOnce();
    expect(socket.destroyed).toBe(true);
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('"id":"stop-flushed"'));
  });

  it('responds to an authenticated saturated-lane shutdown with an explicit null id', () => {
    const daemon = new Daemon('/tmp/codegraph-control-null-id-unit-test', { idleTimeoutMs: 0 }) as any;
    daemon.scheduleAuthenticatedShutdown = vi.fn(() => true);
    daemon.beginAuthenticatedShutdown = vi.fn();
    const socket = new PendingSocket();

    expect(daemon.handleAuthenticatedControl(socket as unknown as Socket, Buffer.from(`${JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      method: 'codegraph/shutdown',
    })}\n`))).toBe(true);

    expect(daemon.scheduleAuthenticatedShutdown).toHaveBeenCalledOnce();
    expect(daemon.beginAuthenticatedShutdown).toHaveBeenCalledOnce();
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('"id":null'));
  });

  it('executes an authenticated shutdown notification without writing a response', () => {
    const daemon = new Daemon('/tmp/codegraph-control-notification-unit-test', { idleTimeoutMs: 0 }) as any;
    daemon.scheduleAuthenticatedShutdown = vi.fn(() => true);
    daemon.beginAuthenticatedShutdown = vi.fn();
    const socket = new PendingSocket();

    expect(daemon.handleAuthenticatedControl(socket as unknown as Socket, Buffer.from(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'codegraph/shutdown',
    })}\n`))).toBe(true);

    expect(daemon.scheduleAuthenticatedShutdown).toHaveBeenCalledOnce();
    expect(daemon.beginAuthenticatedShutdown).toHaveBeenCalledOnce();
    expect(socket.write).not.toHaveBeenCalled();
  });

  it('destroys tracked control sockets during daemon shutdown cleanup', () => {
    const daemon = new Daemon('/tmp/codegraph-control-shutdown-unit-test', { idleTimeoutMs: 0 }) as any;
    daemon.scheduleAuthenticatedShutdown = vi.fn(() => false);
    const socket = new HangingControlSocket();
    daemon.handleAuthenticatedControl(socket as unknown as Socket, Buffer.from(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'stop-wrong',
      method: 'codegraph/shutdown',
    })}\n`));

    daemon.stopping = true;
    daemon.closePendingClientSockets();

    expect(socket.destroyed).toBe(true);
    expect(daemon.controlSockets.size).toBe(0);
  });

  it('rejects an oversized authenticated hello even when its newline arrives in the same chunk', async () => {
    const daemon = new Daemon('/tmp/codegraph-oversized-hello-unit-test', { idleTimeoutMs: 0 }) as any;
    const socket = new PendingSocket();
    daemon.handleConnection(socket as unknown as Socket);
    const serverHello = JSON.parse(String(socket.write.mock.calls[0]![0]).trim()) as {
      instanceId: string;
      nonce: string;
    };
    const pid = 4242;
    const nonce = 'ef'.repeat(32);
    const line = JSON.stringify({
      codegraph_client: 1,
      pid,
      hostPid: null,
      instanceId: serverHello.instanceId,
      nonce,
      proof: createDaemonClientProof(daemon.authSecret, {
        pid,
        hostPid: null,
        instanceId: serverHello.instanceId,
        serverNonce: serverHello.nonce,
        nonce,
      }),
      padding: 'x'.repeat(MAX_HELLO_LINE_BYTES),
    });
    expect(Buffer.byteLength(line)).toBeGreaterThan(MAX_HELLO_LINE_BYTES);

    socket.emit('data', Buffer.from(`${line}\n`));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(socket.destroyed).toBe(true);
    expect(daemon.pendingClientSockets.size).toBe(0);
    expect(daemon.clients.size).toBe(0);
  });

  it('does not idle-stop after a socket has been accepted but before its hello settles', async () => {
    vi.useFakeTimers();
    const daemon = new Daemon('/tmp/codegraph-pending-idle-unit-test', { idleTimeoutMs: 10 }) as any;
    const stop = vi.fn();
    daemon.stop = stop;
    daemon.pendingClientSockets.add({});

    try {
      daemon.armIdleTimer();
      await vi.advanceTimersByTimeAsync(10);

      expect(stop).not.toHaveBeenCalled();
      expect(daemon.idleTimer).not.toBeNull();
    } finally {
      if (daemon.idleTimer) clearTimeout(daemon.idleTimer);
      vi.useRealTimers();
    }
  });
});

// The inactivity backstop (#692) must reap a phantom daemon but NEVER a
// live-but-quiet session — reaping the latter silently degraded that session
// (and any others sharing the daemon) to an in-process engine, and on a real
// machine it fired far more often on live sessions than on actual phantoms.
describe('Daemon.backstopShouldExit', () => {
  // maxIdleMs small; idleTimeoutMs:0 so a sweep that empties the set doesn't arm
  // a real timer. Force the inactivity window open by backdating lastActivityAt.
  const makeDaemon = () => {
    const d = new Daemon('/tmp/codegraph-backstop-unit-test', { idleTimeoutMs: 0, maxIdleMs: 1000 }) as any;
    d.lastActivityAt = Date.now() - 60_000; // long past the 1000ms window
    return d;
  };
  const fakeSession = () => ({ stopped: false, stop() { this.stopped = true; } });

  it('does NOT reap while a provably-alive client stays connected (the fix)', () => {
    const d = makeDaemon();
    const live = fakeSession();
    d.clients.add(live); d.clientPeers.set(live, { pid: 222, hostPid: null });

    expect(d.backstopShouldExit(() => true)).toBe(false); // 222 alive → keep the daemon
    expect(d.clients.has(live)).toBe(true);
  });

  it('reaps when only an unknown-pid client remains (the phantom the sweep cannot catch)', () => {
    const d = makeDaemon();
    const phantom = fakeSession();
    d.clients.add(phantom); d.clientPeers.set(phantom, { pid: null, hostPid: null });

    // Unknown pid → the sweep leaves it, and after the window it's a probable phantom.
    expect(d.backstopShouldExit(() => false)).toBe(true);
  });

  it('protects a live session even when a phantom is also connected', () => {
    const d = makeDaemon();
    const live = fakeSession();
    const phantom = fakeSession();
    d.clients.add(live); d.clientPeers.set(live, { pid: 222, hostPid: null });
    d.clients.add(phantom); d.clientPeers.set(phantom, { pid: null, hostPid: null });

    // 222 alive, phantom unknown → ANY alive keeps the daemon; the live one wins.
    expect(d.backstopShouldExit((pid: number) => pid === 222)).toBe(false);
    expect(d.clients.has(live)).toBe(true);
  });

  it('sweeps a dead-peer client first; if that empties the set it does not exit', () => {
    const d = makeDaemon();
    const dead = fakeSession();
    d.clients.add(dead); d.clientPeers.set(dead, { pid: 111, hostPid: null });

    // 111 dead → swept by backstopShouldExit; empty set → idle timer owns it, no backstop exit.
    expect(d.backstopShouldExit(() => false)).toBe(false);
    expect(d.clients.has(dead)).toBe(false);
    expect(dead.stopped).toBe(true);
  });

  it('does not exit before the inactivity window elapses', () => {
    const d = makeDaemon();
    d.lastActivityAt = Date.now(); // fresh — inside the 1000ms window
    const phantom = fakeSession();
    d.clients.add(phantom); d.clientPeers.set(phantom, { pid: null, hostPid: null });

    expect(d.backstopShouldExit(() => false)).toBe(false);
    expect(d.clients.has(phantom)).toBe(true); // not even swept yet
  });

  it('does not exit with zero clients (the idle timer owns that case)', () => {
    const d = makeDaemon();
    expect(d.backstopShouldExit(() => false)).toBe(false);
  });
});
