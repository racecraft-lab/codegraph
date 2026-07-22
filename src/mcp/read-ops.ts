/**
 * SPEC-005 structured read ops — the daemon side of the additive `codegraph/read`
 * JSON-RPC method (FR-002/004/008).
 *
 * The web serve process is a daemon *client* and MUST NOT open a second
 * in-process index copy for reads (FR-002); the existing daemon socket only
 * carried `tools/call`, whose markdown output has no node ids / structured edges
 * (so it can't produce the REST wire shapes). This module is the ratified,
 * additive read-only path: one dispatcher, discriminated by `op`, that runs the
 * existing library read methods against the daemon's warm `CodeGraph` and returns
 * their STRUCTURED results (library `Node`/`Edge`, Subgraph maps flattened to
 * arrays) for the client to map to the wire shape. Read-only — it never indexes
 * (FR-021 holds); an unknown op is a JSON-RPC error.
 *
 * @module mcp/read-ops
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type CodeGraph from '../index';
import type { Node, Edge, FileRecord, SearchMode } from '../types';
import type { LspNodeSummary } from '../db/queries';
import { normalizeLspUri } from '../lsp/protocol';
import { resolveAutoMode } from '../search/hybrid';

/** An unrecognized `op` — surfaced as a JSON-RPC InvalidParams by the session. */
export class UnknownReadOpError extends Error {}

/**
 * The closed `codegraph/read` op vocabulary (FR-002/004/008). Shared by the
 * daemon-side dispatcher and the daemon-client's `read()` so the op set is
 * declared once instead of as a bare string in three places. Compile-time only —
 * the session wire dispatch still receives arbitrary JSON-RPC input and the
 * `default` case below rejects an unknown op at runtime.
 */
export type ReadOp =
  | 'status'
  | 'search'
  | 'node'
  | 'callers'
  | 'callees'
  | 'impact'
  | 'neighborhood'
  | 'listFlows'
  | 'getFlow'
  | 'listClusters'
  | 'lspFileContext'
  | 'lspIncoming'
  | 'lspWorkspaceSymbols';

export type LspSourceErrorReason =
  | 'not_found'
  | 'outside_repository'
  | 'unindexed'
  | 'not_regular'
  | 'too_large'
  | 'unreadable'
  | 'stale';

export interface LspSourceSnapshot {
  filePath: string;
  text: string;
  languageId: string;
  contentHash: string;
  snapshotToken: string;
}

export interface LspLocatedEdge {
  edge: Edge;
  source: Node;
  target: Node;
}

export type LspFileContextRead =
  | { ok: true; snapshot: LspSourceSnapshot; nodes: Node[]; occurrences: LspLocatedEdge[]; containment: Edge[] }
  | { ok: false; reason: LspSourceErrorReason };

export type LspIncomingRead =
  | { target: Node | null; occurrences: LspLocatedEdge[] }
  | { ok: false; reason: Extract<LspSourceErrorReason, 'too_large' | 'stale'> };

const LSP_SOURCE_BYTE_CAP = 1024 * 1024;
const LSP_WORKSPACE_CANDIDATE_CAP = 500;
const LSP_REFERENCE_CAP = 500;
const LSP_REFERENCE_SCAN_CAP = 5_000;
const LSP_FILE_NODE_CAP = 5_000;
const LSP_FILE_EDGE_CAP = 10_000;
const LSP_DAEMON_RESPONSE_BYTE_CAP = 7 * 1024 * 1024;

/**
 * Bounded scan ceiling used to compute a search `total` (FR-006). Matches the
 * max page size — a local-index convenience surface bounds the reported total at
 * the same 500 the client can page through, keeping every search a single fast
 * capped query.
 */
const SEARCH_SCAN_CEILING = 500;

/** Hard node cap on a subgraph response; `truncated` flags a hit (FR-007). */
const SUBGRAPH_NODE_CAP = 2000;

// Defensive re-clamp at the daemon read boundary. The HTTP routes already clamp
// `limit`/`depth` (routes.ts MAX_LIMIT=500 / MAX_DEPTH=3), but `codegraph/read`
// is directly callable, so mirror the caps here — clamp, never error (matches
// the HTTP layer's clamp-not-error contract).
const MAX_LIMIT = 500;
const MAX_DEPTH = 3;

