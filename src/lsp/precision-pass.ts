import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { QueryBuilder, LspEdgeCandidateRow } from '../db/queries';
import { Language } from '../types';
import { isGeneratedFile } from '../extraction/generated-detection';
import { LspJsonRpcClient } from './client';
import { probeLspServerCommand } from './prereqs';
import {
  compatibleLspTargetNodes,
  lspDecisionMetadata,
  lspReplacementSuppressionMetadata,
  LspTargetAudit,
} from './corrections';
import {
  EffectiveLspConfig,
  LSP_LANGUAGES,
  LSP_REASON_CODES,
  LspCoverageRecord,
  LspLanguage,
  LspPerformanceCaps,
  LspReasonCode,
  LspServerState,
  LspServerStatusRecord,
  LspStatus,
} from './types';
import {
  createInitialLspStatus,
  createLspCoverageRecord,
  defaultLspPerformanceCaps,
  evaluateLspWatchBatchScope,
  recordLspCapExceeded,
  recordLspChecked,
  recordLspDegradation,
  recordLspEdgeDecision,
  recordLspSkip,
} from './status';

const LSP_PRECISION_LANGUAGES = LSP_LANGUAGES.filter((language) => language !== 'cobol') as LspLanguage[];

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
  performanceCaps?: LspPerformanceCaps;
  clientFactory?: LspClientFactory;
  watch?: LspWatchPrecisionPassOptions;
}

export interface LspWatchPrecisionPassOptions {
  changedSourceFiles: readonly string[] | 'unbounded' | undefined;
  restartBudget?: LspWatchRestartBudget;
  materialBatchKey?: string;
}

export interface LspWatchRestartBudgetEntry {
  reason: LspReasonCode;
}

export type LspWatchRestartBudget = Map<
  string,
  Partial<Record<LspLanguage, LspWatchRestartBudgetEntry>>
>;

interface NormalizedLspTarget extends LspTargetAudit {
  uri: string;
  filePath: string | null;
  line: number;
  character: number;
}

