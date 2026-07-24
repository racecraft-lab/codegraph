/**
 * Proxy connect resilience — issue #974.
 *
 * `connectWithHello` returns a live socket to the caller, which then attaches
 * its own onDaemonLost handler. Before #974, `readHelloLine` attached an
 * 'error' listener and REMOVED it on success, leaving a window where the socket
 * had no 'error' listener — and a socket 'error' with no listener is re-thrown
 * by Node as an uncaughtException, which the global fatal handler turns into
 * process.exit(1). To an MCP client that is a bare "Transport closed". The fix
 * keeps a guard 'error' listener attached for the socket's whole life.
 *
 * AF_UNIX over WSL2/DrvFs makes that window common; here we just prove the
 * invariant on a normal socket: the returned socket always has an 'error'
 * listener, and emitting an error on it never throws.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import { Duplex, PassThrough, Writable } from 'node:stream';
import {
  connectWithHello,
  MAX_PROXY_BUFFERED_BYTES,
  MAX_PROXY_IN_FLIGHT_REQUESTS,
  MAX_PROXY_REQUEST_LINE_BYTES,
  MAX_PROXY_RESPONSE_LINE_BYTES,
  MAX_PROXY_RETAINED_REQUEST_BYTES,
  pipeUntilClose,
  runLocalHandshakeProxy,
} from '../src/mcp/proxy';
import { CodeGraphPackageVersion, UNKNOWN_CODEGRAPH_VERSION } from '../src/mcp/version';
import type { MCPEngine } from '../src/mcp/engine';
import {
  DAEMON_HANDSHAKE_PROTOCOL,
  createDaemonAuthNonce,
  createDaemonAuthSecret,
  createDaemonClientProof,
  createDaemonServerProof,
} from '../src/mcp/daemon-auth';

const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (cleanups.length) {
    try { cleanups.pop()!(); } catch { /* best-effort */ }
  }
});

const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function controlledSocket(writeResults: boolean[] = []): {
  socket: net.Socket;
  writes: string[];
} {
  const socket = new Duplex({
    read(): void { /* test drives inbound data explicitly */ },
    write(_chunk, _encoding, callback): void { callback(); },
  }) as net.Socket;
  const writes: string[] = [];
  vi.spyOn(socket, 'write').mockImplementation(((
    chunk: string | Buffer,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    const completion = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    completion?.();
    return writeResults.shift() ?? true;
  }) as typeof socket.write);
  return { socket, writes };
}

function proxyHarness(options: {
  socket?: net.Socket | null | Promise<net.Socket | null>;
  getDaemonSocket?: (signal: AbortSignal) => Promise<net.Socket | null>;
  execute?: () => Promise<unknown>;
} = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const diagnostics = new PassThrough();
  let stdout = '';
  let stderr = '';
  let exitCode: number | null = null;
  output.setEncoding('utf8');
  diagnostics.setEncoding('utf8');
  output.on('data', (chunk: string) => { stdout += chunk; });
  diagnostics.on('data', (chunk: string) => { stderr += chunk; });
  const execute = options.execute ?? (async () => ({ content: [] }));
  const engine = {
    ensureInitialized: async () => undefined,
    getToolHandler: () => ({ execute }),
    stop: vi.fn(),
  } as unknown as MCPEngine;
  const socket = options.socket instanceof Promise
    ? options.socket
    : Promise.resolve(options.socket ?? null);
  const completed = runLocalHandshakeProxy({
    getDaemonSocket: options.getDaemonSocket ?? (async () => socket),
    makeEngine: () => engine,
    root: os.tmpdir(),
    input,
    output,
    diagnostics,
    exit: (code) => { exitCode = code; },
    installLifecycleGuards: false,
  });
  return {
    input,
    output,
    diagnostics,
    completed,
    execute,
    stdout: () => stdout,
    stderr: () => stderr,
    exitCode: () => exitCode,
  };
}