/**
 * Coerce a SPEC-011 catalog paging param at the daemon read boundary (FR-027/029):
 * a finite value is floored then clamped to [min,max]; missing/non-numeric → `def`.
 * Floor + clamp, never an error — the same coercion the MCP tool applies
 * (`coerceCatalogInt`+`clamp`), so a directly dispatched `codegraph/read` degrades a
 * bad page param exactly as the HTTP route does (both default 100 / cap 500 here).
 * An explicit `limit=0` clamps to `min` (1) — NOT the default — and a non-integer
 * (`1.5`) floors, unlike the earlier `Number(x)||default`.
 */
function coerceCatalogInt(raw: unknown, def: number, min: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** `codegraph/read` request payload: an op discriminator + its params. */
export interface ReadRequest {
  op: string;
  params?: Record<string, unknown>;
}

/**
 * Run one structured read op against the daemon's open `CodeGraph`. Returns a
 * JSON-serializable result the daemon-client maps to the wire shape. Throws
 * {@link UnknownReadOpError} for an unrecognized op.
 */
export async function executeReadOp(
  cg: CodeGraph,
  op: ReadOp,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (op) {
    case 'status':
      return statusOp(cg);
    case 'search':
      return await searchOp(cg, params);
    case 'node':
      return { node: cg.getNode(idParam(params)) };
    case 'callers':
      return relationOp(cg, params, 'callers');
    case 'callees':
      return relationOp(cg, params, 'callees');
    case 'impact':
      return subgraphOp(cg, params, 'impact');
    case 'neighborhood':
      return subgraphOp(cg, params, 'neighborhood');
    case 'listFlows':
      return flowListOp(cg, params);
    case 'getFlow':
      return cg.getFlowById(idParam(params));
    case 'listClusters':
      return clusterListOp(cg, params);
    case 'lspFileContext':
      return lspFileContextOp(cg, params);
    case 'lspIncoming':
      return lspIncomingOp(cg, params);
    case 'lspWorkspaceSymbols':
      return lspWorkspaceSymbolsOp(cg, params);
    default:
      throw new UnknownReadOpError(`unknown read op: ${op}`);
  }
}

/**
 * SPEC-011 — the paged flow catalog (FR-027/030). Coerces `limit`/`offset`
 * defensively at the daemon boundary (floor + clamp, never an error) so a directly
 * dispatched `codegraph/read` matches the HTTP route and MCP tool; the
 * catalog-store read attaches the read-time state.
 */
function flowListOp(cg: CodeGraph, params: Record<string, unknown>): unknown {
  const limit = coerceCatalogInt(params.limit, 100, 1, MAX_LIMIT);
  const offset = coerceCatalogInt(params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  return cg.listFlows(limit, offset);
}

/**
 * SPEC-011 — the paged cluster catalog (FR-027/029/030). Coerces
 * `limit`/`offset`/`minSize` defensively at the daemon boundary (floor + clamp,
 * never an error); `minSize` defaults to 1 and clamps below-1 to 1 (FR-029).
 */
function clusterListOp(cg: CodeGraph, params: Record<string, unknown>): unknown {
  const limit = coerceCatalogInt(params.limit, 100, 1, MAX_LIMIT);
  const offset = coerceCatalogInt(params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const minSize = coerceCatalogInt(params.minSize, 1, 1, Number.MAX_SAFE_INTEGER);
  return cg.listClusters(minSize, limit, offset);
}

/**
 * Op-appropriate empty result for a daemon whose default project failed to open
 * (defensive — the web server only attaches to indexed roots, so `cg` is
 * normally non-null; the un-indexed *startup* status is synthesized server-side).
 */
export function readOnMissingIndex(op: ReadOp, params: Record<string, unknown> = {}): unknown {
  switch (op) {
    case 'status':
      return {
        index: { state: 'unindexed', fileCount: 0, nodeCount: 0, edgeCount: 0, lastIndexed: null },
        hybridSearch: { available: false, reason: 'index not available' },
        lsp: { available: false },
      };
    case 'node':
      return { node: null };
    case 'search':
      return { items: [], total: 0, degraded: false, degradationReason: null };
    case 'callers':
    case 'callees':
    case 'impact':
    case 'neighborhood':
      return { found: false };
    case 'listFlows':
    case 'listClusters': {
      // Echo the request's EFFECTIVE (coerced) page so a directly dispatched
      // codegraph/read gets a consistent envelope — not a fixed limit 0 (which a
      // client would misread as an explicit empty page) nor a fixed 100 that
      // ignores the caller's paging. Same coercion as flowListOp/clusterListOp.
      const limit = coerceCatalogInt(params.limit, 100, 1, MAX_LIMIT);
      const offset = coerceCatalogInt(params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      return { items: [], total: 0, limit, offset, sourceVersion: 0, state: 'not_indexed' };
    }
    case 'getFlow':
      return { found: false, state: 'not_indexed' };
    case 'lspFileContext':
      return { ok: false, reason: 'unindexed' } satisfies LspFileContextRead;
    case 'lspIncoming':
      return { target: null, occurrences: [] } satisfies LspIncomingRead;
    case 'lspWorkspaceSymbols':
      return [];
    default:
      throw new UnknownReadOpError(`unknown read op: ${op}`);
  }
}

function lspWorkspaceSymbolsOp(cg: CodeGraph, params: Record<string, unknown>): Node[] {
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  const ranked: LspRankedWorkspaceSymbol[] = [];
  const seen = new Set<string>();
  for (const candidate of cg.iterateLspWorkspaceSymbolCandidates(query)) {
    if (seen.has(candidate.node.id)) continue;
    seen.add(candidate.node.id);
    const entry: LspRankedWorkspaceSymbol = {
      ...candidate,
      uri: normalizeLspUri(pathToFileURL(path.resolve(cg.getProjectRoot(), candidate.node.filePath)).href),
    };
    retainLspWorkspaceCandidate(ranked, entry);
  }
  ranked.sort(compareLspRankedWorkspaceSymbols);
  return budgetLspWorkspaceNodes(ranked.map((entry) => entry.node));
}

function lspIncomingOp(cg: CodeGraph, params: Record<string, unknown>): LspIncomingRead {
  return cg.withLspReadTransaction(() => {
    const targetId = idParam(params);
    const targetSummary = cg.getLspNodeSummariesByIds([targetId]).get(targetId);
    if (!targetSummary) return { target: null, occurrences: [] };
    const edges = cg.getBoundedLspIncomingEdges(targetId, LSP_REFERENCE_SCAN_CAP + 1);
    if (edges.length > LSP_REFERENCE_SCAN_CAP) return { ok: false, reason: 'too_large' };
    const sourceSummaries = cg.getLspNodeSummariesByIds(edges.map((edge) => edge.source));
    const candidates: LspOccurrenceCandidate[] = [];
    for (const edge of edges) {
      const source = sourceSummaries.get(edge.source);
      if (!source || edge.line === undefined || edge.column === undefined) {
        return { ok: false, reason: 'stale' };
      }
      candidates.push({ edge, source, target: targetSummary });
    }
    candidates.sort((left, right) => compareLspOccurrences(cg.getProjectRoot(), left, right));
    const unique: LspOccurrenceCandidate[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const key = lspOccurrenceKey(cg.getProjectRoot(), candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(candidate);
      if (unique.length >= LSP_REFERENCE_CAP) break;
    }
    if (!fitsLspIncomingBudget(targetSummary, unique)) return { ok: false, reason: 'too_large' };
    const materialized = cg.getLspNodesByIds([
      targetId,
      ...unique.map((candidate) => candidate.source.id),
    ]);
    const target = materialized.get(targetId);
    if (!target) return { ok: false, reason: 'stale' };
    const occurrences: LspLocatedEdge[] = [];
    for (const candidate of unique) {
      const source = materialized.get(candidate.source.id);
      if (!source) return { ok: false, reason: 'stale' };
      occurrences.push({ edge: candidate.edge, source, target });
    }
    const result: LspIncomingRead = { target, occurrences };
    return fitsLspByteBudget(result) ? result : { ok: false, reason: 'too_large' };
  });
}

function lspFileContextOp(cg: CodeGraph, params: Record<string, unknown>): LspFileContextRead {
  return cg.withLspReadTransaction(() => {
    const requested = typeof params.filePath === 'string' ? params.filePath : '';
    const snapshot = readTrustedSnapshot(cg, requested);
    if (!snapshot.ok) return snapshot;
    const nodeSummaries = cg.getBoundedLspFileNodeSummaries(
      snapshot.snapshot.filePath,
      LSP_FILE_NODE_CAP + 1,
    );
    if (nodeSummaries.length > LSP_FILE_NODE_CAP) return { ok: false, reason: 'too_large' };
    const edges = cg.getBoundedLspFileEdges(snapshot.snapshot.filePath, LSP_FILE_EDGE_CAP + 1);
    if (edges.length > LSP_FILE_EDGE_CAP) return { ok: false, reason: 'too_large' };
    const sourceSummaries = new Map(nodeSummaries.map((node) => [node.id, node]));
    const targetSummaries = cg.getLspNodeSummariesByIds(
      edges.filter((edge) => edge.kind !== 'contains').map((edge) => edge.target),
    );
    const candidates: LspOccurrenceCandidate[] = [];
    const containment: Edge[] = [];
    for (const edge of edges) {
      if (edge.kind === 'contains') {
        containment.push(edge);
        continue;
      }
      const source = sourceSummaries.get(edge.source);
      const target = targetSummaries.get(edge.target);
      if (!source || !target) return { ok: false, reason: 'stale' };
      candidates.push({ edge, source, target });
    }
    if (!fitsLspFileContextBudget(snapshot.snapshot, nodeSummaries, candidates, containment)) {
      return { ok: false, reason: 'too_large' };
    }
    const materialized = cg.getLspNodesByIds([
      ...nodeSummaries.map((node) => node.id),
      ...targetSummaries.keys(),
    ]);
    const nodes: Node[] = [];
    for (const summary of nodeSummaries) {
      const node = materialized.get(summary.id);
      if (!node) return { ok: false, reason: 'stale' };
      nodes.push(node);
    }
    const occurrences: LspLocatedEdge[] = [];
    for (const candidate of candidates) {
      const source = materialized.get(candidate.source.id);
      const target = materialized.get(candidate.target.id);
      if (!source || !target) return { ok: false, reason: 'stale' };
      occurrences.push({ edge: candidate.edge, source, target });
    }
    const finalIndexed = cg.getFile(snapshot.snapshot.filePath);
    if (!finalIndexed || indexedSnapshotToken(finalIndexed) !== snapshot.snapshot.snapshotToken) {
      return { ok: false, reason: 'stale' };
    }
    const result: LspFileContextRead = {
      ok: true,
      snapshot: snapshot.snapshot,
      nodes,
      occurrences,
      containment,
    };
    return fitsLspByteBudget(result) ? result : { ok: false, reason: 'too_large' };
  });
}

interface LspOccurrenceCandidate {
  edge: Edge;
  source: LspNodeSummary;
  target: LspNodeSummary;
}

type LspOccurrenceOrderable = Pick<LspOccurrenceCandidate, 'edge'> & {
  source: Pick<LspNodeSummary, 'id' | 'filePath'>;
};

function lspOccurrenceKey(root: string, occurrence: LspOccurrenceOrderable): string {
  const uri = lspOccurrenceUri(root, occurrence);
  return `${uri}\0${occurrence.edge.line}\0${occurrence.edge.column}`;
}

function compareLspOccurrences(root: string, left: LspOccurrenceOrderable, right: LspOccurrenceOrderable): number {
  const leftUri = lspOccurrenceUri(root, left);
  const rightUri = lspOccurrenceUri(root, right);
  return (leftUri < rightUri ? -1 : leftUri > rightUri ? 1 : 0)
    || left.edge.line! - right.edge.line!
    || left.edge.column! - right.edge.column!
    || (left.source.id < right.source.id ? -1 : left.source.id > right.source.id ? 1 : 0)
    || (left.edge.kind < right.edge.kind ? -1 : left.edge.kind > right.edge.kind ? 1 : 0);
}

function lspOccurrenceUri(root: string, occurrence: LspOccurrenceOrderable): string {
  return normalizeLspUri(pathToFileURL(path.resolve(root, occurrence.source.filePath)).href);
}

interface LspRankedWorkspaceSymbol {
  node: Node;
  score: number;
  uri: string;
}

function compareLspRankedWorkspaceSymbols(
  left: LspRankedWorkspaceSymbol,
  right: LspRankedWorkspaceSymbol,
): number {
  return right.score - left.score
    || (left.node.qualifiedName < right.node.qualifiedName
      ? -1
      : left.node.qualifiedName > right.node.qualifiedName ? 1 : 0)
    || (left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0)
    || left.node.startLine - right.node.startLine
    || left.node.startColumn - right.node.startColumn
    || left.node.endLine - right.node.endLine
    || left.node.endColumn - right.node.endColumn
    || (left.node.id < right.node.id ? -1 : left.node.id > right.node.id ? 1 : 0);
}

function retainLspWorkspaceCandidate(
  heap: LspRankedWorkspaceSymbol[],
  candidate: LspRankedWorkspaceSymbol,
): void {
  if (heap.length < LSP_WORKSPACE_CANDIDATE_CAP) {
    heap.push(candidate);
    for (let index = heap.length - 1; index > 0;) {
      const parent = (index - 1) >>> 1;
      if (compareLspRankedWorkspaceSymbols(heap[index]!, heap[parent]!) <= 0) break;
      [heap[index], heap[parent]] = [heap[parent]!, heap[index]!];
      index = parent;
    }
    return;
  }
  if (compareLspRankedWorkspaceSymbols(candidate, heap[0]!) >= 0) return;
  heap[0] = candidate;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    let worse = left;
    if (right < heap.length
      && compareLspRankedWorkspaceSymbols(heap[right]!, heap[left]!) > 0) {
      worse = right;
    }
    if (compareLspRankedWorkspaceSymbols(heap[worse]!, heap[index]!) <= 0) break;
    [heap[index], heap[worse]] = [heap[worse]!, heap[index]!];
    index = worse;
  }
}

function budgetLspWorkspaceNodes(nodes: Node[]): Node[] {
  const output: Node[] = [];
  let remaining = LSP_DAEMON_RESPONSE_BYTE_CAP - 512;
  for (const node of nodes) {
    const bytes = boundedJsonByteLength(node, remaining);
    if (bytes + 1 > remaining) break;
    output.push(node);
    remaining -= bytes + 1;
  }
  return output;
}

function boundedJsonByteLength(value: unknown, limit: number): number {
  const ancestors = new Set<object>();

  const visit = (current: unknown, remaining: number, arrayValue = false): number => {
    if (remaining < 0) return limit + 1;
    if (current === null) return 4;
    if (current === undefined || typeof current === 'function' || typeof current === 'symbol') {
      return arrayValue ? 4 : 0;
    }
    if (typeof current === 'string') return jsonStringByteLength(current, remaining);
    if (typeof current === 'boolean') return current ? 4 : 5;
    if (typeof current === 'number') {
      return Number.isFinite(current) ? Buffer.byteLength(String(current), 'utf8') : 4;
    }
    if (typeof current === 'bigint') return limit + 1;
    if (typeof current !== 'object' || ancestors.has(current)) return limit + 1;

    ancestors.add(current);
    let total = 2;
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index++) {
        if (index > 0) total += 1;
        total += visit(current[index], remaining - total, true);
        if (total > remaining) break;
      }
    } else {
      let emitted = 0;
      for (const [key, item] of Object.entries(current)) {
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
        if (emitted++ > 0) total += 1;
        total += jsonStringByteLength(key, remaining - total) + 1;
        total += visit(item, remaining - total);
        if (total > remaining) break;
      }
    }
    ancestors.delete(current);
    return total > remaining ? limit + 1 : total;
  };

  return visit(value, limit);
}

function jsonStringByteLength(value: string, limit: number): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x0c
      || code === 0x0a || code === 0x0d || code === 0x09) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
    if (bytes > limit) return limit + 1;
  }
  return bytes;
}

