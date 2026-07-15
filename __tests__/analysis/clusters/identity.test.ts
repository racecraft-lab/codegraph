/**
 * SPEC-011 T039 [US3] — stable cluster identity across re-indexes
 * (FR-015/016/017, SC-005).
 *
 * `assignClusterIdentity` (pure): greedy one-to-one Jaccard match against the
 * prior catalog — transfer a prior id when overlap >= 0.5; a split transfers to
 * only the single best descendant (others mint); ties resolve identically every
 * run; overlap < 0.5 mints a new id; first run (no prior) mints all-new.
 *
 * End-to-end (T042 wiring): `runClusterAnalysis` reads the prior catalog pre-swap
 * so a cluster that stays >= 0.5 overlapping keeps its id across a re-index.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  assignClusterIdentity,
  mintClusterId,
  runClusterAnalysis,
} from '../../../src/analysis';
import { freshSeed, cleanupSeeds, node, edge, file, setVersion, type SeedHandle } from '../flows/helpers';

afterEach(cleanupSeeds);

describe('assignClusterIdentity (FR-015/016/017)', () => {
  it('transfers a prior id when the Jaccard overlap is >= 0.5', () => {
    const prior = [{ id: 'cluster:keep', members: ['a', 'b', 'c', 'd'] }];
    const next = [{ members: ['a', 'b', 'c', 'd', 'e'] }]; // Jaccard 4/5 = 0.8
    expect(assignClusterIdentity(next, prior)).toEqual(['cluster:keep']);
  });

  it('mints a new id when the overlap is below 0.5', () => {
    const prior = [{ id: 'cluster:old', members: ['a', 'b', 'c', 'd'] }];
    const next = [{ members: ['a', 'x', 'y', 'z'] }]; // Jaccard 1/7 < 0.5
    const [id] = assignClusterIdentity(next, prior);
    expect(id).not.toBe('cluster:old');
    expect(id).toBe(mintClusterId(['a', 'x', 'y', 'z']));
  });

  it('on a split, transfers the prior id to only the single best-matching descendant', () => {
    const prior = [{ id: 'cluster:split', members: ['a', 'b', 'c', 'd'] }];
    // {a,b,c} overlaps 3/4 = 0.75; {d} overlaps 1/4 = 0.25 (< 0.5).
    const next = [{ members: ['a', 'b', 'c'] }, { members: ['d'] }];
    const ids = assignClusterIdentity(next, prior);
    expect(ids[0]).toBe('cluster:split'); // best descendant keeps the id
    expect(ids[1]).toBe(mintClusterId(['d'])); // the other mints
    // The prior id is used exactly once (one-to-one).
    expect(ids.filter((i) => i === 'cluster:split').length).toBe(1);
  });

  it('breaks an equal-overlap tie deterministically (same winner every run)', () => {
    const prior = [{ id: 'cluster:tie', members: ['a', 'b', 'c', 'd'] }];
    // Both descendants overlap 2/4 = 0.5 — an exact tie.
    const next = [{ members: ['a', 'b'] }, { members: ['c', 'd'] }];
    const run1 = assignClusterIdentity(next, prior);
    const run2 = assignClusterIdentity([{ members: ['c', 'd'] }, { members: ['a', 'b'] }], prior);
    // Exactly one descendant wins the id, and it is the SAME member set both runs.
    expect(run1.filter((i) => i === 'cluster:tie').length).toBe(1);
    const winner1 = next[run1.indexOf('cluster:tie')]!.members.join(',');
    const reordered = [{ members: ['c', 'd'] }, { members: ['a', 'b'] }];
    const winner2 = reordered[run2.indexOf('cluster:tie')]!.members.join(',');
    expect(winner2).toBe(winner1);
  });

  it('matches greedily one-to-one so each prior id is transferred at most once', () => {
    const prior = [
      { id: 'id1', members: ['a', 'b', 'c', 'd'] },
      { id: 'id2', members: ['a', 'b', 'c', 'e'] },
    ];
    const next = [{ members: ['a', 'b', 'c', 'd'] }, { members: ['a', 'b', 'c', 'e'] }];
    const ids = assignClusterIdentity(next, prior);
    expect(ids).toEqual(['id1', 'id2']);
    expect(new Set(ids).size).toBe(2); // no id reused
  });

  it('mints all-new ids on a first run with no prior catalog', () => {
    const next = [{ members: ['a', 'b'] }, { members: ['c'] }];
    expect(assignClusterIdentity(next, [])).toEqual([
      mintClusterId(['a', 'b']),
      mintClusterId(['c']),
    ]);
  });

  it('serializes membership unambiguously — a newline in a path does not alias (P2 review)', () => {
    // A single file literally named "a\nb" must NOT mint the same id as the two
    // files "a" and "b": the old '\n' join made both hash "a\nb" identically. The
    // '\0' separator (a NUL can't appear in a path) disambiguates them.
    expect(mintClusterId(['a\nb'])).not.toBe(mintClusterId(['a', 'b']));
  });

  it('never mints an id equal to a transferred id (swap-safe on a split, FR-017a)', () => {
    // {c,d} originally minted H; it grew to {a,b,c,d} and kept H; now it splits so
    // {a,b} inherits H by tie-break while {c,d} re-forms. A naïve re-mint of {c,d}
    // reproduces H → swapClusters would fail on the duplicate PRIMARY KEY and the
    // whole cluster catalog swap would roll back (stuck stale/unavailable).
    const H = mintClusterId(['c', 'd']);
    const prior = [{ id: H, members: ['a', 'b', 'c', 'd'] }];
    const next = [{ members: ['a', 'b'] }, { members: ['c', 'd'] }];
    const ids = assignClusterIdentity(next, prior);

    expect(ids[0]).toBe(H); // {a,b} inherits H (deterministic tie-break winner)
    expect(ids[1]).not.toBe(H); // {c,d} must NOT collide with the transferred id
    expect(new Set(ids).size).toBe(ids.length); // all ids distinct → swap-safe
    // And the salted fallback is deterministic — byte-identical every run (SC-004).
    expect(assignClusterIdentity(next, prior)).toEqual(ids);
  });
});

// ── End-to-end: identity wired into runClusterAnalysis (T042) ─────────────────

/** Seed a dense K-clique across the given files (one function node per file). */
function seedClique(h: SeedHandle, files: string[]): void {
  for (const p of files) {
    file(h, p, 'x');
    node(h, { id: `n:${p}`, name: p, kind: 'function', filePath: p });
  }
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      edge(h, `n:${files[i]}`, `n:${files[j]}`, 'calls');
    }
  }
}

