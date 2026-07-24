import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  LspDocumentContextRead,
  LspIncomingRead,
  LspNode,
  LspNodeLocationRead,
  LspPositionContextRead,
  LspSourceErrorReason,
  LspSourceSnapshotRead,
  LspWorkspaceSymbolsRead,
} from '../mcp/read-ops';
import type { NodeKind } from '../types';
import {
  readLspDocumentContext,
  readLspIncoming,
  readLspNodeLocation,
  readLspPositionContext,
  readLspSourceSnapshot,
  readLspWorkspaceSymbols,
  type DaemonReadClient,
} from '../server/daemon-client';
import {
  LSP_ERROR_CODE,
  LSP_LIFECYCLE_STATE,
  LSP_METHOD,
  LSP_SERVER_CAPABILITIES,
  LSP_WORKSPACE_QUERY_BYTE_CAP,
  clampUtf16Character,
  compareLocations,
  makeJsonRpcError,
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
import { compareSqliteBinaryText } from './sort-key';

export interface LspRepositoryReader {
  root: string;
  sourceSnapshot(filePath: string, signal?: AbortSignal): Promise<LspSourceSnapshotRead>;
  positionContext(filePath: string, line: number, signal?: AbortSignal): Promise<LspPositionContextRead>;
  documentContext(filePath: string, signal?: AbortSignal): Promise<LspDocumentContextRead>;
  incoming(
    nodeId: string,
    filePath: string,
    snapshotToken: string,
    signal?: AbortSignal,
  ): Promise<LspIncomingRead>;
  nodeLocation(nodeId: string, signal?: AbortSignal): Promise<LspNodeLocationRead>;
  workspaceSymbols(query: string, signal?: AbortSignal): Promise<LspWorkspaceSymbolsRead>;
}

export class LspDaemonUnavailableError extends Error {}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | JsonRpcErrorResponse;

interface TextDocumentPositionParams {
  textDocument: { uri: string };
  position: LspPosition;
  snapshotToken?: string;
}

interface SelectedTarget {
  node: LspNode;
  snapshotToken: string;
  context: Extract<LspPositionContextRead, { ok: true }>;
}

interface LspDocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

interface OrderedWorkspaceSymbol {
  searchScore: number;
  qualifiedName: string;
  nodeId: string;
  location: LspLocation;
  result: unknown;
}

interface SourceView {
  lines: string[];
  byteLength: number;
  utf8Columns: Map<number, Int32Array>;
}

export interface LspValidatedSourceBudget {
  reserve(bytes: number): (() => void) | null;
}

interface RequestSourceBudget {
  bytes: number;
  rangeValidationChars: number;
  sourceSnapshotCalls: number;
  signal?: AbortSignal;
  readonly snapshots: WeakSet<object>;
  readonly releases: Array<() => void>;
}

const SOURCE_VIEWS = new WeakMap<object, SourceView>();
const MAX_VALIDATED_SOURCE_BYTES = 16 * 1024 * 1024;
/** Per-request ceiling on synchronously rescanned UTF-16 source characters. */
const MAX_RANGE_VALIDATION_CHARS = 16 * 1024 * 1024;
const MAX_SOURCE_SNAPSHOT_CALLS = 512;
const MAX_LSP_READ_REQUEST_MS = 25_000;
const MAX_LSP_UINTEGER = 2_147_483_647;
const MAX_REFERENCE_RESULTS = 500;
const MAX_INITIALIZE_WORKSPACE_FOLDERS = 64;

export function createDaemonLspReader(
  root: string,
  client: DaemonReadClient,
  onUnavailable?: () => void,
  detachOnAbort = false,
): LspRepositoryReader {
  const read = async <T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> => {
    try { return await operation; }
    catch {
      if (signal?.aborted) throw new Error('LSP request aborted');
      onUnavailable?.();
      throw new LspDaemonUnavailableError();
    }
  };
  return {
    root,
    sourceSnapshot: (filePath, signal) => read(
      readLspSourceSnapshot(client, filePath, signal, detachOnAbort),
      signal,
    ),
    positionContext: (filePath, line, signal) => read(
      readLspPositionContext(client, filePath, line, signal, detachOnAbort),
      signal,
    ),
    documentContext: (filePath, signal) => read(
      readLspDocumentContext(client, filePath, signal, detachOnAbort),
      signal,
    ),
    incoming: (nodeId, filePath, snapshotToken, signal) => read(
      readLspIncoming(client, nodeId, filePath, snapshotToken, signal, detachOnAbort),
      signal,
    ),
    nodeLocation: (nodeId, signal) => read(
      readLspNodeLocation(client, nodeId, signal, detachOnAbort),
      signal,
    ),
    workspaceSymbols: (query, signal) => read(
      readLspWorkspaceSymbols(client, query, signal, detachOnAbort),
      signal,
    ),
  };
}

export class LspFacade {
  private readonly boundRoot: string;
  private state: LspLifecycleState = LSP_LIFECYCLE_STATE.Created;
  private exitCode: 0 | 1 | null = null;

  constructor(
    private readonly reader: LspRepositoryReader,
    private readonly validatedSourceBudget?: LspValidatedSourceBudget,
  ) {
    this.boundRoot = safeRealpath(reader.root);
  }

  get lifecycleState(): LspLifecycleState {
    return this.state;
  }

  get requestedExitCode(): 0 | 1 | null {
    return this.exitCode;
  }

  /** Projects lifecycle state in wire order without mutating the live handler state. */
  admissionLifecycleStateAfter(
    state: LspLifecycleState,
    message: JsonRpcMessage,
  ): LspLifecycleState {
    if (state === LSP_LIFECYCLE_STATE.Terminated) return state;
    const isRequest = 'id' in message;
    if (message.method === LSP_METHOD.Exit && !isRequest) return LSP_LIFECYCLE_STATE.Terminated;
    if (state === LSP_LIFECYCLE_STATE.Created
      && message.method === LSP_METHOD.Initialize
      && isRequest
      && this.validInitializeParams(message.params)) {
      return LSP_LIFECYCLE_STATE.Initialized;
    }
    if (state === LSP_LIFECYCLE_STATE.Initialized
      && message.method === LSP_METHOD.Shutdown
      && isRequest) {
      return LSP_LIFECYCLE_STATE.Shutdown;
    }
    return state;
  }

  async handle(
    message: JsonRpcMessage,
    signal?: AbortSignal,
    admittedLifecycleState?: LspLifecycleState,
  ): Promise<JsonRpcResponse | null> {
    if (this.state === LSP_LIFECYCLE_STATE.Terminated) return null;
    const requestId = 'id' in message ? message.id : null;
    const isRequest = requestId !== null;
    const isLifecycleTransition = (message.method === LSP_METHOD.Initialize && isRequest)
      || (message.method === LSP_METHOD.Shutdown && isRequest)
      || (message.method === LSP_METHOD.Exit && !isRequest);
    const lifecycleState = isLifecycleTransition
      ? this.state
      : (this.state === LSP_LIFECYCLE_STATE.Created
        ? this.state
        : (admittedLifecycleState ?? this.state));

    if (message.method === LSP_METHOD.Exit && !isRequest) {
      this.exitCode = this.state === LSP_LIFECYCLE_STATE.Shutdown ? 0 : 1;
      this.state = LSP_LIFECYCLE_STATE.Terminated;
      return null;
    }

    if (lifecycleState === LSP_LIFECYCLE_STATE.Created) {
      if (message.method !== LSP_METHOD.Initialize || !isRequest) {
        return isRequest ? this.error(requestId, LSP_ERROR_CODE.ServerNotInitialized) : null;
      }
      if (!this.validInitializeParams(message.params)) {
        return this.error(requestId, LSP_ERROR_CODE.InvalidParams);
      }
      this.state = LSP_LIFECYCLE_STATE.Initialized;
      return this.result(requestId, {
        capabilities: LSP_SERVER_CAPABILITIES,
        serverInfo: { name: 'CodeGraph', version: '1' },
      });
    }

    if (lifecycleState === LSP_LIFECYCLE_STATE.Shutdown) {
      return isRequest ? this.error(requestId, LSP_ERROR_CODE.InvalidRequest) : null;
    }

    if (message.method === LSP_METHOD.Initialize) {
      return isRequest ? this.error(requestId, LSP_ERROR_CODE.InvalidRequest) : null;
    }
    if (message.method === LSP_METHOD.Initialized) {
      return isRequest ? this.error(requestId, LSP_ERROR_CODE.MethodNotFound) : null;
    }
    if (message.method === LSP_METHOD.Exit) {
      return isRequest ? this.error(requestId, LSP_ERROR_CODE.MethodNotFound) : null;
    }
    if (message.method === LSP_METHOD.Shutdown) {
      if (!isRequest) return null;
      this.state = LSP_LIFECYCLE_STATE.Shutdown;
      return this.result(requestId, null);
    }
    if (!isRequest) return null;

    const requestController = new AbortController();
    let deadlineExpired = false;
    const onCallerAbort = (): void => requestController.abort();
    if (signal?.aborted) onCallerAbort();
    else signal?.addEventListener('abort', onCallerAbort, { once: true });
    const deadlineTimer = setTimeout(() => {
      deadlineExpired = true;
      requestController.abort();
    }, MAX_LSP_READ_REQUEST_MS);
    deadlineTimer.unref?.();

    const sourceBudget: RequestSourceBudget = {
      bytes: 0,
      rangeValidationChars: 0,
      sourceSnapshotCalls: 0,
      signal: requestController.signal,
      snapshots: new WeakSet(),
      releases: [],
    };
    try {
      switch (message.method) {
        case LSP_METHOD.Definition:
          return this.result(requestId, await this.definition(message.params, sourceBudget));
        case LSP_METHOD.References:
          return this.result(requestId, await this.references(message.params, sourceBudget));
        case LSP_METHOD.Hover:
          return this.result(requestId, await this.hover(message.params, sourceBudget));
        case LSP_METHOD.DocumentSymbol:
          return this.result(requestId, await this.documentSymbols(message.params, sourceBudget));
        case LSP_METHOD.WorkspaceSymbol:
          return this.result(requestId, await this.workspaceSymbols(message.params, sourceBudget));
        case LSP_METHOD.TextDocumentContent:
          return this.result(requestId, await this.textDocumentContent(message.params, sourceBudget));
        default:
          return this.error(requestId, LSP_ERROR_CODE.MethodNotFound);
      }
    } catch (error) {
      if (error instanceof LspDaemonUnavailableError) throw error;
      if (error instanceof FacadeError) return this.error(requestId, error.code, error.reason);
      if (deadlineExpired && !signal?.aborted) {
        return this.error(requestId, LSP_ERROR_CODE.RequestFailed, 'timeout');
      }
      return this.error(requestId, LSP_ERROR_CODE.RequestFailed);
    } finally {
      clearTimeout(deadlineTimer);
      signal?.removeEventListener('abort', onCallerAbort);
      for (const release of sourceBudget.releases.reverse()) release();
    }
  }

  private async definition(params: object | undefined, sourceBudget: RequestSourceBudget): Promise<LspLocation | null> {
    const selected = await this.selectTarget(params, sourceBudget);
    if (!selected) return null;
    return this.locationForNode(selected.node, selected.snapshotToken, sourceBudget);
  }

  private async references(params: object | undefined, sourceBudget: RequestSourceBudget): Promise<LspLocation[]> {
    if (!isRecord(params)
      || !isRecord(params.context)
      || typeof params.context.includeDeclaration !== 'boolean') {
      throw new FacadeError(LSP_ERROR_CODE.InvalidParams);
    }
    const includeDeclaration = params.context.includeDeclaration;
    const selected = await this.selectTarget(params, sourceBudget);
    if (!selected) return [];
    const locations: LspLocation[] = [];
    const contexts = new Map<string, LspSourceSnapshotRead>();
    const incoming: LspIncomingRead = await this.reader.incoming(
      selected.node.id,
      selected.node.filePath,
      selected.snapshotToken,
      sourceBudget.signal,
    );
    if (!incoming.ok) throw sourceError(incoming.reason);
    const expectedSnapshots = new Map(
      incoming.sourceSnapshots.map(({ filePath, snapshotToken }) => [filePath, snapshotToken]),
    );
    for (const occurrence of incoming.occurrences) {
      const expectedSnapshot = expectedSnapshots.get(occurrence.sourceFilePath);
      if (!expectedSnapshot) throw sourceError('stale');
      let context = contexts.get(occurrence.sourceFilePath);
      if (!context) {
        const read = await this.sourceSnapshot(occurrence.sourceFilePath, sourceBudget);
        if (!read.ok) {
          throw referenceSnapshotError(read.reason);
        }
        this.reserveSource(read, sourceBudget);
        contexts.set(occurrence.sourceFilePath, read);
        context = read;
      }
      if (!context.ok || context.snapshot.snapshotToken !== expectedSnapshot) {
        throw sourceError('stale');
      }
      const location = this.locationForOccurrence(context, occurrence.line, occurrence.column, occurrence.evidence);
      if (location) locations.push(location);
    }
    if (includeDeclaration) {
      const declaration = await this.locationForNode(selected.node, selected.snapshotToken, sourceBudget);
      if (declaration) locations.push(declaration);
    }
    return sortAndCapLocations(locations, MAX_REFERENCE_RESULTS);
  }

  private async hover(params: object | undefined, sourceBudget: RequestSourceBudget): Promise<unknown | null> {
    const selected = await this.selectTarget(params, sourceBudget);
    if (!selected) return null;
    const node = selected.node;
    const lines = [
      node.signature ? `\`${bounded(node.signature, 2_000)}\`` : undefined,
      `**${node.kind}** \`${bounded(node.qualifiedName, 1_000)}\``,
      node.docstring ? bounded(node.docstring, 4_000) : undefined,
    ].filter((line): line is string => line !== undefined);
    return { contents: { kind: 'markdown', value: lines.join('\n\n') } };
  }

  private async documentSymbols(params: object | undefined, sourceBudget: RequestSourceBudget): Promise<unknown[]> {
    const uri = textDocumentUri(params);
    const filePath = this.relativeFilePath(uri);
    const read = await this.reader.documentContext(filePath, sourceBudget.signal);
    if (!read.ok) throw sourceError(read.reason);
    this.reserveSource(read, sourceBudget);

    const byId = new Map<string, LspDocumentSymbol>();
    const nodes = [...read.nodes].sort(compareNodes);
    for (const node of nodes) {
      if (node.kind === 'file') continue;
      const range = fullRangeForNode(read, node, sourceBudget);
      if (!range) continue;
      const selectionRange = this.rangeForNode(read, node, sourceBudget, range) ?? range;
      byId.set(node.id, {
        name: node.name,
        ...(node.signature ? { detail: bounded(node.signature, 2_000) } : {}),
        kind: symbolKind(node.kind),
        range,
        selectionRange,
      });
    }
    const childIds = new Set<string>();
    const parentByChild = new Map<string, string>();
    for (const edge of read.containment) {
      const parent = byId.get(edge.source);
      const child = byId.get(edge.target);
      if (!parent || !child || parent === child || childIds.has(edge.target)) continue;
      let ancestor: string | undefined = edge.source;
      let closesCycle = false;
      while (ancestor !== undefined) {
        if (ancestor === edge.target) {
          closesCycle = true;
          break;
        }
        ancestor = parentByChild.get(ancestor);
      }
      if (closesCycle) continue;
      (parent.children ??= []).push(child);
      childIds.add(edge.target);
      parentByChild.set(edge.target, edge.source);
    }
    for (const symbol of byId.values()) symbol.children?.sort(compareDocumentSymbols);
    const roots = [...byId.entries()]
      .filter(([id]) => !childIds.has(id))
      .map(([, symbol]) => symbol);
    return capDocumentSymbolForest(roots, 500);
  }

  private async workspaceSymbols(params: object | undefined, sourceBudget: RequestSourceBudget): Promise<unknown[]> {
    if (!isRecord(params) || typeof params.query !== 'string') throw invalidParams();
    if (Buffer.byteLength(params.query, 'utf8') > LSP_WORKSPACE_QUERY_BYTE_CAP) throw invalidParams();
    if (params.nodeId !== undefined) {
      if (params.query.length !== 0 || typeof params.nodeId !== 'string' || params.nodeId.length === 0) {
        throw invalidParams();
      }
      const symbol = await this.workspaceSymbolByNodeId(params.nodeId, sourceBudget);
      return symbol ? [symbol] : [];
    }
    const nodes = await this.reader.workspaceSymbols(params.query, sourceBudget.signal);
    if (!Array.isArray(nodes)) throw sourceError(nodes.reason);
    const contexts = new Map<string, LspSourceSnapshotRead>();
    const symbols: OrderedWorkspaceSymbol[] = [];
    for (const candidate of nodes) {
      const node = candidate.node;
      if (!Number.isFinite(candidate.searchScore)) continue;
      let context = contexts.get(node.filePath);
      if (!context) {
        const read = await this.sourceSnapshot(node.filePath, sourceBudget);
        if (!read.ok) {
          contexts.set(node.filePath, read);
          continue;
        }
        this.reserveSource(read, sourceBudget);
        contexts.set(node.filePath, read);
        context = read;
      }
      if (!context.ok) continue;
      if (context.snapshot.snapshotToken !== candidate.snapshotToken) continue;
      const range = fullRangeForNode(context, node, sourceBudget);
      if (!range) continue;
      const location = {
        uri: this.uriForFile(node.filePath),
        range,
        snapshotToken: context.snapshot.snapshotToken,
      };
      symbols.push({
        searchScore: candidate.searchScore,
        qualifiedName: node.qualifiedName,
        nodeId: node.id,
        location,
        result: {
          name: node.name,
          kind: symbolKind(node.kind),
          location,
          containerName: containerName(node),
          data: { codegraphNodeId: node.id },
        },
      });
    }
    symbols.sort(compareWorkspaceSymbols);
    const seen = new Set<string>();
    const results: unknown[] = [];
    for (const symbol of symbols) {
      if (seen.has(symbol.nodeId)) continue;
      seen.add(symbol.nodeId);
      results.push(symbol.result);
      if (results.length === 100) break;
    }
    return results;
  }

  private async workspaceSymbolByNodeId(
    nodeId: string,
    sourceBudget: RequestSourceBudget,
  ): Promise<unknown | null> {
    const candidate = await this.reader.nodeLocation(nodeId, sourceBudget.signal);
    if (!candidate.ok) {
      if (candidate.reason === 'not_found' || candidate.reason === 'unindexed') return null;
      throw sourceError(candidate.reason);
    }
    const source = await this.sourceSnapshot(candidate.node.filePath, sourceBudget);
    if (!source.ok) throw referenceSnapshotError(source.reason);
    this.reserveSource(source, sourceBudget);
    if (source.snapshot.snapshotToken !== candidate.snapshotToken) throw sourceError('stale');
    const range = this.rangeForNode(source, candidate.node, sourceBudget);
    if (!range) return null;
    return {
      name: candidate.node.name,
      kind: symbolKind(candidate.node.kind),
      location: {
        uri: this.uriForFile(candidate.node.filePath),
        range,
        snapshotToken: source.snapshot.snapshotToken,
      },
      containerName: containerName(candidate.node),
      data: { codegraphNodeId: candidate.node.id },
    };
  }

  private async textDocumentContent(params: object | undefined, sourceBudget: RequestSourceBudget): Promise<unknown> {
    const filePath = this.relativeFilePath(textDocumentUri(params));
    const read = await this.sourceSnapshot(filePath, sourceBudget);
    if (!read.ok) throw sourceError(read.reason);
    const text = this.reserveSource(read, sourceBudget, false) ?? read.snapshot.text;
    const { languageId, contentHash, snapshotToken } = read.snapshot;
    return { text, languageId, contentHash, snapshotToken };
  }

  private async selectTarget(params: object | undefined, sourceBudget: RequestSourceBudget): Promise<SelectedTarget | null> {
    const parsed = textDocumentPosition(params);
    const filePath = this.relativeFilePath(parsed.textDocument.uri);
    const read = await this.reader.positionContext(filePath, parsed.position.line + 1, sourceBudget.signal);
    if (!read.ok) throw sourceError(read.reason);
    this.reserveSource(read, sourceBudget);
    if (parsed.snapshotToken !== undefined && read.snapshot.snapshotToken !== parsed.snapshotToken) {
      throw sourceError('stale');
    }
    const lineText = sourceViewFor(read).lines[parsed.position.line];
    if (lineText === undefined) throw invalidParams();
    const character = clampUtf16Character(lineText, parsed.position.character);
    const exactCandidates = new Map<string, { node: LspNode; snapshotToken: string }>();
    const targets = new Map(read.targets.map((node) => [node.id, node]));
    const targetSnapshots = new Map(read.targetSnapshots.map((entry) => [entry.nodeId, entry.snapshotToken]));

    for (const node of read.nodes) {
      const exactRange = this.rangeForNode(read, node, sourceBudget);
      if (exactRange) {
        if (containsPosition(exactRange, { line: parsed.position.line, character })) {
          exactCandidates.set(node.id, { node, snapshotToken: read.snapshot.snapshotToken });
        }
      }
    }
    for (const occurrence of read.occurrences) {
      const target = targets.get(occurrence.targetId);
      if (!target) continue;
      const range = occurrenceRange(read, occurrence.line, occurrence.column, occurrence.evidence);
      if (range && containsPosition(range, { line: parsed.position.line, character })) {
        const snapshotToken = targetSnapshots.get(target.id);
        if (!snapshotToken) continue;
        exactCandidates.set(target.id, { node: target, snapshotToken });
      }
    }
    if (exactCandidates.size === 1) return { ...exactCandidates.values().next().value!, context: read };
    return null;
  }

  private async locationForNode(
    node: LspNode,
    expectedSnapshotToken: string | undefined,
    sourceBudget: RequestSourceBudget,
  ): Promise<LspLocation | null> {
    const read = await this.sourceSnapshot(node.filePath, sourceBudget);
    if (!read.ok) {
      throw referenceSnapshotError(read.reason);
    }
    this.reserveSource(read, sourceBudget);
    if (expectedSnapshotToken !== undefined && read.snapshot.snapshotToken !== expectedSnapshotToken) {
      throw sourceError('stale');
    }
    const range = this.rangeForNode(read, node, sourceBudget);
    return range ? {
      uri: this.uriForFile(node.filePath),
      range,
      snapshotToken: read.snapshot.snapshotToken,
    } : null;
  }

  private reserveSource(
    read: Extract<LspSourceSnapshotRead, { ok: true }>,
    sourceBudget: RequestSourceBudget,
    prepareView = true,
  ): string | undefined {
    if (sourceBudget.snapshots.has(read.snapshot)) return undefined;
    const text = read.snapshot.text;
    const bytes = Buffer.byteLength(text, 'utf8');
    if (sourceBudget.bytes + bytes > MAX_VALIDATED_SOURCE_BYTES) throw sourceError('too_large');
    const release = this.validatedSourceBudget?.reserve(bytes);
    if (this.validatedSourceBudget && !release) throw sourceError('too_large');
    sourceBudget.bytes += bytes;
    sourceBudget.snapshots.add(read.snapshot);
    if (release) sourceBudget.releases.push(release);
    if (prepareView) sourceViewFor(read, text);
    return text;
  }

  private sourceSnapshot(
    filePath: string,
    sourceBudget: RequestSourceBudget,
  ): Promise<LspSourceSnapshotRead> {
    if (sourceBudget.sourceSnapshotCalls >= MAX_SOURCE_SNAPSHOT_CALLS) {
      throw sourceError('too_large');
    }
    sourceBudget.sourceSnapshotCalls += 1;
    return this.reader.sourceSnapshot(filePath, sourceBudget.signal);
  }

  private locationForOccurrence(
    context: Extract<LspSourceSnapshotRead, { ok: true }>,
    line: number | undefined,
    column: number | undefined,
    evidence: string,
  ): LspLocation | null {
    const range = occurrenceRange(context, line, column, evidence);
    return range ? {
      uri: this.uriForFile(context.snapshot.filePath),
      range,
      snapshotToken: context.snapshot.snapshotToken,
    } : null;
  }

  private rangeForNode(
    context: Extract<LspSourceSnapshotRead, { ok: true }>,
    node: LspNode,
    sourceBudget: RequestSourceBudget,
    knownDeclaration?: LspRange,
  ): LspRange | null {
    const line = node.startLine - 1;
    const text = sourceViewFor(context).lines[line];
    if (text === undefined) return null;
    const span = exactUtf16Range(context, line, node.startColumn, node.name);
    if (span) return { start: { line, character: span.start }, end: { line, character: span.end } };

    const declaration = knownDeclaration ?? fullRangeForNode(context, node, sourceBudget);
    return declaration ? uniqueNameRange(context, node.name, declaration, sourceBudget) : null;
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
      throw sourceError('outside_repository');
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
      if (params.workspaceFolders.length > MAX_INITIALIZE_WORKSPACE_FOLDERS) return false;
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

function referenceSnapshotError(reason: LspSourceErrorReason): FacadeError {
  return sourceError(
    reason === 'not_found' || reason === 'unindexed' || reason === 'not_regular' ? 'stale' : reason,
  );
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
    typeof line !== 'number' || !Number.isSafeInteger(line) || line < 0 || line > MAX_LSP_UINTEGER ||
    typeof character !== 'number' || !Number.isSafeInteger(character) || character < 0 || character > MAX_LSP_UINTEGER
  ) {
    throw invalidParams();
  }
  if (params.snapshotToken !== undefined && (typeof params.snapshotToken !== 'string' || params.snapshotToken.length === 0)) {
    throw invalidParams();
  }
  return {
    textDocument: { uri },
    position: { line, character },
    ...(typeof params.snapshotToken === 'string' ? { snapshotToken: params.snapshotToken } : {}),
  };
}

function occurrenceRange(
  context: Extract<LspSourceSnapshotRead, { ok: true }>,
  graphLine: number | undefined,
  graphColumn: number | undefined,
  evidence: string,
): LspRange | null {
  if (graphLine === undefined || graphColumn === undefined || graphLine < 1) return null;
  const line = graphLine - 1;
  const text = sourceViewFor(context).lines[line];
  if (text === undefined) return null;
  const span = exactUtf16Range(context, line, graphColumn, evidence);
  return span ? { start: { line, character: span.start }, end: { line, character: span.end } } : null;
}

function sourceLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

function sourceViewFor(
  context: Extract<LspSourceSnapshotRead, { ok: true }>,
  sourceText?: string,
): SourceView {
  const key = context.snapshot;
  let view = SOURCE_VIEWS.get(key);
  if (!view) {
    const text = sourceText ?? context.snapshot.text;
    view = {
      lines: sourceLines(text),
      byteLength: Buffer.byteLength(text, 'utf8'),
      utf8Columns: new Map(),
    };
    SOURCE_VIEWS.set(key, view);
  }
  return view;
}

function exactUtf16Range(
  context: Extract<LspSourceSnapshotRead, { ok: true }>,
  lineIndex: number,
  graphColumn: number,
  evidence: string,
): { start: number; end: number } | null {
  if (!Number.isSafeInteger(graphColumn) || graphColumn < 0 || evidence.length === 0) return null;
  const line = sourceViewFor(context).lines[lineIndex];
  if (line === undefined) return null;
  const utf16Start = graphColumn <= line.length
    && line.slice(graphColumn, graphColumn + evidence.length) === evidence
    ? graphColumn
    : null;
  const byteStart = utf8ColumnToUtf16(context, lineIndex, graphColumn);
  const verifiedByteStart = byteStart !== null
    && line.slice(byteStart, byteStart + evidence.length) === evidence
    ? byteStart
    : null;

  // Tree-sitter columns are UTF-8 byte offsets. Adjacent punctuation can also
  // make the raw UTF-16 offset look valid, so keep the byte boundary for that
  // syntax-token case while textual mixed-column evidence remains fail-closed.
  if (verifiedByteStart !== null && utf16Start !== null && verifiedByteStart !== utf16Start) {
    if (!isPunctuationOnly(evidence)
      || !areAdjacentOccurrences(verifiedByteStart, utf16Start, evidence.length)) return null;
    return { start: verifiedByteStart, end: verifiedByteStart + evidence.length };
  }
  const start = verifiedByteStart ?? utf16Start;
  return start === null ? null : { start, end: start + evidence.length };
}

function isPunctuationOnly(value: string): boolean {
  return /^[^\p{L}\p{N}_\s]+$/u.test(value);
}

function areAdjacentOccurrences(leftStart: number, rightStart: number, length: number): boolean {
  return Math.abs(leftStart - rightStart) <= length;
}

function containsPosition(range: LspRange, position: LspPosition): boolean {
  return comparePositions(range.start, position) <= 0
    && comparePositions(position, range.end) < 0;
}

function safeRealpath(input: string): string {
  try { return fs.realpathSync(input); } catch { return path.resolve(input); }
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function fullRangeForNode(
  context: Extract<LspSourceSnapshotRead, { ok: true }>,
  node: LspNode,
  sourceBudget: RequestSourceBudget,
): LspRange | null {
  const lines = sourceViewFor(context).lines;
  const startLine = node.startLine - 1;
  const endLine = node.endLine - 1;
  const startText = lines[startLine];
  const endText = lines[endLine];
  if (startText === undefined || endText === undefined || startLine > endLine) return null;

  const candidates = fullRangeCandidates(context, node, startLine, endLine);

  // A node's start/end columns come from one extractor and therefore one
  // encoding. Score only consistently decoded pairs against exact name
  // evidence instead of rejecting a valid byte-oriented range merely because
  // its raw UTF-16 start also happens to be in bounds.
  const scored = candidates.map((candidate) => ({
    ...candidate,
    score: rangeNameEvidenceScore(context, node, candidate.range, sourceBudget),
  }));
  const supported = scored.filter((candidate) => candidate.score > 0);
  if (supported.length === 0) return null;
  if (supported.length === 1) return supported[0]!.range;

  // The position contract makes Tree-sitter's byte boundary authoritative for
  // indistinguishable adjacent punctuation. Textual ties remain fail-closed.
  if (isPunctuationOnly(node.name) && supported.every((candidate) => candidate.score === 2)) {
    const utf8 = supported.find((candidate) => candidate.encodings.has('utf8'));
    if (utf8 && supported.every((candidate) => candidate === utf8
      || rangesStartAtAdjacentOccurrences(utf8.range, candidate.range, node.name.length))) {
      return utf8.range;
    }
  }
  return null;
}

function compareWorkspaceSymbols(left: OrderedWorkspaceSymbol, right: OrderedWorkspaceSymbol): number {
  return right.searchScore - left.searchScore
    || compareSqliteBinaryText(left.qualifiedName, right.qualifiedName)
    || compareLocations(left.location, right.location)
    || compareSqliteBinaryText(left.nodeId, right.nodeId);
}

function rangesStartAtAdjacentOccurrences(left: LspRange, right: LspRange, length: number): boolean {
  return left.start.line === right.start.line
    && areAdjacentOccurrences(left.start.character, right.start.character, length);
}

type GraphColumnEncoding = 'utf8' | 'utf16';

function fullRangeCandidates(
  context: Extract<LspSourceSnapshotRead, { ok: true }>,
  node: LspNode,
  startLine: number,
  endLine: number,
): Array<{ range: LspRange; encodings: Set<GraphColumnEncoding> }> {
  const candidates = new Map<string, { range: LspRange; encodings: Set<GraphColumnEncoding> }>();
  for (const encoding of ['utf8', 'utf16'] as const) {
    const start = graphColumnForEncoding(context, startLine, node.startColumn, encoding);
    const end = graphColumnForEncoding(context, endLine, node.endColumn, encoding);
    if (start === null || end === null) continue;
    const range: LspRange = {
      start: { line: startLine, character: start },
      end: { line: endLine, character: end },
    };
    if (comparePositions(range.start, range.end) > 0) continue;
    const key = `${startLine}:${start}:${endLine}:${end}`;
    const existing = candidates.get(key);
    if (existing) existing.encodings.add(encoding);
    else candidates.set(key, { range, encodings: new Set([encoding]) });
  }
  return [...candidates.values()];
}

function graphColumnForEncoding(
  context: Extract<LspSourceSnapshotRead, { ok: true }>,
  lineIndex: number,
  graphColumn: number,
  encoding: GraphColumnEncoding,
): number | null {
  if (!Number.isSafeInteger(graphColumn) || graphColumn < 0) return null;
  if (encoding === 'utf8') return utf8ColumnToUtf16(context, lineIndex, graphColumn);
  const line = sourceViewFor(context).lines[lineIndex];
  return line !== undefined && graphColumn <= line.length && !splitsSurrogatePair(line, graphColumn)
    ? graphColumn
    : null;
}

function rangeNameEvidenceScore(
  context: Extract<LspSourceSnapshotRead, { ok: true }>,
  node: LspNode,
  range: LspRange,
  sourceBudget: RequestSourceBudget,
): 0 | 1 | 2 {
  const text = sourceViewFor(context).lines[range.start.line];
  if (text === undefined || node.name.length === 0) return 0;
  const searchEnd = range.end.line === range.start.line ? range.end.character : text.length;
  if (range.start.character + node.name.length <= searchEnd
    && text.slice(range.start.character, range.start.character + node.name.length) === node.name) return 2;
  return uniqueNameRange(context, node.name, range, sourceBudget) === null ? 0 : 1;
}

function uniqueNameRange(
  context: Extract<LspSourceSnapshotRead, { ok: true }>,
  name: string,
  range: LspRange,
  sourceBudget: RequestSourceBudget,
): LspRange | null {
  if (name.length === 0) return null;
  const lines = sourceViewFor(context).lines;
  const identifierLike = isIdentifierLike(name);
  let match: LspRange | null = null;
  for (let line = range.start.line; line <= range.end.line; line += 1) {
    const text = lines[line];
    if (text === undefined) return null;
    const start = line === range.start.line ? range.start.character : 0;
    const end = line === range.end.line ? range.end.character : text.length;
    if (start < 0 || end < start || end > text.length) return null;
    reserveRangeValidationWork(sourceBudget, end - start);
    let index = text.indexOf(name, start);
    while (index >= start && index + name.length <= end) {
      const matchEnd = index + name.length;
      if (!identifierLike || hasIdentifierBoundaries(text, index, matchEnd)) {
        if (match) return null;
        match = {
          start: { line, character: index },
          end: { line, character: matchEnd },
        };
      }
      index = text.indexOf(name, index + 1);
    }
  }
  return match;
}

function reserveRangeValidationWork(sourceBudget: RequestSourceBudget, characters: number): void {
  if (!Number.isSafeInteger(characters)
    || characters < 0
    || characters > MAX_RANGE_VALIDATION_CHARS - sourceBudget.rangeValidationChars) {
    throw sourceError('too_large');
  }
  sourceBudget.rangeValidationChars += characters;
}

function isIdentifierLike(value: string): boolean {
  return /^[\p{L}\p{Nl}_$][\p{L}\p{N}\p{M}\p{Pc}\u200C\u200D$]*$/u.test(value);
}

function hasIdentifierBoundaries(value: string, start: number, end: number): boolean {
  const before = value.slice(Math.max(0, start - 2), start);
  const after = value.slice(end, end + 2);
  return !/[\p{L}\p{N}\p{M}\p{Pc}\u200C\u200D$]$/u.test(before)
    && !/^[\p{L}\p{N}\p{M}\p{Pc}\u200C\u200D$]/u.test(after);
}

function utf8ColumnToUtf16(
  context: Extract<LspSourceSnapshotRead, { ok: true }>,
  lineIndex: number,
  graphColumn: number,
): number | null {
  const view = sourceViewFor(context);
  const line = view.lines[lineIndex];
  if (line === undefined) return null;
  let columns = view.utf8Columns.get(lineIndex);
  if (!columns) {
    columns = new Int32Array(Buffer.byteLength(line, 'utf8') + 1);
    columns.fill(-1);
    columns[0] = 0;
    let byteOffset = 0;
    let utf16Offset = 0;
    for (const character of line) {
      byteOffset += Buffer.byteLength(character, 'utf8');
      utf16Offset += character.length;
      columns[byteOffset] = utf16Offset;
    }
    view.utf8Columns.set(lineIndex, columns);
  }
  if (graphColumn >= columns.length) return null;
  const utf16Column = columns[graphColumn]!;
  return utf16Column >= 0 ? utf16Column : null;
}

function splitsSurrogatePair(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) return false;
  const before = value.charCodeAt(offset - 1);
  const after = value.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

function comparePositions(left: LspPosition, right: LspPosition): number {
  return left.line - right.line || left.character - right.character;
}

function compareNodes(left: LspNode, right: LspNode): number {
  return left.startLine - right.startLine
    || left.startColumn - right.startColumn
    || left.endLine - right.endLine
    || left.endColumn - right.endColumn
    || (left.qualifiedName < right.qualifiedName ? -1 : left.qualifiedName > right.qualifiedName ? 1 : 0);
}

function compareDocumentSymbols(left: { range: LspRange; name: string }, right: { range: LspRange; name: string }): number {
  return left.range.start.line - right.range.start.line
    || left.range.start.character - right.range.start.character
    || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

function capDocumentSymbolForest(roots: LspDocumentSymbol[], cap: number): LspDocumentSymbol[] {
  let remaining = cap;
  const take = (symbol: LspDocumentSymbol): LspDocumentSymbol | null => {
    if (remaining <= 0) return null;
    remaining -= 1;
    const children: LspDocumentSymbol[] = [];
    for (const child of symbol.children ?? []) {
      const selected = take(child);
      if (!selected) break;
      children.push(selected);
    }
    const { children: _children, ...rest } = symbol;
    return { ...rest, ...(children.length > 0 ? { children } : {}) };
  };
  const selected: LspDocumentSymbol[] = [];
  for (const root of roots) {
    const symbol = take(root);
    if (!symbol) break;
    selected.push(symbol);
  }
  return selected;
}

function containerName(node: LspNode): string | undefined {
  const separator = node.qualifiedName.lastIndexOf('.');
  return separator > 0 ? node.qualifiedName.slice(0, separator) : undefined;
}

function symbolKind(kind: NodeKind): number {
  switch (kind) {
    case 'file': return 1;
    case 'module': return 2;
    case 'namespace': return 3;
    case 'class': case 'component': return 5;
    case 'method': return 6;
    case 'property': return 7;
    case 'field': return 8;
    case 'function': case 'route': return 12;
    case 'variable': case 'parameter': return 13;
    case 'constant': return 14;
    case 'enum': return 10;
    case 'enum_member': return 22;
    case 'struct': return 23;
    case 'interface': case 'trait': case 'protocol': return 11;
    case 'type_alias': return 26;
    default: return 13;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