function fitsLspIncomingBudget(target: LspNodeSummary, occurrences: LspOccurrenceCandidate[]): boolean {
  let remaining = LSP_DAEMON_RESPONSE_BYTE_CAP - 1_024 - target.maxJsonBytes;
  for (const occurrence of occurrences) {
    remaining -= 128
      + boundedJsonByteLength(occurrence.edge, LSP_DAEMON_RESPONSE_BYTE_CAP)
      + occurrence.source.maxJsonBytes
      + occurrence.target.maxJsonBytes;
    if (remaining < 0) return false;
  }
  return true;
}

function fitsLspFileContextBudget(
  snapshot: LspSourceSnapshot,
  nodes: LspNodeSummary[],
  occurrences: LspOccurrenceCandidate[],
  containment: Edge[],
): boolean {
  let remaining = LSP_DAEMON_RESPONSE_BYTE_CAP
    - 2_048
    - boundedJsonByteLength(snapshot, LSP_DAEMON_RESPONSE_BYTE_CAP);
  for (const node of nodes) {
    remaining -= node.maxJsonBytes + 1;
    if (remaining < 0) return false;
  }
  for (const occurrence of occurrences) {
    remaining -= 128
      + boundedJsonByteLength(occurrence.edge, LSP_DAEMON_RESPONSE_BYTE_CAP)
      + occurrence.source.maxJsonBytes
      + occurrence.target.maxJsonBytes;
    if (remaining < 0) return false;
  }
  for (const edge of containment) {
    remaining -= boundedJsonByteLength(edge, LSP_DAEMON_RESPONSE_BYTE_CAP) + 1;
    if (remaining < 0) return false;
  }
  return true;
}

