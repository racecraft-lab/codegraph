import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CodeGraph } from '../../../src/index';
import type { CfgGraph } from '../../../src/analysis/cfg';

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/python');
const tempDirs: string[] = [];
const openGraphs: CodeGraph[] = [];

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

const PYTHON_FIXTURES = [
  {
    file: 'async_await.py',
    contains: ['async def fetch_profile(', 'await client.fetch_profile(', 'return await client.refresh_profile('],
  },
  {
    file: 'comprehensions.py',
    contains: [
      '[item.name for item in items if item.active]',
      '{item.kind for item in items if item.kind}',
      '{item.name: item.score for item in items if item.score >= minimum}',
      '(item.score for item in items if item.score >= minimum)',
    ],
  },
  {
    file: 'generators.py',
    contains: ['def stream_chunks(', 'yield chunk', 'yield from fallback'],
  },
  {
    file: 'lambdas_and_nested_classes.py',
    contains: ['transform = lambda value: value.strip().lower()', 'class LocalFormatter:', 'return LocalFormatter(prefix).format_all(values)'],
  },
  {
    file: 'match_case.py',
    contains: [
      'match event:',
      'case {"type": "click", "target": target} if target:',
      'case {"type": "submit"}:',
      'case _:',
    ],
  },
  {
    file: 'parity_baseline.py',
    contains: ['def branch_loop_parity(', 'for item in items:', 'while attempts < 3:', 'continue'],
  },
  {
    file: 'raise_and_unreachable.py',
    contains: ['raise ValueError("missing name")', 'return "accepted"', 'unreachable_after_return = "never reached"'],
  },
] as const;

function createPythonProject(files: Readonly<Record<string, string>>, cfgEnabled = false): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-python-'));
  tempDirs.push(projectRoot);
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  if (cfgEnabled) {
    fs.writeFileSync(
      path.join(projectRoot, 'codegraph.json'),
      JSON.stringify({ analysis: { cfg: true } }, null, 2),
    );
  }

  for (const [fileName, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(projectRoot, 'src', fileName), source);
  }

  return projectRoot;
}

async function indexPythonProject(
  files: Readonly<Record<string, string>>,
): Promise<{ db: any; graph: CodeGraph; projectRoot: string }> {
  const projectRoot = createPythonProject(files);
  const graph = await CodeGraph.init(projectRoot, { index: true });
  openGraphs.push(graph);
  const db = (graph as unknown as { db: { getDb(): any } }).db.getDb();
  return { db, graph, projectRoot };
}

async function indexPythonCfgProject(
  files: Readonly<Record<string, string>>,
): Promise<{ db: any; graph: CodeGraph; projectRoot: string }> {
  const projectRoot = createPythonProject(files, true);
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
  const matches = rows.filter((row) => row.name === name);
  expect(matches, `expected exactly one function row for ${name}`).toHaveLength(1);
  return matches[0]!;
}

function expectedLambdaName(source: string, marker: string, occurrence = 0): string {
  let offset = -1;
  for (let index = 0; index <= occurrence; index++) {
    offset = source.indexOf(marker, offset + 1);
  }
  expect(offset, `expected source marker ${marker}`).toBeGreaterThanOrEqual(0);

  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n') - 1;
  return `<lambda@${line}:${column}>`;
}

