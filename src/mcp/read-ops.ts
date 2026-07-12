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

import type CodeGraph from '../index';
import type { Node, Edge, SearchMode } from '../types';
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
export type ReadOp = 'status' | 'search' | 'node' | 'callers' | 'callees' | 'impact' | 'neighborhood';

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
    default:
      throw new UnknownReadOpError(`unknown read op: ${op}`);
  }
}

/**
 * Op-appropriate empty result for a daemon whose default project failed to open
 * (defensive — the web server only attaches to indexed roots, so `cg` is
 * normally non-null; the un-indexed *startup* status is synthesized server-side).
 */
export function readOnMissingIndex(op: ReadOp): unknown {
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
    default:
      throw new UnknownReadOpError(`unknown read op: ${op}`);
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
      lastIndexed: stats.lastUpdated ? new Date(stats.lastUpdated).toISOString() : null,
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
