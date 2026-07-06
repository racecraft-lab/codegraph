import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { QueryBuilder, LspEdgeCandidateRow } from '../db/queries';
import { Language } from '../types';
import { LspJsonRpcClient } from './client';
import { probeLspServerCommand } from './prereqs';
import {
  DEFAULT_LSP_FULL_INDEX_WORK_CAP,
  EffectiveLspConfig,
  LSP_REASON_CODES,
  LspCoverageRecord,
  LspLanguage,
  LspReasonCode,
  LspServerState,
  LspStatus,
} from './types';
import { createInitialLspStatus, recordLspDegradation, recordLspSkip } from './status';

const US1_LANGUAGES: LspLanguage[] = ['typescript', 'tsx', 'javascript', 'jsx'];

const DEFAULT_CLIENT_FACTORY: LspClientFactory = {
  create: ({ command, cwd, timeoutMs }) => new LspJsonRpcClient({
    command,
    cwd,
    timeoutMs,
    rootUri: pathToFileURL(cwd).href,
    rootPath: cwd,
  }),
};

export interface LspDefinitionClient {
  initialize(params: Record<string, unknown>): Promise<unknown>;
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  shutdown(): Promise<unknown>;
}

export interface LspClientFactory {
  create(options: {
    language: LspLanguage;
    command: string[];
    cwd: string;
    timeoutMs: number;
  }): LspDefinitionClient;
}

export interface RunLspPrecisionPassOptions {
  projectRoot: string;
  queries: QueryBuilder;
  config: EffectiveLspConfig;
  structuralElapsedMs?: number;
  clientFactory?: LspClientFactory;
}

interface NormalizedLspTarget {
  uri: string;
  filePath: string | null;
  line: number;
  character: number;
}

export async function runLspPrecisionPass(options: RunLspPrecisionPassOptions): Promise<LspStatus> {
  const status = createInitialLspStatus(options.config);
  if (!options.config.enabled) return status;

  const started = Date.now();
  const clientFactory = options.clientFactory ?? DEFAULT_CLIENT_FACTORY;
  status.lastRunAt = new Date(started).toISOString();
  status.performance.structuralElapsedMs = options.structuralElapsedMs;

  const candidates = options.queries.getLspEdgeCandidates(US1_LANGUAGES as Language[], DEFAULT_LSP_FULL_INDEX_WORK_CAP);
  const candidatesByLanguage = new Map<LspLanguage, LspEdgeCandidateRow[]>();
  for (const candidate of candidates) {
    if (!US1_LANGUAGES.includes(candidate.language as LspLanguage)) continue;
    const language = candidate.language as LspLanguage;
    const existing = candidatesByLanguage.get(language) ?? [];
    existing.push(candidate);
    candidatesByLanguage.set(language, existing);
  }

  for (const language of US1_LANGUAGES) {
    const languageCandidates = candidatesByLanguage.get(language) ?? [];
    if (languageCandidates.length === 0) continue;

    const serverConfig = options.config.servers[language];
    const serverStatus = probeLspServerCommand(serverConfig, { cwd: options.projectRoot });
    status.servers.push(serverStatus);
    const coverage = createCoverageRecord(language, languageCandidates);
    status.coverage.push(coverage);

    if (serverStatus.state !== 'available' || !Array.isArray(serverStatus.command)) {
      const reason = serverStatus.reasonCode ?? 'configured-command-unavailable';
      recordLspDegradation(status, coverage, reason, languageCandidates.length);
      continue;
    }

    const client = clientFactory.create({
      language,
      command: serverStatus.command,
      cwd: options.projectRoot,
      timeoutMs: serverConfig.timeoutMs,
    });

    try {
      const initializeResult = await client.initialize({
        processId: process.pid,
        rootUri: pathToFileURL(options.projectRoot).href,
        capabilities: {},
      });
      serverStatus.state = 'initialized';
      serverStatus.observedVersion = serverInfoText(initializeResult);
      status.performance.activeSessionHighWatermark = Math.max(status.performance.activeSessionHighWatermark, 1);

      for (const candidate of languageCandidates) {
        const result = await requestDefinition(client, options.projectRoot, candidate);
        coverage.checkedWorkItems += 1;
        status.edgeCounts.checked += 1;
        status.performance.inFlightRequestHighWatermark = Math.max(status.performance.inFlightRequestHighWatermark, 1);

        const decision = applyDefinitionResult(options.queries, options.projectRoot, candidate, result);
        if (decision === 'verified') {
          status.edgeCounts.verified += 1;
        } else if (decision) {
          recordLspSkip(status, coverage, decision);
        }
      }
    } catch (err) {
      const reason = reasonFromError(err);
      serverStatus.state = serverStateForReason(reason);
      serverStatus.reasonCode = reason;
      serverStatus.lastError = err instanceof Error ? err.message : String(err);
      recordLspDegradation(status, coverage, reason, languageCandidates.length - coverage.checkedWorkItems);
    } finally {
      try {
        await client.shutdown();
      } catch (err) {
        const shutdownMessage = err instanceof Error ? err.message : String(err);
        if (!serverStatus.reasonCode) {
          serverStatus.state = 'degraded';
          serverStatus.reasonCode = 'shutdown-failure';
          serverStatus.lastError = shutdownMessage;
          recordLspDegradation(status, coverage, 'shutdown-failure', languageCandidates.length - coverage.checkedWorkItems);
        } else {
          serverStatus.lastError = serverStatus.lastError
            ? `${serverStatus.lastError}; shutdown failed: ${shutdownMessage}`
            : `shutdown failed: ${shutdownMessage}`;
        }
      }
    }

    coverage.elapsedMs = Date.now() - started;
  }

  status.performance.lspElapsedMs = Date.now() - started;
  return status;
}

