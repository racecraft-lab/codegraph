/**
 * SPEC-011 T014 [US1] — deterministic tracing order (FR-008a).
 *
 * At each step candidate out-edges are visited in a stable TOTAL order (target
 * file path → edge-kind rank → callee qualified name → stable edge key) BEFORE
 * the 20-edge width cap selects survivors; a node reached via multiple parents
 * records the parent of its first visit under that order.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { traceFlow, FLOW_CAP_WIDTH } from '../../../src/analysis/flows/tracer';
import type { EntryPoint } from '../../../src/analysis/flows/entry-points';
import { freshSeed, cleanupSeeds, node, edge, type SeedHandle } from './helpers';

afterEach(cleanupSeeds);

function rootAt(id: string): EntryPoint {
  return { entryKind: 'export', rootNodeId: id, rootName: 'root', rootKind: 'function', rootQualifiedName: 'root' };
}

/** Depth-1 step node ids in tracer (enqueue) order. */
function depth1Order(h: SeedHandle, rootId: string): string[] {
  return traceFlow(rootAt(rootId), h.queries).steps.filter((s) => s.depth === 1).map((s) => s.nodeId);
}

describe('deterministic flow tracing order', () => {
  it('orders candidates by target file path first', () => {
    const h = freshSeed();
    const root = node(h, { name: 'root', kind: 'function', filePath: 'src/root.ts' });
    const a = node(h, { id: 'A', name: 'A', kind: 'function', filePath: 'src/z.ts' });
    const b = node(h, { id: 'B', name: 'B', kind: 'function', filePath: 'src/a.ts' });
    edge(h, root.id, a.id, 'calls');
    edge(h, root.id, b.id, 'calls');

    // 'src/a.ts' (B) sorts before 'src/z.ts' (A).
    expect(depth1Order(h, root.id)).toEqual(['B', 'A']);
  });

  it('breaks a same-file tie by edge-kind rank (calls before references)', () => {
    const h = freshSeed();
    const root = node(h, { name: 'root', kind: 'function', filePath: 'src/root.ts' });
    const x = node(h, { id: 'X', name: 'X', kind: 'function', filePath: 'src/same.ts', qualifiedName: 'src/same.ts::X' });
    const y = node(h, { id: 'Y', name: 'Y', kind: 'function', filePath: 'src/same.ts', qualifiedName: 'src/same.ts::Y' });
    edge(h, root.id, x.id, 'references');
    edge(h, root.id, y.id, 'calls');

    // Same file → 'calls' (rank 0) before 'references' (rank 1): Y before X.
    expect(depth1Order(h, root.id)).toEqual(['Y', 'X']);
  });

  it('records the parent of a node\'s FIRST visit under the total order', () => {
    const h = freshSeed();
    const root = node(h, { name: 'root', kind: 'function', filePath: 'src/root.ts' });
    const a = node(h, { id: 'A', name: 'A', kind: 'function', filePath: 'src/z.ts' });
    const b = node(h, { id: 'B', name: 'B', kind: 'function', filePath: 'src/a.ts' });
    const c = node(h, { id: 'C', name: 'C', kind: 'function', filePath: 'src/mid.ts' });
    edge(h, root.id, a.id, 'calls');
    edge(h, root.id, b.id, 'calls');
    edge(h, a.id, c.id, 'calls');
    edge(h, b.id, c.id, 'calls');

    const steps = traceFlow(rootAt(root.id), h.queries).steps;
    const cStep = steps.find((s) => s.nodeId === 'C');
    expect(cStep).toBeDefined();
    // B ('src/a.ts') is expanded before A ('src/z.ts'), so C's first-visit parent is B.
    expect(cStep!.parentNodeId).toBe('B');
    // C appears exactly once (cycle-safe / single visit).
    expect(steps.filter((s) => s.nodeId === 'C')).toHaveLength(1);
  });

  it('applies the total order BEFORE the width cap selects the first 20 survivors', () => {
    const h = freshSeed();
    const root = node(h, { name: 'root', kind: 'function', filePath: 'src/root.ts' });
    const ids: string[] = [];
    // 25 targets in files src/f00.ts … src/f24.ts. Insert in REVERSE so insertion
    // order can't accidentally satisfy the assertion.
    for (let i = 24; i >= 0; i--) {
      const fp = `src/f${String(i).padStart(2, '0')}.ts`;
      const id = `T${String(i).padStart(2, '0')}`;
      node(h, { id, name: id, kind: 'function', filePath: fp });
      edge(h, root.id, id, 'calls');
    }
    for (let i = 0; i < 20; i++) ids.push(`T${String(i).padStart(2, '0')}`);

    const res = traceFlow(rootAt(root.id), h.queries);
    const kept = res.steps.filter((s) => s.depth === 1).map((s) => s.nodeId);
    expect(kept).toHaveLength(FLOW_CAP_WIDTH);
    // The survivors are the FIRST 20 in total order (f00…f19), not f05…f24.
    expect(kept).toEqual(ids);
    expect(res.truncatedWidth).toBe(true);
  });
});
