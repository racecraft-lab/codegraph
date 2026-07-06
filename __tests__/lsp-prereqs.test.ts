import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getLspServerEntry, getLspServerRegistry, LSP_LANGUAGES, probeLspServerCommand, resolveLspConfig } from '../src/lsp';

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
    const binDir = path.join(tempDir, 'bin');
    fs.mkdirSync(binDir);
    const based = path.join(binDir, 'basedpyright-langserver');
    fs.writeFileSync(based, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(based, 0o755);

    const config = resolveLspConfig({
      projectRoot: tempDir,
      env: { PATH: binDir },
    });
    const result = probeLspServerCommand(config.servers.python, { env: { PATH: binDir } });

    expect(result.state).toBe('available');
    expect(result.command).toEqual(['basedpyright-langserver', '--stdio']);
    expect(result.resolvedPath).toBe(based);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not fall back when a valid configured command cannot be resolved', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-prereq-'));
    fs.writeFileSync(path.join(tempDir, 'codegraph.json'), JSON.stringify({
      lsp: { servers: { python: { command: ['missing-custom-python-lsp', '--stdio'] } } },
    }));

    const config = resolveLspConfig({ projectRoot: tempDir, env: { PATH: '' } });
    const result = probeLspServerCommand(config.servers.python, { env: { PATH: '' } });

    expect(result.state).toBe('unavailable');
    expect(result.reasonCode).toBe('configured-command-unavailable');
    expect(result.command).toEqual(['missing-custom-python-lsp', '--stdio']);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

