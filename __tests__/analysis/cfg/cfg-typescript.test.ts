import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CodeGraph } from '../../../src/index';
import { setCfgParserOverrideForTests, type CfgGraph, type CfgReadResult } from '../../../src/analysis/cfg';

type FixtureCase = {
  readonly fileName: string;
  readonly label: string;
  readonly requiredSnippets: readonly string[];
};

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'tsjs');
const tempDirs: string[] = [];
const openGraphs: CodeGraph[] = [];
const OVER_LIMIT_IF_COUNT = 5_001;
const FINALLY_CLONE_LIMIT_RETURN_COUNT = 3_000;

const FIXTURES: readonly FixtureCase[] = [
  {
    fileName: 'baseline.ts',
    label: 'baseline',
    requiredSnippets: ['export function baselineScore', 'if (input > 10)', 'return total;'],
  },
  {
    fileName: 'unsupported.js',
    label: 'unsupported',
    requiredSnippets: ['export async function* unsupportedStream', 'yield await Promise.resolve'],
  },
  {
    fileName: 'over-limit.ts',
    label: 'over-limit',
    requiredSnippets: ['export function overLimitBranches', 'case 24:', 'return total;'],
  },
  {
    fileName: 'throw-finally.js',
    label: 'throw-finally',
    requiredSnippets: ['export function throwFinally', 'throw new Error', 'finally'],
  },
  {
    fileName: 'short-circuit.ts',
    label: 'short-circuit',
    requiredSnippets: ['export function shortCircuit', '&&', '||'],
  },
  {
    fileName: 'switch.js',
    label: 'switch',
    requiredSnippets: ['export function switchRoute', 'case \'start\':', 'default:'],
  },
  {
    fileName: 'optional-chaining.ts',
    label: 'optional-chaining',
    requiredSnippets: ['export function optionalChain', '?.', 'profile?.name'],
  },
  {
    fileName: 'nullish-coalescing.js',
    label: 'nullish-coalescing',
    requiredSnippets: ['export function nullishCoalesce', '??', 'config.retryCount ?? 3'],
  },
  {
    fileName: 'nested-functions.ts',
    label: 'nested-functions',
    requiredSnippets: ['export function outerWorkflow', 'function innerStep', 'const finish ='],
  },
  {
    fileName: 'unreachable.js',
    label: 'unreachable',
    requiredSnippets: ['export function unreachableBranch', 'return \'early\';', 'return \'unreachable\';'],
  },
  {
    fileName: 'no-op.ts',
    label: 'no-op',
    requiredSnippets: ['export function noOpFixture', 'return undefined;'],
  },
];

function generatedOverLimitFunction(): string {
  const lines = [
    'export function overBlockLimit(input: number): number {',
    '  let total = input;',
  ];
  for (let index = 0; index < OVER_LIMIT_IF_COUNT; index++) {
    lines.push(`  if (input === ${index}) {`, `    total = ${index};`, '  }');
  }
  lines.push('  return total;', '}', '');
  return lines.join('\n');
}

function generatedFinallyCloneOverLimitFunction(): string {
  const lines = [
    'export function finallyCloneBlockLimit(input: number): number {',
    '  try {',
  ];
  for (let index = 0; index < FINALLY_CLONE_LIMIT_RETURN_COUNT; index++) {
    lines.push(`    if (input === ${index}) {`, `      return ${index};`, '    }');
  }
  lines.push(
    '    return input;',
    '  } finally {',
    '    input += 1;',
    '    input += 2;',
    '  }',
    '}',
    '',
  );
  return lines.join('\n');
}

function createCfgProject(files: Readonly<Record<string, string>>): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-tsjs-'));
  tempDirs.push(projectRoot);
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'codegraph.json'),
    JSON.stringify({ analysis: { cfg: true } }, null, 2),
  );

  for (const [fileName, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(projectRoot, 'src', fileName), source);
  }

  return projectRoot;
}