function cleanupProjects(): void {
  while (openGraphs.length > 0) {
    openGraphs.pop()?.destroy();
  }

  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
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

async function indexPythonFunctionCfg(
  fileName: string,
  functionName: string,
  source: string,
): Promise<CfgGraph> {
  const { db, graph } = await indexPythonCfgProject({ [fileName]: source });
  const rows = functionRowsForFile(db, fileName);
  return readAvailableCfg(graph, requireFunctionRow(rows, functionName));
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

describe('SPEC-014 T003 Python CFG fixture inventory', () => {
  afterEach(cleanupProjects);

  it('commits deterministic Python fixtures for the Python CFG construct families', () => {
    expect(fs.existsSync(FIXTURE_DIR), 'Python fixture directory must be committed').toBe(true);

    const expectedFiles = PYTHON_FIXTURES.map((fixture) => fixture.file);
    const actualFiles = fs.readdirSync(FIXTURE_DIR).filter((file) => file.endsWith('.py')).sort();
    expect(actualFiles).toEqual(expectedFiles);

    for (const fixture of PYTHON_FIXTURES) {
      const source = fs.readFileSync(path.join(FIXTURE_DIR, fixture.file), 'utf8');
      expect(source, `${fixture.file} uses LF line endings`).not.toContain('\r');
      expect(source, `${fixture.file} ends with a newline`).toMatch(/\n$/);

      for (const expected of fixture.contains) {
        expect(source, `${fixture.file} contains ${expected}`).toContain(expected);
      }
    }
  });

  it('indexes the committed lambda fixture with a positional lambda function ID', async () => {
    const fileName = 'lambdas_and_nested_classes.py';
    const source = fs.readFileSync(path.join(FIXTURE_DIR, fileName), 'utf8');
    const { db } = await indexPythonProject({ [fileName]: source });

    const rows = functionRowsForFile(db, fileName);
    const lambdaName = expectedLambdaName(source, 'lambda value');
    const lambdaRow = requireFunctionRow(rows, lambdaName);

    expect(rows.map((row) => row.name)).toEqual([
      'normalize_with_local_class',
      lambdaName,
      '__init__',
      'format_all',
    ]);
    expect(lambdaRow).toMatchObject({
      kind: 'function',
      name: lambdaName,
      qualified_name: `normalize_with_local_class::${lambdaName}`,
      start_line: 2,
      start_column: 16,
    });
    expect(lambdaRow.id).toMatch(/^function:/);
  });

  it('keeps lambda function IDs stable across repeated Python indexing', async () => {
    const fileName = 'lambdas_and_nested_classes.py';
    const source = fs.readFileSync(path.join(FIXTURE_DIR, fileName), 'utf8');
    const { db, graph } = await indexPythonProject({ [fileName]: source });
    const snapshots: FunctionNodeRow[][] = [];

    for (let run = 0; run < 3; run++) {
      if (run > 0) {
        await graph.indexAll();
      }

      snapshots.push(functionRowsForFile(db, fileName));
    }

    expect(snapshots).toHaveLength(3);
    const lambdaName = expectedLambdaName(source, 'lambda value');
    const firstSnapshot = snapshots[0]!;
    const firstLambdaRow = requireFunctionRow(firstSnapshot, lambdaName);
    for (const snapshot of snapshots) {
      expect(snapshot.map((row) => row.name)).toEqual(firstSnapshot.map((row) => row.name));
      expect(requireFunctionRow(snapshot, lambdaName).id).toBe(firstLambdaRow.id);
    }
  });

  it('assigns distinct positional IDs to top-level and same-line Python lambdas', async () => {
    const fileName = 'same_line_lambdas.py';
    const source = [
      'def helper(value):',
      '    return value',
      'def caller(value):',
      '    return helper(value)',
      'top_level = lambda value: helper(value)',
      'first = lambda value: helper(value); second = lambda value: helper(value + 1)',
      '',
    ].join('\n');
    const { db } = await indexPythonProject({ [fileName]: source });
    const rows = functionRowsForFile(db, fileName);
    const topLevelLambda = expectedLambdaName(source, 'lambda value');
    const firstSameLineLambda = expectedLambdaName(source, 'lambda value', 1);
    const secondSameLineLambda = expectedLambdaName(source, 'lambda value', 2);

    const lambdaRows = [topLevelLambda, firstSameLineLambda, secondSameLineLambda].map((name) =>
      requireFunctionRow(rows, name),
    );
    expect(new Set(lambdaRows.map((row) => row.id)).size).toBe(3);
    expect(lambdaRows.map((row) => row.start_line)).toEqual([5, 6, 6]);
    expect(lambdaRows.map((row) => row.start_column)).toEqual([12, 8, 46]);

    const callEdges = db
      .prepare(
        [
          'SELECT source.name AS source_name, target.name AS target_name',
          'FROM edges',
          'INNER JOIN nodes source ON source.id = edges.source',
          'INNER JOIN nodes target ON target.id = edges.target',
          'WHERE edges.kind = \'calls\' AND target.name = \'helper\'',
          'ORDER BY source.start_line, source.start_column',
        ].join(' '),
      )
      .all() as Array<{ source_name: string; target_name: string }>;

    expect(callEdges).toEqual([
      { source_name: 'caller', target_name: 'helper' },
      { source_name: topLevelLambda, target_name: 'helper' },
      { source_name: firstSameLineLambda, target_name: 'helper' },
      { source_name: secondSameLineLambda, target_name: 'helper' },
    ]);
  });
});

describe('SPEC-014 T033 Python CFG baseline semantics', () => {
  afterEach(cleanupProjects);

  it('T033 persists committed Python for-in and while loops with real break and continue routing', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'parity_baseline.py'), 'utf8');
    const cfg = await indexPythonFunctionCfg('parity_baseline.py', 'branch_loop_parity', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:body:total = 0',
      '1:body:total = 0 -fallthrough-> 2:body:attempts = 0',
      '2:body:attempts = 0 -fallthrough-> 3:condition:items',
      '3:condition:items -true-> 4:body:item',
      '3:condition:items -false-> 10:condition:attempts < 3',
      '4:body:item -fallthrough-> 5:condition:item is None',
      '5:condition:item is None -true-> 6:body:continue',
      '5:condition:item is None -false-> 7:condition:item < 0',
      '6:body:continue -continue-> 3:condition:items',
      '7:condition:item < 0 -true-> 8:body:break',
      '7:condition:item < 0 -false-> 9:body:total += item',
      '8:body:break -break-> 10:condition:attempts < 3',
      '9:body:total += item -loop_back-> 3:condition:items',
      '10:condition:attempts < 3 -true-> 11:condition:total > 10',
      '10:condition:attempts < 3 -false-> 15:body:return total',
      '11:condition:total > 10 -true-> 12:body:return total',
      '11:condition:total > 10 -false-> 13:body:attempts += 1',
      '12:body:return total -return-> 16:exit',
      '13:body:attempts += 1 -fallthrough-> 14:body:total += attempts',
      '14:body:total += attempts -loop_back-> 10:condition:attempts < 3',
      '15:body:return total -return-> 16:exit',
    ]);
  });

  it('T033 maps committed Python raise statements to throw edges and keeps unreachable blocks disconnected', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'raise_and_unreachable.py'), 'utf8');
    const cfg = await indexPythonFunctionCfg('raise_and_unreachable.py', 'require_name', source);
    const incomingTargets = new Set(cfg.edges.map((edge) => edge.target));
    const unreachableBlocks = cfg.blocks.filter((block) => block.role === 'unreachable');

    expect(unreachableBlocks.map((block) => blockTextLabel(source, block))).toEqual([
      '5:unreachable:unreachable_after_return = "never reached"',
    ]);
    for (const block of unreachableBlocks) {
      expect(incomingTargets.has(block.id)).toBe(false);
    }
    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:"name" not in record',
      '1:condition:"name" not in record -true-> 2:body:raise ValueError("missing name")',
      '1:condition:"name" not in record -false-> 3:condition:record["name"]',
      '2:body:raise ValueError("missing name") -throw-> 7:exit',
      '3:condition:record["name"] -true-> 4:body:return "accepted"',
      '3:condition:record["name"] -false-> 6:body:raise RuntimeError("empty name")',
      '4:body:return "accepted" -return-> 7:exit',
      '6:body:raise RuntimeError("empty name") -throw-> 7:exit',
    ]);
  });

  it('T033 keeps committed Python lambdas and nested class bodies opaque in enclosing CFGs', async () => {
    const fileName = 'lambdas_and_nested_classes.py';
    const source = fs.readFileSync(path.join(FIXTURE_DIR, fileName), 'utf8');
    const { db, graph } = await indexPythonCfgProject({ [fileName]: source });
    const rows = functionRowsForFile(db, fileName);
    const lambdaName = expectedLambdaName(source, 'lambda value');

    expect(rows.map((row) => row.name)).toEqual([
      'normalize_with_local_class',
      lambdaName,
      '__init__',
      'format_all',
    ]);

    const outerCfg = readAvailableCfg(graph, requireFunctionRow(rows, 'normalize_with_local_class'));
    expect(outerCfg.blocks.slice(1, -1).map((block) => spanText(source, block.spans[0]!))).toEqual([
      'transform = lambda value: value.strip().lower()',
      'class LocalFormatter: def __init__(self, label): self.label = label def format_all(self, raw_values): return [f"{self.label}:{transform(value)}" for value in raw_values]',
      'return LocalFormatter(prefix).format_all(values)',
    ]);
    expect(outerCfg.blocks.some((block) => block.role === 'condition')).toBe(false);
    expect(edgeTextPaths(outerCfg, source)).toEqual([
      '0:entry -fallthrough-> 1:body:transform = lambda value: value.strip().lower()',
      '1:body:transform = lambda value: value.strip().lower() -fallthrough-> 2:body:class LocalFormatter: def __init__(self, label): self.label = label def format_all(self, raw_values): return [f"{self.label}:{transform(value)}" for value in raw_values]',
      '2:body:class LocalFormatter: def __init__(self, label): self.label = label def format_all(self, raw_values): return [f"{self.label}:{transform(value)}" for value in raw_values] -fallthrough-> 3:body:return LocalFormatter(prefix).format_all(values)',
      '3:body:return LocalFormatter(prefix).format_all(values) -return-> 4:exit',
    ]);

    const lambdaCfg = readAvailableCfg(graph, requireFunctionRow(rows, lambdaName));
    expect(edgeTextPaths(lambdaCfg, source)).toEqual([
      '0:entry -fallthrough-> 1:body:value.strip().lower()',
      '1:body:value.strip().lower() -return-> 2:exit',
    ]);

    const initCfg = readAvailableCfg(graph, requireFunctionRow(rows, '__init__'));
    expect(edgeTextPaths(initCfg, source)).toEqual([
      '0:entry -fallthrough-> 1:body:self.label = label',
      '1:body:self.label = label -fallthrough-> 2:exit',
    ]);

    const nestedFunctionSource = [
      'def outer_named(value):',
      '    def inner_named(item):',
      '        if item:',
      '            return item',
      '        return "empty"',
      '    return inner_named(value)',
      '',
    ].join('\n');
    const nested = await indexPythonCfgProject({ 'nested_function_probe.py': nestedFunctionSource });
    const nestedRows = functionRowsForFile(nested.db, 'nested_function_probe.py');

    expect(nestedRows.map((row) => row.name)).toEqual(['outer_named', 'inner_named']);

    const nestedOuterCfg = readAvailableCfg(nested.graph, requireFunctionRow(nestedRows, 'outer_named'));
    expect(edgeTextPaths(nestedOuterCfg, nestedFunctionSource)).toEqual([
      '0:entry -fallthrough-> 1:body:def inner_named(item): if item: return item return "empty"',
      '1:body:def inner_named(item): if item: return item return "empty" -fallthrough-> 2:body:return inner_named(value)',
      '2:body:return inner_named(value) -return-> 3:exit',
    ]);
    expect(nestedOuterCfg.blocks.some((block) => block.role === 'condition')).toBe(false);

    const nestedInnerCfg = readAvailableCfg(nested.graph, requireFunctionRow(nestedRows, 'inner_named'));
    expect(edgeTextPaths(nestedInnerCfg, nestedFunctionSource)).toEqual([
      '0:entry -fallthrough-> 1:condition:item',
      '1:condition:item -true-> 2:body:return item',
      '1:condition:item -false-> 3:body:return "empty"',
      '2:body:return item -return-> 4:exit',
      '3:body:return "empty" -return-> 4:exit',
    ]);
  });

  it('T033 routes Python try/finally normal and abrupt transfers through lexical finally', async () => {
    const source = [
      'def cleanup_probe(flag, explode):',
      '    try:',
      '        if flag:',
      '            return 1',
      '        if explode:',
      '            raise ValueError("x")',
      '        value = 2',
      '    finally:',
      '        value = 3',
      '    return value',
      '',
    ].join('\n');
    const cfg = await indexPythonFunctionCfg('try_finally_probe.py', 'cleanup_probe', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:flag',
      '1:condition:flag -true-> 2:body:return 1',
      '1:condition:flag -false-> 3:condition:explode',
      '2:body:return 1 -finally-> 6:body:value = 3',
      '3:condition:explode -true-> 4:body:raise ValueError("x")',
      '3:condition:explode -false-> 5:body:value = 2',
      '4:body:raise ValueError("x") -finally-> 7:body:value = 3',
      '5:body:value = 2 -finally-> 8:body:value = 3',
      '6:body:value = 3 -return-> 10:exit',
      '7:body:value = 3 -throw-> 10:exit',
      '8:body:value = 3 -fallthrough-> 9:body:return value',
      '9:body:return value -return-> 10:exit',
    ]);
  });

});

