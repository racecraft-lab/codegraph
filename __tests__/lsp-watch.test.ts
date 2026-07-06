import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FileWatcher } from '../src';
import {
  LspClientError,
  defaultLspPerformanceCaps,
  resolveLspConfig,
  runLspPrecisionPass,
} from '../src/lsp';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-watch-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  return dir;
}

function makeExecutable(dir: string, name: string): string {
  const executable = path.join(dir, name);
  fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(executable, 0o755);
  return executable;
}

function makeConfig(projectRoot: string, command: string) {
  return resolveLspConfig({
    projectRoot,
    cliActivation: 'enable',
    env: {
      PATH: '',
      CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([command, '--stdio']),
    },
  });
}

function makeCandidate(overrides: Record<string, unknown> = {}): any {
  const edgeId = overrides.edgeId ?? 1;
  const sourceFilePath = overrides.sourceFilePath ?? 'src/changed.ts';
  return {
    edgeId,
    sourceId: `source-${edgeId}`,
    targetId: 'target',
    kind: 'calls',
    line: 1,
    column: 0,
    provenance: 'tree-sitter',
    metadata: undefined,
    sourceFilePath,
    language: 'typescript',
    targetFilePath: 'src/target.ts',
    targetStartLine: 1,
    targetEndLine: 1,
    targetStartColumn: 0,
    targetEndColumn: 10,
    targetKind: 'function',
    targetName: 'target',
    ...overrides,
  };
}

