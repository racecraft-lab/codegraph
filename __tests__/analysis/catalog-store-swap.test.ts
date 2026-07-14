/**
 * SPEC-011 (T009) — atomic single-transaction catalog swap.
 *
 * Per-kind replacement is one transaction: DELETE child+parent rows, INSERT new
 * rows, INSERT OR REPLACE catalog_meta, COMMIT (FR-021). No generation-tagged
 * rows, no multi-generation retention — a second swap fully replaces the first.
 * A swap that raises mid-transaction rolls back, leaving the prior catalog
 * intact (the mechanism FR-022b relies on for a failed swap-commit).
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
  type FlowRow,
  type FlowStepRow,
  type ClusterRow,
  type ClusterMemberRow,
} from '../../src/analysis/catalog-store';

function flow(id: string, name: string): FlowRow {
  return {
    id,
    name,
    entryKind: 'route',
    rootNodeId: `node-${id}`,
    rootName: name,
    rootKind: 'route',
    truncatedDepth: false,
    truncatedWidth: false,
    truncatedSteps: false,
  };
}
function step(flowId: string, nodeId: string, depth: number): FlowStepRow {
  return {
    flowId,
    nodeId,
    symbolName: nodeId,
    symbolKind: 'function',
    depth,
    parentNodeId: depth === 0 ? null : `node-${flowId}`,
    edgeKind: depth === 0 ? null : 'calls',
    provenance: depth === 0 ? null : 'static',
  };
}
function cluster(id: string, label: string, count: number): ClusterRow {
  return { id, canonicalLabel: label, displayLabel: null, memberCount: count, isSingleton: count === 1 };
}
function member(clusterId: string, filePath: string): ClusterMemberRow {
  return { clusterId, filePath };
}

describe('catalog-store atomic swap', () => {
  const dirs: string[] = [];
  const conns: DatabaseConnection[] = [];

  function freshDb(): SqliteDatabase {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-swap-'));
    dirs.push(dir);
    const conn = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    conns.push(conn);
    return conn.getDb();
  }
  function count(db: SqliteDatabase, table: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  }

  afterEach(() => {
    while (conns.length) conns.pop()?.close();
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('persists flows + flow_steps + catalog_meta in one swap', () => {
    const db = freshDb();
    swapFlows(db, 5, [flow('a', 'GET /a')], [step('a', 'node-a', 0), step('a', 's1', 1)]);
    expect(count(db, 'flows')).toBe(1);
    expect(count(db, 'flow_steps')).toBe(2);
    const meta = db
      .prepare(`SELECT computed_from_version AS v, first_run_failed AS f FROM catalog_meta WHERE kind='flows'`)
      .get() as { v: number; f: number };
    expect(meta.v).toBe(5);
    expect(meta.f).toBe(0);
    const row = db.prepare(`SELECT * FROM flows WHERE id='a'`).get() as Record<string, unknown>;
    expect(row.name).toBe('GET /a');
    expect(row.source_version).toBe(5);
  });

  it('a second swap fully replaces the first — no generation-tagged rows survive', () => {
    const db = freshDb();
    swapFlows(db, 1, [flow('a', 'GET /a')], [step('a', 'node-a', 0), step('a', 's1', 1)]);
    swapFlows(db, 2, [flow('b', 'GET /b')], [step('b', 'node-b', 0)]);
    expect(count(db, 'flows')).toBe(1);
    expect(count(db, 'flow_steps')).toBe(1);
    expect(db.prepare(`SELECT id FROM flows`).all()).toEqual([{ id: 'b' }]);
    const meta = db.prepare(`SELECT computed_from_version AS v FROM catalog_meta WHERE kind='flows'`).get() as { v: number };
    expect(meta.v).toBe(2);
  });

  it('swaps clusters + cluster_members + catalog_meta independently of flows', () => {
    const db = freshDb();
    swapClusters(
      db,
      7,
      [cluster('c1', 'services/api', 2), cluster('c2', 'lib/util', 1)],
      [member('c1', 'a.ts'), member('c1', 'b.ts'), member('c2', 'u.ts')],
    );
    expect(count(db, 'clusters')).toBe(2);
    expect(count(db, 'cluster_members')).toBe(3);
    expect(count(db, 'flows')).toBe(0);
    const meta = db.prepare(`SELECT computed_from_version AS v, first_run_failed AS f FROM catalog_meta WHERE kind='clusters'`).get() as { v: number; f: number };
    expect(meta.v).toBe(7);
    expect(meta.f).toBe(0);
    const singleton = db.prepare(`SELECT is_singleton AS s FROM clusters WHERE id='c2'`).get() as { s: number };
    expect(singleton.s).toBe(1);
  });

  it('rolls back a failed swap, leaving the prior catalog intact (FR-022b mechanism)', () => {
    const db = freshDb();
    swapFlows(db, 1, [flow('a', 'GET /a')], [step('a', 'node-a', 0)]);
    // Duplicate (flow_id, node_id) PK inside the new swap raises mid-transaction.
    expect(() =>
      swapFlows(db, 2, [flow('b', 'GET /b')], [step('b', 'dup', 0), step('b', 'dup', 1)]),
    ).toThrow();
    // Prior catalog fully retained: still 'a' at version 1, no partial 'b' rows.
    expect(db.prepare(`SELECT id FROM flows`).all()).toEqual([{ id: 'a' }]);
    expect(count(db, 'flow_steps')).toBe(1);
    const meta = db.prepare(`SELECT computed_from_version AS v FROM catalog_meta WHERE kind='flows'`).get() as { v: number };
    expect(meta.v).toBe(1);
  });
});
