import * as crypto from 'node:crypto';

export type CfgState =
  | 'available'
  | 'disabled'
  | 'not_indexed'
  | 'not_computed'
  | 'stale'
  | 'unavailable'
  | 'unsupported'
  | 'resource_limited'
  | 'unknown_function'
  | 'deleted';

export type CfgReason =
  | 'analysis_disabled'
  | 'project_not_indexed'
  | 'cfg_not_computed'
  | 'function_unknown'
  | 'function_deleted'
  | 'unsupported_language'
  | 'unsupported_construct'
  | 'parse_error'
  | 'parse_unsafe_region'
  | 'parser_unavailable'
  | 'block_limit_exceeded'
  | 'first_refresh_failed'
  | 'refresh_failed_retained_stale'
  | 'source_version_mismatch'
  | 'no_current_cfg_functions';

export interface CfgReadResult {
  analysis: 'cfg';
  functionId: string;
  state: CfgState;
  reason: CfgReason | null;
  message: string;
  sourceVersion: string | null;
  stale: boolean;
  cfg: CfgGraph | null;
  page: CfgPage | null;
}

export interface CfgGraph {
  analysis: 'cfg';
  graphId: string;
  language: string;
  functionId: string;
  sourceVersion: string;
  blocks: CfgBlock[];
  edges: CfgEdge[];
}

export interface CfgBlock {
  id: string;
  role: 'entry' | 'exit' | 'body' | 'condition' | 'merge' | 'unreachable';
  ordinal: number;
  spans: Array<{
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  }>;
}

export interface CfgEdge {
  source: string;
  target: string;
  kind:
    | 'fallthrough'
    | 'true'
    | 'false'
    | 'case'
    | 'default'
    | 'loop_back'
    | 'return'
    | 'throw'
    | 'break'
    | 'continue'
    | 'finally';
}

