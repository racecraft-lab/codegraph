/**
 * SPEC-011 (PR #50 round-3 review) — catalog BOOKKEEPING failures are contained.
 *
 * The pre-analyzer probe (`hasAnyCatalogMeta`) + version advance, and each kind's
 * `hasValidPriorCatalog` probe, run outside `runCatalogKind`'s per-kind catch. A
 * SQLite error from any of them must NOT propagate out of maybeRunCatalogAnalysis
 * — advisory analysis must never fail an otherwise-successful index/sync
 * (FR-022b) — and one enabled kind's probe error must not skip the other
 * (FR-020). Simulated by DROPping `catalog_meta` so every probe / marker write
 * raises "no such table". Real SQLite, no mocking.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { maybeRunCatalogAnalysis, swapFlows } from '../../../src/analysis';
import { cleanupSeeds, edge, freshSeed, node, setVersion, type SeedHandle } from '../flows/helpers';

afterEach(cleanupSeeds);

function seedGraph(h: SeedHandle): void {
  node(h, { id: 'r', name: 'GET /x', kind: 'route', filePath: 'src/api.ts' });
  node(h, { id: 'h', name: 'handler', kind: 'function', filePath: 'src/api.ts' });
  edge(h, 'r', 'h', 'references');
}

describe('catalog bookkeeping failure containment (PR #50 review, FR-022b/020)', () => {
  it('a broken catalog_meta probe with both flags OFF does not reject (FR-022b)', async () => {
    const h = freshSeed();
    seedGraph(h);
    h.db.exec('DROP TABLE catalog_meta'); // every catalog_meta probe now raises
    // Both disabled → the dormancy check probes catalog_meta; the raise must be
    // caught by the pre-analysis bookkeeping guard, not thrown out of the pass.
    await expect(
      maybeRunCatalogAnalysis(h.graph, h.db, { flows: false, clusters: false }),
    ).resolves.toBeUndefined();
  });

  it('a broken probe for one enabled kind neither rejects nor skips the other (FR-020)', async () => {
    const h = freshSeed();
    seedGraph(h);
    h.db.exec('DROP TABLE catalog_meta'); // hasValidPriorCatalog + swaps now raise
    // Both enabled → each kind's hasValidPriorCatalog probe raises; the error is
    // contained per-kind (inside runCatalogKind's try) and never propagates out.
    await expect(
      maybeRunCatalogAnalysis(h.graph, h.db, { flows: true, clusters: true }),
    ).resolves.toBeUndefined();
  });

  it('a transient probe failure retains a VALID prior catalog, never overwriting it (FR-022)', async () => {
    const h = freshSeed();
    seedGraph(h);
    setVersion(h, 1);
    // Commit a valid v1 flows catalog (catalog_meta computed_from_version=1).
    swapFlows(
      h.db,
      1,
      [{ id: 'flow:x', name: 'GET /x', entryKind: 'route', rootNodeId: 'r', rootName: 'GET /x', rootKind: 'route', truncatedDepth: false, truncatedWidth: false, truncatedSteps: false }],
      [],
    );
    // Drop ONLY the flows content table: hasValidPriorCatalog's `COUNT(*) FROM
    // flows` probe now throws, but the marker write (INSERT OR REPLACE catalog_meta)
    // would still SUCCEED — the exact transient-probe-error path the round-3 fix
    // otherwise mishandled.
    h.db.exec('DROP TABLE flows');

    await expect(
      maybeRunCatalogAnalysis(h.graph, h.db, { flows: true, clusters: false }),
    ).resolves.toBeUndefined();

    // The valid v1 metadata MUST survive — NOT be overwritten to
    // NULL/first_run_failed (which would flip a servable `stale` catalog to
    // `unavailable` and suppress its retained rows).
    const meta = h.db
      .prepare(`SELECT computed_from_version AS v, first_run_failed AS f FROM catalog_meta WHERE kind='flows'`)
      .get() as { v: number; f: number };
    expect(meta).toEqual({ v: 1, f: 0 });
  });
});