describe('SPEC-014 T034 Python match/case CFG semantics', () => {
  afterEach(cleanupProjects);

  it('T034 persists committed Python match cases as source-ordered predicates with a wildcard default', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'match_case.py'), 'utf8');
    const cfg = await indexPythonFunctionCfg('match_case.py', 'route_event', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:event',
      '1:condition:event -case-> 2:condition:{"type": "click", "target": target}',
      '2:condition:{"type": "click", "target": target} -true-> 3:condition:target',
      '2:condition:{"type": "click", "target": target} -false-> 5:condition:{"type": "submit"}',
      '3:condition:target -true-> 4:body:return ("click", target)',
      '3:condition:target -false-> 5:condition:{"type": "submit"}',
      '4:body:return ("click", target) -return-> 11:exit',
      '5:condition:{"type": "submit"} -true-> 6:body:return ("submit", None)',
      '5:condition:{"type": "submit"} -false-> 7:condition:{"type": other}',
      '6:body:return ("submit", None) -return-> 11:exit',
      '7:condition:{"type": other} -true-> 8:body:return ("known", other)',
      '7:condition:{"type": other} -default-> 9:condition:_',
      '8:body:return ("known", other) -return-> 11:exit',
      '9:condition:_ -true-> 10:body:return ("unknown", None)',
      '10:body:return ("unknown", None) -return-> 11:exit',
    ]);
  });

  it('T034 routes guarded Python cases through and/or short-circuit RHS calls before the next predicate', async () => {
    const source = [
      'def guarded_match(event):',
      '    match event:',
      '        case {"type": "click", "target": target} if target and expensive(target) or fallback(event):',
      '            return "guarded"',
      '        case _:',
      '            return "fallback"',
      '',
    ].join('\n');
    const cfg = await indexPythonFunctionCfg('guarded_match.py', 'guarded_match', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:event',
      '1:condition:event -case-> 2:condition:{"type": "click", "target": target}',
      '2:condition:{"type": "click", "target": target} -true-> 3:condition:target',
      '2:condition:{"type": "click", "target": target} -default-> 7:condition:_',
      '3:condition:target -true-> 4:condition:expensive(target)',
      '3:condition:target -false-> 5:condition:fallback(event)',
      '4:condition:expensive(target) -true-> 6:body:return "guarded"',
      '4:condition:expensive(target) -false-> 5:condition:fallback(event)',
      '5:condition:fallback(event) -true-> 6:body:return "guarded"',
      '5:condition:fallback(event) -default-> 7:condition:_',
      '6:body:return "guarded" -return-> 9:exit',
      '7:condition:_ -true-> 8:body:return "fallback"',
      '8:body:return "fallback" -return-> 9:exit',
    ]);
  });

  it('T034 lets a guarded wildcard case fall through to the next predicate when its guard is false', async () => {
    const source = [
      'def guarded_wildcard(value):',
      '    match value:',
      '        case _ if should_accept(value):',
      '            return "guarded"',
      '        case "fallback":',
      '            return "fallback"',
      '        case _:',
      '            return "default"',
      '',
    ].join('\n');
    const cfg = await indexPythonFunctionCfg('guarded_wildcard.py', 'guarded_wildcard', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:value',
      '1:condition:value -case-> 2:condition:_',
      '2:condition:_ -true-> 3:condition:should_accept(value)',
      '3:condition:should_accept(value) -true-> 4:body:return "guarded"',
      '3:condition:should_accept(value) -false-> 5:condition:"fallback"',
      '4:body:return "guarded" -return-> 9:exit',
      '5:condition:"fallback" -true-> 6:body:return "fallback"',
      '5:condition:"fallback" -default-> 7:condition:_',
      '6:body:return "fallback" -return-> 9:exit',
      '7:condition:_ -true-> 8:body:return "default"',
      '8:body:return "default" -return-> 9:exit',
    ]);
  });
});