export interface CfgPage {
  limit: number;
  offset: number;
  blocks: {
    total: number;
    returned: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
  edges: {
    total: number;
    returned: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

export const CFG_STATUS_CONTRACT_VERSION = 1;
export const CFG_BLOCK_CONTRACT_VERSION = 1;
export const CFG_EDGE_CONTRACT_VERSION = 1;

export interface CfgSourceVersionInput {
  fileContentHash: string;
  functionId: string;
  language: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  statusVersion: number;
  blockVersion: number;
  edgeVersion: number;
  graphWriteVersion?: number;
}

export interface CfgPageRequest {
  limit?: number;
  offset?: number;
}

export interface NormalizedCfgPageRequest {
  limit: number;
  offset: number;
}

export interface BuildCfgPageInput extends NormalizedCfgPageRequest {
  totalBlocks: number;
  totalEdges: number;
}

export interface PageCfgGraphInput {
  graph: CfgGraph;
  request: CfgPageRequest;
}

type StoredCfgState = Extract<CfgState, 'available' | 'unavailable' | 'unsupported' | 'resource_limited' | 'deleted'>;

export interface StoredCfgStatus {
  state: StoredCfgState;
  reason: CfgReason | null;
  message?: string | null;
  sourceVersion: string | null;
  statusVersion: number;
  blockVersion: number;
  edgeVersion: number;
}

export interface ResolveCfgStatusInput {
  enabled: boolean;
  projectIndexed: boolean;
  currentSourceVersion: string | null;
  stored: StoredCfgStatus | null;
  statusVersion?: number;
  blockVersion?: number;
  edgeVersion?: number;
}

export interface ResolvedCfgStatus {
  state: CfgState;
  reason: CfgReason | null;
  stale: boolean;
  sourceVersion: string | null;
  carriesPayload: boolean;
}

export interface MakeCfgReadResultInput {
  functionId: string;
  state: CfgState;
  reason: CfgReason | null;
  message?: unknown;
  sourceVersion?: string | null;
  cfg?: CfgGraph | null;
  page?: CfgPage | null;
}

const CFG_STATES: ReadonlySet<string> = new Set([
  'available',
  'disabled',
  'not_indexed',
  'not_computed',
  'stale',
  'unavailable',
  'unsupported',
  'resource_limited',
  'unknown_function',
  'deleted',
]);

const CFG_BLOCK_ROLES: ReadonlySet<string> = new Set([
  'entry',
  'exit',
  'body',
  'condition',
  'merge',
  'unreachable',
]);

const CFG_EDGE_KINDS: ReadonlySet<string> = new Set([
  'fallthrough',
  'true',
  'false',
  'case',
  'default',
  'loop_back',
  'return',
  'throw',
  'break',
  'continue',
  'finally',
]);

const RESULT_KEYS = [
  'analysis',
  'cfg',
  'functionId',
  'message',
  'page',
  'reason',
  'sourceVersion',
  'stale',
  'state',
];

const REASONS_BY_STATE: Record<CfgState, ReadonlySet<CfgReason | null>> = {
  available: new Set([null]),
  disabled: new Set(['analysis_disabled']),
  not_indexed: new Set(['project_not_indexed']),
  not_computed: new Set(['cfg_not_computed']),
  stale: new Set(['refresh_failed_retained_stale', 'source_version_mismatch']),
  unavailable: new Set(['first_refresh_failed']),
  unsupported: new Set([
    'unsupported_language',
    'unsupported_construct',
    'parse_error',
    'parse_unsafe_region',
    'parser_unavailable',
  ]),
  resource_limited: new Set(['block_limit_exceeded']),
  unknown_function: new Set(['function_unknown']),
  deleted: new Set(['function_deleted']),
};

export function deriveCfgSourceVersion(input: CfgSourceVersionInput): string {
  const payload = {
    fileContentHash: input.fileContentHash,
    functionId: input.functionId,
    language: input.language,
    span: {
      startLine: input.startLine,
      startColumn: input.startColumn,
      endLine: input.endLine,
      endColumn: input.endColumn,
    },
    contracts: {
      statusVersion: input.statusVersion,
      blockVersion: input.blockVersion,
      edgeVersion: input.edgeVersion,
    },
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `cfgsrc:v1:${digest}`;
}

export function normalizeCfgPageRequest(request: CfgPageRequest): NormalizedCfgPageRequest {
  const rawLimit = Number.isFinite(request.limit) ? Math.trunc(request.limit!) : 100;
  const rawOffset = Number.isFinite(request.offset) ? Math.trunc(request.offset!) : 0;
  return {
    limit: Math.min(500, Math.max(1, rawLimit)),
    offset: Math.max(0, rawOffset),
  };
}

function pagePart(total: number, request: NormalizedCfgPageRequest): CfgPage['blocks'] {
  const boundedTotal = Math.max(0, Math.trunc(total));
  const returned = Math.max(0, Math.min(request.limit, boundedTotal - request.offset));
  const nextOffset = request.offset + returned;
  const hasMore = nextOffset < boundedTotal;
  return {
    total: boundedTotal,
    returned,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
}

export function buildCfgPage(input: BuildCfgPageInput): CfgPage {
  const request = normalizeCfgPageRequest(input);
  return {
    ...request,
    blocks: pagePart(input.totalBlocks, request),
    edges: pagePart(input.totalEdges, request),
  };
}

export function pageCfgGraph(input: PageCfgGraphInput): { cfg: CfgGraph; page: CfgPage } {
  const request = normalizeCfgPageRequest(input.request);
  const page = buildCfgPage({
    ...request,
    totalBlocks: input.graph.blocks.length,
    totalEdges: input.graph.edges.length,
  });
  return {
    cfg: {
      ...input.graph,
      blocks: input.graph.blocks.slice(request.offset, request.offset + request.limit),
      edges: input.graph.edges.slice(request.offset, request.offset + request.limit),
    },
    page,
  };
}

export function safeCfgMessage(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (value instanceof Error) return 'CFG analysis result unavailable.';
  if (typeof value !== 'string') return 'CFG analysis result unavailable.';
  return [...value.replace(/\s+/g, ' ').trim()].slice(0, 240).join('');
}

export function resolveCfgStatus(input: ResolveCfgStatusInput): ResolvedCfgStatus {
  if (!input.enabled) {
    return {
      state: 'disabled',
      reason: 'analysis_disabled',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    };
  }
  if (!input.projectIndexed) {
    return {
      state: 'not_indexed',
      reason: 'project_not_indexed',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    };
  }
  if (input.currentSourceVersion === null) {
    return input.stored
      ? {
          state: 'deleted',
          reason: 'function_deleted',
          stale: false,
          sourceVersion: null,
          carriesPayload: false,
        }
      : {
          state: 'unknown_function',
          reason: 'function_unknown',
          stale: false,
          sourceVersion: null,
          carriesPayload: false,
        };
  }
  if (!input.stored) {
    return {
      state: 'not_computed',
      reason: 'cfg_not_computed',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    };
  }
  if (input.stored.state === 'deleted') {
    return {
      state: 'deleted',
      reason: 'function_deleted',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    };
  }

  const expectedStatusVersion = input.statusVersion ?? CFG_STATUS_CONTRACT_VERSION;
  const expectedBlockVersion = input.blockVersion ?? CFG_BLOCK_CONTRACT_VERSION;
  const expectedEdgeVersion = input.edgeVersion ?? CFG_EDGE_CONTRACT_VERSION;
  const versionMismatch =
    input.stored.statusVersion !== expectedStatusVersion ||
    input.stored.blockVersion !== expectedBlockVersion ||
    input.stored.edgeVersion !== expectedEdgeVersion;
  if (input.stored.sourceVersion !== input.currentSourceVersion || versionMismatch) {
    if (input.stored.state !== 'available') {
      return {
        state: 'not_computed',
        reason: 'cfg_not_computed',
        stale: false,
        sourceVersion: null,
        carriesPayload: false,
      };
    }
    return {
      state: 'stale',
      reason: 'source_version_mismatch',
      stale: true,
      sourceVersion: input.stored.sourceVersion,
      carriesPayload: true,
    };
  }

  return {
    state: input.stored.state,
    reason: input.stored.reason,
    stale: false,
    sourceVersion: input.stored.sourceVersion,
    carriesPayload: input.stored.state === 'available',
  };
}

export function makeCfgReadResult(input: MakeCfgReadResultInput): CfgReadResult {
  const carriesPayload = input.state === 'available' || input.state === 'stale';
  const hasCompletePayload = input.cfg !== undefined && input.cfg !== null && input.page !== undefined && input.page !== null;
  const sourceVersion = input.sourceVersion ?? input.cfg?.sourceVersion ?? null;
  if (carriesPayload && !hasCompletePayload) {
    throw new TypeError(`Invalid CfgReadResult: ${input.state} requires complete cfg and page`);
  }
  const result: CfgReadResult = {
    analysis: 'cfg',
    functionId: input.functionId,
    state: input.state,
    reason: input.reason,
    message: safeCfgMessage(input.message),
    sourceVersion,
    stale: input.state === 'stale',
    cfg: carriesPayload && hasCompletePayload ? input.cfg! : null,
    page: carriesPayload && hasCompletePayload ? input.page! : null,
  };
  if (!isCfgReadResult(result)) {
    throw new TypeError('Invalid CfgReadResult: constructed result violates CFG contract');
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isSpan(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.startLine) &&
    isNonNegativeInteger(value.startColumn) &&
    isNonNegativeInteger(value.endLine) &&
    isNonNegativeInteger(value.endColumn)
  );
}

function isCfgBlock(value: unknown): value is CfgBlock {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.role === 'string' &&
    CFG_BLOCK_ROLES.has(value.role) &&
    isNonNegativeInteger(value.ordinal) &&
    Array.isArray(value.spans) &&
    value.spans.every(isSpan)
  );
}

function isCfgEdge(value: unknown): value is CfgEdge {
  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    typeof value.target === 'string' &&
    typeof value.kind === 'string' &&
    CFG_EDGE_KINDS.has(value.kind)
  );
}

function isCfgGraph(value: unknown, functionId: string, sourceVersion: string): value is CfgGraph {
  return (
    isRecord(value) &&
    value.analysis === 'cfg' &&
    typeof value.graphId === 'string' &&
    typeof value.language === 'string' &&
    value.functionId === functionId &&
    value.sourceVersion === sourceVersion &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isCfgBlock) &&
    Array.isArray(value.edges) &&
    value.edges.every(isCfgEdge)
  );
}

function isPagePart(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.total) &&
    isNonNegativeInteger(value.returned) &&
    value.returned <= value.total &&
    typeof value.hasMore === 'boolean' &&
    (value.nextOffset === null || isNonNegativeInteger(value.nextOffset)) &&
    (value.hasMore || value.nextOffset === null)
  );
}

