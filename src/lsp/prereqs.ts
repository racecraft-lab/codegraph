import * as fs from 'fs';
import * as path from 'path';
import { LSP_SERVER_REGISTRY } from './servers';
import {
  EffectiveLspServerConfig,
  LspLanguage,
  LspReasonCode,
  LspServerStatusRecord,
} from './types';

export interface ProbeLspServerOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export function probeLspServerCommand(
  config: EffectiveLspServerConfig,
  options: ProbeLspServerOptions = {},
): LspServerStatusRecord {
  const registry = LSP_SERVER_REGISTRY[config.language];
  if (registry.disposition === 'future-owned') {
    return {
      language: config.language,
      command: 'SPEC-024',
      state: 'future-owned',
      reasonCode: 'future-owned',
      detail: registry.validationNote,
      expectedAlternatives: [],
    };
  }

  const expectedAlternatives = registry.commands.map((command) => command.argv);
  const candidates = config.commandSource === 'registry'
    ? expectedAlternatives
    : config.command
      ? [config.command]
      : expectedAlternatives;

  for (const argv of candidates) {
    const executable = argv[0];
    if (!executable) continue;
    const resolvedPath = resolveExecutablePath(executable, options);
    if (resolvedPath) {
      return {
        language: config.language,
        command: argv,
        state: 'available',
        resolvedPath,
        expectedAlternatives,
      };
    }
  }

  const reasonCode: LspReasonCode = config.commandSource === 'registry'
    ? 'missing-default-command'
    : 'configured-command-unavailable';
  return {
    language: config.language,
    command: config.command,
    state: 'unavailable',
    reasonCode,
    detail: unavailableDetail(config.language, reasonCode, config.command, expectedAlternatives),
    expectedAlternatives,
  };
}

export function resolveExecutablePath(command: string, options: ProbeLspServerOptions = {}): string | null {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  if (path.isAbsolute(command)) return executablePath(command);
  if (command.includes('/') || command.includes('\\')) return executablePath(path.resolve(cwd, command));

  const pathValue = env.PATH ?? '';
  const extensions = process.platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      const resolved = executablePath(candidate);
      if (resolved) return resolved;
    }
  }
  return null;
}

export function expectedCommandLabels(language: LspLanguage): string[] {
  return LSP_SERVER_REGISTRY[language].commands.map((command) => command.label);
}

function executablePath(candidate: string): string | null {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function unavailableDetail(
  language: LspLanguage,
  reasonCode: LspReasonCode,
  command: string[] | null,
  expectedAlternatives: string[][],
): string {
  if (reasonCode === 'configured-command-unavailable') {
    return `${language}: configured command unavailable: ${command?.join(' ') ?? '<none>'}`;
  }
  return `${language}: expected ${expectedAlternatives.map((argv) => argv.join(' ')).join(' or ')}`;
}
