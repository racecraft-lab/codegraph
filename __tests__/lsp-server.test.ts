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
    const initialized = await facade.handle(request(3, 'initialize', {}));
    expect(initialized).toMatchObject({
      result: {
        capabilities: { positionEncoding: 'utf-16' },
        serverInfo: { name: 'CodeGraph', version: expect.any(String) },
      },
    });
    expect(await facade.handle(request(30, 'initialized'))).toMatchObject({
      error: { code: LSP_ERROR_CODE.InvalidRequest },
    });
    expect(await facade.handle({ jsonrpc: '2.0', method: 'initialized' })).toBeNull();
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

  it('derives declaration names only inside one unambiguous persisted node span', async () => {
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    const source = 'export function alpha() {}; alpha();\n';
    const context: Extract<LspFileContextRead, { ok: true }> = {
      ...alphaContext,
      snapshot: { ...alphaContext.snapshot, text: source },
      nodes: [{ ...alphaNode, startColumn: 0, endColumn: 26 }],
      occurrences: [],
    };
    const reader: LspRepositoryReader = {
      ...fakeReader(),
      async fileContext() { return context; },
    };
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));
    expect(await facade.handle(request(2, 'textDocument/definition', positionParams(uri, 0, 17))))
      .toMatchObject({
        result: { range: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } } },
      });

    context.nodes = [{ ...alphaNode, startColumn: 0, endColumn: 10 }];
    expect(await facade.handle(request(3, 'textDocument/definition', positionParams(uri, 0, 17))))
      .toMatchObject({ result: null });
  });

  it('caps document symbols by parent-before-child traversal without orphaning a child', async () => {
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    const names = ['child', ...Array.from({ length: 499 }, (_value, index) => `root${index}`), 'parent'];
    const nodes = names.map((name, index): Node => ({
      ...alphaNode,
      id: name,
      name,
      qualifiedName: name,
      startLine: index + 1,
      endLine: index + 1,
      startColumn: 0,
      endColumn: name.length,
    }));
    const context: Extract<LspFileContextRead, { ok: true }> = {
      ...alphaContext,
      snapshot: { ...alphaContext.snapshot, text: `${names.join('\n')}\n` },
      nodes,
      occurrences: [],
      containment: [{ source: 'parent', target: 'child', kind: 'contains' }],
    };
    const reader: LspRepositoryReader = {
      ...fakeReader(),
      async fileContext() { return context; },
    };
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));
    const response = await facade.handle(request(2, 'textDocument/documentSymbol', {
      textDocument: { uri },
    })) as any;

    expect(response.result).toHaveLength(500);
    expect(response.result.some((symbol: any) => symbol.name === 'parent')).toBe(true);
    expect(response.result.some((symbol: any) => symbol.name === 'child')).toBe(false);
  });

  it('fails closed instead of combining graph identities from different snapshots', async () => {
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    const changedContext: Extract<LspFileContextRead, { ok: true }> = {
      ...alphaContext,
      snapshot: { ...alphaContext.snapshot, snapshotToken: 'changed-snapshot' },
    };
    let definitionReads = 0;
    const definitionReader: LspRepositoryReader = {
      ...fakeReader(),
      async fileContext() { return definitionReads++ === 0 ? alphaContext : changedContext; },
    };
    const definitionFacade = new LspFacade(definitionReader);
    await definitionFacade.handle(request(1, 'initialize', {}));
    expect(await definitionFacade.handle(
      request(2, 'textDocument/definition', positionParams(uri, 0, 17)),
    )).toMatchObject({ error: { code: LSP_ERROR_CODE.ContentModified } });

    let referenceReads = 0;
    const referenceReader: LspRepositoryReader = {
      ...fakeReader(),
      async fileContext() { return referenceReads++ === 0 ? alphaContext : changedContext; },
    };
    const referenceFacade = new LspFacade(referenceReader);
    await referenceFacade.handle(request(3, 'initialize', {}));
    expect(await referenceFacade.handle(request(4, 'textDocument/references', {
      ...positionParams(uri, 0, 17),
      context: { includeDeclaration: false },
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.ContentModified } });

    const workspaceReader: LspRepositoryReader = {
      ...fakeReader(),
      async fileContext() { return changedContext; },
    };
    const workspaceFacade = new LspFacade(workspaceReader);
    await workspaceFacade.handle(request(5, 'initialize', {}));
    expect(await workspaceFacade.handle(
      request(6, 'workspace/symbol', { query: 'alpha' }),
    )).toMatchObject({ result: [] });
  });

  it('bounds aggregate source validation without retaining every file context', async () => {
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    const occurrences = Array.from({ length: 17 }, (_value, index) => {
      const source: Node = {
        ...alphaNode,
        id: `source-${index}`,
        filePath: `source-${index}.ts`,
        qualifiedName: `source-${index}.alpha`,
        startColumn: 0,
        endColumn: 5,
      };
      return {
        edge: { source: source.id, target: alphaNode.id, kind: 'calls' as const, line: 1, column: 0 },
        source,
        target: alphaNode,
        sourceSnapshotToken: `source-snapshot-${index}`,
        targetSnapshotToken: alphaContext.snapshot.snapshotToken,
      };
    });
    let referenceFileReads = 0;
    const referenceReader: LspRepositoryReader = {
      ...fakeReader(),
      async incoming() { return { target: alphaNode, occurrences }; },
      async fileContext(filePath) {
        referenceFileReads += 1;
        if (filePath === 'sample.ts') return alphaContext;
        const occurrence = occurrences.find((entry) => entry.source.filePath === filePath)!;
        return largeContext(occurrence.source, occurrence.sourceSnapshotToken, [occurrence]);
      },
    };
    const referenceFacade = new LspFacade(referenceReader);
    await referenceFacade.handle(request(1, 'initialize', {}));
    expect(await referenceFacade.handle(request(2, 'textDocument/references', {
      ...positionParams(uri, 0, 17),
      context: { includeDeclaration: false },
    }))).toMatchObject({
      error: { code: LSP_ERROR_CODE.RequestFailed, data: { reason: 'too_large' } },
    });
    expect(referenceFileReads).toBeLessThanOrEqual(18);

    const candidates = occurrences.map(({ source, sourceSnapshotToken }) => ({
      node: source,
      snapshotToken: sourceSnapshotToken,
    }));
    let workspaceFileReads = 0;
    const workspaceReader: LspRepositoryReader = {
      ...fakeReader(),
      async workspaceSymbols() { return candidates; },
      async fileContext(filePath) {
        workspaceFileReads += 1;
        const occurrence = occurrences.find((entry) => entry.source.filePath === filePath)!;
        return largeContext(occurrence.source, occurrence.sourceSnapshotToken, []);
      },
    };
    const workspaceFacade = new LspFacade(workspaceReader);
    await workspaceFacade.handle(request(3, 'initialize', {}));
    expect(await workspaceFacade.handle(
      request(4, 'workspace/symbol', { query: 'alpha' }),
    )).toMatchObject({
      error: { code: LSP_ERROR_CODE.RequestFailed, data: { reason: 'too_large' } },
    });
    expect(workspaceFileReads).toBeGreaterThan(1);
    expect(workspaceFileReads).toBeLessThanOrEqual(17);
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
    sourceSnapshotToken: 'snapshot',
    targetSnapshotToken: 'snapshot',
  }],
  containment: [],
};

function fakeReader(onRead: () => void = () => undefined): LspRepositoryReader {
  return {
    root: process.cwd(),
    async fileContext() { onRead(); return alphaContext; },
    async incoming() { onRead(); return { target: alphaNode, occurrences: alphaContext.occurrences }; },
    async workspaceSymbols() {
      onRead();
      return [{ node: alphaNode, snapshotToken: alphaContext.snapshot.snapshotToken }];
    },
  };
}

function request(id: number, method: string, params?: object) {
  return { jsonrpc: '2.0' as const, id, method, ...(params === undefined ? {} : { params }) };
}

function positionParams(uri: string, line: number, character: number) {
  return { textDocument: { uri }, position: { line, character } };
}

function largeContext(
  node: Node,
  snapshotToken: string,
  occurrences: Extract<LspFileContextRead, { ok: true }>['occurrences'],
): Extract<LspFileContextRead, { ok: true }> {
  return {
    ok: true,
    snapshot: {
      filePath: node.filePath,
      text: `alpha();\n${'x'.repeat(1024 * 1024)}`,
      languageId: 'typescript',
      contentHash: `hash-${node.id}`,
      snapshotToken,
    },
    nodes: [node],
    occurrences,
    containment: [],
  };
}
