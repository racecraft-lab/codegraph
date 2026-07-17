import { Buffer } from 'node:buffer';

export const LSP_ERROR_CODE = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerNotInitialized: -32002,
  ContentModified: -32801,
  RequestFailed: -32803,
} as const;

export type LspErrorCode = (typeof LSP_ERROR_CODE)[keyof typeof LSP_ERROR_CODE];

export const LSP_LIFECYCLE_STATE = {
  Created: 'created',
  Initialized: 'initialized',
  Shutdown: 'shutdown',
  Terminated: 'terminated',
} as const;

export type LspLifecycleState = (typeof LSP_LIFECYCLE_STATE)[keyof typeof LSP_LIFECYCLE_STATE];

export const LSP_METHOD = {
  Initialize: 'initialize',
  Initialized: 'initialized',
  Shutdown: 'shutdown',
  Exit: 'exit',
  Definition: 'textDocument/definition',
  References: 'textDocument/references',
  Hover: 'textDocument/hover',
  DocumentSymbol: 'textDocument/documentSymbol',
  WorkspaceSymbol: 'workspace/symbol',
  TextDocumentContent: 'codegraph/textDocumentContent',
} as const;

export const LSP_SERVER_CAPABILITIES = Object.freeze({
  positionEncoding: 'utf-16',
  definitionProvider: true,
  referencesProvider: true,
  hoverProvider: true,
  documentSymbolProvider: true,
  workspaceSymbolProvider: true,
  experimental: {
    codegraphTextDocumentContent: {
      method: LSP_METHOD.TextDocumentContent,
      version: 1,
    },
  },
});

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: object;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: object;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification;

export interface JsonRpcErrorObject {
  code: LspErrorCode;
  message: string;
  data?: { reason: LspFailureReason };
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcEnvelopeResult =
  | { ok: true; message: JsonRpcMessage }
  | { ok: false; id: JsonRpcId | null; error: JsonRpcErrorObject };

export type LspFailureReason =
  | 'not_found'
  | 'outside_repository'
  | 'unindexed'
  | 'not_regular'
  | 'too_large'
  | 'unreadable'
  | 'stale'
  | 'overloaded'
  | 'timeout';

export type LspDiagnosticCode =
  | 'invalid_frame'
  | 'stream_failure'
  | 'send_failure'
  | 'daemon_unavailable'
  | 'internal_failure'
  | 'session_closed';

const ERROR_MESSAGES: Record<LspErrorCode, string> = {
  [LSP_ERROR_CODE.ParseError]: 'Parse error',
  [LSP_ERROR_CODE.InvalidRequest]: 'Invalid Request',
  [LSP_ERROR_CODE.MethodNotFound]: 'Method not found',
  [LSP_ERROR_CODE.InvalidParams]: 'Invalid params',
  [LSP_ERROR_CODE.InternalError]: 'Internal error',
  [LSP_ERROR_CODE.ServerNotInitialized]: 'Server not initialized',
  [LSP_ERROR_CODE.ContentModified]: 'Content modified',
  [LSP_ERROR_CODE.RequestFailed]: 'Request failed',
};

export function parseJsonRpcEnvelope(value: unknown): JsonRpcEnvelopeResult {
  if (!isRecord(value) || Array.isArray(value)) {
    return invalidRequest(null);
  }

  const id = isJsonRpcId(value.id) ? value.id : null;
  const hasId = Object.prototype.hasOwnProperty.call(value, 'id');
  if (
    value.jsonrpc !== '2.0'
    || typeof value.method !== 'string'
    || value.method.length === 0
    || (hasId && id === null)
    || (Object.prototype.hasOwnProperty.call(value, 'params') && value.params !== null && !isStructuredParams(value.params))
  ) {
    return invalidRequest(id);
  }

  const message: JsonRpcMessage = hasId
    ? { jsonrpc: '2.0', id: id as JsonRpcId, method: value.method }
    : { jsonrpc: '2.0', method: value.method };

  if (Object.prototype.hasOwnProperty.call(value, 'params') && value.params !== null) {
    message.params = value.params as object;
  }

  return { ok: true, message };
}

export function makeJsonRpcError(
  id: JsonRpcId | null,
  code: LspErrorCode,
  reason?: LspFailureReason,
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message: ERROR_MESSAGES[code],
      ...(reason === undefined ? {} : { data: { reason } }),
    },
  };
}

