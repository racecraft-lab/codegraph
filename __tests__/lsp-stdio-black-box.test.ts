import { PassThrough } from 'node:stream';
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
    incoming: async () => ({ target: null, occurrences: [] }),
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
