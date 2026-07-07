import {
  DEFAULT_LSP_FULL_INDEX_BATCH_SIZE,
  DEFAULT_LSP_FULL_INDEX_FILE_CAP,
  DEFAULT_LSP_FULL_INDEX_WORK_CAP,
  DEFAULT_LSP_REQUEST_LIMIT,
  DEFAULT_LSP_SESSION_LIMIT,
  DEFAULT_LSP_WATCH_FILE_CAP,
  DEFAULT_LSP_WATCH_WORK_CAP,
  EffectiveLspConfig,
  LSP_REASON_CODES,
  LspCoverageRecord,
  LspEdgeCounts,
  LspEdgeDecision,
  LspLanguage,
  LspPerformanceCaps,
  LspReasonCode,
  LspStatus,
} from './types';

export const LSP_STATUS_METADATA_KEY = 'lsp_status';

export function defaultLspPerformanceCaps(): LspPerformanceCaps {
  return {
    activeSessionsPerProject: DEFAULT_LSP_SESSION_LIMIT,
    inFlightRequestsPerSession: DEFAULT_LSP_REQUEST_LIMIT,
    fullIndexSourceFilesPerLanguage: DEFAULT_LSP_FULL_INDEX_FILE_CAP,
    fullIndexWorkItemsPerLanguage: DEFAULT_LSP_FULL_INDEX_WORK_CAP,
    fullIndexBatchSize: DEFAULT_LSP_FULL_INDEX_BATCH_SIZE,
    watchChangedSourceFilesPerBatch: DEFAULT_LSP_WATCH_FILE_CAP,
    watchWorkItemsPerLanguagePerBatch: DEFAULT_LSP_WATCH_WORK_CAP,
  };
}

export function emptyLspEdgeCounts(): LspEdgeCounts {
  return {
    checked: 0,
    verified: 0,
    corrected: 0,
    suppressed: 0,
    skippedByReason: {},
    degraded: 0,
  };
}

export function createInitialLspStatus(config: EffectiveLspConfig): LspStatus {
  return {
    enabled: config.enabled,
    activationSource: config.activationSource,
    lastRunAt: null,
    servers: [],
    coverage: [],
    edgeCounts: emptyLspEdgeCounts(),
    performance: {
      activeSessionHighWatermark: 0,
      inFlightRequestHighWatermark: 0,
      caps: defaultLspPerformanceCaps(),
      zeroWorkWhenDisabled: config.enabled ? undefined : {
        commandProbes: 0,
        subprocessStarts: 0,
        jsonRpcRequests: 0,
        statusWrites: 0,
        graphMutations: 0,
      },
    },
    warnings: config.warnings.length > 0 ? config.warnings : undefined,
  };
}

export function disabledLspCoverageRecord(): LspCoverageRecord {
  return {
    language: 'all',
    sourceFilesSeen: 0,
    candidateWorkItems: 0,
    checkedWorkItems: 0,
    skippedByReason: {},
    capExceededReasons: [],
  };
}

export type LspReasonCategory =
  | 'unavailable'
  | 'degraded'
  | 'skipped'
  | 'not-present'
  | 'not-applicable'
  | 'validation-only'
  | 'future-owned';

export function lspReasonCategory(reason: LspReasonCode): LspReasonCategory {
  switch (reason) {
    case 'missing-default-command':
    case 'configured-command-unavailable':
      return 'unavailable';
    case 'server-crash':
    case 'initialize-timeout':
    case 'request-timeout':
    case 'malformed-protocol-response':
    case 'shutdown-failure':
      return 'degraded';
    case 'watch-changed-files-absent':
    case 'watch-changed-files-unbounded':
    case 'watch-changed-files-cap-exceeded':
    case 'watch-work-cap-exceeded':
    case 'full-index-file-cap-exceeded':
    case 'full-index-work-cap-exceeded':
      return 'skipped';
    case 'language-not-present':
      return 'not-present';
    case 'language-not-applicable':
      return 'not-applicable';
    case 'validation-only-prereq-missing':
      return 'validation-only';
    case 'future-owned':
      return 'future-owned';
  }
}

export function createLspCoverageRecord(
  language: LspLanguage | 'all',
  counts: { sourceFilesSeen: number; candidateWorkItems: number },
): LspCoverageRecord {
  return {
    language,
    sourceFilesSeen: counts.sourceFilesSeen,
    candidateWorkItems: counts.candidateWorkItems,
    checkedWorkItems: 0,
    skippedByReason: {},
    capExceededReasons: [],
  };
}

