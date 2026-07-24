import { PassThrough, Writable } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import CodeGraph from '../src/index';
import { LspJsonRpcClient, LspJsonRpcError } from '../src/lsp/client';
import { stopDaemonAt } from '../src/mcp/daemon-registry';
import {
  ContentLengthParser,
  LspFramingError,
  LspProjectNotIndexedError,
  lspStartupFailureMessage,
  serveLspStdio,
} from '../src/lsp/stdio-server';
import { LspDaemonUnavailableError, type LspRepositoryReader } from '../src/lsp/facade';
import { DaemonUnavailableError } from '../src/server/daemon-client';

describe('LSP Content-Length transport', () => {
  it('parses fragmented and coalesced frames without losing byte boundaries', () => {
    const parser = new ContentLengthParser();
    const first = frame({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    const second = frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' });

    expect(parser.push(first.subarray(0, 7))).toEqual([]);
    const messages = parser.push(Buffer.concat([first.subarray(7), second]));
    expect(messages.map((body) => JSON.parse(body.toString('utf8')).id)).toEqual([1, 2]);
    expect(() => parser.finish()).not.toThrow();
  });

  it('parses a highly fragmented maximum-size frame without retained-buffer concatenation', () => {
    const parser = new ContentLengthParser();
    const body = Buffer.alloc(1024 * 1024, 0x61);
    const framed = rawBufferFrame(body);
    const concat = vi.spyOn(Buffer, 'concat');
    const messages: Buffer[] = [];
    try {
      for (let offset = 0; offset < framed.length; offset += 17) {
        messages.push(...parser.push(framed.subarray(offset, offset + 17)));
      }
      expect(concat).not.toHaveBeenCalled();
    } finally {
      concat.mockRestore();
    }

    expect(messages).toHaveLength(1);
    expect(messages[0]?.equals(body)).toBe(true);
    expect(() => parser.finish()).not.toThrow();
  });

  it('fails closed on duplicate, oversized, or incomplete framing', () => {
    const duplicate = new ContentLengthParser();
    expect(() => duplicate.push(Buffer.from('Content-Length: 2\r\ncontent-length: 2\r\n\r\n{}')))
      .toThrow(LspFramingError);

    const oversized = new ContentLengthParser();
    expect(() => oversized.push(Buffer.from('Content-Length: 1048577\r\n\r\n')))
      .toThrow(LspFramingError);

    const incomplete = new ContentLengthParser();
    incomplete.push(Buffer.from('Content-Length: 4\r\n\r\n{}'));
    expect(() => incomplete.finish()).toThrow(LspFramingError);

    const nonAscii = new ContentLengthParser();
    const header = Buffer.from('Content-Lengt_: 2\r\n\r\n{}', 'ascii');
    header[header.indexOf(0x5f)] = 0xe8;
    expect(() => nonAscii.push(header)).toThrow(LspFramingError);

    const whitespaceBeforeColon = new ContentLengthParser();
    expect(() => whitespaceBeforeColon.push(Buffer.from('X-Test : value\r\nContent-Length: 2\r\n\r\n{}')))
      .toThrow(LspFramingError);

    const controlValue = new ContentLengthParser();
    expect(() => controlValue.push(Buffer.concat([
      Buffer.from('X-Test: value', 'ascii'),
      Buffer.from([0x01]),
      Buffer.from('\r\nContent-Length: 2\r\n\r\n{}', 'ascii'),
    ]))).toThrow(LspFramingError);
  });

  it.each([
    ['whitespace before the colon', Buffer.from('X-Test : value\r\nContent-Length: 2\r\n\r\n{}', 'ascii')],
    ['a control byte in a companion value', Buffer.concat([
      Buffer.from('X-Test: value', 'ascii'),
      Buffer.from([0x01]),
      Buffer.from('\r\nContent-Length: 2\r\n\r\n{}', 'ascii'),
    ])],
  ])('terminates on %s', async (_case, framed) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const diagnosticChunks: Buffer[] = [];
    diagnostics.on('data', (chunk) => diagnosticChunks.push(Buffer.from(chunk)));
    const close = vi.fn();
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      diagnostics,
      close,
      installSignalHandlers: false,
    });

    input.end(framed);

    await expect(result).resolves.toBe(1);
    expect(close).toHaveBeenCalledOnce();
    expect(Buffer.concat(diagnosticChunks).toString('utf8')).toBe('[codegraph:lsp] invalid_frame\n');
  });

  it('discards bytes after an admitted exit without changing a clean status', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const diagnosticChunks: Buffer[] = [];
    diagnostics.on('data', (chunk) => diagnosticChunks.push(Buffer.from(chunk)));
    const close = vi.fn();
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      diagnostics,
      close,
      installSignalHandlers: false,
    });

    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
      Buffer.from('Content-Length: 4\r\n\r\n{}', 'ascii'),
    ]));

    await expect(result).resolves.toBe(0);
    expect(close).toHaveBeenCalledOnce();
    expect(Buffer.concat(diagnosticChunks).toString('utf8')).toBe('');
  });

  it('contains an asynchronous diagnostics write failure during invalid framing', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(() => callback(Object.assign(new Error('broken pipe'), { code: 'EPIPE' })));
      },
    });
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      diagnostics,
      installSignalHandlers: false,
    });

    input.end(Buffer.from('Content-Length: invalid\r\n\r\n', 'ascii'));

    await expect(result).resolves.toBe(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(diagnostics.listenerCount('error')).toBe(0);
  });

  it('retains diagnostics containment while delayed output fails during exit', async () => {
    const input = new PassThrough();
    const completions: Array<() => void> = [];
    const output = new Writable({
      write(_chunk, _encoding, callback) { completions.push(callback); },
    });
    const diagnostics = new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(() => callback(Object.assign(new Error('diagnostic EPIPE'), { code: 'EPIPE' })));
      },
    });
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      diagnostics,
      installSignalHandlers: false,
    });

    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));

    await vi.waitFor(() => expect(completions.length).toBeGreaterThan(0));
    expect(() => output.emit('error', Object.assign(new Error('stdout EPIPE'), { code: 'EPIPE' }))).not.toThrow();
    await expect(result).resolves.toBe(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(diagnostics.listenerCount('error')).toBe(1);

    while (completions.length > 0) completions.shift()!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(output.listenerCount('error')).toBe(0);
    expect(diagnostics.listenerCount('error')).toBe(0);
  });

  it('returns nonzero when a delayed output callback fails during clean exit', async () => {
    const input = new PassThrough();
    const diagnostics = new PassThrough();
    let writes = 0;
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        writes += 1;
        setImmediate(() => callback(
          writes === 2
            ? Object.assign(new Error('shutdown response EPIPE'), { code: 'EPIPE' })
            : undefined,
        ));
      },
    });
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      diagnostics,
      installSignalHandlers: false,
    });

    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));

    await expect(result).resolves.toBe(1);
    expect(writes).toBe(2);
  });

  it('suppresses a repository response that resolves after input-failure teardown', async () => {
    const input = new PassThrough();
    const diagnostics = new PassThrough();
    let resolveSymbols!: (value: []) => void;
    const reader = fakeReader();
    const workspaceSymbols = vi.fn(() => new Promise<[]>((resolve) => { resolveSymbols = resolve; }));
    reader.workspaceSymbols = workspaceSymbols;
    let writes = 0;
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        writes += 1;
        if (writes === 1) callback();
        else setImmediate(() => callback(Object.assign(new Error('late EPIPE'), { code: 'EPIPE' })));
      },
    });
    const result = serveLspStdio(reader, {
      input,
      output,
      diagnostics,
      installSignalHandlers: false,
    });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(writes).toBe(1));
    input.write(frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'held' } }));
    await vi.waitFor(() => expect(workspaceSymbols).toHaveBeenCalledOnce());

    input.emit('error', new Error('input failed'));
    await expect(result).resolves.toBe(1);
    resolveSymbols([]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(writes).toBe(1);
  });

  it('processes cancellation outside the serialized request chain and advances later work', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    const reader = fakeReader();
    let heldSignal: AbortSignal | undefined;
    reader.workspaceSymbols = vi.fn((query, signal) => {
      if (query !== 'held') return Promise.resolve([]);
      heldSignal = signal;
      return new Promise<[]>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    });
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks)).some((message) => message.id === 1)).toBe(true));
    input.write(frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'held' } }));
    await vi.waitFor(() => expect(reader.workspaceSymbols).toHaveBeenCalledOnce());
    input.write(Buffer.concat([
      frame({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 2 } }),
      frame({ jsonrpc: '2.0', id: 3, method: 'workspace/symbol', params: { query: 'next' } }),
    ]));

    await vi.waitFor(() => {
      const responses = decodeFrames(Buffer.concat(outputChunks));
      expect(responses.find((message) => message.id === 2)?.error.code).toBe(-32800);
      expect(responses.find((message) => message.id === 3)?.result).toEqual([]);
    });
    expect(heldSignal?.aborted).toBe(true);
    expect(reader.workspaceSymbols).toHaveBeenCalledTimes(2);

    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));
    await expect(result).resolves.toBe(0);
  });

  it('evaluates invalid lifecycle-shaped requests in their admitted wire state', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    const reader = fakeReader();
    let resolveHeld!: (value: []) => void;
    reader.workspaceSymbols = vi.fn((query) => query === 'held'
      ? new Promise<[]>((resolve) => { resolveHeld = resolve; })
      : Promise.resolve([]));
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => {
      expect(decodeFrames(Buffer.concat(outputChunks)).find((message) => message.id === 1)?.result).toBeDefined();
    });
    input.write(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'held' } }),
      frame({ jsonrpc: '2.0', id: 3, method: 'initialized', params: {} }),
      frame({ jsonrpc: '2.0', id: 4, method: 'exit' }),
      frame({ jsonrpc: '2.0', id: 5, method: 'shutdown' }),
    ]));

    await vi.waitFor(() => {
      expect(decodeFrames(Buffer.concat(outputChunks)).find((message) => message.id === 5)?.result).toBeNull();
    });
    resolveHeld([]);
    await vi.waitFor(() => {
      const responses = decodeFrames(Buffer.concat(outputChunks));
      expect(responses.find((message) => message.id === 3)?.error.code).toBe(-32601);
      expect(responses.find((message) => message.id === 4)?.error.code).toBe(-32601);
    });

    input.end(frame({ jsonrpc: '2.0', method: 'exit' }));
    await expect(result).resolves.toBe(0);
  });

  it('cancels a queued initialize and recomputes dependent admission state', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    const reader = fakeReader();
    reader.workspaceSymbols = vi.fn(reader.workspaceSymbols);
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.write(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'after-initialize' } }),
      frame({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } }),
    ]));

    await vi.waitFor(() => {
      const responses = decodeFrames(Buffer.concat(outputChunks));
      expect(responses.find((message) => message.id === 1)?.error.code).toBe(-32800);
      expect(responses.find((message) => message.id === 2)?.error.code).toBe(-32002);
    });
    expect(reader.workspaceSymbols).not.toHaveBeenCalled();

    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));
    await expect(result).resolves.toBe(0);
  });

  it('keeps canceled lifecycle frames admitted until their callbacks finalize', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    const result = serveLspStdio(fakeReader(), { input, output, installSignalHandlers: false });

    input.end(Buffer.concat(Array.from({ length: 17 }, (_value, index) => Buffer.concat([
      frame({ jsonrpc: '2.0', id: index + 1, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: index + 1 } }),
    ]))));

    await expect(result).resolves.toBe(1);
    const responses = decodeFrames(Buffer.concat(outputChunks));
    expect(responses.filter((message) => message.error?.code === -32800)).toHaveLength(16);
    expect(responses.find((message) => message.id === 17)?.error).toMatchObject({
      code: -32803,
      data: { reason: 'overloaded' },
    });
  });

  it('cancels a queued shutdown and reopens dependent request admission', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    const reader = fakeReader();
    reader.workspaceSymbols = vi.fn(reader.workspaceSymbols);
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => {
      expect(decodeFrames(Buffer.concat(outputChunks)).find((message) => message.id === 1)?.result).toBeDefined();
    });
    input.write(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', id: 3, method: 'workspace/symbol', params: { query: 'after-shutdown' } }),
      frame({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 2 } }),
    ]));

    await vi.waitFor(() => {
      const responses = decodeFrames(Buffer.concat(outputChunks));
      expect(responses.find((message) => message.id === 2)?.error.code).toBe(-32800);
      expect(responses.find((message) => message.id === 3)?.result).toEqual([]);
    });
    input.write(frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }));
    await vi.waitFor(() => {
      const responses = decodeFrames(Buffer.concat(outputChunks));
      expect(responses.find((message) => message.id === 4)?.result).toBeNull();
    });
    expect(reader.workspaceSymbols).toHaveBeenCalledOnce();

    input.end(frame({ jsonrpc: '2.0', method: 'exit' }));
    await expect(result).resolves.toBe(0);
  });

  it('processes cancellation after the serialized request queue is saturated', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    const reader = fakeReader();
    let heldSignal: AbortSignal | undefined;
    let cancellationObserved!: () => void;
    const cancelled = new Promise<void>((resolve) => { cancellationObserved = resolve; });
    reader.workspaceSymbols = vi.fn((query, signal) => {
      if (query !== 'held') return Promise.resolve([]);
      heldSignal = signal;
      return new Promise<[]>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          cancellationObserved();
          reject(new Error('cancelled'));
        }, { once: true });
      });
    });
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks)).some((message) => message.id === 1)).toBe(true));
    input.write(frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'held' } }));
    await vi.waitFor(() => expect(reader.workspaceSymbols).toHaveBeenCalledOnce());
    input.write(Buffer.concat([
      ...Array.from({ length: 15 }, (_value, index) => frame({
        jsonrpc: '2.0', id: index + 3, method: 'workspace/symbol', params: { query: `queued-${index}` },
      })),
      frame({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 2 } }),
    ]));

    const cancelledBeforeQueuedWork = await Promise.race([
      cancelled.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);
    if (!cancelledBeforeQueuedWork) {
      input.emit('error', new Error('cancellation remained queued'));
      await result;
    }
    expect(cancelledBeforeQueuedWork).toBe(true);
    expect(heldSignal?.aborted).toBe(true);

    await vi.waitFor(() => {
      const responses = decodeFrames(Buffer.concat(outputChunks));
      expect(responses.find((message) => message.id === 2)?.error.code).toBe(-32800);
      expect(responses.find((message) => message.id === 17)?.result).toEqual([]);
    });
    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 18, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));
    await expect(result).resolves.toBe(0);
  });

  it('preserves saturated shutdown and exit ordering without waiting for stdin EOF', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    let heldSignal: AbortSignal | undefined;
    const reader = fakeReader();
    reader.workspaceSymbols = vi.fn((query, signal) => query === 'held'
      ? new Promise<[]>(() => { heldSignal = signal; })
      : Promise.resolve([]));
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks)).some((message) => message.id === 1)).toBe(true));
    input.write(frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'held' } }));
    await vi.waitFor(() => expect(reader.workspaceSymbols).toHaveBeenCalledOnce());
    input.write(Buffer.concat([
      ...Array.from({ length: 15 }, (_value, index) => frame({
        jsonrpc: '2.0', id: index + 3, method: 'workspace/symbol', params: { query: `queued-${index}` },
      })),
      frame({ jsonrpc: '2.0', id: 18, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));

    const deadline = setTimeout(() => input.emit('error', new Error('lifecycle control remained queued')), 500);
    const exitCode = await result;
    clearTimeout(deadline);
    expect(exitCode).toBe(0);
    const responses = decodeFrames(Buffer.concat(outputChunks));
    expect(responses.at(-1)).toMatchObject({ id: 18, result: null });
    expect(responses.find((message) => message.id === 18)?.error).toBeUndefined();
    expect(heldSignal?.aborted).toBe(true);
    expect(reader.workspaceSymbols).toHaveBeenCalledOnce();
  });

  it('keeps admission open after shutdown is rejected before initialize', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    const result = serveLspStdio(fakeReader(), { input, output, installSignalHandlers: false });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'shutdown' }));
    await vi.waitFor(() => {
      expect(decodeFrames(Buffer.concat(outputChunks)).find((message) => message.id === 1)?.error.code).toBe(-32002);
    });
    input.write(frame({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }));
    await vi.waitFor(() => {
      expect(decodeFrames(Buffer.concat(outputChunks)).find((message) => message.id === 2)?.result).toBeDefined();
    });
    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));

    await expect(result).resolves.toBe(0);
  });

  it.runIf(process.platform !== 'win32')(
    'recomputes successor projections after initialize canonicalization changes',
    async () => {
      const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-projection-'));
      const boundRoot = path.join(fixture, 'bound');
      const otherRoot = path.join(fixture, 'other');
      const rootLink = path.join(fixture, 'root-link');
      fs.mkdirSync(boundRoot);
      fs.mkdirSync(otherRoot);
      fs.symlinkSync(boundRoot, rootLink, 'dir');

      const input = new PassThrough();
      const output = new PassThrough();
      const outputChunks: Buffer[] = [];
      output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
      const reader = { ...fakeReader(), root: boundRoot };
      reader.workspaceSymbols = vi.fn(reader.workspaceSymbols);
      const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

      try {
        input.write(Buffer.concat([
          frame({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { rootUri: pathToFileURL(rootLink).href },
          }),
          frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
        ]));
        fs.unlinkSync(rootLink);
        fs.symlinkSync(otherRoot, rootLink, 'dir');

        await vi.waitFor(() => {
          const responses = decodeFrames(Buffer.concat(outputChunks));
          expect(responses.find((message) => message.id === 1)?.error.code).toBe(-32602);
          expect(responses.find((message) => message.id === 2)?.error.code).toBe(-32002);
        });

        input.write(Buffer.concat([
          frame({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} }),
          frame({ jsonrpc: '2.0', id: 4, method: 'workspace/symbol', params: { query: 'after-retry' } }),
        ]));
        await vi.waitFor(() => {
          const responses = decodeFrames(Buffer.concat(outputChunks));
          expect(responses.find((message) => message.id === 3)?.result).toBeDefined();
          expect(responses.find((message) => message.id === 4)?.result).toEqual([]);
        });
        expect(reader.workspaceSymbols).toHaveBeenCalledOnce();

        input.end(Buffer.concat([
          frame({ jsonrpc: '2.0', id: 5, method: 'shutdown' }),
          frame({ jsonrpc: '2.0', method: 'exit' }),
        ]));
        await expect(result).resolves.toBe(0);
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
      }
    },
  );

  it('rejects every coalesced shutdown before initialize as not initialized', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    const result = serveLspStdio(fakeReader(), { input, output, installSignalHandlers: false });

    input.write(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
    ]));
    await vi.waitFor(() => {
      const responses = decodeFrames(Buffer.concat(outputChunks));
      expect(responses.filter((message) => message.id === 1 || message.id === 2)).toHaveLength(2);
    });
    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));

    await expect(result).resolves.toBe(0);
    const responses = decodeFrames(Buffer.concat(outputChunks));
    expect(responses.find((message) => message.id === 1)?.error).toMatchObject({ code: -32002 });
    expect(responses.find((message) => message.id === 2)?.error).toMatchObject({ code: -32002 });
  });

  it('does not cancel an admitted read when shutdown transitions the session', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    let heldSignal: AbortSignal | undefined;
    let resolveHeld!: (value: []) => void;
    const reader = fakeReader();
    reader.workspaceSymbols = vi.fn((query, signal) => query === 'held'
      ? new Promise<[]>((resolve) => {
        heldSignal = signal;
        resolveHeld = resolve;
      })
      : Promise.resolve([]));
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks)).some((message) => message.id === 1)).toBe(true));
    input.write(frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'held' } }));
    await vi.waitFor(() => expect(reader.workspaceSymbols).toHaveBeenCalledOnce());
    input.write(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 3, method: 'workspace/symbol', params: { query: 'queued-before-shutdown' } }),
      frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
    ]));
    await vi.waitFor(() => {
      expect(decodeFrames(Buffer.concat(outputChunks)).find((message) => message.id === 4)?.result).toBeNull();
    });
    expect(heldSignal?.aborted).toBe(false);
    input.write(frame({ jsonrpc: '2.0', id: 5, method: 'workspace/symbol', params: { query: 'too-late' } }));
    await vi.waitFor(() => {
      expect(decodeFrames(Buffer.concat(outputChunks)).find((message) => message.id === 5)?.error.code).toBe(-32600);
    });
    expect(reader.workspaceSymbols).toHaveBeenCalledOnce();
    resolveHeld([]);
    await vi.waitFor(() => {
      const responses = decodeFrames(Buffer.concat(outputChunks));
      expect(responses.find((message) => message.id === 2)?.result).toEqual([]);
      expect(responses.find((message) => message.id === 3)?.result).toEqual([]);
    });
    expect(reader.workspaceSymbols).toHaveBeenCalledTimes(2);
    input.end(frame({ jsonrpc: '2.0', method: 'exit' }));

    await expect(result).resolves.toBe(0);
  });

  it('rejects a request coalesced after shutdown before it reaches repository work', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    const reader = fakeReader();
    reader.workspaceSymbols = vi.fn(reader.workspaceSymbols);
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.write(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', id: 3, method: 'workspace/symbol', params: { query: 'too-late' } }),
    ]));
    await vi.waitFor(() => {
      const responses = decodeFrames(Buffer.concat(outputChunks));
      expect(responses.find((message) => message.id === 1)?.result).toBeDefined();
      expect(responses.find((message) => message.id === 2)?.result).toBeNull();
      expect(responses.find((message) => message.id === 3)?.error.code).toBe(-32600);
    });
    expect(reader.workspaceSymbols).not.toHaveBeenCalled();
    input.end(frame({ jsonrpc: '2.0', method: 'exit' }));

    await expect(result).resolves.toBe(0);
  });

  it('keeps a post-shutdown request invalid when exit is coalesced behind it', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    const reader = fakeReader();
    reader.workspaceSymbols = vi.fn(reader.workspaceSymbols);
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', id: 3, method: 'workspace/symbol', params: { query: 'too-late' } }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));

    await expect(result).resolves.toBe(0);
    expect(decodeFrames(Buffer.concat(outputChunks)).find((message) => message.id === 3)?.error.code)
      .toBe(-32600);
    expect(reader.workspaceSymbols).not.toHaveBeenCalled();
  });

  it('admits a saturated exit without shutdown and exits nonzero before stdin EOF', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let heldSignal: AbortSignal | undefined;
    const reader = fakeReader();
    reader.workspaceSymbols = vi.fn((query, signal) => query === 'held'
      ? new Promise<[]>(() => { heldSignal = signal; })
      : Promise.resolve([]));
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(reader.workspaceSymbols).not.toHaveBeenCalled());
    input.write(frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'held' } }));
    await vi.waitFor(() => expect(reader.workspaceSymbols).toHaveBeenCalledOnce());
    input.write(Buffer.concat([
      ...Array.from({ length: 15 }, (_value, index) => frame({
        jsonrpc: '2.0', id: index + 3, method: 'workspace/symbol', params: { query: `queued-${index}` },
      })),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));

    const deadline = setTimeout(() => input.emit('error', new Error('exit control remained queued')), 500);
    const exitCode = await result;
    clearTimeout(deadline);
    expect(exitCode).toBe(1);
    expect(heldSignal?.aborted).toBe(true);
    expect(reader.workspaceSymbols).toHaveBeenCalledOnce();
  });

  it('bounds duplicate lifecycle reservations while the work queue is saturated', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    let releaseHeld!: () => void;
    const reader = fakeReader();
    reader.workspaceSymbols = vi.fn((query) => query === 'held'
      ? new Promise<[]>((resolve) => { releaseHeld = () => resolve([]); })
      : Promise.resolve([]));
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks)).some((message) => message.id === 1)).toBe(true));
    input.write(frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'held' } }));
    await vi.waitFor(() => expect(reader.workspaceSymbols).toHaveBeenCalledOnce());
    input.write(Buffer.concat([
      ...Array.from({ length: 15 }, (_value, index) => frame({
        jsonrpc: '2.0', id: index + 3, method: 'workspace/symbol', params: { query: `queued-${index}` },
      })),
      frame({ jsonrpc: '2.0', id: 18, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', id: 19, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));

    releaseHeld();
    await expect(result).resolves.toBe(0);
    const responses = decodeFrames(Buffer.concat(outputChunks));
    expect(responses.filter((message) => message.id === 18)).toEqual([
      expect.objectContaining({ id: 18, result: null }),
    ]);
    expect(responses.filter((message) => message.id === 19)).toEqual([
      expect.objectContaining({
        id: 19,
        error: expect.objectContaining({ code: -32600 }),
      }),
    ]);
  });

  it('diagnoses a mid-session daemon outage without exposing the underlying error', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const diagnosticChunks: Buffer[] = [];
    output.resume();
    diagnostics.on('data', (chunk) => diagnosticChunks.push(Buffer.from(chunk)));
    const reader = fakeReader();
    reader.workspaceSymbols = async () => { throw new LspDaemonUnavailableError(); };
    const result = serveLspStdio(reader, {
      input,
      output,
      diagnostics,
      installSignalHandlers: false,
    });

    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'fail' } }),
    ]));

    await expect(result).resolves.toBe(1);
    expect(Buffer.concat(diagnosticChunks).toString('utf8')).toBe('[codegraph:lsp] daemon_unavailable\n');
  });

  it('keeps a redacted error sink while buffered output fails during exit', async () => {
    const input = new PassThrough();
    const diagnostics = new PassThrough();
    const diagnosticChunks: Buffer[] = [];
    const completions: Array<() => void> = [];
    diagnostics.on('data', (chunk) => diagnosticChunks.push(Buffer.from(chunk)));
    const output = new Writable({
      write(_chunk, _encoding, callback) { completions.push(callback); },
    });
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      diagnostics,
      installSignalHandlers: false,
    });

    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));

    await vi.waitFor(() => expect(completions.length).toBeGreaterThan(0));
    expect(() => output.emit('error', Object.assign(new Error('late broken pipe'), { code: 'EPIPE' }))).not.toThrow();
    await expect(result).resolves.toBe(1);
    expect(Buffer.concat(diagnosticChunks).toString('utf8')).toBe('[codegraph:lsp] stream_failure\n');
    while (completions.length > 0) completions.shift()!();
    output.destroy();
  });

  it('drains the bounded frame queue after slow work settles', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    let release!: () => void;
    const reader = fakeReader();
    const workspaceSymbols = vi.fn()
      .mockImplementationOnce(() => new Promise<[]>((resolve) => { release = () => resolve([]); }))
      .mockResolvedValue([]);
    reader.workspaceSymbols = workspaceSymbols;
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks)).some((message) => message.id === 1)).toBe(true));
    input.write(Buffer.concat(Array.from({ length: 16 }, (_value, index) => frame({
      jsonrpc: '2.0',
      id: index + 2,
      method: 'workspace/symbol',
      params: { query: 'slow' },
    }))));
    input.end();

    await vi.waitFor(() => {
      expect(workspaceSymbols).toHaveBeenCalledOnce();
    });
    release();
    await expect(result).resolves.toBe(1);
    expect(workspaceSymbols).toHaveBeenCalledTimes(16);
  });

  it('rejects coalesced request work beyond the bounded queue', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const outputChunks: Buffer[] = [];
    const diagnosticChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    diagnostics.on('data', (chunk) => diagnosticChunks.push(Buffer.from(chunk)));
    const reader = fakeReader();
    const workspaceSymbols = vi.fn(async () => []);
    reader.workspaceSymbols = workspaceSymbols;
    const result = serveLspStdio(reader, { input, output, diagnostics, installSignalHandlers: false });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks))).toHaveLength(1));
    input.end(Buffer.concat(Array.from({ length: 17 }, (_value, index) => frame({
      jsonrpc: '2.0',
      id: index + 2,
      method: 'workspace/symbol',
      params: { query: 'burst' },
    }))));

    await expect(result).resolves.toBe(1);
    expect(workspaceSymbols).toHaveBeenCalledTimes(16);
    const responses = decodeFrames(Buffer.concat(outputChunks));
    expect(new Set(responses.map((message) => message.id)))
      .toEqual(new Set(Array.from({ length: 18 }, (_value, index) => index + 1)));
    expect(responses.find((message) => message.id === 18)?.error).toMatchObject({
      code: -32803,
      data: { reason: 'overloaded' },
    });
    expect(Buffer.concat(diagnosticChunks)).toHaveLength(0);
  });

  it('stops request work while stdout is backpressured and fails closed on a bounded drain timeout', async () => {
    const input = new PassThrough();
    const diagnostics = new PassThrough();
    const diagnosticChunks: Buffer[] = [];
    diagnostics.on('data', (chunk) => diagnosticChunks.push(Buffer.from(chunk)));
    const output = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, _callback) { /* deliberately never drains */ },
    });
    const reader = fakeReader();
    const workspaceSymbols = vi.fn().mockResolvedValue([]);
    reader.workspaceSymbols = workspaceSymbols;
    const pause = vi.spyOn(input, 'pause');
    const result = serveLspStdio(reader, {
      input,
      output,
      diagnostics,
      installSignalHandlers: false,
      outputDrainTimeoutMs: 50,
    });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(pause).toHaveBeenCalled());
    input.write(frame({
      jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'blocked' },
    }));

    await expect(result).resolves.toBe(1);
    expect(workspaceSymbols).not.toHaveBeenCalled();
    expect(Buffer.concat(diagnosticChunks).toString('utf8')).toContain('[codegraph:lsp] stream_failure\n');
  });

  it('defers overload responses while still processing a later cancellation in the same chunk', async () => {
    const input = new PassThrough();
    const outputChunks: Buffer[] = [];
    const writeCallbacks: Array<() => void> = [];
    let holdOutput = false;
    const output = new Writable({
      highWaterMark: 1024,
      write(chunk, _encoding, callback) {
        outputChunks.push(Buffer.from(chunk));
        if (holdOutput) writeCallbacks.push(callback);
        else callback();
      },
    });
    let heldSignal: AbortSignal | undefined;
    let cancellationObserved!: () => void;
    const cancelled = new Promise<void>((resolve) => { cancellationObserved = resolve; });
    const reader = fakeReader();
    reader.workspaceSymbols = vi.fn((query, signal) => {
      if (query !== 'held') return Promise.resolve([]);
      heldSignal = signal;
      return new Promise<[]>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          cancellationObserved();
          reject(new Error('cancelled'));
        }, { once: true });
      });
    });
    const result = serveLspStdio(reader, { input, output, installSignalHandlers: false });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks)).some((message) => message.id === 1)).toBe(true));
    input.write(frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'held' } }));
    await vi.waitFor(() => expect(reader.workspaceSymbols).toHaveBeenCalledOnce());
    holdOutput = true;
    const firstOverflowId = `overflow-a-${'a'.repeat(2048)}`;
    const secondOverflowId = `overflow-b-${'b'.repeat(2048)}`;
    input.write(Buffer.concat([
      ...Array.from({ length: 15 }, (_value, index) => frame({
        jsonrpc: '2.0', id: index + 3, method: 'workspace/symbol', params: { query: `queued-${index}` },
      })),
      frame({ jsonrpc: '2.0', id: firstOverflowId, method: 'workspace/symbol', params: { query: 'overflow-a' } }),
      frame({ jsonrpc: '2.0', id: secondOverflowId, method: 'workspace/symbol', params: { query: 'overflow-b' } }),
      rawFrame('{'),
      frame({ jsonrpc: '2.0', id: 'invalid-envelope', method: 42 }),
      frame({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 2 } }),
    ]));

    await expect(cancelled).resolves.toBeUndefined();
    expect(heldSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(writeCallbacks).toHaveLength(1));
    writeCallbacks.shift()!();
    await vi.waitFor(() => expect(writeCallbacks).toHaveLength(1));
    holdOutput = false;
    writeCallbacks.shift()!();
    await vi.waitFor(() => {
      const responses = decodeFrames(Buffer.concat(outputChunks));
      expect(responses.filter((message) => message.id === firstOverflowId)).toHaveLength(1);
      expect(responses.filter((message) => message.id === secondOverflowId)).toHaveLength(1);
      expect(responses.find((message) => message.id === null)?.error.code).toBe(-32700);
      expect(responses.find((message) => message.id === 'invalid-envelope')?.error.code).toBe(-32600);
      expect(responses.find((message) => message.id === 2)?.error.code).toBe(-32800);
      expect(responses.find((message) => message.id === 17)?.result).toEqual([]);
    });

    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 18, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));
    await expect(result).resolves.toBe(0);
  });

  it('fails closed when deferred overload responses exceed their bounded queue', async () => {
    const input = new PassThrough();
    const diagnostics = new PassThrough();
    const diagnosticChunks: Buffer[] = [];
    diagnostics.on('data', (chunk) => diagnosticChunks.push(Buffer.from(chunk)));
    let holdOutput = false;
    const output = new Writable({
      highWaterMark: 1024,
      write(_chunk, _encoding, callback) {
        if (!holdOutput) callback();
      },
    });
    let heldSignal: AbortSignal | undefined;
    const reader = fakeReader();
    reader.workspaceSymbols = vi.fn((query, signal) => {
      if (query !== 'held') return Promise.resolve([]);
      heldSignal = signal;
      return new Promise<[]>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    });
    const result = serveLspStdio(reader, {
      input,
      output,
      diagnostics,
      installSignalHandlers: false,
    });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(reader.workspaceSymbols).not.toHaveBeenCalled());
    input.write(frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'held' } }));
    await vi.waitFor(() => expect(reader.workspaceSymbols).toHaveBeenCalledOnce());
    holdOutput = true;
    input.write(Buffer.concat([
      ...Array.from({ length: 15 }, (_value, index) => frame({
        jsonrpc: '2.0', id: index + 3, method: 'workspace/symbol', params: { query: `queued-${index}` },
      })),
      ...Array.from({ length: 34 }, (_value, index) => frame({
        jsonrpc: '2.0',
        id: `overflow-${index}-${'x'.repeat(2048)}`,
        method: 'workspace/symbol',
        params: { query: 'overflow' },
      })),
    ]));

    await expect(result).resolves.toBe(1);
    expect(heldSignal?.aborted).toBe(true);
    expect(output.destroyed).toBe(true);
    expect(Buffer.concat(diagnosticChunks).toString('utf8')).toContain('[codegraph:lsp] stream_failure\n');
  });

  it('keeps a bounded output-destruction deadline when teardown interrupts backpressure', async () => {
    const input = new PassThrough();
    const diagnostics = new PassThrough();
    const output = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, _callback) { /* deliberately never settles */ },
    });
    const pause = vi.spyOn(input, 'pause');
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      diagnostics,
      installSignalHandlers: false,
      outputDrainTimeoutMs: 50,
    });
    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(pause).toHaveBeenCalled());

    input.emit('error', new Error('forced teardown'));

    await expect(result).resolves.toBe(1);
    await vi.waitFor(() => expect(output.destroyed).toBe(true), { timeout: 500 });
  });

  it('reports failure when clean LSP exit cannot flush its final response', async () => {
    const input = new PassThrough();
    const diagnostics = new PassThrough();
    let writes = 0;
    const output = new Writable({
      highWaterMark: 1024 * 1024,
      write(_chunk, _encoding, callback) {
        writes += 1;
        if (writes === 1) callback();
        // Hold the shutdown response callback forever. The write remains below
        // highWaterMark, so exit is processed and requests a nominal code 0.
      },
    });
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      diagnostics,
      installSignalHandlers: false,
      outputDrainTimeoutMs: 50,
    });

    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));

    await vi.waitFor(() => expect(writes).toBe(2));
    await expect(result).resolves.toBe(1);
    expect(output.destroyed).toBe(true);
  });

  it('writes a worst-case JSON-escaped one-megabyte source response', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const outputChunks: Buffer[] = [];
    const diagnosticChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    diagnostics.on('data', (chunk) => diagnosticChunks.push(Buffer.from(chunk)));
    const reader = fakeReader();
    const text = '\0'.repeat(1024 * 1024);
    reader.sourceSnapshot = async () => ({
      ok: true,
      snapshot: {
        filePath: 'escaped.ts',
        text,
        languageId: 'typescript',
        contentHash: 'escaped-hash',
        snapshotToken: 'escaped-snapshot',
      },
    });
    const result = serveLspStdio(reader, {
      input,
      output,
      diagnostics,
      installSignalHandlers: false,
    });
    const uri = pathToFileURL(path.join(process.cwd(), 'escaped.ts')).href;
    const request = {
      jsonrpc: '2.0',
      id: '',
      method: 'codegraph/textDocumentContent',
      params: { textDocument: { uri } },
    };
    const id = 'i'.repeat(1024 * 1024 - Buffer.byteLength(JSON.stringify(request)));
    request.id = id;
    expect(Buffer.byteLength(JSON.stringify(request))).toBe(1024 * 1024);
    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks)).some((message) => message.id === 1)).toBe(true));
    input.write(frame(request));
    await vi.waitFor(() => {
      expect(decodeOutputFrames(Buffer.concat(outputChunks)).some((message) => message.id === id)).toBe(true);
    });
    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));

    await expect(result).resolves.toBe(0);
    const outputBuffer = Buffer.concat(outputChunks);
    expect(outputBuffer.length).toBeGreaterThan(7 * 1024 * 1024);
    const response = decodeOutputFrames(outputBuffer).find((message) => message.id === id) as any;
    expect(response.result.text).toHaveLength(1024 * 1024);
    expect(response.result.text.charCodeAt(0)).toBe(0);
    expect(Buffer.concat(diagnosticChunks).toString('utf8')).toBe('');
  });

  it('keeps valid-frame JSON errors recoverable and stdout protocol-only', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const outputChunks: Buffer[] = [];
    const diagnosticChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    diagnostics.on('data', (chunk) => diagnosticChunks.push(Buffer.from(chunk)));
    const close = vi.fn();
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      diagnostics,
      close,
      installSignalHandlers: false,
    });

    input.write(rawFrame('{'));
    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    input.write(frame({ jsonrpc: '2.0', id: 2, method: 'workspace/executeCommand', params: {} }));
    await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks))).toHaveLength(3));
    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));

    await expect(result).resolves.toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
    const responses = decodeFrames(Buffer.concat(outputChunks));
    expect(responses.map((response) => response.id)).toEqual([null, 1, 2, 3]);
    expect(responses[0]?.error.code).toBe(-32700);
    expect(responses[1]?.result.capabilities.positionEncoding).toBe('utf-16');
    expect(responses[2]?.error.code).toBe(-32601);
    expect(responses[3]?.result).toBeNull();
    expect(Buffer.concat(outputChunks).toString('utf8')).not.toContain('[codegraph:lsp]');
    expect(Buffer.concat(diagnosticChunks).toString('utf8')).toBe('');
  });

  it('returns a recoverable parse error for a valid frame with invalid UTF-8', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    const close = vi.fn();
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      close,
      installSignalHandlers: false,
    });
    const invalidBody = Buffer.concat([
      Buffer.from('{"jsonrpc":"2.0","id":1,"method":"init', 'ascii'),
      Buffer.from([0xff]),
      Buffer.from('ialized"}', 'ascii'),
    ]);

    input.write(rawBufferFrame(invalidBody));
    input.end(frame({ jsonrpc: '2.0', method: 'exit' }));

    await expect(result).resolves.toBe(1);
    expect(close).toHaveBeenCalledOnce();
    expect(decodeFrames(Buffer.concat(outputChunks))).toEqual([{
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    }]);
  });

  it('releases the repository reader on ordinary EOF before shutdown', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const close = vi.fn();
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      close,
      installSignalHandlers: false,
    });
    input.end();
    await expect(result).resolves.toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('bounds EOF cleanup behind a stalled request and suppresses its late response', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    let resolveSymbols!: (symbols: []) => void;
    const reader = fakeReader();
    reader.workspaceSymbols = vi.fn(() => new Promise<[]>((resolve) => { resolveSymbols = resolve; }));
    const close = vi.fn();
    const result = serveLspStdio(reader, {
      input,
      output,
      diagnostics,
      close,
      installSignalHandlers: false,
      inputDrainTimeoutMs: 50,
    });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks)).some((message) => message.id === 1)).toBe(true));
    input.write(frame({
      jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'stalled' },
    }));
    await vi.waitFor(() => expect(reader.workspaceSymbols).toHaveBeenCalledOnce());

    input.end();
    await expect(result).resolves.toBe(1);
    expect(close).toHaveBeenCalledOnce();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(diagnostics.listenerCount('error')).toBe(0);

    resolveSymbols([]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(decodeFrames(Buffer.concat(outputChunks)).map((message) => message.id)).toEqual([1]);
  });

  it('releases the repository reader when the output stream fails', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const close = vi.fn();
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      diagnostics,
      close,
      installSignalHandlers: false,
    });

    output.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }));

    await expect(result).resolves.toBe(1);
    expect(close).toHaveBeenCalledOnce();
  });

  it('treats an input close without end as EOF and releases the repository reader', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const close = vi.fn();
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      close,
      installSignalHandlers: false,
    });

    input.destroy();

    await expect(result).resolves.toBe(1);
    expect(close).toHaveBeenCalledOnce();
  });

  it('treats an output close without error as a send failure and releases the repository reader', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const close = vi.fn();
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      diagnostics,
      close,
      installSignalHandlers: false,
    });

    output.destroy();

    await expect(result).resolves.toBe(1);
    expect(close).toHaveBeenCalledOnce();
  });

  it('classifies startup failures without exposing repository or process details', () => {
    expect(lspStartupFailureMessage(new LspProjectNotIndexedError())).toContain('select an indexed CodeGraph repository');
    const daemonMessage = lspStartupFailureMessage(new DaemonUnavailableError('failed at /private/secret/socket'));
    expect(daemonMessage).toContain('daemon is unavailable');
    expect(daemonMessage).not.toContain('/private/secret');
    const internalMessage = lspStartupFailureMessage(new Error('credential=private-secret'));
    expect(internalMessage).toContain('internal startup failure');
    expect(internalMessage).not.toContain('private-secret');
  });

  it('reports the indexed-repository prerequisite through the built public CLI command', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-unindexed-'));
    try {
      const result = spawnSync(
        process.execPath,
        [path.join(process.cwd(), 'dist/bin/codegraph.js'), 'lsp', root],
        { encoding: 'utf8', timeout: 15_000 },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('select an indexed CodeGraph repository');
      expect(result.stderr).not.toContain(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('exits the built command after shutdown and exit without waiting for stdin EOF', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-open-stdin-'));
    fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 1; }\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    cg.close();
    const child = spawn(
      process.execPath,
      [path.join(process.cwd(), 'dist/bin/codegraph.js'), 'lsp', root],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const stderrChunks: Buffer[] = [];
    child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.stdin.on('error', () => { /* process exit closes the intentionally open pipe */ });

    try {
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('LSP command did not exit with stdin still open')), 15_000);
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      });
      child.stdin.write(Buffer.concat([
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
      ]));

      await expect(exited).resolves.toEqual({ code: 0, signal: null });
      expect(Buffer.concat(stderrChunks).toString('utf8')).toBe('');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await stopDaemonAt(fs.realpathSync(root));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('serves the built command to a generic LSP client and exits cleanly', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-cli-'));
    fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 1; }\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    cg.close();
    const client = new LspJsonRpcClient({
      command: [process.execPath, path.join(process.cwd(), 'dist/bin/codegraph.js'), 'lsp', root],
      rootUri: null,
      rootPath: null,
      timeoutMs: 30_000,
    });
    try {
      const initialized = await client.initialize();
      expect(initialized).toMatchObject({ capabilities: { positionEncoding: 'utf-16' } });
      const sourceUri = pathToFileURL(path.join(fs.realpathSync(root), 'sample.ts')).href;
      const definition = await client.request('textDocument/definition', {
        textDocument: { uri: sourceUri },
        position: { line: 0, character: 18 },
      });
      expect(definition).toMatchObject({ uri: sourceUri });
      const symbols = await client.request('workspace/symbol', { query: 'alpha' });
      expect(symbols).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'alpha' })]));
      await expect(client.request('textDocument/rename', {})).rejects.toMatchObject<LspJsonRpcError>({ code: -32601 });
      await client.shutdown();
      await expect(client.waitForExit()).resolves.toMatchObject({ code: 0 });
      expect(client.getStderr()).toBe('');
    } catch (error) {
      const daemonLogPath = path.join(root, '.codegraph', 'daemon.log');
      const daemonLog = fs.existsSync(daemonLogPath) ? fs.readFileSync(daemonLogPath, 'utf8') : '';
      throw new Error(
        `built LSP client failed; stderr=${JSON.stringify(client.getStderr())}; daemon=${JSON.stringify(daemonLog)}`,
        { cause: error },
      );
    } finally {
      await client.dispose();
      await stopDaemonAt(fs.realpathSync(root));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

function fakeReader(): LspRepositoryReader {
  return {
    root: process.cwd(),
    sourceSnapshot: async () => ({ ok: false, reason: 'unindexed' }),
    positionContext: async () => ({ ok: false, reason: 'unindexed' }),
    documentContext: async () => ({ ok: false, reason: 'unindexed' }),
    incoming: async () => ({ ok: false, reason: 'stale' }),
    nodeLocation: async () => ({ ok: false, reason: 'unindexed' }),
    workspaceSymbols: async () => [],
  };
}

function frame(value: unknown): Buffer {
  return rawFrame(JSON.stringify(value));
}

function rawFrame(value: string): Buffer {
  const body = Buffer.from(value, 'utf8');
  return rawBufferFrame(body);
}

function rawBufferFrame(body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

function decodeFrames(buffer: Buffer): any[] {
  const parser = new ContentLengthParser();
  return parser.push(buffer).map((body) => JSON.parse(body.toString('utf8')));
}

function decodeOutputFrames(buffer: Buffer): any[] {
  const messages: any[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf('\r\n\r\n', offset, 'ascii');
    if (headerEnd < 0) throw new Error('missing output frame header');
    const header = buffer.subarray(offset, headerEnd).toString('ascii');
    const match = /^Content-Length: ([0-9]+)$/m.exec(header);
    if (!match) throw new Error('missing output content length');
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(match[1]);
    messages.push(JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString('utf8')));
    offset = bodyEnd;
  }
  return messages;
}