/** Stand up a fake daemon that emits a valid hello line on connect. */
async function fakeDaemon(version: string): Promise<{
  sockPath: string;
  server: net.Server;
  clientHello: Promise<Record<string, unknown>>;
  instanceId: string;
  authSecret: string;
  serverNonce: string;
}> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-proxy-'));
  const sockPath = path.join(dir, 'd.sock');
  let resolveClientHello!: (hello: Record<string, unknown>) => void;
  const clientHello = new Promise<Record<string, unknown>>((resolve) => {
    resolveClientHello = resolve;
  });
  const instanceId = randomUUID();
  const authSecret = createDaemonAuthSecret();
  const serverNonce = createDaemonAuthNonce();
  const server = net.createServer((socket) => {
    const helloFields = {
      codegraph: version,
      pid: process.pid,
      socketPath: sockPath,
      instanceId,
    };
    const hello = {
      ...helloFields,
      protocol: DAEMON_HANDSHAKE_PROTOCOL,
      nonce: serverNonce,
      proof: createDaemonServerProof(authSecret, { ...helloFields, nonce: serverNonce }),
    };
    socket.write(JSON.stringify(hello) + '\n');
    let buffered = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      const newline = buffered.indexOf('\n');
      if (newline >= 0) resolveClientHello(JSON.parse(buffered.slice(0, newline)));
    });
  });
  await new Promise<void>((resolve) => server.listen(sockPath, resolve));
  cleanups.push(() => server.close());
  cleanups.push(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
  return { sockPath, server, clientHello, instanceId, authSecret, serverNonce };
}

function expectedIdentity(
  sockPath: string,
  instanceId: string,
  authSecret = createDaemonAuthSecret(),
  version = CodeGraphPackageVersion,
) {
  return { pid: process.pid, version, socketPath: sockPath, startedAt: Date.now(), instanceId, authSecret };
}

describe('connectWithHello — socket is never left without an error listener (#974)', () => {
  it.runIf(process.platform !== 'win32')('returns a socket that has an error listener and never throws on error', async () => {
    const { sockPath, instanceId, authSecret } = await fakeDaemon(CodeGraphPackageVersion);

    const result = await connectWithHello(sockPath, CodeGraphPackageVersion, {
      expectedIdentity: expectedIdentity(sockPath, instanceId, authSecret),
    });
    expect(result).not.toBeNull();
    expect(result).not.toBe('version-mismatch');

    const socket = result as net.Socket;
    cleanups.push(() => socket.destroy());

    // The invariant: a guard 'error' listener is attached for the socket's whole
    // life, so a stray socket error can't escalate to an uncaughtException.
    expect(socket.listenerCount('error')).toBeGreaterThanOrEqual(1);

    // Emitting an error must NOT throw. Without the guard this is exactly the
    // path that crashed the proxy with "Transport closed".
    expect(() => socket.emit('error', new Error('simulated ECONNRESET'))).not.toThrow();
  });

  it.runIf(process.platform !== 'win32')('still reports version-mismatch (and that path does not throw)', async () => {
    const version = '0.0.0-not-our-version';
    const { sockPath, instanceId, authSecret } = await fakeDaemon(version);
    const result = await connectWithHello(sockPath, CodeGraphPackageVersion, {
      expectedIdentity: expectedIdentity(sockPath, instanceId, authSecret, version),
    });
    expect(result).toBe('version-mismatch');
  });

  it('rejects daemon sharing when the local package version is unknown', async () => {
    const result = await connectWithHello('/not-contacted', UNKNOWN_CODEGRAPH_VERSION, {
      expectedIdentity: expectedIdentity(
        '/not-contacted',
        randomUUID(),
        createDaemonAuthSecret(),
        UNKNOWN_CODEGRAPH_VERSION,
      ),
    });

    expect(result).toBe('version-mismatch');
  });

  it.runIf(process.platform !== 'win32')('returns null when no daemon is listening', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-proxy-none-'));
    cleanups.push(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
    const sockPath = path.join(dir, 'missing.sock');
    const result = await connectWithHello(sockPath, CodeGraphPackageVersion, {
      expectedIdentity: expectedIdentity(sockPath, randomUUID()),
    });
    expect(result).toBeNull();
  });

  it.runIf(process.platform !== 'win32')('can omit a transient launcher pid from the reverse hello', async () => {
    const { sockPath, clientHello, instanceId, authSecret, serverNonce } = await fakeDaemon(CodeGraphPackageVersion);

    const result = await connectWithHello(sockPath, CodeGraphPackageVersion, {
      hostPid: null,
      expectedIdentity: expectedIdentity(sockPath, instanceId, authSecret),
    });
    expect(result).not.toBeNull();
    expect(result).not.toBe('version-mismatch');
    cleanups.push(() => (result as net.Socket).destroy());

    const reverse = await clientHello;
    expect(reverse).toMatchObject({
      codegraph_client: 1,
      pid: process.pid,
      hostPid: null,
      instanceId,
      nonce: expect.any(String),
      proof: expect.any(String),
    });
    expect(reverse.proof).toBe(createDaemonClientProof(authSecret, {
      pid: process.pid,
      hostPid: null,
      instanceId,
      serverNonce,
      nonce: reverse.nonce as string,
    }));
  });

  it.runIf(process.platform !== 'win32')('rejects a predictable socket whose hello does not match the lock identity', async () => {
    const { sockPath, authSecret } = await fakeDaemon(CodeGraphPackageVersion);
    const result = await connectWithHello(sockPath, CodeGraphPackageVersion, {
      expectedIdentity: {
        pid: process.pid,
        version: CodeGraphPackageVersion,
        socketPath: sockPath,
        startedAt: Date.now(),
        instanceId: randomUUID(),
        authSecret,
      },
    });

    expect(result).toBeNull();
  });

  it.runIf(process.platform !== 'win32')('destroys an in-flight hello socket when its owner aborts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-proxy-abort-'));
    const sockPath = path.join(dir, 'd.sock');
    let accepted!: () => void;
    const connected = new Promise<void>((resolve) => { accepted = resolve; });
    let closed!: () => void;
    const socketClosed = new Promise<void>((resolve) => { closed = resolve; });
    const server = net.createServer((socket) => {
      accepted();
      socket.once('close', closed);
      // Deliberately never send the daemon hello.
    });
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));
    cleanups.push(() => server.close());
    cleanups.push(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
    const controller = new AbortController();

    const result = connectWithHello(sockPath, CodeGraphPackageVersion, {
      signal: controller.signal,
      expectedIdentity: expectedIdentity(sockPath, randomUUID()),
    });
    await connected;
    controller.abort();

    await expect(result).resolves.toBeNull();
    await socketClosed;
  });
});

