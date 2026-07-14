/**
 * SPEC-011 T060 — SC-004 determinism through the REAL index pipeline (FR-013).
 *
 * The unit-level determinism tests (T019 flows, T028 clusters) drive
 * `runFlowAnalysis` / `runClusterAnalysis` directly against a seeded temp DB.
 * This test closes the loop end-to-end: it materializes the committed
 * benchmark-monorepo (T003) and indexes it through `CodeGraph.indexAll` with
 * BOTH catalogs opted in via `codegraph.json`, exercising the US4 index-time
 * hook (`maybeRunCatalogAnalysis`) exactly as a real `codegraph index` would.
 *
 * Two properties, one per `it`:
 *   1. Re-indexing the SAME project is read-only over the graph (node count
 *      stable — analysis never explodes the node table) and re-derives a
 *      byte-identical catalog. The recomputed catalog's content is identical
 *      row-for-row; only `source_version` legitimately advances (the hook bumps
 *      graph_write_version on every successful index — R2), which is asserted
 *      explicitly rather than masked.
 *   2. Two INDEPENDENT indexes of the identical fixture (fresh clones) produce
 *      byte-identical catalogs INCLUDING source_version — the cross-run/clone
 *      reproducibility SC-004 hinges on.
 *
 * Real files + real SQLite (no mocking); the catalog rows are read back through
 * a second read connection to the project's own DB.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import CodeGraph from '../../src/index';
import { DatabaseConnection, getDatabasePath } from '../../src/db';
import type { SqliteDatabase } from '../../src/db/sqlite-adapter';
import { clearProjectConfigCache } from '../../src/project-config';
import { materializeBenchmarkMonorepo } from './fixtures/benchmark-monorepo/generate';

const dirs: string[] = [];
const graphs: CodeGraph[] = [];

beforeEach(() => {
  clearProjectConfigCache();
});

afterEach(() => {
  while (graphs.length) {
    try {
      graphs.pop()!.close();
    } catch {
      /* ignore */
    }
  }
  while (dirs.length) {
    try {
      fs.rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  clearProjectConfigCache();
});

/** Materialize the benchmark-monorepo with BOTH catalogs opted in. */
function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-det-fixture-'));
  dirs.push(dir);
  materializeBenchmarkMonorepo(dir);
  fs.writeFileSync(
    path.join(dir, 'codegraph.json'),
    JSON.stringify({ analysis: { flows: true, clusters: true } }, null, 2),
  );
  return dir;
}

interface CatalogSnapshot {
  flows: unknown[];
  flowSteps: unknown[];
  clusters: unknown[];
  clusterMembers: unknown[];
  nodeCount: number;
}

const FLOWS_SQL =
  'SELECT id, name, entry_kind, root_node_id, root_name, root_kind, ' +
  'truncated_depth, truncated_width, truncated_steps, source_version FROM flows ORDER BY id';
const STEPS_SQL =
  'SELECT flow_id, node_id, symbol_name, symbol_kind, depth, parent_node_id, edge_kind, provenance ' +
  'FROM flow_steps ORDER BY flow_id, node_id, depth';
const CLUSTERS_SQL =
  'SELECT id, canonical_label, display_label, member_count, is_singleton, source_version ' +
  'FROM clusters ORDER BY id';
const MEMBERS_SQL = 'SELECT cluster_id, file_path FROM cluster_members ORDER BY cluster_id, file_path';

/**
 * Read the full catalog + node count through a fresh read connection. Uses
 * `open` (not `initialize`) so it never re-runs schema/migrations; the caller
 * closes `cg` first so only one connection is live at a time.
 */
function snapshot(dir: string): CatalogSnapshot {
  const conn = DatabaseConnection.open(getDatabasePath(dir));
  try {
    const db: SqliteDatabase = conn.getDb();
    return {
      flows: db.prepare(FLOWS_SQL).all(),
      flowSteps: db.prepare(STEPS_SQL).all(),
      clusters: db.prepare(CLUSTERS_SQL).all(),
      clusterMembers: db.prepare(MEMBERS_SQL).all(),
      nodeCount: (db.prepare('SELECT COUNT(*) AS n FROM nodes').get() as { n: number }).n,
    };
  } finally {
    conn.close();
  }
}

/** Drop `source_version` from parent-catalog rows (it advances every index). */
function stripVersion(rows: unknown[]): unknown[] {
  return rows.map((r) => {
    const c = { ...(r as Record<string, unknown>) };
    delete c.source_version;
    return c;
  });
}

describe('SPEC-011 T060 — determinism through the real index pipeline (SC-004)', () => {
  it('re-indexing the same project is read-only over nodes and re-derives an identical catalog', async () => {
    const dir = makeFixture();
    const cg1 = CodeGraph.initSync(dir);
    graphs.push(cg1);
    await cg1.indexAll();
    cg1.close(); // release the connection so snapshot() can open cleanly
    const first = snapshot(dir);

    const cg2 = CodeGraph.openSync(dir);
    graphs.push(cg2);
    await cg2.indexAll();
    cg2.close();
    const second = snapshot(dir);

    // The fixture is designed to produce both catalogs; a silent empty catalog
    // would make the determinism assertions vacuous.
    expect(first.flows.length).toBeGreaterThan(0);
    expect(first.clusters.length).toBeGreaterThan(0);
    expect(first.clusterMembers.length).toBeGreaterThan(0);

    // Analysis is read-only over the graph: re-index never adds nodes (SC-004 /
    // Constitution V "no node explosion").
    expect(second.nodeCount).toBe(first.nodeCount);

    // Child rows (no source_version column) are byte-identical row-for-row.
    expect(second.flowSteps).toEqual(first.flowSteps);
    expect(second.clusterMembers).toEqual(first.clusterMembers);

    // Parent-catalog content is byte-identical too, EXCEPT source_version, which
    // legitimately advances on the second successful index (R2) — asserted, not
    // masked.
    expect(stripVersion(second.flows)).toEqual(stripVersion(first.flows));
    expect(stripVersion(second.clusters)).toEqual(stripVersion(first.clusters));
    const v1 = (first.flows[0] as { source_version: number }).source_version;
    const v2 = (second.flows[0] as { source_version: number }).source_version;
    expect(v2).toBeGreaterThan(v1);
    // Both catalogs share the same recomputed-from version each run.
    expect((second.clusters[0] as { source_version: number }).source_version).toBe(v2);
  }, 120_000);

  it('two independent indexes of the identical fixture produce byte-identical catalogs', async () => {
    const dirA = makeFixture();
    const cgA = CodeGraph.initSync(dirA);
    graphs.push(cgA);
    await cgA.indexAll();
    cgA.close();
    const a = snapshot(dirA);

    clearProjectConfigCache();
    const dirB = makeFixture();
    const cgB = CodeGraph.initSync(dirB);
    graphs.push(cgB);
    await cgB.indexAll();
    cgB.close();
    const b = snapshot(dirB);

    expect(a.flows.length).toBeGreaterThan(0);
    expect(a.clusters.length).toBeGreaterThan(0);

    // A first index of two identical clones records source_version=1 in both, so
    // EVERY row — parent and child — is byte-identical including source_version.
    expect(b.flows).toEqual(a.flows);
    expect(b.flowSteps).toEqual(a.flowSteps);
    expect(b.clusters).toEqual(a.clusters);
    expect(b.clusterMembers).toEqual(a.clusterMembers);
    // Deterministic extraction ⇒ identical node counts across clones.
    expect(b.nodeCount).toBe(a.nodeCount);
  }, 120_000);
});