export function recordLspChecked(status: LspStatus, coverage: LspCoverageRecord, count = 1): void {
  if (count <= 0) return;
  status.edgeCounts.checked += count;
  coverage.checkedWorkItems += count;
}

export function recordLspEdgeDecision(status: LspStatus, decision: LspEdgeDecision): void {
  if (decision === 'verified') {
    status.edgeCounts.verified += 1;
  } else if (decision === 'corrected') {
    status.edgeCounts.corrected += 1;
  } else if (decision === 'suppressed') {
    status.edgeCounts.suppressed += 1;
  }
}

export function recordLspSkip(
  status: LspStatus,
  coverage: LspCoverageRecord,
  reason: LspReasonCode,
  count = 1,
): void {
  if (count <= 0) return;
  incrementReason(status.edgeCounts.skippedByReason, reason, count);
  incrementReason(coverage.skippedByReason, reason, count);
}

export function recordLspDegradation(
  status: LspStatus,
  coverage: LspCoverageRecord,
  reason: LspReasonCode,
  count = 1,
): void {
  if (count <= 0) return;
  status.edgeCounts.degraded += count;
  recordLspSkip(status, coverage, reason, count);
}

export function recordLspCapExceeded(
  status: LspStatus,
  coverage: LspCoverageRecord,
  reason: Extract<
    LspReasonCode,
    | 'full-index-file-cap-exceeded'
    | 'full-index-work-cap-exceeded'
    | 'watch-changed-files-cap-exceeded'
    | 'watch-work-cap-exceeded'
  >,
  count: number,
): void {
  if (!coverage.capExceededReasons.includes(reason)) coverage.capExceededReasons.push(reason);
  recordLspSkip(status, coverage, reason, count);
}

export interface LspWatchBatchScope {
  changedSourceFiles: readonly string[] | 'unbounded' | undefined;
  candidateWorkItemsByLanguage: Partial<Record<LspLanguage, number>>;
  caps?: Pick<LspPerformanceCaps, 'watchChangedSourceFilesPerBatch' | 'watchWorkItemsPerLanguagePerBatch'>;
}

export interface LspWatchBatchScopeDecision {
  canRun: boolean;
  skippedByReason: Partial<Record<LspReasonCode, number>>;
  skippedByLanguage: Partial<Record<LspLanguage, LspReasonCode>>;
}

export function evaluateLspWatchBatchScope(scope: LspWatchBatchScope): LspWatchBatchScopeDecision {
  const caps = scope.caps ?? defaultLspPerformanceCaps();
  const skippedByReason: Partial<Record<LspReasonCode, number>> = {};
  const skippedByLanguage: Partial<Record<LspLanguage, LspReasonCode>> = {};

  if (scope.changedSourceFiles === undefined) {
    incrementReason(skippedByReason, 'watch-changed-files-absent', 1);
  } else if (scope.changedSourceFiles === 'unbounded') {
    incrementReason(skippedByReason, 'watch-changed-files-unbounded', 1);
  } else if (scope.changedSourceFiles.length > caps.watchChangedSourceFilesPerBatch) {
    incrementReason(skippedByReason, 'watch-changed-files-cap-exceeded', scope.changedSourceFiles.length);
  }

  for (const [language, count] of Object.entries(scope.candidateWorkItemsByLanguage) as Array<[LspLanguage, number | undefined]>) {
    if ((count ?? 0) > caps.watchWorkItemsPerLanguagePerBatch) {
      skippedByLanguage[language] = 'watch-work-cap-exceeded';
      incrementReason(skippedByReason, 'watch-work-cap-exceeded', count ?? 0);
    }
  }

  return {
    canRun: Object.keys(skippedByReason).length === 0,
    skippedByReason,
    skippedByLanguage,
  };
}

export function serializeLspStatus(status: LspStatus): string {
  return JSON.stringify(status);
}

