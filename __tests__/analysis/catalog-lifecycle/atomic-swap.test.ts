/**
 * SPEC-011 T043 [US4] — atomic swap / no-torn-read across the lifecycle
 * (FR-021/021a).
 *
 * A catalog recompute driven through `maybeRunCatalogAnalysis` swaps each kind in
 * ONE atomic transaction (DELETE + INSERT + meta upsert). A read is never torn:
 * every composite read (list total+slice, get_flow header+steps, the state probe)
 * derives from a SINGLE consistent generation, and a second recompute fully
 * replaces the first with zero cross-generation remnants. node:sqlite is
 * synchronous single-connection, so true wall-clock concurrency can't be staged
 * in-process; the observable proxy asserted here is single-generation
 * consistency — the property the single-fetch reads + atomic swap guarantee on
 * BOTH surfaces (MCP in the daemon, REST forwarding to the same daemon, one
 * topology).
 *
 * Real files + real SQLite temp dirs (no mocking).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { maybeRunCatalogAnalysis, readClusterList, readFlowDetail, readFlowList } from '../../../src/analysis';
import { cleanupSeeds, edge, file, freshSeed, node, type SeedHandle } from '../flows/helpers';

afterEach(cleanupSeeds);

const BOTH = { flows: true, clusters: true };

/** A graph that yields exactly one export flow (`handler`) plus multi + singleton clusters. */
function seed(h: SeedHandle): void {
  for (const p of ['src/a.ts', 'src/b.ts', 'src/app.ts']) file(h, p, 'x');
  node(h, { id: 'fa', name: 'a', kind: 'function', filePath: 'src/a.ts' });
  node(h, { id: 'fb', name: 'b', kind: 'function', filePath: 'src/b.ts' });
  node(h, { id: 'handler', name: 'handler', kind: 'function', filePath: 'src/app.ts', isExported: true });
  edge(h, 'fa', 'fb', 'calls');
}

function count(h: SeedHandle, table: string): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}
function meta(h: SeedHandle, kind: string): { v: number | null; f: number } {
  return h.db
    .prepare(`SELECT computed_from_version AS v, first_run_failed AS f FROM catalog_meta WHERE kind='${kind}'`)
    .get() as { v: number | null; f: number };
}

describe('catalog lifecycle — atomic swap / no torn read (T043, FR-021/021a)', () => {
  it('computes both catalogs through the lifecycle; every composite read reflects one consistent generation', async () => {
    const h = freshSeed();
    seed(h);

    await maybeRunCatalogAnalysis(h.graph, h.db, BOTH);

    // graph_write_version advanced once (0 -> 1), BEFORE analysis, and each
    // catalog recorded that exact version — a single fresh generation.
    expect(h.queries.getGraphWriteVersion()).toBe(1);
    expect(meta(h, 'flows')).toEqual({ v: 1, f: 0 });
    expect(meta(h, 'clusters')).toEqual({ v: 1, f: 0 });

    // List reads are available and internally consistent (total === materialized rows).
    const flows = readFlowList(h.db, true, 20, 0);
    expect(flows.state).toBe('available');
    expect(flows.total).toBe(count(h, 'flows'));
    expect(flows.total).toBeGreaterThanOrEqual(1);
    expect(flows.items.length).toBe(flows.total);
    expect(flows.sourceVersion).toBe(1);

    const clusters = readClusterList(h.db, true, 1, 20, 0);
    expect(clusters.state).toBe('available');
    expect(clusters.total).toBe(count(h, 'clusters'));
    expect(clusters.total).toBeGreaterThanOrEqual(1);
    expect(clusters.sourceVersion).toBe(1);

    // get_flow header + steps come back paired from the same generation (a torn
    // read would pair a header with another generation's steps or none).
    const detail = readFlowDetail(h.db, true, flows.items[0]!.id);
    expect(detail.found).toBe(true);
    if (detail.found) {
      expect(detail.flow.state).toBe('available');
      expect(detail.flow.sourceVersion).toBe(1);
      const root = detail.flow.steps.find((s) => s.depth === 0)!;
      expect(root).toBeDefined();
      expect(root.provenance).toBeNull(); // root carries no incoming edge
    }

    // No row escapes the single generation: every flow/cluster row carries v1.
    const flowVersions = h.db.prepare('SELECT DISTINCT source_version AS v FROM flows').all() as Array<{ v: number }>;
    expect(flowVersions).toEqual([{ v: 1 }]);
    const clusterVersions = h.db.prepare('SELECT DISTINCT source_version AS v FROM clusters').all() as Array<{ v: number }>;
    expect(clusterVersions).toEqual([{ v: 1 }]);
  });

  it('a second recompute fully replaces the prior generation with zero remnants', async () => {
    const h = freshSeed();
    seed(h);

    await maybeRunCatalogAnalysis(h.graph, h.db, BOTH);
    const flows1 = count(h, 'flows');
    const steps1 = count(h, 'flow_steps');
    const clusters1 = count(h, 'clusters');
    const members1 = count(h, 'cluster_members');

    // Re-index of the SAME graph: version advances, both catalogs recompute.
    await maybeRunCatalogAnalysis(h.graph, h.db, BOTH);

    expect(h.queries.getGraphWriteVersion()).toBe(2);
    expect(meta(h, 'flows')).toEqual({ v: 2, f: 0 });
    expect(meta(h, 'clusters')).toEqual({ v: 2, f: 0 });

    // Counts are stable (no doubling) and EVERY row carries the new version —
    // the DELETE+INSERT swap left no v1 rows behind (no cross-generation remnant).
    expect(count(h, 'flows')).toBe(flows1);
    expect(count(h, 'flow_steps')).toBe(steps1);
    expect(count(h, 'clusters')).toBe(clusters1);
    expect(count(h, 'cluster_members')).toBe(members1);
    expect(h.db.prepare('SELECT DISTINCT source_version AS v FROM flows').all()).toEqual([{ v: 2 }]);
    expect(h.db.prepare('SELECT DISTINCT source_version AS v FROM clusters').all()).toEqual([{ v: 2 }]);

    // Reads reflect the fresh generation.
    expect(readFlowList(h.db, true, 20, 0).state).toBe('available');
    expect(readFlowList(h.db, true, 20, 0).sourceVersion).toBe(2);
    expect(readClusterList(h.db, true, 1, 20, 0).sourceVersion).toBe(2);
  });
});
