import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { LspFileContextRead, LspIncomingRead, LspSourceErrorReason } from '../mcp/read-ops';
import type { Node, NodeKind } from '../types';
import {
  readLspFileContext,
  readLspIncoming,
  readLspWorkspaceSymbols,
  type DaemonReadClient,
} from '../server/daemon-client';
import {
  LSP_ERROR_CODE,
  LSP_LIFECYCLE_STATE,
  LSP_METHOD,
  LSP_SERVER_CAPABILITIES,
  clampUtf16Character,
  makeJsonRpcError,
  resolveExactUtf16Range,
  sortAndCapLocations,
  type JsonRpcErrorResponse,
  type JsonRpcId,
  type JsonRpcMessage,
  type LspFailureReason,
  type LspLifecycleState,
  type LspLocation,
  type LspPosition,
  type LspRange,
} from './protocol';

export interface LspRepositoryReader {
  root: string;
  fileContext(filePath: string): Promise<LspFileContextRead>;
  incoming(nodeId: string): Promise<LspIncomingRead>;
  workspaceSymbols(query: string): Promise<Node[]>;
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | JsonRpcErrorResponse;

interface TextDocumentPositionParams {
  textDocument: { uri: string };
  position: LspPosition;
}

interface SelectedTarget {
  node: Node;
  context: Extract<LspFileContextRead, { ok: true }>;
}

export function createDaemonLspReader(root: string, client: DaemonReadClient): LspRepositoryReader {
  return {
    root,
    fileContext: (filePath) => readLspFileContext(client, filePath),
    incoming: (nodeId) => readLspIncoming(client, nodeId),
    workspaceSymbols: (query) => readLspWorkspaceSymbols(client, query),
  };
}

export class LspFacade {
  private readonly boundRoot: string;
  private state: LspLifecycleState = LSP_LIFECYCLE_STATE.Created;
  private exitCode: 0 | 1 | null = null;

  constructor(private readonly reader: LspRepositoryReader) {
    this.boundRoot = safeRealpath(reader.root);
  }

  get lifecycleState(): LspLifecycleState {
    return this.state;
  }

  get requestedExitCode(): 0 | 1 | null {
    return this.exitCode;
  }

  async handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    if (this.state === LSP_LIFECYCLE_STATE.Terminated) return null;
    const requestId = 'id' in message ? message.id : null;
    const isRequest = requestId !== null;

    if (message.method === LSP_METHOD.Exit) {
      if (isRequest) return this.error(requestId, LSP_ERROR_CODE.InvalidRequest);
      this.exitCode = this.state === LSP_LIFECYCLE_STATE.Shutdown ? 0 : 1;
      this.state = LSP_LIFECYCLE_STATE.Terminated;
      return null;
    }

    if (this.state === LSP_LIFECYCLE_STATE.Created) {
      if (message.method !== LSP_METHOD.Initialize || !isRequest) {
        return isRequest ? this.error(requestId, LSP_ERROR_CODE.ServerNotInitialized) : null;
      }
      if (!this.validInitializeParams(message.params)) {
        return this.error(requestId, LSP_ERROR_CODE.InvalidParams);
      }
      this.state = LSP_LIFECYCLE_STATE.Initialized;
      return this.result(requestId, {
        capabilities: LSP_SERVER_CAPABILITIES,
        serverInfo: { name: 'CodeGraph', version: 1 },
      });
    }

    if (this.state === LSP_LIFECYCLE_STATE.Shutdown) {
      return isRequest ? this.error(requestId, LSP_ERROR_CODE.InvalidRequest) : null;
    }

    if (message.method === LSP_METHOD.Initialize) {
      return isRequest ? this.error(requestId, LSP_ERROR_CODE.InvalidRequest) : null;
    }
    if (message.method === LSP_METHOD.Initialized) return null;
    if (message.method === LSP_METHOD.Shutdown) {
      if (!isRequest) return null;
      this.state = LSP_LIFECYCLE_STATE.Shutdown;
      return this.result(requestId, null);
    }
    if (!isRequest) return null;

    try {
      switch (message.method) {
        case LSP_METHOD.Definition:
          return this.result(requestId, await this.definition(message.params));
        case LSP_METHOD.References:
          return this.result(requestId, await this.references(message.params));
        case LSP_METHOD.Hover:
          return this.result(requestId, await this.hover(message.params));
        case LSP_METHOD.DocumentSymbol:
          return this.result(requestId, await this.documentSymbols(message.params));
        case LSP_METHOD.WorkspaceSymbol:
          return this.result(requestId, await this.workspaceSymbols(message.params));
        case LSP_METHOD.TextDocumentContent:
          return this.result(requestId, await this.textDocumentContent(message.params));
        default:
          return this.error(requestId, LSP_ERROR_CODE.MethodNotFound);
      }
    } catch (error) {
      if (error instanceof FacadeError) return this.error(requestId, error.code, error.reason);
      return this.error(requestId, LSP_ERROR_CODE.RequestFailed);
    }
  }

