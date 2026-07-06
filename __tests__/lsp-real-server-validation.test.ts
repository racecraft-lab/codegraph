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
  it('validates the Slice 1 TypeScript-family server command and SDK evidence', () => {
    const dir = fakeBinDir({
      'typescript-language-server': 'fixture typescript-language-server 1.0.0',
    });
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
    expect(report.observed.every((item: { serverCommand: string }) => item.serverCommand === 'typescript-language-server --stdio')).toBe(true);
    expect(report.observed.every((item: { resolvedExecutable?: string }) => item.resolvedExecutable?.startsWith(dir))).toBe(true);
    expect(report.observed.every((item: { minimumRuntimeEvidence?: string }) => item.minimumRuntimeEvidence?.includes('typescript SDK:'))).toBe(true);
  });

  it('validates Slice 2 real-server rows with resolved paths and smoke evidence', () => {
    const urlLikeBanner = `${'https'}://example.invalid/build`;
    const dir = fakeBinDir({
      'pyright-langserver': 'fixture pyright-langserver 1.0.0',
      gopls: 'fixture gopls 1.0.0',
      'rust-analyzer': 'fixture rust-analyzer 1.0.0',
      clangd: `fixture clangd 1.0.0 ${urlLikeBanner}`,
      'sourcekit-lsp': 'fixture sourcekit-lsp 1.0.0',
      jdtls: 'fixture jdtls 1.0.0',
    });

    const result = spawnSync(process.execPath, [SCRIPT, '--slice', 'us2'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: dir,
      },
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.missing).toEqual([]);
    expect(report.dispositions).toEqual([]);
    expect(report.observed.map((item: { language: string }) => item.language)).toEqual([
      'python',
      'go',
      'rust',
      'c',
      'cpp',
      'swift',
      'java',
    ]);
    expect(report.paritySummary).toMatchObject({ verified: 7, futureOwned: 0, missing: 0, unowned: 0 });

    const byLanguage = new Map(report.observed.map((item: { language: string }) => [item.language, item]));
    expect(byLanguage.get('python')).toMatchObject({
      command: 'pyright-langserver --version',
      serverCommand: 'pyright-langserver --stdio',
      status: 0,
    });
    expect(byLanguage.get('go')).toMatchObject({
      command: 'gopls version',
      serverCommand: 'gopls',
    });
    expect(byLanguage.get('java')).toMatchObject({
      command: 'jdtls --help',
      serverCommand: 'jdtls -configuration <validation-config-dir> -data <validation-workspace-dir>',
    });
    expect((byLanguage.get('c') as { output: string }).output).toContain('[redacted-url]');
    expect((byLanguage.get('c') as { output: string }).output).not.toContain('http');
    expect(report.observed.every((item: { resolvedExecutable?: string }) => item.resolvedExecutable?.startsWith(dir))).toBe(true);
    expect(report.observed.every((item: { smokeValidation?: { status: string; evidence: string[] } }) => item.smokeValidation?.status === 'prereq-only')).toBe(true);
    expect(report.observed.every((item: { smokeValidation?: { evidence: string[] } }) => item.smokeValidation?.evidence.length)).toBe(true);
  });

  it('validates Slice 3 rows with alternate commands, TypeScript SDK evidence, and COBOL disposition', () => {
    const dir = fakeBinDir({
      'csharp-ls': 'fixture csharp-ls 1.0.0',
      'kotlin-lsp': 'fixture kotlin-lsp 1.0.0',
      phpactor: 'fixture phpactor 1.0.0',
      solargraph: 'fixture solargraph 1.0.0',
      dart: 'fixture dart 1.0.0',
      'vue-language-server': 'fixture vue-language-server 1.0.0',
    });

    const result = spawnSync(process.execPath, [SCRIPT, '--slice', 'us3'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: dir,
      },
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.missing).toEqual([]);
    expect(report.observed.map((item: { language: string }) => item.language)).toEqual([
      'csharp',
      'kotlin',
      'php',
      'ruby',
      'dart',
      'vue',
    ]);
    expect(report.dispositions).toEqual([
      expect.objectContaining({
        language: 'cobol',
        status: 'future-owned',
        owner: 'SPEC-024',
      }),
    ]);
    expect(report.paritySummary).toMatchObject({ verified: 6, futureOwned: 1, missing: 0, unowned: 0 });

    const byLanguage = new Map(report.observed.map((item: { language: string }) => [item.language, item]));
    expect(byLanguage.get('kotlin')).toMatchObject({
      command: 'kotlin-lsp --version',
      serverCommand: 'kotlin-lsp',
    });
    expect(byLanguage.get('php')).toMatchObject({
      command: 'phpactor --version',
      serverCommand: 'phpactor language-server',
    });
    expect(byLanguage.get('ruby')).toMatchObject({
      command: 'solargraph --version',
      serverCommand: 'solargraph stdio',
    });
    expect(byLanguage.get('dart')).toMatchObject({
      command: 'dart --version',
      serverCommand: 'dart language-server',
    });
    expect(byLanguage.get('vue')).toMatchObject({
      command: 'vue-language-server --version',
      serverCommand: 'vue-language-server --stdio',
    });
    expect((byLanguage.get('vue') as { minimumRuntimeEvidence?: string }).minimumRuntimeEvidence).toContain('typescript SDK:');
    expect(report.observed.every((item: { resolvedExecutable?: string }) => item.resolvedExecutable?.startsWith(dir))).toBe(true);
  });

  it('defaults to all implemented validation rows plus future-owned dispositions', () => {
    const dir = fakeBinDir({
      'typescript-language-server': 'fixture typescript-language-server 1.0.0',
      'pyright-langserver': 'fixture pyright-langserver 1.0.0',
      gopls: 'fixture gopls 1.0.0',
      'rust-analyzer': 'fixture rust-analyzer 1.0.0',
      clangd: 'fixture clangd 1.0.0',
      'sourcekit-lsp': 'fixture sourcekit-lsp 1.0.0',
      jdtls: 'fixture jdtls 1.0.0',
      'csharp-ls': 'fixture csharp-ls 1.0.0',
      'kotlin-language-server': 'fixture kotlin-language-server 1.0.0',
      intelephense: 'fixture intelephense 1.0.0',
      'ruby-lsp': 'fixture ruby-lsp 1.0.0',
      dart: 'fixture dart 1.0.0',
      'vue-language-server': 'fixture vue-language-server 1.0.0',
    });

    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: dir,
      },
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.observed.map((item: { language: string }) => item.language)).toEqual([
      'typescript',
      'tsx',
      'javascript',
      'jsx',
      'python',
      'go',
      'rust',
      'c',
      'cpp',
      'swift',
      'java',
      'csharp',
      'kotlin',
      'php',
      'ruby',
      'dart',
      'vue',
    ]);
    expect(report.dispositions).toEqual([
      expect.objectContaining({ language: 'cobol', status: 'future-owned' }),
    ]);
    expect(report.paritySummary).toMatchObject({ verified: 17, futureOwned: 1, missing: 0, unowned: 0 });
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
    expect(result.stderr).toContain('typescript: expected typescript-language-server --stdio');
    expect(result.stderr).toContain('Normal codegraph index --lsp still degrades per language');
  });

  it('uses accepted alternatives in the missing-prereq error shape', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-real-empty-'));
    dirs.push(dir);
    const result = spawnSync(process.execPath, [SCRIPT, '--languages', 'python'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, PATH: dir },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SPEC-008 real-server validation prerequisites failed.');
    expect(result.stderr).toContain('python: expected pyright-langserver --stdio or basedpyright-langserver --stdio');
    expect(result.stderr).toContain('Normal codegraph index --lsp still degrades per language');
  });
});

function fakeBinDir(commands: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-real-bin-'));
  dirs.push(dir);
  for (const [name, output] of Object.entries(commands)) {
    const command = path.join(dir, name);
    fs.writeFileSync(command, `#!/bin/sh\necho ${JSON.stringify(output)}\n`);
    fs.chmodSync(command, 0o755);

    const windowsCommand = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(windowsCommand, `@echo off\r\necho ${output}\r\n`);
  }
  return dir;
}