export async function runLspPrecisionPass(options: RunLspPrecisionPassOptions): Promise<LspStatus> {
  const status = createInitialLspStatus(options.config);
  if (!options.config.enabled) return status;

  const started = Date.now();
  const caps = options.performanceCaps ?? defaultLspPerformanceCaps();
  const clientFactory = options.clientFactory ?? DEFAULT_CLIENT_FACTORY;
  const watch = options.watch;
  const watchChangedFiles = Array.isArray(watch?.changedSourceFiles)
    ? normalizeChangedSourceFiles(watch.changedSourceFiles)
    : null;
  const watchBatchKey = watchChangedFiles
    ? (watch?.materialBatchKey ?? materialWatchBatchKey(watchChangedFiles))
    : null;
  status.lastRunAt = new Date(started).toISOString();
  status.performance.structuralElapsedMs = options.structuralElapsedMs;
  status.performance.caps = caps;

  if (watch) {
    if (!options.config.watchEnabled) return status;
    const fileScopeDecision = evaluateLspWatchBatchScope({
      changedSourceFiles: watch.changedSourceFiles,
      candidateWorkItemsByLanguage: {},
      caps,
    });
    if (!fileScopeDecision.canRun) {
      recordWatchScopeSkip(status, watch.changedSourceFiles, fileScopeDecision.skippedByReason);
      status.performance.lspElapsedMs = Date.now() - started;
      return status;
    }
  }

  for (const language of LSP_PRECISION_LANGUAGES) {
    const discoveredCandidates = options.queries.getLspEdgeCandidates(
      [language] as Language[],
      lspCandidateDiscoveryLimit(caps, watchChangedFiles !== null),
      watchChangedFiles ? [...watchChangedFiles] : undefined,
    );
    const scopedCandidates = watchChangedFiles
      ? discoveredCandidates.filter((candidate) => watchChangedFiles.has(candidate.sourceFilePath))
      : discoveredCandidates;
    if (scopedCandidates.length === 0) continue;

    const serverConfig = options.config.servers[language];
    const candidateCounts = watchChangedFiles
      ? {
          sourceFilesSeen: countDistinctSourceFiles(scopedCandidates),
          candidateWorkItems: scopedCandidates.length,
          fileCapSkippedWorkItems: undefined,
          workCapSkippedWorkItems: undefined,
        }
      : options.queries.getLspEdgeCandidateCounts([language] as Language[], caps);
    const coverage = createLspCoverageRecord(language, candidateCounts);
    status.coverage.push(coverage);
    const languageCandidates = watchChangedFiles
      ? applyWatchCaps(status, coverage, scopedCandidates, caps)
      : applyFullIndexCaps(status, coverage, scopedCandidates, caps, {
          fileCapSkippedWorkItems: candidateCounts.fileCapSkippedWorkItems,
          workCapSkippedWorkItems: candidateCounts.workCapSkippedWorkItems,
        });

    if (languageCandidates.length === 0) {
      coverage.elapsedMs = Date.now() - started;
      continue;
    }

    const exhaustedReason = watchBatchKey
      ? getWatchRestartExhaustion(watch?.restartBudget, watchBatchKey, language)
      : null;
    if (exhaustedReason) {
      status.servers.push({
        language,
        command: serverConfig.command,
        commandSource: serverConfig.commandSource,
        state: serverStateForReason(exhaustedReason),
        reasonCode: exhaustedReason,
        detail: 'LSP watch restart budget already exhausted for this changed-file batch',
        timeoutMs: serverConfig.timeoutMs,
        timeoutSource: serverConfig.timeoutSource,
      });
      recordLspDegradation(status, coverage, exhaustedReason, languageCandidates.length);
      coverage.elapsedMs = Date.now() - started;
      continue;
    }

    const serverStatus = probeLspServerCommand(serverConfig, { cwd: options.projectRoot });
    status.servers.push(serverStatus);

    if (serverStatus.state !== 'available' || !Array.isArray(serverStatus.command)) {
      const reason = serverStatus.reasonCode ?? 'configured-command-unavailable';
      recordLspDegradation(status, coverage, reason, languageCandidates.length);
      continue;
    }

    await runLanguageWithRestartBudget({
      language,
      command: serverStatus.command,
      timeoutMs: serverConfig.timeoutMs,
      candidates: languageCandidates,
      clientFactory,
      coverage,
      options,
      status,
      serverStatus,
      caps,
      passStartedAt: started,
      watchBatchKey,
      watchRestartBudget: watch?.restartBudget,
    });

    coverage.elapsedMs = Date.now() - started;
  }

  status.performance.lspElapsedMs = Date.now() - started;
  if (options.structuralElapsedMs !== undefined && options.structuralElapsedMs > 0) {
    status.performance.enabledOverheadRatio = (options.structuralElapsedMs + status.performance.lspElapsedMs) / options.structuralElapsedMs;
  }
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
    const range = isRange(record.range)
      ? record.range
      : isRange(record.targetSelectionRange)
        ? record.targetSelectionRange
        : isRange(record.targetRange)
          ? record.targetRange
          : null;
    if (!uri || !range) continue;
    const line = range.start.line + 1;
    const character = range.start.character;
    const filePath = uriToProjectPath(projectRoot, uri);
    const key = `${filePath ?? uri}:${line}:${character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ uri, filePath, line, character });
  }
  return out;
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

interface RunLanguageOptions {
  language: LspLanguage;
  command: string[];
  timeoutMs: number;
  candidates: LspEdgeCandidateRow[];
  clientFactory: LspClientFactory;
  coverage: LspCoverageRecord;
  options: RunLspPrecisionPassOptions;
  status: LspStatus;
  serverStatus: LspServerStatusRecord;
  caps: LspPerformanceCaps;
  passStartedAt: number;
  watchBatchKey: string | null;
  watchRestartBudget?: LspWatchRestartBudget;
}

interface CandidateFailure {
  reason: LspReasonCode;
  error: unknown;
  failedCandidateIndex: number;
}

interface ProcessCandidatesResult {
  failure?: CandidateFailure;
}

async function runLanguageWithRestartBudget(run: RunLanguageOptions): Promise<void> {
  if (run.candidates.length === 0) return;

  let remaining = run.candidates;
  let restartAttempts = 0;
  let initializedAtLeastOnce = false;

  while (remaining.length > 0) {
    const client = run.clientFactory.create({
      language: run.language,
      command: run.command,
      cwd: run.options.projectRoot,
      timeoutMs: run.timeoutMs,
    });
    run.status.performance.activeSessionHighWatermark = Math.max(
      run.status.performance.activeSessionHighWatermark,
      1,
    );

    try {
      const initializeResult = await client.initialize({
        processId: process.pid,
        rootUri: pathToFileURL(run.options.projectRoot).href,
        capabilities: {},
      });
      initializedAtLeastOnce = true;
      run.serverStatus.state = 'initialized';
      run.serverStatus.observedVersion = serverInfoText(initializeResult);

      const processed = await processCandidateRequests(client, remaining, run);
      if (!processed.failure) {
        const shutdownError = await shutdownLanguageClient(client);
        if (shutdownError) {
          recordShutdownFailure(run, shutdownError, remaining.length - run.coverage.checkedWorkItems);
          rememberWatchRestartExhaustion(run, 'shutdown-failure');
        }
        return;
      }

      const failure = processed.failure;
      const shutdownError = await shutdownLanguageClient(client);
      if (restartAttempts < 1) {
        restartAttempts += 1;
        remaining = remaining.slice(failure.failedCandidateIndex);
        continue;
      }
      markLanguageDegraded(run, failure.reason, failure.error, remaining.slice(failure.failedCandidateIndex), shutdownError);
      return;
    } catch (err) {
      const reason = reasonFromError(err);
      const shutdownError = await shutdownLanguageClient(client);
      if (restartAttempts < 1) {
        restartAttempts += 1;
        continue;
      }
      markLanguageDegraded(run, reason, err, remaining, shutdownError);
      return;
    } finally {
      run.coverage.elapsedMs = Date.now() - run.passStartedAt;
    }
  }

  if (!initializedAtLeastOnce) {
    run.serverStatus.state = 'degraded';
  }
}

async function processCandidateRequests(
  client: LspDefinitionClient,
  candidates: LspEdgeCandidateRow[],
  run: RunLanguageOptions,
): Promise<ProcessCandidatesResult> {
  for (let batchStart = 0; batchStart < candidates.length; batchStart += run.caps.fullIndexBatchSize) {
    const batch = candidates.slice(batchStart, batchStart + run.caps.fullIndexBatchSize);
    for (let chunkStart = 0; chunkStart < batch.length; chunkStart += run.caps.inFlightRequestsPerSession) {
      const chunk = batch.slice(chunkStart, chunkStart + run.caps.inFlightRequestsPerSession);
      run.status.performance.inFlightRequestHighWatermark = Math.max(
        run.status.performance.inFlightRequestHighWatermark,
        chunk.length,
      );
      const results = await Promise.all(chunk.map(async (candidate, index) => {
        try {
          return {
            candidate,
            index,
            result: await requestDefinition(client, run.options.projectRoot, candidate),
          };
        } catch (error) {
          return { candidate, index, error };
        }
      }));

      for (const item of results) {
        if ('error' in item) {
          return {
            failure: {
              reason: reasonFromError(item.error),
              error: item.error,
              failedCandidateIndex: batchStart + chunkStart + item.index,
            },
          };
        }

        const decision = applyDefinitionResult(
          run.options.queries,
          run.options.projectRoot,
          item.candidate,
          item.result,
        );
        recordLspChecked(run.status, run.coverage);
        if (decision === 'verified' || decision === 'corrected' || decision === 'suppressed') {
          recordLspEdgeDecision(run.status, decision);
        } else if (decision) {
          recordLspSkip(run.status, run.coverage, decision);
        }
      }
    }
  }
  return {};
}

async function shutdownLanguageClient(
  client: LspDefinitionClient,
): Promise<string | undefined> {
  try {
    await client.shutdown();
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function recordShutdownFailure(
  run: RunLanguageOptions,
  shutdownError: string,
  unprocessedCount: number,
): void {
  run.serverStatus.state = 'degraded';
  run.serverStatus.reasonCode = 'shutdown-failure';
  run.serverStatus.lastError = shutdownError;
  recordLspDegradation(run.status, run.coverage, 'shutdown-failure', unprocessedCount);
}

function markLanguageDegraded(
  run: RunLanguageOptions,
  reason: LspReasonCode,
  error: unknown,
  remainingCandidates: LspEdgeCandidateRow[],
  shutdownError?: string,
): void {
  run.serverStatus.state = serverStateForReason(reason);
  run.serverStatus.reasonCode = reason;
  const primaryError = error instanceof Error ? error.message : String(error);
  run.serverStatus.lastError = shutdownError
    ? `${primaryError}; shutdown failed: ${shutdownError}`
    : primaryError;
  recordLspDegradation(run.status, run.coverage, reason, remainingCandidates.length);
  rememberWatchRestartExhaustion(run, reason);
}

function applyWatchCaps(
  status: LspStatus,
  coverage: LspCoverageRecord,
  candidates: LspEdgeCandidateRow[],
  caps: LspPerformanceCaps,
): LspEdgeCandidateRow[] {
  const decision = evaluateLspWatchBatchScope({
    changedSourceFiles: Array.from(new Set(candidates.map((candidate) => candidate.sourceFilePath))),
    candidateWorkItemsByLanguage: {
      [coverage.language as LspLanguage]: candidates.length,
    },
    caps,
  });
  const reason = decision.skippedByLanguage[coverage.language as LspLanguage];
  if (reason === 'watch-work-cap-exceeded') {
    recordLspCapExceeded(status, coverage, reason, candidates.length);
    return [];
  }
  return candidates;
}

function recordWatchScopeSkip(
  status: LspStatus,
  changedSourceFiles: readonly string[] | 'unbounded' | undefined,
  skippedByReason: Partial<Record<LspReasonCode, number>>,
): void {
  const coverage = createLspCoverageRecord('all', {
    sourceFilesSeen: Array.isArray(changedSourceFiles) ? changedSourceFiles.length : 0,
    candidateWorkItems: 0,
  });
  status.coverage.push(coverage);

  for (const [reason, count] of Object.entries(skippedByReason) as Array<[LspReasonCode, number]>) {
    if (reason === 'watch-changed-files-cap-exceeded') {
      recordLspCapExceeded(status, coverage, reason, count);
    } else {
      recordLspSkip(status, coverage, reason, count);
    }
  }
}

function normalizeChangedSourceFiles(files: readonly string[]): Set<string> {
  return new Set(files.map((filePath) => normalizeProjectPath(filePath)));
}

function materialWatchBatchKey(files: ReadonlySet<string>): string {
  return [...files].sort().join('\n');
}

function getWatchRestartExhaustion(
  budget: LspWatchRestartBudget | undefined,
  batchKey: string,
  language: LspLanguage,
): LspReasonCode | null {
  return budget?.get(batchKey)?.[language]?.reason ?? null;
}

function rememberWatchRestartExhaustion(run: RunLanguageOptions, reason: LspReasonCode): void {
  if (!run.watchBatchKey || !run.watchRestartBudget) return;
  const entry = run.watchRestartBudget.get(run.watchBatchKey) ?? {};
  entry[run.language] = { reason };
  run.watchRestartBudget.set(run.watchBatchKey, entry);
}

function applyFullIndexCaps(
  status: LspStatus,
  coverage: LspCoverageRecord,
  candidates: LspEdgeCandidateRow[],
  caps: LspPerformanceCaps,
  aggregateSkippedCounts?: {
    fileCapSkippedWorkItems?: number;
    workCapSkippedWorkItems?: number;
  },
): LspEdgeCandidateRow[] {
  const allowedFiles = new Set<string>();
  const fileCappedCandidates: LspEdgeCandidateRow[] = [];
  let skippedByFileCap = 0;

  for (const candidate of candidates) {
    if (!allowedFiles.has(candidate.sourceFilePath)) {
      if (allowedFiles.size >= caps.fullIndexSourceFilesPerLanguage) {
        skippedByFileCap += 1;
        continue;
      }
      allowedFiles.add(candidate.sourceFilePath);
    }
    fileCappedCandidates.push(candidate);
  }

  const totalSkippedByFileCap = aggregateSkippedCounts?.fileCapSkippedWorkItems ?? skippedByFileCap;
  if (totalSkippedByFileCap > 0) {
    recordLspCapExceeded(status, coverage, 'full-index-file-cap-exceeded', totalSkippedByFileCap);
  }

  const runnable = fileCappedCandidates.slice(0, caps.fullIndexWorkItemsPerLanguage);
  const skippedByWorkCap = fileCappedCandidates.length - runnable.length;
  const totalSkippedByWorkCap = aggregateSkippedCounts?.workCapSkippedWorkItems ?? skippedByWorkCap;
  if (totalSkippedByWorkCap > 0) {
    recordLspCapExceeded(status, coverage, 'full-index-work-cap-exceeded', totalSkippedByWorkCap);
  }

  return runnable;
}

function lspCandidateDiscoveryLimit(caps: LspPerformanceCaps, isWatch: boolean): number {
  if (isWatch) return caps.watchWorkItemsPerLanguagePerBatch + 1;
  return caps.fullIndexWorkItemsPerLanguage + caps.fullIndexSourceFilesPerLanguage + 1;
}

function countDistinctSourceFiles(candidates: LspEdgeCandidateRow[]): number {
  return new Set(candidates.map((candidate) => candidate.sourceFilePath)).size;
}

function applyDefinitionResult(
  queries: QueryBuilder,
  projectRoot: string,
  candidate: LspEdgeCandidateRow,
  result: unknown,
): 'verified' | 'corrected' | 'suppressed' | LspReasonCode | null {
  const targets = normalizeLspTargets(projectRoot, result);
  if (targets.length === 0) return 'language-not-applicable';
  if (targets.length > 1) return 'language-not-applicable';

  const target = targets[0]!;
  if (!target.filePath) {
    queries.suppressEdgeWithLspAudit(
      candidate.edgeId,
      lspDecisionMetadata(candidate, 'suppressed', target, { reason: 'external-target' }),
    );
    return 'suppressed';
  }
  if (isGeneratedFile(target.filePath)) {
    queries.suppressEdgeWithLspAudit(
      candidate.edgeId,
      lspDecisionMetadata(candidate, 'suppressed', target, { reason: 'generated-target' }),
    );
    return 'suppressed';
  }

  const nodes = queries.findNodesAtLocation(target.filePath, target.line, candidate.language, target.character);
  const compatible = compatibleLspTargetNodes(candidate, nodes);
  if (compatible.length === 0) {
    queries.suppressEdgeWithLspAudit(
      candidate.edgeId,
      lspDecisionMetadata(candidate, 'suppressed', target, { reason: 'unindexed-target' }),
    );
    return 'suppressed';
  }
  if (compatible.length !== 1) return 'language-not-applicable';
  const node = compatible[0]!;

  if (node.id === candidate.targetId) {
    queries.updateEdgeLspProvenance(
      candidate.edgeId,
      lspDecisionMetadata(candidate, 'verified', target),
    );
    return 'verified';
  }

  queries.retargetEdgeWithLspCorrection(
    candidate.edgeId,
    node.id,
    lspDecisionMetadata(candidate, 'corrected', target, {
      replacementTargetId: node.id,
      replacementTargetFilePath: node.filePath,
    }),
    lspReplacementSuppressionMetadata(candidate, target, node.id),
  );
  return 'corrected';
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

function normalizeProjectPath(filePath: string): string {
  return filePath.split(path.sep).join('/').replace(/^\.\//, '');
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
