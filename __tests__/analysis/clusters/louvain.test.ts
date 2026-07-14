/**
 * SPEC-011 T028 [US2] — deterministic pure-TS Louvain (FR-011/013, SC-004).
 *
 * Membership MUST be byte-identical across repeat runs and across two
 * independently-constructed identical graphs — no random seed, stable vertex
 * order (files by path), deterministic tie-break. Exactly ONE algorithm.
 */
import { describe, it, expect } from 'vitest';
import { louvain } from '../../../src/analysis/clusters/louvain';
import type { FileGraph } from '../../../src/analysis/clusters/file-graph';

/** Two dense triangles {a,b,c} / {x,y,z} joined by a single weak bridge. */
function twoCommunityGraph(): FileGraph {
  return {
    files: ['a.ts', 'b.ts', 'c.ts', 'x.ts', 'y.ts', 'z.ts'],
    edges: [
      { a: 'a.ts', b: 'b.ts', weight: 10 },
      { a: 'a.ts', b: 'c.ts', weight: 10 },
      { a: 'b.ts', b: 'c.ts', weight: 10 },
      { a: 'x.ts', b: 'y.ts', weight: 10 },
      { a: 'x.ts', b: 'z.ts', weight: 10 },
      { a: 'y.ts', b: 'z.ts', weight: 10 },
      { a: 'c.ts', b: 'x.ts', weight: 1 },
    ],
  };
}

describe('deterministic Louvain (FR-013, SC-004)', () => {
  it('produces byte-identical membership across repeat runs of one graph', async () => {
    const g = twoCommunityGraph();
    const first = await louvain(g);
    const second = await louvain(g);
    const third = await louvain(g);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('produces identical membership across two independently-built identical graphs', async () => {
    expect(await louvain(twoCommunityGraph())).toEqual(await louvain(twoCommunityGraph()));
  });

  it('recovers the two dense communities and separates them', async () => {
    const m = await louvain(twoCommunityGraph());
    // {a,b,c} share one community, {x,y,z} another, and the two differ.
    expect(new Set([m[0], m[1], m[2]]).size).toBe(1);
    expect(new Set([m[3], m[4], m[5]]).size).toBe(1);
    expect(m[0]).not.toBe(m[3]);
  });

  it('labels communities canonically by smallest member index (stable)', async () => {
    // The community holding vertex 0 is labeled 0; the next-appearing 1; etc.
    expect(await louvain(twoCommunityGraph())).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('places an isolated file (no cross-file edges) in its own singleton community', async () => {
    const g: FileGraph = {
      files: ['a.ts', 'b.ts', 'lonely.ts'],
      edges: [{ a: 'a.ts', b: 'b.ts', weight: 5 }],
    };
    const m = await louvain(g);
    expect(m[0]).toBe(m[1]); // a,b together
    expect(m[2]).not.toBe(m[0]); // lonely alone
  });

  it('handles the empty graph and the single-vertex graph', async () => {
    expect(await louvain({ files: [], edges: [] })).toEqual([]);
    expect(await louvain({ files: ['solo.ts'], edges: [] })).toEqual([0]);
  });
});
