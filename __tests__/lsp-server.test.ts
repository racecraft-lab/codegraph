import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { LSP_ERROR_CODE } from '../src/lsp/protocol';
import { LspFacade, type LspRepositoryReader } from '../src/lsp/facade';
import type { LspFileContextRead } from '../src/mcp/read-ops';
import type { Node } from '../src/types';

describe('repository-bound LSP facade', () => {
  it('enforces root binding and exact lifecycle errors', async () => {
    const facade = new LspFacade(fakeReader());
    expect(await facade.handle(request(1, 'textDocument/definition', {}))).toMatchObject({
      error: { code: LSP_ERROR_CODE.ServerNotInitialized },
    });
    expect(await facade.handle(request(2, 'initialize', {
      rootUri: pathToFileURL('/definitely/not/the/bound/root').href,
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.InvalidParams } });
    expect(await facade.handle(request(3, 'initialize', {}))).toMatchObject({
      result: { capabilities: { positionEncoding: 'utf-16' } },
    });
    expect(await facade.handle(request(4, 'initialize', {}))).toMatchObject({
      error: { code: LSP_ERROR_CODE.InvalidRequest },
    });
    expect(await facade.handle(request(5, 'shutdown'))).toEqual({ jsonrpc: '2.0', id: 5, result: null });
    expect(await facade.handle(request(6, 'workspace/symbol', { query: 'alpha' }))).toMatchObject({
      error: { code: LSP_ERROR_CODE.InvalidRequest },
    });
    expect(await facade.handle({ jsonrpc: '2.0', method: 'exit' })).toBeNull();
    expect(facade.requestedExitCode).toBe(0);
  });

  it('serves exact definition, references, hover, symbols, and content', async () => {
    const reader = fakeReader();
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));

    const definition = await facade.handle(request(2, 'textDocument/definition', positionParams(uri, 1, 2)));
    expect(definition).toMatchObject({
      result: { uri, range: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } } },
    });

    const references = await facade.handle(request(3, 'textDocument/references', {
      ...positionParams(uri, 1, 2),
      context: { includeDeclaration: true },
    }));
    expect((references as any).result).toEqual([
      { uri, range: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } } },
      { uri, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } } },
    ]);

    const hover = await facade.handle(request(4, 'textDocument/hover', positionParams(uri, 1, 2)));
    expect(hover).toMatchObject({ result: { contents: { kind: 'markdown' } } });
    expect(JSON.stringify(hover)).toContain('sample.alpha');

    const documentSymbols = await facade.handle(request(5, 'textDocument/documentSymbol', {
      textDocument: { uri },
    }));
    expect((documentSymbols as any).result).toHaveLength(1);
    expect((documentSymbols as any).result[0].name).toBe('alpha');

    const workspaceSymbols = await facade.handle(request(6, 'workspace/symbol', { query: 'alpha' }));
    expect((workspaceSymbols as any).result).toMatchObject([{ name: 'alpha', location: { uri } }]);

    const content = await facade.handle(request(7, 'codegraph/textDocumentContent', {
      textDocument: { uri },
    }));
    expect(content).toMatchObject({
      result: {
        text: 'export function alpha() {}\nalpha();\n',
        languageId: 'typescript',
        contentHash: 'hash',
        snapshotToken: 'snapshot',
      },
    });
  });

  it('never dispatches unsupported requests to the repository reader', async () => {
    let reads = 0;
    const reader = fakeReader(() => { reads++; });
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));
    expect(await facade.handle(request(2, 'textDocument/rename', {}))).toMatchObject({
      error: { code: LSP_ERROR_CODE.MethodNotFound },
    });
    expect(reads).toBe(0);
  });

  it('maps bounded incoming-read failures to closed source errors', async () => {
    const reader: LspRepositoryReader = {
      ...fakeReader(),
      async incoming() { return { ok: false, reason: 'too_large' }; },
    };
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));
    expect(await facade.handle(request(2, 'textDocument/references', positionParams(uri, 1, 2))))
      .toMatchObject({
        error: {
          code: LSP_ERROR_CODE.RequestFailed,
          data: { reason: 'too_large' },
        },
      });
  });
});

const alphaNode: Node = {
  id: 'alpha',
  kind: 'function',
  name: 'alpha',
  qualifiedName: 'sample.alpha',
  filePath: 'sample.ts',
  language: 'typescript',
  startLine: 1,
  endLine: 1,
  startColumn: 16,
  endColumn: 21,
  signature: 'function alpha(): void',
  docstring: 'Example function.',
  updatedAt: 1,
};

const alphaContext: Extract<LspFileContextRead, { ok: true }> = {
  ok: true,
  snapshot: {
    filePath: 'sample.ts',
    text: 'export function alpha() {}\nalpha();\n',
    languageId: 'typescript',
    contentHash: 'hash',
    snapshotToken: 'snapshot',
  },
  nodes: [alphaNode],
  occurrences: [{
    edge: { source: alphaNode.id, target: alphaNode.id, kind: 'calls', line: 2, column: 0 },
    source: alphaNode,
    target: alphaNode,
  }],
  containment: [],
};

function fakeReader(onRead: () => void = () => undefined): LspRepositoryReader {
  return {
    root: process.cwd(),
    async fileContext() { onRead(); return alphaContext; },
    async incoming() { onRead(); return { target: alphaNode, occurrences: alphaContext.occurrences }; },
    async workspaceSymbols() { onRead(); return [alphaNode]; },
  };
}

function request(id: number, method: string, params?: object) {
  return { jsonrpc: '2.0' as const, id, method, ...(params === undefined ? {} : { params }) };
}

function positionParams(uri: string, line: number, character: number) {
  return { textDocument: { uri }, position: { line, character } };
}
