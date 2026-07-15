/**
 * SPEC-011 — flow identity (FR-017a) must distinguish distinct roots.
 *
 * FR-003 / SC-001: exactly one flow PER DETECTED ENTRY POINT. Two distinct roots
 * that share a public name (two services' `GET /health`, two CLIs' `sync`) must
 * get DISTINCT flow ids — folding the root's project-relative file into the id
 * material — otherwise runFlowAnalysis's dedupe silently drops one (and, without
 * the dedupe, swapFlows would fail on a duplicate PRIMARY KEY).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { computeFlowId, runFlowAnalysis, type EntryPoint } from '../../../src/analysis';
import { freshSeed, cleanupSeeds, node, setVersion } from './helpers';

afterEach(cleanupSeeds);

function routeEntry(nodeId: string, filePath: string): EntryPoint {
  return {
    entryKind: 'route',
    rootNodeId: nodeId,
    rootName: 'GET /health',
    rootKind: 'route',
    routeName: 'GET /health',
    filePath,
  };
}

describe('computeFlowId (FR-017a / FR-003)', () => {
  it('gives two same-name roots in different files DISTINCT ids', () => {
    const a = computeFlowId(routeEntry('route:src/svc-a.ts:1:GET:/health', 'src/svc-a.ts'));
    const b = computeFlowId(routeEntry('route:src/svc-b.ts:1:GET:/health', 'src/svc-b.ts'));
    expect(a).not.toBe(b);
  });

  it('is deterministic / clone-stable — same input yields the same id (SC-004)', () => {
    const first = computeFlowId(routeEntry('route:src/svc-a.ts:1:GET:/health', 'src/svc-a.ts'));
    const again = computeFlowId(routeEntry('route:src/svc-a.ts:1:GET:/health', 'src/svc-a.ts'));
    expect(again).toBe(first);
  });
});

describe('runFlowAnalysis one-flow-per-root (FR-003, SC-001)', () => {
  it('keeps BOTH flows when two routes share a public name across files', async () => {
    const h = freshSeed();
    setVersion(h, 1);
    // Two distinct route roots, same method+path, different files (a monorepo
    // with two services each exposing GET /health).
    node(h, { id: 'route:src/svc-a.ts:1:GET:/health', name: 'GET /health', kind: 'route', filePath: 'src/svc-a.ts' });
    node(h, { id: 'route:src/svc-b.ts:1:GET:/health', name: 'GET /health', kind: 'route', filePath: 'src/svc-b.ts' });

    await runFlowAnalysis(h.graph, h.db);

    const rows = h.db
      .prepare('SELECT id, root_node_id FROM flows ORDER BY root_node_id')
      .all() as Array<{ id: string; root_node_id: string }>;
    expect(rows).toHaveLength(2); // was 1 before the fix (collision → silent drop)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2); // distinct ids → swap-safe
    expect(rows.map((r) => r.root_node_id)).toEqual([
      'route:src/svc-a.ts:1:GET:/health',
      'route:src/svc-b.ts:1:GET:/health',
    ]);
  });

  it('keeps BOTH flows when two same-name roots share a file (salted, not dropped)', async () => {
    const h = freshSeed();
    setVersion(h, 1);
    // Two DISTINCT route nodes with the same method+path in the SAME file (a
    // genuine duplicate registration) compute the same flow id — the residual
    // collision must be salted so both persist, not silently dropped (FR-003).
    node(h, { id: 'route:src/api.ts:1:GET:/health', name: 'GET /health', kind: 'route', filePath: 'src/api.ts' });
    node(h, { id: 'route:src/api.ts:9:GET:/health', name: 'GET /health', kind: 'route', filePath: 'src/api.ts' });

    await runFlowAnalysis(h.graph, h.db);

    const rows = h.db
      .prepare('SELECT id, root_node_id FROM flows ORDER BY root_node_id')
      .all() as Array<{ id: string; root_node_id: string }>;
    expect(rows).toHaveLength(2); // was 1 before the fix (second silently dropped)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2); // distinct ids → swap-safe
  });
});