function fitsLspByteBudget(value: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= LSP_DAEMON_RESPONSE_BYTE_CAP;
}

function indexedSnapshotToken(file: FileRecord): string {
  return crypto
    .createHash('sha256')
    .update(`${file.contentHash}\0${file.indexedAt}\0${file.size}`)
    .digest('hex');
}

function isOutsideRepositoryRelative(relative: string): boolean {
  return !relative
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
}

function pathContainsSymlink(rootReal: string, candidate: string): boolean {
  const relative = path.relative(rootReal, candidate);
  let current = rootReal;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** @internal Exported only for deterministic filesystem-race regression coverage. */
export function readTrustedSnapshot(
  cg: CodeGraph,
  requested: string,
  afterRead: () => void = () => undefined,
): { ok: true; snapshot: LspSourceSnapshot } | { ok: false; reason: LspSourceErrorReason } {
  if (!requested || path.isAbsolute(requested)) return { ok: false, reason: 'outside_repository' };

  let root: string;
  let candidate: string;
  let rootReal: string;
  let candidateReal: string;
  try {
    root = cg.getProjectRoot();
    rootReal = fs.realpathSync(root);
  } catch {
    return { ok: false, reason: 'not_found' };
  }
  candidate = path.resolve(rootReal, requested);
  const lexicalRelative = path.relative(rootReal, candidate);
  if (isOutsideRepositoryRelative(lexicalRelative)) {
    return { ok: false, reason: 'outside_repository' };
  }
  const traversesSymlink = pathContainsSymlink(rootReal, candidate);
  try {
    candidateReal = fs.realpathSync(candidate);
  } catch {
    return { ok: false, reason: traversesSymlink ? 'outside_repository' : 'not_found' };
  }

  const relative = path.relative(rootReal, candidateReal);
  if (isOutsideRepositoryRelative(relative)) {
    return { ok: false, reason: 'outside_repository' };
  }
  const filePath = relative.split(path.sep).join('/');
  const indexed = cg.getFile(filePath);
  if (!indexed) return { ok: false, reason: 'unindexed' };

  let fd: number | null = null;
  try {
    const nonblocking = process.platform === 'win32' ? 0 : (fs.constants.O_NONBLOCK ?? 0);
    fd = fs.openSync(
      candidateReal,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | nonblocking,
    );
    const before = fs.fstatSync(fd);
    if (!before.isFile()) return { ok: false, reason: 'not_regular' };
    if (before.size > LSP_SOURCE_BYTE_CAP) return { ok: false, reason: 'too_large' };

    const buffer = Buffer.allocUnsafe(LSP_SOURCE_BYTE_CAP + 1);
    let bytesRead = 0;
    while (bytesRead <= LSP_SOURCE_BYTE_CAP) {
      const read = fs.readSync(fd, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (read === 0) break;
      bytesRead += read;
      if (bytesRead > LSP_SOURCE_BYTE_CAP) return { ok: false, reason: 'too_large' };
    }
    const bytes = buffer.subarray(0, bytesRead);
    let after: fs.Stats;
    let finalReal: string;
    let finalPath: fs.Stats;
    let finalRelative: string;
    let finalIndexed: ReturnType<CodeGraph['getFile']>;
    try {
      afterRead();
      after = fs.fstatSync(fd);
      finalReal = fs.realpathSync(candidate);
      finalPath = fs.statSync(finalReal);
      finalRelative = path.relative(rootReal, finalReal);
      finalIndexed = cg.getFile(filePath);
    } catch {
      return { ok: false, reason: 'stale' };
    }
    if (
      finalReal !== candidateReal ||
      isOutsideRepositoryRelative(finalRelative) ||
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
      after.dev !== finalPath.dev || after.ino !== finalPath.ino || !finalPath.isFile() ||
      after.size !== bytesRead ||
      !finalIndexed || finalIndexed.contentHash !== indexed.contentHash ||
      finalIndexed.indexedAt !== indexed.indexedAt || finalIndexed.size !== indexed.size
    ) {
      return { ok: false, reason: 'stale' };
    }

    // Device/inode/size alone cannot detect an equal-length in-place rewrite.
    // Re-read the same descriptor in bounded chunks and require it to remain
    // byte-identical through a final metadata/path identity check.
    const verifyBuffer = Buffer.allocUnsafe(Math.min(bytesRead, 64 * 1024));
    for (let offset = 0; offset < bytesRead;) {
      const expected = Math.min(verifyBuffer.length, bytesRead - offset);
      const read = fs.readSync(fd, verifyBuffer, 0, expected, offset);
      if (read !== expected
        || !verifyBuffer.subarray(0, read).equals(bytes.subarray(offset, offset + read))) {
        return { ok: false, reason: 'stale' };
      }
      offset += read;
    }
    let verifiedDescriptor: fs.Stats;
    let verifiedPath: fs.Stats;
    try {
      verifiedDescriptor = fs.fstatSync(fd);
      verifiedPath = fs.statSync(finalReal);
    } catch {
      return { ok: false, reason: 'stale' };
    }
    if (
      verifiedDescriptor.dev !== after.dev || verifiedDescriptor.ino !== after.ino ||
      verifiedDescriptor.size !== after.size || verifiedDescriptor.mtimeMs !== after.mtimeMs ||
      verifiedDescriptor.ctimeMs !== after.ctimeMs ||
      verifiedPath.dev !== verifiedDescriptor.dev || verifiedPath.ino !== verifiedDescriptor.ino ||
      verifiedPath.size !== verifiedDescriptor.size || verifiedPath.mtimeMs !== verifiedDescriptor.mtimeMs ||
      verifiedPath.ctimeMs !== verifiedDescriptor.ctimeMs || !verifiedPath.isFile()
    ) {
      return { ok: false, reason: 'stale' };
    }

    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) return { ok: false, reason: 'unreadable' };
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== indexed.contentHash) return { ok: false, reason: 'stale' };
    const snapshotToken = indexedSnapshotToken(indexed);
    return {
      ok: true,
      snapshot: {
        filePath,
        text,
        languageId: indexed.language,
        contentHash: indexed.contentHash,
        snapshotToken,
      },
    };
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* best-effort */ }
    }
  }
}

