import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LSP_ERROR_CODE,
  LSP_LIFECYCLE_STATE,
  LSP_WORKSPACE_QUERY_BYTE_CAP,
} from '../src/lsp/protocol';
import { LspFacade, type LspRepositoryReader } from '../src/lsp/facade';
import type {
  LspDocumentContextRead,
  LspPositionContextRead,
  LspSourceSnapshotRead,
  LspWorkspaceSymbolCandidate,
} from '../src/mcp/read-ops';
import type { Node } from '../src/types';

describe('repository-bound LSP facade', () => {
  it('enforces root binding and exact lifecycle errors', async () => {
    const facade = new LspFacade(fakeReader());
    expect(await facade.handle(request(0, 'exit'))).toMatchObject({
      error: { code: LSP_ERROR_CODE.ServerNotInitialized },
    });
    expect(await facade.handle(request(1, 'textDocument/definition', {}))).toMatchObject({
      error: { code: LSP_ERROR_CODE.ServerNotInitialized },
    });
    expect(await facade.handle(request(2, 'initialize', {
      rootUri: pathToFileURL('/definitely/not/the/bound/root').href,
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.InvalidParams } });
    expect(await facade.handle(request(3, 'initialize', {}))).toMatchObject({
      result: {
        capabilities: { positionEncoding: 'utf-16' },
        serverInfo: { name: 'CodeGraph', version: '1' },
      },
    });
    expect(await facade.handle(request(4, 'initialized', {}))).toMatchObject({
      error: { code: LSP_ERROR_CODE.MethodNotFound },
    });
    expect(await facade.handle(request(5, 'initialize', {}))).toMatchObject({
      error: { code: LSP_ERROR_CODE.InvalidRequest },
    });
    expect(await facade.handle(request(8, 'exit'))).toMatchObject({
      error: { code: LSP_ERROR_CODE.MethodNotFound },
    });
    expect(await facade.handle(request(6, 'shutdown'))).toEqual({ jsonrpc: '2.0', id: 6, result: null });
    expect(await facade.handle(request(7, 'workspace/symbol', { query: 'alpha' }))).toMatchObject({
      error: { code: LSP_ERROR_CODE.InvalidRequest },
    });
    expect(await facade.handle(
      request(9, 'initialized', {}),
      undefined,
      LSP_LIFECYCLE_STATE.Initialized,
    )).toMatchObject({ error: { code: LSP_ERROR_CODE.MethodNotFound } });
    expect(await facade.handle({ jsonrpc: '2.0', method: 'exit' })).toBeNull();
    expect(facade.requestedExitCode).toBe(0);
  });

  it('rejects amplified initialize roots and workspace queries before synchronous work', async () => {
    const boundRoot = pathToFileURL(process.cwd()).href;
    const folderFacade = new LspFacade(fakeReader());
    expect(await folderFacade.handle(request(1, 'initialize', {
      workspaceFolders: [{ uri: boundRoot }, { uri: boundRoot }],
    }))).toMatchObject({ result: { capabilities: { positionEncoding: 'utf-16' } } });

    const distinctFacade = new LspFacade(fakeReader());
    expect(await distinctFacade.handle(request(1, 'initialize', {
      workspaceFolders: [{ uri: boundRoot }, { uri: pathToFileURL('/definitely/not/the/bound/root').href }],
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.InvalidParams } });

    const amplifiedFacade = new LspFacade(fakeReader());
    expect(await amplifiedFacade.handle(request(1, 'initialize', {
      workspaceFolders: Array.from({ length: 65 }, () => ({ uri: boundRoot })),
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.InvalidParams } });

    const reader = fakeReader();
    reader.workspaceSymbols = vi.fn(async () => []);
    const queryFacade = new LspFacade(reader);
    await queryFacade.handle(request(1, 'initialize', {}));
    expect(await queryFacade.handle(request(2, 'workspace/symbol', {
      query: 'x'.repeat(LSP_WORKSPACE_QUERY_BYTE_CAP + 1),
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.InvalidParams } });
    expect(reader.workspaceSymbols).not.toHaveBeenCalled();

    reader.workspaceSymbols = vi.fn(async () => ({ ok: false as const, reason: 'too_large' as const }));
    expect(await queryFacade.handle(request(3, 'workspace/symbol', { query: 'needle' })))
      .toMatchObject({ error: { code: LSP_ERROR_CODE.RequestFailed, data: { reason: 'too_large' } } });
  });

  it('does not let projected initialization outlive failed root validation', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-init-race-'));
    const root = path.join(parent, 'root');
    const alias = path.join(parent, 'alias');
    fs.mkdirSync(root);
    fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const reader = fakeReader();
      reader.root = root;
      reader.workspaceSymbols = vi.fn(reader.workspaceSymbols);
      const facade = new LspFacade(reader);
      const initialize = request(1, 'initialize', { rootUri: pathToFileURL(alias).href });
      const projected = facade.admissionLifecycleStateAfter(
        LSP_LIFECYCLE_STATE.Created,
        initialize,
      );
      expect(projected).toBe(LSP_LIFECYCLE_STATE.Initialized);

      fs.unlinkSync(alias);
      expect(await facade.handle(initialize)).toMatchObject({
        error: { code: LSP_ERROR_CODE.InvalidParams },
      });
      expect(await facade.handle(
        request(2, 'workspace/symbol', { query: 'alpha' }),
        undefined,
        projected,
      )).toMatchObject({ error: { code: LSP_ERROR_CODE.ServerNotInitialized } });
      expect(reader.workspaceSymbols).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
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
      { uri, range: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } }, snapshotToken: 'snapshot' },
      { uri, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, snapshotToken: 'snapshot' },
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

  it('rejects browser intelligence requests for a superseded displayed snapshot', async () => {
    const facade = new LspFacade(fakeReader());
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));

    for (const [index, method] of [
      'textDocument/definition',
      'textDocument/references',
      'textDocument/hover',
    ].entries()) {
      const response = await facade.handle(request(index + 2, method, {
        ...positionParams(uri, 1, 2, 'superseded-snapshot'),
        ...(method === 'textDocument/references' ? { context: { includeDeclaration: true } } : {}),
      }));
      expect(response).toMatchObject({ error: { code: LSP_ERROR_CODE.ContentModified } });
    }
  });

  it('propagates stale source races for definitions and references', async () => {
    const reader = fakeReader();
    reader.sourceSnapshot = async () => ({ ok: false, reason: 'stale' });
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'textDocument/definition', positionParams(uri, 1, 2))))
      .toMatchObject({ error: { code: LSP_ERROR_CODE.ContentModified } });
    expect(await facade.handle(request(3, 'textDocument/references', {
      ...positionParams(uri, 1, 2),
      context: { includeDeclaration: false },
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.ContentModified } });
  });

  it('uses full declaration ranges while keeping name-only selection ranges', async () => {
    const parent: Node = {
      ...alphaNode,
      id: 'parent',
      kind: 'class',
      name: 'Café',
      qualifiedName: 'sample.Café',
      startLine: 1,
      endLine: 5,
      startColumn: 13,
      endColumn: 1,
      signature: 'class Café',
    };
    const child: Node = {
      ...alphaNode,
      id: 'child',
      kind: 'method',
      qualifiedName: 'sample.Café.alpha',
      startLine: 2,
      endLine: 4,
      startColumn: 2,
      endColumn: 3,
    };
    const text = 'export class Café {\n  alpha() {\n    return 1;\n  }\n}\n';
    const snapshot = {
      ...alphaSnapshot,
      snapshot: { ...alphaSnapshot.snapshot, text },
    };
    const reader = fakeReader();
    reader.documentContext = async () => ({
      ...snapshot,
      nodes: [parent, child],
      containment: [{ source: parent.id, target: child.id, kind: 'contains' }],
    });
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));

    const response = await facade.handle(request(2, 'textDocument/documentSymbol', {
      textDocument: { uri },
    })) as any;
    expect(response.result).toHaveLength(1);
    expect(response.result[0]).toMatchObject({
      name: 'Café',
      range: { start: { line: 0, character: 13 }, end: { line: 4, character: 1 } },
      selectionRange: { start: { line: 0, character: 13 }, end: { line: 0, character: 17 } },
      children: [{
        name: 'alpha',
        range: { start: { line: 1, character: 2 }, end: { line: 3, character: 3 } },
        selectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 7 } },
      }],
    });
  });

  it('derives a unique exact name span when an indexed node starts at the declaration keyword', async () => {
    const declarationNode: Node = {
      ...alphaNode,
      startColumn: 0,
      endColumn: 26,
    };
    const reader = fakeReader();
    reader.workspaceSymbols = async () => [workspaceCandidate(declarationNode)];
    reader.documentContext = async () => ({
      ...alphaSnapshot,
      nodes: [declarationNode],
      containment: [],
    });
    reader.positionContext = async () => ({
      ...alphaPositionContext,
      nodes: [declarationNode],
    });
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'workspace/symbol', { query: 'alpha' }))).toMatchObject({
      result: [{ location: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 26 } } } }],
    });
    expect(await facade.handle(request(3, 'textDocument/documentSymbol', { textDocument: { uri } }))).toMatchObject({
      result: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 26 } },
        selectionRange: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } },
      }],
    });
    expect(await facade.handle(request(4, 'textDocument/hover', positionParams(uri, 0, 18))))
      .toMatchObject({ result: { contents: { value: expect.stringContaining('sample.alpha') } } });
    expect(await facade.handle(request(5, 'textDocument/definition', positionParams(uri, 0, 18))))
      .toMatchObject({
        result: { range: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } } },
      });
  });

  it('does not derive an identifier name from a larger identifier', async () => {
    const text = 'export function foobar() {}\n';
    const embeddedNode: Node = {
      ...alphaNode,
      id: 'embedded-name',
      name: 'foo',
      qualifiedName: 'sample.foo',
      startColumn: 0,
      endColumn: text.trimEnd().length,
    };
    const snapshot: Extract<LspSourceSnapshotRead, { ok: true }> = {
      ...alphaSnapshot,
      snapshot: { ...alphaSnapshot.snapshot, text },
    };
    const reader = fakeReader();
    reader.workspaceSymbols = async () => [workspaceCandidate(embeddedNode)];
    reader.sourceSnapshot = async () => snapshot;
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'workspace/symbol', { query: 'foo' })))
      .toMatchObject({ result: [] });
  });

  it('ignores larger identifiers when deriving a unique declaration name', async () => {
    const text = 'export function foo() { const foobar = 1; }\n';
    const declarationNode: Node = {
      ...alphaNode,
      id: 'bounded-name',
      name: 'foo',
      qualifiedName: 'sample.foo',
      startColumn: 0,
      endColumn: text.trimEnd().length,
    };
    const snapshot: Extract<LspSourceSnapshotRead, { ok: true }> = {
      ...alphaSnapshot,
      snapshot: { ...alphaSnapshot.snapshot, text },
    };
    const reader = fakeReader();
    reader.workspaceSymbols = async () => [workspaceCandidate(declarationNode)];
    reader.sourceSnapshot = async () => snapshot;
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'workspace/symbol', { query: 'foo' })))
      .toMatchObject({ result: [{ name: 'foo' }] });
  });

  it('locates a punctuation symbol directly by node id without workspace search caps', async () => {
    const text = 'let (>>=) value next = next value\n';
    const punctuationNode: Node = {
      ...alphaNode,
      id: 'operator-id',
      kind: 'operator',
      name: '>>=',
      qualifiedName: 'operators.>>=',
      filePath: 'operator.ml',
      startColumn: 0,
      endColumn: text.trimEnd().length,
    };
    const snapshot: Extract<LspSourceSnapshotRead, { ok: true }> = {
      ok: true,
      snapshot: {
        filePath: punctuationNode.filePath,
        text,
        languageId: 'ocaml',
        contentHash: 'operator-hash',
        snapshotToken: 'operator-snapshot',
      },
    };
    const reader = fakeReader();
    reader.nodeLocation = vi.fn(async () => ({
      ok: true,
      node: punctuationNode,
      snapshotToken: snapshot.snapshot.snapshotToken,
    }));
    reader.sourceSnapshot = async () => snapshot;
    reader.workspaceSymbols = vi.fn(async () => Array.from(
      { length: 101 },
      (_value, index) => workspaceCandidate({ ...alphaNode, id: `same-name-${index}` }),
    ));
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'workspace/symbol', { query: '', nodeId: punctuationNode.id })))
      .toMatchObject({
        result: [{
          location: {
            uri: pathToFileURL(`${process.cwd()}/operator.ml`).href,
            range: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } },
          },
          data: { codegraphNodeId: punctuationNode.id },
        }],
      });
    expect(reader.nodeLocation).toHaveBeenCalledWith(punctuationNode.id, expect.any(AbortSignal));
    expect(reader.workspaceSymbols).not.toHaveBeenCalled();
  });

  it('keeps adjacent punctuation actionable after multibyte source text', async () => {
    const text = 'é++\n';
    const punctuationNode: Node = {
      ...alphaNode,
      id: 'first-plus',
      name: '+',
      qualifiedName: 'operators.+',
      filePath: 'unicode-operator.ml',
      startColumn: 2,
      endColumn: 3,
    };
    const snapshot: Extract<LspSourceSnapshotRead, { ok: true }> = {
      ok: true,
      snapshot: {
        filePath: punctuationNode.filePath,
        text,
        languageId: 'ocaml',
        contentHash: 'unicode-operator-hash',
        snapshotToken: 'unicode-operator-snapshot',
      },
    };
    const reader = fakeReader();
    reader.sourceSnapshot = async () => snapshot;
    reader.nodeLocation = async () => ({
      ok: true,
      node: punctuationNode,
      snapshotToken: snapshot.snapshot.snapshotToken,
    });
    reader.positionContext = async () => ({
      ...snapshot,
      nodes: [punctuationNode],
      targets: [],
      targetSnapshots: [],
      occurrences: [],
    });
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/${punctuationNode.filePath}`).href;
    await facade.handle(request(1, 'initialize', {}));

    const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } };
    expect(await facade.handle(request(2, 'workspace/symbol', { query: '', nodeId: punctuationNode.id })))
      .toMatchObject({ result: [{ location: { uri, range } }] });
    expect(await facade.handle(request(3, 'textDocument/hover', positionParams(uri, 0, 1))))
      .toMatchObject({ result: { contents: { value: expect.stringContaining('operators.+') } } });
    expect(await facade.handle(request(4, 'textDocument/definition', positionParams(uri, 0, 1))))
      .toMatchObject({ result: { uri, range } });
    expect(await facade.handle(request(5, 'textDocument/hover', positionParams(uri, 0, 2))))
      .toMatchObject({ result: null });
  });

  it('keeps multiline punctuation symbols actionable after multibyte source text', async () => {
    const text = 'é++\nend\n';
    const punctuationNode: Node = {
      ...alphaNode,
      id: 'multiline-plus',
      kind: 'operator',
      name: '+',
      qualifiedName: 'operators.multiline.+',
      filePath: 'multiline-unicode-operator.ml',
      startLine: 1,
      endLine: 2,
      startColumn: 2,
      endColumn: 3,
    };
    const snapshot: Extract<LspSourceSnapshotRead, { ok: true }> = {
      ok: true,
      snapshot: {
        filePath: punctuationNode.filePath,
        text,
        languageId: 'ocaml',
        contentHash: 'multiline-unicode-operator-hash',
        snapshotToken: 'multiline-unicode-operator-snapshot',
      },
    };
    const reader = fakeReader();
    reader.sourceSnapshot = async () => snapshot;
    reader.nodeLocation = async () => ({
      ok: true,
      node: punctuationNode,
      snapshotToken: snapshot.snapshot.snapshotToken,
    });
    reader.workspaceSymbols = async () => [workspaceCandidate(
      punctuationNode,
      snapshot.snapshot.snapshotToken,
    )];
    reader.documentContext = async () => ({
      ...snapshot,
      nodes: [punctuationNode],
      containment: [],
    });
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/${punctuationNode.filePath}`).href;
    await facade.handle(request(1, 'initialize', {}));

    const range = { start: { line: 0, character: 1 }, end: { line: 1, character: 3 } };
    expect(await facade.handle(request(2, 'workspace/symbol', { query: '+' })))
      .toMatchObject({ result: [{ location: { uri, range } }] });
    expect(await facade.handle(request(3, 'textDocument/documentSymbol', {
      textDocument: { uri },
    }))).toMatchObject({
      result: [{
        range,
        selectionRange: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } },
      }],
    });
  });

  it('keeps an unambiguous multiline declaration range when its name starts later', async () => {
    const text = '@decorator(\n  option\n)\nfunction alpha() {}\n';
    const decoratedNode: Node = {
      ...alphaNode,
      id: 'decorated-alpha',
      filePath: 'decorated.ts',
      startLine: 1,
      endLine: 4,
      startColumn: 0,
      endColumn: 19,
    };
    const snapshot: Extract<LspSourceSnapshotRead, { ok: true }> = {
      ok: true,
      snapshot: {
        filePath: decoratedNode.filePath,
        text,
        languageId: 'typescript',
        contentHash: 'decorated-hash',
        snapshotToken: 'decorated-snapshot',
      },
    };
    const reader = fakeReader();
    reader.sourceSnapshot = async () => snapshot;
    reader.workspaceSymbols = async () => [workspaceCandidate(
      decoratedNode,
      snapshot.snapshot.snapshotToken,
    )];
    reader.documentContext = async () => ({
      ...snapshot,
      nodes: [decoratedNode],
      containment: [],
    });
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/${decoratedNode.filePath}`).href;
    await facade.handle(request(1, 'initialize', {}));

    const range = { start: { line: 0, character: 0 }, end: { line: 3, character: 19 } };
    expect(await facade.handle(request(2, 'workspace/symbol', { query: 'alpha' })))
      .toMatchObject({ result: [{ location: { uri, range } }] });
    expect(await facade.handle(request(3, 'textDocument/documentSymbol', {
      textDocument: { uri },
    }))).toMatchObject({
      result: [{
        range,
        selectionRange: { start: { line: 3, character: 9 }, end: { line: 3, character: 14 } },
      }],
    });
  });

  it('fails closed when mixed column encodings identify non-adjacent punctuation', async () => {
    const text = '😀;x;\n';
    const punctuationNode: Node = {
      ...alphaNode,
      id: 'ambiguous-semicolon',
      name: ';',
      qualifiedName: 'operators.;',
      filePath: 'ambiguous-operator.ml',
      startColumn: 4,
      endColumn: 5,
    };
    const snapshot: Extract<LspSourceSnapshotRead, { ok: true }> = {
      ok: true,
      snapshot: {
        filePath: punctuationNode.filePath,
        text,
        languageId: 'ocaml',
        contentHash: 'ambiguous-operator-hash',
        snapshotToken: 'ambiguous-operator-snapshot',
      },
    };
    const reader = fakeReader();
    reader.sourceSnapshot = async () => snapshot;
    reader.nodeLocation = async () => ({
      ok: true,
      node: punctuationNode,
      snapshotToken: snapshot.snapshot.snapshotToken,
    });
    reader.positionContext = async () => ({
      ...snapshot,
      nodes: [punctuationNode],
      targets: [],
      targetSnapshots: [],
      occurrences: [],
    });
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/${punctuationNode.filePath}`).href;
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'workspace/symbol', { query: '', nodeId: punctuationNode.id })))
      .toMatchObject({ result: [] });
    expect(await facade.handle(request(3, 'textDocument/hover', positionParams(uri, 0, 2))))
      .toMatchObject({ result: null });
  });

  it('applies public result caps after rejecting stale workspace candidates', async () => {
    const validNodes: Node[] = Array.from({ length: 100 }, (_value, index) => {
      const name = `valid${String(index).padStart(3, '0')}`;
      return {
        ...alphaNode,
        id: name,
        name,
        qualifiedName: `symbols.${name}`,
        filePath: 'symbols.ts',
        startLine: index + 1,
        endLine: index + 1,
        startColumn: 0,
        endColumn: name.length,
      };
    });
    const stale = { ...alphaNode, id: 'stale', filePath: 'stale.ts' };
    const text = `${validNodes.map((node) => node.name).join('\n')}\n`;
    const reader = fakeReader();
    reader.workspaceSymbols = async () => [workspaceCandidate(stale), ...validNodes.map((node) => workspaceCandidate(node))];
    reader.sourceSnapshot = async (filePath) => filePath === 'stale.ts'
      ? { ok: false, reason: 'stale' }
      : { ...alphaSnapshot, snapshot: { ...alphaSnapshot.snapshot, filePath, text } };
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));

    const response = await facade.handle(request(2, 'workspace/symbol', { query: 'valid' })) as any;
    expect(response.result).toHaveLength(100);
    expect(response.result[0].name).toBe('valid000');
    expect(response.result[99].name).toBe('valid099');
  });

  it('orders the complete workspace candidate pool by converted range before capping', async () => {
    const leading = Array.from({ length: 99 }, (_value, index): Node => ({
      ...alphaNode,
      id: `leading-${index}`,
      name: 'A',
      qualifiedName: 'same.A',
      filePath: 'symbols.ts',
      startLine: index + 1,
      endLine: index + 1,
      startColumn: 0,
      endColumn: 1,
    }));
    const utf16Second = {
      ...alphaNode,
      id: 'utf16-second',
      name: 'A',
      qualifiedName: 'same.A',
      filePath: 'symbols.ts',
      startLine: 100,
      endLine: 100,
      startColumn: 3,
      endColumn: 4,
    };
    const utf8First = {
      ...utf16Second,
      id: 'utf8-first',
      startColumn: 4,
      endColumn: 5,
    };
    const text = `${leading.map(() => 'A').join('\n')}\nééAA\n`;
    const reader = fakeReader();
    reader.workspaceSymbols = async () => [
      ...leading.map((node) => workspaceCandidate(node)),
      workspaceCandidate(utf16Second),
      workspaceCandidate(utf8First),
    ];
    reader.sourceSnapshot = async () => ({
      ...alphaSnapshot,
      snapshot: { ...alphaSnapshot.snapshot, filePath: 'symbols.ts', text },
    });
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));

    const response = await facade.handle(request(2, 'workspace/symbol', { query: '' })) as any;
    expect(response.result).toHaveLength(100);
    expect(response.result[99].data.codegraphNodeId).toBe(utf8First.id);
  });

  it('preserves workspace search rank before deterministic tie-breakers', async () => {
    const lowerRank = {
      ...alphaNode,
      id: 'lower-rank',
      name: 'alpha',
      qualifiedName: 'a.alpha',
      filePath: 'symbols.ts',
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 5,
    };
    const higherRank = {
      ...lowerRank,
      id: 'higher-rank',
      name: 'zeta',
      qualifiedName: 'z.zeta',
      startLine: 2,
      endLine: 2,
      endColumn: 4,
    };
    const reader = fakeReader();
    reader.workspaceSymbols = async () => [
      workspaceCandidate(lowerRank, 'snapshot', 1),
      workspaceCandidate(higherRank, 'snapshot', 2),
    ];
    reader.sourceSnapshot = async () => ({
      ...alphaSnapshot,
      snapshot: { ...alphaSnapshot.snapshot, filePath: 'symbols.ts', text: 'alpha\nzeta\n' },
    });
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));

    const response = await facade.handle(request(2, 'workspace/symbol', { query: 'a' })) as any;
    expect(response.result.map((symbol: any) => symbol.data.codegraphNodeId))
      .toEqual([higherRank.id, lowerRank.id]);
  });

  it('continues past one thousand unprovable workspace ranges', async () => {
    const reader = fakeReader();
    reader.workspaceSymbols = async () => [
      ...Array.from({ length: 1_000 }, (_value, index) => workspaceCandidate({
        ...alphaNode,
        id: `unprovable-${index}`,
        startLine: 99,
        endLine: 99,
      })),
      workspaceCandidate(alphaNode),
    ];
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'workspace/symbol', { query: 'alpha' })))
      .toMatchObject({ result: [{ name: alphaNode.name }] });
  });

  it('validates incoming evidence before applying the public reference cap', async () => {
    const reader = fakeReader();
    const incoming = vi.fn<LspRepositoryReader['incoming']>(async () => ({
      ok: true as const,
      occurrences: [
        ...Array.from({ length: 500 }, () => ({
          sourceFilePath: 'sample.ts', targetId: alphaNode.id, line: 2, column: 99, evidence: 'alpha',
        })),
        { sourceFilePath: 'sample.ts', targetId: alphaNode.id, line: 2, column: 0, evidence: 'alpha' },
      ],
      sourceSnapshots: [{ filePath: 'sample.ts', snapshotToken: alphaSnapshot.snapshot.snapshotToken }],
    }));
    reader.incoming = incoming;
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));

    const response = await facade.handle(request(2, 'textDocument/references', {
      ...positionParams(uri, 1, 2),
      context: { includeDeclaration: false },
    })) as any;
    expect(response.result).toEqual([
      { uri, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, snapshotToken: 'snapshot' },
    ]);
    expect(incoming).toHaveBeenCalledOnce();
  });

  it('bounds cumulative declaration-range validation across workspace candidates', async () => {
    const declaration = `${' '.repeat(1024 * 1024 - alphaNode.name.length)}${alphaNode.name}`;
    const snapshot: Extract<LspSourceSnapshotRead, { ok: true }> = {
      ...alphaSnapshot,
      snapshot: { ...alphaSnapshot.snapshot, text: `${declaration}\n` },
    };
    const reader = fakeReader();
    reader.workspaceSymbols = async () => Array.from({ length: 17 }, (_, index) => workspaceCandidate({
      ...alphaNode,
      id: `wide-${index}`,
      qualifiedName: `sample.wide${index}`,
      startColumn: 0,
      endColumn: declaration.length,
    }));
    reader.sourceSnapshot = async () => snapshot;
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'workspace/symbol', { query: 'alpha' })))
      .toMatchObject({ error: { code: LSP_ERROR_CODE.RequestFailed, data: { reason: 'too_large' } } });
  });

  it('bounds workspace snapshot fan-out before issuing hundreds of extra reads', async () => {
    const reader = fakeReader();
    reader.workspaceSymbols = async () => Array.from({ length: 513 }, (_, index) => workspaceCandidate({
      ...alphaNode,
      id: `workspace-${index}`,
      filePath: `workspace-${index}.ts`,
      qualifiedName: `workspace${index}.alpha`,
    }));
    reader.sourceSnapshot = vi.fn(async (filePath): Promise<LspSourceSnapshotRead> => ({
      ...alphaSnapshot,
      snapshot: { ...alphaSnapshot.snapshot, filePath },
    }));
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'workspace/symbol', { query: 'alpha' })))
      .toMatchObject({ error: { code: LSP_ERROR_CODE.RequestFailed, data: { reason: 'too_large' } } });
    expect(reader.sourceSnapshot).toHaveBeenCalledTimes(512);
  });

  it('bounds reference snapshot fan-out before issuing hundreds of extra reads', async () => {
    const reader = fakeReader();
    const occurrences = Array.from({ length: 513 }, (_, index) => ({
      sourceFilePath: `reference-${index}.ts`,
      targetId: alphaNode.id,
      line: 1,
      column: 0,
      evidence: alphaNode.name,
    }));
    reader.incoming = async () => ({
      ok: true,
      occurrences,
      sourceSnapshots: occurrences.map(({ sourceFilePath }) => ({
        filePath: sourceFilePath,
        snapshotToken: alphaSnapshot.snapshot.snapshotToken,
      })),
    });
    reader.sourceSnapshot = vi.fn(async (filePath): Promise<LspSourceSnapshotRead> => ({
      ...alphaSnapshot,
      snapshot: { ...alphaSnapshot.snapshot, filePath },
    }));
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'textDocument/references', {
      ...positionParams(uri, 1, 2),
      context: { includeDeclaration: false },
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.RequestFailed, data: { reason: 'too_large' } } });
    expect(reader.sourceSnapshot).toHaveBeenCalledTimes(512);
  });

  it('aborts repository reads at the aggregate LSP request deadline', async () => {
    vi.useFakeTimers();
    try {
      const reader = fakeReader();
      let repositorySignal: AbortSignal | undefined;
      reader.workspaceSymbols = (_query, signal) => new Promise((_, reject) => {
        repositorySignal = signal;
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      const facade = new LspFacade(reader);
      await facade.handle(request(1, 'initialize', {}));

      const response = facade.handle(request(2, 'workspace/symbol', { query: 'alpha' }));
      await vi.advanceTimersByTimeAsync(25_001);

      await expect(response).resolves.toMatchObject({
        error: { code: LSP_ERROR_CODE.RequestFailed, data: { reason: 'timeout' } },
      });
      expect(repositorySignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates a bounded daemon reference-scan failure', async () => {
    const reader = fakeReader();
    const incoming = vi.fn<LspRepositoryReader['incoming']>(async () => ({ ok: false, reason: 'too_large' }));
    reader.incoming = incoming;
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'textDocument/references', {
      ...positionParams(uri, 1, 2),
      context: { includeDeclaration: false },
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.RequestFailed, data: { reason: 'too_large' } } });
    expect(incoming).toHaveBeenCalledOnce();
  });

  it('splits each source snapshot once across the maximum reference candidate set', async () => {
    let textReads = 0;
    const snapshot = {
      ...alphaSnapshot.snapshot,
      get text(): string {
        textReads += 1;
        return `alpha${' '.repeat(1024 * 1024 - 5)}`;
      },
    };
    const context = { ok: true as const, snapshot };
    const reader = fakeReader();
    reader.positionContext = async () => ({
      ...context,
      nodes: [],
      targets: [alphaNode],
      targetSnapshots: [{ nodeId: alphaNode.id, snapshotToken: snapshot.snapshotToken }],
      occurrences: [{ sourceFilePath: 'sample.ts', targetId: alphaNode.id, line: 1, column: 0, evidence: 'alpha' }],
    });
    reader.incoming = async () => ({
      ok: true,
      occurrences: Array.from({ length: 5_000 }, () => ({
        sourceFilePath: 'sample.ts', targetId: alphaNode.id, line: 1, column: 0, evidence: 'alpha',
      })),
      sourceSnapshots: [{ filePath: 'sample.ts', snapshotToken: snapshot.snapshotToken }],
    });
    reader.sourceSnapshot = async () => context;
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));

    const response = await facade.handle(request(2, 'textDocument/references', {
      ...positionParams(uri, 0, 2),
      context: { includeDeclaration: false },
    })) as any;
    expect(response.result).toHaveLength(1);
    expect(textReads).toBe(1);
  });

  it('fails a reference snapshot transaction once per path across high-cardinality candidates', async () => {
    const reader = fakeReader();
    reader.incoming = async () => ({
      ok: true,
      occurrences: Array.from({ length: 5_000 }, () => ({
        sourceFilePath: 'missing-references.ts', targetId: alphaNode.id, line: 1, column: 0, evidence: 'alpha',
      })),
      sourceSnapshots: [{ filePath: 'missing-references.ts', snapshotToken: 'missing' }],
    });
    reader.workspaceSymbols = async () => Array.from(
      { length: 1_000 },
      () => workspaceCandidate({ ...alphaNode, filePath: 'missing-symbols.ts' }),
    );
    const sourceSnapshot = vi.fn(async (): Promise<LspSourceSnapshotRead> => ({ ok: false, reason: 'not_found' }));
    reader.sourceSnapshot = sourceSnapshot;
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'textDocument/references', {
      ...positionParams(uri, 1, 2),
      context: { includeDeclaration: false },
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.ContentModified } });
    expect(sourceSnapshot).toHaveBeenCalledTimes(1);
    expect(sourceSnapshot).toHaveBeenLastCalledWith('missing-references.ts', expect.any(AbortSignal));

    sourceSnapshot.mockResolvedValueOnce({ ok: false, reason: 'unreadable' });
    expect(await facade.handle(request(3, 'textDocument/references', {
      ...positionParams(uri, 1, 2),
      context: { includeDeclaration: false },
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.RequestFailed, data: { reason: 'unreadable' } } });
    expect(sourceSnapshot).toHaveBeenCalledTimes(2);

    expect(await facade.handle(request(4, 'workspace/symbol', { query: 'missing' })))
      .toMatchObject({ result: [] });
    expect(sourceSnapshot).toHaveBeenCalledTimes(3);
    expect(sourceSnapshot).toHaveBeenLastCalledWith('missing-symbols.ts', expect.any(AbortSignal));
  });

  it('uses one evidence-selected column encoding for a node range and still fails closed on ties', async () => {
    const reader = fakeReader();
    reader.workspaceSymbols = async () => [workspaceCandidate({ ...alphaNode, startColumn: 99 })];
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));
    expect(await facade.handle(request(2, 'workspace/symbol', { query: 'alpha' })))
      .toMatchObject({ result: [] });

    const unicodeNode = {
      ...alphaNode,
      startLine: 1,
      endLine: 1,
      startColumn: 2,
      endColumn: 7,
    };
    reader.documentContext = async () => ({
      ...alphaDocumentContext,
      snapshot: { ...alphaDocumentContext.snapshot, text: 'éalpha\n' },
      nodes: [unicodeNode],
    });
    expect(await facade.handle(request(3, 'textDocument/documentSymbol', {
      textDocument: { uri: pathToFileURL(`${process.cwd()}/sample.ts`).href },
    }))).toMatchObject({
      result: [{
        name: 'alpha',
        range: { start: { line: 0, character: 1 }, end: { line: 0, character: 6 } },
        selectionRange: { start: { line: 0, character: 1 }, end: { line: 0, character: 6 } },
      }],
    });

    const ambiguousNode = {
      ...unicodeNode,
      id: 'ambiguous-text',
      name: 'aaaa',
      qualifiedName: 'sample.aaaa',
      endColumn: 6,
    };
    reader.documentContext = async () => ({
      ...alphaDocumentContext,
      snapshot: { ...alphaDocumentContext.snapshot, text: 'éaaaaa\n' },
      nodes: [ambiguousNode],
    });
    expect(await facade.handle(request(4, 'textDocument/documentSymbol', {
      textDocument: { uri: pathToFileURL(`${process.cwd()}/sample.ts`).href },
    }))).toMatchObject({ result: [] });
  });

  it('fails closed when distinct column decodings both have positive name evidence', async () => {
    const mixedEvidenceNode = {
      ...alphaNode,
      id: 'mixed-column-evidence',
      name: 'foo',
      qualifiedName: 'sample.foo',
      startLine: 1,
      endLine: 1,
      startColumn: 2,
      endColumn: 6,
    };
    const reader = fakeReader();
    reader.documentContext = async () => ({
      ...alphaDocumentContext,
      snapshot: { ...alphaDocumentContext.snapshot, text: 'é@foo(\n' },
      nodes: [mixedEvidenceNode],
    });
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'textDocument/documentSymbol', {
      textDocument: { uri: pathToFileURL(`${process.cwd()}/sample.ts`).href },
    }))).toMatchObject({ result: [] });
  });

  it('rejects a lone in-bounds node range without exact name evidence', async () => {
    const reader = fakeReader();
    const unsupportedRange = {
      ...alphaNode,
      id: 'unsupported-range',
      name: 'missing',
      qualifiedName: 'sample.missing',
      startColumn: 0,
      endColumn: 5,
    };
    reader.workspaceSymbols = async () => [workspaceCandidate(unsupportedRange)];
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'workspace/symbol', { query: 'missing' })))
      .toMatchObject({ result: [] });
  });

  it('selects exact occurrence and declaration-name evidence but rejects unrelated tokens', async () => {
    const reader = fakeReader();
    const exactText = 'class Outer {\n  alpha();\n}\n';
    const outer = {
      ...alphaNode,
      id: 'outer',
      kind: 'class' as const,
      name: 'Outer',
      qualifiedName: 'sample.Outer',
      startLine: 1,
      endLine: 3,
      startColumn: 0,
      endColumn: 1,
    };
    reader.positionContext = async () => ({
      ok: true,
      snapshot: { ...alphaSnapshot.snapshot, text: exactText },
      nodes: [outer],
      targets: [alphaNode],
      targetSnapshots: [{ nodeId: alphaNode.id, snapshotToken: alphaSnapshot.snapshot.snapshotToken }],
      occurrences: [{ sourceFilePath: 'sample.ts', targetId: alphaNode.id, line: 2, column: 2, evidence: 'alpha' }],
    });
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'textDocument/hover', positionParams(uri, 1, 4))))
      .toMatchObject({ result: { contents: { value: expect.stringContaining('sample.alpha') } } });

    const fallbackText = 'class Outer {\n  function inner() {}\n}\n';
    const inner = {
      ...alphaNode,
      id: 'inner',
      name: 'inner',
      qualifiedName: 'sample.Outer.inner',
      startLine: 2,
      endLine: 2,
      startColumn: 2,
      endColumn: 21,
    };
    reader.positionContext = async () => ({
      ok: true,
      snapshot: { ...alphaSnapshot.snapshot, text: fallbackText },
      nodes: [outer, inner],
      targets: [],
      targetSnapshots: [],
      occurrences: [],
    });

    expect(await facade.handle(request(3, 'textDocument/hover', positionParams(uri, 1, 4))))
      .toMatchObject({ result: null });
    expect(await facade.handle(request(4, 'textDocument/hover', positionParams(uri, 1, 12))))
      .toMatchObject({ result: { contents: { value: expect.stringContaining('sample.Outer.inner') } } });
  });

  it('uses persisted alias and qualified spellings for definition and references', async () => {
    const referenceFilePath = 'references.ts';
    const referenceSnapshot = {
      ok: true as const,
      snapshot: {
        ...alphaSnapshot.snapshot,
        filePath: referenceFilePath,
        text: 'beta();\nnamespace.alpha();\n',
        contentHash: 'references-hash',
        snapshotToken: 'references-snapshot',
      },
    };
    const occurrences = [
      {
        sourceFilePath: referenceFilePath,
        targetId: alphaNode.id,
        line: 1,
        column: 0,
        evidence: 'beta',
      },
      {
        sourceFilePath: referenceFilePath,
        targetId: alphaNode.id,
        line: 2,
        column: 0,
        evidence: 'namespace.alpha',
      },
    ];
    const reader = fakeReader();
    reader.positionContext = async () => ({
      ...referenceSnapshot,
      nodes: [],
      targets: [alphaNode],
      targetSnapshots: [{ nodeId: alphaNode.id, snapshotToken: alphaSnapshot.snapshot.snapshotToken }],
      occurrences,
    });
    reader.incoming = async () => ({
      ok: true,
      occurrences,
      sourceSnapshots: [{ filePath: referenceFilePath, snapshotToken: referenceSnapshot.snapshot.snapshotToken }],
    });
    reader.sourceSnapshot = async (filePath) => filePath === referenceFilePath
      ? referenceSnapshot
      : alphaSnapshot;
    const facade = new LspFacade(reader);
    const referenceUri = pathToFileURL(`${process.cwd()}/${referenceFilePath}`).href;
    const declarationUri = pathToFileURL(`${process.cwd()}/${alphaNode.filePath}`).href;
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'textDocument/definition', positionParams(referenceUri, 0, 2))))
      .toMatchObject({ result: { uri: declarationUri } });
    expect(await facade.handle(request(3, 'textDocument/definition', positionParams(referenceUri, 1, 12))))
      .toMatchObject({ result: { uri: declarationUri } });
    expect(await facade.handle(request(4, 'textDocument/references', {
      ...positionParams(referenceUri, 0, 2),
      context: { includeDeclaration: false },
    }))).toMatchObject({
      result: [
        {
          uri: referenceUri,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        },
        {
          uri: referenceUri,
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 15 } },
        },
      ],
    });
  });

  it('rejects workspace nodes whose graph snapshot does not match verified source', async () => {
    const reader = fakeReader();
    reader.workspaceSymbols = async () => [workspaceCandidate(alphaNode, 'older-graph-snapshot')];
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));
    expect(await facade.handle(request(2, 'workspace/symbol', { query: 'alpha' })))
      .toMatchObject({ result: [] });
  });

  it('rejects an unrelated token inside a multi-line declaration range', async () => {
    const node = { ...alphaNode, startColumn: 0, endLine: 3, endColumn: 1 };
    const snapshot: Extract<LspSourceSnapshotRead, { ok: true }> = {
      ...alphaSnapshot,
      snapshot: {
        ...alphaSnapshot.snapshot,
        text: 'export function alpha() {\n  return 1;\n}\n',
      },
    };
    const reader = fakeReader();
    reader.positionContext = async () => ({
      ...snapshot,
      nodes: [node],
      targets: [],
      targetSnapshots: [],
      occurrences: [],
    });
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));
    expect(await facade.handle(request(2, 'textDocument/hover', positionParams(uri, 1, 2))))
      .toMatchObject({ result: null });
  });

  it('uses the LSP namespace, field, and struct symbol kinds', async () => {
    const nodes: Node[] = [
      { ...alphaNode, id: 'namespace', kind: 'namespace', name: 'Namespace', qualifiedName: 'Namespace', startLine: 1, endLine: 1, startColumn: 0, endColumn: 9 },
      { ...alphaNode, id: 'field', kind: 'field', name: 'field', qualifiedName: 'field', startLine: 2, endLine: 2, startColumn: 0, endColumn: 5 },
      { ...alphaNode, id: 'struct', kind: 'struct', name: 'Struct', qualifiedName: 'Struct', startLine: 3, endLine: 3, startColumn: 0, endColumn: 6 },
    ];
    const reader = fakeReader();
    reader.workspaceSymbols = async () => nodes.map((node) => workspaceCandidate(node));
    reader.sourceSnapshot = async () => ({
      ...alphaSnapshot,
      snapshot: { ...alphaSnapshot.snapshot, text: 'Namespace\nfield\nStruct\n' },
    });
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));
    expect(await facade.handle(request(2, 'workspace/symbol', { query: '' }))).toMatchObject({
      result: [{ kind: 3 }, { kind: 23 }, { kind: 8 }],
    });
  });

  it('breaks cyclic containment deterministically without dropping the symbols', async () => {
    const first = { ...alphaNode, id: 'first', name: 'first', qualifiedName: 'sample.first', startLine: 1, endLine: 2, startColumn: 0, endColumn: 5 };
    const second = { ...alphaNode, id: 'second', name: 'second', qualifiedName: 'sample.second', startLine: 2, endLine: 2, startColumn: 0, endColumn: 6 };
    const reader = fakeReader();
    reader.documentContext = async () => ({
      ...alphaDocumentContext,
      snapshot: { ...alphaDocumentContext.snapshot, text: 'first\nsecond\n' },
      nodes: [first, second],
      containment: [
        { source: first.id, target: second.id, kind: 'contains' },
        { source: second.id, target: first.id, kind: 'contains' },
      ],
    });
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));

    const response = await facade.handle(request(2, 'textDocument/documentSymbol', {
      textDocument: { uri: pathToFileURL(`${process.cwd()}/sample.ts`).href },
    })) as any;

    expect(response.result).toMatchObject([{ name: 'first', children: [{ name: 'second' }] }]);
  });

  it('caps document symbols after validation without orphaning a boundary child', async () => {
    const standalone: Node[] = Array.from({ length: 499 }, (_value, index) => {
      const name = `symbol${String(index).padStart(3, '0')}`;
      return {
        ...alphaNode,
        id: name,
        name,
        qualifiedName: `sample.${name}`,
        startLine: index + 1,
        endLine: index + 1,
        startColumn: 0,
        endColumn: name.length,
      };
    });
    const child = {
      ...alphaNode,
      id: 'boundary-child',
      name: 'child',
      qualifiedName: 'sample.parent.child',
      startLine: 500,
      endLine: 500,
      startColumn: 0,
      endColumn: 5,
    };
    const parent = {
      ...alphaNode,
      id: 'boundary-parent',
      name: 'parent',
      qualifiedName: 'sample.parent',
      startLine: 501,
      endLine: 501,
      startColumn: 0,
      endColumn: 6,
    };
    const invalid = { ...alphaNode, id: 'invalid', name: 'invalid', startLine: 1, endLine: 1, startColumn: 99 };
    const lines = [
      ...standalone.map((node) => node.name),
      child.name,
      parent.name,
    ];
    const reader = fakeReader();
    reader.documentContext = async () => ({
      ...alphaDocumentContext,
      snapshot: { ...alphaDocumentContext.snapshot, text: `${lines.join('\n')}\n` },
      nodes: [invalid, ...standalone, child, parent],
      containment: [{ source: parent.id, target: child.id, kind: 'contains' }],
    });
    const facade = new LspFacade(reader);
    await facade.handle(request(1, 'initialize', {}));
    const response = await facade.handle(request(2, 'textDocument/documentSymbol', {
      textDocument: { uri: pathToFileURL(`${process.cwd()}/sample.ts`).href },
    })) as any;

    expect(response.result).toHaveLength(500);
    expect(response.result.some((symbol: any) => symbol.name === 'parent')).toBe(true);
    expect(response.result.some((symbol: any) => symbol.name === 'child')).toBe(false);
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

  it('rejects malformed reference context before repository reads', async () => {
    let reads = 0;
    const facade = new LspFacade(fakeReader(() => { reads++; }));
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));

    expect(await facade.handle(request(2, 'textDocument/references', positionParams(uri, 1, 2))))
      .toMatchObject({ error: { code: LSP_ERROR_CODE.InvalidParams } });
    expect(await facade.handle(request(3, 'textDocument/references', {
      ...positionParams(uri, 1, 2),
      context: { includeDeclaration: 'yes' },
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.InvalidParams } });
    expect(await facade.handle(request(4, 'textDocument/hover', positionParams(uri, 2_147_483_648, 0))))
      .toMatchObject({ error: { code: LSP_ERROR_CODE.InvalidParams } });
    expect(await facade.handle(request(5, 'textDocument/hover', positionParams(uri, 0, 2_147_483_648))))
      .toMatchObject({ error: { code: LSP_ERROR_CODE.InvalidParams } });
    expect(reads).toBe(0);
  });

  it('distinguishes malformed document URIs from valid paths outside the bound repository', async () => {
    const facade = new LspFacade(fakeReader());
    await facade.handle(request(1, 'initialize', {}));
    expect(await facade.handle(request(2, 'codegraph/textDocumentContent', {
      textDocument: { uri: pathToFileURL('/definitely/outside/repository.ts').href },
    }))).toMatchObject({
      error: { code: LSP_ERROR_CODE.RequestFailed, data: { reason: 'outside_repository' } },
    });
    expect(await facade.handle(request(3, 'codegraph/textDocumentContent', {
      textDocument: { uri: 'https://example.invalid/source.ts' },
    }))).toMatchObject({ error: { code: LSP_ERROR_CODE.InvalidParams } });
  });

  it('maps bounded incoming-read failures to closed source errors', async () => {
    const reader: LspRepositoryReader = {
      ...fakeReader(),
      async incoming() { return { ok: false, reason: 'too_large' }; },
    };
    const facade = new LspFacade(reader);
    const uri = pathToFileURL(`${process.cwd()}/sample.ts`).href;
    await facade.handle(request(1, 'initialize', {}));
    expect(await facade.handle(request(2, 'textDocument/references', {
      ...positionParams(uri, 1, 2),
      context: { includeDeclaration: false },
    })))
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

const alphaSnapshot: Extract<LspSourceSnapshotRead, { ok: true }> = {
  ok: true,
  snapshot: {
    filePath: 'sample.ts',
    text: 'export function alpha() {}\nalpha();\n',
    languageId: 'typescript',
    contentHash: 'hash',
    snapshotToken: 'snapshot',
  },
};

const alphaPositionContext: Extract<LspPositionContextRead, { ok: true }> = {
  ...alphaSnapshot,
  nodes: [alphaNode],
  targets: [alphaNode],
  targetSnapshots: [{ nodeId: alphaNode.id, snapshotToken: alphaSnapshot.snapshot.snapshotToken }],
  occurrences: [{
    sourceFilePath: alphaNode.filePath,
    targetId: alphaNode.id,
    line: 2,
    column: 0,
    evidence: 'alpha',
  }],
};

const alphaDocumentContext: Extract<LspDocumentContextRead, { ok: true }> = {
  ...alphaSnapshot,
  nodes: [alphaNode],
  containment: [],
};

function fakeReader(onRead: () => void = () => undefined): LspRepositoryReader {
  return {
    root: process.cwd(),
    async sourceSnapshot() { onRead(); return alphaSnapshot; },
    async positionContext() { onRead(); return alphaPositionContext; },
    async documentContext() { onRead(); return alphaDocumentContext; },
    async incoming() {
      onRead();
      return {
        ok: true,
        occurrences: alphaPositionContext.occurrences,
        sourceSnapshots: [{ filePath: alphaNode.filePath, snapshotToken: alphaSnapshot.snapshot.snapshotToken }],
      };
    },
    async nodeLocation() { onRead(); return { ok: true, ...workspaceCandidate(alphaNode) }; },
    async workspaceSymbols() { onRead(); return [workspaceCandidate(alphaNode)]; },
  };
}

function workspaceCandidate(
  node: Node,
  snapshotToken = alphaSnapshot.snapshot.snapshotToken,
  searchScore = 0,
): LspWorkspaceSymbolCandidate {
  return { node, snapshotToken, searchScore };
}

function request(id: number, method: string, params?: object) {
  return { jsonrpc: '2.0' as const, id, method, ...(params === undefined ? {} : { params }) };
}

function positionParams(uri: string, line: number, character: number, snapshotToken?: string) {
  return {
    textDocument: { uri },
    position: { line, character },
    ...(snapshotToken === undefined ? {} : { snapshotToken }),
  };
}