describe('SPEC-014 T035 Python comprehension CFG semantics', () => {
  afterEach(cleanupProjects);

  it('T035 persists committed Python list, set, dict, and generator comprehensions with source spans', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'comprehensions.py'), 'utf8');
    const cfg = await indexPythonFunctionCfg('comprehensions.py', 'summarize_items', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:items',
      '1:condition:items -true-> 2:body:item',
      '1:condition:items -false-> 5:body:names = [item.name for item in items if item.active]',
      '2:body:item -fallthrough-> 3:condition:item.active',
      '3:condition:item.active -true-> 4:body:item.name',
      '3:condition:item.active -loop_back-> 1:condition:items',
      '4:body:item.name -loop_back-> 1:condition:items',
      '5:body:names = [item.name for item in items if item.active] -fallthrough-> 6:condition:items',
      '6:condition:items -true-> 7:body:item',
      '6:condition:items -false-> 10:body:kinds = {item.kind for item in items if item.kind}',
      '7:body:item -fallthrough-> 8:condition:item.kind',
      '8:condition:item.kind -true-> 9:body:item.kind',
      '8:condition:item.kind -loop_back-> 6:condition:items',
      '9:body:item.kind -loop_back-> 6:condition:items',
      '10:body:kinds = {item.kind for item in items if item.kind} -fallthrough-> 11:condition:items',
      '11:condition:items -true-> 12:body:item',
      '11:condition:items -false-> 16:body:scores = {item.name: item.score for item in items if item.score >= minimum}',
      '12:body:item -fallthrough-> 13:condition:item.score >= minimum',
      '13:condition:item.score >= minimum -true-> 14:body:item.name',
      '13:condition:item.score >= minimum -loop_back-> 11:condition:items',
      '14:body:item.name -fallthrough-> 15:body:item.score',
      '15:body:item.score -loop_back-> 11:condition:items',
      '16:body:scores = {item.name: item.score for item in items if item.score >= minimum} -fallthrough-> 17:condition:items',
      '17:condition:items -true-> 18:body:item',
      '17:condition:items -false-> 21:body:first_score = next((item.score for item in items if item.score >= minimum), None)',
      '18:body:item -fallthrough-> 19:condition:item.score >= minimum',
      '19:condition:item.score >= minimum -true-> 20:body:item.score',
      '19:condition:item.score >= minimum -loop_back-> 17:condition:items',
      '20:body:item.score -loop_back-> 17:condition:items',
      '21:body:first_score = next((item.score for item in items if item.score >= minimum), None) -fallthrough-> 22:body:return names, kinds, scores, first_score',
      '22:body:return names, kinds, scores, first_score -return-> 23:exit',
    ]);
  });

  it('T035 evaluates dictionary comprehension iterable, filter, key, then value in order', async () => {
    const source = [
      'def dict_order_probe(records):',
      '    scores = {key(item): value(item) for item in iterable(records) if allowed(item)}',
      '    return scores',
      '',
    ].join('\n');
    const cfg = await indexPythonFunctionCfg('dict_order_probe.py', 'dict_order_probe', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:iterable(records)',
      '1:condition:iterable(records) -true-> 2:body:item',
      '1:condition:iterable(records) -false-> 6:body:scores = {key(item): value(item) for item in iterable(records) if allowed(item)}',
      '2:body:item -fallthrough-> 3:condition:allowed(item)',
      '3:condition:allowed(item) -true-> 4:body:key(item)',
      '3:condition:allowed(item) -loop_back-> 1:condition:iterable(records)',
      '4:body:key(item) -fallthrough-> 5:body:value(item)',
      '5:body:value(item) -loop_back-> 1:condition:iterable(records)',
      '6:body:scores = {key(item): value(item) for item in iterable(records) if allowed(item)} -fallthrough-> 7:body:return scores',
      '7:body:return scores -return-> 8:exit',
    ]);
  });

  it('T035 processes nested comprehension for/if clauses in source order with inner loop backedges', async () => {
    const source = [
      'def nested_pairs(rows):',
      '    pairs = [(row, col) for row in rows if row.enabled for col in row.columns if col.visible]',
      '    return pairs',
      '',
    ].join('\n');
    const cfg = await indexPythonFunctionCfg('nested_pairs.py', 'nested_pairs', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:rows',
      '1:condition:rows -true-> 2:body:row',
      '1:condition:rows -false-> 8:body:pairs = [(row, col) for row in rows if row.enabled for col in row.columns if col.visible]',
      '2:body:row -fallthrough-> 3:condition:row.enabled',
      '3:condition:row.enabled -true-> 4:condition:row.columns',
      '3:condition:row.enabled -loop_back-> 1:condition:rows',
      '4:condition:row.columns -true-> 5:body:col',
      '4:condition:row.columns -loop_back-> 1:condition:rows',
      '5:body:col -fallthrough-> 6:condition:col.visible',
      '6:condition:col.visible -true-> 7:body:(row, col)',
      '6:condition:col.visible -loop_back-> 4:condition:row.columns',
      '7:body:(row, col) -loop_back-> 4:condition:row.columns',
      '8:body:pairs = [(row, col) for row in rows if row.enabled for col in row.columns if col.visible] -fallthrough-> 9:body:return pairs',
      '9:body:return pairs -return-> 10:exit',
    ]);
  });
});

