import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import CodeGraph, {
  isCfgReadResult,
  type CfgBlock,
  type CfgEdge,
  type CfgGraph,
  type CfgPage,
  type CfgProjectStatus,
  type CfgReadResult,
  type CfgReason,
  type CfgState,
} from '../../../src/index';
import {
  buildCfgPage,
  deriveCfgSourceVersion,
  makeCfgReadResult,
  normalizeCfgPageRequest,
  pageCfgGraph,
  resolveCfgStatus,
  runCfgAnalysis,
  safeCfgMessage,
  setCfgParserOverrideForTests,
} from '../../../src/analysis/cfg';
import type { SqliteDatabase } from '../../../src/db/sqlite-adapter';
import { ToolHandler, tools, type ToolResult } from '../../../src/mcp/tools';
import { clearProjectConfigCache } from '../../../src/project-config';

const BIN = path.resolve(__dirname, '../../../dist/bin/codegraph.js');
const PYTHON_FIXTURE_DIR = path.resolve(__dirname, 'fixtures/python');

const TOP_LEVEL_KEYS = [
  'analysis',
  'cfg',
  'functionId',
  'message',
  'page',
  'reason',
  'sourceVersion',
  'stale',
  'state',
];

const CFG_PROJECT_STATUS_KEYS = [
  'enabled',
  'state',
  'reason',
  'availableCount',
  'skippedCount',
  'unsupportedCount',
  'resourceLimitedCount',
  'staleCount',
];

const ZERO_EXIT_STATE_TABLE: Array<{ state: CfgState; reason: CfgReason | null; payload: boolean }> = [
  { state: 'available', reason: null, payload: true },
  { state: 'disabled', reason: 'analysis_disabled', payload: false },
  { state: 'not_indexed', reason: 'project_not_indexed', payload: false },
  { state: 'not_computed', reason: 'cfg_not_computed', payload: false },
  { state: 'stale', reason: 'source_version_mismatch', payload: true },
  { state: 'unavailable', reason: 'first_refresh_failed', payload: false },
  { state: 'unsupported', reason: 'unsupported_construct', payload: false },
  { state: 'resource_limited', reason: 'block_limit_exceeded', payload: false },
  { state: 'unknown_function', reason: 'function_unknown', payload: false },
  { state: 'deleted', reason: 'function_deleted', payload: false },
];

const page: CfgPage = {
  limit: 100,
  offset: 0,
  blocks: { total: 2, returned: 2, hasMore: false, nextOffset: null },
  edges: { total: 1, returned: 1, hasMore: false, nextOffset: null },
};

const entry: CfgBlock = {
  id: 'fn:demo:entry',
  role: 'entry',
  ordinal: 0,
  spans: [],
};

const exit: CfgBlock = {
  id: 'fn:demo:exit',
  role: 'exit',
  ordinal: 1,
  spans: [{ startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 }],
};

const edge: CfgEdge = {
  source: entry.id,
  target: exit.id,
  kind: 'fallthrough',
};

const graph: CfgGraph = {
  analysis: 'cfg',
  graphId: 'cfg:fn:demo:source:v1',
  language: 'typescript',
  functionId: 'fn:demo',
  sourceVersion: 'source:v1',
  blocks: [entry, exit],
  edges: [edge],
};

function runCfgCli(args: string[], cwd: string): { stderr: string; stdout: string; status: number | null } {
  if (!fs.existsSync(BIN)) throw new Error(`Build the project first: ${BIN} is missing (run npm run build).`);
  const result = spawnSync(process.execPath, [BIN, 'cfg', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEGRAPH_NO_DAEMON: '1',
      CODEGRAPH_WASM_RELAUNCHED: '1',
      NO_COLOR: '1',
      NODE_NO_WARNINGS: '1',
    },
  });
  return {
    stderr: result.stderr,
    stdout: result.stdout,
    status: result.status,
  };
}

function runStatusCli(args: string[], cwd: string): { stderr: string; stdout: string; status: number | null } {
  if (!fs.existsSync(BIN)) throw new Error(`Build the project first: ${BIN} is missing (run npm run build).`);
  const result = spawnSync(process.execPath, [BIN, 'status', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEGRAPH_NO_DAEMON: '1',
      CODEGRAPH_WASM_RELAUNCHED: '1',
      NO_COLOR: '1',
      NODE_NO_WARNINGS: '1',
    },
  });
  return {
    stderr: result.stderr,
    stdout: result.stdout,
    status: result.status,
  };
}

function parseCfgMcp(result: ToolResult): { body: CfgReadResult; isError: boolean } {
  expect(result.content).toHaveLength(1);
  expect(result.content[0]?.type).toBe('text');
  expect(result.content[0]!.text.trim().startsWith('{'), result.content[0]!.text.split('\n')[0]).toBe(true);
  const body = JSON.parse(result.content[0]!.text) as CfgReadResult;
  expect(isCfgReadResult(body)).toBe(true);
  return { body, isError: result.isError === true };
}

async function withCfgMcpTool<T>(run: () => Promise<T>): Promise<T> {
  const previousAllowlist = process.env.CODEGRAPH_MCP_TOOLS;
  process.env.CODEGRAPH_MCP_TOOLS = 'get_cfg';
  try {
    return await run();
  } finally {
    if (previousAllowlist === undefined) delete process.env.CODEGRAPH_MCP_TOOLS;
    else process.env.CODEGRAPH_MCP_TOOLS = previousAllowlist;
  }
}

function writeCfgConfig(dir: string, enabled: boolean): void {
  fs.writeFileSync(path.join(dir, 'codegraph.json'), JSON.stringify({ analysis: { cfg: enabled } }));
  clearProjectConfigCache();
}

function functionIdFor(db: SqliteDatabase, filePath: string, name: string): string {
  return (db
    .prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?')
    .get(filePath, name) as { id: string }).id;
}

function functionIdForRequired(db: SqliteDatabase, filePath: string, name: string): string {
  const row = db
    .prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?')
    .get(filePath, name) as { id: string } | undefined;
  expect(row, `expected indexed function ${name} in ${filePath}`).toBeDefined();
  return row!.id;
}