describe('plain proxy pipe resource bounds', () => {
  it('pauses stdin on daemon backpressure and resumes it on drain', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const { socket, writes } = controlledSocket([false, true]);
    const pause = vi.spyOn(input, 'pause');
    const resume = vi.spyOn(input, 'resume');
    const completed = pipeUntilClose(socket, { input, output });

    input.write('first');
    await turn();
    input.write('second');
    await turn();
    expect(writes).toEqual(['first']);
    expect(pause).toHaveBeenCalled();

    socket.emit('drain');
    await turn();
    expect(writes).toEqual(['first', 'second']);
    expect(resume).toHaveBeenCalled();

    input.end();
    socket.push(null);
    await expect(completed).resolves.toBe(0);
  });

  it('pauses daemon input on client-output backpressure and resumes it on drain', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const { socket } = controlledSocket();
    const writes: string[] = [];
    const writeResults = [false, true];
    vi.spyOn(output, 'write').mockImplementation(((
      chunk: string | Buffer,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      const completion = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
      completion?.();
      return writeResults.shift() ?? true;
    }) as typeof output.write);
    const pause = vi.spyOn(socket, 'pause');
    const resume = vi.spyOn(socket, 'resume');
    const completed = pipeUntilClose(socket, { input, output });

    socket.push('first');
    await turn();
    socket.push('second');
    await turn();
    expect(writes).toEqual(['first']);
    expect(pause).toHaveBeenCalled();

    output.emit('drain');
    await turn();
    expect(writes).toEqual(['first', 'second']);
    expect(resume).toHaveBeenCalled();

    socket.push(null);
    await expect(completed).resolves.toBe(0);
  });

  it('waits for the final daemon-bound write before completing stdin EOF', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const writes: string[] = [];
    let releaseWrite!: () => void;
    const socket = new Duplex({
      read(): void { /* test drives daemon output */ },
      write(chunk, _encoding, callback): void {
        writes.push(chunk.toString('utf8'));
        releaseWrite = callback;
      },
    }) as net.Socket;
    const completed = pipeUntilClose(socket, { input, output });
    let settled = false;
    void completed.then(() => { settled = true; });

    input.end('final-request');
    await turn();
    expect(writes).toEqual(['final-request']);
    expect(settled).toBe(false);

    socket.push(null);
    releaseWrite();
    await expect(completed).resolves.toBe(0);
  });

  it('waits for the final client-output write before completing daemon EOF', async () => {
    const input = new PassThrough();
    const outputChunks: string[] = [];
    let releaseWrite!: () => void;
    const output = new Writable({
      write(chunk, _encoding, callback): void {
        outputChunks.push(chunk.toString('utf8'));
        releaseWrite = callback;
      },
    });
    const { socket } = controlledSocket();
    const completed = pipeUntilClose(socket, { input, output });
    let settled = false;
    void completed.then(() => { settled = true; });

    socket.push('final-response');
    socket.push(null);
    await turn();
    expect(outputChunks).toEqual(['final-response']);
    expect(settled).toBe(false);

    releaseWrite();
    await expect(completed).resolves.toBe(0);
  });

  it('drains an accepted client-output write before reporting daemon socket failure', async () => {
    const input = new PassThrough();
    let releaseWrite!: () => void;
    const output = new Writable({
      write(_chunk, _encoding, callback): void { releaseWrite = callback; },
    });
    const { socket } = controlledSocket();
    const completed = pipeUntilClose(socket, { input, output });
    let settled = false;
    void completed.then(() => { settled = true; });

    socket.push('accepted-response');
    await turn();
    socket.emit('error', new Error('simulated daemon failure'));
    await turn();

    expect(settled).toBe(false);
    releaseWrite();
    await expect(completed).resolves.toBe(1);
  });

  it('reports an input stream error as failure after draining accepted writes', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    output.resume();
    diagnostics.resume();
    const { socket } = controlledSocket();
    const completed = pipeUntilClose(socket, { input, output, diagnostics });

    input.emit('error', new Error('simulated stdin failure'));
    socket.push(null);

    await expect(completed).resolves.toBe(1);
  });

  it('fails within the bounded deadline when daemon backpressure does not drain', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    let stderr = '';
    output.resume();
    diagnostics.setEncoding('utf8');
    diagnostics.on('data', (chunk: string) => { stderr += chunk; });
    const { socket } = controlledSocket([false]);
    const completed = pipeUntilClose(socket, {
      input,
      output,
      diagnostics,
      drainDeadlineMs: 20,
    });

    input.write('blocked');

    await expect(completed).resolves.toBe(1);
    expect(stderr).toContain('proxy_drain_timeout');
    expect(socket.destroyed).toBe(true);
  });

  it('contains an asynchronous client-output failure and exits nonzero', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const { socket } = controlledSocket();
    const completed = pipeUntilClose(socket, { input, output, diagnostics });

    expect(() => output.emit('error', new Error('simulated EPIPE'))).not.toThrow();

    await expect(completed).resolves.toBe(1);
    expect(socket.destroyed).toBe(true);
  });
});

