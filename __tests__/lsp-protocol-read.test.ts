import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import CodeGraph from '../src/index';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';
import {
  executeReadOp,
  readTrustedSnapshot,
  type LspIncomingRead,
  type LspWorkspaceSymbolCandidate,
} from '../src/mcp/read-ops';
import type { QueryBuilder } from '../src/db/queries';
import {
  LSP_ERROR_CODE,
  LSP_SERVER_CAPABILITIES,
  clampUtf16Character,
  dedupeSortAndCap,
  formatLspDiagnostic,
  makeJsonRpcError,
  normalizeLspUri,
  parseJsonRpcEnvelope,
  resolveExactUtf16Range,
  sortAndCapLocations,
  type LspLocation,
} from '../src/lsp/protocol';
import type { Node } from '../src/types';

describe('LSP server protocol helpers', () => {
  it('accepts only JSON-RPC 2.0 request and notification envelopes', () => {
    expect(parseJsonRpcEnvelope({ jsonrpc: '2.0', id: 7, method: 'initialize', params: {} })).toEqual({
      ok: true,
      message: { jsonrpc: '2.0', id: 7, method: 'initialize', params: {} },
    });
    expect(parseJsonRpcEnvelope({ jsonrpc: '2.0', method: 'initialized' })).toEqual({
      ok: true,
      message: { jsonrpc: '2.0', method: 'initialized' },
    });
    expect(parseJsonRpcEnvelope([{ jsonrpc: '2.0', id: 1, method: 'initialize' }])).toEqual({
      ok: false, id: null, error: { code: LSP_ERROR_CODE.InvalidRequest, message: 'Invalid Request' },
    });
    expect(parseJsonRpcEnvelope({ jsonrpc: '1.0', id: 8, method: 'initialize' })).toEqual({
      ok: false, id: 8, error: { code: LSP_ERROR_CODE.InvalidRequest, message: 'Invalid Request' },
    });
    expect(parseJsonRpcEnvelope({ jsonrpc: '2.0', id: true, method: 'initialize' })).toEqual({
      ok: false, id: null, error: { code: LSP_ERROR_CODE.InvalidRequest, message: 'Invalid Request' },
    });
    expect(parseJsonRpcEnvelope({ jsonrpc: '2.0', id: 9, method: '' })).toEqual({
      ok: false, id: 9, error: { code: LSP_ERROR_CODE.InvalidRequest, message: 'Invalid Request' },
    });
  });

  it('advertises only the read-only capability surface', () => {
    expect(LSP_SERVER_CAPABILITIES).toEqual({
      positionEncoding: 'utf-16',
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      experimental: { codegraphTextDocumentContent: { method: 'codegraph/textDocumentContent', version: 1 } },
    });
  });

  it('constructs closed, redaction-safe JSON-RPC errors', () => {
    const error = makeJsonRpcError(11, LSP_ERROR_CODE.RequestFailed, 'unreadable');
    expect(error).toEqual({
      jsonrpc: '2.0',
      id: 11,
      error: { code: LSP_ERROR_CODE.RequestFailed, message: 'Request failed', data: { reason: 'unreadable' } },
    });
    expect(JSON.stringify(error)).not.toContain('/private/secret/repository');
    expect(makeJsonRpcError(null, LSP_ERROR_CODE.ServerNotInitialized)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: LSP_ERROR_CODE.ServerNotInitialized, message: 'Server not initialized' },
    });
  });

  it('formats only closed diagnostic codes without accepting arbitrary details', () => {
    expect(formatLspDiagnostic('invalid_frame')).toBe('[codegraph:lsp] invalid_frame');
    expect(formatLspDiagnostic('internal_failure')).toBe('[codegraph:lsp] internal_failure');
  });

  it('clamps incoming character positions in UTF-16 code units', () => {
    const line = 'a😀z';
    expect(clampUtf16Character(line, 0)).toBe(0);
    expect(clampUtf16Character(line, 2)).toBe(2);
    expect(clampUtf16Character(line, 99)).toBe(4);
  });

  it('maps UTF-8-byte or UTF-16 graph columns only with exact token evidence', () => {
    expect(resolveExactUtf16Range('😀alpha', 4, 'alpha')).toEqual({ start: 2, end: 7 });
    expect(resolveExactUtf16Range('éalpha', 1, 'alpha')).toEqual({ start: 1, end: 6 });
    expect(resolveExactUtf16Range('éalpha', 2, 'alpha')).toEqual({ start: 1, end: 6 });
    expect(resolveExactUtf16Range('éalpha', 2, 'wrong')).toBeNull();
  });

  it('rejects mixed-column mappings when two distinct positions match', () => {
    expect(resolveExactUtf16Range('éaa', 2, 'a')).toBeNull();
  });

  it('sorts, deduplicates, and caps locations after the full stable ordering', () => {
    const locations: LspLocation[] = [
      location('file:///repo/b.ts', 3, 0),
      location('file:///repo/a.ts', 4, 1),
      location('file:///repo/a.ts', 1, 2),
      location('file:///repo/a.ts', 1, 2),
    ];
    expect(sortAndCapLocations(locations, 2)).toEqual([
      location('file:///repo/a.ts', 1, 2),
      location('file:///repo/a.ts', 4, 1),
    ]);
  });

  it('provides a reusable stable dedupe-and-cap primitive', () => {
    const values = [
      { id: 'b', score: 2 }, { id: 'a', score: 1 }, { id: 'a', score: 3 }, { id: 'c', score: 0 },
    ];
    expect(dedupeSortAndCap(values, (value) => value.id, (left, right) => left.id.localeCompare(right.id), 2)).toEqual([
      { id: 'a', score: 1 }, { id: 'b', score: 2 },
    ]);
  });
});

