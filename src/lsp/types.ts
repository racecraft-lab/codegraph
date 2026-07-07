import { EDGE_PROVENANCES, EdgeProvenance, Language } from '../types';

export const LSP_LANGUAGES = [
  'javascript',
  'jsx',
  'typescript',
  'tsx',
  'python',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'ruby',
  'rust',
  'php',
  'kotlin',
  'swift',
  'dart',
  'vue',
  'cobol',
] as const satisfies readonly Language[];

export type LspLanguage = (typeof LSP_LANGUAGES)[number];

export const DEFAULT_LSP_TIMEOUT_MS = 5000;
export const DEFAULT_LSP_SESSION_LIMIT = 2;
export const DEFAULT_LSP_REQUEST_LIMIT = 8;
export const DEFAULT_LSP_FULL_INDEX_FILE_CAP = 2000;
export const DEFAULT_LSP_FULL_INDEX_WORK_CAP = 10000;
export const DEFAULT_LSP_FULL_INDEX_BATCH_SIZE = 250;
export const DEFAULT_LSP_WATCH_FILE_CAP = 100;
export const DEFAULT_LSP_WATCH_WORK_CAP = 1000;

export type LspActivationSource =
  | 'cli-enable'
  | 'cli-disable'
  | 'project-config'
  | 'default-off';

export type LspValueSource = 'env' | 'project' | 'registry';

export type LspServerDisposition = 'implemented' | 'future-owned';

export interface LspServerCommand {
  argv: string[];
  label: string;
}

export interface LspServerRegistryEntry {
  language: LspLanguage;
  displayName: string;
  disposition: LspServerDisposition;
  commands: LspServerCommand[];
  defaultTimeoutMs: number;
  futureOwner?: 'SPEC-024';
  validationNote?: string;
}

export interface EffectiveLspServerConfig {
  language: LspLanguage;
  command: string[] | null;
  commandSource: LspValueSource | 'none';
  timeoutMs: number;
  timeoutSource: LspValueSource;
  disposition: LspServerDisposition;
}

export interface EffectiveLspConfig {
  enabled: boolean;
  activationSource: LspActivationSource;
  defaultTimeoutMs: number;
  watchEnabled: boolean;
  servers: Record<LspLanguage, EffectiveLspServerConfig>;
  warnings: LspConfigWarning[];
}

export interface LspConfigWarning {
  code:
    | 'invalid-project-lsp'
    | 'invalid-language'
    | 'invalid-command'
    | 'project-command-ignored'
    | 'invalid-timeout'
    | 'invalid-watch';
  source: 'project' | 'env';
  language?: string;
  detail: string;
}

export const LSP_REASON_CODES = [
  'missing-default-command',
  'configured-command-unavailable',
  'server-crash',
  'initialize-timeout',
  'request-timeout',
  'malformed-protocol-response',
  'shutdown-failure',
  'watch-changed-files-absent',
  'watch-changed-files-unbounded',
  'watch-changed-files-cap-exceeded',
  'watch-work-cap-exceeded',
  'full-index-file-cap-exceeded',
  'full-index-work-cap-exceeded',
  'language-not-present',
  'language-not-applicable',
  'validation-only-prereq-missing',
  'future-owned',
] as const;

export type LspReasonCode = (typeof LSP_REASON_CODES)[number];

export type LspServerState =
  | 'available'
  | 'unavailable'
  | 'initialized'
  | 'crashed'
  | 'timed-out'
  | 'degraded'
  | 'not-applicable'
  | 'future-owned';

export interface LspServerStatusRecord {
  language: LspLanguage;
  command: string[] | string | null;
  state: LspServerState;
  reasonCode?: LspReasonCode;
  detail?: string;
  observedVersion?: string;
  minimumRuntimeEvidence?: string;
  resolvedPath?: string;
  expectedAlternatives?: string[][];
  lastError?: string;
}

export interface LspCoverageRecord {
  language: LspLanguage | 'all';
  sourceFilesSeen: number;
  candidateWorkItems: number;
  checkedWorkItems: number;
  skippedByReason: Partial<Record<LspReasonCode, number>>;
  capExceededReasons: LspReasonCode[];
  elapsedMs?: number;
}

export interface LspEdgeCounts {
  checked: number;
  verified: number;
  corrected: number;
  suppressed: number;
  skippedByReason: Partial<Record<LspReasonCode, number>>;
  degraded: number;
}

export interface LspPerformanceCaps {
  activeSessionsPerProject: number;
  inFlightRequestsPerSession: number;
  fullIndexSourceFilesPerLanguage: number;
  fullIndexWorkItemsPerLanguage: number;
  fullIndexBatchSize: number;
  watchChangedSourceFilesPerBatch: number;
  watchWorkItemsPerLanguagePerBatch: number;
}

export interface LspPerformanceRecord {
  structuralElapsedMs?: number;
  lspElapsedMs?: number;
  enabledOverheadRatio?: number;
  activeSessionHighWatermark: number;
  inFlightRequestHighWatermark: number;
  caps: LspPerformanceCaps;
  zeroWorkWhenDisabled?: {
    commandProbes: number;
    subprocessStarts: number;
    jsonRpcRequests: number;
    statusWrites: number;
    graphMutations: number;
  };
}

export interface LspStatus {
  enabled: boolean;
  activationSource: LspActivationSource;
  lastRunAt: string | null;
  servers: LspServerStatusRecord[];
  coverage: LspCoverageRecord[];
  edgeCounts: LspEdgeCounts;
  performance: LspPerformanceRecord;
}

export type LspEdgeDecision = 'unchanged' | 'verified' | 'corrected' | 'suppressed' | 'skipped';

export function isLspLanguage(value: string): value is LspLanguage {
  return (LSP_LANGUAGES as readonly string[]).includes(value);
}

export function canUseLspProvenanceForDecision(decision: LspEdgeDecision): boolean {
  return decision === 'verified' || decision === 'corrected';
}

export function isKnownEdgeProvenance(value: string): value is EdgeProvenance {
  return (EDGE_PROVENANCES as readonly string[]).includes(value);
}
