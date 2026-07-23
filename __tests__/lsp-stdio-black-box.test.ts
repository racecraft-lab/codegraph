import { PassThrough, Writable } from 'node:stream';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import CodeGraph from '../src/index';
import { LspJsonRpcClient, LspJsonRpcError } from '../src/lsp/client';
import { stopDaemonAt } from '../src/mcp/daemon-registry';
import {
  ContentLengthParser,
  LspFramingError,
  serveLspStdio,
} from '../src/lsp/stdio-server';
import type { LspRepositoryReader } from '../src/lsp/facade';

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
  });

  it('rejects non-ASCII and control bytes in headers', () => {
    const highBit = Buffer.from('Content-Length: 2\r\n\r\n{}', 'ascii');
    highBit[0] = highBit[0]! | 0x80;
    expect(() => new ContentLengthParser().push(highBit)).toThrow(LspFramingError);
    expect(() => new ContentLengthParser().push(
      Buffer.from('Content-Length: 2\r\nX-Test: bad\u0001value\r\n\r\n{}'),
    )).toThrow(LspFramingError);
  });

  it('copies fragmented body bytes once into a bounded frame buffer', () => {
    const parser = new ContentLengthParser();
    const body = Buffer.alloc(1024 * 1024, 0x61);
    const input = Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
      body,
    ]);
    const messages: Buffer[] = [];
    for (let offset = 0; offset < input.length; offset += 257) {
      messages.push(...parser.push(input.subarray(offset, offset + 257)));
    }
    expect(messages).toHaveLength(1);
    expect(messages[0]?.equals(body)).toBe(true);
    expect(() => parser.finish()).not.toThrow();
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
    input.write(frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }));
    input.end(frame({ jsonrpc: '2.0', method: 'exit' }));

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
    expect(input.isPaused()).toBe(true);
  });

  it('does not dispatch queued frames after transport teardown', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let reads = 0;
    const reader: LspRepositoryReader = {
      ...fakeReader(),
      async workspaceSymbols() { reads += 1; return []; },
    };
    const result = serveLspStdio(reader, {
      input,
      output,
      installSignalHandlers: false,
    });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    input.write(frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'alpha' } }));
    input.emit('error', new Error('closed input'));

    await expect(result).resolves.toBe(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(reads).toBe(0);
  });

  it('terminates on close-only input and output teardown', async () => {
    const input = new PassThrough();
    const inputDiagnostics = new PassThrough();
    const inputClose = vi.fn();
    const inputResult = serveLspStdio(fakeReader(), {
      input,
      output: new PassThrough(),
      diagnostics: inputDiagnostics,
      close: inputClose,
      installSignalHandlers: false,
    });
    input.destroy();
    await expect(inputResult).resolves.toBe(1);
    expect(inputClose).toHaveBeenCalledTimes(1);

    const output = new PassThrough();
    const outputDiagnostics = new PassThrough();
    const outputClose = vi.fn();
    const outputResult = serveLspStdio(fakeReader(), {
      input: new PassThrough(),
      output,
      diagnostics: outputDiagnostics,
      close: outputClose,
      installSignalHandlers: false,
    });
    output.destroy();
    await expect(outputResult).resolves.toBe(1);
    expect(outputClose).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch queued frames after premature EOF', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const outputChunks: Buffer[] = [];
    const diagnosticChunks: Buffer[] = [];
    const reads: string[] = [];
    let releaseFirstRead!: () => void;
    const firstRead = new Promise<void>((resolve) => { releaseFirstRead = resolve; });
    output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    diagnostics.on('data', (chunk) => diagnosticChunks.push(Buffer.from(chunk)));
    const reader: LspRepositoryReader = {
      ...fakeReader(),
      async workspaceSymbols(query) {
        reads.push(query);
        if (query === 'first') await firstRead;
        return [];
      },
    };
    const result = serveLspStdio(reader, {
      input,
      output,
      diagnostics,
      installSignalHandlers: false,
    });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks))).toHaveLength(1));
    await vi.waitFor(() => expect(input.isPaused()).toBe(false));
    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'first' } }),
      frame({ jsonrpc: '2.0', id: 3, method: 'workspace/symbol', params: { query: 'queued' } }),
      Buffer.from('Content-Length: 4\r\n\r\n{}'),
    ]));

    await expect(result).resolves.toBe(1);
    releaseFirstRead();
    await new Promise((resolve) => setImmediate(resolve));
    expect(reads).not.toContain('queued');
    expect(Buffer.concat(diagnosticChunks).toString('utf8')).toBe('[codegraph:lsp] invalid_frame\n');
  });

  it('fails closed before queued request count or body bytes can grow without bound', async () => {
    const expectOverload = async (requestBatches: Buffer[][]): Promise<void> => {
      const input = new PassThrough();
      const output = new PassThrough();
      const diagnostics = new PassThrough();
      const outputChunks: Buffer[] = [];
      const diagnosticChunks: Buffer[] = [];
      let reads = 0;
      output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
      diagnostics.on('data', (chunk) => diagnosticChunks.push(Buffer.from(chunk)));
      const reader: LspRepositoryReader = {
        ...fakeReader(),
        async workspaceSymbols() { reads += 1; return []; },
      };
      const result = serveLspStdio(reader, {
        input,
        output,
        diagnostics,
        installSignalHandlers: false,
      });

      input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
      await vi.waitFor(() => expect(decodeFrames(Buffer.concat(outputChunks))).toHaveLength(1));
      await vi.waitFor(() => expect(input.isPaused()).toBe(false));
      for (const requests of requestBatches) input.write(Buffer.concat(requests));

      await expect(result).resolves.toBe(1);
      expect(input.isPaused()).toBe(true);
      expect(reads).toBe(0);
      expect(Buffer.concat(diagnosticChunks).toString('utf8')).toBe('[codegraph:lsp] invalid_frame\n');
    };

    await expectOverload([
      Array.from({ length: 16 }, (_value, index) => frame({
        jsonrpc: '2.0',
        id: index + 2,
        method: 'workspace/symbol',
        params: { query: 'alpha' },
      })),
      [frame({
        jsonrpc: '2.0',
        id: 18,
        method: 'workspace/symbol',
        params: { query: 'alpha' },
      })],
    ]);

    const largeQuery = 'x'.repeat(1024 * 1024 - 256);
    await expectOverload([
      Array.from({ length: 4 }, (_value, index) => frame({
        jsonrpc: '2.0',
        id: index + 2,
        method: 'workspace/symbol',
        params: { query: largeQuery },
      })),
      [frame({
        jsonrpc: '2.0',
        id: 6,
        method: 'workspace/symbol',
        params: { query: largeQuery },
      })],
    ]);
  });

  it('fails closed on output errors and bounded backpressure', async () => {
    const erroredInput = new PassThrough();
    const erroredOutput = new PassThrough();
    const errored = serveLspStdio(fakeReader(), {
      input: erroredInput,
      output: erroredOutput,
      installSignalHandlers: false,
    });
    erroredOutput.emit('error', new Error('closed output'));
    await expect(errored).resolves.toBe(1);

    const blockedInput = new PassThrough();
    const blockedOutput = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, _callback) { /* Intentionally never drains. */ },
    });
    const blocked = serveLspStdio(fakeReader(), {
      input: blockedInput,
      output: blockedOutput,
      installSignalHandlers: false,
      outputDrainTimeoutMs: 20,
    });
    blockedInput.end(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await expect(blocked).resolves.toBe(1);
  });

  it('cancels an active output-drain wait during transport teardown', async () => {
    const input = new PassThrough();
    const output = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, _callback) { /* Intentionally never drains. */ },
    });
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      installSignalHandlers: false,
      outputDrainTimeoutMs: 60_000,
    });

    input.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await vi.waitFor(() => expect(output.listenerCount('drain')).toBe(1));
    input.emit('error', new Error('closed input'));

    await expect(result).resolves.toBe(1);
    expect(output.listenerCount('drain')).toBe(0);
    output.destroy();
  });

  it('waits for accepted output writes and reports late callback failures', async () => {
    const input = new PassThrough();
    let completeWrite!: (error?: Error | null) => void;
    const output = new Writable({
      write(_chunk, _encoding, callback) { completeWrite = callback; },
    });
    const result = serveLspStdio(fakeReader(), {
      input,
      output,
      diagnostics: new PassThrough(),
      installSignalHandlers: false,
      outputDrainTimeoutMs: 1_000,
    });
    let resolved = false;
    void result.then(() => { resolved = true; });

    input.end(Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
      frame({ jsonrpc: '2.0', method: 'exit' }),
    ]));
    await vi.waitFor(() => expect(completeWrite).toBeTypeOf('function'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(resolved).toBe(false);

    completeWrite(new Error('EPIPE'));
    await expect(result).resolves.toBe(1);
  });

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
    fileContext: async () => ({ ok: false, reason: 'unindexed' }),
    incoming: async () => ({ ok: false, reason: 'stale' }),
    workspaceSymbols: async () => [],
  };
}

function frame(value: unknown): Buffer {
  return rawFrame(JSON.stringify(value));
}

function rawFrame(value: string): Buffer {
  const body = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

function decodeFrames(buffer: Buffer): any[] {
  const parser = new ContentLengthParser();
  return parser.push(buffer).map((body) => JSON.parse(body.toString('utf8')));
}