function idParam(params: Record<string, unknown>): string {
  return typeof params.id === 'string' ? params.id : '';
}

function statusOp(cg: CodeGraph): unknown {
  const stats = cg.getStats();
  // Coverage-aware hybrid availability — the SAME predicate the CLI/`codegraph
  // status` uses: a configured provider is not enough; ≥1 matching-model vector
  // must exist too (a provider with zero vectors still resolves to keyword).
  const emb = cg.getEmbeddingStatus();
  const hybridAvailable =
    resolveAutoMode({
      providerConfigured: emb.active,
      matchingVectorCount: emb.active ? emb.coverage.embedded : 0,
    }) === 'hybrid';
  const lspEnabled = cg.getLspStatus().enabled === true;
  // Prefer the persisted index-completeness state over a nodeCount>0 heuristic, so
  // a known-bad index (killed mid-run, silently truncated, or failed) is not
  // reported as 'indexed'. An empty graph stays 'empty'; a healthy/unknown state
  // reads 'indexed'.
  const persisted = cg.getIndexState();
  // `stats.lastUpdated` is stamped `Date.now()` on every getStats() call, so it
  // reports request time, not index time — an old index would always look fresh.
  // Use the PERSISTED completion timestamp (MAX(files.indexed_at)) instead, null
  // when nothing is indexed yet (FR-005 `lastIndexed`).
  const lastIndexedAt = cg.getLastIndexedAt();
  return {
    index: {
      state:
        persisted === 'partial' || persisted === 'indexing' || persisted === 'failed'
          ? persisted
          : stats.nodeCount === 0
            ? 'empty'
            : 'indexed',
      fileCount: stats.fileCount,
      nodeCount: stats.nodeCount,
      edgeCount: stats.edgeCount,
      lastIndexed: lastIndexedAt != null ? new Date(lastIndexedAt).toISOString() : null,
    },
    // `reason` is a string explaining unavailability; omit it entirely when
    // hybrid search is available (contract models it as a string, not null).
    hybridSearch: hybridAvailable
      ? { available: true }
      : {
          available: false,
          // Distinguish a provider that isn't configured from one that is but has
          // no matching-model vectors yet (auto still degrades to keyword) — the
          // remediation differs.
          reason: emb.active ? 'no matching-model vectors indexed' : 'embeddings not configured',
        },
    lsp: { available: lspEnabled },
  };
}