function functionIdsFor(db: SqliteDatabase, filePath: string, names: string[]): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT id, name FROM nodes WHERE file_path = ? AND name IN (${names.map(() => '?').join(', ')}) ORDER BY name`,
    )
    .all(filePath, ...names) as Array<{ id: string; name: string }>;
  expect(rows).toHaveLength(names.length);
  return new Map(rows.map((row) => [row.name, row.id]));
}

function parseStatusJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim().split('\n').filter(Boolean).pop()!);
}

function expectCfgProjectStatus(value: CfgProjectStatus, expected: CfgProjectStatus): void {
  expect(Object.keys(value)).toEqual(CFG_PROJECT_STATUS_KEYS);
  expect(value).toEqual(expected);
  expect(value.skippedCount).toBe(value.unsupportedCount + value.resourceLimitedCount);
}

function expectBoundedHumanSummary(stdout: string, result: CfgReadResult): void {
  expect(() => JSON.parse(stdout)).toThrow();
  expect(stdout).toContain('CFG');
  expect(stdout).toContain(`functionId: ${result.functionId}`);
  expect(stdout).toContain(`state: ${result.state}`);
  expect(stdout).toContain(`reason: ${result.reason ?? 'none'}`);
  expect(stdout).toContain(`sourceVersion: ${result.sourceVersion ?? 'none'}`);
  expect(stdout).toContain(`stale: ${String(result.stale)}`);
  if (result.message !== '') expect(stdout).toContain(`message: ${result.message}`);

  if (result.page === null) {
    expect(stdout).toContain('page: none');
    expect(stdout).toContain('blocks: returned=0 total=0 hasMore=false nextOffset=none');
    expect(stdout).toContain('edges: returned=0 total=0 hasMore=false nextOffset=none');
  } else {
    expect(stdout).toContain(`page: limit=${result.page.limit} offset=${result.page.offset}`);
    expect(stdout).toContain(
      `blocks: returned=${result.page.blocks.returned} total=${result.page.blocks.total} hasMore=${result.page.blocks.hasMore} nextOffset=${result.page.blocks.nextOffset ?? 'none'}`
    );
    expect(stdout).toContain(
      `edges: returned=${result.page.edges.returned} total=${result.page.edges.total} hasMore=${result.page.edges.hasMore} nextOffset=${result.page.edges.nextOffset ?? 'none'}`
    );
  }

  expect(stdout).not.toContain('"cfg"');
  expect(stdout).not.toContain('"blocks"');
  expect(stdout).not.toContain('"edges"');
}

function resultFor(
  state: CfgState,
  reason: CfgReason | null,
  payload: boolean,
): CfgReadResult {
  return {
    analysis: 'cfg',
    functionId: 'fn:demo',
    state,
    reason,
    message: '',
    sourceVersion: payload ? 'source:v1' : null,
    stale: state === 'stale',
    cfg: payload ? graph : null,
    page: payload ? page : null,
  };
}

async function createCliProject(dirs: string[], cfgEnabled: boolean): Promise<{
  cg: CodeGraph;
  db: SqliteDatabase;
  dir: string;
  functionId: string;
}> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-cli-human-'));
  dirs.push(dir);
  writeCfgConfig(dir, cfgEnabled);
  fs.writeFileSync(
    path.join(dir, 'app.ts'),
    [
      'export function cliTarget(value: number): number {',
      '  return value + 1;',
      '}',
      '',
    ].join('\n'),
  );

  const cg = CodeGraph.initSync(dir);
  expect((await cg.indexAll()).success).toBe(true);
  const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
  return { cg, db, dir, functionId: functionIdFor(db, 'app.ts', 'cliTarget') };
}

async function createCfgStatusProject(dirs: string[], cfgEnabled: boolean): Promise<{
  cg: CodeGraph;
  db: SqliteDatabase;
  dir: string;
  functionIds: Map<string, string>;
}> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-status-'));
  dirs.push(dir);
  writeCfgConfig(dir, cfgEnabled);
  fs.writeFileSync(
    path.join(dir, 'app.ts'),
    [
      'export function availableOne(value: number): number {',
      '  return value + 1;',
      '}',
      '',
      'export function unsupportedOne(value: number): number {',
      '  return value + 2;',
      '}',
      '',
      'export function limitedOne(value: number): number {',
      '  return value + 3;',
      '}',
      '',
      'export function sourceStaleOne(value: number): number {',
      '  return value + 4;',
      '}',
      '',
      'export function retainedStaleOne(value: number): number {',
      '  return value + 5;',
      '}',
      '',
    ].join('\n'),
  );

  const cg = CodeGraph.initSync(dir);
  expect((await cg.indexAll()).success).toBe(true);
  const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
  const functionIds = functionIdsFor(db, 'app.ts', [
    'availableOne',
    'limitedOne',
    'retainedStaleOne',
    'sourceStaleOne',
    'unsupportedOne',
  ]);
  return { cg, db, dir, functionIds };
}

function generateBlockLimitPythonSource(branches = 5_005): string {
  const lines = ['def block_limit_probe(value):'];
  for (let index = 0; index < branches; index++) {
    lines.push(`    if value == ${index}:`);
    lines.push('        pass');
  }
  lines.push('    return value');
  lines.push('');
  return lines.join('\n');
}

async function createMixedPythonTsCfgProject(dirs: string[]): Promise<{
  cg: CodeGraph;
  db: SqliteDatabase;
  dir: string;
  ids: {
    tsAvailable: string;
    pythonAvailable: string;
    pythonParserUnavailable: string;
    pythonResourceLimited: string;
  };
}> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-mixed-python-ts-'));
  dirs.push(dir);
  writeCfgConfig(dir, true);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'parity.ts'),
    [
      'export function branchLoopParity(items: Array<number | null>): number {',
      '  let total = 0;',
      '  let attempts = 0;',
      '  for (let index = 0; index < items.length; index += 1) {',
      '    const item = items[index];',
      '    if (item === null) continue;',
      '    if (item < 0) break;',
      '    total += item;',
      '  }',
      '  while (attempts < 3) {',
      '    if (total > 10) return total;',
      '    attempts += 1;',
      '    total += attempts;',
      '  }',
      '  return total;',
      '}',
      '',
    ].join('\n'),
  );
  fs.copyFileSync(
    path.join(PYTHON_FIXTURE_DIR, 'parity_baseline.py'),
    path.join(dir, 'src', 'parity_baseline.py'),
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'parser_unavailable.py'),
    [
      'def parser_unavailable_probe(value):',
      '    return value',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(dir, 'src', 'block_limit.py'), generateBlockLimitPythonSource());

  const cg = CodeGraph.initSync(dir);
  expect((await cg.indexAll({ embeddingsProvider: 'off', lsp: 'disable' })).success).toBe(true);
  const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
  const ids = {
    tsAvailable: functionIdForRequired(db, 'src/parity.ts', 'branchLoopParity'),
    pythonAvailable: functionIdForRequired(db, 'src/parity_baseline.py', 'branch_loop_parity'),
    pythonParserUnavailable: functionIdForRequired(db, 'src/parser_unavailable.py', 'parser_unavailable_probe'),
    pythonResourceLimited: functionIdForRequired(db, 'src/block_limit.py', 'block_limit_probe'),
  };

  setCfgParserOverrideForTests('python', null);
  try {
    expect(runCfgAnalysis({ projectRoot: dir, db, filePaths: ['src/parser_unavailable.py'] })).toEqual({
      committed: true,
    });
  } finally {
    setCfgParserOverrideForTests('python', undefined);
  }

  return { cg, db, dir, ids };
}

function setStoredCfgState(
  db: SqliteDatabase,
  functionId: string,
  state: Exclude<CfgState, 'available' | 'disabled' | 'not_indexed' | 'not_computed' | 'stale' | 'unknown_function'>,
  reason: CfgReason,
  sourceVersion: string | null,
): void {
  db.prepare('DELETE FROM cfg_edges WHERE function_id = ?').run(functionId);
  db.prepare('DELETE FROM cfg_blocks WHERE function_id = ?').run(functionId);
  db.prepare('UPDATE cfg_status SET state = ?, reason = ?, message = ?, source_version = ?, updated_at = ? WHERE function_id = ?').run(
    state,
    reason,
    '',
    sourceVersion,
    Date.now(),
    functionId,
  );
}

function seedCfgPagingPayload(db: SqliteDatabase, functionId: string): void {
  const blockIds = Array.from({ length: 5 }, (_, index) => `${functionId}:page-block:${index}`);
  const roles: CfgBlock['role'][] = ['entry', 'condition', 'body', 'merge', 'exit'];
  const edgeRows: Array<{ source: number; target: number; kind: CfgEdge['kind'] }> = [
    { source: 0, target: 1, kind: 'fallthrough' },
    { source: 1, target: 2, kind: 'true' },
    { source: 1, target: 3, kind: 'false' },
    { source: 2, target: 1, kind: 'loop_back' },
    { source: 2, target: 3, kind: 'fallthrough' },
    { source: 3, target: 4, kind: 'return' },
    { source: 1, target: 4, kind: 'throw' },
  ];

  db.prepare('DELETE FROM cfg_edges WHERE function_id = ?').run(functionId);
  db.prepare('DELETE FROM cfg_blocks WHERE function_id = ?').run(functionId);

  const insertBlock = db.prepare(
    'INSERT INTO cfg_blocks (function_id, block_id, ordinal, role, spans_json) VALUES (?, ?, ?, ?, ?)',
  );
  blockIds.forEach((blockId, ordinal) => {
    insertBlock.run(
      functionId,
      blockId,
      ordinal,
      roles[ordinal],
      JSON.stringify([{ startLine: ordinal + 1, startColumn: 0, endLine: ordinal + 1, endColumn: 10 }]),
    );
  });

  const insertEdge = db.prepare(
    'INSERT INTO cfg_edges (function_id, edge_ordinal, source_block_id, target_block_id, kind) VALUES (?, ?, ?, ?, ?)',
  );
  edgeRows.forEach((edge, edgeOrdinal) => {
    insertEdge.run(functionId, edgeOrdinal, blockIds[edge.source], blockIds[edge.target], edge.kind);
  });
}

function cfgBlockIds(result: CfgReadResult): string[] {
  return result.cfg?.blocks.map((block) => block.id) ?? [];
}

function cfgEdgeKeys(result: CfgReadResult): string[] {
  return result.cfg?.edges.map((edge) => `${edge.source}->${edge.target}:${edge.kind}`) ?? [];
}

function sourceVersionFor(db: SqliteDatabase, functionId: string): string {
  const row = db
    .prepare('SELECT source_version FROM cfg_status WHERE function_id = ?')
    .get(functionId) as { source_version: string | null } | undefined;
  expect(row?.source_version).toMatch(/^cfgsrc:v1:/);
  return row!.source_version!;
}

function setCurrentStoredCfgState(
  db: SqliteDatabase,
  functionId: string,
  state: 'unsupported' | 'resource_limited' | 'unavailable',
  reason: CfgReason,
): void {
  db.prepare('DELETE FROM cfg_edges WHERE function_id = ?').run(functionId);
  db.prepare('DELETE FROM cfg_blocks WHERE function_id = ?').run(functionId);
  db.prepare('UPDATE cfg_status SET state = ?, reason = ?, message = ?, source_version = ?, updated_at = ? WHERE function_id = ?').run(
    state,
    reason,
    '',
    sourceVersionFor(db, functionId),
    Date.now(),
    functionId,
  );
}

function mismatchStoredCfgSourceVersion(db: SqliteDatabase, functionId: string): void {
  db.prepare('UPDATE cfg_status SET source_version = ? WHERE function_id = ?').run(
    `${sourceVersionFor(db, functionId)}:stale`,
    functionId,
  );
}

function markStoredCfgRefreshFailure(db: SqliteDatabase, functionId: string): void {
  db.prepare(
    `
    INSERT INTO project_metadata (key, value, updated_at)
    VALUES (?, 'v1', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `,
  ).run(`cfg_refresh_failure:${functionId}`, Date.now());
}

function expectCfgReadSurfaceResult(result: CfgReadResult, state: CfgState, reason: CfgReason | null): void {
  expect(Object.keys(result).sort()).toEqual(TOP_LEVEL_KEYS);
  expect(isCfgReadResult(result)).toBe(true);
  expect(result.analysis).toBe('cfg');
  expect(result.state).toBe(state);
  expect(result.reason).toBe(reason);
  expect([...result.message].length).toBeLessThanOrEqual(240);
  expect(result.stale).toBe(state === 'stale');

  const carriesPayload = state === 'available' || state === 'stale';
  if (carriesPayload) {
    expect(result.cfg).not.toBeNull();
    expect(result.page).not.toBeNull();
    expect(result.sourceVersion).not.toBeNull();
    expect(result.cfg!.functionId).toBe(result.functionId);
    expect(result.cfg!.sourceVersion).toBe(result.sourceVersion);
  } else {
    expect(result.cfg).toBeNull();
    expect(result.page).toBeNull();
  }

  if (['disabled', 'not_indexed', 'not_computed', 'unknown_function', 'deleted'].includes(state)) {
    expect(result.sourceVersion).toBeNull();
  }
}

async function expectCfgReadSurfacesDeepEqual(input: {
  cg: CodeGraph;
  dir: string;
  functionId: string;
  reason: CfgReason | null;
  state: CfgState;
}): Promise<CfgReadResult> {
  const expected = input.cg.getCfg(input.functionId, { limit: 1, offset: 0 });
  expectCfgReadSurfaceResult(expected, input.state, input.reason);
  expect(expected.cfg === null).toBe(input.state !== 'available' && input.state !== 'stale');
  expect(expected.page === null).toBe(input.state !== 'available' && input.state !== 'stale');
  if (input.state === 'unsupported' || input.state === 'resource_limited') {
    expect(expected.sourceVersion).toMatch(/^cfgsrc:v1:/);
  }

  const cliJson = runCfgCli([input.functionId, '-p', input.dir, '--json', '--limit', '1', '--offset', '0'], input.dir);
  expect(cliJson.status, `${input.functionId} JSON exit`).toBe(0);
  expect(cliJson.stderr, `${input.functionId} JSON stderr`).toBe('');
  const cliBody = JSON.parse(cliJson.stdout) as CfgReadResult;
  expectCfgReadSurfaceResult(cliBody, input.state, input.reason);
  expect(cliBody).toEqual(expected);

  const cliHuman = runCfgCli([input.functionId, '-p', input.dir, '--limit', '1', '--offset', '0'], input.dir);
  expect(cliHuman.status, `${input.functionId} human exit`).toBe(0);
  expect(cliHuman.stderr, `${input.functionId} human stderr`).toBe('');
  expectBoundedHumanSummary(cliHuman.stdout, expected);

  await withCfgMcpTool(async () => {
    const mcp = parseCfgMcp(
      await new ToolHandler(input.cg).execute('codegraph_get_cfg', {
        projectPath: input.dir,
        functionId: input.functionId,
        limit: 1,
        offset: 0,
      }),
    );
    expect(mcp.isError, `${input.functionId} MCP isError`).toBe(false);
    expectCfgReadSurfaceResult(mcp.body, input.state, input.reason);
    expect(mcp.body).toEqual(expected);
  });

  return expected;
}

function expectLimitOneReconstruction(cg: CodeGraph, functionId: string, full: CfgReadResult): void {
  expect(full.state).toBe('available');
  expect(full.page).not.toBeNull();
  const expectedBlocks = cfgBlockIds(full);
  const expectedEdges = cfgEdgeKeys(full);
  expect(expectedBlocks.length).toBe(full.page!.blocks.total);
  expect(expectedEdges.length).toBe(full.page!.edges.total);

  const reconstructedBlocks: string[] = [];
  const reconstructedEdges: string[] = [];
  const offsets: number[] = [];
  let offset = 0;
  while (true) {
    offsets.push(offset);
    const page = cg.getCfg(functionId, { limit: 1, offset });
    expect(page.state).toBe('available');
    expect(page.page?.limit).toBe(1);
    expect(page.page?.offset).toBe(offset);
    expect(page.page?.blocks.total).toBe(expectedBlocks.length);
    expect(page.page?.edges.total).toBe(expectedEdges.length);
    reconstructedBlocks.push(...cfgBlockIds(page));
    reconstructedEdges.push(...cfgEdgeKeys(page));

    const nextOffsets = [page.page?.blocks.nextOffset, page.page?.edges.nextOffset].filter(
      (nextOffset): nextOffset is number => nextOffset !== null && nextOffset !== undefined,
    );
    if (nextOffsets.length === 0) break;
    offset = Math.max(...nextOffsets);
  }

  expect(offsets).toEqual(Array.from({ length: Math.max(expectedBlocks.length, expectedEdges.length) }, (_, index) => index));
  expect(reconstructedBlocks).toEqual(expectedBlocks);
  expect(reconstructedEdges).toEqual(expectedEdges);
  expect(new Set(reconstructedBlocks).size).toBe(reconstructedBlocks.length);
  expect(new Set(reconstructedEdges).size).toBe(reconstructedEdges.length);
}

function graphTotals(db: SqliteDatabase): { cfgBlocks: number; cfgEdges: number; edges: number; nodes: number } {
  return {
    cfgBlocks: Number((db.prepare('SELECT COUNT(*) AS count FROM cfg_blocks').get() as { count: number }).count),
    cfgEdges: Number((db.prepare('SELECT COUNT(*) AS count FROM cfg_edges').get() as { count: number }).count),
    edges: Number((db.prepare('SELECT COUNT(*) AS count FROM edges').get() as { count: number }).count),
    nodes: Number((db.prepare('SELECT COUNT(*) AS count FROM nodes').get() as { count: number }).count),
  };
}

async function createCfgParityCase(
  dirs: string[],
  state: CfgState,
): Promise<{
  cg?: CodeGraph;
  close?: () => void;
  dir: string;
  expected: CfgReadResult;
  functionId: string;
}> {
  if (state === 'not_indexed') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-parity-noindex-'));
    dirs.push(dir);
    writeCfgConfig(dir, true);
    fs.writeFileSync(path.join(dir, 'app.ts'), 'export function notYetIndexed(value: number): number { return value + 1; }\n');
    const functionId = 'function:cfg-parity-not-indexed';
    return {
      dir,
      functionId,
      expected: makeCfgReadResult({
        functionId,
        state: 'not_indexed',
        reason: 'project_not_indexed',
        message: 'Project is not indexed with CodeGraph.',
      }),
    };
  }

  const cfgEnabled = state !== 'disabled' && state !== 'not_computed';
  const { cg, db, dir, functionId } = await createCliProject(dirs, cfgEnabled);
  const close = () => cg.close();

  if (state === 'unknown_function') {
    const unknownFunctionId = `${functionId}:missing`;
    return {
      cg,
      close,
      dir,
      functionId: unknownFunctionId,
      expected: cg.getCfg(unknownFunctionId, { limit: 1, offset: 0 }),
    };
  }

  if (state === 'not_computed') {
    writeCfgConfig(dir, true);
  }

  if (state === 'unsupported') {
    setCurrentStoredCfgState(db, functionId, 'unsupported', 'unsupported_construct');
  } else if (state === 'resource_limited') {
    setCurrentStoredCfgState(db, functionId, 'resource_limited', 'block_limit_exceeded');
  } else if (state === 'unavailable') {
    setCurrentStoredCfgState(db, functionId, 'unavailable', 'first_refresh_failed');
  } else if (state === 'stale') {
    mismatchStoredCfgSourceVersion(db, functionId);
  } else if (state === 'deleted') {
    setStoredCfgState(db, functionId, 'deleted', 'function_deleted', null);
  }

  return {
    cg,
    close,
    dir,
    functionId,
    expected: cg.getCfg(functionId, { limit: 1, offset: 0 }),
  };
}

type SelfRepoCfgCandidate = {
  function_id: string;
  file_path: string;
  start_line: number;
  source_version: string;
  block_count: number;
  edge_count: number;
};

function copyTrackedSelfRepoTsJsFiles(repoRoot: string, mirrorRoot: string): number {
  const tracked = spawnSync('git', ['ls-files', '-z', '--', '*.ts', '*.tsx', '*.js', '*.jsx'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  expect(tracked.status, tracked.stderr).toBe(0);
  const filePaths = tracked.stdout.split('\0').filter(Boolean);
  expect(filePaths, 'self-repo UAT needs tracked TypeScript/JavaScript files').not.toHaveLength(0);

  let copied = 0;
  for (const filePath of filePaths) {
    const source = path.join(repoRoot, filePath);
    if (!fs.existsSync(source)) continue;
    const target = path.join(mirrorRoot, filePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    copied += 1;
  }
  expect(copied, 'self-repo UAT mirror must copy current working-tree contents').toBeGreaterThan(0);
  return copied;
}

function selectSelfRepoCfgCandidate(db: SqliteDatabase): SelfRepoCfgCandidate {
  const row = db
    .prepare(
      `
      SELECT *
      FROM (
        SELECT
          cfg_status.function_id,
          cfg_status.file_path,
          cfg_status.start_line,
          cfg_status.start_column,
          cfg_status.source_version,
          (SELECT COUNT(*) FROM cfg_blocks WHERE cfg_blocks.function_id = cfg_status.function_id) AS block_count,
          (SELECT COUNT(*) FROM cfg_edges WHERE cfg_edges.function_id = cfg_status.function_id) AS edge_count
        FROM cfg_status
        WHERE cfg_status.file_path = ?
          AND cfg_status.state = 'available'
      )
      WHERE block_count BETWEEN 2 AND 500
        AND edge_count BETWEEN 2 AND 500
      ORDER BY start_line, start_column, function_id
      LIMIT 1
      `,
    )
    .get('src/analysis/cfg/index.ts') as SelfRepoCfgCandidate | undefined;

  expect(row, 'expected an available bounded CFG in src/analysis/cfg/index.ts').toBeDefined();
  return row!;
}

describe('SPEC-014 public CFG contract', () => {
  const dirs: string[] = [];

  afterEach(() => {
    setCfgParserOverrideForTests('python', undefined);
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('exports the frozen CfgReadResult top-level shape and accepts valid state/reason payloads', () => {
    const available = resultFor('available', null, true);

    expect(Object.keys(available).sort()).toEqual(TOP_LEVEL_KEYS);
    expect(isCfgReadResult(available)).toBe(true);

    const validCases: Array<[CfgState, CfgReason | null, boolean]> = [
      ['available', null, true],
      ['disabled', 'analysis_disabled', false],
      ['not_indexed', 'project_not_indexed', false],
      ['not_computed', 'cfg_not_computed', false],
      ['stale', 'source_version_mismatch', true],
      ['stale', 'refresh_failed_retained_stale', true],
      ['unavailable', 'first_refresh_failed', false],
      ['unsupported', 'unsupported_language', false],
      ['unsupported', 'unsupported_construct', false],
      ['unsupported', 'parse_error', false],
      ['unsupported', 'parse_unsafe_region', false],
      ['unsupported', 'parser_unavailable', false],
      ['resource_limited', 'block_limit_exceeded', false],
      ['unknown_function', 'function_unknown', false],
      ['deleted', 'function_deleted', false],
    ];

    for (const [state, reason, payload] of validCases) {
      expect(isCfgReadResult(resultFor(state, reason, payload))).toBe(true);
    }
  });

  it('keeps the CLI zero-exit state table aligned to the closed CFG state set', () => {
    expect(ZERO_EXIT_STATE_TABLE.map((item) => item.state).sort()).toEqual([
      'available',
      'deleted',
      'disabled',
      'not_computed',
      'not_indexed',
      'resource_limited',
      'stale',
      'unavailable',
      'unknown_function',
      'unsupported',
    ]);

    for (const { state, reason, payload } of ZERO_EXIT_STATE_TABLE) {
      const result = makeCfgReadResult({
        functionId: `fn:${state}`,
        state,
        reason,
        sourceVersion: payload ? undefined : 'source:v1',
        cfg: payload ? { ...graph, functionId: `fn:${state}` } : null,
        page: payload ? page : null,
      });
      expect(isCfgReadResult(result)).toBe(true);
    }
  });

  it('statically exposes codegraph_get_cfg with the exact MCP input schema', () => {
    const def = tools.find((tool) => tool.name === 'codegraph_get_cfg');
    expect(def, 'codegraph_get_cfg must be a defined static MCP tool').toBeDefined();
    expect(def!.inputSchema.type).toBe('object');
    expect(def!.inputSchema.required).toEqual(['projectPath', 'functionId']);
    expect(Object.keys(def!.inputSchema.properties).sort()).toEqual(['functionId', 'limit', 'offset', 'projectPath']);
    expect(def!.inputSchema.properties.projectPath.type).toBe('string');
    expect(def!.inputSchema.properties.functionId.type).toBe('string');
    expect(def!.inputSchema.properties.limit.type).toBe('integer');
    expect(def!.inputSchema.properties.offset.type).toBe('integer');
    expect(def!.annotations?.readOnlyHint).toBe(true);

    const previousAllowlist = process.env.CODEGRAPH_MCP_TOOLS;
    process.env.CODEGRAPH_MCP_TOOLS = 'get_cfg';
    try {
      const listed = new ToolHandler(null).getTools().find((tool) => tool.name === 'codegraph_get_cfg');
      expect(listed, 'allowlisted static no-root tool surface must include codegraph_get_cfg').toBeDefined();
      expect(listed!.inputSchema.required).toEqual(['projectPath', 'functionId']);
    } finally {
      if (previousAllowlist === undefined) delete process.env.CODEGRAPH_MCP_TOOLS;
      else process.env.CODEGRAPH_MCP_TOOLS = previousAllowlist;
    }
  });

  it('rejects non-contract states, reasons, payload nullability, and top-level key drift', () => {
    expect(isCfgReadResult({ ...resultFor('available', null, true), extra: true })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), state: 'empty' })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), reason: 'analysis_disabled' })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('disabled', 'analysis_disabled', false), reason: null })).toBe(false);
    expect(
      isCfgReadResult({ ...resultFor('not_computed', 'cfg_not_computed', false), reason: 'no_current_cfg_functions' })
    ).toBe(false);
    expect(isCfgReadResult({ ...resultFor('stale', 'source_version_mismatch', true), stale: false })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('disabled', 'analysis_disabled', false), stale: true })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), cfg: null })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), page: null })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('disabled', 'analysis_disabled', false), cfg: graph })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('disabled', 'analysis_disabled', false), message: 'x'.repeat(241) })).toBe(false);
  });

  it('validates block roles, edge kinds, graph identity, and page metadata', () => {
    expect(
      isCfgReadResult({
        ...resultFor('available', null, true),
        cfg: { ...graph, blocks: [{ ...entry, role: 'landing' }] },
      })
    ).toBe(false);
    expect(
      isCfgReadResult({
        ...resultFor('available', null, true),
        cfg: { ...graph, edges: [{ ...edge, kind: 'exception' }] },
      })
    ).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), cfg: { ...graph, analysis: 'flow' } })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), cfg: { ...graph, functionId: 'fn:other' } })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), cfg: { ...graph, sourceVersion: 'source:v2' } })).toBe(false);
    expect(
      isCfgReadResult({
        ...resultFor('available', null, true),
        page: { ...page, blocks: { total: 2, returned: 3, hasMore: false, nextOffset: null } },
      })
    ).toBe(false);
  });

  it('derives source versions only from function snapshot and CFG contract inputs', () => {
    const baseInput = {
      fileContentHash: 'file:abc123',
      functionId: 'fn:demo',
      language: 'typescript',
      startLine: 1,
      startColumn: 0,
      endLine: 10,
      endColumn: 1,
      statusVersion: 1,
      blockVersion: 1,
      edgeVersion: 1,
    };

    const base = deriveCfgSourceVersion(baseInput);

    expect(base).toMatch(/^cfgsrc:v1:[a-f0-9]{64}$/);
    expect(deriveCfgSourceVersion({ ...baseInput })).toBe(base);
    expect(deriveCfgSourceVersion({ ...baseInput, graphWriteVersion: 999 })).toBe(base);
    expect(deriveCfgSourceVersion({ ...baseInput, endLine: 11 })).not.toBe(base);
    expect(deriveCfgSourceVersion({ ...baseInput, fileContentHash: 'file:def456' })).not.toBe(base);
    expect(deriveCfgSourceVersion({ ...baseInput, blockVersion: 2 })).not.toBe(base);
  });

  it('resolves read status precedence, source-version stale state, and no-payload skip states', () => {
    const sourceVersion = deriveCfgSourceVersion({
      fileContentHash: 'file:abc123',
      functionId: 'fn:demo',
      language: 'typescript',
      startLine: 1,
      startColumn: 0,
      endLine: 10,
      endColumn: 1,
      statusVersion: 1,
      blockVersion: 1,
      edgeVersion: 1,
    });

    const stored = {
      state: 'available' as const,
      reason: null,
      message: '',
      sourceVersion,
      statusVersion: 1,
      blockVersion: 1,
      edgeVersion: 1,
    };

    expect(resolveCfgStatus({ enabled: false, projectIndexed: true, currentSourceVersion: sourceVersion, stored })).toEqual({
      state: 'disabled',
      reason: 'analysis_disabled',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    });
    expect(resolveCfgStatus({ enabled: true, projectIndexed: false, currentSourceVersion: sourceVersion, stored })).toEqual({
      state: 'not_indexed',
      reason: 'project_not_indexed',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    });
    expect(resolveCfgStatus({ enabled: true, projectIndexed: true, currentSourceVersion: sourceVersion, stored: null })).toEqual({
      state: 'not_computed',
      reason: 'cfg_not_computed',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    });
    expect(resolveCfgStatus({ enabled: true, projectIndexed: true, currentSourceVersion: null, stored: null })).toEqual({
      state: 'unknown_function',
      reason: 'function_unknown',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    });
    expect(
      resolveCfgStatus({
        enabled: true,
        projectIndexed: true,
        currentSourceVersion: 'source:v2',
        stored,
      })
    ).toEqual({
      state: 'stale',
      reason: 'source_version_mismatch',
      stale: true,
      sourceVersion,
      carriesPayload: true,
    });
    expect(
      resolveCfgStatus({
        enabled: true,
        projectIndexed: true,
        currentSourceVersion: sourceVersion,
        stored: {
          ...stored,
          state: 'unsupported',
          reason: 'unsupported_construct',
        },
      })
    ).toEqual({
      state: 'unsupported',
      reason: 'unsupported_construct',
      stale: false,
      sourceVersion,
      carriesPayload: false,
    });
  });

  it('clamps paging and applies one request independently to ordered blocks and edges', () => {
    expect(normalizeCfgPageRequest({})).toEqual({ limit: 100, offset: 0 });
    expect(normalizeCfgPageRequest({ limit: -10, offset: -4 })).toEqual({ limit: 1, offset: 0 });
    expect(normalizeCfgPageRequest({ limit: 999, offset: 3.8 })).toEqual({ limit: 500, offset: 3 });

    expect(buildCfgPage({ limit: 2, offset: 1, totalBlocks: 5, totalEdges: 2 })).toEqual({
      limit: 2,
      offset: 1,
      blocks: { total: 5, returned: 2, hasMore: true, nextOffset: 3 },
      edges: { total: 2, returned: 1, hasMore: false, nextOffset: null },
    });

    const paged = pageCfgGraph({
      graph: {
        ...graph,
        blocks: [
          entry,
          { ...entry, id: 'body-1', role: 'body', ordinal: 1 },
          { ...entry, id: 'body-2', role: 'body', ordinal: 2 },
          { ...exit, ordinal: 3 },
        ],
        edges: [
          edge,
          { ...edge, source: 'body-1', target: 'body-2' },
          { ...edge, source: 'body-2', target: exit.id },
        ],
      },
      request: { limit: 2, offset: 1 },
    });

    expect(paged.cfg.blocks.map((block) => block.id)).toEqual(['body-1', 'body-2']);
    expect(paged.cfg.edges.map((item) => item.source)).toEqual(['body-1', 'body-2']);
    expect(paged.page).toEqual({
      limit: 2,
      offset: 1,
      blocks: { total: 4, returned: 2, hasMore: true, nextOffset: 3 },
      edges: { total: 3, returned: 2, hasMore: false, nextOffset: null },
    });
  });

  it('bounds and sanitizes CFG messages without leaking raw exception strings', () => {
    expect(safeCfgMessage(undefined)).toBe('');
    expect(safeCfgMessage('line one\nline two')).toBe('line one line two');
    expect([...safeCfgMessage('😀'.repeat(300))]).toHaveLength(240);
    expect(safeCfgMessage(new Error('SyntaxError: raw source token should not leak'))).toBe(
      'CFG analysis result unavailable.'
    );
  });

  it('builds read results with no partial payload for unsupported and resource-limited states', () => {
    const unsupported = makeCfgReadResult({
      functionId: 'fn:demo',
      state: 'unsupported',
      reason: 'unsupported_construct',
      message: 'unsupported syntax',
      sourceVersion: 'source:v1',
      cfg: graph,
      page,
    });
    const limited = makeCfgReadResult({
      functionId: 'fn:demo',
      state: 'resource_limited',
      reason: 'block_limit_exceeded',
      message: 'too many blocks',
      sourceVersion: 'source:v1',
      cfg: graph,
      page,
    });

    expect(unsupported).toMatchObject({ cfg: null, page: null, stale: false });
    expect(limited).toMatchObject({ cfg: null, page: null, stale: false });
    expect(isCfgReadResult(unsupported)).toBe(true);
    expect(isCfgReadResult(limited)).toBe(true);
    expect(isCfgReadResult(makeCfgReadResult({ functionId: 'fn:demo', state: 'available', reason: null, cfg: graph, page }))).toBe(true);
  });

  it('fails closed instead of constructing invalid payload-bearing read results', () => {
    expect(() => makeCfgReadResult({ functionId: 'fn:demo', state: 'available', reason: null, cfg: graph })).toThrow(
      /Invalid CfgReadResult: available requires complete cfg and page/
    );
    expect(() =>
      makeCfgReadResult({ functionId: 'fn:demo', state: 'stale', reason: 'source_version_mismatch', page })
    ).toThrow(/Invalid CfgReadResult: stale requires complete cfg and page/);
    expect(() =>
      makeCfgReadResult({
        functionId: 'fn:demo',
        state: 'available',
        reason: null,
        sourceVersion: 'source:v1',
        cfg: { ...graph, functionId: 'fn:other' },
        page,
      })
    ).toThrow(/Invalid CfgReadResult: constructed result violates CFG contract/);
    expect(() =>
      makeCfgReadResult({
        functionId: 'fn:demo',
        state: 'available',
        reason: null,
        sourceVersion: 'source:v1',
        cfg: { ...graph, sourceVersion: 'source:v2' },
        page,
      })
    ).toThrow(/Invalid CfgReadResult: constructed result violates CFG contract/);
    expect(() =>
      makeCfgReadResult({ functionId: 'fn:demo', state: 'available', reason: 'analysis_disabled', cfg: graph, page })
    ).toThrow(/Invalid CfgReadResult: constructed result violates CFG contract/);

    const unsupported = makeCfgReadResult({
      functionId: 'fn:demo',
      state: 'unsupported',
      reason: 'unsupported_construct',
      sourceVersion: 'source:v1',
      cfg: graph,
      page,
    });
    expect(unsupported.cfg).toBeNull();
    expect(unsupported.page).toBeNull();
    expect(isCfgReadResult(unsupported)).toBe(true);
  });

  it('does not report stale for non-payload stored statuses whose source token is not current', () => {
    const resolved = resolveCfgStatus({
      enabled: true,
      projectIndexed: true,
      currentSourceVersion: 'source:v2',
      stored: {
        state: 'unsupported',
        reason: 'unsupported_construct',
        sourceVersion: 'source:v1',
        statusVersion: 1,
        blockVersion: 1,
        edgeVersion: 1,
      },
    });

    expect(resolved).toEqual({
      state: 'not_computed',
      reason: 'cfg_not_computed',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    });
  });

  it('prints built-CLI CFG JSON deep-equal to CodeGraph.getCfg for available and non-payload states', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-cli-json-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'codegraph.json'), JSON.stringify({ analysis: { cfg: true } }));
    fs.writeFileSync(
      path.join(dir, 'app.ts'),
      [
        'export function cliTarget(value: number): number {',
        '  return value + 1;',
        '}',
        '',
      ].join('\n'),
    );

    const cg = CodeGraph.initSync(dir);
    try {
      expect((await cg.indexAll()).success).toBe(true);
      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const functionId = (db
        .prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?')
        .get('app.ts', 'cliTarget') as { id: string }).id;

      const availableExpected = cg.getCfg(functionId, { limit: 1, offset: 1 });
      const availableCli = runCfgCli([functionId, '-p', dir, '--json', '--limit', '1', '--offset', '1'], dir);
      expect(availableCli.status).toBe(0);
      expect(availableCli.stderr).toBe('');
      const availableActual = JSON.parse(availableCli.stdout);
      expect(availableActual).toEqual(availableExpected);
      expect(Object.keys(availableActual).sort()).toEqual(TOP_LEVEL_KEYS);

      const unknownFunctionId = 'function:cfg-cli-never-indexed';
      const unknownExpected = cg.getCfg(unknownFunctionId, { limit: 1, offset: 1 });
      const unknownCli = runCfgCli([unknownFunctionId, '-p', dir, '--json', '--limit', '1', '--offset', '1'], dir);
      expect(unknownCli.status).toBe(0);
      expect(unknownCli.stderr).toBe('');
      expect(JSON.parse(unknownCli.stdout)).toEqual(unknownExpected);
      expect(unknownExpected).toMatchObject({
        cfg: null,
        page: null,
        reason: 'function_unknown',
        state: 'unknown_function',
      });
    } finally {
      cg.close();
    }
  });

  it('returns exact MCP CFG JSON deep-equal to CodeGraph.getCfg for an available function', async () => {
    await withCfgMcpTool(async () => {
      const { cg, dir, functionId } = await createCliProject(dirs, true);
      try {
        const expected = cg.getCfg(functionId, { limit: 1, offset: 1 });
        const actual = parseCfgMcp(
          await new ToolHandler(cg).execute('codegraph_get_cfg', {
            projectPath: dir,
            functionId,
            limit: 1,
            offset: 1,
          }),
        );

        expect(actual.isError).toBe(false);
        expect(actual.body).toEqual(expected);
        expect(Object.keys(actual.body).sort()).toEqual(TOP_LEVEL_KEYS);
      } finally {
        cg.close();
      }
    });
  });

  it('applies MCP CFG paging defaults, clamps, integer input validation, and independent block/edge windows', async () => {
    await withCfgMcpTool(async () => {
      const { cg, db, dir, functionId } = await createCliProject(dirs, true);
      try {
        seedCfgPagingPayload(db, functionId);
        const handler = new ToolHandler(cg);
        const read = async (request: Record<string, unknown> = {}) =>
          parseCfgMcp(
            await handler.execute('codegraph_get_cfg', {
              projectPath: dir,
              functionId,
              ...request,
            }),
          );

        const full = await read();
        expect(full.isError).toBe(false);
        expect(full.body.state).toBe('available');
        expect(full.body.page).toEqual({
          limit: 100,
          offset: 0,
          blocks: { total: 5, returned: 5, hasMore: false, nextOffset: null },
          edges: { total: 7, returned: 7, hasMore: false, nextOffset: null },
        });

        const lowClamp = await read({ limit: 0, offset: -4 });
        expect(lowClamp.isError).toBe(false);
        expect(lowClamp.body.page).toEqual({
          limit: 1,
          offset: 0,
          blocks: { total: 5, returned: 1, hasMore: true, nextOffset: 1 },
          edges: { total: 7, returned: 1, hasMore: true, nextOffset: 1 },
        });
        expect(cfgBlockIds(lowClamp.body)).toEqual(cfgBlockIds(full.body).slice(0, 1));
        expect(cfgEdgeKeys(lowClamp.body)).toEqual(cfgEdgeKeys(full.body).slice(0, 1));

        const highClamp = await read({ limit: 999, offset: 0 });
        expect(highClamp.isError).toBe(false);
        expect(highClamp.body.page).toEqual({
          limit: 500,
          offset: 0,
          blocks: { total: 5, returned: 5, hasMore: false, nextOffset: null },
          edges: { total: 7, returned: 7, hasMore: false, nextOffset: null },
        });

        const fractionalLimit = await handler.execute('codegraph_get_cfg', {
          projectPath: dir,
          functionId,
          limit: 2.8,
          offset: 1,
        });
        expect(fractionalLimit.isError).toBe(true);
        expect(fractionalLimit.content[0]?.type).toBe('text');
        expect(fractionalLimit.content[0]?.text).toContain('limit must be an integer');

        const fractionalOffset = await handler.execute('codegraph_get_cfg', {
          projectPath: dir,
          functionId,
          limit: 2,
          offset: 1.8,
        });
        expect(fractionalOffset.isError).toBe(true);
        expect(fractionalOffset.content[0]?.type).toBe('text');
        expect(fractionalOffset.content[0]?.text).toContain('offset must be an integer');

        const independentTotals = await read({ limit: 2, offset: 4 });
        expect(independentTotals.isError).toBe(false);
        expect(independentTotals.body.page).toEqual({
          limit: 2,
          offset: 4,
          blocks: { total: 5, returned: 1, hasMore: false, nextOffset: null },
          edges: { total: 7, returned: 2, hasMore: true, nextOffset: 6 },
        });
        expect(cfgBlockIds(independentTotals.body)).toEqual(cfgBlockIds(full.body).slice(4, 6));
        expect(cfgEdgeKeys(independentTotals.body)).toEqual(cfgEdgeKeys(full.body).slice(4, 6));
      } finally {
        cg.close();
      }
    });
  });

  it('reconstructs MCP CFG block and edge order across increasing offsets without duplicates or gaps', async () => {
    await withCfgMcpTool(async () => {
      const { cg, db, dir, functionId } = await createCliProject(dirs, true);
      try {
        seedCfgPagingPayload(db, functionId);
        const handler = new ToolHandler(cg);
        const read = async (offset: number) =>
          parseCfgMcp(
            await handler.execute('codegraph_get_cfg', {
              projectPath: dir,
              functionId,
              limit: 2,
              offset,
            }),
          );

        const full = parseCfgMcp(
          await handler.execute('codegraph_get_cfg', {
            projectPath: dir,
            functionId,
            limit: 500,
            offset: 0,
          }),
        ).body;
        const expectedBlocks = cfgBlockIds(full);
        const expectedEdges = cfgEdgeKeys(full);
        expect(expectedBlocks).toHaveLength(5);
        expect(expectedEdges).toHaveLength(7);

        const offsets: number[] = [];
        const reconstructedBlocks: string[] = [];
        const reconstructedEdges: string[] = [];
        let offset = 0;

        while (true) {
          offsets.push(offset);
          const page = await read(offset);
          expect(page.isError).toBe(false);
          expect(page.body.page?.blocks.total).toBe(expectedBlocks.length);
          expect(page.body.page?.edges.total).toBe(expectedEdges.length);
          reconstructedBlocks.push(...cfgBlockIds(page.body));
          reconstructedEdges.push(...cfgEdgeKeys(page.body));

          const nextOffsets = [page.body.page?.blocks.nextOffset, page.body.page?.edges.nextOffset].filter(
            (nextOffset): nextOffset is number => nextOffset !== null && nextOffset !== undefined,
          );
          if (nextOffsets.length === 0) break;
          offset = Math.max(...nextOffsets);
        }

        expect(offsets).toEqual([0, 2, 4, 6]);
        expect(reconstructedBlocks).toEqual(expectedBlocks);
        expect(reconstructedEdges).toEqual(expectedEdges);
        expect(new Set(reconstructedBlocks).size).toBe(reconstructedBlocks.length);
        expect(new Set(reconstructedEdges).size).toBe(reconstructedEdges.length);
      } finally {
        cg.close();
      }
    });
  });

  it('returns success-shaped MCP CFG results for representative expected non-payload states', async () => {
    await withCfgMcpTool(async () => {
      const { cg, dir, functionId } = await createCliProject(dirs, true);
      try {
        const unknownFunctionId = `${functionId}:missing`;
        const expected = cg.getCfg(unknownFunctionId, { limit: 1, offset: 0 });
        const actual = parseCfgMcp(
          await new ToolHandler(cg).execute('codegraph_get_cfg', {
            projectPath: dir,
            functionId: unknownFunctionId,
            limit: 1,
          }),
        );

        expect(expected.state).toBe('unknown_function');
        expect(actual.isError).toBe(false);
        expect(actual.body).toEqual(expected);
      } finally {
        cg.close();
      }
    });

    await withCfgMcpTool(async () => {
      const { cg, dir, functionId } = await createCliProject(dirs, false);
      try {
        const expected = cg.getCfg(functionId, { limit: 1, offset: 0 });
        const actual = parseCfgMcp(
          await new ToolHandler(cg).execute('codegraph_get_cfg', {
            projectPath: dir,
            functionId,
            limit: 1,
          }),
        );

        expect(expected.state).toBe('disabled');
        expect(actual.isError).toBe(false);
        expect(actual.body).toEqual(expected);
      } finally {
        cg.close();
      }
    });

    await withCfgMcpTool(async () => {
      const indexed = await createCliProject(dirs, true);
      const unindexed = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-mcp-noindex-'));
      dirs.push(unindexed);
      writeCfgConfig(unindexed, true);
      try {
        const actual = parseCfgMcp(
          await new ToolHandler(indexed.cg).execute('codegraph_get_cfg', {
            projectPath: unindexed,
            functionId: indexed.functionId,
            limit: 1,
          }),
        );

        expect(actual.isError).toBe(false);
        expect(actual.body).toMatchObject({
          analysis: 'cfg',
          cfg: null,
          functionId: indexed.functionId,
          page: null,
          reason: 'project_not_indexed',
          sourceVersion: null,
          stale: false,
          state: 'not_indexed',
        });
      } finally {
        indexed.cg.close();
      }
    });
  });

  it('exports exact CFG project status and aggregates mixed real SQLite states with deterministic precedence', async () => {
    const { cg, db, functionIds } = await createCfgStatusProject(dirs, true);
    try {
      const unsupportedId = functionIds.get('unsupportedOne')!;
      const limitedId = functionIds.get('limitedOne')!;
      const sourceStaleId = functionIds.get('sourceStaleOne')!;
      const retainedStaleId = functionIds.get('retainedStaleOne')!;

      setCurrentStoredCfgState(db, unsupportedId, 'unsupported', 'unsupported_construct');
      setCurrentStoredCfgState(db, limitedId, 'resource_limited', 'block_limit_exceeded');
      mismatchStoredCfgSourceVersion(db, sourceStaleId);
      markStoredCfgRefreshFailure(db, retainedStaleId);

      const getCfgStatus = (cg as unknown as { getCfgStatus?: () => CfgProjectStatus }).getCfgStatus;
      expect(getCfgStatus, 'CodeGraph must expose getCfgStatus()').toBeTypeOf('function');
      const mixed = getCfgStatus!.call(cg);
      expectCfgProjectStatus(mixed, {
        enabled: true,
        state: 'stale',
        reason: 'refresh_failed_retained_stale',
        availableCount: 1,
        skippedCount: 2,
        unsupportedCount: 1,
        resourceLimitedCount: 1,
        staleCount: 2,
      });

      db.prepare('DELETE FROM project_metadata WHERE key = ?').run(`cfg_refresh_failure:${retainedStaleId}`);
      expectCfgProjectStatus(getCfgStatus!.call(cg), {
        enabled: true,
        state: 'stale',
        reason: 'source_version_mismatch',
        availableCount: 2,
        skippedCount: 2,
        unsupportedCount: 1,
        resourceLimitedCount: 1,
        staleCount: 1,
      });
    } finally {
      cg.close();
    }
  });

  it('uses CFG project status precedence for disabled, not-computed, unavailable, empty, and available states', async () => {
    {
      const { cg, dir } = await createCfgStatusProject(dirs, true);
      try {
        writeCfgConfig(dir, false);
        expectCfgProjectStatus(
          (cg as unknown as { getCfgStatus: () => CfgProjectStatus }).getCfgStatus(),
          {
            enabled: false,
            state: 'disabled',
            reason: 'analysis_disabled',
            availableCount: 0,
            skippedCount: 0,
            unsupportedCount: 0,
            resourceLimitedCount: 0,
            staleCount: 0,
          },
        );
      } finally {
        cg.close();
      }
    }

    {
      const { cg, dir } = await createCliProject(dirs, false);
      try {
        writeCfgConfig(dir, true);
        expectCfgProjectStatus(
          (cg as unknown as { getCfgStatus: () => CfgProjectStatus }).getCfgStatus(),
          {
            enabled: true,
            state: 'not_computed',
            reason: 'cfg_not_computed',
            availableCount: 0,
            skippedCount: 0,
            unsupportedCount: 0,
            resourceLimitedCount: 0,
            staleCount: 0,
          },
        );
      } finally {
        cg.close();
      }
    }

    {
      const { cg, db, functionId } = await createCliProject(dirs, true);
      try {
        setCurrentStoredCfgState(db, functionId, 'unavailable', 'first_refresh_failed');
        expectCfgProjectStatus(
          (cg as unknown as { getCfgStatus: () => CfgProjectStatus }).getCfgStatus(),
          {
            enabled: true,
            state: 'unavailable',
            reason: 'first_refresh_failed',
            availableCount: 0,
            skippedCount: 0,
            unsupportedCount: 0,
            resourceLimitedCount: 0,
            staleCount: 0,
          },
        );
      } finally {
        cg.close();
      }
    }

    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-status-empty-'));
      dirs.push(dir);
      writeCfgConfig(dir, true);
      fs.writeFileSync(path.join(dir, 'values.ts'), 'export const value = 1;\n');
      const cg = CodeGraph.initSync(dir);
      try {
        expect((await cg.indexAll()).success).toBe(true);
        expectCfgProjectStatus(
          (cg as unknown as { getCfgStatus: () => CfgProjectStatus }).getCfgStatus(),
          {
            enabled: true,
            state: 'empty',
            reason: 'no_current_cfg_functions',
            availableCount: 0,
            skippedCount: 0,
            unsupportedCount: 0,
            resourceLimitedCount: 0,
            staleCount: 0,
          },
        );
      } finally {
        cg.close();
      }
    }

    {
      const { cg } = await createCliProject(dirs, true);
      try {
        expectCfgProjectStatus(
          (cg as unknown as { getCfgStatus: () => CfgProjectStatus }).getCfgStatus(),
          {
            enabled: true,
            state: 'available',
            reason: null,
            availableCount: 1,
            skippedCount: 0,
            unsupportedCount: 0,
            resourceLimitedCount: 0,
            staleCount: 0,
          },
        );
      } finally {
        cg.close();
      }
    }
  });

  it('keeps first-refresh failures above retained stale CFGs when no current CFG is available', async () => {
    const { cg, db, functionIds } = await createCfgStatusProject(dirs, true);
    try {
      setCurrentStoredCfgState(db, functionIds.get('availableOne')!, 'unavailable', 'first_refresh_failed');
      setCurrentStoredCfgState(db, functionIds.get('unsupportedOne')!, 'unsupported', 'unsupported_construct');
      setCurrentStoredCfgState(db, functionIds.get('limitedOne')!, 'resource_limited', 'block_limit_exceeded');
      mismatchStoredCfgSourceVersion(db, functionIds.get('sourceStaleOne')!);
      markStoredCfgRefreshFailure(db, functionIds.get('retainedStaleOne')!);

      expectCfgProjectStatus(
        (cg as unknown as { getCfgStatus: () => CfgProjectStatus }).getCfgStatus(),
        {
          enabled: true,
          state: 'unavailable',
          reason: 'first_refresh_failed',
          availableCount: 0,
          skippedCount: 2,
          unsupportedCount: 1,
          resourceLimitedCount: 1,
          staleCount: 2,
        },
      );
    } finally {
      cg.close();
    }
  });

  it('prints built-CLI CFG project status JSON and human output matching library status', async () => {
    const { cg, db, dir, functionIds } = await createCfgStatusProject(dirs, true);
    try {
      setCurrentStoredCfgState(db, functionIds.get('unsupportedOne')!, 'unsupported', 'unsupported_construct');
      setCurrentStoredCfgState(db, functionIds.get('limitedOne')!, 'resource_limited', 'block_limit_exceeded');
      mismatchStoredCfgSourceVersion(db, functionIds.get('sourceStaleOne')!);
      markStoredCfgRefreshFailure(db, functionIds.get('retainedStaleOne')!);

      const expected = (cg as unknown as { getCfgStatus: () => CfgProjectStatus }).getCfgStatus();
      const json = runStatusCli(['--json'], dir);
      expect(json.status).toBe(0);
      expect(json.stderr).toBe('');
      const body = parseStatusJson(json.stdout);
      expectCfgProjectStatus(body.cfg as CfgProjectStatus, expected);

      const human = runStatusCli([], dir);
      expect(human.status).toBe(0);
      expect(human.stderr).toBe('');
      expect(human.stdout).toContain('CFG:');
      expect(human.stdout).toContain('Enabled:   yes');
      expect(human.stdout).toContain('State:     stale (refresh_failed_retained_stale)');
      expect(human.stdout).toContain('Available: 1');
      expect(human.stdout).toContain('Skipped:   2');
      expect(human.stdout).toContain('Unsupported: 1');
      expect(human.stdout).toContain('Resource limited: 1');
      expect(human.stdout).toContain('Stale:     2');
      for (const functionId of functionIds.values()) {
        expect(human.stdout).not.toContain(functionId);
      }
    } finally {
      cg.close();
    }
  });

  it('includes CFG project status in uninitialized built-CLI JSON and human status output', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-status-uninitialized-'));
    dirs.push(dir);
    writeCfgConfig(dir, true);

    const json = runStatusCli(['--json'], dir);
    expect(json.status).toBe(0);
    expect(json.stderr).toBe('');
    const body = parseStatusJson(json.stdout);
    expect(body.initialized).toBe(false);
    expectCfgProjectStatus(body.cfg as CfgProjectStatus, {
      enabled: true,
      state: 'not_indexed',
      reason: 'project_not_indexed',
      availableCount: 0,
      skippedCount: 0,
      unsupportedCount: 0,
      resourceLimitedCount: 0,
      staleCount: 0,
    });

    const human = runStatusCli([], dir);
    expect(human.status).toBe(0);
    expect(human.stderr).toBe('');
    expect(human.stdout).toContain('CFG:');
    expect(human.stdout).toContain('Enabled:   yes');
    expect(human.stdout).toContain('State:     not_indexed (project_not_indexed)');
  });

  it('keeps expected CFG read states exact across library, built CLI JSON/human, and MCP surfaces', async () => {
    const matrix: Array<{ state: CfgState; reason: CfgReason | null }> = [
      { state: 'disabled', reason: 'analysis_disabled' },
      { state: 'not_indexed', reason: 'project_not_indexed' },
      { state: 'not_computed', reason: 'cfg_not_computed' },
      { state: 'unknown_function', reason: 'function_unknown' },
      { state: 'unsupported', reason: 'unsupported_construct' },
      { state: 'resource_limited', reason: 'block_limit_exceeded' },
      { state: 'unavailable', reason: 'first_refresh_failed' },
      { state: 'stale', reason: 'source_version_mismatch' },
      { state: 'deleted', reason: 'function_deleted' },
      { state: 'available', reason: null },
    ];

    await withCfgMcpTool(async () => {
      for (const { state, reason } of matrix) {
        const { cg, close, dir, expected, functionId } = await createCfgParityCase(dirs, state);
        try {
          expectCfgReadSurfaceResult(expected, state, reason);

          const cliJson = runCfgCli([functionId, '-p', dir, '--json', '--limit', '1', '--offset', '0'], dir);
          expect(cliJson.status, `${state} JSON exit`).toBe(0);
          expect(cliJson.stderr, `${state} JSON stderr`).toBe('');
          const cliBody = JSON.parse(cliJson.stdout) as CfgReadResult;
          expectCfgReadSurfaceResult(cliBody, state, reason);
          expect(cliBody, `${state} CLI JSON parity`).toEqual(expected);

          const cliHuman = runCfgCli([functionId, '-p', dir, '--limit', '1', '--offset', '0'], dir);
          expect(cliHuman.status, `${state} human exit`).toBe(0);
          expect(cliHuman.stderr, `${state} human stderr`).toBe('');
          expectBoundedHumanSummary(cliHuman.stdout, expected);

          const mcp = parseCfgMcp(
            await new ToolHandler(cg ?? null).execute('codegraph_get_cfg', {
              projectPath: dir,
              functionId,
              limit: 1,
              offset: 0,
            }),
          );
          expect(mcp.isError, `${state} MCP isError`).toBe(false);
          expectCfgReadSurfaceResult(mcp.body, state, reason);
          expect(mcp.body, `${state} MCP parity`).toEqual(expected);
        } finally {
          close?.();
        }
      }
    });

    const invalidWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-parity-invalid-'));
    dirs.push(invalidWorkspace);
    const invalidCli = runCfgCli(['function:cfg-invalid', '-p', invalidWorkspace, '--json'], invalidWorkspace);
    expect(invalidCli.status).not.toBe(0);
    expect(invalidCli.stdout).toBe('');

    const invalidMcp = await new ToolHandler(null).execute('codegraph_get_cfg', {
      projectPath: invalidWorkspace,
      functionId: 'function:cfg-invalid',
    });
    expect(invalidMcp.isError).toBe(true);
  }, 30_000);

  it('T037 proves mixed TypeScript and Python CFG read/status parity across library, CLI, and MCP surfaces', async () => {
    const { cg, dir, ids } = await createMixedPythonTsCfgProject(dirs);
    try {
      const tsFull = await expectCfgReadSurfacesDeepEqual({
        cg,
        dir,
        functionId: ids.tsAvailable,
        state: 'available',
        reason: null,
      });
      const pythonFull = await expectCfgReadSurfacesDeepEqual({
        cg,
        dir,
        functionId: ids.pythonAvailable,
        state: 'available',
        reason: null,
      });
      await expectCfgReadSurfacesDeepEqual({
        cg,
        dir,
        functionId: ids.pythonParserUnavailable,
        state: 'unsupported',
        reason: 'parser_unavailable',
      });
      await expectCfgReadSurfacesDeepEqual({
        cg,
        dir,
        functionId: ids.pythonResourceLimited,
        state: 'resource_limited',
        reason: 'block_limit_exceeded',
      });

      expect(tsFull.cfg?.language).toBe('typescript');
      expect(pythonFull.cfg?.language).toBe('python');
      expectLimitOneReconstruction(cg, ids.tsAvailable, cg.getCfg(ids.tsAvailable, { limit: 500, offset: 0 }));
      expectLimitOneReconstruction(cg, ids.pythonAvailable, cg.getCfg(ids.pythonAvailable, { limit: 500, offset: 0 }));

      const expectedStatus = (cg as unknown as { getCfgStatus: () => CfgProjectStatus }).getCfgStatus();
      expectCfgProjectStatus(expectedStatus, {
        enabled: true,
        state: 'available',
        reason: null,
        availableCount: 2,
        skippedCount: 2,
        unsupportedCount: 1,
        resourceLimitedCount: 1,
        staleCount: 0,
      });

      const statusJson = runStatusCli(['--json'], dir);
      expect(statusJson.status).toBe(0);
      expect(statusJson.stderr).toBe('');
      const statusBody = parseStatusJson(statusJson.stdout);
      expectCfgProjectStatus(statusBody.cfg as CfgProjectStatus, expectedStatus);
    } finally {
      cg.close();
    }
  });

  it('T037 keeps unchanged Python CFG indexing byte-stable across repeated real SQLite indexes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-python-stable-'));
    dirs.push(dir);
    writeCfgConfig(dir, true);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.copyFileSync(
      path.join(PYTHON_FIXTURE_DIR, 'parity_baseline.py'),
      path.join(dir, 'src', 'parity_baseline.py'),
    );

    const cg = CodeGraph.initSync(dir);
    try {
      const snapshots: Array<{
        blockIds: string[];
        bytes: string;
        functionId: string;
        graphId: string;
        sourceVersion: string;
        totals: ReturnType<typeof graphTotals>;
      }> = [];

      for (let run = 0; run < 3; run++) {
        expect((await cg.indexAll({ embeddingsProvider: 'off', lsp: 'disable' })).success).toBe(true);
        const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
        const functionId = functionIdForRequired(db, 'src/parity_baseline.py', 'branch_loop_parity');
        const result = cg.getCfg(functionId, { limit: 500, offset: 0 });
        expect(result.state).toBe('available');
        expect(result.cfg).not.toBeNull();
        snapshots.push({
          blockIds: result.cfg!.blocks.map((block) => block.id),
          bytes: JSON.stringify(result),
          functionId,
          graphId: result.cfg!.graphId,
          sourceVersion: result.sourceVersion!,
          totals: graphTotals(db),
        });
      }

      expect(snapshots).toHaveLength(3);
      const [first] = snapshots;
      for (const snapshot of snapshots) {
        expect(snapshot.functionId).toBe(first!.functionId);
        expect(snapshot.graphId).toBe(first!.graphId);
        expect(snapshot.sourceVersion).toBe(first!.sourceVersion);
        expect(snapshot.blockIds).toEqual(first!.blockIds);
        expect(snapshot.totals).toEqual(first!.totals);
        expect(snapshot.bytes).toBe(first!.bytes);
      }
    } finally {
      cg.close();
    }
  });

  it.runIf(process.env.CODEGRAPH_PYTHON_FIXTURE_UAT === '1')(
    'T038 runs the Python fixture CFG UAT against library, built CLI, MCP paging, and status',
    async () => {
      const mirrorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-python-fixture-uat-'));
      dirs.push(mirrorDir);
      writeCfgConfig(mirrorDir, true);
      fs.mkdirSync(path.join(mirrorDir, 'src'), { recursive: true });
      fs.copyFileSync(
        path.join(PYTHON_FIXTURE_DIR, 'parity_baseline.py'),
        path.join(mirrorDir, 'src', 'parity_baseline.py'),
      );

      let cg: CodeGraph | null = null;
      try {
        cg = CodeGraph.initSync(mirrorDir);
        const indexResult = await cg.indexAll({ embeddingsProvider: 'off', lsp: 'disable' });
        expect(indexResult.success).toBe(true);

        const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
        const functionId = functionIdForRequired(db, 'src/parity_baseline.py', 'branch_loop_parity');
        const libraryFull = cg.getCfg(functionId, { limit: 500, offset: 0 });
        expectCfgReadSurfaceResult(libraryFull, 'available', null);
        expect(libraryFull.cfg?.language).toBe('python');
        expect(libraryFull.page?.blocks.total).toBeGreaterThan(0);
        expect(libraryFull.page?.edges.total).toBeGreaterThan(0);

        const cliJson = runCfgCli([functionId, '-p', mirrorDir, '--json', '--limit', '500', '--offset', '0'], mirrorDir);
        expect(cliJson.status).toBe(0);
        expect(cliJson.stderr).toBe('');
        expect(JSON.parse(cliJson.stdout)).toEqual(libraryFull);

        const cliHuman = runCfgCli([functionId, '-p', mirrorDir, '--limit', '1', '--offset', '0'], mirrorDir);
        expect(cliHuman.status).toBe(0);
        expect(cliHuman.stderr).toBe('');
        expectBoundedHumanSummary(cliHuman.stdout, cg.getCfg(functionId, { limit: 1, offset: 0 }));

        const mcpPages = await withCfgMcpTool(async () => {
          const handler = new ToolHandler(cg);
          const expectedBlocks = cfgBlockIds(libraryFull);
          const expectedEdges = cfgEdgeKeys(libraryFull);
          const reconstructedBlocks: string[] = [];
          const reconstructedEdges: string[] = [];
          let offset = 0;
          let pages = 0;

          while (true) {
            pages += 1;
            const expectedPage = cg!.getCfg(functionId, { limit: 1, offset });
            const actualPage = parseCfgMcp(
              await handler.execute('codegraph_get_cfg', {
                projectPath: mirrorDir,
                functionId,
                limit: 1,
                offset,
              }),
            );
            expect(actualPage.isError).toBe(false);
            expect(actualPage.body).toEqual(expectedPage);
            reconstructedBlocks.push(...cfgBlockIds(actualPage.body));
            reconstructedEdges.push(...cfgEdgeKeys(actualPage.body));

            const nextOffsets = [
              actualPage.body.page?.blocks.nextOffset,
              actualPage.body.page?.edges.nextOffset,
            ].filter((nextOffset): nextOffset is number => nextOffset !== null && nextOffset !== undefined);
            if (nextOffsets.length === 0) break;
            offset = Math.max(...nextOffsets);
          }

          expect(reconstructedBlocks).toEqual(expectedBlocks);
          expect(reconstructedEdges).toEqual(expectedEdges);
          expect(new Set(reconstructedBlocks).size).toBe(reconstructedBlocks.length);
          expect(new Set(reconstructedEdges).size).toBe(reconstructedEdges.length);
          return pages;
        });

        const libraryStatus = (cg as unknown as { getCfgStatus: () => CfgProjectStatus }).getCfgStatus();
        const statusJson = runStatusCli(['--json'], mirrorDir);
        expect(statusJson.status).toBe(0);
        expect(statusJson.stderr).toBe('');
        const statusBody = parseStatusJson(statusJson.stdout);
        expectCfgProjectStatus(statusBody.cfg as CfgProjectStatus, libraryStatus);
        expectCfgProjectStatus(libraryStatus, {
          enabled: true,
          state: 'available',
          reason: null,
          availableCount: 1,
          skippedCount: 0,
          unsupportedCount: 0,
          resourceLimitedCount: 0,
          staleCount: 0,
        });

        console.log(JSON.stringify({
          uat: 'spec-014-python-fixture-cfg',
          functionId,
          graphId: libraryFull.cfg!.graphId,
          sourceVersion: libraryFull.sourceVersion,
          totals: {
            blocks: libraryFull.page!.blocks.total,
            edges: libraryFull.page!.edges.total,
          },
          mcpPages,
          status: libraryStatus,
        }));
      } finally {
        cg?.close();
      }
    },
    120_000,
  );

  it.runIf(process.env.CODEGRAPH_SELF_REPO_UAT === '1')(
    'dogfoods the current repository through library, built CLI JSON, MCP pages, and status',
    async () => {
      const repoRoot = path.resolve(__dirname, '../../../');
      const mirrorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-self-repo-'));
      dirs.push(mirrorDir);

      let cg: CodeGraph | null = null;
      try {
        const copiedFiles = copyTrackedSelfRepoTsJsFiles(repoRoot, mirrorDir);
        writeCfgConfig(mirrorDir, true);

        cg = CodeGraph.initSync(mirrorDir);
        const indexResult = await cg.indexAll({ embeddingsProvider: 'off', lsp: 'disable' });
        expect(indexResult.success).toBe(true);

        const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
        const candidate = selectSelfRepoCfgCandidate(db);
        const functionId = candidate.function_id;
        const sqlTotals = {
          blocks: Number(candidate.block_count),
          edges: Number(candidate.edge_count),
        };

        const libraryFull = cg.getCfg(functionId, { limit: 500, offset: 0 });
        expect(libraryFull.state).toBe('available');
        expect(libraryFull.reason).toBeNull();
        expect(libraryFull.cfg).not.toBeNull();
        expect(libraryFull.page).not.toBeNull();
        expect(libraryFull.functionId).toBe(functionId);
        expect(libraryFull.sourceVersion).toBe(candidate.source_version);
        expect(libraryFull.cfg!.sourceVersion).toBe(candidate.source_version);
        expect(libraryFull.cfg!.blocks).toHaveLength(sqlTotals.blocks);
        expect(libraryFull.cfg!.edges).toHaveLength(sqlTotals.edges);
        expect(libraryFull.page).toEqual({
          limit: 500,
          offset: 0,
          blocks: { total: sqlTotals.blocks, returned: sqlTotals.blocks, hasMore: false, nextOffset: null },
          edges: { total: sqlTotals.edges, returned: sqlTotals.edges, hasMore: false, nextOffset: null },
        });

        const cliJson = runCfgCli([functionId, '-p', mirrorDir, '--json', '--limit', '500', '--offset', '0'], mirrorDir);
        expect(cliJson.status).toBe(0);
        expect(cliJson.stderr).toBe('');
        const cliBody = JSON.parse(cliJson.stdout) as CfgReadResult;
        expect(cliBody).toEqual(libraryFull);
        expect(Object.keys(cliBody).sort()).toEqual(TOP_LEVEL_KEYS);

        const pageCount = await withCfgMcpTool(async () => {
          const handler = new ToolHandler(cg);
          const expectedBlocks = cfgBlockIds(libraryFull);
          const expectedEdges = cfgEdgeKeys(libraryFull);
          const reconstructedBlocks: string[] = [];
          const reconstructedEdges: string[] = [];
          const offsets: number[] = [];
          let offset = 0;

          while (true) {
            offsets.push(offset);
            const expectedPage = cg!.getCfg(functionId, { limit: 1, offset });
            const actualPage = parseCfgMcp(
              await handler.execute('codegraph_get_cfg', {
                projectPath: mirrorDir,
                functionId,
                limit: 1,
                offset,
              }),
            );
            expect(actualPage.isError).toBe(false);
            expect(actualPage.body).toEqual(expectedPage);
            reconstructedBlocks.push(...cfgBlockIds(actualPage.body));
            reconstructedEdges.push(...cfgEdgeKeys(actualPage.body));

            const nextOffsets = [
              actualPage.body.page?.blocks.nextOffset,
              actualPage.body.page?.edges.nextOffset,
            ].filter((nextOffset): nextOffset is number => nextOffset !== null && nextOffset !== undefined);
            if (nextOffsets.length === 0) break;
            offset = Math.max(...nextOffsets);
          }

          expect(reconstructedBlocks).toEqual(expectedBlocks);
          expect(reconstructedEdges).toEqual(expectedEdges);
          expect(new Set(reconstructedBlocks).size).toBe(reconstructedBlocks.length);
          expect(new Set(reconstructedEdges).size).toBe(reconstructedEdges.length);
          expect(offsets).toEqual(Array.from({ length: offsets.length }, (_, index) => index));
          return offsets.length;
        });

        const libraryStatus = (cg as unknown as { getCfgStatus: () => CfgProjectStatus }).getCfgStatus();
        const statusJson = runStatusCli(['--json'], mirrorDir);
        expect(statusJson.status).toBe(0);
        expect(statusJson.stderr).toBe('');
        const statusBody = parseStatusJson(statusJson.stdout);
        expectCfgProjectStatus(statusBody.cfg as CfgProjectStatus, libraryStatus);
        expect(libraryStatus.enabled).toBe(true);
        expect(libraryStatus.availableCount).toBeGreaterThan(0);
        expect(libraryStatus.staleCount).toBe(0);
        expect(libraryStatus.skippedCount).toBe(libraryStatus.unsupportedCount + libraryStatus.resourceLimitedCount);

        console.log(JSON.stringify({
          uat: 'spec-014-self-repo-cfg',
          runtime: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
          },
          copiedFiles,
          functionId,
          filePath: candidate.file_path,
          startLine: Number(candidate.start_line),
          sourceVersion: libraryFull.sourceVersion,
          graphId: libraryFull.cfg!.graphId,
          totals: sqlTotals,
          mcpPages: pageCount,
          status: libraryStatus,
        }));
      } finally {
        cg?.close();
      }
    },
    120_000,
  );

  it('prints bounded human CFG summaries by default without payload arrays', async () => {
    const { cg, dir, functionId } = await createCliProject(dirs, true);
    try {
      const expected = cg.getCfg(functionId, { limit: 1, offset: 0 });
      const cli = runCfgCli([functionId, '-p', dir, '--limit', '1', '--offset', '0'], dir);

      expect(expected.state).toBe('available');
      expect(cli.status).toBe(0);
      expect(cli.stderr).toBe('');
      expectBoundedHumanSummary(cli.stdout, expected);
      expect(cli.stdout).not.toContain('return value + 1');
    } finally {
      cg.close();
    }
  });

  it('exits zero and shows state/reason for every expected CFG CLI state', async () => {
    const realStates = new Set<CfgState>();

    const record = (expected: CfgReadResult, cli: { stderr: string; stdout: string; status: number | null }) => {
      expect(cli.status).toBe(0);
      expect(cli.stderr).toBe('');
      expectBoundedHumanSummary(cli.stdout, expected);
      realStates.add(expected.state);
    };

    {
      const { cg, dir, functionId } = await createCliProject(dirs, true);
      try {
        const expected = cg.getCfg(functionId, { limit: 1, offset: 0 });
        expect(expected.state).toBe('available');
        record(expected, runCfgCli([functionId, '-p', dir, '--limit', '1'], dir));
      } finally {
        cg.close();
      }
    }

    {
      const { cg, dir, functionId } = await createCliProject(dirs, true);
      try {
        const unknownFunctionId = `${functionId}:missing`;
        const expected = cg.getCfg(unknownFunctionId, { limit: 1, offset: 0 });
        expect(expected.state).toBe('unknown_function');
        record(expected, runCfgCli([unknownFunctionId, '-p', dir, '--limit', '1'], dir));
      } finally {
        cg.close();
      }
    }

    {
      const { cg, dir, functionId } = await createCliProject(dirs, false);
      try {
        const expected = cg.getCfg(functionId, { limit: 1, offset: 0 });
        expect(expected.state).toBe('disabled');
        record(expected, runCfgCli([functionId, '-p', dir, '--limit', '1'], dir));

        writeCfgConfig(dir, true);
        const notComputed = cg.getCfg(functionId, { limit: 1, offset: 0 });
        expect(notComputed.state).toBe('not_computed');
        record(notComputed, runCfgCli([functionId, '-p', dir, '--limit', '1'], dir));
      } finally {
        cg.close();
      }
    }

    for (const { state, reason } of ZERO_EXIT_STATE_TABLE.filter((item) =>
      ['deleted', 'resource_limited', 'unavailable', 'unsupported'].includes(item.state)
    )) {
      const { cg, db, dir, functionId } = await createCliProject(dirs, true);
      try {
        const available = cg.getCfg(functionId, { limit: 1, offset: 0 });
        expect(available.sourceVersion).not.toBeNull();
        setStoredCfgState(
          db,
          functionId,
          state as 'deleted' | 'resource_limited' | 'unavailable' | 'unsupported',
          reason!,
          state === 'deleted' ? null : available.sourceVersion,
        );
        const expected = cg.getCfg(functionId, { limit: 1, offset: 0 });
        expect(expected.state).toBe(state);
        record(expected, runCfgCli([functionId, '-p', dir, '--limit', '1'], dir));
      } finally {
        cg.close();
      }
    }

    {
      const { cg, db, dir, functionId } = await createCliProject(dirs, true);
      try {
        const available = cg.getCfg(functionId, { limit: 1, offset: 0 });
        expect(available.sourceVersion).not.toBeNull();
        db.prepare('UPDATE cfg_status SET source_version = ? WHERE function_id = ?').run(
          `${available.sourceVersion}:stale`,
          functionId,
        );
        const expected = cg.getCfg(functionId, { limit: 1, offset: 0 });
        expect(expected.state).toBe('stale');
        record(expected, runCfgCli([functionId, '-p', dir, '--limit', '1'], dir));
      } finally {
        cg.close();
      }
    }

    expect([...realStates].sort()).toEqual([
      'available',
      'deleted',
      'disabled',
      'not_computed',
      'resource_limited',
      'stale',
      'unavailable',
      'unknown_function',
      'unsupported',
    ]);
    expect(ZERO_EXIT_STATE_TABLE.some((item) => item.state === 'not_indexed')).toBe(true);
  });

  it('fails invalid CFG CLI paging and invalid projects with nonzero exits', async () => {
    const { cg, dir, functionId } = await createCliProject(dirs, true);
    try {
      const invalidLimit = runCfgCli([functionId, '-p', dir, '--limit', 'nope'], dir);
      expect(invalidLimit.status).not.toBe(0);
      expect(invalidLimit.stdout).toBe('');
      expect(invalidLimit.stderr).toContain('Invalid --limit');

      const invalidOffset = runCfgCli([functionId, '-p', dir, '--offset', 'NaN'], dir);
      expect(invalidOffset.status).not.toBe(0);
      expect(invalidOffset.stdout).toBe('');
      expect(invalidOffset.stderr).toContain('Invalid --offset');

      const invalidUsage = runCfgCli(['--json'], dir);
      expect(invalidUsage.status).not.toBe(0);
      expect(invalidUsage.stdout).toBe('');

      const invalidRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-invalid-project-'));
      dirs.push(invalidRoot);
      const invalidProject = runCfgCli([functionId, '-p', invalidRoot, '--json'], invalidRoot);
      expect(invalidProject.status).not.toBe(0);
      expect(invalidProject.stdout).toBe('');
      expect(invalidProject.stderr).toContain('CodeGraph not initialized');
    } finally {
      cg.close();
    }
  });
});
