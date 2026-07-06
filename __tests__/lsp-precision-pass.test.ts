import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EDGE_PROVENANCES } from '../src/types';
import CodeGraph, { DatabaseConnection, getDatabasePath, QueryBuilder } from '../src';
import {
  LspClientError,
  LspRequestTimeoutError,
  canUseLspProvenanceForDecision,
  isKnownEdgeProvenance,
  resolveLspConfig,
  runLspPrecisionPass,
} from '../src/lsp';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeExecutable(dir: string, name: string): string {
  const executable = path.join(dir, process.platform === 'win32' ? `${name}.cmd` : name);
  if (process.platform === 'win32') {
    fs.writeFileSync(executable, '@echo off\r\nexit /b 0\r\n');
  } else {
    fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(executable, 0o755);
  }
  return executable;
}

function makeCandidate(overrides: Record<string, unknown> = {}): any {
  const language = overrides.language ?? 'typescript';
  const edgeId = overrides.edgeId ?? 1;
  return {
    edgeId,
    sourceId: `${language}-source-${edgeId}`,
    targetId: `${language}-target`,
    kind: 'calls',
    line: 1,
    column: 0,
    provenance: 'tree-sitter',
    metadata: undefined,
    sourceFilePath: `${language}/source-${edgeId}.${language === 'javascript' ? 'js' : 'ts'}`,
    language,
    targetFilePath: `${language}/target.${language === 'javascript' ? 'js' : 'ts'}`,
    targetStartLine: 1,
    targetEndLine: 1,
    targetStartColumn: 0,
    targetEndColumn: 10,
    targetKind: 'function',
    targetName: 'target',
    ...overrides,
  };
}

function makeTargetNode(overrides: Record<string, unknown> = {}): any {
  return {
    id: overrides.id ?? 'typescript-target',
    kind: 'function',
    name: 'target',
    qualifiedName: 'target',
    filePath: overrides.filePath ?? 'typescript/target.ts',
    language: overrides.language ?? 'typescript',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 10,
    visibility: 'public',
    isExported: true,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    ...overrides,
  };
}

