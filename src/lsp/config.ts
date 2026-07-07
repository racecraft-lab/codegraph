import { loadLspProjectConfig } from '../project-config';
import { LSP_SERVER_REGISTRY } from './servers';
import {
  DEFAULT_LSP_TIMEOUT_MS,
  EffectiveLspConfig,
  EffectiveLspServerConfig,
  LSP_LANGUAGES,
  LspActivationSource,
  LspConfigWarning,
  LspLanguage,
  LspValueSource,
  isLspLanguage,
} from './types';

export type CliLspActivation = 'enable' | 'disable' | 'unspecified';

export interface ResolveLspConfigOptions {
  projectRoot: string;
  cliActivation?: CliLspActivation;
  env?: Record<string, string | undefined>;
}

interface ProjectServerConfig {
  command?: unknown;
  timeoutMs?: unknown;
}

interface ProjectLspConfig {
  enabled?: unknown;
  defaultTimeoutMs?: unknown;
  watch?: { enabled?: unknown };
  servers?: Record<string, ProjectServerConfig>;
}

interface CommandParseResult {
  command: string[] | null;
  warning?: LspConfigWarning;
}

interface TimeoutParseResult {
  timeoutMs: number | null;
  warning?: LspConfigWarning;
}

interface ResolvedTimeout {
  timeoutMs: number;
  source: LspValueSource;
}

export function resolveLspConfig(options: ResolveLspConfigOptions): EffectiveLspConfig {
  const env = options.env ?? process.env;
  const warnings: LspConfigWarning[] = [];
  const project = normalizeProjectLsp(loadLspProjectConfig(options.projectRoot), warnings);
  collectUnknownEnvOverrides(env, warnings);
  const activationSource = resolveActivation(project, options.cliActivation ?? 'unspecified');
  const enabled = activationSource === 'cli-enable' || activationSource === 'project-config';
  const globalEnvTimeout = parseTimeout(env.CODEGRAPH_LSP_TIMEOUT_MS, 'env', undefined, 'CODEGRAPH_LSP_TIMEOUT_MS');
  if (globalEnvTimeout.warning) warnings.push(globalEnvTimeout.warning);
  const projectDefaultTimeout = parseTimeout(project?.defaultTimeoutMs, 'project', undefined, 'lsp.defaultTimeoutMs');
  if (projectDefaultTimeout.warning) warnings.push(projectDefaultTimeout.warning);
  const defaultTimeout = resolveDefaultTimeout(globalEnvTimeout, projectDefaultTimeout);
  const watchEnabled = project?.watch?.enabled === false ? false : true;
  if (project?.watch?.enabled !== undefined && typeof project.watch.enabled !== 'boolean') {
    warnings.push({
      code: 'invalid-watch',
      source: 'project',
      detail: 'lsp.watch.enabled must be a boolean when provided',
    });
  }

  const servers = {} as Record<LspLanguage, EffectiveLspServerConfig>;
  for (const language of LSP_LANGUAGES) {
    servers[language] = resolveServerConfig(language, project, env, defaultTimeout, warnings);
  }

  return {
    enabled,
    activationSource,
    defaultTimeoutMs: defaultTimeout.timeoutMs,
    watchEnabled,
    servers,
    warnings,
  };
}

function collectUnknownEnvOverrides(env: Record<string, string | undefined>, warnings: LspConfigWarning[]): void {
  const unknownLanguages = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === '') continue;
    const match = /^CODEGRAPH_LSP_([A-Z0-9_]+)_(?:COMMAND_JSON|TIMEOUT_MS)$/.exec(key);
    if (!match) continue;
    const language = match[1]!.toLowerCase();
    if (!isLspLanguage(language)) unknownLanguages.add(language);
  }

  for (const language of unknownLanguages) {
    warnings.push({
      code: 'invalid-language',
      source: 'env',
      language,
      detail: `Ignoring unsupported LSP language "${language}" from environment override`,
    });
  }
}

function normalizeProjectLsp(raw: unknown, warnings: LspConfigWarning[]): ProjectLspConfig | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push({ code: 'invalid-project-lsp', source: 'project', detail: 'lsp must be an object when provided' });
    return undefined;
  }
  const config = raw as ProjectLspConfig;
  if (config.servers && (typeof config.servers !== 'object' || Array.isArray(config.servers))) {
    warnings.push({ code: 'invalid-project-lsp', source: 'project', detail: 'lsp.servers must be an object when provided' });
    return { ...config, servers: undefined };
  }
  if (config.servers) {
    for (const key of Object.keys(config.servers)) {
      if (!isLspLanguage(key)) {
        warnings.push({ code: 'invalid-language', source: 'project', language: key, detail: `Ignoring unsupported LSP language "${key}"` });
      }
    }
  }
  return config;
}

