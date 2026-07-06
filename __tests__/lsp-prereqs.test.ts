import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getLspServerEntry, getLspServerRegistry, LSP_LANGUAGES, probeLspServerCommand, resolveLspConfig } from '../src/lsp';

function writeFixtureExecutable(dir: string, name: string): string {
  const executable = path.join(dir, process.platform === 'win32' ? `${name}.cmd` : name);
  if (process.platform === 'win32') {
    fs.writeFileSync(executable, '@echo off\r\nexit /b 0\r\n');
  } else {
    fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(executable, 0o755);
  }
  return executable;
}

describe('LSP server prerequisite registry', () => {
  it('covers every SPEC-008 language row with no unowned registry gaps', () => {
    expect(getLspServerRegistry().map((entry) => entry.language)).toEqual([...LSP_LANGUAGES]);

    for (const entry of getLspServerRegistry()) {
      if (entry.language === 'cobol') {
        expect(entry.disposition).toBe('future-owned');
        expect(entry.futureOwner).toBe('SPEC-024');
        continue;
      }
      expect(entry.disposition).toBe('implemented');
      expect(entry.commands.length).toBeGreaterThan(0);
      expect(entry.commands[0].argv.length).toBeGreaterThan(0);
    }
  });

  it('keeps accepted command alternatives for languages with more than one supported server', () => {
    expect(getLspServerEntry('javascript').commands.map((c) => c.argv)).toEqual([
      ['typescript-language-server', '--stdio'],
    ]);
    expect(getLspServerEntry('jsx').commands.map((c) => c.argv)).toEqual([
      ['typescript-language-server', '--stdio'],
    ]);
    expect(getLspServerEntry('typescript').commands.map((c) => c.argv)).toEqual([
      ['typescript-language-server', '--stdio'],
    ]);
    expect(getLspServerEntry('tsx').commands.map((c) => c.argv)).toEqual([
      ['typescript-language-server', '--stdio'],
    ]);
    expect(getLspServerEntry('python').commands.map((c) => c.argv)).toEqual([
      ['pyright-langserver', '--stdio'],
      ['basedpyright-langserver', '--stdio'],
    ]);
    expect(getLspServerEntry('php').commands.map((c) => c.argv)).toEqual([
      ['intelephense', '--stdio'],
      ['phpactor', 'language-server'],
    ]);
    expect(getLspServerEntry('ruby').commands.map((c) => c.argv)).toEqual([
      ['ruby-lsp'],
      ['solargraph', 'stdio'],
    ]);
  });

  it('selects a later registry alternative when the first default is missing', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-prereq-'));
    try {
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir);
      const based = writeFixtureExecutable(binDir, 'basedpyright-langserver');

      const config = resolveLspConfig({
        projectRoot: tempDir,
        env: { PATH: binDir },
      });
      const result = probeLspServerCommand(config.servers.python, { env: { PATH: binDir } });

      expect(result.state).toBe('available');
      expect(result.command).toEqual(['basedpyright-langserver', '--stdio']);
      expect(result.resolvedPath).toBe(based);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves a Windows PATH command that already includes a PATHEXT extension', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-prereq-'));
    try {
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir);
      const clangd = writeFixtureExecutable(binDir, 'clangd');
      const command = process.platform === 'win32' ? 'clangd.cmd' : 'clangd';
      const result = probeLspServerCommand({
        ...resolveLspConfig({ projectRoot: tempDir, env: { PATH: '' } }).servers.c,
        command: [command, '--stdio'],
        commandSource: 'env',
      }, { env: { PATH: binDir } });

      expect(result.state).toBe('available');
      expect(result.resolvedPath).toBe(clangd);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves environment absolute and relative command paths with status metadata', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-prereq-'));
    const toolsDir = path.join(tempDir, 'tools');
    fs.mkdirSync(toolsDir);
    const relativeServer = writeFixtureExecutable(toolsDir, 'custom-python-lsp');
    const absoluteServer = writeFixtureExecutable(toolsDir, 'absolute-python-lsp');
    const relativeCommand = `./${path.relative(tempDir, relativeServer).split(path.sep).join('/')}`;

    fs.writeFileSync(path.join(tempDir, 'codegraph.json'), JSON.stringify({
      lsp: {
        defaultTimeoutMs: 6000,
      },
    }));

    const config = resolveLspConfig({
      projectRoot: tempDir,
      env: {
        CODEGRAPH_LSP_PYTHON_COMMAND_JSON: JSON.stringify([relativeCommand, '--stdio']),
        CODEGRAPH_LSP_RUBY_COMMAND_JSON: JSON.stringify([absoluteServer]),
        PATH: '',
      },
    });
    const relativeResult = probeLspServerCommand(config.servers.python, {
      cwd: tempDir,
      env: { PATH: '' },
    });
    const absoluteResult = probeLspServerCommand(config.servers.ruby, {
      cwd: tempDir,
      env: { PATH: '' },
    });

    expect(relativeResult).toMatchObject({
      state: 'available',
      command: [relativeCommand, '--stdio'],
      commandSource: 'env',
      resolvedPath: relativeServer,
      timeoutMs: 6000,
      timeoutSource: 'project',
      expectedAlternatives: [
        ['pyright-langserver', '--stdio'],
        ['basedpyright-langserver', '--stdio'],
      ],
    });
    expect(absoluteResult).toMatchObject({
      state: 'available',
      command: [absoluteServer],
      commandSource: 'env',
      resolvedPath: absoluteServer,
      timeoutSource: 'project',
    });

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not fall back when a valid machine-local configured command cannot be resolved', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-prereq-'));
    const binDir = path.join(tempDir, 'bin');
    fs.mkdirSync(binDir);
    writeFixtureExecutable(binDir, 'pyright-langserver');

    const config = resolveLspConfig({
      projectRoot: tempDir,
      env: {
        CODEGRAPH_LSP_PYTHON_COMMAND_JSON: '["missing-custom-python-lsp","--stdio"]',
        PATH: binDir,
      },
    });
    const result = probeLspServerCommand(config.servers.python, { env: { PATH: binDir } });

    expect(result.state).toBe('unavailable');
    expect(result.reasonCode).toBe('configured-command-unavailable');
    expect(result.command).toEqual(['missing-custom-python-lsp', '--stdio']);
    expect(result.commandSource).toBe('env');
    expect(result.expectedAlternatives).toEqual([
      ['pyright-langserver', '--stdio'],
      ['basedpyright-langserver', '--stdio'],
    ]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports a missing default server as a normal per-language degradation prerequisite', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-prereq-'));
    const config = resolveLspConfig({
      projectRoot: tempDir,
      cliActivation: 'enable',
      env: { PATH: '' },
    });
    const result = probeLspServerCommand(config.servers.python, {
      cwd: tempDir,
      env: { PATH: '' },
    });

    expect(result).toMatchObject({
      language: 'python',
      state: 'unavailable',
      reasonCode: 'missing-default-command',
      command: ['pyright-langserver', '--stdio'],
      commandSource: 'registry',
      expectedAlternatives: [
        ['pyright-langserver', '--stdio'],
        ['basedpyright-langserver', '--stdio'],
      ],
    });
    expect(result.detail).toContain('python: expected pyright-langserver --stdio or basedpyright-langserver --stdio');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