  private async definition(params: object | undefined): Promise<LspLocation | null> {
    const selected = await this.selectTarget(params);
    if (!selected) return null;
    return this.locationForNode(selected.node);
  }

  private async references(params: object | undefined): Promise<LspLocation[]> {
    const selected = await this.selectTarget(params);
    if (!selected) return [];
    const includeDeclaration = isRecord(params)
      && isRecord(params.context)
      && params.context.includeDeclaration === true;
    const incoming = await this.reader.incoming(selected.node.id);
    const locations: LspLocation[] = [];
    const contexts = new Map<string, Extract<LspFileContextRead, { ok: true }>>();
    for (const occurrence of incoming.occurrences) {
      let context = contexts.get(occurrence.source.filePath);
      if (!context) {
        const read = await this.reader.fileContext(occurrence.source.filePath);
        if (!read.ok) continue;
        context = read;
        contexts.set(occurrence.source.filePath, context);
      }
      const location = this.locationForOccurrence(context, occurrence.edge.line, occurrence.edge.column, selected.node.name);
      if (location) locations.push(location);
    }
    if (includeDeclaration) {
      const declaration = await this.locationForNode(selected.node);
      if (declaration) locations.push(declaration);
    }
    return sortAndCapLocations(locations, 500);
  }

  private async hover(params: object | undefined): Promise<unknown | null> {
    const selected = await this.selectTarget(params);
    if (!selected) return null;
    const node = selected.node;
    const lines = [
      node.signature ? `\`${bounded(node.signature, 2_000)}\`` : undefined,
      `**${node.kind}** \`${bounded(node.qualifiedName, 1_000)}\``,
      node.docstring ? bounded(node.docstring, 4_000) : undefined,
    ].filter((line): line is string => line !== undefined);
    return { contents: { kind: 'markdown', value: lines.join('\n\n') } };
  }

  private async documentSymbols(params: object | undefined): Promise<unknown[]> {
    const uri = textDocumentUri(params);
    const filePath = this.relativeFilePath(uri);
    const read = await this.reader.fileContext(filePath);
    if (!read.ok) throw sourceError(read.reason);

    type DocumentSymbol = {
      name: string;
      detail?: string;
      kind: number;
      range: LspRange;
      selectionRange: LspRange;
      children?: DocumentSymbol[];
    };
    const byId = new Map<string, DocumentSymbol>();
    const nodes = [...read.nodes].sort(compareNodes);
    for (const node of nodes) {
      if (node.kind === 'file' || byId.size >= 500) continue;
      const range = this.rangeForNode(read, node);
      if (!range) continue;
      byId.set(node.id, {
        name: node.name,
        ...(node.signature ? { detail: bounded(node.signature, 2_000) } : {}),
        kind: symbolKind(node.kind),
        range,
        selectionRange: range,
      });
    }
    const childIds = new Set<string>();
    for (const edge of read.containment) {
      const parent = byId.get(edge.source);
      const child = byId.get(edge.target);
      if (!parent || !child) continue;
      (parent.children ??= []).push(child);
      childIds.add(edge.target);
    }
    for (const symbol of byId.values()) symbol.children?.sort(compareDocumentSymbols);
    return [...byId.entries()]
      .filter(([id]) => !childIds.has(id))
      .map(([, symbol]) => symbol);
  }

  private async workspaceSymbols(params: object | undefined): Promise<unknown[]> {
    if (!isRecord(params) || typeof params.query !== 'string') throw invalidParams();
    const nodes = await this.reader.workspaceSymbols(params.query);
    const contexts = new Map<string, Extract<LspFileContextRead, { ok: true }>>();
    const seen = new Set<string>();
    const symbols: unknown[] = [];
    for (const node of nodes) {
      if (symbols.length >= 100 || seen.has(node.id)) continue;
      seen.add(node.id);
      let context = contexts.get(node.filePath);
      if (!context) {
        const read = await this.reader.fileContext(node.filePath);
        if (!read.ok) continue;
        context = read;
        contexts.set(node.filePath, context);
      }
      const range = this.rangeForNode(context, node);
      if (!range) continue;
      symbols.push({
        name: node.name,
        kind: symbolKind(node.kind),
        location: { uri: this.uriForFile(node.filePath), range },
        containerName: containerName(node),
      });
    }
    return symbols;
  }