async function searchOp(cg: CodeGraph, params: Record<string, unknown>): Promise<unknown> {
  const query = typeof params.query === 'string' ? params.query : '';
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.limit) || 100));
  const offset = Math.max(0, Number(params.offset) || 0);
  const mode = (typeof params.mode === 'string' ? params.mode : 'auto') as SearchMode;

  // Mirror the MCP search handler: the semantic arm's query embed is the one
  // async dependency; acquire it first so the sync detailed search can fuse (or
  // record its degradation). Budget-capped and never rejects, so keyword skips it.
  if (mode !== 'keyword') {
    await cg.acquireQueryVectorForSearch(query);
  }

  // Scan a bounded superset so `total` is meaningful across the paging window
  // (the library search has no separate count); slice the requested page here.
  const detailed = cg.searchNodesDetailed(query, { limit: SEARCH_SCAN_CEILING, mode });
  const all = detailed.results.map((r) => r.node);
  return {
    items: all.slice(offset, offset + limit),
    total: all.length,
    degraded: detailed.degradation !== null && detailed.degradation !== undefined,
    degradationReason: detailed.degradation ?? null,
  };
}

function relationOp(
  cg: CodeGraph,
  params: Record<string, unknown>,
  which: 'callers' | 'callees',
): unknown {
  const id = idParam(params);
  if (!cg.getNode(id)) return { found: false };
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.limit) || 100));
  const offset = Math.max(0, Number(params.offset) || 0);
  const raw = which === 'callers' ? cg.getCallers(id) : cg.getCallees(id);
  // De-dup by node id — a symbol can be reached over multiple edges.
  const seen = new Set<string>();
  const nodes: Node[] = [];
  for (const { node } of raw) {
    if (!seen.has(node.id)) {
      seen.add(node.id);
      nodes.push(node);
    }
  }
  return { found: true, items: nodes.slice(offset, offset + limit), total: nodes.length };
}

function subgraphOp(
  cg: CodeGraph,
  params: Record<string, unknown>,
  which: 'impact' | 'neighborhood',
): unknown {
  const id = idParam(params);
  if (!cg.getNode(id)) return { found: false };
  const depth = Math.min(MAX_DEPTH, Math.max(1, Number(params.depth) || (which === 'impact' ? 3 : 1)));
  // Impact's Subgraph has no internal cap (cap post-hoc); the neighborhood BFS
  // caps during traversal — scan one past the cap so a hit is detectable.
  const sg =
    which === 'impact'
      ? cg.getImpactRadius(id, depth)
      : cg.getNeighborhood(id, depth, SUBGRAPH_NODE_CAP + 1);
  const allNodes = [...sg.nodes.values()];
  const truncated = allNodes.length > SUBGRAPH_NODE_CAP;
  const nodes = truncated ? allNodes.slice(0, SUBGRAPH_NODE_CAP) : allNodes;
  let edges: Edge[] = sg.edges;
  if (truncated) {
    const keep = new Set(nodes.map((n) => n.id));
    edges = sg.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  }
  return { found: true, nodes, edges, truncated };
}
