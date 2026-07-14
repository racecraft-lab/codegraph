/**
 * SPEC-011 T051 [US5] — catalog dormancy (FR-025, SC-007).
 *
 * A project with NEITHER catalog enabled runs no catalog analysis, writes ZERO
 * catalog rows and ZERO catalog metadata (asserted count == 0), leaves
 * `graph_write_version` untouched (never created), and is byte-identical to the
 * pre-feature state with respect to catalog data. The per-catalog opt-in flags
 * (T054) default OFF and only a literal `true` enables — the dormancy foundation.
 *
 * Real files + real SQLite temp dirs (no mocking), per repo convention.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { maybeRunCatalogAnalysis } from '../../../src/analysis';
import {
  clearProjectConfigCache,
  loadAnalysisConfig,
  PROJECT_CONFIG_FILENAME,
} from '../../../src/project-config';
import { cleanupSeeds, edge, file, freshSeed, node, type SeedHandle } from '../flows/helpers';

const OFF = { flows: false, clusters: false };
const CATALOG_TABLES = ['flows', 'flow_steps', 'clusters', 'cluster_members', 'catalog_meta'] as const;

function countRows(h: SeedHandle, table: string): number {
  return Number((h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
}

/** Snapshot the entire project_metadata store as a key→value map (byte-parity probe). */
function metadataMap(h: SeedHandle): Record<string, string> {
  const rows = h.db
    .prepare('SELECT key, value FROM project_metadata ORDER BY key')
    .all() as Array<{ key: string; value: string }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/**
 * A route entry point + a two-file cluster shape: real analysis WOULD produce
 * flow + cluster rows here if either catalog were enabled, so a zero-write
 * assertion is meaningful (not vacuous over an empty graph).
 */
function seed(h: SeedHandle): void {
  for (const p of ['src/a.ts', 'src/b.ts', 'src/routes.ts']) file(h, p, 'x');
  node(h, { id: 'fa', name: 'a', kind: 'function', filePath: 'src/a.ts' });
  node(h, { id: 'fb', name: 'b', kind: 'function', filePath: 'src/b.ts' });
  node(h, { id: 'r', name: 'GET /x', kind: 'route', filePath: 'src/routes.ts' });
  edge(h, 'r', 'fa', 'references');
  edge(h, 'fa', 'fb', 'calls');
}

const tmpDirs: string[] = [];
afterEach(() => {
  cleanupSeeds();
  while (tmpDirs.length) {
    try {
      fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  clearProjectConfigCache();
});

describe('catalog dormancy — both flags off (T051, FR-025/SC-007)', () => {
  it('writes ZERO catalog rows and ZERO catalog metadata when neither catalog is enabled', async () => {
    const h = freshSeed();
    seed(h);
    await maybeRunCatalogAnalysis(h.graph, h.db, OFF);
    for (const t of CATALOG_TABLES) expect(countRows(h, t)).toBe(0);
  });

  it('never creates the graph_write_version token and leaves project_metadata byte-identical', async () => {
    const h = freshSeed();
    seed(h);
    const before = metadataMap(h);
    await maybeRunCatalogAnalysis(h.graph, h.db, OFF);
    // The live token is neither advanced nor even created (a pure-read stays 0).
    expect(h.queries.getGraphWriteVersion()).toBe(0);
    expect(h.queries.getMetadata('graph_write_version')).toBeNull();
    // Byte-identical w.r.t. catalog data: the metadata store is untouched.
    expect(metadataMap(h)).toEqual(before);
  });

  it('is idempotent — repeated dormant passes still write nothing', async () => {
    const h = freshSeed();
    seed(h);
    await maybeRunCatalogAnalysis(h.graph, h.db, OFF);
    await maybeRunCatalogAnalysis(h.graph, h.db, OFF);
    for (const t of CATALOG_TABLES) expect(countRows(h, t)).toBe(0);
    expect(h.queries.getMetadata('graph_write_version')).toBeNull();
  });

  it('an already-aborted dormant pass is likewise a complete no-op', async () => {
    const h = freshSeed();
    seed(h);
    const ac = new AbortController();
    ac.abort();
    await expect(maybeRunCatalogAnalysis(h.graph, h.db, OFF, ac.signal)).resolves.toBeUndefined();
    for (const t of CATALOG_TABLES) expect(countRows(h, t)).toBe(0);
    expect(h.queries.getMetadata('graph_write_version')).toBeNull();
  });

  it('per-catalog opt-in flags default OFF and require a literal true (T054 dormancy foundation)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-analysiscfg-'));
    tmpDirs.push(dir);
    const cfg = path.join(dir, PROJECT_CONFIG_FILENAME);

    // No config file at all → default off.
    clearProjectConfigCache();
    expect(loadAnalysisConfig(dir)).toEqual({ flows: false, clusters: false });

    // Config present but no `analysis` block → default off.
    fs.writeFileSync(cfg, JSON.stringify({ lsp: { enabled: true } }));
    clearProjectConfigCache();
    expect(loadAnalysisConfig(dir)).toEqual({ flows: false, clusters: false });

    // Non-true values (false, truthy-but-non-boolean) never enable.
    fs.writeFileSync(cfg, JSON.stringify({ analysis: { flows: false, clusters: 'yes' } }));
    clearProjectConfigCache();
    expect(loadAnalysisConfig(dir)).toEqual({ flows: false, clusters: false });

    // A literal true enables each catalog independently.
    fs.writeFileSync(cfg, JSON.stringify({ analysis: { flows: true } }));
    clearProjectConfigCache();
    expect(loadAnalysisConfig(dir)).toEqual({ flows: true, clusters: false });

    fs.writeFileSync(cfg, JSON.stringify({ analysis: { flows: true, clusters: true } }));
    clearProjectConfigCache();
    expect(loadAnalysisConfig(dir)).toEqual({ flows: true, clusters: true });
  });
});