  private async textDocumentContent(params: object | undefined): Promise<unknown> {
    const filePath = this.relativeFilePath(textDocumentUri(params));
    const read = await this.reader.fileContext(filePath);
    if (!read.ok) throw sourceError(read.reason);
    const { text, languageId, contentHash, snapshotToken } = read.snapshot;
    return { text, languageId, contentHash, snapshotToken };
  }

  private async selectTarget(params: object | undefined): Promise<SelectedTarget | null> {
    const parsed = textDocumentPosition(params);
    const filePath = this.relativeFilePath(parsed.textDocument.uri);
    const read = await this.reader.fileContext(filePath);
    if (!read.ok) throw sourceError(read.reason);
    const lineText = sourceLines(read.snapshot.text)[parsed.position.line];
    if (lineText === undefined) throw invalidParams();
    const character = clampUtf16Character(lineText, parsed.position.character);
    const candidates = new Map<string, Node>();

    for (const node of read.nodes) {
      const range = this.rangeForNode(read, node);
      if (range && containsPosition(range, { line: parsed.position.line, character })) {
        candidates.set(node.id, node);
      }
    }
    for (const occurrence of read.occurrences) {
      const range = occurrenceRange(read, occurrence.edge.line, occurrence.edge.column, occurrence.target.name);
      if (range && containsPosition(range, { line: parsed.position.line, character })) {
        candidates.set(occurrence.target.id, occurrence.target);
      }
    }
    if (candidates.size !== 1) return null;
    return { node: candidates.values().next().value!, context: read };
  }

  private async locationForNode(node: Node): Promise<LspLocation | null> {
    const read = await this.reader.fileContext(node.filePath);
    if (!read.ok) return null;
    const range = this.rangeForNode(read, node);
    return range ? { uri: this.uriForFile(node.filePath), range } : null;
  }

  private locationForOccurrence(
    context: Extract<LspFileContextRead, { ok: true }>,
    line: number | undefined,
    column: number | undefined,
    evidence: string,
  ): LspLocation | null {
    const range = occurrenceRange(context, line, column, evidence);
    return range ? { uri: this.uriForFile(context.snapshot.filePath), range } : null;
  }

  private rangeForNode(context: Extract<LspFileContextRead, { ok: true }>, node: Node): LspRange | null {
    const line = node.startLine - 1;
    const text = sourceLines(context.snapshot.text)[line];
    if (text === undefined) return null;
    const span = resolveExactUtf16Range(text, node.startColumn, node.name)
      ?? uniqueEvidenceRange(text, node.name);
    return span ? { start: { line, character: span.start }, end: { line, character: span.end } } : null;
  }

  private uriForFile(filePath: string): string {
    return pathToFileURL(path.join(this.boundRoot, ...filePath.split('/'))).href;
  }

  private relativeFilePath(uri: string): string {
    let absolute: string;
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== 'file:') throw invalidParams();
      absolute = path.resolve(fileURLToPath(parsed));
    } catch (error) {
      if (error instanceof FacadeError) throw error;
      throw invalidParams();
    }
    const relative = path.relative(this.boundRoot, absolute);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw invalidParams();
    }
    return relative.split(path.sep).join('/');
  }

  private validInitializeParams(params: object | undefined): boolean {
    if (params === undefined) return true;
    if (!isRecord(params)) return false;
    const candidates: string[] = [];
    if (params.rootUri !== undefined && params.rootUri !== null) {
      if (typeof params.rootUri !== 'string') return false;
      candidates.push(params.rootUri);
    }
    if (params.rootPath !== undefined && params.rootPath !== null) {
      if (typeof params.rootPath !== 'string') return false;
      try { candidates.push(pathToFileURL(path.resolve(params.rootPath)).href); } catch { return false; }
    }
    if (params.workspaceFolders !== undefined && params.workspaceFolders !== null) {
      if (!Array.isArray(params.workspaceFolders)) return false;
      for (const folder of params.workspaceFolders) {
        if (!isRecord(folder) || typeof folder.uri !== 'string') return false;
        candidates.push(folder.uri);
      }
    }
    const roots = new Set<string>();
    for (const candidate of candidates) {
      try {
        const uri = new URL(candidate);
        if (uri.protocol !== 'file:') return false;
        roots.add(safeRealpath(fileURLToPath(uri)));
      } catch {
        return false;
      }
    }
    return roots.size <= 1 && [...roots].every((root) => root === this.boundRoot);
  }

  private result(id: JsonRpcId, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private error(id: JsonRpcId, code: typeof LSP_ERROR_CODE[keyof typeof LSP_ERROR_CODE], reason?: LspFailureReason): JsonRpcErrorResponse {
    return makeJsonRpcError(id, code, reason);
  }
}

