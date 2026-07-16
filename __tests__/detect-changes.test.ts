import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CodeGraph } from '../src';
import { acquireGitDiff } from '../src/analysis/detect-changes/git-diff';
import { detectChanges } from '../src/analysis/detect-changes';
import { enrichImpact } from '../src/analysis/detect-changes/impact';
import { buildInitialReport, parseFailOn, renderMarkdownReport } from '../src/analysis/detect-changes/report';
import { createDetectChangesFixture, indexFixture, type DetectChangesFixture } from './helpers/detect-changes-fixture';

describe('detect changes', () => {
  let fixture: DetectChangesFixture | null = null;

  afterEach(() => {
    fixture?.close();
    fixture = null;
  });

  async function indexedFixture(): Promise<DetectChangesFixture> {
    fixture = createDetectChangesFixture();
    await indexFixture(fixture);
    return fixture;
  }

  it('acquires unstaged, staged, all, and base-ref diffs', async () => {
    const fx = await indexedFixture();
    fx.write('src/calculator.ts', 'export function computeTotal(value: number) {\n  return value + 2;\n}\n');
    expect(acquireGitDiff(fx.dir, { mode: 'unstaged' }).hunks.map((h) => h.newPath)).toContain('src/calculator.ts');

    fx.git(['add', 'src/calculator.ts']);
    expect(acquireGitDiff(fx.dir, { mode: 'staged' }).hunks.map((h) => h.newPath)).toContain('src/calculator.ts');

    fx.write('src/extra.ts', 'export function extra() {\n  return 1;\n}\n');
    const all = acquireGitDiff(fx.dir, { mode: 'all' });
    expect(all.hunks.some((h) => h.newPath === 'src/calculator.ts')).toBe(true);
    expect(all.hunks.some((h) => h.newPath === 'src/extra.ts' && h.reason === 'untracked')).toBe(true);

    fx.git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'change', '-q']);
    const base = fx.git(['rev-parse', 'HEAD~1']).trim();
    const baseRef = acquireGitDiff(fx.dir, { mode: 'base-ref', baseRef: base });
    expect(baseRef.mergeBase).toBe(base);
    expect(baseRef.hunks.some((h) => h.newPath === 'src/calculator.ts')).toBe(true);
  });

  it('compares base-ref diffs against the explicit PR head instead of a synthetic merge HEAD', async () => {
    fixture = createDetectChangesFixture();
    const fx = fixture;
    const baseBranch = fx.git(['branch', '--show-current']).trim();
    const prBase = fx.git(['rev-parse', 'HEAD']).trim();
    fx.git(['checkout', '-b', 'pr-head', '-q']);
    fx.write('src/calculator.ts', 'export function computeTotal(value: number) {\n  return value + 2;\n}\n');
    fx.git(['add', 'src/calculator.ts']);
    fx.git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'pr change', '-q']);
    const prHead = fx.git(['rev-parse', 'HEAD']).trim();

    fx.git(['checkout', baseBranch, '-q']);
    fx.write('src/base-only.ts', 'export function baseOnly() {\n  return true;\n}\n');
    fx.git(['add', 'src/base-only.ts']);
    fx.git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'base change', '-q']);
    const baseTip = fx.git(['rev-parse', 'HEAD']).trim();

    fx.git(['checkout', '-b', 'synthetic-merge', prHead, '-q']);
    fx.git(['-c', 'commit.gpgsign=false', 'merge', '--no-ff', baseTip, '-m', 'synthetic merge', '-q']);

    const syntheticHead = acquireGitDiff(fx.dir, { mode: 'base-ref', baseRef: prBase });
    const explicitHead = acquireGitDiff(fx.dir, { mode: 'base-ref', baseRef: prBase, headRef: prHead });

    expect(syntheticHead.hunks.some((h) => h.newPath === 'src/base-only.ts')).toBe(true);
    expect(explicitHead.hunks.some((h) => h.newPath === 'src/base-only.ts')).toBe(false);
    expect(explicitHead.hunks.some((h) => h.newPath === 'src/calculator.ts')).toBe(true);
  });

  it('maps textual hunks to changed symbols and reports unmapped reason precedence', async () => {
    const fx = await indexedFixture();
    fx.write('src/calculator.ts', [
      'export function computeTotal(value: number) {',
      '  return value + 2;',
      '}',
      '',
      'export function renderTotal() {',
      '  return computeTotal(41);',
      '}',
      '',
    ].join('\n'));
    fx.write('assets/logo.bin', Buffer.from([0, 1, 2, 3, 4, 5, 0, 9]));
    fx.write('notes.txt', 'not indexed but tracked\n');
    fx.git(['add', 'notes.txt']);
    fx.git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'track notes', '-q']);
    fx.write('notes.txt', 'changed text\n');

    const report = await detectChanges(fx.cg, { mode: 'all' });
    expect(report.changedSymbols.some((s) => s.name === 'computeTotal')).toBe(true);
    expect(report.unmappedHunks.some((h) => h.reason === 'binary' && h.newPath === 'assets/logo.bin')).toBe(true);
    expect(report.unmappedHunks.some((h) => h.reason === 'unsupported' && h.newPath === 'notes.txt')).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it('reports pure renames without symbol impact, maps edited renames and deleted indexed symbols, and reports untracked files', async () => {
    const fx = await indexedFixture();
    fx.git(['mv', 'src/rename-me.ts', 'src/renamed.ts']);
    let report = await detectChanges(fx.cg, { mode: 'all' });
    expect(report.changedSymbols.some((s) => s.name === 'movedOnly')).toBe(false);
    expect(report.callers).toHaveLength(0);
    expect(report.affectedFlows.items).toHaveLength(0);
    expect(report.risks).toHaveLength(0);
    expect(report.unmappedHunks).toContainEqual(expect.objectContaining({
      oldPath: 'src/rename-me.ts',
      newPath: 'src/renamed.ts',
      reason: 'no-symbol-span',
      message: 'Path-only rename or move is reported without mapped symbol impact.',
    }));
    expect(report.summary.status).toBe('impact');
    expect(report.exitCode).toBe(1);

    fx.write('src/renamed.ts', 'export function movedOnly() {\n  return false;\n}\n');
    report = await detectChanges(fx.cg, { mode: 'all' });
    expect(report.changedSymbols.some((s) => s.name === 'movedOnly')).toBe(true);

    fx.remove('src/delete-me.ts');
    fx.write('src/untracked.ts', 'export function untrackedSymbol() { return 1; }\n');
    report = await detectChanges(fx.cg, { mode: 'all' });
    expect(report.changedSymbols.some((s) => s.name === 'deletedSymbol' && s.changeType === 'deleted')).toBe(true);
    expect(report.unmappedHunks.some((h) => h.reason === 'untracked' && h.newPath === 'src/untracked.ts')).toBe(true);
  });

  it('uses base graph symbols for deleted files after the head index is rebuilt', async () => {
    const previousDir = process.env.CODEGRAPH_DIR;
    fixture = createDetectChangesFixture();
    const fx = fixture;
    await indexFixture(fx);
    fx.remove('src/delete-me.ts');

    process.env.CODEGRAPH_DIR = '.codegraph-head-test';
    const headGraph = CodeGraph.initSync(fx.dir);
    try {
      await headGraph.indexAll();
      const report = await detectChanges(headGraph, { mode: 'all' }, { baseGraph: fx.cg });

      expect(report.changedSymbols).toContainEqual(expect.objectContaining({
        name: 'deletedSymbol',
        changeType: 'deleted',
        filePath: 'src/delete-me.ts',
      }));
      expect(report.unmappedHunks.some((h) => h.oldPath === 'src/delete-me.ts')).toBe(false);
    } finally {
      headGraph.close();
      if (previousDir === undefined) delete process.env.CODEGRAPH_DIR;
      else process.env.CODEGRAPH_DIR = previousDir;
      fs.rmSync(path.join(fx.dir, '.codegraph-head-test'), { recursive: true, force: true });
    }
  });

  it('expands direct callers and emits threshold breach risks', async () => {
    const fx = await indexedFixture();
    fx.write('src/calculator.ts', [
      'export function computeTotal(value: number) {',
      '  return value + 2;',
      '}',
      '',
      'export function renderTotal() {',
      '  return computeTotal(41);',
      '}',
      '',
    ].join('\n'));

    const report = await detectChanges(fx.cg, { mode: 'all', failOn: 'callers>0' });
    expect(report.callers.some((caller) => caller.name === 'renderTotal')).toBe(true);
    expect(report.summary.status).toBe('threshold_breach');
    expect(report.exitCode).toBe(2);
  });

  it('evaluates caller failOn policy before truncating displayed callers', async () => {
    fixture = createDetectChangesFixture();
    const fx = fixture;
    fx.write('src/calculator.ts', [
      'export function computeTotal(value: number) {',
      '  return value + 1;',
      '}',
      '',
      'export function renderTotalA() {',
      '  return computeTotal(1);',
      '}',
      '',
      'export function renderTotalB() {',
      '  return computeTotal(2);',
      '}',
      '',
      'export function renderTotalC() {',
      '  return computeTotal(3);',
      '}',
      '',
    ].join('\n'));
    fx.git(['add', 'src/calculator.ts']);
    fx.git([
      '-c', 'user.email=test@example.com',
      '-c', 'user.name=Test User',
      '-c', 'commit.gpgsign=false',
      'commit', '-m', 'expand callers', '-q',
    ]);
    await indexFixture(fx);
    fx.write('src/calculator.ts', [
      'export function computeTotal(value: number) {',
      '  return value + 2;',
      '}',
      '',
      'export function renderTotalA() {',
      '  return computeTotal(1);',
      '}',
      '',
      'export function renderTotalB() {',
      '  return computeTotal(2);',
      '}',
      '',
      'export function renderTotalC() {',
      '  return computeTotal(3);',
      '}',
      '',
    ].join('\n'));

    const report = await detectChanges(fx.cg, { mode: 'all', maxCallers: 1, failOn: 'callers>1' });
    expect(report.callers).toHaveLength(1);
    expect(report.limits.truncatedCallers).toBe(true);
    expect(report.risks).toContainEqual(expect.objectContaining({
      code: 'threshold-breach',
      policy: 'callers>1',
    }));
    expect(report.summary.status).toBe('threshold_breach');
    expect(report.exitCode).toBe(2);
  });

  it('matches affected flows beyond the first display page before truncating', () => {
    const report = buildInitialReport({
      mode: 'all',
      baseRef: null,
      headRef: null,
      format: 'json',
      failOn: null,
      callerDepth: 1,
      maxCallers: 20,
      projectPath: undefined,
    }, [
      {
        id: 'symbol:1',
        nodeId: 'node:changed',
        name: 'changed',
        qualifiedName: 'changed',
        kind: 'function',
        filePath: 'src/changed.ts',
        startLine: 1,
        endLine: 3,
        changeType: 'modified',
        hunkIds: ['hunk:1'],
      },
    ], [], []);
    const summaries = Array.from({ length: 21 }, (_, index) => ({
      id: `flow:${index}`,
      name: index === 20 ? 'Late affected flow' : `Unrelated ${index}`,
      entryKind: 'function',
      stepCount: 1,
      truncated: false,
    }));
    const cg = {
      getProjectRoot: () => process.cwd(),
      getFiles: () => [],
      getNodesInFile: () => [],
      getCallers: () => [],
      listFlows: (limit: number, offset: number) => ({
        items: summaries.slice(offset, offset + limit),
        total: summaries.length,
        limit,
        offset,
        sourceVersion: 1,
        state: 'available' as const,
      }),
      getFlowById: (id: string) => ({
        found: true,
        flow: {
          id,
          name: summaries.find((summary) => summary.id === id)?.name ?? id,
          entryKind: 'function',
          steps: id === 'flow:20' ? [{ nodeId: 'node:changed' }] : [{ nodeId: 'node:other' }],
          truncated: false,
        },
      }),
    };

    enrichImpact(cg, report);

    expect(report.affectedFlows.items).toContainEqual(expect.objectContaining({
      flowId: 'flow:20',
      name: 'Late affected flow',
    }));
    expect(report.limits.truncatedFlows).toBe(false);
  });

  it('parses failOn grammar', () => {
    expect(parseFailOn('callers>10,hub')).toEqual([
      { raw: 'callers>10', kind: 'callers', threshold: 10 },
      { raw: 'hub', kind: 'hub' },
    ]);
    expect(() => parseFailOn('callers>=10')).toThrow(/Invalid failOn/);
  });

  it('escapes markdown table cells with backslashes, pipes, and newlines', () => {
    const report = buildInitialReport({
      mode: 'all',
      baseRef: null,
      headRef: null,
      format: 'markdown',
      failOn: null,
      callerDepth: 1,
      maxCallers: 20,
      projectPath: undefined,
    }, [
      {
        id: 'symbol\\id|pipe',
        nodeId: 'node-1',
        name: 'symbol',
        qualifiedName: 'Calculator\\total|value',
        kind: 'function',
        filePath: 'src\\windows|pipe.ts',
        startLine: 1,
        endLine: 2,
        changeType: 'modified',
        hunkIds: ['hunk\\1|pipe'],
      },
    ], [
      {
        hunkId: 'hunk\\2|pipe',
        oldPath: null,
        newPath: 'src/multi|line.ts',
        newStart: 3,
        newLines: 1,
        reason: 'unsupported',
        message: 'bad\\path | message\nnext',
      },
    ], [
      {
        code: 'warn\\code|x',
        message: 'warn\\message | next\nline',
      },
    ]);

    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain('warn\\\\code\\|x');
    expect(markdown).toContain('warn\\\\message \\| next line');
    expect(markdown).toContain('Calculator\\\\total\\|value');
    expect(markdown).toContain('src\\\\windows\\|pipe.ts');
    expect(markdown).toContain('hunk\\\\1\\|pipe');
    expect(markdown).toContain('src/multi\\|line.ts');
    expect(markdown).toContain('bad\\\\path \\| message next');
  });
});