function clusterIdOfFile(h: SeedHandle, filePath: string): string {
  const row = h.db
    .prepare('SELECT cluster_id FROM cluster_members WHERE file_path = ?')
    .get(filePath) as { cluster_id: string } | undefined;
  return row!.cluster_id;
}

describe('runClusterAnalysis identity transfer (T042, SC-005)', () => {
  it('keeps a cluster id across a re-index that leaves it >= 0.5 overlapping', async () => {
    const h = freshSeed();
    setVersion(h, 1);
    const clique = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];
    seedClique(h, clique);
    file(h, 'src/e.ts', 'x'); // isolated singleton

    await runClusterAnalysis(h.graph, h.db);
    const idBefore = clusterIdOfFile(h, 'src/a.ts');
    // First run with no prior mints the content hash of the sorted members.
    expect(idBefore).toBe(mintClusterId([...clique].sort()));

    // Re-index: add f attached to the whole clique → cluster {a,b,c,d,f}, Jaccard 4/5.
    file(h, 'src/f.ts', 'x');
    node(h, { id: 'n:src/f.ts', name: 'f', kind: 'function', filePath: 'src/f.ts' });
    for (const p of clique) edge(h, 'n:src/f.ts', `n:${p}`, 'calls');

    await runClusterAnalysis(h.graph, h.db);
    const idAfter = clusterIdOfFile(h, 'src/a.ts');

    // The overlapping cluster keeps its identifier (transferred, not re-minted).
    expect(idAfter).toBe(idBefore);
    // And f joined the SAME cluster (total-coverage sanity).
    expect(clusterIdOfFile(h, 'src/f.ts')).toBe(idAfter);
  });
});
