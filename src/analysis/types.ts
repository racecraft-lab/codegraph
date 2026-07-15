/**
 * SPEC-011 — Execution Flows & Clusters: shared wire-shape types (T008).
 *
 * This is the SINGLE shared wire-shape source (FR-028a): both the MCP tools
 * (`src/mcp/tools.ts`) and the REST handlers (`src/server/`) render catalog
 * responses from these types, and the cross-surface parity test (T058) asserts
 * the openapi schemas are field-for-field identical to them. Field names here
 * are the contract (`contracts/mcp-tools.md`, `contracts/rest-api.md`).
 */

/**
 * The 3-value provenance WIRE enum for a flow step's incoming edge
 * (FR-008/FR-009). Internal edge provenance maps onto it: tree-sitter/scip →
 * `static`, lsp → `lsp`, heuristic/synthesized → `heuristic`.
 *
 * This MUST NOT reuse the 2-value `Edge.provenance` (`'static' | 'heuristic'`),
 * which collapses `lsp` → `static` and would silently drop the LSP provenance
 * FR-008/FR-009 require.
 */
export type CatalogProvenance = 'static' | 'lsp' | 'heuristic';

/**
 * The 6-value read-time catalog state enum (FR-030). Consumers branch on this
 * structurally; an empty `items` array is NEVER the sole signal of a state.
 *
 * - `available`   — fresh (recorded version == live), content present.
 * - `stale`       — derived: recorded version < live graph_write_version (FR-022).
 * - `empty`       — fresh but zero content rows (e.g. no detectable entry points).
 * - `unavailable` — explicit first-run analysis failure (FR-023).
 * - `disabled`    — the live per-catalog opt-in flag is OFF (FR-025); resolved FIRST.
 * - `not_indexed` — the project itself is not indexed (resolved at the surface).
 */
export type CatalogState =
  | 'available'
  | 'stale'
  | 'empty'
  | 'unavailable'
  | 'disabled'
  | 'not_indexed';

/** Which of the two catalogs a row/probe/read concerns. */
export type CatalogKind = 'flows' | 'clusters';

/** The four statically-detected entry-point kinds (FR-001). */
export type EntryKind = 'route' | 'cli' | 'event' | 'export';

/** The edge class that produced a non-root flow step (FR-008). */
export type FlowStepEdgeKind = 'calls' | 'references';

/**
 * Per-axis truncation flags (FR-007/FR-027). `truncated` (the disjunction) is
 * derived at read time, never stored (data-model.md).
 */
export interface FlowTruncation {
  depth: boolean;
  width: boolean;
  totalSteps: boolean;
}

/** A flow summary row (list surfaces). */
export interface FlowSummary {
  /** Deterministic, root-derived flow id (FR-017a). */
  id: string;
  /** `"<METHOD> <path>"` | CLI command | qualified root symbol (FR-010). */
  name: string;
  entryKind: EntryKind;
  /** Unique steps persisted for this flow. */
  stepCount: number;
  /** depth OR width OR totalSteps (FR-027). */
  truncated: boolean;
}

/** The root symbol of a flow, rendered from denormalized catalog columns. */
export interface FlowRoot {
  nodeId: string;
  name: string;
  kind: string;
}

/**
 * One node within a flow's bounded branching graph. `name`/`kind` are the
 * denormalized catalog columns (FR-022a) — rendered without a live `nodes`
 * join; an explicit placeholder is used if a node id no longer resolves.
 */
export interface FlowStep {
  nodeId: string;
  name: string;
  kind: string;
  /** Hops from the root (0 = root). */
  depth: number;
  /** Edge source in the branching graph; null for the root step. */
  parentNodeId: string | null;
  /** null for the root step (depth 0). */
  edgeKind: FlowStepEdgeKind | null;
  /** null ONLY for the root step; every non-root step carries one (FR-009). */
  provenance: CatalogProvenance | null;
}

/** A single flow's full bounded graph + truncation metadata (`get_flow`). */
export interface FlowDetail {
  id: string;
  name: string;
  entryKind: EntryKind;
  root: FlowRoot;
  steps: FlowStep[];
  /** Disjunction of the three axis flags (FR-027). */
  truncated: boolean;
  truncation: FlowTruncation;
  /** graph_write_version the catalog was computed from. */
  sourceVersion: number;
  state: CatalogState;
}

/** A functional-cluster summary row (list surface). */
export interface ClusterSummary {
  /** Opaque, deterministic, stable cluster id (FR-017a). */
  id: string;
  /** Deterministic label from directory + name tokens (FR-018). */
  canonicalLabel: string;
  /** Optional LLM label, presentation-only; null when unconfigured (FR-019). */
  displayLabel: string | null;
  memberCount: number;
  isSingleton: boolean;
}

/**
 * The shared list envelope for both catalogs and both surfaces
 * (`{ items, total, limit, offset, sourceVersion, state }`). `total` is the
 * match count AFTER any filter (e.g. `minSize`); `limit`/`offset` are the
 * effective (post-clamp) values.
 */
export interface CatalogListResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  sourceVersion: number;
  state: CatalogState;
}

export type FlowListResult = CatalogListResult<FlowSummary>;
export type ClusterListResult = CatalogListResult<ClusterSummary>;
