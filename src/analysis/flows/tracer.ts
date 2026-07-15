/**
 * SPEC-011 — Execution Flows: bounded, cycle-safe, deterministic flow tracer (T021).
 *
 * Traces a single execution flow as ONE bounded branching call graph rooted at
 * an entry point (FR-004), following BOTH `calls` and `references` out-edges
 * across ALL provenance classes (FR-008) — a route→handler edge is `references`
 * in some frameworks (C#/NestJS) and `calls` in others (Express).
 *
 * Determinism (FR-008a): at each step the candidate out-edges are visited in a
 * stable TOTAL order — target file path → edge-kind rank → callee qualified name
 * → a stable edge key — BEFORE the 20-edge width cap selects survivors. The trace
 * is a deterministic pre-order DFS with a global visited set, so a node reached
 * via multiple parents records the parent of its FIRST visit under that order,
 * and a bounded/truncated flow is byte-identical across runs of an unchanged
 * graph.
 *
 * Caps (FR-005/006, code-versioned, never configurable): 12 hops of depth, 20
 * out-edges per step, 200 unique steps per flow. Each axis truncation flag is set
 * INDEPENDENTLY (FR-007). DFS (not BFS) so a deep branch can trip the depth cap
 * while a wide sub-tree independently trips the step cap.
 */

import type { EdgeProvenance, Node } from '../../types';
import type { QueryBuilder } from '../../db/queries';
import type { CatalogProvenance, FlowStepEdgeKind } from '../types';
import type { EntryPoint } from './entry-points';

/** Fixed depth cap: 12 hops from the root (FR-005). Code-versioned. */
export const FLOW_CAP_DEPTH = 12;
/** Fixed width cap: 20 out-edges examined per step (FR-005). Code-versioned. */
export const FLOW_CAP_WIDTH = 20;
/** Fixed total-step cap: 200 unique steps per flow (FR-005). Code-versioned. */
export const FLOW_CAP_STEPS = 200;

/** The two edge classes a flow traverses, ranked for the deterministic sort. */
const EDGE_KIND_RANK: Record<FlowStepEdgeKind, number> = { calls: 0, references: 1 };
const FLOW_EDGE_KINDS: FlowStepEdgeKind[] = ['calls', 'references'];

/** One node within a flow's bounded branching graph. */
export interface TracedStep {
  nodeId: string;
  name: string;
  kind: string;
  /** Hops from the root (0 = root). */
  depth: number;
  /** Parent in the branching graph (edge source); null for the root step. */
  parentNodeId: string | null;
  /** null for the root step. */
  edgeKind: FlowStepEdgeKind | null;
  /** null ONLY for the root step; every non-root step carries one (FR-009). */
  provenance: CatalogProvenance | null;
}

/** A traced flow: its steps plus the three independent axis truncation flags. */
export interface TraceResult {
  steps: TracedStep[];
  truncatedDepth: boolean;
  truncatedWidth: boolean;
  truncatedSteps: boolean;
}

/**
 * Map an internal edge provenance onto the 3-value catalog wire enum (FR-008/009):
 * tree-sitter/scip (and an unset provenance) → `static`, lsp → `lsp`,
 * heuristic/synthesized → `heuristic`.
 */
export function mapProvenance(p: EdgeProvenance | undefined): CatalogProvenance {
  if (p === 'lsp') return 'lsp';
  if (p === 'heuristic') return 'heuristic';
  return 'static';
}

/** A sorted, resolved out-edge candidate carrying its precomputed sort keys. */
interface Candidate {
  targetId: string;
  node: Node;
  edgeKind: FlowStepEdgeKind;
  provenance: CatalogProvenance;
  filePath: string;
  qualifiedName: string;
  edgeKey: string;
}

function edgeKeyOf(e: { source: string; target: string; kind: string; line?: number; column?: number }): string {
  return `${e.source}|${e.target}|${e.kind}|${e.line ?? -1}|${e.column ?? -1}`;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  const ra = EDGE_KIND_RANK[a.edgeKind];
  const rb = EDGE_KIND_RANK[b.edgeKind];
  if (ra !== rb) return ra - rb;
  if (a.qualifiedName !== b.qualifiedName) return a.qualifiedName < b.qualifiedName ? -1 : 1;
  // `edgeKey` (source|target|kind|line|column) is a UNIQUE edge identity — the
  // `idx_edges_identity` unique index + INSERT OR IGNORE guarantee at most one
  // edge per that tuple — so it is a total order over distinct candidates and no
  // earlier field can leave an unresolved tie (provenance can never be the
  // deciding factor because two edges can't share this key, FR-008a).
  if (a.edgeKey !== b.edgeKey) return a.edgeKey < b.edgeKey ? -1 : 1;
  return 0;
}

/**
 * The out-edges of `nodeId`, resolved to nodes and sorted by the FR-008a total
 * order. For a synthetic inline-CLI root, the root's out-edges come from its
 * seeded {@link EntryPoint.virtualRootEdges} instead of the graph.
 */