export function normalizeLspTargets(projectRoot: string, result: unknown): NormalizedLspTarget[] {
  const values = Array.isArray(result) ? result : result ? [result] : [];
  const seen = new Set<string>();
  const out: NormalizedLspTarget[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const uri = typeof record.uri === 'string'
      ? record.uri
      : typeof record.targetUri === 'string'
        ? record.targetUri
        : null;
    const range = isRange(record.range) ? record.range : isRange(record.targetRange) ? record.targetRange : null;
    if (!uri || !range) continue;
    const line = range.start.line + 1;
    const character = range.start.character;
    const filePath = uriToProjectPath(projectRoot, uri);
    const key = `${uri}:${line}:${character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ uri, filePath, line, character });
  }
  return out;
}

function createCoverageRecord(language: LspLanguage, candidates: LspEdgeCandidateRow[]): LspCoverageRecord {
  return {
    language,
    sourceFilesSeen: new Set(candidates.map((candidate) => candidate.sourceFilePath)).size,
    candidateWorkItems: candidates.length,
    checkedWorkItems: 0,
    skippedByReason: {},
    capExceededReasons: [],
  };
}

async function requestDefinition(
  client: LspDefinitionClient,
  projectRoot: string,
  candidate: LspEdgeCandidateRow,
): Promise<unknown> {
  const absolutePath = path.join(projectRoot, candidate.sourceFilePath);
  return client.request('textDocument/definition', {
    textDocument: { uri: pathToFileURL(absolutePath).href },
    position: {
      line: Math.max(0, (candidate.line ?? 1) - 1),
      character: Math.max(0, candidate.column ?? 0),
    },
  });
}

function applyDefinitionResult(
  queries: QueryBuilder,
  projectRoot: string,
  candidate: LspEdgeCandidateRow,
  result: unknown,
): 'verified' | LspReasonCode | null {
  const targets = normalizeLspTargets(projectRoot, result);
  if (targets.length === 0) return 'language-not-applicable';
  if (targets.length > 1) return 'language-not-applicable';

  const target = targets[0]!;
  if (!target.filePath) return 'language-not-applicable';
  const nodes = queries.findNodesAtLocation(target.filePath, target.line);
  const compatible = nodes.filter((node) =>
    node.id === candidate.targetId ||
    (node.kind === candidate.targetKind && node.name === candidate.targetName)
  );
  if (compatible.length !== 1) return 'language-not-applicable';
  const node = compatible[0]!;
  if (node.id !== candidate.targetId) return 'language-not-applicable';

  const metadata = {
    ...(candidate.metadata ?? {}),
    lsp: {
      decision: 'verified',
      previousProvenance: candidate.provenance ?? null,
      targetUri: target.uri,
      targetLine: target.line,
      targetCharacter: target.character,
      verifiedAt: new Date().toISOString(),
    },
  };
  queries.updateEdgeLspProvenance(candidate.edgeId, metadata);
  return 'verified';
}

function uriToProjectPath(projectRoot: string, uri: string): string | null {
  if (!uri.startsWith('file:')) return null;
  try {
    const absolute = fileURLToPath(uri);
    const relative = path.relative(projectRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join('/');
  } catch {
    return null;
  }
}

function isRange(value: unknown): value is { start: { line: number; character: number } } {
  if (!value || typeof value !== 'object') return false;
  const start = (value as { start?: unknown }).start;
  if (!start || typeof start !== 'object') return false;
  const record = start as Record<string, unknown>;
  return Number.isInteger(record.line) && Number.isInteger(record.character);
}

function serverInfoText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const serverInfo = (value as { serverInfo?: unknown }).serverInfo;
  if (!serverInfo || typeof serverInfo !== 'object') return undefined;
  const info = serverInfo as Record<string, unknown>;
  const name = typeof info.name === 'string' ? info.name : undefined;
  const version = typeof info.version === 'string' ? info.version : undefined;
  return [name, version].filter(Boolean).join(' ') || undefined;
}

function reasonFromError(err: unknown): LspReasonCode {
  if (err && typeof err === 'object') {
    const reasonCode = (err as { reasonCode?: unknown }).reasonCode;
    if (typeof reasonCode === 'string' && (LSP_REASON_CODES as readonly string[]).includes(reasonCode)) {
      return reasonCode as LspReasonCode;
    }
  }
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);
  if (name === 'TimeoutError' || /initialize.*timeout|timeout.*initialize/i.test(message)) return 'initialize-timeout';
  if (/timeout/i.test(message)) return 'request-timeout';
  if (/malformed|json/i.test(message)) return 'malformed-protocol-response';
  return 'server-crash';
}

function serverStateForReason(reason: LspReasonCode): LspServerState {
  if (reason === 'server-crash') return 'crashed';
  if (reason === 'initialize-timeout' || reason === 'request-timeout') return 'timed-out';
  if (reason === 'missing-default-command' || reason === 'configured-command-unavailable') return 'unavailable';
  return 'degraded';
}
