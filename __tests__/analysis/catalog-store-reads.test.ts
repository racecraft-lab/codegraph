/**
 * SPEC-011 (T010) — single-snapshot composite reads.
 *
 * Every catalog read that composes >1 logical value derives its rows from ONE
 * statement / full-fetch-then-slice, never two separately-issued statements, so
 * a concurrent atomic swap can't tear it (FR-021a):
 *   (a) list envelope + total  → full fetch, slice the page, total = full count;
 *   (b) get_flow header + steps → one LEFT JOIN;
 *   (c) read-state probe        → one statement (catalog_meta + content count +
 *       graph_write_version via scalar subqueries).
 *
 * Real SQLite in temp dirs (no mocking).
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseConnection } from '../../src/db';
import { SqliteDatabase } from '../../src/db/sqlite-adapter';
import {
  swapFlows,
  swapClusters,
  probeCatalog,
  pageFlows,
  getFlowDetail,
  pageClusters,
  type FlowRow,
  type FlowStepRow,
  type ClusterRow,
  type ClusterMemberRow,
} from '../../src/analysis/catalog-store';

function flow(id: string, name: string, opts: Partial<FlowRow> = {}): FlowRow {
  return {
    id,
    name,
    entryKind: 'route',
    rootNodeId: `root-${id}`,
    rootName: `${name} root`,
    rootKind: 'route',
    truncatedDepth: false,
    truncatedWidth: false,
    truncatedSteps: false,
    ...opts,
  };
}
function cluster(id: string, label: string, count: number): ClusterRow {
  return { id, canonicalLabel: label, displayLabel: null, memberCount: count, isSingleton: count === 1 };
}
function members(clusterId: string, n: number): ClusterMemberRow[] {
  return Array.from({ length: n }, (_, i) => ({ clusterId, filePath: `${clusterId}/f${i}.ts` }));
}
function setGwv(db: SqliteDatabase, v: number): void {
  db.prepare(`INSERT OR REPLACE INTO project_metadata (key, value, updated_at) VALUES ('graph_write_version', ?, 0)`).run(
    String(v),
  );
}

describe('catalog-store composite reads', () => {
  const dirs: string[] = [];
  const conns: DatabaseConnection[] = [];
  function freshDb(): SqliteDatabase {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reads-'));
    dirs.push(dir);
    const conn = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    conns.push(conn);
    return conn.getDb();
  }
  afterEach(() => {
    while (conns.length) conns.pop()?.close();
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('(c) probeCatalog returns meta + content count + graph_write_version in one read', () => {
    const db = freshDb();
    setGwv(db, 5);
    swapFlows(db, 5, [flow('a', 'GET /a'), flow('b', 'GET /b')], [
      { flowId: 'a', nodeId: 'root-a', symbolName: 'r', symbolKind: 'route', depth: 0, parentNodeId: null, edgeKind: null, provenance: null },
    ]);
    const probe = probeCatalog(db, 'flows');
    expect(probe.graphWriteVersion).toBe(5);
    expect(probe.computedFromVersion).toBe(5);
    expect(probe.firstRunFailed).toBe(false);
    expect(probe.contentCount).toBe(2); // 2 flows (content entries), not step rows
  });

  it('(c) probeCatalog reports NULL computed version + first_run_failed marker with no swap', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO catalog_meta (kind, computed_from_version, first_run_failed) VALUES ('flows', NULL, 1)`).run();
    const probe = probeCatalog(db, 'flows');
    expect(probe.computedFromVersion).toBeNull();
    expect(probe.firstRunFailed).toBe(true);
    expect(probe.contentCount).toBe(0);
  });

  it('(a) pageFlows sorts by name COLLATE BINARY then id, with total = full count', () => {
    const db = freshDb();
    // Insert out of order; BINARY collation sorts uppercase before lowercase.
    swapFlows(db, 1, [flow('3', 'beta'), flow('1', 'Zeta'), flow('2', 'alpha')], []);
    const page = pageFlows(db, 10, 0);
    expect(page.total).toBe(3);
    expect(page.items.map((f) => f.name)).toEqual(['Zeta', 'alpha', 'beta']);
    expect(page.limit).toBe(10);
    expect(page.offset).toBe(0);
  });

  it('(a) pageFlows slices the requested page while total stays the full match count', () => {
    const db = freshDb();
    const flows = Array.from({ length: 5 }, (_, i) => flow(`f${i}`, `name${i}`));
    swapFlows(db, 1, flows, []);
    const page = pageFlows(db, 2, 2);
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(2);
    expect(page.items.map((f) => f.name)).toEqual(['name2', 'name3']);
  });

  it('(a) pageFlows reports stepCount and the truncated disjunction per flow', () => {
    const db = freshDb();
    const steps: FlowStepRow[] = [
      { flowId: 'a', nodeId: 'root-a', symbolName: 'r', symbolKind: 'route', depth: 0, parentNodeId: null, edgeKind: null, provenance: null },
      { flowId: 'a', nodeId: 's1', symbolName: 's1', symbolKind: 'function', depth: 1, parentNodeId: 'root-a', edgeKind: 'calls', provenance: 'static' },
      { flowId: 'a', nodeId: 's2', symbolName: 's2', symbolKind: 'function', depth: 2, parentNodeId: 's1', edgeKind: 'calls', provenance: 'lsp' },
    ];
    swapFlows(db, 1, [flow('a', 'A', { truncatedWidth: true }), flow('b', 'B')], steps);
    const page = pageFlows(db, 10, 0);
    const a = page.items.find((f) => f.id === 'a')!;
    const b = page.items.find((f) => f.id === 'b')!;
    expect(a.stepCount).toBe(3);
    expect(a.truncated).toBe(true); // width axis set
    expect(b.stepCount).toBe(0);
    expect(b.truncated).toBe(false);
  });

  it('(b) getFlowDetail returns header + root + ordered steps from one join', () => {
    const db = freshDb();
    const steps: FlowStepRow[] = [
      { flowId: 'a', nodeId: 'root-a', symbolName: 'GET /a root', symbolKind: 'route', depth: 0, parentNodeId: null, edgeKind: null, provenance: null },
      { flowId: 'a', nodeId: 's1', symbolName: 'handler', symbolKind: 'function', depth: 1, parentNodeId: 'root-a', edgeKind: 'calls', provenance: 'static' },
      { flowId: 'a', nodeId: 's2', symbolName: 'repo', symbolKind: 'method', depth: 2, parentNodeId: 's1', edgeKind: 'references', provenance: 'heuristic' },
    ];
    swapFlows(db, 9, [flow('a', 'GET /a', { truncatedDepth: true, truncatedSteps: true })], steps);
    const detail = getFlowDetail(db, 'a');
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe('a');
    expect(detail!.name).toBe('GET /a');
    expect(detail!.entryKind).toBe('route');
    expect(detail!.root).toEqual({ nodeId: 'root-a', name: 'GET /a root', kind: 'route' });
    expect(detail!.sourceVersion).toBe(9);
    expect(detail!.truncated).toBe(true);
    expect(detail!.truncation).toEqual({ depth: true, width: false, totalSteps: true });
    expect(detail!.steps.map((s) => s.nodeId)).toEqual(['root-a', 's1', 's2']);
    expect(detail!.steps.map((s) => s.provenance)).toEqual([null, 'static', 'heuristic']);
    expect(detail!.steps.map((s) => s.edgeKind)).toEqual([null, 'calls', 'references']);
    expect(detail!.steps[2]!.parentNodeId).toBe('s1');
  });

  it('(b) getFlowDetail returns null for an unknown id', () => {
    const db = freshDb();
    swapFlows(db, 1, [flow('a', 'A')], []);
    expect(getFlowDetail(db, 'nope')).toBeNull();
  });

  it('(a) pageClusters sorts by member_count desc, canonicalLabel asc, id; total = post-minSize count', () => {
    const db = freshDb();
    swapClusters(
      db,
      3,
      [cluster('c1', 'zeta', 3), cluster('c2', 'alpha', 3), cluster('c3', 'solo', 1)],
      [...members('c1', 3), ...members('c2', 3), ...members('c3', 1)],
    );
    const all = pageClusters(db, 1, 10, 0);
    expect(all.total).toBe(3);
    // member_count desc; tie (3,3) → canonicalLabel asc (alpha before zeta).
    expect(all.items.map((c) => c.id)).toEqual(['c2', 'c1', 'c3']);
    expect(all.sourceVersion).toBe(3);

    const filtered = pageClusters(db, 2, 10, 0);
    expect(filtered.total).toBe(2); // singleton suppressed
    expect(filtered.items.every((c) => c.memberCount >= 2)).toBe(true);
    expect(filtered.items.map((c) => c.isSingleton)).toEqual([false, false]);
  });
});