export function formatLspDiagnostic(code: LspDiagnosticCode): string {
  return `[codegraph:lsp] ${code}`;
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface Utf16Span {
  start: number;
  end: number;
}

export function clampUtf16Character(lineText: string, character: number): number {
  if (!Number.isFinite(character) || character <= 0) return 0;
  return Math.min(Math.trunc(character), lineText.length);
}

export function resolveExactUtf16Range(
  lineText: string,
  graphColumn: number,
  evidence: string,
): Utf16Span | null {
  if (!Number.isSafeInteger(graphColumn) || graphColumn < 0 || evidence.length === 0) return null;

  const starts = new Set<number>();
  if (graphColumn <= lineText.length && lineText.slice(graphColumn, graphColumn + evidence.length) === evidence) {
    starts.add(graphColumn);
  }

  const byteStart = utf8ByteOffsetToUtf16Index(lineText, graphColumn);
  if (byteStart !== null && lineText.slice(byteStart, byteStart + evidence.length) === evidence) {
    starts.add(byteStart);
  }

  if (starts.size !== 1) return null;
  const start = starts.values().next().value;
  if (start === undefined) return null;
  return { start, end: start + evidence.length };
}

export function dedupeSortAndCap<T>(
  values: readonly T[],
  key: (value: T) => string,
  compare: (left: T, right: T) => number,
  cap: number,
): T[] {
  if (!Number.isFinite(cap) || cap <= 0) return [];

  const seen = new Set<string>();
  const unique: T[] = [];
  for (const value of [...values].sort(compare)) {
    const valueKey = key(value);
    if (seen.has(valueKey)) continue;
    seen.add(valueKey);
    unique.push(value);
  }
  return unique.slice(0, Math.trunc(cap));
}

export function sortAndCapLocations(locations: readonly LspLocation[], cap: number): LspLocation[] {
  return dedupeSortAndCap(locations, locationKey, compareLocations, cap);
}

export function compareLocations(left: LspLocation, right: LspLocation): number {
  return compareText(normalizeLspUri(left.uri), normalizeLspUri(right.uri))
    || left.range.start.line - right.range.start.line
    || left.range.start.character - right.range.start.character
    || left.range.end.line - right.range.end.line
    || left.range.end.character - right.range.end.character;
}

export function normalizeLspUri(uri: string): string {
  try {
    return new URL(uri).href.normalize('NFC');
  } catch {
    return uri.normalize('NFC');
  }
}

function invalidRequest(id: JsonRpcId | null): JsonRpcEnvelopeResult {
  return { ok: false, id, error: makeJsonRpcError(id, LSP_ERROR_CODE.InvalidRequest).error };
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStructuredParams(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function utf8ByteOffsetToUtf16Index(text: string, targetOffset: number): number | null {
  let byteOffset = 0;
  let utf16Index = 0;
  if (targetOffset === 0) return 0;

  for (const character of text) {
    byteOffset += Buffer.byteLength(character, 'utf8');
    utf16Index += character.length;
    if (byteOffset === targetOffset) return utf16Index;
    if (byteOffset > targetOffset) return null;
  }

  return byteOffset === targetOffset ? utf16Index : null;
}

function locationKey(location: LspLocation): string {
  return JSON.stringify([
    normalizeLspUri(location.uri),
    location.range.start.line,
    location.range.start.character,
    location.range.end.line,
    location.range.end.character,
  ]);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