function mockQueries(candidates: any[]): any {
  return {
    getLspEdgeCandidates: (languages: string[], limit: number) =>
      candidates
        .filter((candidate) => languages.includes(candidate.language))
        .slice(0, limit),
    findNodesAtLocation: () => [{
      id: 'target',
      kind: 'function',
      name: 'target',
      qualifiedName: 'target',
      filePath: 'src/target.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 10,
      visibility: 'public',
      isExported: true,
      isAsync: false,
      isStatic: false,
      isAbstract: false,
    }],
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

describe('LSP watch verification', () => {
  it('passes a bounded material changed-file batch to the debounced sync callback', async () => {
    const dir = makeTempProject();
    const contexts: any[] = [];
    const watcher = new FileWatcher(
      dir,
      async (context?: any) => {
        contexts.push(context);
        return { filesChanged: 2, durationMs: 1 };
      },
      { debounceMs: 1, inertForTests: true },
    );

    try {
      expect(watcher.start()).toBe(true);
      await watcher.waitUntilReady();

      watcher.ingestEventForTests('src/changed.ts');
      watcher.ingestEventForTests('src/also-changed.ts');
      watcher.ingestEventForTests('README.md');

      await waitUntil(() => contexts.length === 1);
      expect(contexts[0]?.changedSourceFiles).toEqual(['src/changed.ts', 'src/also-changed.ts']);
      expect(contexts[0]?.materialBatchKey).toBe('src/also-changed.ts\nsrc/changed.ts');
    } finally {
      watcher.stop();
    }
  });

  it('runs watch precision only for candidates sourced from the bounded changed-file set', async () => {
    const dir = makeTempProject();
    const server = makeExecutable(dir, 'typescript-lsp');
    const requestedFiles: string[] = [];
    const sourceFileFilters: unknown[] = [];
    const queries = mockQueries([
      makeCandidate({ edgeId: 1, sourceFilePath: 'src/changed.ts' }),
      makeCandidate({ edgeId: 2, sourceFilePath: 'src/untouched.ts' }),
    ]);
    const originalGetCandidates = queries.getLspEdgeCandidates;
    queries.getLspEdgeCandidates = (languages: string[], limit: number, sourceFilePaths?: readonly string[]) => {
      sourceFileFilters.push(sourceFilePaths);
      return originalGetCandidates(languages, limit, sourceFilePaths);
    };

    const status = await runLspPrecisionPass({
      projectRoot: dir,
      queries,
      config: makeConfig(dir, server),
      watch: {
        changedSourceFiles: ['src/changed.ts'],
        restartBudget: new Map(),
      },
      clientFactory: {
        create: () => ({
          initialize: async () => ({ serverInfo: { name: 'watch-ts-lsp' } }),
          request: async (_method, params: any) => {
            requestedFiles.push(fileURLToPath(params.textDocument.uri).split(path.sep).join('/'));
            return {
              uri: pathToFileURL(path.join(dir, 'src/target.ts')).href,
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
            };
          },
          shutdown: async () => undefined,
        }),
      },
    } as any);

    expect(status.edgeCounts.checked).toBe(1);
    expect(status.edgeCounts.verified).toBe(1);
    expect(requestedFiles).toEqual([path.join(dir, 'src/changed.ts').split(path.sep).join('/')]);
    expect(sourceFileFilters).not.toHaveLength(0);
    expect(sourceFileFilters.every((filter) => (filter as string[] | undefined)?.join('\n') === 'src/changed.ts')).toBe(true);
  });

  it('records absent, unbounded, and oversized changed-file skip reasons without probing servers', async () => {
    const dir = makeTempProject();
    const server = makeExecutable(dir, 'typescript-lsp');
    const cases = [
      {
        changedSourceFiles: undefined,
        expected: { 'watch-changed-files-absent': 1 },
      },
      {
        changedSourceFiles: 'unbounded',
        expected: { 'watch-changed-files-unbounded': 1 },
      },
      {
        changedSourceFiles: Array.from({ length: 101 }, (_, index) => `src/f${index}.ts`),
        expected: { 'watch-changed-files-cap-exceeded': 101 },
      },
    ];

    for (const testCase of cases) {
      let createCalls = 0;
      const status = await runLspPrecisionPass({
        projectRoot: dir,
        queries: mockQueries([makeCandidate()]),
        config: makeConfig(dir, server),
        watch: {
          changedSourceFiles: testCase.changedSourceFiles,
          restartBudget: new Map(),
        },
        clientFactory: {
          create: () => {
            createCalls += 1;
            return {
              initialize: async () => ({ serverInfo: { name: 'should-not-start' } }),
              request: async () => null,
              shutdown: async () => undefined,
            };
          },
        },
      } as any);

      expect(createCalls).toBe(0);
      expect(status.edgeCounts.skippedByReason).toEqual(testCase.expected);
      expect(status.coverage[0]?.skippedByReason).toEqual(testCase.expected);
    }
  });

  it('skips watch verification for a language whose changed-file candidate work exceeds the cap', async () => {
    const dir = makeTempProject();
    const server = makeExecutable(dir, 'typescript-lsp');
    let createCalls = 0;
    const caps = {
      ...defaultLspPerformanceCaps(),
      watchWorkItemsPerLanguagePerBatch: 2,
    };

    const status = await runLspPrecisionPass({
      projectRoot: dir,
      queries: mockQueries([1, 2, 3].map((edgeId) => makeCandidate({ edgeId }))),
      config: makeConfig(dir, server),
      performanceCaps: caps,
      watch: {
        changedSourceFiles: ['src/changed.ts'],
        restartBudget: new Map(),
      },
      clientFactory: {
        create: () => {
          createCalls += 1;
          return {
            initialize: async () => ({ serverInfo: { name: 'should-not-start' } }),
            request: async () => null,
            shutdown: async () => undefined,
          };
        },
      },
    } as any);

    expect(createCalls).toBe(0);
    expect(status.edgeCounts.skippedByReason).toEqual({ 'watch-work-cap-exceeded': 3 });
    expect(status.coverage[0]).toMatchObject({
      language: 'typescript',
      candidateWorkItems: 3,
      skippedByReason: { 'watch-work-cap-exceeded': 3 },
      capExceededReasons: ['watch-work-cap-exceeded'],
    });
  });

  it('reuses an exhausted restart budget for the same material watch batch and resets for a new batch', async () => {
    const dir = makeTempProject();
    const server = makeExecutable(dir, 'typescript-lsp');
    const restartBudget = new Map();
    let createCalls = 0;
    const clientFactory = {
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
    };

    const baseOptions = {
      projectRoot: dir,
      config: makeConfig(dir, server),
      clientFactory,
    };

    const first = await runLspPrecisionPass({
      ...baseOptions,
      queries: mockQueries([1, 2, 3].map((edgeId) => makeCandidate({ edgeId, sourceFilePath: 'src/changed.ts' }))),
      watch: { changedSourceFiles: ['src/changed.ts'], restartBudget },
    } as any);
    expect(createCalls).toBe(2);
    expect(first.edgeCounts.degraded).toBe(3);

    const second = await runLspPrecisionPass({
      ...baseOptions,
      queries: mockQueries([1, 2, 3].map((edgeId) => makeCandidate({ edgeId, sourceFilePath: 'src/changed.ts' }))),
      watch: { changedSourceFiles: ['src/changed.ts'], restartBudget },
    } as any);
    expect(createCalls).toBe(2);
    expect(second.edgeCounts.degraded).toBe(3);

    const third = await runLspPrecisionPass({
      ...baseOptions,
      queries: mockQueries([1, 2, 3].map((edgeId) => makeCandidate({ edgeId, sourceFilePath: 'src/new-change.ts' }))),
      watch: { changedSourceFiles: ['src/new-change.ts'], restartBudget },
    } as any);
    expect(createCalls).toBe(4);
    expect(third.edgeCounts.degraded).toBe(3);
  });
});