async function indexFunctionResult(
  fileName: string,
  functionName: string,
  source: string,
): Promise<{ db: any; functionId: string; result: CfgReadResult }> {
  const projectRoot = createCfgProject({ [fileName]: source });
  const graph = await CodeGraph.init(projectRoot, { index: true });
  openGraphs.push(graph);
  const db = (graph as unknown as { db: { getDb(): any } }).db.getDb();
  const functionRow = db
    .prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?')
    .get(`src/${fileName}`, functionName) as { id: string } | undefined;

  expect(functionRow?.id).toBeTruthy();

  const result = graph.getCfg(functionRow!.id, { limit: 100, offset: 0 });

  return { db, functionId: functionRow!.id, result };
}

async function indexFunctionCfg(fileName: string, functionName: string, source: string): Promise<CfgGraph> {
  const { functionId, result } = await indexFunctionResult(fileName, functionName, source);

  expect(result).toMatchObject({
    analysis: 'cfg',
    functionId,
    message: '',
    reason: null,
    sourceVersion: expect.stringMatching(/^cfgsrc:v1:/),
    stale: false,
    state: 'available',
  });
  expect(result.cfg).not.toBeNull();
  expect(result.page).toEqual({
    blocks: {
      hasMore: false,
      nextOffset: null,
      returned: result.cfg!.blocks.length,
      total: result.cfg!.blocks.length,
    },
    edges: {
      hasMore: false,
      nextOffset: null,
      returned: result.cfg!.edges.length,
      total: result.cfg!.edges.length,
    },
    limit: 100,
    offset: 0,
  });

  return result.cfg!;
}

function edgeRolePaths(cfg: CfgGraph): string[] {
  const blockLabels = new Map(cfg.blocks.map((block) => [block.id, `${block.ordinal}:${block.role}`]));
  return cfg.edges.map((edge) => `${blockLabels.get(edge.source)} -${edge.kind}-> ${blockLabels.get(edge.target)}`);
}

