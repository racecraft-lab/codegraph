/**
 * SPEC-011 T016 [US1] — per-step provenance (FR-008/009, SC-001).
 *
 * Non-root steps carry the 3-value `static|lsp|heuristic` wire enum (NOT the
 * collapsed 2-value Edge.provenance, which would drop `lsp`); the root step
 * (depth 0) carries provenance=null and edge_kind=null; 100% of non-root steps
 * carry a provenance.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { traceFlow } from '../../../src/analysis/flows/tracer';
import type { EntryPoint } from '../../../src/analysis/flows/entry-points';
import { freshSeed, cleanupSeeds, node, edge } from './helpers';

afterEach(cleanupSeeds);

function rootAt(id: string): EntryPoint {
  return { entryKind: 'export', rootNodeId: id, rootName: 'root', rootKind: 'function', rootQualifiedName: 'root' };
}

describe('flow step provenance', () => {
  it('maps every provenance class onto the 3-value wire enum and keeps lsp distinct', () => {
    const h = freshSeed();
    const root = node(h, { name: 'root', kind: 'function', filePath: 'src/root.ts' });
    const a = node(h, { id: 'A', name: 'A', kind: 'function', filePath: 'src/a.ts' });
    const b = node(h, { id: 'B', name: 'B', kind: 'function', filePath: 'src/b.ts' });
    const c = node(h, { id: 'C', name: 'C', kind: 'function', filePath: 'src/c.ts' });
    const d = node(h, { id: 'D', name: 'D', kind: 'function', filePath: 'src/d.ts' });
    edge(h, root.id, a.id, 'calls', 'lsp');
    edge(h, root.id, b.id, 'calls', 'heuristic');
    edge(h, root.id, c.id, 'references', 'tree-sitter');
    edge(h, root.id, d.id, 'calls', undefined); // no provenance recorded

    const steps = traceFlow(rootAt(root.id), h.queries).steps;
    const byId = new Map(steps.map((s) => [s.nodeId, s]));

    // LSP is preserved, NOT collapsed to static.
    expect(byId.get('A')!.provenance).toBe('lsp');
    expect(byId.get('A')!.edgeKind).toBe('calls');
    expect(byId.get('B')!.provenance).toBe('heuristic');
    expect(byId.get('C')!.provenance).toBe('static');
    expect(byId.get('C')!.edgeKind).toBe('references');
    // An unset provenance maps to static.
    expect(byId.get('D')!.provenance).toBe('static');
  });

  it('gives the root step null provenance and null edge kind, and every non-root step a provenance', () => {
    const h = freshSeed();
    const root = node(h, { name: 'root', kind: 'function', filePath: 'src/root.ts' });
    const a = node(h, { id: 'A', name: 'A', kind: 'function', filePath: 'src/a.ts' });
    edge(h, root.id, a.id, 'calls', 'tree-sitter');

    const steps = traceFlow(rootAt(root.id), h.queries).steps;
    const rootStep = steps.find((s) => s.depth === 0)!;
    expect(rootStep.provenance).toBeNull();
    expect(rootStep.edgeKind).toBeNull();
    expect(rootStep.parentNodeId).toBeNull();

    const nonRoot = steps.filter((s) => s.depth > 0);
    expect(nonRoot.length).toBeGreaterThan(0);
    expect(nonRoot.every((s) => s.provenance !== null)).toBe(true);
  });
});
