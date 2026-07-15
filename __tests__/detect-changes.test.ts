import { describe, it, expect, afterEach } from 'vitest';
import { acquireGitDiff } from '../src/analysis/detect-changes/git-diff';
import { detectChanges } from '../src/analysis/detect-changes';
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