describe('trusted daemon LSP reads', () => {
  const roots: string[] = [];

  beforeAll(async () => {
    await initGrammars();
    await loadAllGrammars();
  });

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns only a hash-matching indexed snapshot and fails closed after drift', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-read-'));
    roots.push(parent);
    const root = path.join(parent, 'repo');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 1; }\n');
    fs.writeFileSync(path.join(parent, 'outside.ts'), 'export const secret = 1;\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const transaction = vi.spyOn(cg, 'withLspReadTransaction');
      const current = await executeReadOp(cg, 'lspFileContext', { filePath: 'sample.ts' });
      expect(current).toMatchObject({ ok: true, snapshot: { filePath: 'sample.ts', languageId: 'typescript' } });
      expect((current as any).snapshot.text).toContain('function alpha');
      expect((current as any).nodes.some((node: Node) => node.name === 'alpha')).toBe(true);
      expect(transaction).toHaveBeenCalledOnce();
      expect(await executeReadOp(cg, 'lspFileContext', { filePath: '../outside.ts' }))
        .toEqual({ ok: false, reason: 'outside_repository' });
      expect(await executeReadOp(cg, 'lspFileContext', { filePath: '../missing.ts' }))
        .toEqual({ ok: false, reason: 'outside_repository' });
      if (process.platform !== 'win32') {
        fs.symlinkSync('../outside.ts', path.join(root, 'escape-existing.ts'));
        fs.symlinkSync('../missing.ts', path.join(root, 'escape-missing.ts'));
        expect(await executeReadOp(cg, 'lspFileContext', { filePath: 'escape-existing.ts' }))
          .toEqual({ ok: false, reason: 'outside_repository' });
        expect(await executeReadOp(cg, 'lspFileContext', { filePath: 'escape-missing.ts' }))
          .toEqual({ ok: false, reason: 'outside_repository' });
      }

      fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 2; }\n');
      expect(await executeReadOp(cg, 'lspFileContext', { filePath: 'sample.ts' }))
        .toEqual({ ok: false, reason: 'stale' });
    } finally {
      cg.close();
    }
  });

  it.runIf(process.platform !== 'win32')('rejects a FIFO source replacement without blocking', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-fifo-'));
    roots.push(root);
    const candidate = path.join(root, 'sample.ts');
    fs.writeFileSync(candidate, 'export const version = 1;\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      fs.unlinkSync(candidate);
      execFileSync('mkfifo', [candidate]);
      const startedAt = Date.now();
      expect(readTrustedSnapshot(cg, 'sample.ts')).toEqual({ ok: false, reason: 'not_regular' });
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      cg.close();
    }
  });

  it.runIf(process.platform !== 'win32')('rejects a path atomically replaced after its descriptor is read', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-replace-'));
    roots.push(root);
    const candidate = path.join(root, 'sample.ts');
    const replacement = path.join(root, 'replacement.ts');
    fs.writeFileSync(candidate, 'export const version = 1;\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      fs.writeFileSync(replacement, 'export const version = 2;\n');
      expect(readTrustedSnapshot(cg, 'sample.ts', () => fs.renameSync(replacement, candidate)))
        .toEqual({ ok: false, reason: 'stale' });
    } finally {
      cg.close();
    }
  });

  it('rejects an equal-length in-place rewrite after its descriptor is read', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-rewrite-'));
    roots.push(root);
    const candidate = path.join(root, 'sample.ts');
    fs.writeFileSync(candidate, 'export const version = 1;\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      expect(readTrustedSnapshot(cg, 'sample.ts', () => {
        fs.writeFileSync(candidate, 'export const version = 2;\n');
      })).toEqual({ ok: false, reason: 'stale' });
    } finally {
      cg.close();
    }
  });

  it('classifies invalid UTF-8 as unreadable before checking index freshness', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-utf8-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'sample.ts'), Buffer.from([0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20, 0xff]));
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      expect(cg.getFile('sample.ts')).toBeDefined();
      await expect(executeReadOp(cg, 'lspFileContext', { filePath: 'sample.ts' }))
        .resolves.toEqual({ ok: false, reason: 'unreadable' });
    } finally {
      cg.close();
    }
  });

  it('excludes heuristic edges from exact file and incoming occurrences', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-heuristic-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 1; }\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const alpha = cg.getNodesInFile('sample.ts').find((node) => node.name === 'alpha')!;
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      queries.insertEdge({
        source: alpha.id,
        target: alpha.id,
        kind: 'references',
        line: 1,
        column: 99,
        provenance: 'heuristic',
        metadata: { synthesizedBy: 'test', registeredAt: 'test' },
      });

      const context = await executeReadOp(cg, 'lspFileContext', { filePath: 'sample.ts' }) as any;
      const incoming = await executeReadOp(cg, 'lspIncoming', {
        id: alpha.id,
        filePath: 'sample.ts',
        snapshotToken: context.snapshot.snapshotToken,
      }) as any;

      expect(context.occurrences.every((entry: any) => entry.edge.provenance !== 'heuristic')).toBe(true);
      expect(incoming.occurrences.every((entry: any) => entry.edge.provenance !== 'heuristic')).toBe(true);
      expect(incoming.occurrences.every((entry: any) =>
        entry.sourceSnapshotToken === context.snapshot.snapshotToken
        && entry.targetSnapshotToken === context.snapshot.snapshotToken,
      )).toBe(true);
      await expect(executeReadOp(cg, 'lspIncoming', {
        id: alpha.id,
        filePath: 'sample.ts',
        snapshotToken: 'stale-token',
      })).resolves.toEqual({ ok: false, reason: 'stale' });
    } finally {
      cg.close();
    }
  });

  it('bypasses stale node-cache entries inside composite SQLite reads', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-cache-'));
    roots.push(root);
    fs.writeFileSync(
      path.join(root, 'sample.ts'),
      'export function alpha() { return beta(); }\nexport function beta() { return 1; }\n',
    );
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    let writer: CodeGraph | undefined;
    try {
      await cg.indexAll();
      const nodes = cg.getNodesInFile('sample.ts');
      const alpha = nodes.find((node) => node.name === 'alpha')!;
      const beta = nodes.find((node) => node.name === 'beta')!;
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      queries.insertEdge({
        source: alpha.id,
        target: beta.id,
        kind: 'calls',
        line: 1,
        column: 33,
        provenance: 'lsp',
      });
      expect(cg.getNode(beta.id)?.docstring).toBeUndefined();

      writer = CodeGraph.openSync(root);
      const writerQueries = (writer as unknown as { queries: QueryBuilder }).queries;
      writerQueries.updateNode({ ...beta, docstring: 'fresh writer value' });

      const context = await executeReadOp(cg, 'lspFileContext', { filePath: 'sample.ts' });
      expect(context.ok).toBe(true);
      if (context.ok) {
        const occurrence = context.occurrences.find((entry) => entry.target.id === beta.id);
        expect(occurrence?.target.docstring).toBe('fresh writer value');
      }
    } finally {
      writer?.close();
      cg.close();
    }
  });

  it('preserves workspace substring and fuzzy search fallbacks with projected nodes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-workspace-search-'));
    roots.push(root);
    fs.writeFileSync(
      path.join(root, 'sample.ts'),
      'export function camelCaseNeedle() {}\nexport function approximateName() {}\n',
    );
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const substring = await executeReadOp(
        cg,
        'lspWorkspaceSymbols',
        { query: 'CaseNeedle' },
      ) as LspWorkspaceSymbolCandidate[];
      const fuzzy = await executeReadOp(
        cg,
        'lspWorkspaceSymbols',
        { query: 'aproximateName' },
      ) as LspWorkspaceSymbolCandidate[];
      expect(substring.map(({ node }) => node.name)).toContain('camelCaseNeedle');
      expect(fuzzy.map(({ node }) => node.name)).toContain('approximateName');
      expect([...substring, ...fuzzy].every(({ node }) => node.docstring === undefined)).toBe(true);
      expect([...substring, ...fuzzy].every(({ snapshotToken }) => snapshotToken.length > 0)).toBe(true);
    } finally {
      cg.close();
    }
  });

  it('bounds workspace and incoming read materialization at the daemon boundary', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-bounds-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 1; }\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const alpha = cg.getNodesInFile('sample.ts').find((node) => node.name === 'alpha')!;
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      const sources = Array.from({ length: 600 }, (_value, index): Node => ({
        ...alpha,
        id: `bounded-source-${index}`,
        name: `source${String(index).padStart(3, '0')}`,
        qualifiedName: `source${String(index).padStart(3, '0')}`,
        startLine: index + 2,
        endLine: index + 2,
      }));
      queries.insertNodes(sources);
      queries.insertEdges(sources.map((source, index) => ({
        source: source.id,
        target: alpha.id,
        kind: 'references' as const,
        line: index + 2,
        column: 0,
        provenance: 'lsp' as const,
      })).concat({
        source: sources[0]!.id,
        target: alpha.id,
        kind: 'calls' as const,
        line: 2,
        column: 0,
        provenance: 'lsp' as const,
      }));

      const workspace = await executeReadOp(
        cg,
        'lspWorkspaceSymbols',
        {},
      ) as LspWorkspaceSymbolCandidate[];
      const context = await executeReadOp(cg, 'lspFileContext', { filePath: 'sample.ts' });
      expect(context.ok).toBe(true);
      if (!context.ok) throw new Error('expected indexed sample context');
      const incoming = await executeReadOp(cg, 'lspIncoming', {
        id: alpha.id,
        filePath: 'sample.ts',
        snapshotToken: context.snapshot.snapshotToken,
      }) as LspIncomingRead;
      expect(workspace).toHaveLength(500);
      expect('occurrences' in incoming).toBe(true);
      if ('occurrences' in incoming) {
        expect(incoming.occurrences).toHaveLength(500);
        expect(incoming.occurrences[0]?.edge.line).toBe(2);
        expect(incoming.occurrences.at(-1)?.edge.line).toBe(501);
      }

      const tied = Array.from({ length: 2_601 }, (_value, index): Node => ({
        ...alpha,
        id: `tied-workspace-${index}`,
        name: 'tiedWorkspaceTarget',
        qualifiedName: 'tied::same',
        filePath: index % 2 === 0
          ? `ties/a ${String(index).padStart(4, '0')}.ts`
          : `ties/a$${String(index).padStart(4, '0')}.ts`,
        startLine: 1,
        endLine: 1,
      }));
      queries.insertNodes(tied);
      for (const node of tied) {
        queries.upsertFile({
          path: node.filePath,
          contentHash: `hash-${node.id}`,
          language: 'typescript',
          size: 1,
          modifiedAt: 1,
          indexedAt: 1,
          nodeCount: 1,
        });
      }
      const tiedWorkspace = await executeReadOp(cg, 'lspWorkspaceSymbols', {
        query: 'tiedWorkspaceTarget',
      }) as LspWorkspaceSymbolCandidate[];
      expect(tiedWorkspace).toHaveLength(500);
      const byFinalLspOrder = [...tied].sort((left, right) => {
        const leftUri = normalizeLspUri(pathToFileURL(path.resolve(root, left.filePath)).href);
        const rightUri = normalizeLspUri(pathToFileURL(path.resolve(root, right.filePath)).href);
        return (leftUri < rightUri ? -1 : leftUri > rightUri ? 1 : 0)
          || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      });
      expect(tiedWorkspace.map(({ node }) => node.id)).toEqual(
        byFinalLspOrder.slice(0, 500).map((node) => node.id),
      );

      const oversizedWorkspaceNodes = Array.from({ length: 600 }, (_value, index): Node => ({
        ...alpha,
        id: `oversized-workspace-${index}`,
        name: 'oversizedWorkspaceTarget',
        qualifiedName: `oversized::${String(index).padStart(3, '0')}`,
        filePath: `oversized/${index}.ts`,
        docstring: 'x'.repeat(16 * 1024),
      }));
      queries.insertNodes(oversizedWorkspaceNodes);
      for (const node of oversizedWorkspaceNodes) {
        queries.upsertFile({
          path: node.filePath,
          contentHash: `hash-${node.id}`,
          language: 'typescript',
          size: 1,
          modifiedAt: 1,
          indexedAt: 1,
          nodeCount: 1,
        });
      }
      const genericSearch = vi.spyOn(cg, 'searchNodes');
      const oversizedWorkspace = await executeReadOp(cg, 'lspWorkspaceSymbols', {
        query: 'oversizedWorkspaceTarget',
      }) as LspWorkspaceSymbolCandidate[];
      expect(oversizedWorkspace).toHaveLength(500);
      expect(oversizedWorkspace.every(({ node }) => node.docstring === undefined)).toBe(true);
      expect(genericSearch).not.toHaveBeenCalled();
      genericSearch.mockRestore();

      queries.updateNode({
        ...alpha,
        docstring: 'x'.repeat(16 * 1024),
      });
      const materialization = vi.spyOn(cg, 'getLspNodesByIds');
      await expect(executeReadOp(cg, 'lspIncoming', {
        id: alpha.id,
        filePath: 'sample.ts',
        snapshotToken: context.snapshot.snapshotToken,
      }))
        .resolves.toEqual({ ok: false, reason: 'too_large' });
      await expect(executeReadOp(cg, 'lspFileContext', { filePath: 'sample.ts' }))
        .resolves.toEqual({ ok: false, reason: 'too_large' });
      expect(materialization).not.toHaveBeenCalled();
      materialization.mockRestore();

      queries.updateNode({
        ...alpha,
        docstring: 'x'.repeat(7 * 1024 * 1024),
      });
      await expect(executeReadOp(cg, 'lspFileContext', { filePath: 'sample.ts' }))
        .resolves.toEqual({ ok: false, reason: 'too_large' });

      queries.insertEdges(Array.from({ length: 5_001 }, (_value, index) => ({
        source: alpha.id,
        target: alpha.id,
        kind: 'references' as const,
        line: index + 10_000,
        column: 0,
        provenance: 'lsp' as const,
      })));
      await expect(executeReadOp(cg, 'lspIncoming', {
        id: alpha.id,
        filePath: 'sample.ts',
        snapshotToken: context.snapshot.snapshotToken,
      }))
        .resolves.toEqual({ ok: false, reason: 'too_large' });

      queries.insertNodes(Array.from({ length: 5_001 }, (_value, index) => ({
        ...alpha,
        id: `overflow-${index}`,
        name: `overflow${index}`,
        qualifiedName: `overflow${index}`,
        docstring: undefined,
        startLine: index + 20_000,
        endLine: index + 20_000,
      })));
      await expect(executeReadOp(cg, 'lspFileContext', { filePath: 'sample.ts' }))
        .resolves.toEqual({ ok: false, reason: 'too_large' });
    } finally {
      cg.close();
    }
  }, 20_000);
});

function location(uri: string, line: number, character: number): LspLocation {
  return {
    uri,
    range: { start: { line, character }, end: { line, character: character + 1 } },
  };
}