export function parsePersistedLspStatus(raw: string | null): LspStatus | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LspStatus>;
    if (typeof parsed.enabled !== 'boolean') return null;
    if (typeof parsed.activationSource !== 'string') return null;
    return {
      enabled: parsed.enabled,
      activationSource: parsed.activationSource as LspStatus['activationSource'],
      lastRunAt: typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : null,
      servers: Array.isArray(parsed.servers) ? parsed.servers as LspStatus['servers'] : [],
      coverage: Array.isArray(parsed.coverage) ? parsed.coverage as LspStatus['coverage'] : [],
      edgeCounts: normalizeLspEdgeCounts(parsed.edgeCounts),
      performance: normalizeLspPerformance(parsed.performance),
      warnings: parsed.warnings,
    };
  } catch {
    return null;
  }
}

export function isLspReasonCode(value: string): boolean {
  return (LSP_REASON_CODES as readonly string[]).includes(value);
}

function incrementReason(
  reasons: Partial<Record<LspReasonCode, number>>,
  reason: LspReasonCode,
  count: number,
): void {
  reasons[reason] = (reasons[reason] ?? 0) + count;
}

function normalizeLspEdgeCounts(value: unknown): LspEdgeCounts {
  const defaults = emptyLspEdgeCounts();
  if (!value || typeof value !== 'object') return defaults;
  const record = value as Partial<LspEdgeCounts>;
  return {
    checked: numericOrDefault(record.checked, defaults.checked),
    verified: numericOrDefault(record.verified, defaults.verified),
    corrected: numericOrDefault(record.corrected, defaults.corrected),
    suppressed: numericOrDefault(record.suppressed, defaults.suppressed),
    skippedByReason: normalizeReasonCounts(record.skippedByReason),
    degraded: numericOrDefault(record.degraded, defaults.degraded),
  };
}

function normalizeLspPerformance(value: unknown): LspStatus['performance'] {
  const defaults: LspStatus['performance'] = {
    activeSessionHighWatermark: 0,
    inFlightRequestHighWatermark: 0,
    caps: defaultLspPerformanceCaps(),
  };
  if (!value || typeof value !== 'object') return defaults;
  const record = value as Partial<LspStatus['performance']>;
  return {
    structuralElapsedMs: numericOrUndefined(record.structuralElapsedMs),
    lspElapsedMs: numericOrUndefined(record.lspElapsedMs),
    enabledOverheadRatio: numericOrUndefined(record.enabledOverheadRatio),
    activeSessionHighWatermark: numericOrDefault(record.activeSessionHighWatermark, 0),
    inFlightRequestHighWatermark: numericOrDefault(record.inFlightRequestHighWatermark, 0),
    caps: normalizeLspPerformanceCaps(record.caps),
    zeroWorkWhenDisabled: record.zeroWorkWhenDisabled,
  };
}

function normalizeLspPerformanceCaps(value: unknown): LspPerformanceCaps {
  const defaults = defaultLspPerformanceCaps();
  if (!value || typeof value !== 'object') return defaults;
  const record = value as Partial<LspPerformanceCaps>;
  return {
    activeSessionsPerProject: numericOrDefault(record.activeSessionsPerProject, defaults.activeSessionsPerProject),
    inFlightRequestsPerSession: numericOrDefault(record.inFlightRequestsPerSession, defaults.inFlightRequestsPerSession),
    fullIndexSourceFilesPerLanguage: numericOrDefault(record.fullIndexSourceFilesPerLanguage, defaults.fullIndexSourceFilesPerLanguage),
    fullIndexWorkItemsPerLanguage: numericOrDefault(record.fullIndexWorkItemsPerLanguage, defaults.fullIndexWorkItemsPerLanguage),
    fullIndexBatchSize: numericOrDefault(record.fullIndexBatchSize, defaults.fullIndexBatchSize),
    watchChangedSourceFilesPerBatch: numericOrDefault(record.watchChangedSourceFilesPerBatch, defaults.watchChangedSourceFilesPerBatch),
    watchWorkItemsPerLanguagePerBatch: numericOrDefault(record.watchWorkItemsPerLanguagePerBatch, defaults.watchWorkItemsPerLanguagePerBatch),
  };
}

function normalizeReasonCounts(value: unknown): Partial<Record<LspReasonCode, number>> {
  if (!value || typeof value !== 'object') return {};
  const out: Partial<Record<LspReasonCode, number>> = {};
  for (const [reason, count] of Object.entries(value)) {
    if (!isLspReasonCode(reason) || typeof count !== 'number' || !Number.isFinite(count)) continue;
    out[reason as LspReasonCode] = count;
  }
  return out;
}

function numericOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numericOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
