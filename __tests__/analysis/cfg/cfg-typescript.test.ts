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

type FunctionNodeRow = {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly qualified_name: string;
  readonly start_line: number;
  readonly start_column: number;
  readonly end_line: number;
  readonly end_column: number;
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

function generatedHugeNestedFunctionSource(): string {
  const lines = [
    'export function wrapperWithHugeNested(): number {',
    '  function hugeNested(value: number): number {',
    '    let total = value;',
  ];
  for (let index = 0; index < OVER_LIMIT_IF_COUNT; index++) {
    lines.push(`    if (value === ${index}) {`, `      total = ${index};`, '    }');
  }
  lines.push(
    '    return total;',
    '  }',
    '  return 1;',
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

async function indexCfgProject(
  files: Readonly<Record<string, string>>,
): Promise<{ db: any; graph: CodeGraph; projectRoot: string }> {
  const projectRoot = createCfgProject(files);
  const graph = await CodeGraph.init(projectRoot, { index: true });
  openGraphs.push(graph);
  const db = (graph as unknown as { db: { getDb(): any } }).db.getDb();
  return { db, graph, projectRoot };
}

function functionRowsForFile(db: any, fileName: string): FunctionNodeRow[] {
  return db
    .prepare(
      [
        'SELECT id, kind, name, qualified_name, start_line, start_column, end_line, end_column',
        'FROM nodes',
        'WHERE file_path = ? AND kind IN (\'function\', \'method\')',
        'ORDER BY start_line, start_column, end_line, end_column, name',
      ].join(' '),
    )
    .all(`src/${fileName}`) as FunctionNodeRow[];
}

function requireFunctionRow(rows: readonly FunctionNodeRow[], name: string): FunctionNodeRow {
  const matches = rows.filter((row) => row.name === name || row.qualified_name.endsWith(`::${name}`));
  expect(matches, `expected exactly one function row for ${name}`).toHaveLength(1);
  return matches[0]!;
}

function readAvailableCfg(graph: CodeGraph, row: FunctionNodeRow): CfgGraph {
  const result = graph.getCfg(row.id, { limit: 100, offset: 0 });
  expect(result).toMatchObject({
    analysis: 'cfg',
    cfg: expect.any(Object),
    functionId: row.id,
    message: '',
    reason: null,
    sourceVersion: expect.stringMatching(/^cfgsrc:v1:/),
    stale: false,
    state: 'available',
  });
  expect(result.cfg).not.toBeNull();
  return result.cfg!;
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

function edgeTextPaths(cfg: CfgGraph, source: string): string[] {
  const blockLabels = new Map(cfg.blocks.map((block) => [block.id, blockTextLabel(source, block)]));
  return cfg.edges.map((edge) => `${blockLabels.get(edge.source)} -${edge.kind}-> ${blockLabels.get(edge.target)}`);
}

function blockTextLabel(source: string, block: CfgGraph['blocks'][number]): string {
  const text = block.spans[0] ? spanText(source, block.spans[0]) : '';
  return text ? `${block.ordinal}:${block.role}:${text}` : `${block.ordinal}:${block.role}`;
}

function spanText(source: string, span: CfgGraph['blocks'][number]['spans'][number]): string {
  const lines = source.split('\n');
  const startLine = lines[span.startLine - 1] ?? '';
  if (span.startLine === span.endLine) {
    return startLine.slice(span.startColumn, span.endColumn).replace(/\s+/g, ' ').trim();
  }

  const parts = [startLine.slice(span.startColumn)];
  for (let line = span.startLine; line < span.endLine - 1; line++) {
    parts.push(lines[line] ?? '');
  }
  parts.push((lines[span.endLine - 1] ?? '').slice(0, span.endColumn));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
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

  it('persists the committed short-circuit fixture with branch-gated RHS evaluation', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'short-circuit.ts'), 'utf8');
    const cfg = await indexFunctionCfg('short-circuit.ts', 'shortCircuit', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:user',
      '1:condition:user -true-> 2:condition:user.active',
      '1:condition:user -false-> 5:body:return Boolean(user && user.active && (user.role === \'admin\' || user.role === \'owner\'));',
      '2:condition:user.active -true-> 3:condition:user.role === \'admin\'',
      '2:condition:user.active -false-> 5:body:return Boolean(user && user.active && (user.role === \'admin\' || user.role === \'owner\'));',
      '3:condition:user.role === \'admin\' -true-> 5:body:return Boolean(user && user.active && (user.role === \'admin\' || user.role === \'owner\'));',
      '3:condition:user.role === \'admin\' -false-> 4:body:user.role === \'owner\'',
      '4:body:user.role === \'owner\' -fallthrough-> 5:body:return Boolean(user && user.active && (user.role === \'admin\' || user.role === \'owner\'));',
      '5:body:return Boolean(user && user.active && (user.role === \'admin\' || user.role === \'owner\')); -return-> 6:exit',
    ]);
  });

  it('persists the committed optional-chain fixture with non-nullish-gated continuation', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'optional-chaining.ts'), 'utf8');
    const cfg = await indexFunctionCfg('optional-chaining.ts', 'optionalChain', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:user',
      '1:condition:user -true-> 2:condition:user?.profile',
      '1:condition:user -false-> 5:body:\'anonymous\'',
      '2:condition:user?.profile -true-> 3:body:user?.profile?.name',
      '2:condition:user?.profile -false-> 5:body:\'anonymous\'',
      '3:body:user?.profile?.name -fallthrough-> 4:condition:user?.profile?.name',
      '4:condition:user?.profile?.name -true-> 6:body:return user?.profile?.name ?? \'anonymous\';',
      '4:condition:user?.profile?.name -false-> 5:body:\'anonymous\'',
      '5:body:\'anonymous\' -fallthrough-> 6:body:return user?.profile?.name ?? \'anonymous\';',
      '6:body:return user?.profile?.name ?? \'anonymous\'; -return-> 7:exit',
    ]);
  });

  it('persists the committed nullish-coalescing fixture with fallback-only RHS evaluation', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'nullish-coalescing.js'), 'utf8');
    const cfg = await indexFunctionCfg('nullish-coalescing.js', 'nullishCoalesce', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:config.retryCount',
      '1:condition:config.retryCount -true-> 3:body:const retryCount = config.retryCount ?? 3;',
      '1:condition:config.retryCount -false-> 2:body:3',
      '2:body:3 -fallthrough-> 3:body:const retryCount = config.retryCount ?? 3;',
      '3:body:const retryCount = config.retryCount ?? 3; -fallthrough-> 4:condition:config.timeoutMs',
      '4:condition:config.timeoutMs -true-> 6:body:const timeoutMs = config.timeoutMs ?? 1000;',
      '4:condition:config.timeoutMs -false-> 5:body:1000',
      '5:body:1000 -fallthrough-> 6:body:const timeoutMs = config.timeoutMs ?? 1000;',
      '6:body:const timeoutMs = config.timeoutMs ?? 1000; -fallthrough-> 7:body:return retryCount * timeoutMs;',
      '7:body:return retryCount * timeoutMs; -return-> 8:exit',
    ]);
  });

  it('persists the committed switch fixture with ordered case and default dispatch', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'switch.js'), 'utf8');
    const cfg = await indexFunctionCfg('switch.js', 'switchRoute', source);
    const paths = edgeTextPaths(cfg, source);

    expect(cfg.blocks.map((block) => blockTextLabel(source, block))).toEqual([
      '0:entry',
      '1:condition:state',
      '2:body:return \'queued\';',
      '3:body:return \'active\';',
      '4:body:return \'done\';',
      '5:body:return \'unknown\';',
      '6:exit',
    ]);
    expect(paths).toEqual(expect.arrayContaining([
      '0:entry -fallthrough-> 1:condition:state',
      '1:condition:state -case-> 2:body:return \'queued\';',
      '1:condition:state -case-> 3:body:return \'active\';',
      '1:condition:state -case-> 4:body:return \'done\';',
      '1:condition:state -default-> 5:body:return \'unknown\';',
      '2:body:return \'queued\'; -return-> 6:exit',
      '3:body:return \'active\'; -return-> 6:exit',
      '4:body:return \'done\'; -return-> 6:exit',
      '5:body:return \'unknown\'; -return-> 6:exit',
    ]));
    expect(paths).toHaveLength(9);
  });

  it('persists real switch fallthrough and break to the switch successor', async () => {
    const source = [
      'export function switchFallthroughProbe(value: string): number {',
      '  let total = 0;',
      '  switch (value) {',
      "    case 'a':",
      '      total += 1;',
      "    case 'b':",
      '      total += 2;',
      '      break;',
      '    default:',
      '      total += 3;',
      '  }',
      '  return total;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('switch-fallthrough-probe.ts', 'switchFallthroughProbe', source);
    const paths = edgeTextPaths(cfg, source);

    expect(cfg.blocks.map((block) => blockTextLabel(source, block))).toEqual([
      '0:entry',
      '1:body:let total = 0;',
      '2:condition:value',
      '3:body:total += 1;',
      '4:body:total += 2;',
      '5:body:break;',
      '6:body:total += 3;',
      '7:body:return total;',
      '8:exit',
    ]);
    expect(paths).toEqual(expect.arrayContaining([
      '0:entry -fallthrough-> 1:body:let total = 0;',
      '1:body:let total = 0; -fallthrough-> 2:condition:value',
      '2:condition:value -case-> 3:body:total += 1;',
      '2:condition:value -case-> 4:body:total += 2;',
      '2:condition:value -default-> 6:body:total += 3;',
      '3:body:total += 1; -fallthrough-> 4:body:total += 2;',
      '4:body:total += 2; -fallthrough-> 5:body:break;',
      '5:body:break; -break-> 7:body:return total;',
      '6:body:total += 3; -fallthrough-> 7:body:return total;',
      '7:body:return total; -return-> 8:exit',
    ]));
    expect(paths).toHaveLength(10);
  });

  it('persists an unmatched switch dispatch without an explicit default as a default edge', async () => {
    const source = [
      'export function switchMissingDefaultProbe(value: string): number {',
      '  switch (value) {',
      "    case 'ready':",
      '      return 1;',
      '  }',
      '  return 0;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('switch-missing-default-probe.ts', 'switchMissingDefaultProbe', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:value',
      '1:condition:value -case-> 2:body:return 1;',
      '1:condition:value -default-> 3:body:return 0;',
      '2:body:return 1; -return-> 4:exit',
      '3:body:return 0; -return-> 4:exit',
    ]);
  });

  it('fails closed when a switch case label requires runtime evaluation', async () => {
    const source = [
      'function nextCase(): string {',
      "  return 'ready';",
      '}',
      '',
      'export function dynamicSwitchCaseProbe(value: string): number {',
      '  switch (value) {',
      '    case nextCase():',
      '      return 1;',
      '    default:',
      '      return 0;',
      '  }',
      '}',
      '',
    ].join('\n');
    const { db, functionId, result } = await indexFunctionResult(
      'dynamic-switch-case-probe.ts',
      'dynamicSwitchCaseProbe',
      source,
    );

    expect(result).toMatchObject({
      analysis: 'cfg',
      cfg: null,
      functionId,
      page: null,
      reason: 'unsupported_construct',
      stale: false,
      state: 'unsupported',
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cfg_blocks WHERE function_id = ?').get(functionId),
    ).toEqual({ count: 0 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cfg_edges WHERE function_id = ?').get(functionId),
    ).toEqual({ count: 0 });
  });

  it('persists branchy switch discriminants before case dispatch', async () => {
    const source = [
      'export function branchySwitchProbe(config?: { mode?: string }, fallback = \'idle\'): number {',
      '  switch (config?.mode ?? fallback) {',
      "    case 'ready':",
      '      return 1;',
      '  }',
      '  return 0;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('branchy-switch-probe.ts', 'branchySwitchProbe', source);
    const paths = edgeTextPaths(cfg, source);

    expect(paths).toEqual(expect.arrayContaining([
      '0:entry -fallthrough-> 1:condition:config',
      '1:condition:config -true-> 2:body:config?.mode',
      '1:condition:config -false-> 4:body:fallback',
      '2:body:config?.mode -fallthrough-> 3:condition:config?.mode',
      '3:condition:config?.mode -true-> 5:condition:config?.mode ?? fallback',
      '3:condition:config?.mode -false-> 4:body:fallback',
      '4:body:fallback -fallthrough-> 5:condition:config?.mode ?? fallback',
      '5:condition:config?.mode ?? fallback -case-> 6:body:return 1;',
      '5:condition:config?.mode ?? fallback -default-> 7:body:return 0;',
      '6:body:return 1; -return-> 8:exit',
      '7:body:return 0; -return-> 8:exit',
    ]));
    expect(paths).toHaveLength(11);
  });

  it('persists a ternary initializer with exactly one evaluated arm before merge', async () => {
    const source = [
      'export function ternaryProbe(flag: boolean): number {',
      '  const selected = flag ? first() : second();',
      '  return selected;',
      '}',
      '',
      'function first(): number { return 1; }',
      'function second(): number { return 2; }',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('ternary-probe.ts', 'ternaryProbe', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:flag',
      '1:condition:flag -true-> 2:body:first()',
      '1:condition:flag -false-> 3:body:second()',
      '2:body:first() -fallthrough-> 4:body:const selected = flag ? first() : second();',
      '3:body:second() -fallthrough-> 4:body:const selected = flag ? first() : second();',
      '4:body:const selected = flag ? first() : second(); -fallthrough-> 5:body:return selected;',
      '5:body:return selected; -return-> 6:exit',
    ]);
  });

  it('persists branchy expressions nested inside ordinary member wrappers', async () => {
    const source = [
      'export function nestedWrapperProbe(obj?: { values?: string[] }): number {',
      '  const length = (obj?.values ?? []).length;',
      '  return length;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('nested-wrapper-probe.ts', 'nestedWrapperProbe', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:obj',
      '1:condition:obj -true-> 2:body:obj?.values',
      '1:condition:obj -false-> 4:body:[]',
      '2:body:obj?.values -fallthrough-> 3:condition:obj?.values',
      '3:condition:obj?.values -true-> 5:body:(obj?.values ?? []).length',
      '3:condition:obj?.values -false-> 4:body:[]',
      '4:body:[] -fallthrough-> 5:body:(obj?.values ?? []).length',
      '5:body:(obj?.values ?? []).length -fallthrough-> 6:body:const length = (obj?.values ?? []).length;',
      '6:body:const length = (obj?.values ?? []).length; -fallthrough-> 7:body:return length;',
      '7:body:return length; -return-> 8:exit',
    ]);
  });

  it('persists optional member calls and optional calls without invoking skipped callees', async () => {
    const source = [
      'export function optionalCallProbe(obj?: { method?: () => number }, fn?: () => number): number {',
      '  const methodValue = obj?.method?.() ?? 0;',
      '  const fnValue = fn?.() ?? 1;',
      '  return methodValue + fnValue;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('optional-call-probe.ts', 'optionalCallProbe', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:obj',
      '1:condition:obj -true-> 2:body:obj?.method',
      '1:condition:obj -false-> 6:body:0',
      '2:body:obj?.method -fallthrough-> 3:condition:obj?.method',
      '3:condition:obj?.method -true-> 4:body:obj?.method?.()',
      '3:condition:obj?.method -false-> 6:body:0',
      '4:body:obj?.method?.() -fallthrough-> 5:condition:obj?.method?.()',
      '5:condition:obj?.method?.() -true-> 7:body:const methodValue = obj?.method?.() ?? 0;',
      '5:condition:obj?.method?.() -false-> 6:body:0',
      '6:body:0 -fallthrough-> 7:body:const methodValue = obj?.method?.() ?? 0;',
      '7:body:const methodValue = obj?.method?.() ?? 0; -fallthrough-> 8:condition:fn',
      '8:condition:fn -true-> 9:body:fn?.()',
      '8:condition:fn -false-> 11:body:1',
      '9:body:fn?.() -fallthrough-> 10:condition:fn?.()',
      '10:condition:fn?.() -true-> 12:body:const fnValue = fn?.() ?? 1;',
      '10:condition:fn?.() -false-> 11:body:1',
      '11:body:1 -fallthrough-> 12:body:const fnValue = fn?.() ?? 1;',
      '12:body:const fnValue = fn?.() ?? 1; -fallthrough-> 13:body:return methodValue + fnValue;',
      '13:body:return methodValue + fnValue; -return-> 14:exit',
    ]);
  });

  it('persists optional subscript evaluation through non-nullish receivers only', async () => {
    const source = [
      'export function optionalSubscriptProbe(obj: { values?: number[] } | null, key: number): number {',
      '  const item = obj?.values?.[key] ?? 2;',
      '  return item;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('optional-subscript-probe.ts', 'optionalSubscriptProbe', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:obj',
      '1:condition:obj -true-> 2:body:obj?.values',
      '1:condition:obj -false-> 6:body:2',
      '2:body:obj?.values -fallthrough-> 3:condition:obj?.values',
      '3:condition:obj?.values -true-> 4:body:obj?.values?.[key]',
      '3:condition:obj?.values -false-> 6:body:2',
      '4:body:obj?.values?.[key] -fallthrough-> 5:condition:obj?.values?.[key]',
      '5:condition:obj?.values?.[key] -true-> 7:body:const item = obj?.values?.[key] ?? 2;',
      '5:condition:obj?.values?.[key] -false-> 6:body:2',
      '6:body:2 -fallthrough-> 7:body:const item = obj?.values?.[key] ?? 2;',
      '7:body:const item = obj?.values?.[key] ?? 2; -fallthrough-> 8:body:return item;',
      '8:body:return item; -return-> 9:exit',
    ]);
  });

  it('persists the committed nested fixture as separate CFGs without inlining nested bodies', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'nested-functions.ts'), 'utf8');
    const { db, graph } = await indexCfgProject({ 'nested-functions.ts': source });
    const rows = functionRowsForFile(db, 'nested-functions.ts');

    expect(rows.map((row) => row.name).sort()).toEqual(['innerStep', 'outerWorkflow']);
    const outer = requireFunctionRow(rows, 'outerWorkflow');
    const inner = requireFunctionRow(rows, 'innerStep');
    expect(new Set([outer.id, inner.id]).size).toBe(2);
    expect([outer.id, inner.id].every((id) => id.startsWith('function:'))).toBe(true);

    const outerCfg = readAvailableCfg(graph, outer);
    expect(outerCfg.blocks.map((block) => block.role)).toEqual(['entry', 'body', 'body', 'body', 'exit']);
    expect(outerCfg.blocks.slice(1, -1).map((block) => spanText(source, block.spans[0]!))).toEqual([
      'function innerStep(item: string): string { return item.trim().toUpperCase(); }',
      'const finish = (item: string): string => `${innerStep(item)}!`;',
      'return items.map(finish);',
    ]);
    expect(edgeRolePaths(outerCfg)).toEqual([
      '0:entry -fallthrough-> 1:body',
      '1:body -fallthrough-> 2:body',
      '2:body -fallthrough-> 3:body',
      '3:body -return-> 4:exit',
    ]);

    const innerCfg = readAvailableCfg(graph, inner);
    expect(edgeTextPaths(innerCfg, source)).toEqual([
      '0:entry -fallthrough-> 1:body:return item.trim().toUpperCase();',
      '1:body:return item.trim().toUpperCase(); -return-> 2:exit',
    ]);

  });

  it('keeps extracted function expressions, arrows, and local class methods separate from enclosing CFGs', async () => {
    const source = [
      'export const topArrowBoundary = (value: string): string => {',
      "  if (value === 'x') {",
      '    return value;',
      '  }',
      "  return 'empty';",
      '};',
      'export const topExpressionBoundary = function(value: string): string {',
      '  if (value.length > 0) {',
      '    return value.trim();',
      '  }',
      "  return 'empty';",
      '};',
      'export function functionBoundaryProbe(input: string): string {',
      '  const viaExpression = function(value: string): string {',
      '    if (value.length > 0) {',
      '      return value.trim();',
      '    }',
      "    return 'empty';",
      '  };',
      '  const viaArrow = (value: string): string => {',
      "    if (value === 'x') {",
      '      return viaExpression(value);',
      '    }',
      '    return value;',
      '  };',
      '  class LocalWorker {',
      '    run(value: string): string {',
      '      if (value.length > 1) {',
      '        return viaArrow(value);',
      '      }',
      "      return 'short';",
      '    }',
      '  }',
      '  const worker = new LocalWorker();',
      '  return worker.run(input);',
      '}',
      '',
    ].join('\n');
    const { db, graph } = await indexCfgProject({ 'function-boundary-probe.ts': source });
    const rows = functionRowsForFile(db, 'function-boundary-probe.ts');

    for (const name of ['topArrowBoundary', 'topExpressionBoundary', 'functionBoundaryProbe', 'run']) {
      const row = requireFunctionRow(rows, name);
      expect(row.id).toMatch(row.kind === 'method' ? /^method:/ : /^function:/);
    }

    const outerCfg = readAvailableCfg(graph, requireFunctionRow(rows, 'functionBoundaryProbe'));
    expect(outerCfg.blocks.map((block) => block.role)).toEqual([
      'entry',
      'body',
      'body',
      'body',
      'body',
      'body',
      'exit',
    ]);
    expect(outerCfg.blocks.slice(1, -1).map((block) => spanText(source, block.spans[0]!))).toEqual([
      "const viaExpression = function(value: string): string { if (value.length > 0) { return value.trim(); } return 'empty'; };",
      "const viaArrow = (value: string): string => { if (value === 'x') { return viaExpression(value); } return value; };",
      "class LocalWorker { run(value: string): string { if (value.length > 1) { return viaArrow(value); } return 'short'; } }",
      'const worker = new LocalWorker();',
      'return worker.run(input);',
    ]);
    expect(outerCfg.blocks.some((block) => block.role === 'condition')).toBe(false);

    for (const name of ['topArrowBoundary', 'topExpressionBoundary', 'run']) {
      const cfg = readAvailableCfg(graph, requireFunctionRow(rows, name));
      expect(cfg.blocks.map((block) => block.role)).toContain('condition');
    }
  });

  it('resolves same-name nested functions by exact indexed span before name fallback', async () => {
    const source = [
      'export function sameName(value: number): number {',
      '  function sameName(value: number): number {',
      '    return value + 1;',
      '  }',
      '  return sameName(value);',
      '}',
      '',
    ].join('\n');
    const { db, graph } = await indexCfgProject({ 'same-name-boundary.ts': source });
    const rows = functionRowsForFile(db, 'same-name-boundary.ts').filter((row) => row.name === 'sameName');

    expect(rows).toHaveLength(2);
    const [outer, inner] = rows;
    expect(outer!.id).not.toBe(inner!.id);

    const outerCfg = readAvailableCfg(graph, outer!);
    const innerCfg = readAvailableCfg(graph, inner!);

    expect(outerCfg.blocks.slice(1, -1).map((block) => spanText(source, block.spans[0]!))).toEqual([
      'function sameName(value: number): number { return value + 1; }',
      'return sameName(value);',
    ]);
    expect(edgeTextPaths(outerCfg, source)).toEqual([
      '0:entry -fallthrough-> 1:body:function sameName(value: number): number { return value + 1; }',
      '1:body:function sameName(value: number): number { return value + 1; } -fallthrough-> 2:body:return sameName(value);',
      '2:body:return sameName(value); -return-> 3:exit',
    ]);
    expect(edgeTextPaths(innerCfg, source)).toEqual([
      '0:entry -fallthrough-> 1:body:return value + 1;',
      '1:body:return value + 1; -return-> 2:exit',
    ]);
  });

  it('does not resource-limit an enclosing CFG because a nested function exceeds the block cap', async () => {
    const source = generatedHugeNestedFunctionSource();
    const { db, graph } = await indexCfgProject({ 'huge-nested-function.ts': source });
    const rows = functionRowsForFile(db, 'huge-nested-function.ts');
    const wrapper = requireFunctionRow(rows, 'wrapperWithHugeNested');
    const nested = requireFunctionRow(rows, 'hugeNested');

    const wrapperCfg = readAvailableCfg(graph, wrapper);
    const bodyLabels = wrapperCfg.blocks.slice(1, -1).map((block) => spanText(source, block.spans[0]!));

    expect(wrapperCfg.blocks.map((block) => block.role)).toEqual(['entry', 'body', 'body', 'exit']);
    expect(bodyLabels[0]!.startsWith('function hugeNested(value: number): number { let total = value;')).toBe(true);
    expect(bodyLabels[1]).toBe('return 1;');
    expect(edgeRolePaths(wrapperCfg)).toEqual([
      '0:entry -fallthrough-> 1:body',
      '1:body -fallthrough-> 2:body',
      '2:body -return-> 3:exit',
    ]);

    const nestedResult = graph.getCfg(nested.id, { limit: 100, offset: 0 });
    expect(nestedResult).toMatchObject({
      analysis: 'cfg',
      cfg: null,
      functionId: nested.id,
      page: null,
      reason: 'block_limit_exceeded',
      sourceVersion: expect.stringMatching(/^cfgsrc:v1:/),
      stale: false,
      state: 'resource_limited',
    });
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

  it('persists nearest loop break and continue targets through the update path', async () => {
    const source = [
      'export function loopTransferProbe(limit: number): number {',
      '  let total = 0;',
      '  for (let index = 0; index < limit; index++) {',
      '    if (index === 1) {',
      '      continue;',
      '    }',
      '    if (index === 3) {',
      '      break;',
      '    }',
      '    total += index;',
      '  }',
      '  return total;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('loop-transfer-probe.ts', 'loopTransferProbe', source);
    const paths = edgeTextPaths(cfg, source);

    expect(paths).toEqual(expect.arrayContaining([
      '2:body:let index = 0; -fallthrough-> 3:condition:index < limit',
      '3:condition:index < limit -true-> 4:condition:index === 1',
      '3:condition:index < limit -false-> 10:body:return total;',
      '5:body:continue; -continue-> 9:body:index++',
      '7:body:break; -break-> 10:body:return total;',
      '8:body:total += index; -fallthrough-> 9:body:index++',
      '9:body:index++ -loop_back-> 3:condition:index < limit',
    ]));
    expect(paths.indexOf('5:body:continue; -continue-> 9:body:index++')).toBeLessThan(
      paths.indexOf('9:body:index++ -loop_back-> 3:condition:index < limit'),
    );
  });

  it('routes labeled break and continue through lexical finally before exact loop targets', async () => {
    const source = [
      'export function labeledFinallyProbe(limit: number): number {',
      '  let total = 0;',
      'outer:',
      '  for (let row = 0; row < limit; row++) {',
      '    for (let col = 0; col < limit; col++) {',
      '      try {',
      '        if (col === 1) {',
      '          continue outer;',
      '        }',
      '        if (row === 2) {',
      '          break outer;',
      '        }',
      '      } finally {',
      '        total += 100;',
      '      }',
      '      total += col;',
      '    }',
      '    total += row;',
      '  }',
      '  return total;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('labeled-finally-probe.ts', 'labeledFinallyProbe', source);
    const paths = edgeTextPaths(cfg, source);

    expect(paths.some((path) =>
      path.includes('body:continue outer; -finally->') && path.endsWith('body:total += 100;')
    )).toBe(true);
    expect(paths.some((path) =>
      path.includes('body:break outer; -finally->') && path.endsWith('body:total += 100;')
    )).toBe(true);
    expect(paths.some((path) =>
      path.includes('body:total += 100; -continue->') && path.endsWith('body:row++')
    )).toBe(true);
    expect(paths.some((path) =>
      path.includes('body:total += 100; -break->') && path.endsWith('body:return total;')
    )).toBe(true);
  });

  it('routes chained labels that ultimately target one loop to that loop target', async () => {
    const source = [
      'export function chainedLoopLabelProbe(limit: number, skip: boolean): number {',
      '  let total = 0;',
      'outer:',
      'inner:',
      '  while (limit > 0) {',
      '    limit -= 1;',
      '    if (skip) {',
      '      continue outer;',
      '    }',
      '    total += limit;',
      '  }',
      '  return total;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('chained-loop-label-probe.ts', 'chainedLoopLabelProbe', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:body:let total = 0;',
      '1:body:let total = 0; -fallthrough-> 2:condition:limit > 0',
      '2:condition:limit > 0 -true-> 3:body:limit -= 1;',
      '2:condition:limit > 0 -false-> 7:body:return total;',
      '3:body:limit -= 1; -fallthrough-> 4:condition:skip',
      '4:condition:skip -true-> 5:body:continue outer;',
      '4:condition:skip -false-> 6:body:total += limit;',
      '5:body:continue outer; -continue-> 2:condition:limit > 0',
      '6:body:total += limit; -loop_back-> 2:condition:limit > 0',
      '7:body:return total; -return-> 8:exit',
    ]);
  });

  it('persists labeled block breaks to the labeled statement successor', async () => {
    const source = [
      'export function labeledBlockBreakProbe(flag: boolean): number {',
      '  let total = 0;',
      'done:',
      '  {',
      '    if (flag) {',
      '      break done;',
      '    }',
      '    total += 1;',
      '  }',
      '  return total;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('labeled-block-break-probe.ts', 'labeledBlockBreakProbe', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:body:let total = 0;',
      '1:body:let total = 0; -fallthrough-> 2:condition:flag',
      '2:condition:flag -true-> 3:body:break done;',
      '2:condition:flag -false-> 4:body:total += 1;',
      '3:body:break done; -break-> 5:body:return total;',
      '4:body:total += 1; -fallthrough-> 5:body:return total;',
      '5:body:return total; -return-> 6:exit',
    ]);
  });

  it('persists for-ever loops with only real break paths leaving the loop', async () => {
    const source = [
      'export function foreverBreakProbe(stop: boolean): number {',
      '  let total = 0;',
      '  for (;;) {',
      '    if (stop) {',
      '      break;',
      '    }',
      '    total += 1;',
      '  }',
      '  return total;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('forever-break-probe.ts', 'foreverBreakProbe', source);
    const paths = edgeRolePaths(cfg);

    expect(paths).toEqual([
      '0:entry -fallthrough-> 1:body',
      '1:body -fallthrough-> 2:condition',
      '2:condition -true-> 3:condition',
      '3:condition -true-> 4:body',
      '3:condition -false-> 5:body',
      '4:body -break-> 6:body',
      '5:body -loop_back-> 2:condition',
      '6:body -return-> 7:exit',
    ]);
    expect(paths.some((path) => path.startsWith('2:condition -false->'))).toBe(false);
  });

  it('persists branchy for update expressions on continue and loop-back paths', async () => {
    const source = [
      'export function branchyForUpdateProbe(limit: number, step?: { next?: number }): number {',
      '  let total = 0;',
      '  for (let index = 0; index < limit; step?.next ?? index++) {',
      '    if (index === 1) {',
      '      continue;',
      '    }',
      '    total += index;',
      '  }',
      '  return total;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('branchy-for-update-probe.ts', 'branchyForUpdateProbe', source);
    const paths = edgeTextPaths(cfg, source);

    expect(paths).toEqual([
      '0:entry -fallthrough-> 1:body:let total = 0;',
      '1:body:let total = 0; -fallthrough-> 2:body:let index = 0;',
      '2:body:let index = 0; -fallthrough-> 3:condition:index < limit',
      '3:condition:index < limit -true-> 4:condition:index === 1',
      '3:condition:index < limit -false-> 11:body:return total;',
      '4:condition:index === 1 -true-> 5:body:continue;',
      '4:condition:index === 1 -false-> 6:body:total += index;',
      '5:body:continue; -continue-> 7:condition:step',
      '6:body:total += index; -fallthrough-> 7:condition:step',
      '7:condition:step -true-> 8:body:step?.next',
      '7:condition:step -false-> 10:body:index++',
      '8:body:step?.next -fallthrough-> 9:condition:step?.next',
      '9:condition:step?.next -false-> 10:body:index++',
      '9:condition:step?.next -loop_back-> 3:condition:index < limit',
      '10:body:index++ -loop_back-> 3:condition:index < limit',
      '11:body:return total; -return-> 12:exit',
    ]);
    expect(paths.some((path) => path.includes('body:step?.next ?? index++'))).toBe(false);
  });

  it('persists branchy while conditions on each loop evaluation', async () => {
    const source = [
      'export function branchyWhileProbe(cursor?: { active?: boolean }, limit = 2): number {',
      '  let steps = 0;',
      '  while (cursor?.active && limit > 0) {',
      '    steps += 1;',
      '    limit -= 1;',
      '  }',
      '  return steps;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('branchy-while-probe.ts', 'branchyWhileProbe', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:body:let steps = 0;',
      '1:body:let steps = 0; -fallthrough-> 2:condition:cursor?.active && limit > 0',
      '2:condition:cursor?.active && limit > 0 -fallthrough-> 3:condition:cursor',
      '3:condition:cursor -true-> 4:body:cursor?.active',
      '3:condition:cursor -false-> 5:condition:cursor?.active',
      '4:body:cursor?.active -fallthrough-> 5:condition:cursor?.active',
      '5:condition:cursor?.active -true-> 6:condition:limit > 0',
      '5:condition:cursor?.active -false-> 9:body:return steps;',
      '6:condition:limit > 0 -true-> 7:body:steps += 1;',
      '6:condition:limit > 0 -false-> 9:body:return steps;',
      '7:body:steps += 1; -fallthrough-> 8:body:limit -= 1;',
      '8:body:limit -= 1; -loop_back-> 2:condition:cursor?.active && limit > 0',
      '9:body:return steps; -return-> 10:exit',
    ]);
  });

  it('preserves unreachable statements after return and throw as disconnected blocks', async () => {
    const source = [
      'export function unreachableAfterAbrupt(flag: boolean): number {',
      '  if (flag) {',
      '    return 1;',
      '    return 2;',
      '  }',
      "  throw new Error('stop');",
      '  return 3;',
      '}',
      '',
    ].join('\n');
    const cfg = await indexFunctionCfg('unreachable-after-abrupt.ts', 'unreachableAfterAbrupt', source);
    const incomingTargets = new Set(cfg.edges.map((edge) => edge.target));
    const unreachableBlocks = cfg.blocks.filter((block) => block.role === 'unreachable');

    expect(cfg.blocks.map((block) => block.role)).toEqual([
      'entry',
      'condition',
      'body',
      'unreachable',
      'body',
      'unreachable',
      'exit',
    ]);
    expect(unreachableBlocks.map((block) => blockTextLabel(source, block))).toEqual([
      '3:unreachable:return 2;',
      '5:unreachable:return 3;',
    ]);
    for (const block of unreachableBlocks) {
      expect(incomingTargets.has(block.id)).toBe(false);
    }
    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:flag',
      '1:condition:flag -true-> 2:body:return 1;',
      "1:condition:flag -false-> 4:body:throw new Error('stop');",
      '2:body:return 1; -return-> 6:exit',
      "4:body:throw new Error('stop'); -throw-> 6:exit",
    ]);
  });

  it('persists empty and no-op functions as minimal entry-exit CFGs', async () => {
    const noOpSource = fs.readFileSync(path.join(FIXTURE_DIR, 'no-op.ts'), 'utf8');
    const noOpCfg = await indexFunctionCfg('no-op.ts', 'noOpFixture', noOpSource);

    expect(noOpCfg.blocks.map((block) => block.role)).toEqual(['entry', 'exit']);
    expect(edgeRolePaths(noOpCfg)).toEqual(['0:entry -return-> 1:exit']);

    const emptySource = [
      'export function emptyBoundaryProbe(): void {',
      '}',
      '',
    ].join('\n');
    const emptyCfg = await indexFunctionCfg('empty-boundary-probe.ts', 'emptyBoundaryProbe', emptySource);

    expect(emptyCfg.blocks.map((block) => block.role)).toEqual(['entry', 'exit']);
    expect(edgeRolePaths(emptyCfg)).toEqual(['0:entry -fallthrough-> 1:exit']);
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
        '  do {',
        '    input += 1;',
        '  } while (input < 10);',
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

  it.each([
    {
      fileName: 'unresolved-label-skip.ts',
      functionName: 'unresolvedLabelSkip',
      reason: 'unsupported_construct',
      source: [
        'export function unresolvedLabelSkip(): number {',
        '  break missing;',
        '  return 1;',
        '}',
        '',
      ].join('\n'),
    },
    {
      fileName: 'cross-boundary-label-skip.ts',
      functionName: 'crossBoundaryLabelSkip',
      reason: 'unsupported_construct',
      source: [
        'export function crossBoundaryLabelSkip(limit: number): number {',
        'outer:',
        '  while (limit > 0) {',
        '    function inner(): number {',
        '      break outer;',
        '    }',
        '    return inner();',
        '  }',
        '  return 0;',
        '}',
        '',
      ].join('\n'),
    },
    {
      fileName: 'continue-to-block-label-skip.ts',
      functionName: 'continueToBlockLabelSkip',
      reason: 'unsupported_construct',
      source: [
        'export function continueToBlockLabelSkip(flag: boolean): number {',
        'done:',
        '  {',
        '    if (flag) {',
        '      continue done;',
        '    }',
        '  }',
        '  return 1;',
        '}',
        '',
      ].join('\n'),
    },
    {
      fileName: 'parse-unsafe-label-skip.ts',
      functionName: 'parseUnsafeLabelSkip',
      reason: 'parse_unsafe_region',
      source: [
        'export function parseUnsafeLabelSkip(): number {',
        'label:',
        '  if () {',
        '    break label;',
        '  }',
        '  return 1;',
        '}',
        '',
      ].join('\n'),
    },
  ])('skips whole-function CFG for $fileName with zero payload', async ({ fileName, functionName, reason, source }) => {
    const { db, functionId, result } = await indexFunctionResult(fileName, functionName, source);

    expect(result).toMatchObject({
      analysis: 'cfg',
      cfg: null,
      functionId,
      page: null,
      reason,
      sourceVersion: expect.stringMatching(/^cfgsrc:v1:/),
      stale: false,
      state: 'unsupported',
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cfg_blocks WHERE function_id = ?').get(functionId),
    ).toEqual({ count: 0 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cfg_edges WHERE function_id = ?').get(functionId),
    ).toEqual({ count: 0 });
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
