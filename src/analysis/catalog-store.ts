/**
 * SPEC-011 — Execution Flows & Clusters: catalog persistence substrate.
 *
 * The catalog store owns every read and write of the five catalog tables. It
 * runs inside the per-project daemon; the MCP tools call it directly and the
 * REST endpoints forward to the same daemon (SPEC-005 FR-002), so both surfaces
 * share ONE read path and cannot drift (FR-028/data-model.md).
 *
 * Three primitives:
 *   - the atomic single-transaction per-kind swap (T009, FR-021);
 *   - single-snapshot composite reads (T010, FR-021a);
 *   - read-time 6-value state resolution (T011, FR-022/023/025/030).
 */

import type { SqliteDatabase } from '../db/sqlite-adapter';
import type {
  CatalogKind,
  CatalogProvenance,
  CatalogState,
  ClusterListResult,
  ClusterSummary,
  EntryKind,
  FlowDetail,
  FlowListResult,
  FlowStep,
  FlowStepEdgeKind,
  FlowSummary,
} from './types';

/**
 * A flow's full detail MINUS the read-time `state` (which needs the live opt-in
 * flag, resolved by the surface/T011). The composite read produces this; the
 * caller attaches `state`.
 */
export type FlowDetailBase = Omit<FlowDetail, 'state'>;

/** The list envelope minus the read-time `state` (attached by the caller). */
export type FlowPage = Omit<FlowListResult, 'state'>;
export type ClusterPage = Omit<ClusterListResult, 'state'>;

// ── Persistence row-input shapes (internal; the wire shapes live in types.ts) ─

/** A `flows` row to persist (source_version is applied by the swap). */
export interface FlowRow {
  id: string;
  name: string;
  entryKind: EntryKind;
  rootNodeId: string;
  rootName: string;
  rootKind: string;
  truncatedDepth: boolean;
  truncatedWidth: boolean;
  truncatedSteps: boolean;
}

/** A `flow_steps` row to persist. Root step (depth 0) carries nulls. */
export interface FlowStepRow {
  flowId: string;
  nodeId: string;
  symbolName: string;
  symbolKind: string;
  depth: number;
  parentNodeId: string | null;
  edgeKind: FlowStepEdgeKind | null;
  provenance: CatalogProvenance | null;
}

/** A `clusters` row to persist (source_version is applied by the swap). */
export interface ClusterRow {
  id: string;
  canonicalLabel: string;
  displayLabel: string | null;
  memberCount: number;
  isSingleton: boolean;
}

/** A `cluster_members` row to persist. */
export interface ClusterMemberRow {
  clusterId: string;
  filePath: string;
}

// ── T009 — atomic single-transaction swap (FR-021) ────────────────────────────

/**
 * Atomically replace the FLOWS catalog: one transaction deletes the prior
 * flow_steps + flows rows, inserts the freshly computed rows, and upserts
 * `catalog_meta('flows', version, first_run_failed=0)` (data-model.md). No
 * generation-tagged rows and no multi-generation retention — a concurrent reader
 * under WAL snapshot isolation sees either the complete prior catalog or the
 * complete new one. If any insert raises, SQLite rolls the whole transaction
 * back and the prior catalog is retained untouched (the FR-022b mechanism for a
 * failed swap-commit).
 */
