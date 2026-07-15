/**
 * SPEC-011 T045 [US4] — first-run failure surfaces `unavailable` (FR-023, SC-008).
 *
 * A catalog analysis that fails on the FIRST run — with no prior committed
 * catalog — writes ONLY `catalog_meta(kind, NULL, first_run_failed=1)` and reads
 * `unavailable`. It never writes partial content rows, and `unavailable` is
 * distinct from `empty` (a successful run that simply found nothing).
 *
 * Real files + real SQLite temp dirs (no mocking).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { maybeRunCatalogAnalysis, readClusterList, readFlowList } from '../../../src/analysis';
import { cleanupSeeds, edge, file, freshSeed, node, type SeedHandle } from '../flows/helpers';

afterEach(cleanupSeeds);

const BOTH = { flows: true, clusters: true };
const boom = async (): Promise<void> => {
  throw new Error('injected first-run failure');
};

function count(h: SeedHandle, table: string): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('catalog lifecycle — first-run unavailable (T045, FR-023)', () => {
  it('a first-run failure with no prior writes ONLY the unavailable marker', async () => {
    const h = freshSeed();
    for (const p of ['src/a.ts', 'src/b.ts']) file(h, p, 'x');
    node(h, { id: 'fa', name: 'a', kind: 'function', filePath: 'src/a.ts' });
    node(h, { id: 'fb', name: 'b', kind: 'function', filePath: 'src/b.ts' });
    edge(h, 'fa', 'fb', 'calls');

    // Both analyzers fail on the very first run.
    await expect(
      maybeRunCatalogAnalysis(h.graph, h.db, BOTH, undefined, { runFlows: boom, runClusters: boom }),
    ).resolves.toBeUndefined();

    // Reads are unavailable — never partial, never empty-looking.
    const flows = readFlowList(h.db, true, 20, 0);
    expect(flows.state).toBe('unavailable');
    expect(flows.items).toEqual([]);
    const clusters = readClusterList(h.db, true, 1, 20, 0);
    expect(clusters.state).toBe('unavailable');
    expect(clusters.items).toEqual([]);

    // Only the failure marker was written: NULL version, first_run_failed=1.
    const fm = h.db.prepare(`SELECT computed_from_version AS v, first_run_failed AS f FROM catalog_meta WHERE kind='flows'`).get() as { v: number | null; f: number };
    expect(fm).toEqual({ v: null, f: 1 });
    const cm = h.db.prepare(`SELECT computed_from_version AS v, first_run_failed AS f FROM catalog_meta WHERE kind='clusters'`).get() as { v: number | null; f: number };
    expect(cm).toEqual({ v: null, f: 1 });

    // No content rows leaked in.
    expect(count(h, 'flows')).toBe(0);
    expect(count(h, 'flow_steps')).toBe(0);
    expect(count(h, 'clusters')).toBe(0);
    expect(count(h, 'cluster_members')).toBe(0);
  });

  it('distinguishes unavailable (failure) from empty (successful but nothing found)', async () => {
    const h = freshSeed();
    // A graph with indexed files but NO entry points -> a successful, empty flow
    // catalog. `empty`, not `unavailable`.
    for (const p of ['src/a.ts', 'src/b.ts']) file(h, p, 'x');
    node(h, { id: 'fa', name: 'a', kind: 'function', filePath: 'src/a.ts' }); // not exported -> no flow
    node(h, { id: 'fb', name: 'b', kind: 'function', filePath: 'src/b.ts' });
    edge(h, 'fa', 'fb', 'calls');

    await maybeRunCatalogAnalysis(h.graph, h.db, BOTH);

    const flows = readFlowList(h.db, true, 20, 0);
    expect(flows.state).toBe('empty'); // computed successfully, zero flows
    expect(flows.items).toEqual([]);
    const fm = h.db.prepare(`SELECT computed_from_version AS v, first_run_failed AS f FROM catalog_meta WHERE kind='flows'`).get() as { v: number; f: number };
    expect(fm).toEqual({ v: 1, f: 0 }); // a real successful run, not a failure marker

    // Clusters DID find groups (two files with a cross-file edge) -> available.
    expect(readClusterList(h.db, true, 1, 20, 0).state).toBe('available');
  });
});
