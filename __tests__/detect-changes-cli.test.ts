import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { createDetectChangesFixture, indexFixture, type DetectChangesFixture } from './helpers/detect-changes-fixture';

const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');
const CLI_TIMEOUT_MS = 120_000;

describe('detect-changes CLI', () => {
  let fixture: DetectChangesFixture | null = null;

  afterEach(() => {
    fixture?.close();
    fixture = null;
  });

  function run(args: string[], cwd?: string) {
    return spawnSync(process.execPath, [BIN, 'detect-changes', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CODEGRAPH_WASM_RELAUNCHED: '1' },
      maxBuffer: 10 * 1024 * 1024,
      timeout: CLI_TIMEOUT_MS,
    });
  }

  it('prints JSON and returns clean/impact/threshold exit codes', async () => {
    fixture = createDetectChangesFixture();
    await indexFixture(fixture);

    let res = run(['--path', fixture.dir, '--mode', 'all', '--format', 'json']);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).summary.status).toBe('clean');

    fixture.write('src/calculator.ts', 'export function computeTotal(value: number) {\n  return value + 2;\n}\n');
    res = run(['--path', fixture.dir, '--mode', 'all', '--format', 'json']);
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).changedSymbols.some((s: { name: string }) => s.name === 'computeTotal')).toBe(true);

    res = run(['--path', fixture.dir, '--mode', 'all', '--format', 'json', '--fail-on', 'callers>0']);
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).summary.status).toBe('threshold_breach');
  });

  it('prints complete large JSON reports before returning non-zero', async () => {
    fixture = createDetectChangesFixture();
    const source = Array.from({ length: 700 }, (_, index) => [
      `export function changedFunction${index}(value: number) {`,
      '  return value + 1;',
      '}',
      '',
    ].join('\n')).join('');
    fixture.write('src/many-functions.ts', source);
    fixture.git(['add', '.']);
    fixture.git([
      '-c', 'user.email=test@example.com',
      '-c', 'user.name=Test User',
      '-c', 'commit.gpgsign=false',
      'commit', '-m', 'add many functions', '-q',
    ]);
    await indexFixture(fixture);

    fixture.write('src/many-functions.ts', source.replaceAll('value + 1', 'value + 2'));
    const res = run(['--path', fixture.dir, '--mode', 'all', '--format', 'json']);

    expect(res.error).toBeUndefined();
    expect(res.status).toBe(1);
    expect(res.stdout.length).toBeGreaterThan(65_536);
    expect(JSON.parse(res.stdout).summary.status).toBe('impact');
  }, CLI_TIMEOUT_MS + 10_000);

  it('prints markdown and returns unavailable exit code for missing index', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-detect-missing-'));
    try {
      const res = run(['--path', dir, '--mode', 'all', '--format', 'markdown']);
      expect(res.status).toBe(3);
      expect(res.stdout).toContain('## Summary');
      expect(res.stdout).toContain('unavailable');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects malformed options before missing-index fallback', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-detect-missing-'));
    try {
      const res = run(['--path', dir, '--mode', 'all', '--format', 'xml']);
      expect(res.status).toBe(3);
      expect(res.stderr).toContain('Invalid detect-changes format: xml');
      expect(res.stdout).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