function resolveActivation(project: ProjectLspConfig | undefined, cli: CliLspActivation): LspActivationSource {
  if (cli === 'enable') return 'cli-enable';
  if (cli === 'disable') return 'cli-disable';
  return project?.enabled === true ? 'project-config' : 'default-off';
}

function resolveServerConfig(
  language: LspLanguage,
  project: ProjectLspConfig | undefined,
  env: Record<string, string | undefined>,
  defaultTimeout: ResolvedTimeout,
  warnings: LspConfigWarning[],
): EffectiveLspServerConfig {
  const registry = LSP_SERVER_REGISTRY[language];
  const projectServer = project?.servers?.[language];
  const envPrefix = `CODEGRAPH_LSP_${language.toUpperCase()}_`;
  const envCommand = parseCommand(env[`${envPrefix}COMMAND_JSON`], 'env', language, `${envPrefix}COMMAND_JSON`);
  if (envCommand.warning) warnings.push(envCommand.warning);
  const projectCommand = parseCommand(projectServer?.command, 'project', language, `lsp.servers.${language}.command`);
  if (projectCommand.warning) warnings.push(projectCommand.warning);
  if (projectCommand.command) {
    warnings.push({
      code: 'project-command-ignored',
      source: 'project',
      language,
      detail: `Ignoring committed ${language} LSP command override; use ${envPrefix}COMMAND_JSON for machine-local executable overrides`,
    });
  }

  let command: string[] | null = null;
  let commandSource: EffectiveLspServerConfig['commandSource'] = 'none';
  if (envCommand.command) {
    command = envCommand.command;
    commandSource = 'env';
  } else if (registry.commands.length > 0) {
    command = registry.commands[0]!.argv.slice();
    commandSource = 'registry';
  }

  const envTimeout = parseTimeout(env[`${envPrefix}TIMEOUT_MS`], 'env', language, `${envPrefix}TIMEOUT_MS`);
  if (envTimeout.warning) warnings.push(envTimeout.warning);
  const projectTimeout = parseTimeout(projectServer?.timeoutMs, 'project', language, `lsp.servers.${language}.timeoutMs`);
  if (projectTimeout.warning) warnings.push(projectTimeout.warning);

  let timeoutSource: LspValueSource = defaultTimeout.source;
  let timeoutMs = defaultTimeout.source === 'registry'
    ? registry.defaultTimeoutMs || defaultTimeout.timeoutMs
    : defaultTimeout.timeoutMs;
  if (projectTimeout.timeoutMs !== null) {
    timeoutSource = 'project';
    timeoutMs = projectTimeout.timeoutMs;
  }
  if (envTimeout.timeoutMs !== null) {
    timeoutSource = 'env';
    timeoutMs = envTimeout.timeoutMs;
  }

  return {
    language,
    command,
    commandSource,
    timeoutMs,
    timeoutSource,
    disposition: registry.disposition,
  };
}

function resolveDefaultTimeout(
  envTimeout: TimeoutParseResult,
  projectTimeout: TimeoutParseResult,
): ResolvedTimeout {
  if (envTimeout.timeoutMs !== null) return { timeoutMs: envTimeout.timeoutMs, source: 'env' };
  if (projectTimeout.timeoutMs !== null) return { timeoutMs: projectTimeout.timeoutMs, source: 'project' };
  return { timeoutMs: DEFAULT_LSP_TIMEOUT_MS, source: 'registry' };
}

function parseCommand(raw: unknown, source: 'project' | 'env', language: LspLanguage, field: string): CommandParseResult {
  if (raw === undefined) return { command: null };
  let value = raw;
  if (source === 'env') {
    if (typeof raw !== 'string' || raw.trim() === '') return { command: null };
    try {
      value = JSON.parse(raw);
    } catch {
      return {
        command: null,
        warning: { code: 'invalid-command', source, language, detail: `${field} must be JSON string array` },
      };
    }
  }
  if (!Array.isArray(value) || value.length === 0 || value.some((part) => typeof part !== 'string' || part.trim().length === 0)) {
    return {
      command: null,
      warning: { code: 'invalid-command', source, language, detail: `${field} must be a non-empty string array` },
    };
  }
  return { command: value.slice() };
}

function parseTimeout(raw: unknown, source: 'project' | 'env', language: LspLanguage | undefined, field: string): TimeoutParseResult {
  if (raw === undefined || raw === '') return { timeoutMs: null };
  const value = parseTimeoutValue(raw, source);
  if (value === null) {
    return {
      timeoutMs: null,
      warning: { code: 'invalid-timeout', source, language, detail: `${field} must be a positive integer` },
    };
  }
  return { timeoutMs: value };
}

function parseTimeoutValue(raw: unknown, source: 'project' | 'env'): number | null {
  if (source === 'env') {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!/^[1-9]\d*$/.test(trimmed)) return null;
    return Number(trimmed);
  }
  if (typeof raw !== 'number') return null;
  const value = raw;
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}
