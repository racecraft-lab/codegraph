import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { createDetectChangesFixture, indexFixture, type DetectChangesFixture } from './helpers/detect-changes-fixture';

const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');

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
