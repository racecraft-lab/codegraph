/**
 * SPEC-011 — Execution Flows & Clusters: analysis module entry point.
 *
 * New module tree sanctioned by Constitution Principle III. This barrel
 * re-exports the shared wire-shape types and the catalog-store primitives, hosts
 * the flow-analysis orchestrator (`runFlowAnalysis`, T023) that composes
 * entry-points → tracer → naming → catalog-store swap, and the read facades
 * (`readFlowList` / `readFlowDetail`) that attach read-time state to the
 * catalog-store composite reads for BOTH surfaces (MCP + REST, FR-028a).
 */

import type { SqliteDatabase } from '../db/sqlite-adapter';
import {
  getFlowDetail,
  pageFlows,
  probeCatalog,
  resolveState,
  swapFlows,
  type FlowRow,
  type FlowStepRow,
} from './catalog-store';
import type { CatalogState, FlowDetail, FlowListResult } from './types';
import { detectEntryPoints, type FlowAnalysisGraph } from './flows/entry-points';
import { nameFlow } from './flows/naming';
import { traceFlow } from './flows/tracer';
import { computeFlowId } from './flows/identity';

export * from './types';
export * from './catalog-store';
export * from './flows/entry-points';
export * from './flows/tracer';
export * from './flows/naming';
export * from './flows/identity';

/**
 * States whose retained rows are INERT — the surface returns an empty page and
 * never surfaces stale/retained content as if live (FR-025/023/030). `stale` is
 * deliberately NOT here: a stale catalog is served WITH its items and its
 * recorded `sourceVersion` (FR-022).
 */
const INERT_STATES: ReadonlySet<CatalogState> = new Set<CatalogState>([
  'disabled',
  'unavailable',
  'not_indexed',
]);

/**
 * Read the paged flow list WITH its read-time state attached (T024/T025 shared
 * facade). Single-snapshot composite read (FR-021a): probe + slice come from the
 * catalog-store's single-fetch primitives. When the state is inert the retained
 * rows are suppressed (empty page); `stale`/`available`/`empty` return the page.
 */
export function readFlowList(
  db: SqliteDatabase,
  enabled: boolean,
  limit: number,
  offset: number,
): FlowListResult {
  const state = resolveState(enabled, probeCatalog(db, 'flows'));
  if (INERT_STATES.has(state)) {
    return { items: [], total: 0, limit, offset, sourceVersion: 0, state };
  }
  return { ...pageFlows(db, limit, offset), state };
}

/**
 * A `get_flow` read result: the full flow detail (found), or a stateful miss —
 * an unknown id within a live catalog, or an inert/empty catalog. Both surfaces
 * render this as success-shaped guidance (never `isError`, FR-030).
 */
export type FlowDetailRead =
  | { found: true; flow: FlowDetail }
  | { found: false; state: CatalogState };

/**
 * Read one flow's detail WITH its read-time state attached (T024/T025 shared
 * facade). An inert catalog yields `{found:false,state}`; a live catalog with no
 * such id yields `{found:false,state}` (the "unknown flow id" guidance case).
 */
export function readFlowDetail(db: SqliteDatabase, enabled: boolean, id: string): FlowDetailRead {
  const state = resolveState(enabled, probeCatalog(db, 'flows'));
  if (INERT_STATES.has(state)) return { found: false, state };
  const base = getFlowDetail(db, id);
  if (!base) return { found: false, state };
  return { found: true, flow: { ...base, state } };
}

/**
 * Analyze the graph's execution flows and atomically swap them into the catalog
 * (T023). Composes entry-point detection → per-flow trace → naming → the
 * catalog-store swap. Each flow is stamped with the live `graph_write_version`
 * it was computed from; the root step carries null provenance/edge_kind and every
 * non-root step carries a 3-value provenance (FR-009); node-bearing rows
 * denormalize name/kind by value (FR-021/022a).
 */
export function runFlowAnalysis(graph: FlowAnalysisGraph, store: SqliteDatabase): void {
  const version = graph.queries.getGraphWriteVersion();
  const flows: FlowRow[] = [];
  const steps: FlowStepRow[] = [];
  const seen = new Set<string>();

  for (const entry of detectEntryPoints(graph)) {
    const flowId = computeFlowId(entry);
    if (seen.has(flowId)) continue; // belt-and-braces over the entry-point dedupe
    seen.add(flowId);

    const trace = traceFlow(entry, graph.queries);
    flows.push({
      id: flowId,
      name: nameFlow(entry),
      entryKind: entry.entryKind,
      rootNodeId: entry.rootNodeId,
      rootName: entry.rootName,
      rootKind: entry.rootKind,
      truncatedDepth: trace.truncatedDepth,
      truncatedWidth: trace.truncatedWidth,
      truncatedSteps: trace.truncatedSteps,
    });
    for (const s of trace.steps) {
      steps.push({
        flowId,
        nodeId: s.nodeId,
        symbolName: s.name,
        symbolKind: s.kind,
        depth: s.depth,
        parentNodeId: s.parentNodeId,
        edgeKind: s.edgeKind,
        provenance: s.provenance,
      });
    }
  }

  swapFlows(store, version, flows, steps);
}
