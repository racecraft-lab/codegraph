import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { clearProjectConfigCache } from '../src/project-config';
import { resolveLspConfig } from '../src/lsp';

function withProjectConfig(config: unknown, fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-config-'));
  try {
    if (config !== undefined) {
      fs.writeFileSync(path.join(dir, 'codegraph.json'), JSON.stringify(config));
    }
    clearProjectConfigCache();
    fn(dir);
  } finally {
    clearProjectConfigCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('LSP config resolution', () => {
  it('defaults off with registry commands and timeout defaults', () => {
    withProjectConfig(undefined, (dir) => {
      const config = resolveLspConfig({ projectRoot: dir, env: {} });
      expect(config.enabled).toBe(false);
      expect(config.activationSource).toBe('default-off');
      expect(config.defaultTimeoutMs).toBe(5000);
      expect(config.servers.typescript.command).toEqual(['typescript-language-server', '--stdio']);
      expect(config.servers.typescript.commandSource).toBe('registry');
    });
  });

  it('uses project opt-in unless an explicit CLI disable is supplied', () => {
    withProjectConfig({ lsp: { enabled: true } }, (dir) => {
      expect(resolveLspConfig({ projectRoot: dir, env: {} }).activationSource).toBe('project-config');
      const disabled = resolveLspConfig({ projectRoot: dir, cliActivation: 'disable', env: {} });
      expect(disabled.enabled).toBe(false);
      expect(disabled.activationSource).toBe('cli-disable');
      const enabled = resolveLspConfig({ projectRoot: dir, cliActivation: 'enable', env: {} });
      expect(enabled.enabled).toBe(true);
      expect(enabled.activationSource).toBe('cli-enable');
    });
  });

  it('resolves watch activation from project config with deterministic fallback', () => {
    withProjectConfig(undefined, (dir) => {
      expect(resolveLspConfig({ projectRoot: dir, env: {} }).watchEnabled).toBe(true);
    });

    withProjectConfig({ lsp: { watch: { enabled: false } } }, (dir) => {
      expect(resolveLspConfig({ projectRoot: dir, env: {} }).watchEnabled).toBe(false);
    });

    withProjectConfig({ lsp: { watch: { enabled: 'nope' } } }, (dir) => {
      const config = resolveLspConfig({ projectRoot: dir, env: {} });
      expect(config.watchEnabled).toBe(true);
      expect(config.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-watch',
          source: 'project',
        }),
      ]));
    });
  });

  it('models codegraph index, index --lsp, and index --no-lsp activation precedence', () => {
    withProjectConfig({ lsp: { enabled: true } }, (dir) => {
      expect(resolveLspConfig({ projectRoot: dir, cliActivation: 'unspecified', env: {} })).toMatchObject({
        enabled: true,
        activationSource: 'project-config',
      });
      expect(resolveLspConfig({ projectRoot: dir, cliActivation: 'enable', env: {} })).toMatchObject({
        enabled: true,
        activationSource: 'cli-enable',
      });
      expect(resolveLspConfig({ projectRoot: dir, cliActivation: 'disable', env: {} })).toMatchObject({
        enabled: false,
        activationSource: 'cli-disable',
      });
    });
  });

  it('applies machine-local command and timeout precedence without letting env activate LSP', () => {
    withProjectConfig({
      lsp: {
        defaultTimeoutMs: 7000,
        servers: {
          typescript: {
            command: ['project-ts-lsp', '--stdio'],
            timeoutMs: 8000,
          },
        },
      },
    }, (dir) => {
      const config = resolveLspConfig({
        projectRoot: dir,
        env: {
          CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: '["env-ts-lsp","--stdio"]',
          CODEGRAPH_LSP_TYPESCRIPT_TIMEOUT_MS: '9000',
          CODEGRAPH_LSP_TIMEOUT_MS: '6000',
        },
      });
      expect(config.enabled).toBe(false);
      expect(config.activationSource).toBe('default-off');
      expect(config.defaultTimeoutMs).toBe(6000);
      expect(config.servers.typescript.command).toEqual(['env-ts-lsp', '--stdio']);
      expect(config.servers.typescript.commandSource).toBe('env');
      expect(config.servers.typescript.timeoutMs).toBe(9000);
      expect(config.servers.typescript.timeoutSource).toBe('env');
      expect(config.servers.python.timeoutMs).toBe(6000);
      expect(config.servers.python.timeoutSource).toBe('env');
    });
  });

  it('ignores committed project command overrides while preserving project timeouts', () => {
    withProjectConfig({
      lsp: {
        enabled: true,
        servers: {
          typescript: {
            command: ['project-ts-lsp', '--stdio'],
            timeoutMs: 8000,
          },
        },
      },
    }, (dir) => {
      const config = resolveLspConfig({ projectRoot: dir, env: {} });
      expect(config.servers.typescript.command).toEqual(['typescript-language-server', '--stdio']);
      expect(config.servers.typescript.commandSource).toBe('registry');
      expect(config.servers.typescript.timeoutMs).toBe(8000);
      expect(config.servers.typescript.timeoutSource).toBe('project');
      expect(config.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'project-command-ignored',
          source: 'project',
          language: 'typescript',
        }),
      ]));
    });
  });

  it('preserves timeout source when overrides equal the registry default', () => {
    withProjectConfig({ lsp: { defaultTimeoutMs: 5000 } }, (dir) => {
      const config = resolveLspConfig({ projectRoot: dir, env: {} });
      expect(config.servers.python.timeoutMs).toBe(5000);
      expect(config.servers.python.timeoutSource).toBe('project');
    });

    withProjectConfig(undefined, (dir) => {
      const config = resolveLspConfig({
        projectRoot: dir,
        env: { CODEGRAPH_LSP_TIMEOUT_MS: '5000' },
      });
      expect(config.servers.python.timeoutMs).toBe(5000);
      expect(config.servers.python.timeoutSource).toBe('env');
      expect(config.enabled).toBe(false);
      expect(config.activationSource).toBe('default-off');
    });
  });

  it('warns and falls back for invalid command and timeout values', () => {
    withProjectConfig({
      lsp: {
        enabled: 'yes',
        defaultTimeoutMs: -1,
        servers: {
          typescript: {
            command: ['project-ts-lsp'],
            timeoutMs: ['5000'],
          },
        },
      },
    }, (dir) => {
      const config = resolveLspConfig({
        projectRoot: dir,
        env: {
          CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: '{"not":"array"}',
          CODEGRAPH_LSP_TYPESCRIPT_TIMEOUT_MS: '1.5',
        },
      });
      expect(config.servers.typescript.command).toEqual(['typescript-language-server', '--stdio']);
      expect(config.servers.typescript.commandSource).toBe('registry');
      expect(config.servers.typescript.timeoutMs).toBe(5000);
      expect(config.warnings.map((w) => w.code)).toEqual(expect.arrayContaining([
        'invalid-project-lsp',
        'invalid-command',
        'invalid-timeout',
      ]));
      expect(config.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-project-lsp',
          source: 'project',
          detail: 'lsp.enabled must be a boolean when provided',
        }),
      ]));
    });
  });

  it('warns and ignores unknown languages and blank command argv parts', () => {
    withProjectConfig({
      lsp: {
        servers: {
          unknown: { command: ['unknown-lsp'] },
          typescript: { command: ['   ', '--stdio'] },
        },
      },
    }, (dir) => {
      const config = resolveLspConfig({
        projectRoot: dir,
        env: {
          CODEGRAPH_LSP_UNKNOWN_COMMAND_JSON: '["unknown-lsp"]',
          CODEGRAPH_LSP_UNKNOWN_TIMEOUT_MS: '1000',
        },
      });

      expect(config.servers.typescript.command).toEqual(['typescript-language-server', '--stdio']);
      expect(config.servers.typescript.commandSource).toBe('registry');
      expect(config.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-language', source: 'project', language: 'unknown' }),
        expect.objectContaining({ code: 'invalid-language', source: 'env', language: 'unknown' }),
        expect.objectContaining({ code: 'invalid-command', source: 'project', language: 'typescript' }),
      ]));
    });
  });
});
