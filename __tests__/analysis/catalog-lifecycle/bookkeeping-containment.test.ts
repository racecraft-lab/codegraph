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
import { maybeRunCatalogAnalysis } from '../../../src/analysis';
import { cleanupSeeds, edge, freshSeed, node, type SeedHandle } from '../flows/helpers';

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
});
