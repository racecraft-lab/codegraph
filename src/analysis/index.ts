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
import { createYielder, type MaybeYield } from '../resolution/cooperative-yield';
import { logWarn } from '../errors';
import type { AnalysisConfig } from '../project-config';
import {
  getFlowDetail,
  markFirstRunFailed,
  pageClusters,
  pageFlows,
  probeCatalog,
  readClusterMembership,
  resolveState,
  swapClusters,
  swapFlows,
  type ClusterMemberRow,
  type ClusterRow,
  type FlowRow,
  type FlowStepRow,
} from './catalog-store';
import type { CatalogKind, CatalogState, ClusterListResult, FlowDetail, FlowListResult } from './types';
import { detectEntryPoints, type FlowAnalysisGraph } from './flows/entry-points';
import { nameFlow } from './flows/naming';
import { traceFlow } from './flows/tracer';
import { computeFlowId } from './flows/identity';
import { buildFileGraph } from './clusters/file-graph';
import { louvain } from './clusters/louvain';
import { canonicalLabel, resolveDisplayLabel } from './clusters/labels';
import { assignClusterIdentity } from './clusters/identity';

export * from './types';
export * from './catalog-store';
export * from './flows/entry-points';
export * from './flows/tracer';
export * from './flows/naming';
export * from './flows/identity';
export * from './clusters/file-graph';
export * from './clusters/louvain';
export * from './clusters/labels';
export * from './clusters/identity';

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
export async function runFlowAnalysis(
  graph: FlowAnalysisGraph,
  store: SqliteDatabase,
  signal?: AbortSignal,
): Promise<void> {
  const version = graph.queries.getGraphWriteVersion();
  const flows: FlowRow[] = [];
  const steps: FlowStepRow[] = [];
  const seen = new Set<string>();
  // Cooperative yield at flow-root boundaries (T050): tracing many entry points
  // is a synchronous main-thread span, so hand the event loop back between roots
  // to keep the daemon query loop + liveness heartbeat responsive on large repos
  // (Constitution VI). Fast repos pay essentially nothing (budgeted yielder).
  const maybeYield = createYielder();

  for (const entry of detectEntryPoints(graph)) {
    // An abort before the swap is a catalog no-op — discard partial work, leave
    // the prior catalog untouched (edge case: cancellation is not a failure).
    if (signal?.aborted) return;
    await maybeYield();
    const flowId = computeFlowId(entry);
    // The flow id folds in the root's file (FR-017a), so distinct roots no longer
    // collide across files. A residual same-file same-identity collision (a
    // genuine duplicate registration) is dropped here rather than left to fail
    // swapFlows on a duplicate PRIMARY KEY (which would roll the whole swap back).
    if (seen.has(flowId)) continue;
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

  if (signal?.aborted) return; // final pre-swap guard: no partial write on abort
  swapFlows(store, version, flows, steps);
}

/**
 * Read the paged cluster list WITH its read-time state attached (T036/T037
 * shared facade), mirroring {@link readFlowList}. Single-snapshot composite read
 * (FR-021a): probe + `minSize`-filtered slice come from the catalog-store
 * single-fetch primitives. `minSize` is clamped to ≥1 by the caller (FR-029).
 */
export function readClusterList(
  db: SqliteDatabase,
  enabled: boolean,
  minSize: number,
  limit: number,
  offset: number,
): ClusterListResult {
  const state = resolveState(enabled, probeCatalog(db, 'clusters'));
  if (INERT_STATES.has(state)) {
    return { items: [], total: 0, limit, offset, sourceVersion: 0, state };
  }
  return { ...pageClusters(db, minSize, limit, offset), state };
}

/**
 * A freshly computed cluster before its identity is assigned: its sorted member
 * file paths and its deterministic canonical label (FR-018). The stable id is
 * attached separately — a raw content hash here (T035), replaced by the
 * transfer-or-mint identity assignment in T042.
 */
export interface ComputedCluster {
  members: string[];
  canonicalLabel: string;
}

/**
 * Compute the functional clusters of the graph as sorted-member groups with
 * canonical labels (T035). Louvain over the undirected weighted file graph;
 * every indexed file lands in exactly one group (FR-014). Groups are returned in
 * a deterministic order (by first member path).
 */
export async function computeClusters(
  graph: FlowAnalysisGraph,
  maybeYield?: MaybeYield,
): Promise<ComputedCluster[]> {
  const fileGraph = buildFileGraph(graph.queries);
  // Yield at each Louvain aggregation-level boundary (T050) via the T033 hook.
  const labels = await louvain(fileGraph, maybeYield ? { onPassBoundary: maybeYield } : undefined);
  const groups = new Map<number, string[]>();
  fileGraph.files.forEach((file, i) => {
    const c = labels[i]!;
    const g = groups.get(c);
    if (g) g.push(file);
    else groups.set(c, [file]);
  });
  return [...groups.values()]
    .map((members) => {
      const sorted = [...members].sort();
      return { members: sorted, canonicalLabel: canonicalLabel(sorted) };
    })
    .sort((a, b) => (a.members[0]! < b.members[0]! ? -1 : a.members[0]! > b.members[0]! ? 1 : 0));
}

/**
 * Analyze the graph's functional clusters and atomically swap them into the
 * catalog (T035/T042). Composes file-graph → Louvain → labels → identity → the
 * catalog-store swap; persists `clusters` (is_singleton, member_count, the
 * transferred-or-minted stable id) + `cluster_members` (by-value file_path, no
 * denormalization — paths are position-independent, FR-021/022a).
 *
 * Identity (FR-015/016/017/017a): the prior committed membership is read BEFORE
 * the swap deletes it, so a cluster that stays >= 0.5-overlapping keeps its id
 * across a re-index and a genuine split transfers to only the best descendant;
 * a no-prior-match cluster mints a deterministic content-hash id.
 */
export async function runClusterAnalysis(
  graph: FlowAnalysisGraph,
  store: SqliteDatabase,
  signal?: AbortSignal,
): Promise<void> {
  // Cooperative yield at Louvain pass boundaries (T050), threaded into
  // computeClusters -> louvain's onPassBoundary hook (Constitution VI).
  const maybeYield = createYielder();
  const version = graph.queries.getGraphWriteVersion();
  const prior = readClusterMembership(store); // pre-swap prior-membership read (FR-017a)
  const computed = await computeClusters(graph, maybeYield);
  if (signal?.aborted) return; // abort before the swap is a no-op (prior untouched)
  const ids = assignClusterIdentity(computed, prior); // transfer-or-mint

  const clusters: ClusterRow[] = [];
  const members: ClusterMemberRow[] = [];
  for (let i = 0; i < computed.length; i++) {
    const c = computed[i]!;
    const id = ids[i]!;
    // Optional, presentation-only LLM display label (FR-019, T056). Fully dormant
    // here — the orchestrator wires NO capability, so this returns null with zero
    // model calls; a configured capability's failure is swallowed inside the
    // advisory (canonical label kept, display slot null, analysis never failed).
    const displayLabel = await resolveDisplayLabel(c.canonicalLabel, c.members);
    clusters.push({
      id,
      canonicalLabel: c.canonicalLabel,
      displayLabel,
      memberCount: c.members.length,
      isSingleton: c.members.length === 1,
    });
    for (const fp of c.members) members.push({ clusterId: id, filePath: fp });
  }

  if (signal?.aborted) return; // final pre-swap guard: no partial write on abort
  swapClusters(store, version, clusters, members);
}

// ── T047/T048 — lifecycle recompute orchestrator + failure taxonomy ───────────

/** Signature of a per-kind analyzer (the real ones, or a test-injected stub). */
type CatalogAnalyzer = (
  graph: FlowAnalysisGraph,
  store: SqliteDatabase,
  signal?: AbortSignal,
) => Promise<void>;

/**
 * Test seams for {@link maybeRunCatalogAnalysis}: inject a throwing analyzer to
 * exercise the failure taxonomy (FR-022b/023) deterministically without
 * corrupting real graph data. Default to the real analyzers.
 */
export interface CatalogAnalysisHooks {
  runFlows?: CatalogAnalyzer;
  runClusters?: CatalogAnalyzer;
}

/**
 * A kind has a VALID prior committed catalog when its `catalog_meta` row exists,
 * is not a first-run-failure marker, and records a concrete version. Only then
 * does a failure retain-and-stale (FR-022b); otherwise a first-run failure marks
 * `unavailable` (FR-023).
 */
function hasValidPriorCatalog(store: SqliteDatabase, kind: CatalogKind): boolean {
  const probe = probeCatalog(store, kind);
  return probe.hasMeta && !probe.firstRunFailed && probe.computedFromVersion !== null;
}

/**
 * Run ONE catalog kind's analysis with the bounded failure taxonomy (T048,
 * FR-022b/023): every failure mode analysis can raise — compute/traversal
 * exceptions, resource exhaustion, a failed atomic-swap commit — is caught here
 * so NONE propagates to fail `indexAll`/`sync`. Outcomes:
 *   - success              → the analyzer swapped a fresh catalog (available);
 *   - failure, prior valid → prior retained (swap rolled back / never ran) and,
 *     because `graph_write_version` already advanced, derives as stale (FR-022b);
 *   - failure, no prior    → an explicit `unavailable` marker (FR-023);
 *   - caller cancellation  → a no-op (no marker) — the prior is untouched, and if
 *     the version already advanced it derives as stale (edge case).
 * Per-kind, so one kind's failure never affects the other (FR-020 independence).
 */
async function runCatalogKind(
  store: SqliteDatabase,
  kind: CatalogKind,
  signal: AbortSignal | undefined,
  analyze: () => Promise<void>,
): Promise<void> {
  if (signal?.aborted) return; // abort before this kind starts — a catalog no-op
  const hadValidPrior = hasValidPriorCatalog(store, kind);
  try {
    await analyze();
  } catch (err) {
    // A caller-requested cancellation is not a failure: leave the prior untouched
    // (it derives as stale if the version already advanced) and mark nothing.
    if (signal?.aborted) return;
    if (!hadValidPrior) {
      // First-run failure, no prior to retain → explicit unavailable (FR-023).
      try {
        markFirstRunFailed(store, kind);
      } catch {
        /* marker write is best-effort — never re-raise into the index */
      }
    }
    // With a valid prior we write nothing: the retained catalog derives stale
    // (FR-022b), since graph_write_version advanced before analysis ran.
    // Only the error's NAME is surfaced — never its message/cause (Constitution V).
    logWarn(
      `Catalog analysis (${kind}) skipped after a ${err instanceof Error ? err.name : 'error'} ` +
        '— the enclosing index/sync operation is unaffected.',
    );
  }
}

/**
 * Recompute both catalogs after a successful index/sync (T047, FR-020). The
 * lifecycle entry point wired into `indexAll`/`sync` (T049), mirroring the
 * advisory embedding pass:
 *   - honors the caller's `AbortSignal` (an aborted pass is a full no-op — no
 *     version advance, no writes);
 *   - fully DORMANT unless ≥1 catalog is opted in — neither enabled ⇒ zero writes,
 *     `graph_write_version` untouched, byte-identical to the pre-feature state
 *     (FR-025/SC-007);
 *   - advances `graph_write_version` as part of the successful graph-update commit
 *     BEFORE analysis runs (R2), so a post-update failure leaves the retained
 *     catalog behind the live token → stale (FR-022);
 *   - dispatches each enabled kind independently through {@link runCatalogKind},
 *     which swallows every failure so analysis can NEVER fail the index (FR-022b).
 *
 * A partial index (`index_state='partial'`) counts as successful — the caller
 * runs this over the committed graph exactly as it does the embedding pass.
 */
export async function maybeRunCatalogAnalysis(
  graph: FlowAnalysisGraph,
  store: SqliteDatabase,
  config: AnalysisConfig,
  signal?: AbortSignal,
  hooks: CatalogAnalysisHooks = {},
): Promise<void> {
  if (signal?.aborted) return; // cancelled before any work — no advance, no writes
  if (!config.flows && !config.clusters) return; // dormancy: nothing opted in

  // Advance the live token BEFORE analysis (R2). Maintained ONLY here, gated on
  // ≥1 enabled catalog above, so a not-opted-in project never advances it.
  graph.queries.advanceGraphWriteVersion();

  const runFlows = hooks.runFlows ?? runFlowAnalysis;
  const runClusters = hooks.runClusters ?? runClusterAnalysis;

  if (config.flows) {
    await runCatalogKind(store, 'flows', signal, () => runFlows(graph, store, signal));
  }
  if (config.clusters) {
    await runCatalogKind(store, 'clusters', signal, () => runClusters(graph, store, signal));
  }
}
