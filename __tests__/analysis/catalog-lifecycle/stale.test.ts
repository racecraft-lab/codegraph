/**
 * SPEC-011 T044 [US4] — stale read after a post-graph-update analysis failure
 * (FR-022/022a/022b, SC-008).
 *
 * `graph_write_version` advances as part of the successful graph-update commit,
 * BEFORE analysis runs. So an analysis that fails AFTER that advance leaves the
 * retained prior catalog's recorded version strictly behind the live token, and
 * it reads `stale` — never failing the enclosing index/sync. The retained rows
 * survive the next index's node churn because refs are by-value and name/kind
 * render from denormalized columns (no live `nodes` join).
 *
 * The failure is injected as a throwing analyzer (a stand-in for any
 * compute/traversal exception or a failed swap-commit) so the lifecycle's
 * error-swallow + staleness derivation are exercised deterministically.
 *
 * Real files + real SQLite temp dirs (no mocking).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { maybeRunCatalogAnalysis, readClusterList, readFlowDetail, readFlowList } from '../../../src/analysis';
import { cleanupSeeds, edge, file, freshSeed, node, type SeedHandle } from '../flows/helpers';

afterEach(cleanupSeeds);

const BOTH = { flows: true, clusters: true };
const boom = async (): Promise<void> => {
  throw new Error('injected analysis failure');
};

function seed(h: SeedHandle): void {
  for (const p of ['src/a.ts', 'src/b.ts', 'src/app.ts']) file(h, p, 'x');
  node(h, { id: 'fa', name: 'a', kind: 'function', filePath: 'src/a.ts' });
  node(h, { id: 'fb', name: 'b', kind: 'function', filePath: 'src/b.ts' });
  node(h, { id: 'handler', name: 'handler', kind: 'function', filePath: 'src/app.ts', isExported: true });
  edge(h, 'fa', 'fb', 'calls');
}

describe('catalog lifecycle — stale after post-update failure (T044, FR-022/022b)', () => {
  it('a failure after the graph update keeps the index successful and the prior catalog readable as stale', async () => {
    const h = freshSeed();
    seed(h);

    // First run succeeds — both catalogs fresh at v1.
    await maybeRunCatalogAnalysis(h.graph, h.db, BOTH);
    expect(readFlowList(h.db, true, 20, 0).state).toBe('available');
    expect(readClusterList(h.db, true, 1, 20, 0).state).toBe('available');
    const flowsV1 = readFlowList(h.db, true, 20, 0).total;

    // Re-index: version advances to 2 BEFORE analysis, then BOTH analyzers fail.
    // The pass MUST NOT throw (indexAll/sync stays successful).
    await expect(
      maybeRunCatalogAnalysis(h.graph, h.db, BOTH, undefined, { runFlows: boom, runClusters: boom }),
    ).resolves.toBeUndefined();

    // The live token advanced (post-update failure), so the retained catalogs
    // derive as stale: recorded v1 < live v2.
    expect(h.queries.getGraphWriteVersion()).toBe(2);

    const flows = readFlowList(h.db, true, 20, 0);
    expect(flows.state).toBe('stale');
    expect(flows.sourceVersion).toBe(1); // recorded < live
    expect(flows.total).toBe(flowsV1); // prior rows retained, not wiped

    const clusters = readClusterList(h.db, true, 1, 20, 0);
    expect(clusters.state).toBe('stale');
    expect(clusters.sourceVersion).toBe(1);
    expect(clusters.total).toBeGreaterThanOrEqual(1);

    // catalog_meta still records the last SUCCESSFUL version, not a failure marker.
    const fm = h.db.prepare(`SELECT computed_from_version AS v, first_run_failed AS f FROM catalog_meta WHERE kind='flows'`).get() as { v: number; f: number };
    expect(fm).toEqual({ v: 1, f: 0 });
  });

  it('the retained stale catalog renders name/kind from denormalized columns after node churn', async () => {
    const h = freshSeed();
    seed(h);

    await maybeRunCatalogAnalysis(h.graph, h.db, BOTH);
    const id = readFlowList(h.db, true, 20, 0).items[0]!.id;

    // Post-update failure -> stale.
    await maybeRunCatalogAnalysis(h.graph, h.db, BOTH, undefined, { runFlows: boom, runClusters: boom });

    // Simulate the next index's per-file node delete/re-insert: the underlying
    // nodes are gone. The stale detail read MUST still resolve — by-value refs +
    // denormalized name/kind, no live `nodes` join, never an error.
    h.db.exec('DELETE FROM nodes');

    const detail = readFlowDetail(h.db, true, id);
    expect(detail.found).toBe(true);
    if (detail.found) {
      expect(detail.flow.state).toBe('stale');
      const root = detail.flow.steps.find((s) => s.depth === 0)!;
      expect(root.name).toBe('handler'); // from denormalized symbol_name
      expect(root.kind).toBe('function'); // from denormalized symbol_kind
    }
  });
});
