/**
 * SPEC-011 T015 [US1] — truncation flags (FR-005/006/007, SC-002).
 *
 * Fixed caps 12 (depth) / 20 (width) / 200 (total steps); each axis flag set
 * INDEPENDENTLY; a flow hitting all three records all three; `truncated` is the
 * disjunction; a bounded flow is never presented as complete.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  traceFlow,
  FLOW_CAP_DEPTH,
  FLOW_CAP_STEPS,
  type TraceResult,
} from '../../../src/analysis/flows/tracer';
import type { EntryPoint } from '../../../src/analysis/flows/entry-points';
import { freshSeed, cleanupSeeds, node, edge, type SeedHandle } from './helpers';

afterEach(cleanupSeeds);

function rootAt(id: string): EntryPoint {
  return { entryKind: 'export', rootNodeId: id, rootName: 'root', rootKind: 'function', rootQualifiedName: 'root' };
}
const anyTrunc = (r: TraceResult): boolean => r.truncatedDepth || r.truncatedWidth || r.truncatedSteps;

/** A linear chain root→n1→…→n<len>; returns the root id. */
function chain(h: SeedHandle, len: number): string {
  const root = node(h, { id: 'c0', name: 'c0', kind: 'function', filePath: 'src/chain/00.ts' });
  let prev = root.id;
  for (let i = 1; i <= len; i++) {
    const id = `c${i}`;
    node(h, { id, name: id, kind: 'function', filePath: `src/chain/${String(i).padStart(2, '0')}.ts` });
    edge(h, prev, id, 'calls');
    prev = id;
  }
  return root.id;
}

describe('flow truncation flags', () => {
  it('sets ONLY the depth flag on a deep linear chain', () => {
    const h = freshSeed();
    const rootId = chain(h, FLOW_CAP_DEPTH + 3); // 15 hops
    const r = traceFlow(rootAt(rootId), h.queries);

    expect(r.truncatedDepth).toBe(true);
    expect(r.truncatedWidth).toBe(false);
    expect(r.truncatedSteps).toBe(false);
    // No step exceeds the depth cap; the deepest is exactly the cap.
    const maxDepth = Math.max(...r.steps.map((s) => s.depth));
    expect(maxDepth).toBe(FLOW_CAP_DEPTH);
    expect(r.steps.some((s) => s.depth > FLOW_CAP_DEPTH)).toBe(false);
    expect(anyTrunc(r)).toBe(true); // never presented as complete
  });

  it('sets ONLY the width flag on a shallow fan-out over the width cap', () => {
    const h = freshSeed();
    const root = node(h, { name: 'root', kind: 'function', filePath: 'src/root.ts' });
    for (let i = 0; i < 25; i++) {
      const id = `w${String(i).padStart(2, '0')}`;
      node(h, { id, name: id, kind: 'function', filePath: `src/w/${id}.ts` });
      edge(h, root.id, id, 'calls');
    }
    const r = traceFlow(rootAt(root.id), h.queries);

    expect(r.truncatedWidth).toBe(true);
    expect(r.truncatedDepth).toBe(false);
    expect(r.truncatedSteps).toBe(false);
  });

  it('sets ONLY the total-steps flag on a wide-but-shallow graph over the step cap', () => {
    const h = freshSeed();
    const root = node(h, { name: 'root', kind: 'function', filePath: 'src/root.ts' });
    // 15 children × 20 leaves = 300 unique nodes; every node has ≤20 out-edges.
    for (let i = 0; i < 15; i++) {
      const mid = `m${String(i).padStart(2, '0')}`;
      node(h, { id: mid, name: mid, kind: 'function', filePath: `src/m/${mid}.ts` });
      edge(h, root.id, mid, 'calls');
      for (let j = 0; j < 20; j++) {
        const leaf = `${mid}_l${String(j).padStart(2, '0')}`;
        node(h, { id: leaf, name: leaf, kind: 'function', filePath: `src/m/${mid}/${leaf}.ts` });
        edge(h, mid, leaf, 'calls');
      }
    }
    const r = traceFlow(rootAt(root.id), h.queries);

    expect(r.truncatedSteps).toBe(true);
    expect(r.truncatedWidth).toBe(false);
    expect(r.truncatedDepth).toBe(false);
    expect(r.steps).toHaveLength(FLOW_CAP_STEPS);
  });

  it('records ALL THREE flags when a flow hits every cap at once', () => {
    const h = freshSeed();
    const root = node(h, { name: 'root', kind: 'function', filePath: 'src/root.ts' });
    // A narrow deep spine (depth) whose file sorts FIRST so the width cap keeps it.
    let prev = root.id;
    for (let i = 1; i <= FLOW_CAP_DEPTH + 2; i++) {
      const id = `sp${i}`;
      node(h, { id, name: id, kind: 'function', filePath: `src/a_spine/${String(i).padStart(2, '0')}.ts` });
      edge(h, prev, id, 'calls');
      prev = id;
    }
    // Root fans out over the width cap (26 children incl. the spine root) …
    for (let i = 0; i < 25; i++) {
      const wid = `wide${String(i).padStart(2, '0')}`;
      node(h, { id: wid, name: wid, kind: 'function', filePath: `src/b_wide/${wid}.ts` });
      edge(h, root.id, wid, 'calls');
      // … and each wide child fans to 20 leaves so total visited exceeds the step cap.
      for (let j = 0; j < 20; j++) {
        const leaf = `${wid}_l${String(j).padStart(2, '0')}`;
        node(h, { id: leaf, name: leaf, kind: 'function', filePath: `src/b_wide/${wid}/${leaf}.ts` });
        edge(h, wid, leaf, 'calls');
      }
    }
    const r = traceFlow(rootAt(root.id), h.queries);

    expect(r.truncatedDepth).toBe(true);
    expect(r.truncatedWidth).toBe(true);
    expect(r.truncatedSteps).toBe(true);
    expect(anyTrunc(r)).toBe(true);
  });

  it('leaves all flags false for a small complete flow', () => {
    const h = freshSeed();
    const root = node(h, { name: 'root', kind: 'function', filePath: 'src/root.ts' });
    const a = node(h, { id: 'A', name: 'A', kind: 'function', filePath: 'src/a.ts' });
    edge(h, root.id, a.id, 'calls');
    const r = traceFlow(rootAt(root.id), h.queries);

    expect(anyTrunc(r)).toBe(false);
  });
});
