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
  InvalidReadParamsError,
  readOnMissingIndex,
  readTrustedSnapshot,
  type LspWorkspaceSymbolCandidate,
} from '../src/mcp/read-ops';
import {
  LSP_ERROR_CODE,
  LSP_SERVER_CAPABILITIES,
  LSP_WORKSPACE_QUERY_BYTE_CAP,
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
import type { QueryBuilder } from '../src/db/queries';
import type { DatabaseConnection } from '../src/db';
import { lspExactUriSortKey, lspUriSortKey } from '../src/lsp/sort-key';

describe('LSP server protocol helpers', () => {
  it('normalizes Unicode URI ordering without conflating distinct file identities', () => {
    const composed = 'file:///repo/%C3%A9.ts';
    const decomposed = 'file:///repo/e%CC%81.ts';
    expect(normalizeLspUri(decomposed)).toBe(normalizeLspUri(composed));
    expect(lspUriSortKey('e\u0301.ts')).toBe(lspUriSortKey('\u00e9.ts'));
    expect(lspExactUriSortKey('e\u0301.ts')).not.toBe(lspExactUriSortKey('\u00e9.ts'));
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    expect(sortAndCapLocations([{ uri: decomposed, range }, { uri: composed, range }], 10)).toEqual([
      { uri: composed, range },
      { uri: decomposed, range },
    ]);
  });

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
    expect(parseJsonRpcEnvelope({ jsonrpc: '2.0', id: 1.5, method: 'initialize' })).toEqual({
      ok: false, id: null, error: { code: LSP_ERROR_CODE.InvalidRequest, message: 'Invalid Request' },
    });
    expect(parseJsonRpcEnvelope({ jsonrpc: '2.0', id: Number.MAX_SAFE_INTEGER + 1, method: 'initialize' })).toEqual({
      ok: false, id: null, error: { code: LSP_ERROR_CODE.InvalidRequest, message: 'Invalid Request' },
    });
    expect(parseJsonRpcEnvelope({ jsonrpc: '2.0', id: Number.NaN, method: 'initialize' })).toEqual({
      ok: false, id: null, error: { code: LSP_ERROR_CODE.InvalidRequest, message: 'Invalid Request' },
    });
    expect(parseJsonRpcEnvelope({ jsonrpc: '2.0', id: Number.POSITIVE_INFINITY, method: 'initialize' })).toEqual({
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

  it('rejects textual ambiguity but keeps Tree-sitter byte positions for punctuation', () => {
    expect(resolveExactUtf16Range('éaa', 2, 'a')).toBeNull();
    expect(resolveExactUtf16Range('é++', 2, '+')).toEqual({ start: 1, end: 2 });
    expect(resolveExactUtf16Range('😀;x;', 4, ';')).toBeNull();
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
    fs.writeFileSync(path.join(root, 'large.ts'), 'export const compact = true;\n');
    fs.writeFileSync(path.join(root, 'unindexed.txt'), 'not in the graph\n');
    fs.writeFileSync(path.join(parent, 'outside.ts'), 'export const secret = 1;\n');
    fs.symlinkSync(path.join(parent, 'outside.ts'), path.join(root, 'escape.ts'));
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const current = await executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'sample.ts' });
      expect(current).toMatchObject({
        ok: true,
        snapshot: {
          filePath: 'sample.ts',
          languageId: 'typescript',
          contentHash: expect.any(String),
          snapshotToken: expect.any(String),
        },
      });
      expect((current as any).snapshot.text).toContain('function alpha');
      const positionContext = await executeReadOp(cg, 'lspPositionContext', {
        filePath: 'sample.ts', line: 1,
      }) as any;
      expect(positionContext.nodes.some((node: Node) => node.name === 'alpha')).toBe(true);
      const alpha = positionContext.nodes.find((node: Node) => node.name === 'alpha') as Node;
      expect(await executeReadOp(cg, 'lspNodeLocation', { id: alpha.id })).toMatchObject({
        ok: true,
        node: { id: alpha.id, name: 'alpha' },
        snapshotToken: (current as any).snapshot.snapshotToken,
      });
      expect(await executeReadOp(cg, 'lspNodeLocation', { id: 'missing-node' }))
        .toEqual({ ok: false, reason: 'not_found' });
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      queries.insertEdge({
        source: alpha.id,
        target: alpha.id,
        kind: 'calls',
        line: 1,
        column: 0,
        provenance: 'heuristic',
        metadata: { synthesizedBy: 'lsp-read-test', registeredAt: 'lsp-read-test' },
      });
      queries.insertEdge({
        source: alpha.id,
        target: alpha.id,
        kind: 'contains',
        provenance: 'heuristic',
        metadata: { synthesizedBy: 'lsp-read-test', registeredAt: 'lsp-read-test' },
      });
      queries.insertEdge({
        source: alpha.id,
        target: alpha.id,
        kind: 'calls',
        line: 99,
        column: 7,
        provenance: 'tree-sitter',
      });
      queries.insertEdge({
        source: alpha.id,
        target: alpha.id,
        kind: 'references',
        line: 99,
        column: 7,
        provenance: 'lsp',
      });
      expect(cg.getLspIncomingEdgePage(alpha.id, null, 500).edges.filter((edge) => edge.line === 99 && edge.column === 7))
        .toHaveLength(2);
      expect(cg.getIncomingEdges(alpha.id).some((edge) => edge.provenance === 'heuristic')).toBe(true);
      expect(cg.getOutgoingEdges(alpha.id).some((edge) => edge.kind === 'contains' && edge.provenance === 'heuristic')).toBe(true);
      const incomingCandidates = vi.spyOn(cg, 'getLspIncomingEdgePage');
      const positionCandidates = vi.spyOn(cg, 'getLspPositionNodesAtLine');
      const occurrenceCandidates = vi.spyOn(cg, 'getLspOutgoingEdgesAtLine');
      const documentNodes = vi.spyOn(cg, 'getBoundedLspFileNodeSummaries');
      const containmentCandidates = vi.spyOn(cg, 'getLspContainmentEdges');
      const exactContext = await executeReadOp(cg, 'lspPositionContext', {
        filePath: 'sample.ts', line: 1,
      }) as any;
      const documentContext = await executeReadOp(cg, 'lspDocumentContext', { filePath: 'sample.ts' }) as any;
      const exactIncoming = await executeReadOp(cg, 'lspIncoming', {
        id: alpha.id,
        filePath: alpha.filePath,
        snapshotToken: exactContext.snapshot.snapshotToken,
      }) as any;
      expect(exactContext.occurrences.every((entry: any) => (
        typeof entry.sourceFilePath === 'string'
        && typeof entry.targetId === 'string'
        && typeof entry.line === 'number'
        && typeof entry.column === 'number'
        && entry.edge === undefined
        && entry.source === undefined
        && entry.target === undefined
      ))).toBe(true);
      expect(documentContext.containment.every((edge: any) => edge.provenance !== 'heuristic')).toBe(true);
      expect(exactIncoming.ok).toBe(true);
      expect(exactIncoming.occurrences.every((entry: any) => (
        entry.targetId === alpha.id
        && entry.edge === undefined
        && entry.source === undefined
        && entry.target === undefined
      ))).toBe(true);
      expect(positionCandidates).toHaveBeenCalledWith('sample.ts', 1, 257);
      expect(occurrenceCandidates).toHaveBeenCalledWith('sample.ts', 1, 257);
      expect(documentNodes).toHaveBeenCalledWith('sample.ts', 5_001);
      expect(containmentCandidates).toHaveBeenCalledWith('sample.ts', 10_001);
      expect(incomingCandidates).toHaveBeenCalledWith(alpha.id, null, 500);
      expect(await executeReadOp(cg, 'lspSourceSnapshot', { filePath: '../outside.ts' }))
        .toEqual({ ok: false, reason: 'outside_repository' });
      expect(await executeReadOp(cg, 'lspSourceSnapshot', { filePath: '../missing-outside.ts' }))
        .toEqual({ ok: false, reason: 'outside_repository' });
      expect(await executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'escape.ts' }))
        .toEqual({ ok: false, reason: 'outside_repository' });
      expect(await executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'unindexed.txt' }))
        .toEqual({ ok: false, reason: 'unindexed' });
      expect(await executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'missing.ts' }))
        .toEqual({ ok: false, reason: 'not_found' });

      fs.writeFileSync(path.join(root, 'large.ts'), Buffer.alloc(1024 * 1024 + 1, 0x61));
      expect(await executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'large.ts' }))
        .toEqual({ ok: false, reason: 'too_large' });

      fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 2; }\n');
      expect(await executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'sample.ts' }))
        .toEqual({ ok: false, reason: 'stale' });
      fs.writeFileSync(path.join(root, 'large.ts'), 'export const compact = true;\n');
      await cg.indexAll();
      const refreshed = await executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'sample.ts' });
      expect(refreshed).toMatchObject({ ok: true });
      expect((refreshed as any).snapshot.snapshotToken).not.toBe((current as any).snapshot.snapshotToken);
    } finally {
      cg.close();
    }
  });

  it('admits worst-case JSON expansion for a valid one MiB source snapshot', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-wire-cap-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'escape-heavy.ts'), Buffer.alloc(1024 * 1024, 0x01));
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      expect(cg.getFile('escape-heavy.ts')).toBeDefined();
      const result = await executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'escape-heavy.ts' });
      expect(result).toMatchObject({ ok: true });
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeGreaterThan(4 * 1024 * 1024);
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(7 * 1024 * 1024);
    } finally {
      cg.close();
    }
  });

  it.runIf(process.platform !== 'win32')('rejects a path atomically replaced after its open descriptor is read', async () => {
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

  it.runIf(process.platform !== 'win32')('classifies a path deleted after its descriptor read as stale', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-delete-'));
    roots.push(root);
    const candidate = path.join(root, 'sample.ts');
    fs.writeFileSync(candidate, 'export const version = 1;\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      expect(readTrustedSnapshot(cg, 'sample.ts', () => fs.unlinkSync(candidate)))
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

  it('sizes trusted-read allocations to many small files instead of the global cap', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-small-reads-'));
    roots.push(root);
    const files = Array.from({ length: 64 }, (_value, index) => {
      const filePath = `small-${String(index).padStart(2, '0')}.ts`;
      const text = `export const value${index} = ${index};\n`;
      fs.writeFileSync(path.join(root, filePath), text);
      return { filePath, size: Buffer.byteLength(text) };
    });
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const allocate = vi.spyOn(Buffer, 'allocUnsafe');
      try {
        for (const file of files) {
          expect(readTrustedSnapshot(cg, file.filePath)).toMatchObject({ ok: true });
        }
        const sizes = allocate.mock.calls.map(([size]) => size as number);
        expect(sizes).toEqual(files.flatMap((file) => [file.size + 1, file.size]));
        expect(sizes.reduce((total, size) => total + size, 0))
          .toBe(files.reduce((total, file) => total + (2 * file.size) + 1, 0));
      } finally {
        allocate.mockRestore();
      }
    } finally {
      cg.close();
    }
  });

  it('rejects graph rows when the indexed source generation changes after snapshot validation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-generation-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 1; }\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const indexed = cg.getFile('sample.ts')!;
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      const original = cg.getLspPositionNodesAtLine.bind(cg);
      const nodes = vi.spyOn(cg, 'getLspPositionNodesAtLine').mockImplementationOnce((filePath, line, limit) => {
        const result = original(filePath, line, limit);
        queries.upsertFile({ ...indexed, indexedAt: indexed.indexedAt + 1 });
        return result;
      });

      await expect(executeReadOp(cg, 'lspPositionContext', { filePath: 'sample.ts', line: 1 }))
        .resolves.toEqual({ ok: false, reason: 'stale' });
      expect(nodes).toHaveBeenCalledOnce();
      queries.upsertFile(indexed);
    } finally {
      cg.close();
    }
  });

  it('projects bounded hover metadata before position nodes are materialized', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-position-projection-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'sample.ts'), [
      'export function alpha() { return beta(); }',
      'export function beta() { return 1; }',
      '',
    ].join('\n'));
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const alpha = cg.getNodesByName('alpha').find((node) => node.kind === 'function');
      const beta = cg.getNodesByName('beta').find((node) => node.kind === 'function');
      expect(alpha).toBeDefined();
      expect(beta).toBeDefined();
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      const oversizedMetadata = 'x'.repeat(8 * 1024 * 1024);
      queries.updateNode({ ...alpha!, signature: oversizedMetadata, docstring: oversizedMetadata });
      queries.updateNode({ ...beta!, signature: oversizedMetadata, docstring: oversizedMetadata });
      queries.insertEdge({
        source: alpha!.id,
        target: beta!.id,
        kind: 'calls',
        line: 1,
        column: 33,
        metadata: { refName: 'beta' },
        provenance: 'lsp',
      });
      const fullNodes = vi.spyOn(cg, 'getLspNodesByIds');

      const context = await executeReadOp(cg, 'lspPositionContext', {
        filePath: 'sample.ts',
        line: 1,
      }) as any;

      expect(context.ok).toBe(true);
      expect(context.nodes.find((node: Node) => node.id === alpha!.id)).toMatchObject({
        signature: 'x'.repeat(2_000),
        docstring: 'x'.repeat(4_000),
      });
      expect(context.targets.find((node: Node) => node.id === beta!.id)).toMatchObject({
        signature: 'x'.repeat(2_000),
        docstring: 'x'.repeat(4_000),
      });
      expect(fullNodes).not.toHaveBeenCalled();
    } finally {
      cg.close();
    }
  });

  it('carries bounded persisted occurrence evidence through position and incoming reads', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-evidence-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 1; }\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const alpha = cg.getNodesInFile('sample.ts').find((node) => node.name === 'alpha')!;
      const snapshot = await executeReadOp(cg, 'lspSourceSnapshot', { filePath: alpha.filePath }) as any;
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      queries.insertEdge({
        source: alpha.id,
        target: alpha.id,
        kind: 'calls',
        line: 1,
        column: 0,
        metadata: { refName: 'beta' },
      });
      queries.insertEdge({
        source: alpha.id,
        target: alpha.id,
        kind: 'references',
        line: 2,
        column: 0,
        metadata: { refName: 'namespace.alpha' },
      });
      queries.insertEdge({
        source: alpha.id,
        target: alpha.id,
        kind: 'imports',
        line: 5,
        column: 0,
      });
      queries.insertEdge({
        source: alpha.id,
        target: alpha.id,
        kind: 'references',
        line: 5,
        column: 0,
        metadata: { refName: 'beta' },
      });

      await expect(executeReadOp(cg, 'lspPositionContext', { filePath: alpha.filePath, line: 1 }))
        .resolves.toMatchObject({ ok: true, occurrences: [{ evidence: 'beta' }] });
      const incoming = await executeReadOp(cg, 'lspIncoming', {
        id: alpha.id,
        filePath: alpha.filePath,
        snapshotToken: snapshot.snapshot.snapshotToken,
      }) as any;
      expect(incoming).toMatchObject({ ok: true });
      expect(incoming.occurrences).toEqual(expect.arrayContaining([
        expect.objectContaining({ line: 1, evidence: 'beta' }),
        expect.objectContaining({ line: 2, evidence: 'namespace.alpha' }),
        expect.objectContaining({ line: 5, evidence: 'beta' }),
      ]));
      expect(incoming.occurrences.filter((occurrence: any) => occurrence.line === 5)).toHaveLength(1);

      queries.insertEdge({
        source: alpha.id,
        target: alpha.id,
        kind: 'calls',
        line: 4,
        column: 0,
        metadata: { refName: null },
      });
      await expect(executeReadOp(cg, 'lspIncoming', {
        id: alpha.id,
        filePath: alpha.filePath,
        snapshotToken: snapshot.snapshot.snapshotToken,
      })).resolves.toEqual({ ok: false, reason: 'stale' });

      queries.insertEdge({
        source: alpha.id,
        target: alpha.id,
        kind: 'calls',
        line: 3,
        column: 0,
        metadata: { refName: 'x'.repeat(20 * 1024) },
      });
      await expect(executeReadOp(cg, 'lspPositionContext', { filePath: alpha.filePath, line: 3 }))
        .resolves.toEqual({ ok: false, reason: 'too_large' });
    } finally {
      cg.close();
    }
  });

  it('caps high-cardinality incoming references and still enforces the byte budget', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-incoming-cap-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 1; }\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const snapshot = await executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'sample.ts' }) as any;
      const alpha = cg.getNodesInFile('sample.ts').find((node) => node.name === 'alpha')!;
      const params = {
        id: alpha.id,
        filePath: alpha.filePath,
        snapshotToken: snapshot.snapshot.snapshotToken,
      };
      const candidates = Array.from({ length: 5_001 }, (_value, index) => ({
        source: alpha.id,
        target: alpha.id,
        kind: 'calls',
        line: index + 1,
        column: 0,
      }));
      const incoming = vi.spyOn(cg, 'getLspIncomingEdgePage').mockImplementation(
        (_targetId, _after, limit) => ({ edges: candidates.slice(0, limit), nextCursor: null }),
      );
      const capped = await executeReadOp(cg, 'lspIncoming', params) as any;
      expect(capped.ok).toBe(true);
      expect(capped.occurrences).toHaveLength(500);
      expect(incoming).toHaveBeenLastCalledWith(alpha.id, null, 500);

      const longPath = `${'nested/'.repeat(2_500)}source.ts`;
      const source = { ...alpha, id: 'source', filePath: longPath };
      const indexed = cg.getFile('sample.ts')!;
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      queries.upsertFile({ ...indexed, path: longPath });
      queries.insertNodes([source]);
      incoming.mockReturnValue({
        edges: Array.from({ length: 500 }, (_value, index) => ({
          source: source.id,
          target: alpha.id,
          kind: 'calls',
          line: index + 1,
          column: 0,
        })),
        nextCursor: null,
      });
      await expect(executeReadOp(cg, 'lspIncoming', params))
        .resolves.toEqual({ ok: false, reason: 'too_large' });
    } finally {
      cg.close();
    }
  });

  it('batches high-cardinality incoming source and snapshot lookups', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-incoming-batch-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 1; }\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const snapshot = await executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'sample.ts' }) as any;
      const alpha = cg.getNodesInFile('sample.ts').find((node) => node.name === 'alpha')!;
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      const sources = Array.from({ length: 500 }, (_value, index) => ({
        ...alpha,
        id: `source-${index}`,
        name: `source${index}`,
        qualifiedName: `source${index}`,
      }));
      queries.insertNodes(sources);
      vi.spyOn(cg, 'getLspIncomingEdgePage').mockReturnValue({
        edges: sources.map((source, index) => ({
          source: source.id,
          target: alpha.id,
          kind: 'calls',
          line: index + 1,
          column: 0,
        })),
        nextCursor: null,
      });
      const getNodes = vi.spyOn(cg, 'getLspNodesByIds');
      const getNodeSummaries = vi.spyOn(cg, 'getLspNodeSummariesByIds');
      const getFile = vi.spyOn(cg, 'getFile');

      const incoming = await executeReadOp(cg, 'lspIncoming', {
        id: alpha.id,
        filePath: alpha.filePath,
        snapshotToken: snapshot.snapshot.snapshotToken,
      }) as any;

      expect(incoming.ok).toBe(true);
      expect(incoming.occurrences).toHaveLength(500);
      expect(getNodes).toHaveBeenCalledTimes(1);
      expect(getNodeSummaries).toHaveBeenCalledTimes(2);
      expect(getFile).toHaveBeenCalledTimes(1);
    } finally {
      cg.close();
    }
  });

  it('scans bounded incoming pages inside one read transaction', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-incoming-transaction-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 1; }\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const snapshot = await executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'sample.ts' }) as any;
      const alpha = cg.getNodesInFile('sample.ts').find((node) => node.name === 'alpha')!;
      const params = {
        id: alpha.id,
        filePath: alpha.filePath,
        snapshotToken: snapshot.snapshot.snapshotToken,
      };
      const transaction = vi.spyOn(cg, 'withLspReadTransaction');
      let page = 0;
      const incoming = vi.spyOn(cg, 'getLspIncomingEdgePage').mockImplementation((_targetId, _after, limit) => {
        page += 1;
        return {
          edges: Array.from({ length: limit }, () => ({
            source: alpha.id,
            target: alpha.id,
            kind: 'calls',
            line: 1,
            column: 0,
          })),
          nextCursor: {
            kind: 'calls',
            id: page,
          },
        };
      });

      await expect(executeReadOp(cg, 'lspIncoming', params))
        .resolves.toEqual({ ok: false, reason: 'too_large' });
      expect(incoming).toHaveBeenCalledTimes(10);
      expect(transaction).toHaveBeenCalledOnce();
    } finally {
      cg.close();
    }
  });

  it('uses normalized URI ordering for workspace reads and indexed cursors for incoming pages', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-uri-order-'));
    roots.push(root);
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      const makeNode = (id: string, filePath: string): Node => ({
        id,
        kind: 'function',
        name: 'same',
        qualifiedName: '',
        filePath,
        language: 'typescript',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 4,
        updatedAt: 1,
      });
      const bracket = makeNode('bracket-source', '[x].ts');
      const ascii = makeNode('ascii-source', 'A.ts');
      const target = { ...makeNode('target', 'target.ts'), qualifiedName: 'target' };
      queries.insertNodes([ascii, bracket, target]);
      queries.insertEdges([
        { source: ascii.id, target: target.id, kind: 'calls', line: 1, column: 0 },
        { source: bracket.id, target: target.id, kind: 'calls', line: 1, column: 0 },
      ]);

      expect(cg.getLspWorkspaceNodes(2).map((node) => node.filePath)).toEqual(['[x].ts', 'A.ts']);
      const composed = { ...makeNode('composed', '\u00e9.ts'), qualifiedName: 'unicode', startLine: 2, endLine: 2 };
      const decomposed = { ...makeNode('decomposed', 'e\u0301.ts'), qualifiedName: 'unicode' };
      queries.insertNodes([decomposed, composed]);
      expect(cg.getLspWorkspaceNodes(10)
        .filter((node) => node.qualifiedName === 'unicode')
        .map((node) => node.id)).toEqual([composed.id, decomposed.id]);
      const first = cg.getLspIncomingEdgePage(target.id, null, 1);
      expect(first.edges.map((edge) => edge.source)).toEqual([ascii.id]);
      expect(first.nextCursor).not.toBeNull();
      const second = cg.getLspIncomingEdgePage(target.id, first.nextCursor, 1);
      expect(second.edges.map((edge) => edge.source)).toEqual([bracket.id]);
      expect(second.nextCursor).toBeNull();
    } finally {
      cg.close();
    }
  });

  it.runIf(process.platform !== 'win32')('keeps POSIX backslash filenames distinct in workspace ordering', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-posix-path-order-'));
    roots.push(root);
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      const makeNode = (id: string, filePath: string): Node => ({
        id,
        kind: 'function',
        name: 'same',
        qualifiedName: 'same',
        filePath,
        language: 'typescript',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 4,
        updatedAt: 1,
      });
      const backslash = makeNode('z-backslash', 'a\\b.ts');
      const directory = makeNode('a-directory', 'a/b.ts');
      queries.insertNodes([directory, backslash]);

      expect(lspExactUriSortKey(backslash.filePath)).not.toBe(lspExactUriSortKey(directory.filePath));
      expect(cg.getLspWorkspaceNodes(2).map((node) => node.id))
        .toEqual([backslash.id, directory.id]);
    } finally {
      cg.close();
    }
  });

  it('keeps LSP ordering read-only without extending the persisted schema', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-read-only-order-'));
    roots.push(root);
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      const connection = (cg as unknown as { db: DatabaseConnection }).db;
      const db = connection.getDb();
      const nodeColumns = db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>;
      const edgeColumns = db.prepare('PRAGMA table_info(edges)').all() as Array<{ name: string }>;
      expect(nodeColumns.map((column) => column.name)).not.toContain('lsp_uri_sort_key');
      expect(edgeColumns.map((column) => column.name)).not.toContain('source_uri_sort_key');

      const before = db.prepare('SELECT total_changes() AS changes').get() as { changes: number };
      expect(cg.getLspWorkspaceNodes(1)).toEqual([]);
      expect(cg.getLspIncomingEdgePage('missing', null, 1)).toEqual({ edges: [], nextCursor: null });
      const after = db.prepare('SELECT total_changes() AS changes').get() as { changes: number };
      expect(after.changes).toBe(before.changes);
    } finally {
      cg.close();
    }
  });

  it('caps blank workspace-symbol reads and applies stable full ordering before the daemon response', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-symbols-'));
    roots.push(root);
    const declarations = Array.from(
      { length: 540 },
      (_value, index) => `export function needle${String(539 - index).padStart(3, '0')}() {}`,
    ).join('\n');
    fs.writeFileSync(path.join(root, 'symbols.ts'), `${declarations}\n`);
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const getFiles = vi.spyOn(cg, 'getFiles');
      const getNodesInFile = vi.spyOn(cg, 'getNodesInFile');
      const workspaceNodes = vi.spyOn(cg, 'iterateLspWorkspaceSymbolCandidates');
      const transaction = vi.spyOn(cg, 'withLspReadTransaction');
      const blankCandidates = await executeReadOp(cg, 'lspWorkspaceSymbols', {}) as LspWorkspaceSymbolCandidate[];
      const blank = blankCandidates.map((candidate) => candidate.node);
      expect(blank).toHaveLength(541);
      expect(blankCandidates.every((candidate) => candidate.snapshotToken.length > 0)).toBe(true);
      expect(transaction).toHaveBeenCalledOnce();
      expect(workspaceNodes).toHaveBeenCalledWith('', expect.objectContaining({
        maxRows: 1_000,
        exceeded: false,
      }));
      expect(getFiles).not.toHaveBeenCalled();
      expect(getNodesInFile).not.toHaveBeenCalled();
      expect(blank.map((node) => node.qualifiedName)).toEqual(
        [...blank].map((node) => node.qualifiedName).sort(),
      );

      const queriedCandidates = await executeReadOp(cg, 'lspWorkspaceSymbols', { query: 'needle' }) as LspWorkspaceSymbolCandidate[];
      const queried = queriedCandidates.map((candidate) => candidate.node);
      expect(queried).toHaveLength(540);
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(workspaceNodes).toHaveBeenCalledWith('needle', expect.objectContaining({
        maxRows: 5_000,
        exceeded: false,
      }));
      expect(queried.map((node) => node.qualifiedName)).toEqual(
        [...queried].map((node) => node.qualifiedName).sort(),
      );
      expect(queried[0]?.qualifiedName).toContain('needle000');
      expect(queried.map((node) => node.id).length).toBe(new Set(queried.map((node) => node.id)).size);
      await expect(executeReadOp(cg, 'lspWorkspaceSymbols', {
        query: 'x'.repeat(LSP_WORKSPACE_QUERY_BYTE_CAP + 1),
      })).rejects.toBeInstanceOf(InvalidReadParamsError);
      expect(() => readOnMissingIndex('lspWorkspaceSymbols', {
        query: 'x'.repeat(LSP_WORKSPACE_QUERY_BYTE_CAP + 1),
      })).toThrow(InvalidReadParamsError);
      expect(workspaceNodes).toHaveBeenCalledTimes(2);

      const fileNodes = vi.spyOn(cg, 'getBoundedLspFileNodeSummaries');
      const containment = vi.spyOn(cg, 'getLspContainmentEdges');
      await expect(executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'symbols.ts' }))
        .resolves.toMatchObject({ ok: true });
      expect(fileNodes).not.toHaveBeenCalled();
      expect(containment).not.toHaveBeenCalled();
      const document = await executeReadOp(cg, 'lspDocumentContext', { filePath: 'symbols.ts' }) as any;
      expect(document.ok).toBe(true);
      expect(document.nodes).toHaveLength(540);
      expect(fileNodes).toHaveBeenCalledWith('symbols.ts', 5_001);
      expect(containment).toHaveBeenCalledWith('symbols.ts', 10_001);
    } finally {
      cg.close();
    }
  });

  it('charges raw FTS matches before applying SQL hard filters', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-fts-budget-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'symbols.ts'), 'export function template() {}\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const template = cg.getNodesInFile('symbols.ts')[0]!;
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      queries.insertNodes(Array.from({ length: 101 }, (_value, index): Node => ({
        ...template,
        id: `raw-fts-budget-${index}`,
        kind: index === 100 ? 'class' : 'function',
        name: `sharedFtsTerm${index}`,
        qualifiedName: `sharedFtsTerm${index}`,
        startLine: index + 2,
        endLine: index + 2,
      })));

      const budget = { maxRows: 100, examinedRows: 0, exceeded: false };
      expect([...cg.iterateLspWorkspaceSymbolCandidates(
        'sharedFtsTerm kind:class',
        budget,
      )]).toEqual([]);
      expect(budget.exceeded).toBe(true);
    } finally {
      cg.close();
    }
  });

  it('orders equal-ranked workspace search candidates before every internal cap', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-search-order-'));
    roots.push(root);
    const declarations = Array.from(
      { length: 5_000 },
      (_value, index) => `export function needle${String(4_999 - index).padStart(4, '0')}() {}`,
    ).join('\n');
    fs.writeFileSync(path.join(root, 'symbols.ts'), `${declarations}\n`);
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const candidates = await executeReadOp(cg, 'lspWorkspaceSymbols', {
        query: 'needle',
      }) as LspWorkspaceSymbolCandidate[];
      expect(candidates).toHaveLength(5_000);
      expect(candidates[0]?.node.qualifiedName).toContain('needle0000');
      expect(candidates.at(-1)?.node.qualifiedName).toContain('needle4999');
    } finally {
      cg.close();
    }
  }, 30_000);

  it('does not let an initial unprovable-range slice hide a later valid symbol', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-search-stale-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'wanted.ts'), 'export function needle() {}\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const wanted = cg.getNodesByName('needle').find((node) => node.kind === 'function');
      expect(wanted).toBeDefined();
      const unprovable = Array.from({ length: 1_000 }, (_value, index): Node => ({
        id: `unprovable-${index}`,
        kind: 'function',
        name: 'needle',
        qualifiedName: `aaaa${String(index).padStart(4, '0')}`,
        filePath: 'wanted.ts',
        language: 'typescript',
        startLine: index + 2,
        endLine: index + 2,
        startColumn: 99,
        endColumn: 105,
        updatedAt: 1,
      }));
      const search = vi.spyOn(cg, 'iterateLspWorkspaceSymbolCandidates').mockImplementation(function* () {
        for (const node of [...unprovable, wanted!]) yield { node, score: 1 };
      });

      const candidates = await executeReadOp(cg, 'lspWorkspaceSymbols', {
        query: 'needle',
      }) as LspWorkspaceSymbolCandidate[];
      expect(candidates).toHaveLength(1_001);
      expect(candidates.at(-1)?.node.id).toBe(wanted!.id);
      expect(candidates.every((candidate) => candidate.searchScore === 1)).toBe(true);
      expect(search).toHaveBeenCalledWith('needle', expect.objectContaining({
        maxRows: 5_000,
        exceeded: false,
      }));
    } finally {
      cg.close();
    }
  });

  it('fails closed when the bounded workspace search scan is incomplete', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-search-bound-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'symbol.ts'), 'export function needle() {}\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const node = cg.getNodesByName('needle').find((candidate) => candidate.kind === 'function');
      expect(node).toBeDefined();
      vi.spyOn(cg, 'iterateLspWorkspaceSymbolCandidates').mockImplementation(function* () {
        for (let index = 0; index < 5_001; index += 1) {
          yield { node: { ...node!, id: `candidate-${index}` }, score: 1 };
        }
      });

      await expect(executeReadOp(cg, 'lspWorkspaceSymbols', { query: 'needle' }))
        .resolves.toEqual({ ok: false, reason: 'too_large' });
    } finally {
      cg.close();
    }
  });

  it('fails closed when the bounded empty workspace-symbol scan is incomplete', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-empty-bound-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'symbol.ts'), 'export function symbol() {}\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const node = cg.getNodesByName('symbol').find((candidate) => candidate.kind === 'function');
      expect(node).toBeDefined();
      const workspaceNodes = vi.spyOn(cg, 'iterateLspWorkspaceSymbolCandidates')
        .mockImplementation(function* () {
          for (let index = 0; index < 1_001; index += 1) {
            yield { node: { ...node!, id: `candidate-${index}` }, score: 0 };
          }
        });

      await expect(executeReadOp(cg, 'lspWorkspaceSymbols', {}))
        .resolves.toEqual({ ok: false, reason: 'too_large' });
      expect(workspaceNodes).toHaveBeenCalledWith('', expect.objectContaining({
        maxRows: 1_000,
        exceeded: false,
      }));
    } finally {
      cg.close();
    }
  });

  it('fails closed instead of returning a byte-truncated workspace prefix', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-search-bytes-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'symbol.ts'), 'export function needle() {}\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const node = cg.getNodesByName('needle').find((candidate) => candidate.kind === 'function');
      expect(node).toBeDefined();
      vi.spyOn(cg, 'iterateLspWorkspaceSymbolCandidates').mockImplementation(function* () {
        yield { node: { ...node!, qualifiedName: 'q'.repeat(7 * 1024 * 1024) }, score: 1 };
      });

      await expect(executeReadOp(cg, 'lspWorkspaceSymbols', { query: 'needle' }))
        .resolves.toEqual({ ok: false, reason: 'too_large' });
    } finally {
      cg.close();
    }
  });

  it('applies hard workspace search filters before database candidate caps', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-search-filter-'));
    roots.push(root);
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      const nodes = Array.from({ length: 5_001 }, (_value, index): Node => ({
        id: `outside-${index}`,
        kind: 'function',
        name: 'needleOutside',
        qualifiedName: `needle${String(index).padStart(4, '0')}`,
        filePath: 'outside.ts',
        language: 'typescript',
        startLine: index + 1,
        endLine: index + 1,
        startColumn: 0,
        endColumn: 6,
        updatedAt: 1,
      }));
      const wanted: Node = {
        ...nodes[0]!,
        id: 'wanted',
        name: 'needleWanted',
        qualifiedName: 'zzzzWantedNeedle',
        filePath: '\u00c9/wanted.ts',
      };
      queries.insertNodes([...nodes, wanted]);

      expect(cg.searchLspWorkspaceNodes('needle path:\u00e9/wanted.ts', 1_000).map((result) => result.node.id))
        .toEqual([wanted.id]);
      expect(cg.searchLspWorkspaceNodes('needle name:wanted', 1_000).map((result) => result.node.id))
        .toEqual([wanted.id]);
      await expect(executeReadOp(cg, 'lspWorkspaceSymbols', {
        query: 'needle path:\u00e9/wanted.ts',
      })).resolves.toEqual({ ok: false, reason: 'too_large' });
    } finally {
      cg.close();
    }
  }, 15_000);

  it('returns every same-name LSP candidate reached through fuzzy fallback', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-search-fuzzy-'));
    roots.push(root);
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      const nodes = Array.from({ length: 10 }, (_value, index): Node => ({
        id: `get-user-${index}`,
        kind: 'function',
        name: 'getUser',
        qualifiedName: `module${String(index).padStart(2, '0')}.getUser`,
        filePath: `file-${String(index).padStart(2, '0')}.ts`,
        language: 'typescript',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 7,
        updatedAt: 1,
      }));
      queries.insertNodes(nodes);

      expect(cg.searchLspWorkspaceNodes('getUssr', 1_000).map((result) => result.node.id))
        .toEqual(nodes.map((node) => node.id));
    } finally {
      cg.close();
    }
  });

  it('fails closed when the fuzzy candidate universe exceeds its scan budget', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-search-fuzzy-bound-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'symbols.ts'), 'export function indexedAnchor() {}\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      const nodes = Array.from({ length: 5_000 }, (_value, index): Node => ({
        id: `fuzzy-bound-${index}`,
        kind: 'function',
        name: index === 4_999 ? 'getUser' : `symbol${String(index).padStart(4, '0')}`,
        qualifiedName: `module.symbol${String(index).padStart(4, '0')}`,
        filePath: 'symbols.ts',
        language: 'typescript',
        startLine: index + 1,
        endLine: index + 1,
        startColumn: 0,
        endColumn: 10,
        updatedAt: 1,
      }));
      queries.insertNodes(nodes);
      queries.insertNode({
        ...nodes[0]!,
        id: 'fuzzy-overflow',
        name: 'zzzz-overflow',
        qualifiedName: 'module.zzzz-overflow',
      });

      await expect(executeReadOp(cg, 'lspWorkspaceSymbols', {
        query: 'getUssr',
      })).resolves.toEqual({ ok: false, reason: 'too_large' });
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
      await expect(executeReadOp(cg, 'lspSourceSnapshot', { filePath: 'sample.ts' }))
        .resolves.toEqual({ ok: false, reason: 'unreadable' });
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

      const context = await executeReadOp(cg, 'lspPositionContext', {
        filePath: 'sample.ts',
        line: 1,
      }) as any;
      expect(context.ok).toBe(true);
      expect(context.targets.find((target: Node) => target.id === beta.id)?.docstring)
        .toBe('fresh writer value');
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
      const substring = await executeReadOp(cg, 'lspWorkspaceSymbols', {
        query: 'CaseNeedle',
      }) as LspWorkspaceSymbolCandidate[];
      const fuzzy = await executeReadOp(cg, 'lspWorkspaceSymbols', {
        query: 'aproximateName',
      }) as LspWorkspaceSymbolCandidate[];
      expect(substring.map((candidate) => candidate.node.name)).toContain('camelCaseNeedle');
      expect(fuzzy.map((candidate) => candidate.node.name)).toContain('approximateName');
      expect([...substring, ...fuzzy].every((candidate) => candidate.node.docstring === undefined)).toBe(true);
    } finally {
      cg.close();
    }
  });

  it('rejects oversized document materialization before loading full nodes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-lsp-document-budget-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'sample.ts'), 'export function alpha() { return 1; }\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try {
      await cg.indexAll();
      const alpha = cg.getNodesInFile('sample.ts').find((node) => node.name === 'alpha')!;
      const queries = (cg as unknown as { queries: QueryBuilder }).queries;
      queries.updateNode({ ...alpha, docstring: 'x'.repeat(7 * 1024 * 1024) });
      const materialize = vi.spyOn(cg, 'getLspNodesByIds');

      await expect(executeReadOp(cg, 'lspDocumentContext', { filePath: 'sample.ts' }))
        .resolves.toEqual({ ok: false, reason: 'too_large' });
      expect(materialize).not.toHaveBeenCalled();
    } finally {
      cg.close();
    }
  });
});

function location(uri: string, line: number, character: number): LspLocation {
  return {
    uri,
    range: { start: { line, character }, end: { line, character: character + 1 } },
  };
}
