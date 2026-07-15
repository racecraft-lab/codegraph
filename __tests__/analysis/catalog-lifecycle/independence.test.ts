/**
 * SPEC-011 T046 [US4] — per-catalog independence + aborted analysis
 * (FR-020/022, edge cases).
 *
 * Each catalog's outcome is independent: one kind's analysis failing never
 * blocks, staleness-taints, or wipes the other — the succeeding kind still swaps
 * fresh (available), the failing kind independently retains prior rows (stale) or
 * marks unavailable (first run). And a cancellation is a catalog no-op: an abort
 * before the swap commit performs no partial write and leaves the prior catalog
 * untouched (an abort after the version advanced derives the prior as stale).
 *
 * Real files + real SQLite temp dirs (no mocking).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { maybeRunCatalogAnalysis, readClusterList, readFlowList } from '../../../src/analysis';
import { cleanupSeeds, edge, file, freshSeed, node, type SeedHandle } from '../flows/helpers';

afterEach(cleanupSeeds);

const BOTH = { flows: true, clusters: true };
const boom = async (): Promise<void> => {
  throw new Error('injected failure for one catalog only');
};

/** One export flow (`handler`) + a multi-file cluster + a singleton. */
function seed(h: SeedHandle): void {
  for (const p of ['src/a.ts', 'src/b.ts', 'src/app.ts']) file(h, p, 'x');
  node(h, { id: 'fa', name: 'a', kind: 'function', filePath: 'src/a.ts' });
  node(h, { id: 'fb', name: 'b', kind: 'function', filePath: 'src/b.ts' });
  node(h, { id: 'handler', name: 'handler', kind: 'function', filePath: 'src/app.ts', isExported: true });
  edge(h, 'fa', 'fb', 'calls');
}

describe('catalog lifecycle — independence + abort (T046, FR-020/022)', () => {
  it('one catalog failing on first run leaves the other free to swap fresh', async () => {
    const h = freshSeed();
    seed(h);

    // flows fails; clusters uses the real analyzer and succeeds. No prior for either.
    await maybeRunCatalogAnalysis(h.graph, h.db, BOTH, undefined, { runFlows: boom });

    // flows -> unavailable (first-run failure); clusters -> available (fresh).
    expect(readFlowList(h.db, true, 20, 0).state).toBe('unavailable');
    const clusters = readClusterList(h.db, true, 1, 20, 0);
    expect(clusters.state).toBe('available');
    expect(clusters.total).toBeGreaterThanOrEqual(1);
    expect(clusters.sourceVersion).toBe(1);

    // Independent metadata: flows failure marker vs clusters success version.
    const fm = h.db.prepare(`SELECT computed_from_version AS v, first_run_failed AS f FROM catalog_meta WHERE kind='flows'`).get() as { v: number | null; f: number };
    expect(fm).toEqual({ v: null, f: 1 });
    const cm = h.db.prepare(`SELECT computed_from_version AS v, first_run_failed AS f FROM catalog_meta WHERE kind='clusters'`).get() as { v: number; f: number };
    expect(cm).toEqual({ v: 1, f: 0 });
  });

  it('with a prior, one kind failing derives stale while the other refreshes available', async () => {
    const h = freshSeed();
    seed(h);

    // Both succeed at v1.
    await maybeRunCatalogAnalysis(h.graph, h.db, BOTH);
    expect(readFlowList(h.db, true, 20, 0).state).toBe('available');

    // Re-index: flows fails (prior retained -> stale), clusters refreshes to v2.
    await maybeRunCatalogAnalysis(h.graph, h.db, BOTH, undefined, { runFlows: boom });

    expect(h.queries.getGraphWriteVersion()).toBe(2);
    const flows = readFlowList(h.db, true, 20, 0);
    expect(flows.state).toBe('stale');
    expect(flows.sourceVersion).toBe(1);
    const clusters = readClusterList(h.db, true, 1, 20, 0);
    expect(clusters.state).toBe('available');
    expect(clusters.sourceVersion).toBe(2);
  });

  it('an already-aborted signal is a complete no-op — no version advance, prior untouched', async () => {
    const h = freshSeed();
    seed(h);

    // Establish a fresh prior at v1.
    await maybeRunCatalogAnalysis(h.graph, h.db, BOTH);
    const flowsBefore = readFlowList(h.db, true, 20, 0);
    const clustersBefore = readClusterList(h.db, true, 1, 20, 0);

    const ac = new AbortController();
    ac.abort();
    await expect(maybeRunCatalogAnalysis(h.graph, h.db, BOTH, ac.signal)).resolves.toBeUndefined();

    // No advance, catalogs identical to before — an aborted pass wrote nothing.
    expect(h.queries.getGraphWriteVersion()).toBe(1);
    const flowsAfter = readFlowList(h.db, true, 20, 0);
    const clustersAfter = readClusterList(h.db, true, 1, 20, 0);
    expect(flowsAfter.state).toBe('available');
    expect(flowsAfter.sourceVersion).toBe(1);
    expect(flowsAfter.total).toBe(flowsBefore.total);
    expect(clustersAfter.state).toBe('available');
    expect(clustersAfter.sourceVersion).toBe(1);
    expect(clustersAfter.total).toBe(clustersBefore.total);
  });

  it('an abort AFTER the version advanced but before the swap leaves the prior derivable as stale', async () => {
    const h = freshSeed();
    seed(h);

    // Fresh prior at v1.
    await maybeRunCatalogAnalysis(h.graph, h.db, BOTH);

    // A flows analyzer that cancels mid-pass (a pre-swap yield-point abort) and
    // returns without swapping. The version already advanced to 2, so the
    // retained prior derives as stale; the abort then skips the clusters kind.
    const ac = new AbortController();
    const abortBeforeSwap = async (): Promise<void> => {
      ac.abort();
    };
    await expect(
      maybeRunCatalogAnalysis(h.graph, h.db, BOTH, ac.signal, { runFlows: abortBeforeSwap }),
    ).resolves.toBeUndefined();

    expect(h.queries.getGraphWriteVersion()).toBe(2);
    // No partial write for flows (analyzer returned without swapping) -> prior
    // retained, derives stale. Clusters was skipped after the abort -> also stale.
    expect(readFlowList(h.db, true, 20, 0).state).toBe('stale');
    expect(readFlowList(h.db, true, 20, 0).sourceVersion).toBe(1);
    expect(readClusterList(h.db, true, 1, 20, 0).state).toBe('stale');
  });
});