class FacadeError extends Error {
  constructor(
    readonly code: typeof LSP_ERROR_CODE[keyof typeof LSP_ERROR_CODE],
    readonly reason?: LspFailureReason,
  ) {
    super('LSP request failed');
  }
}

function invalidParams(): FacadeError {
  return new FacadeError(LSP_ERROR_CODE.InvalidParams);
}

function sourceError(reason: LspSourceErrorReason): FacadeError {
  if (reason === 'stale') return new FacadeError(LSP_ERROR_CODE.ContentModified);
  return new FacadeError(LSP_ERROR_CODE.RequestFailed, reason);
}

function textDocumentUri(params: object | undefined): string {
  if (!isRecord(params) || !isRecord(params.textDocument) || typeof params.textDocument.uri !== 'string') {
    throw invalidParams();
  }
  return params.textDocument.uri;
}

function textDocumentPosition(params: object | undefined): TextDocumentPositionParams {
  const uri = textDocumentUri(params);
  if (!isRecord(params) || !isRecord(params.position)) throw invalidParams();
  const { line, character } = params.position;
  if (
    typeof line !== 'number' || !Number.isSafeInteger(line) || line < 0 ||
    typeof character !== 'number' || !Number.isSafeInteger(character) || character < 0
  ) {
    throw invalidParams();
  }
  return { textDocument: { uri }, position: { line, character } };
}

function occurrenceRange(
  context: Extract<LspFileContextRead, { ok: true }>,
  graphLine: number | undefined,
  graphColumn: number | undefined,
  evidence: string,
): LspRange | null {
  if (graphLine === undefined || graphColumn === undefined || graphLine < 1) return null;
  const line = graphLine - 1;
  const text = sourceLines(context.snapshot.text)[line];
  if (text === undefined) return null;
  const span = resolveExactUtf16Range(text, graphColumn, evidence);
  return span ? { start: { line, character: span.start }, end: { line, character: span.end } } : null;
}

function sourceLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

function uniqueEvidenceRange(line: string, evidence: string): { start: number; end: number } | null {
  if (!evidence) return null;
  const starts: number[] = [];
  for (let offset = 0; offset <= line.length - evidence.length;) {
    const found = line.indexOf(evidence, offset);
    if (found === -1) break;
    const before = found > 0 ? line[found - 1] : undefined;
    const after = line[found + evidence.length];
    const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(evidence);
    if (!identifier || (!isIdentifierPart(before) && !isIdentifierPart(after))) starts.push(found);
    offset = found + Math.max(1, evidence.length);
  }
  return starts.length === 1 ? { start: starts[0]!, end: starts[0]! + evidence.length } : null;
}

function isIdentifierPart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_$]/.test(value);
}

function containsPosition(range: LspRange, position: LspPosition): boolean {
  return position.line === range.start.line
    && position.character >= range.start.character
    && position.character < range.end.character;
}

function safeRealpath(input: string): string {
  try { return fs.realpathSync(input); } catch { return path.resolve(input); }
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function compareNodes(left: Node, right: Node): number {
  return left.startLine - right.startLine
    || left.startColumn - right.startColumn
    || left.endLine - right.endLine
    || left.endColumn - right.endColumn
    || left.qualifiedName.localeCompare(right.qualifiedName);
}

function compareDocumentSymbols(left: { range: LspRange; name: string }, right: { range: LspRange; name: string }): number {
  return left.range.start.line - right.range.start.line
    || left.range.start.character - right.range.start.character
    || left.name.localeCompare(right.name);
}

function containerName(node: Node): string | undefined {
  const separator = node.qualifiedName.lastIndexOf('.');
  return separator > 0 ? node.qualifiedName.slice(0, separator) : undefined;
}

function symbolKind(kind: NodeKind): number {
  switch (kind) {
    case 'file': return 1;
    case 'module': case 'namespace': return 2;
    case 'class': case 'struct': case 'component': return 5;
    case 'method': return 6;
    case 'property': case 'field': return 7;
    case 'function': case 'route': return 12;
    case 'variable': case 'parameter': return 13;
    case 'constant': return 14;
    case 'enum': return 10;
    case 'enum_member': return 22;
    case 'interface': case 'trait': case 'protocol': return 11;
    case 'type_alias': return 26;
    default: return 13;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
