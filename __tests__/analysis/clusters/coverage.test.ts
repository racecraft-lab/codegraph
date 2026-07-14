/**
 * SPEC-011 T029 [US2] — total coverage + explicit singletons (FR-014, SC-003).
 *
 * Drive `runClusterAnalysis` against a temp DB: every indexed file lands in
 * exactly one cluster; single-file communities persist as explicit
 * `is_singleton=1` clusters (never merged into a synthetic bucket).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runClusterAnalysis } from '../../../src/analysis';
import { freshSeed, cleanupSeeds, node, edge, file, setVersion, type SeedHandle } from '../flows/helpers';

afterEach(cleanupSeeds);

interface ClusterRow { id: string; member_count: number; is_singleton: number }

function readClusters(h: SeedHandle): { clusters: ClusterRow[]; members: Array<{ cluster_id: string; file_path: string }> } {
  return {
    clusters: h.db.prepare('SELECT id, member_count, is_singleton FROM clusters ORDER BY id').all() as ClusterRow[],
    members: h.db.prepare('SELECT cluster_id, file_path FROM cluster_members ORDER BY file_path').all() as Array<{ cluster_id: string; file_path: string }>,
  };
}

describe('runClusterAnalysis coverage (FR-014, SC-003)', () => {
  it('assigns every indexed file to exactly one cluster', () => {
    const h = freshSeed();
    setVersion(h, 1);
    // Two connected files + one isolated file.
    for (const p of ['src/a.ts', 'src/b.ts', 'src/lonely.ts']) file(h, p, 'x');
    node(h, { id: 'fa', name: 'a', kind: 'function', filePath: 'src/a.ts' });
    node(h, { id: 'fb', name: 'b', kind: 'function', filePath: 'src/b.ts' });
    edge(h, 'fa', 'fb', 'calls');

    runClusterAnalysis(h.graph, h.db);
    const { clusters, members } = readClusters(h);

    // Exactly-one-cluster coverage: the member set equals the indexed file set,
    // with no file assigned twice.
    const memberFiles = members.map((m) => m.file_path).sort();
    expect(memberFiles).toEqual(['src/a.ts', 'src/b.ts', 'src/lonely.ts']);
    expect(new Set(memberFiles).size).toBe(memberFiles.length);
    // member_count is consistent with the actual member rows.
    const counts = new Map<string, number>();
    for (const m of members) counts.set(m.cluster_id, (counts.get(m.cluster_id) ?? 0) + 1);
    for (const c of clusters) expect(c.member_count).toBe(counts.get(c.id));
  });

  it('persists a single-file community as an explicit flagged singleton', () => {
    const h = freshSeed();
    setVersion(h, 1);
    for (const p of ['src/a.ts', 'src/b.ts', 'src/lonely.ts']) file(h, p, 'x');
    node(h, { id: 'fa', name: 'a', kind: 'function', filePath: 'src/a.ts' });
    node(h, { id: 'fb', name: 'b', kind: 'function', filePath: 'src/b.ts' });
    edge(h, 'fa', 'fb', 'calls');

    runClusterAnalysis(h.graph, h.db);
    const { clusters, members } = readClusters(h);

    // The lonely file is its own singleton cluster, flagged.
    const lonelyMember = members.find((m) => m.file_path === 'src/lonely.ts')!;
    const lonelyCluster = clusters.find((c) => c.id === lonelyMember.cluster_id)!;
    expect(lonelyCluster.is_singleton).toBe(1);
    expect(lonelyCluster.member_count).toBe(1);
    // A multi-file cluster is NOT flagged a singleton.
    const abCluster = clusters.find((c) => c.member_count > 1);
    expect(abCluster).toBeDefined();
    expect(abCluster!.is_singleton).toBe(0);
  });

  it('flags every file as its own singleton when there are no cross-file edges', () => {
    const h = freshSeed();
    setVersion(h, 1);
    for (const p of ['src/a.ts', 'src/b.ts', 'src/c.ts']) file(h, p, 'x');
    runClusterAnalysis(h.graph, h.db);
    const { clusters } = readClusters(h);
    expect(clusters.length).toBe(3);
    expect(clusters.every((c) => c.is_singleton === 1 && c.member_count === 1)).toBe(true);
  });
});
