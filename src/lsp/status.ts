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
  LspEdgeCounts,
  LspPerformanceCaps,
  LspStatus,
} from './types';

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
  };
}

export function isLspReasonCode(value: string): boolean {
  return (LSP_REASON_CODES as readonly string[]).includes(value);
}
