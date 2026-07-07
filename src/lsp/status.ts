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
      edgeCounts: parsed.edgeCounts ?? emptyLspEdgeCounts(),
      performance: parsed.performance ?? {
        activeSessionHighWatermark: 0,
        inFlightRequestHighWatermark: 0,
        caps: defaultLspPerformanceCaps(),
      },
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
