/**
 * SPEC-011 T027 [US2] — undirected weighted file-graph build (FR-011/012).
 *
 * Files are vertices; each cross-file `calls`/`imports` edge counts as weight 1;
 * parallel evidence between the same file pair SUMS; self-loops (same-file edges)
 * are dropped; non-call/import edge kinds do not contribute.
 *
 * Real temp SQLite (no mocking) via the flow-analysis seeder — the file graph
 * reads the same graph surface (`queries`) the real index-time pass will.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildFileGraph } from '../../../src/analysis/clusters/file-graph';
import { freshSeed, cleanupSeeds, node, edge, file } from '../flows/helpers';

afterEach(cleanupSeeds);

/** Weight of the undirected pair {x,y} in the built file graph, or 0. */
function pairWeight(edges: Array<{ a: string; b: string; weight: number }>, x: string, y: string): number {
  const [a, b] = x < y ? [x, y] : [y, x];
  return edges.find((e) => e.a === a && e.b === b)?.weight ?? 0;
}

describe('buildFileGraph (FR-011/012)', () => {
  it('makes every indexed file a vertex, in stable path order', () => {
    const h = freshSeed();
    file(h, 'src/b.ts', 'x');
    file(h, 'src/a.ts', 'x');
    file(h, 'src/c.ts', 'x');
    const fg = buildFileGraph(h.queries);
    expect(fg.files).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('weights each cross-file call/import as 1 and SUMS parallel evidence', () => {
    const h = freshSeed();
    file(h, 'src/a.ts', 'x');
    file(h, 'src/b.ts', 'x');
    node(h, { id: 'fa', name: 'funcA', kind: 'function', filePath: 'src/a.ts' });
    node(h, { id: 'fb', name: 'funcB', kind: 'function', filePath: 'src/b.ts' });
    // Two distinct cross-file evidences between the SAME pair → weight sums to 2.
    edge(h, 'fa', 'fb', 'calls');
    edge(h, 'fa', 'fb', 'imports');
    const fg = buildFileGraph(h.queries);
    expect(pairWeight(fg.edges, 'src/a.ts', 'src/b.ts')).toBe(2);
  });

  it('folds both directions of evidence into one undirected weight', () => {
    const h = freshSeed();
    file(h, 'src/a.ts', 'x');
    file(h, 'src/b.ts', 'x');
    node(h, { id: 'fa', name: 'funcA', kind: 'function', filePath: 'src/a.ts' });
    node(h, { id: 'fb', name: 'funcB', kind: 'function', filePath: 'src/b.ts' });
    edge(h, 'fa', 'fb', 'calls'); // a → b
    edge(h, 'fb', 'fa', 'calls'); // b → a
    const fg = buildFileGraph(h.queries);
    // Undirected: a single pair {a,b} with the two directions summed.
    expect(fg.edges.length).toBe(1);
    expect(pairWeight(fg.edges, 'src/a.ts', 'src/b.ts')).toBe(2);
  });

  it('drops self-loops (same-file edges never become a pair)', () => {
    const h = freshSeed();
    file(h, 'src/a.ts', 'x');
    node(h, { id: 'a1', name: 'a1', kind: 'function', filePath: 'src/a.ts' });
    node(h, { id: 'a2', name: 'a2', kind: 'function', filePath: 'src/a.ts' });
    edge(h, 'a1', 'a2', 'calls'); // same file
    const fg = buildFileGraph(h.queries);
    expect(fg.edges.some((e) => e.a === e.b)).toBe(false);
    expect(fg.edges.length).toBe(0);
  });

  it('ignores edge kinds other than calls/imports', () => {
    const h = freshSeed();
    file(h, 'src/a.ts', 'x');
    file(h, 'src/b.ts', 'x');
    node(h, { id: 'fa', name: 'funcA', kind: 'function', filePath: 'src/a.ts' });
    node(h, { id: 'fb', name: 'funcB', kind: 'function', filePath: 'src/b.ts' });
    edge(h, 'fa', 'fb', 'references');
    edge(h, 'fa', 'fb', 'extends');
    const fg = buildFileGraph(h.queries);
    expect(pairWeight(fg.edges, 'src/a.ts', 'src/b.ts')).toBe(0);
    expect(fg.edges.length).toBe(0);
  });
});
