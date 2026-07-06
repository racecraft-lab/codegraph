import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../scripts/spec-008-validate-real-servers.mjs');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('SPEC-008 real-server validation script', () => {
  it('validates the Slice 1 TypeScript/JavaScript server command and SDK evidence', () => {
    const dir = fakeBinDir();
    const result = spawnSync(process.execPath, [SCRIPT, '--slice', 'us1'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.missing).toEqual([]);
    expect(report.observed.map((item: { language: string }) => item.language).sort()).toEqual(['javascript', 'typescript']);
    expect(report.observed.every((item: { command: string }) => item.command === 'typescript-language-server --version')).toBe(true);
    expect(report.observed.every((item: { minimumRuntimeEvidence?: string }) => item.minimumRuntimeEvidence?.includes('typescript SDK:'))).toBe(true);
  });

  it('uses the validation-only missing-prereq error shape for absent Slice 1 commands', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-real-empty-'));
    dirs.push(dir);
    const result = spawnSync(process.execPath, [SCRIPT, '--languages', 'typescript'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, PATH: dir },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SPEC-008 real-server validation prerequisites failed.');
    expect(result.stderr).toContain('typescript: expected typescript-language-server --version');
    expect(result.stderr).toContain('Normal codegraph index --lsp still degrades per language');
  });
});

function fakeBinDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-real-bin-'));
  dirs.push(dir);
  const command = path.join(dir, 'typescript-language-server');
  fs.writeFileSync(command, '#!/bin/sh\necho "fixture typescript-language-server 1.0.0"\n');
  fs.chmodSync(command, 0o755);
  return dir;
}
