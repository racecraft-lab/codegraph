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

  it('does NOT set truncatedWidth when the over-cap edges all target visited/duplicate nodes', () => {
    const h = freshSeed();
    const root = node(h, { id: 'root', name: 'root', kind: 'function', filePath: 'src/root.ts' });
    // 21 self-call edges root→root at distinct lines (so the unique edge index
    // keeps them all) — over the width cap, but every target is the already-
    // visited root, so nothing is added and no width truncation occurred.
    for (let i = 0; i < 21; i++) edge(h, root.id, root.id, 'calls', undefined, i + 1);
    const r = traceFlow(rootAt(root.id), h.queries);

    expect(r.truncatedWidth).toBe(false); // was true before the fix (raw edge count)
    expect(anyTrunc(r)).toBe(false); // fully explored — nothing was dropped
    expect(r.steps).toHaveLength(1); // just the root
  });

  it('does NOT set truncatedWidth when a KEPT subtree reaches the dropped target', () => {
    const h = freshSeed();
    const root = node(h, { id: 'R', name: 'R', kind: 'function', filePath: 'src/r.ts' });
    // A sorts first (kept); X sorts last (the 21st candidate, dropped by width).
    const a = node(h, { id: 'A', name: 'A', kind: 'function', filePath: 'src/00a.ts' });
    const x = node(h, { id: 'X', name: 'X', kind: 'function', filePath: 'src/99z.ts' });
    edge(h, root.id, a.id, 'calls');
    edge(h, root.id, x.id, 'calls');
    for (let i = 1; i <= 19; i++) {
      const id = `k${String(i).padStart(2, '0')}`; // 19 filler kept children between A and X
      node(h, { id, name: id, kind: 'function', filePath: `src/${String(i).padStart(2, '0')}.ts` });
      edge(h, root.id, id, 'calls');
    }
    edge(h, a.id, x.id, 'calls'); // the KEPT branch A itself reaches the dropped target X

    const r = traceFlow(rootAt(root.id), h.queries);
    expect(r.truncatedWidth).toBe(false); // X is reached via kept A → nothing was truncated
    expect(r.steps.some((s) => s.nodeId === 'X')).toBe(true); // X IS in the flow
  });

  it('does NOT set truncatedDepth when the depth-cap node only cycles back to a visited node', () => {
    // A chain reaching exactly the depth cap whose last node's ONLY out-edge is a
    // back-edge to the already-visited root — a cycle, not a truncation. The
    // uncapped trace would skip that edge (visited), so nothing is omitted.
    const h = freshSeed();
    const rootId = chain(h, FLOW_CAP_DEPTH); // c0(root) … c12 at depth 12
    edge(h, `c${FLOW_CAP_DEPTH}`, rootId, 'calls'); // c12 → root (already visited)
    const r = traceFlow(rootAt(rootId), h.queries);

    expect(r.truncatedDepth).toBe(false); // was true before the fix (false positive)
    expect(anyTrunc(r)).toBe(false); // a fully-explored cycle is a COMPLETE flow
    expect(r.steps).toHaveLength(FLOW_CAP_DEPTH + 1); // root + c1..c12, nothing dropped
  });

  it('sets truncatedSteps when the 200th node is a last child with an unvisited edge', () => {
    // Regression (FR-007): the 200th step is pushed as the LAST child in DFS
    // pre-order, then we recurse into it. A top-of-dfs `steps.length >= cap`
    // bail returned before the node's own unvisited out-edge could trip the
    // step-cap flag, so a genuinely truncated flow reported as complete.
    const h = freshSeed();
    const root = node(h, { id: 'root', name: 'root', kind: 'function', filePath: 'src/0-root.ts' });

    // padA's subtree is explored FIRST (its file sorts before the tail's) and
    // holds exactly 197 descendants — bushy/shallow so nothing else truncates.
    const padA = node(h, { id: 'padA', name: 'padA', kind: 'function', filePath: 'src/1-pad/A.ts' });
    edge(h, root.id, padA.id, 'calls');
    let added = 0;
    let idx = 0;
    const queue: Array<{ id: string; depth: number }> = [{ id: padA.id, depth: 1 }];
    while (added < FLOW_CAP_STEPS - 3 && queue.length) {
      const cur = queue.shift()!;
      if (cur.depth >= FLOW_CAP_DEPTH) continue;
      const kids = Math.min(15, FLOW_CAP_STEPS - 3 - added); // ≤ width cap, ≤ remaining
      for (let i = 0; i < kids; i++) {
        const cid = `pad${idx++}`;
        node(h, { id: cid, name: cid, kind: 'function', filePath: `src/1-pad/${cid}.ts` });
        edge(h, cur.id, cid, 'calls');
        added++;
        queue.push({ id: cid, depth: cur.depth + 1 });
      }
    }
    expect(added).toBe(FLOW_CAP_STEPS - 3); // root + padA + 197 descendants = 199 so far

    // The tail: root's SECOND child, examined after padA's whole subtree, pushed
    // as the 200th step; its unvisited child is what the cap prevents adding.
    const tail = node(h, { id: 'tail', name: 'tail', kind: 'function', filePath: 'src/2-tail/T.ts' });
    edge(h, root.id, tail.id, 'calls');
    const tailChild = node(h, { id: 'tailChild', name: 'tailChild', kind: 'function', filePath: 'src/2-tail/child.ts' });
    edge(h, tail.id, tailChild.id, 'calls');

    const r = traceFlow(rootAt(root.id), h.queries);

    expect(r.steps).toHaveLength(FLOW_CAP_STEPS); // exactly 200 (tailChild dropped)
    expect(r.steps.some((s) => s.nodeId === 'tail')).toBe(true); // the 200th step
    expect(r.steps.some((s) => s.nodeId === 'tailChild')).toBe(false); // cut by the cap
    expect(r.truncatedSteps).toBe(true); // ← false before the fix
    expect(r.truncatedDepth).toBe(false);
    expect(r.truncatedWidth).toBe(false);
  });
});