export function swapFlows(
  db: SqliteDatabase,
  version: number,
  flows: FlowRow[],
  steps: FlowStepRow[],
): void {
  db.transaction(() => {
    db.exec('DELETE FROM flow_steps');
    db.exec('DELETE FROM flows');
    const insFlow = db.prepare(
      `INSERT INTO flows
         (id, name, entry_kind, root_node_id, root_name, root_kind,
          truncated_depth, truncated_width, truncated_steps, source_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const f of flows) {
      insFlow.run(
        f.id,
        f.name,
        f.entryKind,
        f.rootNodeId,
        f.rootName,
        f.rootKind,
        f.truncatedDepth ? 1 : 0,
        f.truncatedWidth ? 1 : 0,
        f.truncatedSteps ? 1 : 0,
        version,
      );
    }
    const insStep = db.prepare(
      `INSERT INTO flow_steps
         (flow_id, node_id, symbol_name, symbol_kind, depth, parent_node_id, edge_kind, provenance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const s of steps) {
      insStep.run(
        s.flowId,
        s.nodeId,
        s.symbolName,
        s.symbolKind,
        s.depth,
        s.parentNodeId,
        s.edgeKind,
        s.provenance,
      );
    }
    db.prepare(
      `INSERT OR REPLACE INTO catalog_meta (kind, computed_from_version, first_run_failed)
       VALUES ('flows', ?, 0)`,
    ).run(version);
  })();
}

/**
 * Atomically replace the CLUSTERS catalog — the flows swap's twin over
 * cluster_members + clusters + `catalog_meta('clusters', version, 0)`. Same
 * all-or-nothing guarantee (FR-021); each catalog kind swaps independently
 * (FR-020) so one kind's outcome never affects the other's.
 */
export function swapClusters(
  db: SqliteDatabase,
  version: number,
  clusters: ClusterRow[],
  members: ClusterMemberRow[],
): void {
  db.transaction(() => {
    db.exec('DELETE FROM cluster_members');
    db.exec('DELETE FROM clusters');
    const insCluster = db.prepare(
      `INSERT INTO clusters
         (id, canonical_label, display_label, member_count, is_singleton, source_version)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const c of clusters) {
      insCluster.run(c.id, c.canonicalLabel, c.displayLabel, c.memberCount, c.isSingleton ? 1 : 0, version);
    }
    const insMember = db.prepare(
      `INSERT INTO cluster_members (cluster_id, file_path) VALUES (?, ?)`,
    );
    for (const m of members) {
      insMember.run(m.clusterId, m.filePath);
    }
    db.prepare(
      `INSERT OR REPLACE INTO catalog_meta (kind, computed_from_version, first_run_failed)
       VALUES ('clusters', ?, 0)`,
    ).run(version);
  })();
}

/**
 * Record an explicit FIRST-RUN analysis failure for `kind` (FR-023): a
 * `catalog_meta` row with a NULL `computed_from_version` and `first_run_failed=1`.
 * The read-state resolver maps this to `unavailable` — never partial/empty-looking.
 *
 * Called by the lifecycle ONLY when a kind's analysis fails with NO prior
 * successfully-committed catalog (T048); a failure WITH a prior instead leaves
 * the prior untouched so it derives as stale (FR-022b). `INSERT OR REPLACE`
 * makes a repeated first-run failure idempotent.
 */
export function markFirstRunFailed(db: SqliteDatabase, kind: CatalogKind): void {
  db.prepare(
    `INSERT OR REPLACE INTO catalog_meta (kind, computed_from_version, first_run_failed)
     VALUES (?, NULL, 1)`,
  ).run(kind);
}

// ── T010 — single-snapshot composite reads (FR-021a) ──────────────────────────

/**
 * One catalog's read-state inputs, fetched in ONE statement (no torn
 * cross-generation probe under a concurrent swap). `hasMeta` distinguishes a
 * never-computed catalog (no row) from a computed one; `contentCount` is the
 * number of catalog ENTRIES (flows / clusters), distinguishing available from
 * available-but-empty.
 */
export interface CatalogProbe {
  graphWriteVersion: number;
  computedFromVersion: number | null;
  firstRunFailed: boolean;
  hasMeta: boolean;
  contentCount: number;
}

function parseVersion(raw: unknown): number {
  const n = raw === null || raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * (c) The read-state probe (FR-021a): the `catalog_meta` row, the content-row
 * count, and the live `graph_write_version` in a SINGLE statement (scalar
 * subqueries), so a concurrent swap cannot tear it. The content table is chosen
 * from a two-value whitelist (never interpolated user input).
 */
export function probeCatalog(db: SqliteDatabase, kind: CatalogKind): CatalogProbe {
  const contentTable = kind === 'flows' ? 'flows' : 'clusters';
  const row = db
    .prepare(
      `SELECT
         (SELECT value FROM project_metadata WHERE key = 'graph_write_version') AS gwv,
         (SELECT computed_from_version FROM catalog_meta WHERE kind = @kind) AS cfv,
         (SELECT first_run_failed FROM catalog_meta WHERE kind = @kind) AS frf,
         (SELECT COUNT(*) FROM catalog_meta WHERE kind = @kind) AS has_meta,
         (SELECT COUNT(*) FROM ${contentTable}) AS content_count`,
    )
    .get({ kind }) as {
    gwv: string | null;
    cfv: number | null;
    frf: number | null;
    has_meta: number;
    content_count: number;
  };
  return {
    graphWriteVersion: parseVersion(row.gwv),
    computedFromVersion: row.cfv === null || row.cfv === undefined ? null : Number(row.cfv),
    firstRunFailed: row.frf === 1,
    hasMeta: row.has_meta > 0,
    contentCount: Number(row.content_count),
  };
}

interface FlowSummaryRow {
  id: string;
  name: string;
  entry_kind: string;
  truncated_depth: number;
  truncated_width: number;
  truncated_steps: number;
  source_version: number;
  step_count: number;
}

/**
 * (a) The flow list envelope (FR-021a): ONE full fetch (deterministic sort:
 * name BINARY, then id), then slice the requested page in JS — `total` is the
 * full match count, never a separately-issued COUNT. `stepCount` is a
 * per-flow subquery in the same statement; `sourceVersion` comes from the same
 * snapshot's rows. State is attached by the caller (T011).
 */
export function pageFlows(db: SqliteDatabase, limit: number, offset: number): FlowPage {
  const rows = db
    .prepare(
      `SELECT f.id, f.name, f.entry_kind,
              f.truncated_depth, f.truncated_width, f.truncated_steps, f.source_version,
              (SELECT COUNT(*) FROM flow_steps s WHERE s.flow_id = f.id) AS step_count
         FROM flows f
        ORDER BY f.name COLLATE BINARY, f.id`,
    )
    .all() as FlowSummaryRow[];
  const first = rows[0];
  const items: FlowSummary[] = rows.slice(offset, offset + limit).map((r) => ({
    id: r.id,
    name: r.name,
    entryKind: r.entry_kind as EntryKind,
    stepCount: Number(r.step_count),
    truncated: r.truncated_depth === 1 || r.truncated_width === 1 || r.truncated_steps === 1,
  }));
  return { items, total: rows.length, limit, offset, sourceVersion: first ? first.source_version : 0 };
}

interface FlowDetailRow {
  id: string;
  name: string;
  entry_kind: string;
  root_node_id: string;
  root_name: string;
  root_kind: string;
  truncated_depth: number;
  truncated_width: number;
  truncated_steps: number;
  source_version: number;
  node_id: string | null;
  symbol_name: string | null;
  symbol_kind: string | null;
  depth: number | null;
  parent_node_id: string | null;
  edge_kind: string | null;
  provenance: string | null;
}

/**
 * (b) The `get_flow` detail read (FR-021a): the flow header and its `flow_steps`
 * from ONE LEFT JOIN, so a concurrent swap cannot pair a header with another
 * generation's steps. Steps are ordered by depth then node id for determinism.
 * name/kind render from the denormalized catalog columns (FR-022a) — no live
 * `nodes` join. Returns null for an unknown id.
 */
export function getFlowDetail(db: SqliteDatabase, id: string): FlowDetailBase | null {
  const rows = db
    .prepare(
      `SELECT f.id, f.name, f.entry_kind, f.root_node_id, f.root_name, f.root_kind,
              f.truncated_depth, f.truncated_width, f.truncated_steps, f.source_version,
              s.node_id, s.symbol_name, s.symbol_kind, s.depth, s.parent_node_id, s.edge_kind, s.provenance
         FROM flows f
         LEFT JOIN flow_steps s ON s.flow_id = f.id
        WHERE f.id = @id
        ORDER BY s.depth, s.node_id`,
    )
    .all({ id }) as FlowDetailRow[];
  const head = rows[0];
  if (!head) return null;
  const steps: FlowStep[] = rows
    .filter((r) => r.node_id !== null)
    .map((r) => ({
      nodeId: r.node_id!,
      name: r.symbol_name!,
      kind: r.symbol_kind!,
      depth: r.depth!,
      parentNodeId: r.parent_node_id,
      edgeKind: r.edge_kind as FlowStepEdgeKind | null,
      provenance: r.provenance as CatalogProvenance | null,
    }));
  const truncation = {
    depth: head.truncated_depth === 1,
    width: head.truncated_width === 1,
    totalSteps: head.truncated_steps === 1,
  };
  return {
    id: head.id,
    name: head.name,
    entryKind: head.entry_kind as EntryKind,
    root: { nodeId: head.root_node_id, name: head.root_name, kind: head.root_kind },
    steps,
    truncated: truncation.depth || truncation.width || truncation.totalSteps,
    truncation,
    sourceVersion: head.source_version,
  };
}

interface ClusterSummaryRow {
  id: string;
  canonical_label: string;
  display_label: string | null;
  member_count: number;
  is_singleton: number;
  source_version: number;
}

/**
 * (a) The cluster list envelope (FR-021a): ONE full fetch (deterministic sort:
 * member_count desc, canonicalLabel BINARY asc, id), the `minSize` filter
 * applied in the WHERE so `total` reflects the post-filter count, then slice the
 * page in JS. State is attached by the caller (T011).
 */
export function pageClusters(
  db: SqliteDatabase,
  minSize: number,
  limit: number,
  offset: number,
): ClusterPage {
  const rows = db
    .prepare(
      `SELECT id, canonical_label, display_label, member_count, is_singleton, source_version
         FROM clusters
        WHERE member_count >= @minSize
        ORDER BY member_count DESC, canonical_label COLLATE BINARY ASC, id`,
    )
    .all({ minSize }) as ClusterSummaryRow[];
  const first = rows[0];
  const items: ClusterSummary[] = rows.slice(offset, offset + limit).map((r) => ({
    id: r.id,
    canonicalLabel: r.canonical_label,
    displayLabel: r.display_label,
    memberCount: r.member_count,
    isSingleton: r.is_singleton === 1,
  }));
  return { items, total: rows.length, limit, offset, sourceVersion: first ? first.source_version : 0 };
}

/** A committed cluster's id + its sorted member file paths (prior-membership read). */
export interface ClusterMembership {
  id: string;
  members: string[];
}

/**
 * Read the CURRENTLY-committed clusters + their members, for the identity
 * transfer's pre-swap prior-membership read (T042, FR-017a). One LEFT JOIN
 * (single snapshot), ordered so each cluster's members come back sorted. Returns
 * an empty array when no clusters catalog has been committed yet (first run).
 */
export function readClusterMembership(db: SqliteDatabase): ClusterMembership[] {
  const rows = db
    .prepare(
      `SELECT c.id AS id, m.file_path AS file_path
         FROM clusters c
         LEFT JOIN cluster_members m ON m.cluster_id = c.id
        ORDER BY c.id, m.file_path`,
    )
    .all() as Array<{ id: string; file_path: string | null }>;
  const byId = new Map<string, string[]>();
  for (const r of rows) {
    let members = byId.get(r.id);
    if (!members) {
      members = [];
      byId.set(r.id, members);
    }
    if (r.file_path !== null) members.push(r.file_path);
  }
  return [...byId.entries()].map(([id, members]) => ({ id, members }));
}

// ── T011 — read-time 6-value state resolution (FR-022/023/025/030) ────────────

/**
 * Resolve the read-time catalog `state` from the live per-catalog opt-in flag
 * and a single-snapshot {@link CatalogProbe}. The opt-in flag is consulted FIRST
 * (a previously-computed-but-now-disabled catalog reads `disabled`, its retained
 * rows inert — FR-025). Staleness is DERIVED here (recorded < live), never
 * stored (FR-022).
 *
 * `not_indexed` is NOT produced here — it is resolved at the surface (no index
 * at all), before this function is reached.
 */
export function resolveState(enabled: boolean, probe: CatalogProbe): CatalogState {
  // 1. Live opt-in flag OFF — retained rows/metadata are inert (FR-025).
  if (!enabled) return 'disabled';
  // 2. No catalog_meta row — never computed (feature off / not yet run).
  if (!probe.hasMeta) return 'disabled';
  // 3. Explicit first-run-failure marker (FR-023): row with a null version.
  if (probe.firstRunFailed || probe.computedFromVersion === null) return 'unavailable';
  // 4. Derived staleness (FR-022): the recorded version trails the live token.
  if (probe.computedFromVersion < probe.graphWriteVersion) return 'stale';
  // 5/6. Fresh (recorded == live): available-but-empty vs available.
  return probe.contentCount === 0 ? 'empty' : 'available';
}