function sortedCandidates(nodeId: string, entry: EntryPoint, queries: QueryBuilder): Candidate[] {
  const out: Candidate[] = [];
  if (nodeId === entry.rootNodeId && entry.virtualRootEdges && entry.virtualRootEdges.length > 0) {
    const targets = queries.getNodesByIds(entry.virtualRootEdges.map((v) => v.targetNodeId));
    for (const v of entry.virtualRootEdges) {
      const node = targets.get(v.targetNodeId);
      if (!node) continue;
      out.push({
        targetId: v.targetNodeId,
        node,
        edgeKind: v.edgeKind,
        provenance: v.provenance,
        filePath: node.filePath,
        qualifiedName: node.qualifiedName,
        edgeKey: edgeKeyOf({ source: entry.rootNodeId, target: v.targetNodeId, kind: v.edgeKind }),
      });
    }
  } else {
    const edges = queries.getOutgoingEdges(nodeId, FLOW_EDGE_KINDS);
    if (edges.length === 0) return out;
    const targets = queries.getNodesByIds(edges.map((e) => e.target));
    for (const e of edges) {
      const node = targets.get(e.target);
      if (!node) continue; // dangling target — cannot display, skip
      out.push({
        targetId: e.target,
        node,
        edgeKind: e.kind as FlowStepEdgeKind,
        provenance: mapProvenance(e.provenance),
        filePath: node.filePath,
        qualifiedName: node.qualifiedName,
        edgeKey: edgeKeyOf(e),
      });
    }
  }
  out.sort(compareCandidates);
  return out;
}

/**
 * Trace one flow rooted at `entry`. Deterministic pre-order DFS, cycle-safe (a
 * global visited set gives each symbol exactly one step), bounded by the three
 * fixed caps with each axis flag set independently (FR-004/005/006/007/008/009).
 */
export function traceFlow(entry: EntryPoint, queries: QueryBuilder): TraceResult {
  const steps: TracedStep[] = [];
  const visited = new Set<string>();
  const flags = { depth: false, width: false, steps: false };

  steps.push({
    nodeId: entry.rootNodeId,
    name: entry.rootName,
    kind: entry.rootKind,
    depth: 0,
    parentNodeId: null,
    edgeKind: null,
    provenance: null,
  });
  visited.add(entry.rootNodeId);

  const dfs = (nodeId: string, depth: number): void => {
    // NOTE: no `steps.length >= FLOW_CAP_STEPS` early-return here. When the 200th
    // step is pushed and we recurse into it, this call must still examine that
    // node's out-edges so an unvisited candidate trips `flags.steps` below — a
    // top-of-fn bail would report a truncated flow as complete (FR-007). The
    // in-loop cap guard keeps `steps.length` from ever exceeding the cap, and the
    // per-candidate `visited` skip means a node whose successors are all already
    // visited (exactly-200-explored) correctly leaves the flag unset.
    if (depth >= FLOW_CAP_DEPTH) {
      // Set the depth flag only if a resolvable, NOT-yet-visited target remains.
      // A node whose only out-edges point at already-visited nodes (e.g. a cycle
      // back to the root) or at dangling ids added nothing the uncapped trace
      // would have kept — flagging it would falsely present a complete flow as
      // depth-truncated (FR-007). sortedCandidates already drops dangling targets.
      if (sortedCandidates(nodeId, entry, queries).some((c) => !visited.has(c.targetId))) {
        flags.depth = true;
      }
      return;
    }
    const candidates = sortedCandidates(nodeId, entry, queries);
    let kept = candidates;
    let widthDropped: string[] = [];
    if (candidates.length > FLOW_CAP_WIDTH) {
      kept = candidates.slice(0, FLOW_CAP_WIDTH);
      // Candidate width-truncations: dropped targets that could add a NEW step (an
      // unvisited target not already covered by a kept candidate). Re-checked
      // AFTER the kept subtrees run — a kept branch may itself reach a dropped
      // target (kept A also calls dropped X), in which case the width cap
      // truncated nothing. A dropped edge to an already-visited or duplicate
      // target contributes nothing either. Consistent with the depth-cap flag,
      // so raw edge count never falsely flags truncation (FR-007).
      const keptTargets = new Set(kept.map((c) => c.targetId));
      widthDropped = candidates
        .slice(FLOW_CAP_WIDTH)
        .filter((c) => !visited.has(c.targetId) && !keptTargets.has(c.targetId))
        .map((c) => c.targetId);
    }
    for (const c of kept) {
      if (visited.has(c.targetId)) continue;
      if (steps.length >= FLOW_CAP_STEPS) {
        flags.steps = true;
        break;
      }
      visited.add(c.targetId);
      steps.push({
        nodeId: c.targetId,
        name: c.node.name,
        kind: c.node.kind,
        depth: depth + 1,
        parentNodeId: nodeId,
        edgeKind: c.edgeKind,
        provenance: c.provenance,
      });
      dfs(c.targetId, depth + 1);
    }
    // A dropped candidate is a real width truncation only if NO kept subtree
    // reached its target during the traversal above (FR-007).
    if (widthDropped.some((t) => !visited.has(t))) flags.width = true;
  };
  dfs(entry.rootNodeId, 0);

  return { steps, truncatedDepth: flags.depth, truncatedWidth: flags.width, truncatedSteps: flags.steps };
}