function mockQueries(candidates: any[], targetNode: any): any {
  return {
    getLspEdgeCandidates: (languages: string[], limit: number) =>
      candidates
        .filter((candidate) => languages.includes(candidate.language))
        .slice(0, limit),
    getLspEdgeCandidateCounts: (
      languages: string[],
      caps?: { fullIndexSourceFilesPerLanguage: number; fullIndexWorkItemsPerLanguage: number },
    ) => {
      const scoped = candidates.filter((candidate) => languages.includes(candidate.language));
      const perFileCounts = [...scoped.reduce((map, candidate) => {
        map.set(candidate.sourceFilePath, (map.get(candidate.sourceFilePath) ?? 0) + 1);
        return map;
      }, new Map<string, number>()).entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, count]) => count);
      const allowedFileCounts = caps
        ? perFileCounts.slice(0, caps.fullIndexSourceFilesPerLanguage)
        : perFileCounts;
      const fileCapSkippedWorkItems = caps
        ? perFileCounts.slice(caps.fullIndexSourceFilesPerLanguage).reduce((sum, count) => sum + count, 0)
        : 0;
      const allowedFileWorkItems = allowedFileCounts.reduce((sum, count) => sum + count, 0);
      return {
        sourceFilesSeen: perFileCounts.length,
        candidateWorkItems: scoped.length,
        fileCapSkippedWorkItems,
        workCapSkippedWorkItems: caps
          ? Math.max(0, allowedFileWorkItems - caps.fullIndexWorkItemsPerLanguage)
          : 0,
      };
    },
    findNodesAtLocation: () => [targetNode],
    updateEdgeLspProvenance: () => 1,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) {
      throw new Error('Timed out waiting for async test condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function insertTestNode(queries: QueryBuilder, overrides: Record<string, unknown>): void {
  const startLine = (overrides.startLine as number) ?? 1;
  queries.insertNode({
    id: overrides.id as string,
    kind: (overrides.kind as any) ?? 'function',
    name: (overrides.name as string) ?? 'helper',
    qualifiedName: (overrides.qualifiedName as string) ?? (overrides.name as string) ?? 'helper',
    filePath: overrides.filePath as string,
    language: (overrides.language as any) ?? 'typescript',
    startLine,
    endLine: (overrides.endLine as number) ?? startLine,
    startColumn: (overrides.startColumn as number) ?? 0,
    endColumn: (overrides.endColumn as number) ?? 20,
    visibility: 'public',
    isExported: true,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    updatedAt: Date.now(),
  });
}

function rawEdgeRows(db: ReturnType<DatabaseConnection['getDb']>): Array<{
  id: number;
  source: string;
  target: string;
  kind: string;
  metadata: string | null;
  provenance: string | null;
}> {
  return db.prepare('SELECT id, source, target, kind, metadata, provenance FROM edges ORDER BY id').all() as any[];
}

describe('LSP precision provenance foundation', () => {
  it('adds lsp provenance without removing existing provenance values', () => {
    expect([...EDGE_PROVENANCES]).toEqual(['tree-sitter', 'scip', 'heuristic', 'lsp']);
    expect(isKnownEdgeProvenance('tree-sitter')).toBe(true);
    expect(isKnownEdgeProvenance('heuristic')).toBe(true);
    expect(isKnownEdgeProvenance('lsp')).toBe(true);
  });

  it('limits active lsp provenance to verified or corrected decisions', () => {
    expect(canUseLspProvenanceForDecision('verified')).toBe(true);
    expect(canUseLspProvenanceForDecision('corrected')).toBe(true);
    expect(canUseLspProvenanceForDecision('unchanged')).toBe(false);
    expect(canUseLspProvenanceForDecision('suppressed')).toBe(false);
    expect(canUseLspProvenanceForDecision('skipped')).toBe(false);
  });

  it('marks a matching TypeScript definition edge as lsp without changing edge count', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'a.ts'), [
      'export function helper(): number {',
      '  return 1;',
      '}',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'b.ts'), [
      "import { helper } from './a';",
      'export function main(): number {',
      '  return helper();',
      '}',
      '',
    ].join('\n'));

    const fakeServer = path.join(dir, 'typescript-language-server');
    fs.writeFileSync(fakeServer, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(fakeServer, 0o755);

    const cg = await CodeGraph.init(dir);
    try {
      await cg.indexAll();
      const db = DatabaseConnection.open(getDatabasePath(dir));
      try {
        const queries = new QueryBuilder(db.getDb());
        const before = queries.getNodeAndEdgeCount();
        const config = resolveLspConfig({
          projectRoot: dir,
          cliActivation: 'enable',
          env: {
            CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([fakeServer, '--stdio']),
          },
        });

        const status = await runLspPrecisionPass({
          projectRoot: dir,
          queries,
          config,
          clientFactory: {
            create: () => ({
              initialize: async () => ({ serverInfo: { name: 'fake-ts-lsp', version: '1.0.0' } }),
              request: async () => ({
                uri: pathToFileURL(path.join(dir, 'a.ts')).href,
                range: { start: { line: 0, character: 16 }, end: { line: 2, character: 1 } },
              }),
              shutdown: async () => undefined,
            }),
          },
        });

        const after = queries.getNodeAndEdgeCount();
        const lspRows = db.getDb().prepare("SELECT COUNT(*) AS count FROM edges WHERE provenance = 'lsp'").get() as { count: number };
        expect(after).toEqual(before);
        expect(lspRows.count).toBeGreaterThan(0);
        expect(status.edgeCounts.checked).toBeGreaterThan(0);
        expect(status.edgeCounts.verified).toBeGreaterThan(0);
        expect(status.coverage.some((record) => record.language === 'typescript' && record.checkedWorkItems > 0)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      cg.close();
    }
  });

  it('runs precision validation for TSX and JSX source files in Slice 1', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'component.ts'), [
      'export function renderThing(): number {',
      '  return 1;',
      '}',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'main.tsx'), [
      "import { renderThing } from './component';",
      'export function main(): number {',
      '  return renderThing();',
      '}',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'widget.js'), [
      'export function renderWidget() {',
      '  return 1;',
      '}',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'entry.jsx'), [
      "import { renderWidget } from './widget';",
      'export function entry() {',
      '  return renderWidget();',
      '}',
      '',
    ].join('\n'));

    const fakeServer = path.join(dir, 'typescript-language-server');
    fs.writeFileSync(fakeServer, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(fakeServer, 0o755);

    const cg = await CodeGraph.init(dir);
    try {
      await cg.indexAll();
      const db = DatabaseConnection.open(getDatabasePath(dir));
      try {
        const queries = new QueryBuilder(db.getDb());
        const config = resolveLspConfig({
          projectRoot: dir,
          cliActivation: 'enable',
          env: {
            CODEGRAPH_LSP_TSX_COMMAND_JSON: JSON.stringify([fakeServer, '--stdio']),
            CODEGRAPH_LSP_JSX_COMMAND_JSON: JSON.stringify([fakeServer, '--stdio']),
          },
        });

        const status = await runLspPrecisionPass({
          projectRoot: dir,
          queries,
          config,
          clientFactory: {
            create: ({ language }) => ({
              initialize: async () => ({ serverInfo: { name: `fake-${language}-lsp`, version: '1.0.0' } }),
              request: async (_method, params) => {
                const uri = (params.textDocument as { uri: string }).uri;
                return uri.endsWith('/main.tsx')
                  ? {
                    uri: pathToFileURL(path.join(dir, 'component.ts')).href,
                    range: { start: { line: 0, character: 16 }, end: { line: 2, character: 1 } },
                  }
                  : {
                    uri: pathToFileURL(path.join(dir, 'widget.js')).href,
                    range: { start: { line: 0, character: 16 }, end: { line: 2, character: 1 } },
                  };
              },
              shutdown: async () => undefined,
            }),
          },
        });

        expect(status.coverage.some((record) => record.language === 'tsx' && record.checkedWorkItems > 0)).toBe(true);
        expect(status.coverage.some((record) => record.language === 'jsx' && record.checkedWorkItems > 0)).toBe(true);
        expect(status.edgeCounts.verified).toBeGreaterThanOrEqual(2);
      } finally {
        db.close();
      }
    } finally {
      cg.close();
    }
  });


  it('records shutdown-only failure on the server without degrading verified work', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function helper(): number { return 1; }\n');
    fs.writeFileSync(path.join(dir, 'b.ts'), "import { helper } from './a';\nexport const value = helper();\n");
    const fakeServer = path.join(dir, 'typescript-language-server');
    fs.writeFileSync(fakeServer, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(fakeServer, 0o755);

    const cg = await CodeGraph.init(dir);
    try {
      await cg.indexAll();
      const db = DatabaseConnection.open(getDatabasePath(dir));
      try {
        const queries = new QueryBuilder(db.getDb());
        const config = resolveLspConfig({
          projectRoot: dir,
          cliActivation: 'enable',
          env: {
            CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([fakeServer, '--stdio']),
          },
        });

        const status = await runLspPrecisionPass({
          projectRoot: dir,
          queries,
          config,
          clientFactory: {
            create: () => ({
              initialize: async () => ({ serverInfo: { name: 'fake-ts-lsp', version: '1.0.0' } }),
              request: async () => ({
                uri: pathToFileURL(path.join(dir, 'a.ts')).href,
                range: { start: { line: 0, character: 16 }, end: { line: 0, character: 22 } },
              }),
              shutdown: async () => { throw new Error('fixture shutdown failed'); },
            }),
          },
        });

        const server = status.servers.find((record) => record.language === 'typescript');
        expect(server).toMatchObject({
          state: 'degraded',
          reasonCode: 'shutdown-failure',
        });
        expect(status.edgeCounts.verified).toBeGreaterThan(0);
        expect(status.edgeCounts.degraded).toBe(0);
        expect(status.edgeCounts.skippedByReason['shutdown-failure']).toBeUndefined();
      } finally {
        db.close();
      }
    } finally {
      cg.close();
    }
  });


  it('records run-level skipped reasons when a configured server command is unavailable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function helper(): number { return 1; }\n');
    fs.writeFileSync(path.join(dir, 'b.ts'), "import { helper } from './a';\nexport const value = helper();\n");

    const cg = await CodeGraph.init(dir);
    try {
      await cg.indexAll();
      const db = DatabaseConnection.open(getDatabasePath(dir));
      try {
        const queries = new QueryBuilder(db.getDb());
        const config = resolveLspConfig({
          projectRoot: dir,
          cliActivation: 'enable',
          env: {
            CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([path.join(dir, 'missing-ts-lsp'), '--stdio']),
          },
        });

        const status = await runLspPrecisionPass({ projectRoot: dir, queries, config });
        expect(status.edgeCounts.degraded).toBeGreaterThan(0);
        expect(status.edgeCounts.skippedByReason['configured-command-unavailable']).toBe(status.edgeCounts.degraded);
        expect(status.coverage.some((record) =>
          record.language === 'typescript' &&
          record.skippedByReason['configured-command-unavailable'] === status.edgeCounts.degraded
        )).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      cg.close();
    }
  });


  it('preserves the primary LSP failure reason when shutdown also fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function helper(): number { return 1; }\n');
    fs.writeFileSync(path.join(dir, 'b.ts'), "import { helper } from './a';\nexport const value = helper();\n");
    const fakeServer = path.join(dir, 'typescript-language-server');
    fs.writeFileSync(fakeServer, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(fakeServer, 0o755);

    const cg = await CodeGraph.init(dir);
    try {
      await cg.indexAll();
      const db = DatabaseConnection.open(getDatabasePath(dir));
      try {
        const queries = new QueryBuilder(db.getDb());
        const config = resolveLspConfig({
          projectRoot: dir,
          cliActivation: 'enable',
          env: {
            CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([fakeServer, '--stdio']),
          },
        });

        const status = await runLspPrecisionPass({
          projectRoot: dir,
          queries,
          config,
          clientFactory: {
            create: () => ({
              initialize: async () => { throw new LspRequestTimeoutError('initialize', 25); },
              request: async () => undefined,
              shutdown: async () => { throw new Error('fixture shutdown failed'); },
            }),
          },
        });

        const server = status.servers.find((record) => record.language === 'typescript');
        expect(server).toMatchObject({
          state: 'timed-out',
          reasonCode: 'initialize-timeout',
        });
        expect(server?.lastError).toContain('shutdown failed');
        expect(status.edgeCounts.skippedByReason['initialize-timeout']).toBeGreaterThan(0);
      } finally {
        db.close();
      }
    } finally {
      cg.close();
    }
  });

  it('degrades a missing server per language while another language still verifies', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const jsServer = makeExecutable(dir, 'javascript-lsp');
    const jsCandidate = makeCandidate({
      edgeId: 2,
      language: 'javascript',
      sourceFilePath: 'javascript/source.js',
      targetFilePath: 'javascript/target.js',
      targetId: 'javascript-target',
    });
    const tsCandidate = makeCandidate({
      edgeId: 1,
      language: 'typescript',
      sourceFilePath: 'typescript/source.ts',
      targetFilePath: 'typescript/target.ts',
      targetId: 'typescript-target',
    });
    const config = resolveLspConfig({
      projectRoot: dir,
      cliActivation: 'enable',
      env: {
        PATH: '',
        CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify(['missing-typescript-lsp', '--stdio']),
        CODEGRAPH_LSP_JAVASCRIPT_COMMAND_JSON: JSON.stringify([jsServer, '--stdio']),
      },
    });

    const status = await runLspPrecisionPass({
      projectRoot: dir,
      queries: mockQueries([tsCandidate, jsCandidate], makeTargetNode({
        id: 'javascript-target',
        language: 'javascript',
        filePath: 'javascript/target.js',
      })),
      config,
      clientFactory: {
        create: () => ({
          initialize: async () => ({ serverInfo: { name: 'fake-js-lsp' } }),
          request: async () => ({
            uri: pathToFileURL(path.join(dir, 'javascript/target.js')).href,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
          }),
          shutdown: async () => undefined,
        }),
      },
    });

    expect(status.servers.find((server) => server.language === 'typescript')).toMatchObject({
      state: 'unavailable',
      reasonCode: 'configured-command-unavailable',
    });
    expect(status.servers.find((server) => server.language === 'javascript')).toMatchObject({
      state: 'initialized',
      observedVersion: 'fake-js-lsp',
    });
    expect(status.edgeCounts.degraded).toBe(1);
    expect(status.edgeCounts.checked).toBe(1);
    expect(status.edgeCounts.verified).toBe(1);
    expect(status.coverage.find((record) => record.language === 'typescript')?.skippedByReason).toEqual({
      'configured-command-unavailable': 1,
    });
  });

  it('processes JSX and TSX candidates through the TypeScript-family server path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const tsServer = makeExecutable(dir, 'typescript-language-server');
    const jsxCandidate = makeCandidate({
      edgeId: 10,
      language: 'jsx',
      sourceId: 'jsx-source',
      targetId: 'jsx-target',
      sourceFilePath: 'jsx/source.jsx',
      targetFilePath: 'jsx/target.jsx',
    });
    const tsxCandidate = makeCandidate({
      edgeId: 11,
      language: 'tsx',
      sourceId: 'tsx-source',
      targetId: 'tsx-target',
      sourceFilePath: 'tsx/source.tsx',
      targetFilePath: 'tsx/target.tsx',
    });
    const targetNodes = new Map([
      ['jsx/target.jsx', makeTargetNode({ id: 'jsx-target', language: 'jsx', filePath: 'jsx/target.jsx' })],
      ['tsx/target.tsx', makeTargetNode({ id: 'tsx-target', language: 'tsx', filePath: 'tsx/target.tsx' })],
    ]);
    const createdLanguages: string[] = [];
    const verifiedEdgeIds: number[] = [];
    const config = resolveLspConfig({
      projectRoot: dir,
      cliActivation: 'enable',
      env: {
        PATH: '',
        CODEGRAPH_LSP_JSX_COMMAND_JSON: JSON.stringify([tsServer, '--stdio']),
        CODEGRAPH_LSP_TSX_COMMAND_JSON: JSON.stringify([tsServer, '--stdio']),
      },
    });

    const status = await runLspPrecisionPass({
      projectRoot: dir,
      queries: {
        getLspEdgeCandidates: (languages: string[]) =>
          [jsxCandidate, tsxCandidate].filter((candidate) => languages.includes(candidate.language)),
        getLspEdgeCandidateCounts: (languages: string[]) => {
          const scoped = [jsxCandidate, tsxCandidate].filter((candidate) => languages.includes(candidate.language));
          return {
            sourceFilesSeen: new Set(scoped.map((candidate) => candidate.sourceFilePath)).size,
            candidateWorkItems: scoped.length,
            fileCapSkippedWorkItems: 0,
            workCapSkippedWorkItems: 0,
          };
        },
        findNodesAtLocation: (filePath: string) => [targetNodes.get(filePath)],
        updateEdgeLspProvenance: (edgeId: number) => {
          verifiedEdgeIds.push(edgeId);
          return 1;
        },
      } as any,
      config,
      clientFactory: {
        create: ({ language }) => {
          createdLanguages.push(language);
          return {
            initialize: async () => ({ serverInfo: { name: `fake-${language}-lsp` } }),
            request: async () => {
              const targetFile = language === 'jsx' ? 'jsx/target.jsx' : 'tsx/target.tsx';
              return {
                uri: pathToFileURL(path.join(dir, targetFile)).href,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
              };
            },
            shutdown: async () => undefined,
          };
        },
      },
    });

    expect(createdLanguages.sort()).toEqual(['jsx', 'tsx']);
    expect(verifiedEdgeIds.sort((a, b) => a - b)).toEqual([10, 11]);
    expect(status.edgeCounts.verified).toBe(2);
    expect(status.coverage.find((record) => record.language === 'jsx')?.checkedWorkItems).toBe(1);
    expect(status.coverage.find((record) => record.language === 'tsx')?.checkedWorkItems).toBe(1);
  });

  it('attempts at most one fresh session restart per language before degrading remaining work', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const tsServer = makeExecutable(dir, 'typescript-lsp');
    const config = resolveLspConfig({
      projectRoot: dir,
      cliActivation: 'enable',
      env: {
        PATH: '',
        CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([tsServer, '--stdio']),
      },
    });
    let createCalls = 0;
    const candidates = [1, 2, 3].map((edgeId) => makeCandidate({ edgeId }));

    const status = await runLspPrecisionPass({
      projectRoot: dir,
      queries: mockQueries(candidates, makeTargetNode()),
      config,
      clientFactory: {
        create: () => {
          createCalls += 1;
          return {
            initialize: async () => ({ serverInfo: { name: `crashy-${createCalls}` } }),
            request: async () => {
              throw new LspClientError('fixture crash', 'server-crash');
            },
            shutdown: async () => undefined,
          };
        },
      },
    });

    expect(createCalls).toBe(2);
    expect(status.servers.find((server) => server.language === 'typescript')).toMatchObject({
      state: 'crashed',
      reasonCode: 'server-crash',
    });
    const coverage = status.coverage.find((record) => record.language === 'typescript');
    expect(coverage?.checkedWorkItems).toBeLessThanOrEqual(coverage?.candidateWorkItems ?? 0);
    expect(status.edgeCounts.checked).toBeLessThanOrEqual(candidates.length);
    expect(status.edgeCounts.degraded).toBe(3);
    expect(coverage?.skippedByReason).toEqual({
      'server-crash': 3,
    });
  });

  it('records shutdown-only failure status without degrading verified work in mock pass', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const tsServer = makeExecutable(dir, 'typescript-lsp');
    const config = resolveLspConfig({
      projectRoot: dir,
      cliActivation: 'enable',
      env: {
        PATH: '',
        CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([tsServer, '--stdio']),
      },
    });

    const status = await runLspPrecisionPass({
      projectRoot: dir,
      queries: mockQueries([makeCandidate()], makeTargetNode()),
      config,
      clientFactory: {
        create: () => ({
          initialize: async () => ({ serverInfo: { name: 'shutdown-failing-ts-lsp' } }),
          request: async () => ({
            uri: pathToFileURL(path.join(dir, 'typescript/target.ts')).href,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
          }),
          shutdown: async () => {
            throw new LspClientError('fixture shutdown failed', 'shutdown-failure');
          },
        }),
      },
    });

    expect(status.servers.find((server) => server.language === 'typescript')).toMatchObject({
      state: 'degraded',
      reasonCode: 'shutdown-failure',
    });
    expect(status.edgeCounts.verified).toBe(1);
    expect(status.edgeCounts.degraded).toBe(0);
    expect(status.coverage.find((record) => record.language === 'typescript')?.skippedByReason).toEqual({});
  });

  it('preserves initialize-timeout as the primary failure when shutdown also fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const tsServer = makeExecutable(dir, 'typescript-lsp');
    const config = resolveLspConfig({
      projectRoot: dir,
      cliActivation: 'enable',
      env: {
        PATH: '',
        CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([tsServer, '--stdio']),
      },
    });

    const status = await runLspPrecisionPass({
      projectRoot: dir,
      queries: mockQueries([makeCandidate()], makeTargetNode()),
      config,
      clientFactory: {
        create: () => ({
          initialize: async () => {
            throw new LspClientError('fixture initialize timed out', 'initialize-timeout');
          },
          request: async () => null,
          shutdown: async () => {
            throw new LspClientError('fixture shutdown failed', 'shutdown-failure');
          },
        }),
      },
    });

    expect(status.servers.find((server) => server.language === 'typescript')).toMatchObject({
      state: 'timed-out',
      reasonCode: 'initialize-timeout',
      lastError: 'fixture initialize timed out; shutdown failed: fixture shutdown failed',
    });
    expect(status.coverage.find((record) => record.language === 'typescript')?.skippedByReason).toMatchObject({
      'initialize-timeout': 1,
    });
    expect(status.coverage.find((record) => record.language === 'typescript')?.skippedByReason['shutdown-failure']).toBeUndefined();
  });

  it('records coverage elapsed time per language instead of cumulatively', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const tsServer = makeExecutable(dir, 'typescript-lsp');
    const jsServer = makeExecutable(dir, 'javascript-lsp');
    let now = 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const config = resolveLspConfig({
        projectRoot: dir,
        cliActivation: 'enable',
        env: {
          PATH: '',
          CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([tsServer, '--stdio']),
          CODEGRAPH_LSP_JAVASCRIPT_COMMAND_JSON: JSON.stringify([jsServer, '--stdio']),
        },
      });
      const candidates = [
        makeCandidate({ edgeId: 1, language: 'typescript', sourceFilePath: 'typescript/source.ts' }),
        makeCandidate({
          edgeId: 2,
          language: 'javascript',
          sourceFilePath: 'javascript/source.js',
          targetId: 'javascript-target',
          targetFilePath: 'javascript/target.js',
        }),
      ];

      const status = await runLspPrecisionPass({
        projectRoot: dir,
        queries: {
          getLspEdgeCandidates: (languages: string[]) =>
            candidates.filter((candidate) => languages.includes(candidate.language)),
          getLspEdgeCandidateCounts: (languages: string[]) => {
            const scoped = candidates.filter((candidate) => languages.includes(candidate.language));
            return {
              sourceFilesSeen: new Set(scoped.map((candidate) => candidate.sourceFilePath)).size,
              candidateWorkItems: scoped.length,
              fileCapSkippedWorkItems: 0,
              workCapSkippedWorkItems: 0,
            };
          },
          findNodesAtLocation: (filePath: string) => [
            makeTargetNode({
              id: filePath === 'javascript/target.js' ? 'javascript-target' : 'typescript-target',
              language: filePath === 'javascript/target.js' ? 'javascript' : 'typescript',
              filePath,
            }),
          ],
          updateEdgeLspProvenance: () => 1,
        } as any,
        config,
        clientFactory: {
          create: ({ language }) => ({
            initialize: async () => {
              now += language === 'typescript' ? 50 : 5;
              return { serverInfo: { name: `fixture-${language}` } };
            },
            request: async () => {
              now += language === 'typescript' ? 20 : 5;
              return {
                uri: pathToFileURL(path.join(dir, language === 'javascript' ? 'javascript/target.js' : 'typescript/target.ts')).href,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
              };
            },
            shutdown: async () => {
              now += language === 'typescript' ? 10 : 5;
            },
          }),
        },
      });

      const tsElapsed = status.coverage.find((record) => record.language === 'typescript')?.elapsedMs;
      const jsElapsed = status.coverage.find((record) => record.language === 'javascript')?.elapsedMs;
      expect(tsElapsed).toBe(80);
      expect(jsElapsed).toBe(15);
      expect(status.performance.lspElapsedMs).toBe(95);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('enforces full-index caps, bounded batches, and session/request high-water status', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const tsServer = makeExecutable(dir, 'typescript-lsp');
    const config = resolveLspConfig({
      projectRoot: dir,
      cliActivation: 'enable',
      env: {
        PATH: '',
        CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([tsServer, '--stdio']),
      },
    });
    const candidates = [
      makeCandidate({ edgeId: 1, sourceFilePath: 'a.ts' }),
      makeCandidate({ edgeId: 2, sourceFilePath: 'a.ts' }),
      makeCandidate({ edgeId: 3, sourceFilePath: 'b.ts' }),
      makeCandidate({ edgeId: 4, sourceFilePath: 'b.ts' }),
      makeCandidate({ edgeId: 5, sourceFilePath: 'c.ts' }),
      makeCandidate({ edgeId: 6, sourceFilePath: 'd.ts' }),
      makeCandidate({ edgeId: 7, sourceFilePath: 'e.ts' }),
    ];
    const startedRequests: number[] = [];
    const resolvers: Array<(value: unknown) => void> = [];

    const pass = runLspPrecisionPass({
      projectRoot: dir,
      queries: mockQueries(candidates, makeTargetNode()),
      config,
      structuralElapsedMs: 5,
      performanceCaps: {
        activeSessionsPerProject: 2,
        inFlightRequestsPerSession: 2,
        fullIndexSourceFilesPerLanguage: 2,
        fullIndexWorkItemsPerLanguage: 3,
        fullIndexBatchSize: 2,
        watchChangedSourceFilesPerBatch: 100,
        watchWorkItemsPerLanguagePerBatch: 1000,
      },
      clientFactory: {
        create: () => ({
          initialize: async () => ({ serverInfo: { name: 'bounded-ts-lsp' } }),
          request: async () => {
            startedRequests.push(startedRequests.length + 1);
            return new Promise((resolve) => {
              resolvers.push(resolve);
            });
          },
          shutdown: async () => undefined,
        }),
      },
    });

    await waitUntil(() => startedRequests.length === 2);
    expect(startedRequests).toEqual([1, 2]);
    for (const resolve of resolvers.splice(0)) {
      resolve({
        uri: pathToFileURL(path.join(dir, 'typescript/target.ts')).href,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      });
    }
    await waitUntil(() => startedRequests.length === 3);
    for (const resolve of resolvers.splice(0)) {
      resolve({
        uri: pathToFileURL(path.join(dir, 'typescript/target.ts')).href,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      });
    }

    const status = await pass;
    const coverage = status.coverage.find((record) => record.language === 'typescript');

    expect(coverage).toMatchObject({
      sourceFilesSeen: 5,
      candidateWorkItems: 7,
      checkedWorkItems: 3,
      skippedByReason: {
        'full-index-file-cap-exceeded': 3,
        'full-index-work-cap-exceeded': 1,
      },
      capExceededReasons: ['full-index-file-cap-exceeded', 'full-index-work-cap-exceeded'],
    });
    expect(status.edgeCounts.checked).toBe(3);
    expect(status.edgeCounts.skippedByReason).toEqual({
      'full-index-file-cap-exceeded': 3,
      'full-index-work-cap-exceeded': 1,
    });
    expect(status.performance.activeSessionHighWatermark).toBe(1);
    expect(status.performance.inFlightRequestHighWatermark).toBe(2);
    expect(status.performance.caps.fullIndexBatchSize).toBe(2);
    expect(status.performance.structuralElapsedMs).toBe(5);
    expect(status.performance.lspElapsedMs).toBeGreaterThanOrEqual(0);
    expect(status.performance.enabledOverheadRatio).toBeGreaterThanOrEqual(1);
  });

  it('normalizes Location and LocationLink targets by selection range and deduplicates them', async () => {
    const { normalizeLspTargets } = await import('../src/lsp');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const uri = pathToFileURL(path.join(dir, 'src/target.ts')).href;

    const targets = normalizeLspTargets(dir, [
      {
        uri,
        range: { start: { line: 8, character: 4 }, end: { line: 8, character: 10 } },
      },
      {
        targetUri: uri,
        targetRange: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } },
        targetSelectionRange: { start: { line: 8, character: 4 }, end: { line: 8, character: 10 } },
      },
    ]);

    expect(targets).toEqual([
      {
        uri,
        filePath: 'src/target.ts',
        line: 9,
        character: 4,
      },
    ]);
  });

  it('retargets a corrected edge and leaves exactly one active edge at the call site', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const tsServer = makeExecutable(dir, 'typescript-lsp');
    const db = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    try {
      const queries = new QueryBuilder(db.getDb());
      insertTestNode(queries, {
        id: 'source',
        name: 'caller',
        qualifiedName: 'caller',
        filePath: 'src/caller.ts',
        startLine: 1,
        endLine: 20,
      });
      insertTestNode(queries, {
        id: 'wrong-target',
        name: 'helper',
        qualifiedName: 'wrong.helper',
        filePath: 'src/wrong.ts',
        startLine: 1,
      });
      insertTestNode(queries, {
        id: 'correct-target',
        kind: 'method',
        name: 'helper',
        qualifiedName: 'correct.helper',
        filePath: 'src/correct.ts',
        startLine: 3,
      });
      insertTestNode(queries, {
        id: 'correct-container',
        kind: 'class',
        name: 'Container',
        qualifiedName: 'Container',
        filePath: 'src/correct.ts',
        startLine: 1,
        endLine: 20,
      });
      queries.insertEdge({ source: 'source', target: 'wrong-target', kind: 'calls', line: 10, column: 8, provenance: 'tree-sitter' });
      queries.insertEdge({ source: 'source', target: 'correct-target', kind: 'calls', line: 10, column: 8, provenance: 'tree-sitter' });
      const getCandidates = queries.getLspEdgeCandidates.bind(queries);
      queries.getLspEdgeCandidates = (...args) =>
        getCandidates(...args).filter((candidate) => candidate.targetId === 'wrong-target');

      const status = await runLspPrecisionPass({
        projectRoot: dir,
        queries,
        config: resolveLspConfig({
          projectRoot: dir,
          cliActivation: 'enable',
          env: {
            PATH: '',
            CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([tsServer, '--stdio']),
          },
        }),
        clientFactory: {
          create: () => ({
            initialize: async () => ({ serverInfo: { name: 'correcting-ts-lsp' } }),
            request: async () => ({
              uri: pathToFileURL(path.join(dir, 'src/correct.ts')).href,
              range: { start: { line: 2, character: 0 }, end: { line: 2, character: 20 } },
            }),
            shutdown: async () => undefined,
          }),
        },
      });

      const active = queries.getOutgoingEdges('source', ['calls']);
      const raw = rawEdgeRows(db.getDb());
      const suppressed = raw.find((edge) => edge.target === 'wrong-target');
      const activeMetadata = active[0]?.metadata?.lsp as Record<string, unknown> | undefined;
      const suppressedMetadata = suppressed?.metadata ? JSON.parse(suppressed.metadata).lsp : undefined;

      expect(status.edgeCounts.corrected).toBe(1);
      expect(active).toHaveLength(1);
      expect(active[0]?.target).toBe('correct-target');
      expect(active[0]?.provenance).toBe('lsp');
      expect(activeMetadata).toMatchObject({
        decision: 'corrected',
        active: true,
        previousTargetId: 'wrong-target',
      });
      expect(raw).toHaveLength(2);
      expect(suppressedMetadata).toMatchObject({
        decision: 'suppressed',
        active: false,
        replacementTargetId: 'correct-target',
      });
    } finally {
      db.close();
    }
  });

  it('preserves inactive audit metadata when a corrected edge reuses its unique identity', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const db = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    try {
      const queries = new QueryBuilder(db.getDb());
      insertTestNode(queries, {
        id: 'source',
        name: 'caller',
        qualifiedName: 'caller',
        filePath: 'src/caller.ts',
        startLine: 1,
        endLine: 20,
      });
      insertTestNode(queries, {
        id: 'wrong-target',
        name: 'helper',
        qualifiedName: 'wrong.helper',
        filePath: 'src/wrong.ts',
        startLine: 1,
      });
      insertTestNode(queries, {
        id: 'correct-target',
        name: 'helper',
        qualifiedName: 'correct.helper',
        filePath: 'src/correct.ts',
        startLine: 1,
      });
      queries.insertEdge({ source: 'source', target: 'wrong-target', kind: 'calls', line: 10, column: 8, provenance: 'tree-sitter' });
      queries.insertEdge({
        source: 'source',
        target: 'correct-target',
        kind: 'calls',
        line: 10,
        column: 8,
        provenance: 'lsp',
        metadata: {
          lsp: {
            decision: 'suppressed',
            active: false,
            reason: 'external-target',
          },
        },
      });
      const wrong = rawEdgeRows(db.getDb()).find((edge) => edge.target === 'wrong-target');
      expect(wrong).toBeDefined();

      const changes = queries.retargetEdgeWithLspCorrection(
        wrong!.id,
        'correct-target',
        {
          lsp: {
            decision: 'corrected',
            active: true,
            previousTargetId: 'wrong-target',
          },
        },
        {
          lsp: {
            decision: 'suppressed',
            active: false,
            replacementTargetId: 'correct-target',
          },
        },
      );

      const active = queries.getOutgoingEdges('source', ['calls']);
      const raw = rawEdgeRows(db.getDb());
      const corrected = raw.find((edge) => edge.target === 'correct-target');
      const correctedMetadata = corrected?.metadata ? JSON.parse(corrected.metadata).lsp : undefined;

      expect(changes).toBe(1);
      expect(raw).toHaveLength(2);
      expect(active).toHaveLength(1);
      expect(active[0]?.target).toBe('correct-target');
      expect(correctedMetadata).toMatchObject({
        decision: 'corrected',
        active: true,
        previousInactiveAudit: {
          lsp: {
            decision: 'suppressed',
            active: false,
            reason: 'external-target',
          },
        },
      });
    } finally {
      db.close();
    }
  });

  it('excludes inactive LSP audit edges from candidate counts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const db = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    try {
      const queries = new QueryBuilder(db.getDb());
      insertTestNode(queries, {
        id: 'source',
        name: 'caller',
        qualifiedName: 'caller',
        filePath: 'src/caller.ts',
        startLine: 1,
        endLine: 20,
      });
      insertTestNode(queries, {
        id: 'active-target',
        name: 'active',
        qualifiedName: 'active',
        filePath: 'src/active.ts',
        startLine: 1,
      });
      insertTestNode(queries, {
        id: 'inactive-target',
        name: 'inactive',
        qualifiedName: 'inactive',
        filePath: 'src/inactive.ts',
        startLine: 1,
      });

      queries.insertEdge({ source: 'source', target: 'active-target', kind: 'calls', line: 10, column: 4, provenance: 'tree-sitter' });
      queries.insertEdge({
        source: 'source',
        target: 'inactive-target',
        kind: 'calls',
        line: 11,
        column: 4,
        provenance: 'lsp',
        metadata: {
          lsp: {
            decision: 'suppressed',
            active: false,
            reason: 'external-target',
          },
        },
      });

      expect(queries.getLspEdgeCandidates(['typescript'], 10).map((candidate) => candidate.targetId)).toEqual(['active-target']);
      expect(queries.getLspEdgeCandidateCounts(['typescript'])).toMatchObject({
        sourceFilesSeen: 1,
        candidateWorkItems: 1,
        fileCapSkippedWorkItems: 0,
        workCapSkippedWorkItems: 0,
      });
    } finally {
      db.close();
    }
  });

  it('reactivates an inactive LSP audit edge when structural indexing emits the same edge again', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const db = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    try {
      const queries = new QueryBuilder(db.getDb());
      insertTestNode(queries, {
        id: 'source',
        name: 'caller',
        qualifiedName: 'caller',
        filePath: 'src/caller.ts',
        startLine: 1,
      });
      insertTestNode(queries, {
        id: 'target',
        name: 'callee',
        qualifiedName: 'callee',
        filePath: 'src/callee.ts',
        startLine: 1,
      });

      queries.insertEdge({ source: 'source', target: 'target', kind: 'calls', line: 10, column: 4, provenance: 'tree-sitter' });
      const edgeId = rawEdgeRows(db.getDb())[0]!.id;
      queries.suppressEdgeWithLspAudit(edgeId, {
        lsp: {
          decision: 'suppressed',
          active: false,
          reason: 'unindexed-target',
        },
      });
      expect(queries.getOutgoingEdges('source', ['calls'])).toEqual([]);

      queries.insertEdge({ source: 'source', target: 'target', kind: 'calls', line: 10, column: 4, provenance: 'tree-sitter' });

      const raw = rawEdgeRows(db.getDb());
      expect(raw).toHaveLength(1);
      expect(raw[0]).toMatchObject({
        source: 'source',
        target: 'target',
        kind: 'calls',
        metadata: null,
        provenance: 'tree-sitter',
      });
      expect(queries.getOutgoingEdges('source', ['calls'])).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('suppresses external, generated, and unindexed LSP targets without creating graph nodes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const tsServer = makeExecutable(dir, 'typescript-lsp');
    const db = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    try {
      const queries = new QueryBuilder(db.getDb());
      insertTestNode(queries, {
        id: 'source',
        name: 'caller',
        qualifiedName: 'caller',
        filePath: 'src/caller.ts',
        startLine: 1,
        endLine: 20,
      });
      insertTestNode(queries, {
        id: 'wrong-target',
        name: 'helper',
        qualifiedName: 'wrong.helper',
        filePath: 'src/wrong.ts',
        startLine: 1,
      });
      queries.insertEdge({ source: 'source', target: 'wrong-target', kind: 'calls', line: 10, column: 4, provenance: 'tree-sitter' });
      queries.insertEdge({ source: 'source', target: 'wrong-target', kind: 'calls', line: 11, column: 4, provenance: 'tree-sitter' });
      queries.insertEdge({ source: 'source', target: 'wrong-target', kind: 'calls', line: 12, column: 4, provenance: 'tree-sitter' });
      const before = queries.getNodeAndEdgeCount();

      const status = await runLspPrecisionPass({
        projectRoot: dir,
        queries,
        config: resolveLspConfig({
          projectRoot: dir,
          cliActivation: 'enable',
          env: {
            PATH: '',
            CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([tsServer, '--stdio']),
          },
        }),
        clientFactory: {
          create: () => ({
            initialize: async () => ({ serverInfo: { name: 'suppressing-ts-lsp' } }),
            request: async (_method, params) => {
              const line = (params.position as { line: number }).line + 1;
              const targetPath = line === 10
                ? path.join(os.tmpdir(), 'external-target.ts')
                : line === 11
                  ? path.join(dir, 'src/generated.pb.ts')
                  : path.join(dir, 'src/unindexed.ts');
              return {
                uri: pathToFileURL(targetPath).href,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
              };
            },
            shutdown: async () => undefined,
          }),
        },
      });

      const after = queries.getNodeAndEdgeCount();
      const raw = rawEdgeRows(db.getDb());
      const suppressionDecisions = raw.map((edge) => JSON.parse(edge.metadata ?? '{}').lsp);

      expect(after.nodes).toBe(before.nodes);
      expect(after.edges).toBe(before.edges);
      expect(status.edgeCounts.suppressed).toBe(3);
      expect(queries.getOutgoingEdges('source', ['calls'])).toEqual([]);
      expect(suppressionDecisions).toEqual([
        expect.objectContaining({ decision: 'suppressed', active: false, reason: 'external-target' }),
        expect.objectContaining({ decision: 'suppressed', active: false, reason: 'generated-target' }),
        expect.objectContaining({ decision: 'suppressed', active: false, reason: 'unindexed-target' }),
      ]);
    } finally {
      db.close();
    }
  });

  it('leaves ambiguous LSP definitions as a no-op without speculative replacement edges', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    const tsServer = makeExecutable(dir, 'typescript-lsp');
    const db = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    try {
      const queries = new QueryBuilder(db.getDb());
      insertTestNode(queries, {
        id: 'source',
        name: 'caller',
        qualifiedName: 'caller',
        filePath: 'src/caller.ts',
        startLine: 1,
        endLine: 20,
      });
      insertTestNode(queries, {
        id: 'wrong-target',
        name: 'helper',
        qualifiedName: 'wrong.helper',
        filePath: 'src/wrong.ts',
        startLine: 1,
      });
      insertTestNode(queries, {
        id: 'candidate-a',
        name: 'helper',
        qualifiedName: 'a.helper',
        filePath: 'src/a.ts',
        startLine: 1,
      });
      insertTestNode(queries, {
        id: 'candidate-b',
        name: 'helper',
        qualifiedName: 'b.helper',
        filePath: 'src/b.ts',
        startLine: 1,
      });
      queries.insertEdge({ source: 'source', target: 'wrong-target', kind: 'calls', line: 10, column: 4, provenance: 'tree-sitter' });

      const status = await runLspPrecisionPass({
        projectRoot: dir,
        queries,
        config: resolveLspConfig({
          projectRoot: dir,
          cliActivation: 'enable',
          env: {
            PATH: '',
            CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([tsServer, '--stdio']),
          },
        }),
        clientFactory: {
          create: () => ({
            initialize: async () => ({ serverInfo: { name: 'ambiguous-ts-lsp' } }),
            request: async () => ([
              {
                uri: pathToFileURL(path.join(dir, 'src/a.ts')).href,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
              },
              {
                uri: pathToFileURL(path.join(dir, 'src/b.ts')).href,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
              },
            ]),
            shutdown: async () => undefined,
          }),
        },
      });

      const active = queries.getOutgoingEdges('source', ['calls']);
      const raw = rawEdgeRows(db.getDb());

      expect(status.edgeCounts.skippedByReason).toEqual({ 'language-not-applicable': 1 });
      expect(active).toHaveLength(1);
      expect(active[0]?.target).toBe('wrong-target');
      expect(raw.filter((edge) => edge.target === 'candidate-a' || edge.target === 'candidate-b')).toEqual([]);
    } finally {
      db.close();
    }
  });
});
