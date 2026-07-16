import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'actions/pr-impact/run.ts');
const RUNTIME = path.join(ROOT, 'actions/pr-impact/dist/run.mjs');
const TSC = path.join(ROOT, 'node_modules/typescript/bin/tsc');

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function compileRuntime(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-runtime-'));
  try {
    const outDir = path.join(tmp, 'out');
    const res = spawnSync(process.execPath, [
      TSC,
      'actions/pr-impact/run.ts',
      '--target', 'ES2022',
      '--module', 'ES2022',
      '--moduleResolution', 'node',
      '--types', 'node',
      '--skipLibCheck',
      '--outDir', outDir,
      '--declaration', 'false',
      '--sourceMap', 'false',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, CODEGRAPH_WASM_RELAUNCHED: '1' },
    });

    expect(res.status, res.stderr || res.stdout).toBe(0);
    return fs.readFileSync(path.join(outDir, 'run.js'), 'utf8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('PR impact runtime freshness', () => {
  it('keeps the checked-in action runtime generated from run.ts', () => {
    const expected = compileRuntime();
    const actual = fs.readFileSync(RUNTIME, 'utf8');

    expect(sha256(actual)).toBe(sha256(expected));
  });

  it('exposes the reproducible runtime build command through package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts['build:pr-impact-action']).toContain('tsc actions/pr-impact/run.ts');
    expect(pkg.scripts['build:pr-impact-action']).toContain('actions/pr-impact/dist/run.mjs');
    expect(pkg.scripts.build).toContain('npm run build:pr-impact-action');
  });
});