describe('local-handshake proxy resource bounds', () => {
  it('terminates a newline-only client framing flood after bounded work', async () => {
    const harness = proxyHarness({ socket: null });

    try {
      harness.input.write('\n'.repeat(4_097));
      await turn();

      expect(harness.exitCode()).toBe(1);
      expect(harness.stderr()).toContain('input overflow');
    } finally {
      harness.input.destroy();
      await harness.completed;
    }
  });

  it('drops a daemon that sends a newline-only framing flood', async () => {
    const { socket } = controlledSocket();
    const harness = proxyHarness({ socket });

    try {
      harness.input.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n');
      await turn();
      expect(socket.destroyed).toBe(false);

      socket.push('\n'.repeat(4_097));
      await turn();

      expect(socket.destroyed).toBe(true);
      expect(harness.stderr()).toContain('Shared daemon connection lost');
    } finally {
      harness.input.destroy();
      await harness.completed;
    }
  });

  it('does not attach an authenticated daemon until daemon-bound input arrives', async () => {
    vi.useFakeTimers();
    const { socket, writes } = controlledSocket();
    const getDaemonSocket = vi.fn(async () => socket);
    const harness = proxyHarness({ getDaemonSocket });

    try {
      await vi.advanceTimersByTimeAsync(3_001);
      expect(getDaemonSocket).not.toHaveBeenCalled();

      harness.input.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }) + '\n');
      for (let index = 0; index < 5; index++) await Promise.resolve();

      expect(getDaemonSocket).toHaveBeenCalledOnce();
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain('"method":"initialize"');
    } finally {
      harness.input.destroy();
      await harness.completed;
      vi.useRealTimers();
    }
  });

  it('aborts an abandoned daemon connection and destroys a late socket result', async () => {
    const { socket } = controlledSocket();
    let resolveSocket!: (value: net.Socket | null) => void;
    const pendingSocket = new Promise<net.Socket | null>((resolve) => { resolveSocket = resolve; });
    let connectionSignal: AbortSignal | null = null;
    const harness = proxyHarness({
      getDaemonSocket: async (signal) => {
        connectionSignal = signal;
        return pendingSocket;
      },
    });
    harness.input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
    await turn();
    expect(connectionSignal?.aborted).toBe(false);

    harness.input.destroy();
    await harness.completed;
    expect(connectionSignal?.aborted).toBe(true);

    resolveSocket(socket);
    await turn();
    expect(socket.destroyed).toBe(true);
  });

  it('pauses stdin on daemon backpressure and resumes the buffered line on drain', async () => {
    const { socket, writes } = controlledSocket([false, true]);
    const harness = proxyHarness({ socket });
    await turn();
    const pause = vi.spyOn(harness.input, 'pause');
    const resume = vi.spyOn(harness.input, 'resume');

    harness.input.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n'
    );
    await turn();

    expect(writes).toHaveLength(1);
    expect(pause).toHaveBeenCalled();
    socket.emit('drain');
    await turn();
    expect(writes).toHaveLength(2);
    expect(resume).toHaveBeenCalled();

    harness.input.destroy();
    await harness.completed;
  });

  it('pauses stdin on client-output backpressure and resumes retained input on drain', async () => {
    const harness = proxyHarness({ socket: null });
    await turn();
    const writes: string[] = [];
    const results = [false, true];
    vi.spyOn(harness.output, 'write').mockImplementation(((chunk: string | Buffer) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return results.shift() ?? true;
    }) as typeof harness.output.write);
    const pause = vi.spyOn(harness.input, 'pause');
    const resume = vi.spyOn(harness.input, 'resume');

    harness.input.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n'
    );
    await turn();
    expect(writes).toHaveLength(1);
    expect(pause).toHaveBeenCalled();

    harness.output.emit('drain');
    await turn();
    expect(writes).toHaveLength(2);
    expect(resume).toHaveBeenCalled();

    harness.input.destroy();
    await harness.completed;
  });

  it('discards buffered daemon responses before replaying in-flight work locally', async () => {
    const execute = vi.fn(async () => ({ content: [{ type: 'text', text: 'local' }] }));
    const { socket, writes: daemonWrites } = controlledSocket();
    const harness = proxyHarness({ socket, execute });
    await turn();
    const clientWrites: string[] = [];
    const writeResults = [false, true, true];
    vi.spyOn(harness.output, 'write').mockImplementation(((chunk: string | Buffer) => {
      clientWrites.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return writeResults.shift() ?? true;
    }) as typeof harness.output.write);

    harness.input.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'codegraph_status' },
      }) + '\n' +
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'codegraph_status' },
      }) + '\n'
    );
    await turn();
    expect(daemonWrites).toHaveLength(2);

    socket.push(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { source: 'daemon' } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, result: { source: 'stale-daemon' } }) + '\n'
    );
    await turn();
    expect(clientWrites).toHaveLength(1);

    socket.emit('close');
    await turn();
    await turn();
    expect(execute).toHaveBeenCalledTimes(1);

    harness.output.emit('drain');
    await turn();

    const responses = clientWrites.map((line) => JSON.parse(line) as {
      id: number;
      result?: { source?: string; content?: unknown[] };
    });
    expect(responses.map((response) => response.id)).toEqual([1, 2]);
    expect(responses.filter((response) => response.id === 2)).toHaveLength(1);
    expect(responses[1]?.result?.content).toEqual([{ type: 'text', text: 'local' }]);

    harness.input.destroy();
    await harness.completed;
  });

  it('rejects daemon-bound requests above the in-flight cap without forwarding them', async () => {
    const { socket, writes } = controlledSocket();
    const harness = proxyHarness({ socket });
    await turn();
    const requests = Array.from({ length: MAX_PROXY_IN_FLIGHT_REQUESTS + 1 }, (_, index) =>
      JSON.stringify({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: 'codegraph_status' } })
    ).join('\n') + '\n';

    harness.input.write(requests);
    await turn();

    expect(writes).toHaveLength(MAX_PROXY_IN_FLIGHT_REQUESTS);
    expect(harness.stdout()).toContain('"id":33');
    expect(harness.stdout()).toContain('"reason":"overloaded"');

    harness.input.destroy();
    await harness.completed;
  });

  it('rejects daemon-bound requests above the retained-byte cap before the count cap', async () => {
    const { socket, writes } = controlledSocket();
    const harness = proxyHarness({ socket });
    await turn();
    const payload = 'x'.repeat(Math.floor(MAX_PROXY_RETAINED_REQUEST_BYTES / 3));
    const requests = Array.from({ length: 3 }, (_, index) => JSON.stringify({
      jsonrpc: '2.0',
      id: index + 1,
      method: 'tools/call',
      params: { name: 'codegraph_status', payload },
    }) + '\n');

    for (const request of requests) {
      harness.input.write(request);
      await turn();
    }

    expect(writes).toHaveLength(2);
    expect(harness.stdout()).toContain('"id":3');
    expect(harness.stdout()).toContain('"reason":"overloaded"');

    harness.input.destroy();
    await harness.completed;
  });

  it('caps concurrent in-process fallback calls and returns overload errors', async () => {
    const execute = vi.fn(() => new Promise<unknown>(() => { /* held until teardown */ }));
    const harness = proxyHarness({ socket: null, execute });
    await turn();
    const requests = Array.from({ length: MAX_PROXY_IN_FLIGHT_REQUESTS + 1 }, (_, index) =>
      JSON.stringify({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: 'codegraph_status' } })
    ).join('\n') + '\n';

    harness.input.write(requests);
    await turn();
    await turn();

    expect(execute).toHaveBeenCalledTimes(MAX_PROXY_IN_FLIGHT_REQUESTS);
    expect(harness.stdout()).toContain('"id":33');
    expect(harness.stdout()).toContain('"reason":"overloaded"');

    harness.input.destroy();
    await harness.completed;
  });

  it('returns a compact error for an oversized in-process result and keeps serving', async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: 'text', text: 'x'.repeat(MAX_PROXY_RESPONSE_LINE_BYTES) }],
    }));
    const harness = proxyHarness({ socket: null, execute });
    await turn();

    harness.input.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'codegraph_status' },
    }) + '\n');
    await turn();
    await turn();

    expect(harness.exitCode()).toBeNull();
    expect(harness.stdout()).toContain('"id":1');
    expect(harness.stdout()).toContain('Response exceeds transport limit');

    harness.input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n');
    await turn();
    expect(harness.stdout()).toContain('"id":2');

    harness.input.destroy();
    await harness.completed;
  });

  it('compacts an oversized completed daemon response without replaying the request', async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: 'text', text: 'x'.repeat(MAX_PROXY_RESPONSE_LINE_BYTES) }],
    }));
    const { socket } = controlledSocket();
    const harness = proxyHarness({ socket, execute });
    await turn();

    harness.input.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'codegraph_status' },
    }) + '\n');
    await turn();
    const oversizedResponse = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { content: 'x'.repeat(MAX_PROXY_RESPONSE_LINE_BYTES) },
    }) + '\n';
    const splitAt = MAX_PROXY_RESPONSE_LINE_BYTES + 1;
    socket.push(oversizedResponse.slice(0, splitAt));
    await turn();

    expect(socket.destroyed).toBe(false);
    expect(execute).not.toHaveBeenCalled();

    socket.push(oversizedResponse.slice(splitAt));
    await turn();
    await turn();

    expect(execute).not.toHaveBeenCalled();
    expect(harness.exitCode()).toBeNull();
    expect(harness.stdout()).toContain('"id":1');
    expect(harness.stdout()).toContain('Response exceeds transport limit');

    harness.input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    await turn();
    socket.push(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } }) + '\n');
    await turn();
    expect(harness.stdout()).toContain('"id":2');
    expect(execute).not.toHaveBeenCalled();

    harness.input.destroy();
    await harness.completed;
  });

  it('fails unknown daemon work instead of replaying it after a response buffer overflow', async () => {
    const execute = vi.fn(async () => ({ content: [{ type: 'text', text: 'replayed' }] }));
    const { socket } = controlledSocket();
    const harness = proxyHarness({ socket, execute });
    await turn();

    harness.input.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'codegraph_status' },
    }) + '\n');
    await turn();
    socket.push('x'.repeat(MAX_PROXY_BUFFERED_BYTES + 1));
    await turn();
    await turn();

    expect(socket.destroyed).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(harness.stdout()).toContain('"id":1');
    expect(harness.stdout()).toContain('Response exceeds transport limit');

    harness.input.destroy();
    await harness.completed;
  });

  it('bounds the pre-attachment queue and drains remaining stdin after connection failure', async () => {
    let resolveSocket!: (socket: net.Socket | null) => void;
    const socket = new Promise<net.Socket | null>((resolve) => { resolveSocket = resolve; });
    const harness = proxyHarness({ socket });
    const pause = vi.spyOn(harness.input, 'pause');
    const requests = Array.from({ length: MAX_PROXY_IN_FLIGHT_REQUESTS + 1 }, (_, index) =>
      JSON.stringify({ jsonrpc: '2.0', id: index + 1, method: 'ping' })
    ).join('\n') + '\n';

    harness.input.write(requests);
    await turn();
    expect(pause).toHaveBeenCalled();
    expect(harness.stdout()).toBe('');

    resolveSocket(null);
    await turn();
    await turn();
    await turn();
    expect(harness.stdout().trim().split('\n')).toHaveLength(MAX_PROXY_IN_FLIGHT_REQUESTS + 1);

    harness.input.destroy();
    await harness.completed;
  });

  it('terminates an unterminated client line above the byte ceiling', async () => {
    const harness = proxyHarness({ socket: null });
    await turn();

    harness.input.write('x'.repeat(MAX_PROXY_REQUEST_LINE_BYTES + 1));
    await harness.completed;

    expect(harness.exitCode()).toBe(1);
    expect(harness.stderr()).toContain('input overflow');
  });

  it('fails and cleans up on an asynchronous client-output error', async () => {
    const { socket } = controlledSocket();
    const harness = proxyHarness({ socket });
    harness.input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
    await turn();

    expect(() => harness.output.emit('error', new Error('simulated EPIPE'))).not.toThrow();
    await harness.completed;

    expect(harness.exitCode()).toBe(1);
    expect(harness.stderr()).toContain('output error');
    expect(socket.destroyed).toBe(true);
  });

  it('fails and cleans up when the client output closes', async () => {
    const { socket } = controlledSocket();
    const harness = proxyHarness({ socket });
    harness.input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
    await turn();

    harness.output.emit('close');
    await harness.completed;

    expect(harness.exitCode()).toBe(1);
    expect(socket.destroyed).toBe(true);
  });

  it('exits nonzero when client-output backpressure misses its drain deadline', async () => {
    const harness = proxyHarness({ socket: null });
    await turn();
    vi.spyOn(harness.output, 'write').mockReturnValue(false);
    vi.useFakeTimers();

    try {
      harness.input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
      await vi.advanceTimersByTimeAsync(5_000);
      await harness.completed;

      expect(harness.exitCode()).toBe(1);
      expect(harness.stderr()).toContain('output timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('contains asynchronous diagnostic stream errors', async () => {
    const harness = proxyHarness({ socket: null });
    await turn();

    expect(() => harness.diagnostics.emit('error', new Error('diagnostic sink failed'))).not.toThrow();
    harness.input.destroy();
    await harness.completed;

    expect(harness.exitCode()).toBe(0);
  });
});