describe('SPEC-014 T036 Python await and generator CFG semantics', () => {
  afterEach(cleanupProjects);

  it('T036 treats committed await expressions as ordinary intra-procedural operations', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'async_await.py'), 'utf8');
    const cfg = await indexPythonFunctionCfg('async_await.py', 'fetch_profile', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:body:response = await client.fetch_profile(user_id)',
      '1:body:response = await client.fetch_profile(user_id) -fallthrough-> 2:condition:response.status == 404',
      '2:condition:response.status == 404 -true-> 3:body:return await client.refresh_profile(user_id)',
      '2:condition:response.status == 404 -false-> 4:condition:response.ok',
      '3:body:return await client.refresh_profile(user_id) -return-> 7:exit',
      '4:condition:response.ok -true-> 5:body:return response.payload',
      '4:condition:response.ok -false-> 6:body:return None',
      '5:body:return response.payload -return-> 7:exit',
      '6:body:return None -return-> 7:exit',
    ]);
    expect(cfg.blocks.map((block) => block.role)).toEqual([
      'entry',
      'body',
      'condition',
      'body',
      'condition',
      'body',
      'body',
      'exit',
    ]);
    expect(new Set(cfg.edges.map((edge) => edge.kind))).toEqual(new Set(['fallthrough', 'true', 'false', 'return']));
  });

  it('T036 treats committed yield and yield-from expressions as ordinary loop and fallthrough operations', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'generators.py'), 'utf8');
    const cfg = await indexPythonFunctionCfg('generators.py', 'stream_chunks', source);

    expect(edgeTextPaths(cfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:chunks',
      '1:condition:chunks -true-> 2:body:chunk',
      '1:condition:chunks -false-> 5:body:yield from fallback',
      '2:body:chunk -fallthrough-> 3:condition:chunk',
      '3:condition:chunk -true-> 4:body:yield chunk',
      '3:condition:chunk -loop_back-> 1:condition:chunks',
      '4:body:yield chunk -loop_back-> 1:condition:chunks',
      '5:body:yield from fallback -fallthrough-> 6:exit',
    ]);
    expect(cfg.blocks.map((block) => block.role)).toEqual([
      'entry',
      'condition',
      'body',
      'condition',
      'body',
      'body',
      'exit',
    ]);
    expect(new Set(cfg.edges.map((edge) => edge.kind))).toEqual(new Set(['fallthrough', 'true', 'false', 'loop_back']));
  });

  it('T036 delegates branch-containing await and yield operands to ordinary expression lowering', async () => {
    const source = [
      'async def await_branch(client, cached):',
      '    return await (cached or client.fetch())',
      '',
      'def yield_branch(chunk):',
      '    yield chunk if chunk else fallback()',
      '',
    ].join('\n');

    const awaitCfg = await indexPythonFunctionCfg('await_yield_branch_probe.py', 'await_branch', source);
    expect(edgeTextPaths(awaitCfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:cached',
      '1:condition:cached -true-> 3:body:return await (cached or client.fetch())',
      '1:condition:cached -false-> 2:body:client.fetch()',
      '2:body:client.fetch() -fallthrough-> 3:body:return await (cached or client.fetch())',
      '3:body:return await (cached or client.fetch()) -return-> 4:exit',
    ]);
    expect(new Set(awaitCfg.edges.map((edge) => edge.kind))).toEqual(new Set(['fallthrough', 'true', 'false', 'return']));

    const yieldCfg = await indexPythonFunctionCfg('await_yield_branch_probe.py', 'yield_branch', source);
    expect(edgeTextPaths(yieldCfg, source)).toEqual([
      '0:entry -fallthrough-> 1:condition:chunk',
      '1:condition:chunk -true-> 2:body:chunk',
      '1:condition:chunk -false-> 3:body:fallback()',
      '2:body:chunk -fallthrough-> 4:body:yield chunk if chunk else fallback()',
      '3:body:fallback() -fallthrough-> 4:body:yield chunk if chunk else fallback()',
      '4:body:yield chunk if chunk else fallback() -fallthrough-> 5:exit',
    ]);
    expect(new Set(yieldCfg.edges.map((edge) => edge.kind))).toEqual(new Set(['fallthrough', 'true', 'false']));
  });
});