describe('TypeScript/JavaScript CFG fixtures', () => {
  afterEach(() => {
    while (openGraphs.length > 0) {
      openGraphs.pop()?.destroy();
    }

    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { force: true, recursive: true });
    }
  });

  it('keeps the deterministic fixture inventory for baseline CFG coverage', () => {
    const entries = fs.existsSync(FIXTURE_DIR)
      ? fs.readdirSync(FIXTURE_DIR, { withFileTypes: true })
      : [];
    const fileNames = entries.map((entry) => entry.name).sort();

    expect(fileNames).toEqual(FIXTURES.map((fixture) => fixture.fileName).sort());
    expect(entries.every((entry) => entry.isFile())).toBe(true);

    for (const fixture of FIXTURES) {
      const source = fs.readFileSync(path.join(FIXTURE_DIR, fixture.fileName), 'utf8');

      expect(source).toContain(`cfg-case: ${fixture.label}`);
      expect(source.endsWith('\n')).toBe(true);
      expect(source).not.toContain('\r');

      for (const snippet of fixture.requiredSnippets) {
        expect(source).toContain(snippet);
      }
    }
  });

  it('indexes a linear TypeScript function as an available persisted CFG', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-tsjs-'));
    tempDirs.push(projectRoot);
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'codegraph.json'),
      JSON.stringify({ analysis: { cfg: true } }, null, 2),
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'linear.ts'),
      [
        'export function linearScore(input: number): number {',
        '  const total = input;',
        '  return total;',
        '}',
        '',
      ].join('\n'),
    );

    const graph = await CodeGraph.init(projectRoot, { index: true });
    openGraphs.push(graph);
    const db = (graph as unknown as { db: { getDb(): any } }).db.getDb();
    const functionRow = db
      .prepare(
        "SELECT id FROM nodes WHERE file_path = 'src/linear.ts' AND name = 'linearScore'",
      )
      .get() as { id: string } | undefined;

    expect(functionRow?.id).toBeTruthy();

    const result = graph.getCfg(functionRow!.id, { limit: 10, offset: 0 });

    expect(Object.keys(result).sort()).toEqual([
      'analysis',
      'cfg',
      'functionId',
      'message',
      'page',
      'reason',
      'sourceVersion',
      'stale',
      'state',
    ]);
    expect(result).toMatchObject({
      analysis: 'cfg',
      functionId: functionRow!.id,
      message: '',
      reason: null,
      stale: false,
      state: 'available',
    });
    expect(result.sourceVersion).toMatch(/^cfgsrc:v1:/);
    expect(result.cfg).not.toBeNull();
    expect(result.page).not.toBeNull();

    const cfg = result.cfg!;
    const page = result.page!;
    expect(cfg).toMatchObject({
      analysis: 'cfg',
      functionId: functionRow!.id,
      language: 'typescript',
      sourceVersion: result.sourceVersion,
    });
    expect(cfg.blocks.map((block) => block.role)).toEqual(['entry', 'body', 'exit']);
    expect(cfg.blocks.map((block) => block.ordinal)).toEqual([0, 1, 2]);
    expect(cfg.blocks[1].spans).toEqual([
      expect.objectContaining({
        endLine: expect.any(Number),
        startLine: expect.any(Number),
      }),
    ]);
    expect(cfg.edges.map((edge) => edge.kind)).toEqual(['fallthrough', 'return']);
    expect(cfg.edges[0]).toMatchObject({
      source: cfg.blocks[0].id,
      target: cfg.blocks[1].id,
    });
    expect(cfg.edges[1]).toMatchObject({
      source: cfg.blocks[1].id,
      target: cfg.blocks[2].id,
    });
    expect(page).toEqual({
      blocks: {
        hasMore: false,
        nextOffset: null,
        returned: 3,
        total: 3,
      },
      edges: {
        hasMore: false,
        nextOffset: null,
        returned: 2,
        total: 2,
      },
      limit: 10,
      offset: 0,
    });
    expect(
      db.prepare('SELECT state FROM cfg_status WHERE function_id = ?').get(functionRow!.id),
    ).toEqual({ state: 'available' });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cfg_blocks WHERE function_id = ?').get(functionRow!.id),
    ).toEqual({ count: 3 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cfg_edges WHERE function_id = ?').get(functionRow!.id),
    ).toEqual({ count: 2 });
  });

  it('keeps CFG reads byte-equivalent across repeated unchanged re-indexes', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-tsjs-stable-'));
    tempDirs.push(projectRoot);
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'codegraph.json'),
      JSON.stringify({ analysis: { cfg: true } }, null, 2),
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'stable.ts'),
      [
        'export function stableScore(input: number): number {',
        '  const total = input;',
        '  return total;',
        '}',
        '',
      ].join('\n'),
    );

    const graph = await CodeGraph.init(projectRoot, { index: true });
    openGraphs.push(graph);
    const snapshots: Array<{
      blockIds: string[];
      blockRoles: string[];
      blockOrdinals: number[];
      edgeKinds: string[];
      edgePairs: string[];
      functionId: string;
      graphId: string;
      serialized: string;
    }> = [];

    for (let run = 0; run < 3; run++) {
      if (run > 0) {
        await graph.indexAll();
      }

      const db = (graph as unknown as { db: { getDb(): any } }).db.getDb();
      const functionRow = db
        .prepare(
          "SELECT id FROM nodes WHERE file_path = 'src/stable.ts' AND name = 'stableScore'",
        )
        .get() as { id: string } | undefined;

      expect(functionRow?.id).toBeTruthy();

      const result = graph.getCfg(functionRow!.id, { limit: 10, offset: 0 });

      expect(result.state).toBe('available');
      expect(result.cfg).not.toBeNull();
      snapshots.push({
        blockIds: result.cfg!.blocks.map((block) => block.id),
        blockRoles: result.cfg!.blocks.map((block) => block.role),
        blockOrdinals: result.cfg!.blocks.map((block) => block.ordinal),
        edgeKinds: result.cfg!.edges.map((edge) => edge.kind),
        edgePairs: result.cfg!.edges.map((edge) => `${edge.source}->${edge.target}`),
        functionId: functionRow!.id,
        graphId: result.cfg!.graphId,
        serialized: JSON.stringify(result),
      });
    }

    expect(snapshots).toHaveLength(3);
    for (const snapshot of snapshots) {
      expect(snapshot).toEqual(snapshots[0]);
      expect(Buffer.compare(Buffer.from(snapshot.serialized), Buffer.from(snapshots[0].serialized))).toBe(0);
    }
  });

  it('persists the committed throw/finally fixture with path-precise pending transfers', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'throw-finally.js'), 'utf8');
    const cfg = await indexFunctionCfg('throw-finally.js', 'throwFinally', source);

    expect(cfg.blocks.map((block) => block.role)).toEqual([
      'entry',
      'body',
      'condition',
      'body',
      'body',
      'body',
      'body',
      'body',
      'body',
      'exit',
    ]);
    expect(edgeRolePaths(cfg)).toEqual([
      '0:entry -fallthrough-> 1:body',
      '1:body -fallthrough-> 2:condition',
      '2:condition -true-> 3:body',
      '2:condition -false-> 4:body',
      '3:body -finally-> 5:body',
      '4:body -finally-> 7:body',
      '5:body -fallthrough-> 6:body',
      '6:body -throw-> 9:exit',
      '7:body -fallthrough-> 8:body',
      '8:body -return-> 9:exit',
    ]);
    expect(cfg.edges.filter((edge) => edge.kind === 'throw')).toHaveLength(1);
    expect(cfg.edges.filter((edge) => edge.kind === 'finally')).toHaveLength(2);
    expect(cfg.blocks.filter((block) => block.role === 'entry')).toHaveLength(1);
    expect(cfg.blocks.filter((block) => block.role === 'exit')).toHaveLength(1);
  });

  it('materializes an empty finally block so pending transfers still enter finally', async () => {
    const cfg = await indexFunctionCfg(
      'empty-finally.ts',
      'emptyFinallyStillRuns',
      [
        'export function emptyFinallyStillRuns(value: number): number {',
        '  try {',
        '    return value;',
        '  } finally {',
        '  }',
        '}',
        '',
      ].join('\n'),
    );

    expect(cfg.blocks.map((block) => block.role)).toEqual(['entry', 'body', 'body', 'exit']);
    expect(edgeRolePaths(cfg)).toEqual([
      '0:entry -fallthrough-> 1:body',
      '1:body -finally-> 2:body',
      '2:body -return-> 3:exit',
    ]);
  });

  it('lets a return in finally supersede a pending throw from try', async () => {
    const cfg = await indexFunctionCfg(
      'finally-return-overrides-throw.ts',
      'finallyReturnOverridesThrow',
      [
        'export function finallyReturnOverridesThrow(value: number): number {',
        '  try {',
        "    throw new Error('boom');",
        '  } finally {',
        '    return value;',
        '  }',
        '}',
        '',
      ].join('\n'),
    );

    expect(cfg.blocks.map((block) => block.role)).toEqual(['entry', 'body', 'body', 'exit']);
    expect(edgeRolePaths(cfg)).toEqual([
      '0:entry -fallthrough-> 1:body',
      '1:body -finally-> 2:body',
      '2:body -return-> 3:exit',
    ]);
    expect(cfg.edges.filter((edge) => edge.kind === 'throw')).toHaveLength(0);
    expect(cfg.edges.filter((edge) => edge.kind === 'return')).toHaveLength(1);
  });

  it('lets a throw in finally supersede a pending return from try', async () => {
    const cfg = await indexFunctionCfg(
      'finally-throw-overrides-return.ts',
      'finallyThrowOverridesReturn',
      [
        'export function finallyThrowOverridesReturn(value: number): number {',
        '  try {',
        '    return value;',
        '  } finally {',
        "    throw new Error('cleanup');",
        '  }',
        '}',
        '',
      ].join('\n'),
    );

    expect(cfg.blocks.map((block) => block.role)).toEqual(['entry', 'body', 'body', 'exit']);
    expect(edgeRolePaths(cfg)).toEqual([
      '0:entry -fallthrough-> 1:body',
      '1:body -finally-> 2:body',
      '2:body -throw-> 3:exit',
    ]);
    expect(cfg.edges.filter((edge) => edge.kind === 'return')).toHaveLength(0);
    expect(cfg.edges.filter((edge) => edge.kind === 'throw')).toHaveLength(1);
  });

  it('persists resource_limited when finally cloning exceeds the block cap after estimation', async () => {
    const { db, functionId, result } = await indexFunctionResult(
      'finally-clone-limit.ts',
      'finallyCloneBlockLimit',
      generatedFinallyCloneOverLimitFunction(),
    );

    expect(result).toMatchObject({
      analysis: 'cfg',
      cfg: null,
      functionId,
      page: null,
      reason: 'block_limit_exceeded',
      sourceVersion: expect.stringMatching(/^cfgsrc:v1:/),
      stale: false,
      state: 'resource_limited',
    });
    expect(
      db.prepare('SELECT state, reason FROM cfg_status WHERE function_id = ?').get(functionId),
    ).toEqual({ state: 'resource_limited', reason: 'block_limit_exceeded' });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cfg_blocks WHERE function_id = ?').get(functionId),
    ).toEqual({ count: 0 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cfg_edges WHERE function_id = ?').get(functionId),
    ).toEqual({ count: 0 });
  });

  it.each([
    {
      fileName: 'unsupported-language.go',
      functionName: 'unsupportedLanguageSkip',
      reason: 'unsupported_language',
      source: [
        'package main',
        '',
        'func unsupportedLanguageSkip(value int) int {',
        '  return value',
        '}',
        '',
      ].join('\n'),
    },
    {
      fileName: 'unsupported-construct.ts',
      functionName: 'unsupportedConstructSkip',
      reason: 'unsupported_construct',
      source: [
        'export function unsupportedConstructSkip(input: number): number {',
        '  for (let index = 0; index < input; index++) {',
        '    input += index;',
        '  }',
        '  return input;',
        '}',
        '',
      ].join('\n'),
    },
    {
      fileName: 'parser-unavailable.ts',
      functionName: 'parserUnavailableSkip',
      reason: 'parser_unavailable',
      source: [
        'export function parserUnavailableSkip(input: number): number {',
        '  return input;',
        '}',
        '',
      ].join('\n'),
    },
    {
      fileName: 'parse-error.ts',
      functionName: 'parseErrorSkip',
      reason: 'parse_error',
      source: [
        'export function parseErrorSkip(input: number): number {',
        '  return input;',
        '}',
        'const broken =',
        '',
      ].join('\n'),
    },
    {
      fileName: 'parse-unsafe.ts',
      functionName: 'parseUnsafeSkip',
      reason: 'parse_unsafe_region',
      source: [
        'export function parseUnsafeSkip(input: number): number {',
        '  const total = ;',
        '  return input;',
        '}',
        '',
      ].join('\n'),
    },
    {
      fileName: 'deferred-expression-branch.ts',
      functionName: 'deferredExpressionBranchSkip',
      reason: 'unsupported_construct',
      source: [
        'export function deferredExpressionBranchSkip(input?: { count?: number; ready?: boolean }): number {',
        '  const total = input?.ready && ((input.count ?? 0) > 0) ? input.count ?? 0 : 0;',
        '  return total;',
        '}',
        '',
      ].join('\n'),
    },
    {
      fileName: 'deferred-if-condition.ts',
      functionName: 'deferredIfConditionSkip',
      reason: 'unsupported_construct',
      source: [
        'export function deferredIfConditionSkip(input: { count: number; ready: boolean }): number {',
        '  if (input.ready && input.count > 0) {',
        '    return input.count;',
        '  }',
        '  return 0;',
        '}',
        '',
      ].join('\n'),
    },
  ])('persists whole-function skip state for $reason', async ({ fileName, functionName, reason, source }) => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-tsjs-skip-'));
    tempDirs.push(projectRoot);
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'codegraph.json'),
      JSON.stringify({ analysis: { cfg: true } }, null, 2),
    );
    fs.writeFileSync(path.join(projectRoot, 'src', fileName), source);

    if (reason === 'parser_unavailable') {
      setCfgParserOverrideForTests('typescript', null);
    }

    try {
      const graph = await CodeGraph.init(projectRoot, { index: true });
      openGraphs.push(graph);
      const db = (graph as unknown as { db: { getDb(): any } }).db.getDb();
      const functionRow = db
        .prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?')
        .get(`src/${fileName}`, functionName) as { id: string } | undefined;

      expect(functionRow?.id).toBeTruthy();

      const result = graph.getCfg(functionRow!.id, { limit: 10, offset: 0 });

      expect(result).toMatchObject({
        analysis: 'cfg',
        cfg: null,
        functionId: functionRow!.id,
        page: null,
        reason,
        sourceVersion: expect.stringMatching(/^cfgsrc:v1:/),
        stale: false,
        state: 'unsupported',
      });
      expect(result.message).not.toContain('return input');
      expect([...result.message].length).toBeLessThanOrEqual(240);
      expect(
        db.prepare('SELECT state, reason FROM cfg_status WHERE function_id = ?').get(functionRow!.id),
      ).toEqual({ state: 'unsupported', reason });
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM cfg_blocks WHERE function_id = ?').get(functionRow!.id),
      ).toEqual({ count: 0 });
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM cfg_edges WHERE function_id = ?').get(functionRow!.id),
      ).toEqual({ count: 0 });
    } finally {
      if (reason === 'parser_unavailable') {
        setCfgParserOverrideForTests('typescript', undefined);
      }
    }
  });

  it('persists resource_limited for a generated function whose CFG demand exceeds the block cap', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-tsjs-limit-'));
    tempDirs.push(projectRoot);
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'codegraph.json'),
      JSON.stringify({ analysis: { cfg: true } }, null, 2),
    );
    fs.writeFileSync(path.join(projectRoot, 'src', 'over-limit.ts'), generatedOverLimitFunction());

    const graph = await CodeGraph.init(projectRoot, { index: true });
    openGraphs.push(graph);
    const db = (graph as unknown as { db: { getDb(): any } }).db.getDb();
    const functionRow = db
      .prepare("SELECT id FROM nodes WHERE file_path = 'src/over-limit.ts' AND name = 'overBlockLimit'")
      .get() as { id: string } | undefined;

    expect(functionRow?.id).toBeTruthy();

    const result = graph.getCfg(functionRow!.id, { limit: 10, offset: 0 });

    expect(result).toMatchObject({
      analysis: 'cfg',
      cfg: null,
      functionId: functionRow!.id,
      page: null,
      reason: 'block_limit_exceeded',
      sourceVersion: expect.stringMatching(/^cfgsrc:v1:/),
      stale: false,
      state: 'resource_limited',
    });
    expect([...result.message].length).toBeLessThanOrEqual(240);
    expect(
      db.prepare('SELECT state, reason FROM cfg_status WHERE function_id = ?').get(functionRow!.id),
    ).toEqual({ state: 'resource_limited', reason: 'block_limit_exceeded' });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cfg_blocks WHERE function_id = ?').get(functionRow!.id),
    ).toEqual({ count: 0 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cfg_edges WHERE function_id = ?').get(functionRow!.id),
    ).toEqual({ count: 0 });
  });
});