function isCfgPage(value: unknown): value is CfgPage {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.limit) &&
    isNonNegativeInteger(value.offset) &&
    isPagePart(value.blocks) &&
    isPagePart(value.edges)
  );
}

export function isCfgReadResult(value: unknown): value is CfgReadResult {
  if (!isRecord(value) || !hasExactKeys(value, RESULT_KEYS)) return false;
  if (value.analysis !== 'cfg') return false;
  if (typeof value.functionId !== 'string') return false;
  if (typeof value.state !== 'string' || !CFG_STATES.has(value.state)) return false;
  if (typeof value.message !== 'string' || [...value.message].length > 240) return false;
  if (typeof value.stale !== 'boolean' || value.stale !== (value.state === 'stale')) return false;
  if (!(value.sourceVersion === null || typeof value.sourceVersion === 'string')) return false;

  const allowedReasons = REASONS_BY_STATE[value.state as CfgState];
  if (!allowedReasons.has(value.reason as CfgReason | null)) return false;

  const carriesPayload = value.state === 'available' || value.state === 'stale';
  if (!carriesPayload) return value.cfg === null && value.page === null;
  if (typeof value.sourceVersion !== 'string') return false;
  return isCfgGraph(value.cfg, value.functionId, value.sourceVersion) && isCfgPage(value.page);
}
