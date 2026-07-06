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
    expect(report.observed.map((item: { language: string }) => item.language).sort()).toEqual([
      'javascript',
      'jsx',
      'tsx',
      'typescript',
    ]);
    expect(report.observed.every((item: { command: string }) => item.command === 'typescript-language-server --version')).toBe(true);
    expect(report.observed.every((item: { resolvedPath?: string }) => item.resolvedPath?.startsWith(dir))).toBe(true);
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

  it('fails when an available validation command exits non-zero', () => {
    const dir = fakeBinDir({
      'pyright-langserver': { output: 'fixture pyright failure', status: 7 },
    });
    const result = spawnSync(process.execPath, [SCRIPT, '--languages', 'python'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, PATH: dir },
    });

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.observed).toEqual([]);
    expect(report.missing).toEqual([
      expect.objectContaining({
        language: 'python',
        status: 7,
        output: 'fixture pyright failure',
      }),
    ]);
    expect(report.missing[0].resolvedPath).toContain(dir);
    expect(report.missing[0].error).toContain('validation command exited 7');
  });

  it('accepts an available validation alternative when the first command is absent', () => {
    const dir = fakeBinDir({
      'basedpyright-langserver': 'fixture basedpyright 1.0.0',
    });
    const result = spawnSync(process.execPath, [SCRIPT, '--languages', 'python'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, PATH: dir },
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.missing).toEqual([]);
    expect(report.observed).toEqual([
      expect.objectContaining({
        language: 'python',
        command: 'basedpyright-langserver --version',
      }),
    ]);
    expect(report.observed[0].resolvedPath).toContain(dir);
  });

  it('lists accepted validation alternatives in missing-prereq errors', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-real-empty-'));
    dirs.push(dir);
    const result = spawnSync(process.execPath, [SCRIPT, '--languages', 'python'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, PATH: dir },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('python: expected pyright-langserver --version or basedpyright-langserver --version');
  });
});

function fakeBinDir(commands: Record<string, string | { output: string; status?: number }> = {
  'typescript-language-server': 'fixture typescript-language-server 1.0.0',
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-real-bin-'));
  dirs.push(dir);
  for (const [name, commandSpec] of Object.entries(commands)) {
    const output = typeof commandSpec === 'string' ? commandSpec : commandSpec.output;
    const status = typeof commandSpec === 'string' ? 0 : commandSpec.status ?? 0;
    const command = path.join(dir, name);
    fs.writeFileSync(command, `#!/bin/sh\necho ${JSON.stringify(output)}\nexit ${status}\n`);
    fs.chmodSync(command, 0o755);
  }
  return dir;
}
