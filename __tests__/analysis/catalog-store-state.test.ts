/**
 * SPEC-011 (T011) — read-time 6-value state resolution.
 *
 * Resolution order (data-model.md / FR-022/023/025/030):
 *   1. live per-catalog opt-in flag OFF                → disabled (FIRST; rows inert)
 *   2. no catalog_meta row (never computed)            → disabled
 *   3. first_run_failed with NULL computed version     → unavailable
 *   4. recorded version < live graph_write_version     → stale (DERIVED, not stored)
 *   5. recorded == live, zero content rows             → empty (available-but-empty)
 *   6. recorded == live, content present               → available
 *
 * `not_indexed` is resolved at the surface (no index), never by resolveState.
 * Real SQLite in temp dirs for the end-to-end integration case.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseConnection } from '../../src/db';
import { SqliteDatabase } from '../../src/db/sqlite-adapter';
import { swapFlows, swapClusters, probeCatalog, resolveState, type CatalogProbe } from '../../src/analysis/catalog-store';
import { readClusterList, readFlowList } from '../../src/analysis';

function probe(over: Partial<CatalogProbe> = {}): CatalogProbe {
  return {
    graphWriteVersion: 5,
    computedFromVersion: 5,
    firstRunFailed: false,
    hasMeta: true,
    contentCount: 1,
    ...over,
  };
}

describe('catalog-store read-time state resolution', () => {
  it('the live opt-in flag is consulted FIRST — disabled even over a fresh catalog', () => {
    // A fully available catalog is still `disabled` when the flag is off.
    expect(resolveState(false, probe({ contentCount: 3 }))).toBe('disabled');
  });

  it('a never-computed catalog (no meta row) is disabled, distinct from unavailable', () => {
    expect(resolveState(true, probe({ hasMeta: false, computedFromVersion: null }))).toBe('disabled');
  });

  it('a first-run failure (meta row, null version, first_run_failed) is unavailable', () => {
    expect(
      resolveState(true, probe({ firstRunFailed: true, computedFromVersion: null, contentCount: 0 })),
    ).toBe('unavailable');
  });

  it('recorded == live with content is available', () => {
    expect(resolveState(true, probe({ computedFromVersion: 5, graphWriteVersion: 5, contentCount: 2 }))).toBe(
      'available',
    );
  });

  it('recorded == live with zero content rows is available-but-empty', () => {
    expect(resolveState(true, probe({ computedFromVersion: 5, graphWriteVersion: 5, contentCount: 0 }))).toBe(
      'empty',
    );
  });

  it('recorded < live is stale (derived), regardless of content', () => {
    expect(resolveState(true, probe({ computedFromVersion: 4, graphWriteVersion: 5, contentCount: 2 }))).toBe(
      'stale',
    );
  });

  it('version precedence: recorded < live is stale even when empty', () => {
    expect(resolveState(true, probe({ computedFromVersion: 4, graphWriteVersion: 5, contentCount: 0 }))).toBe(
      'stale',
    );
  });

  describe('end-to-end over a real swap', () => {
    const dirs: string[] = [];
    const conns: DatabaseConnection[] = [];
    function freshDb(): SqliteDatabase {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-state-'));
      dirs.push(dir);
      const conn = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
      conns.push(conn);
      return conn.getDb();
    }
    function setGwv(db: SqliteDatabase, v: number): void {
      db.prepare(
        `INSERT OR REPLACE INTO project_metadata (key, value, updated_at) VALUES ('graph_write_version', ?, 0)`,
      ).run(String(v));
    }
    afterEach(() => {
      while (conns.length) conns.pop()?.close();
      while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
    });

    it('available → stale (graph advances) → disabled (flag off, rows retained)', () => {
      const db = freshDb();
      setGwv(db, 5);
      swapFlows(db, 5, [{
        id: 'a', name: 'GET /a', entryKind: 'route', rootNodeId: 'r', rootName: 'r', rootKind: 'route',
        truncatedDepth: false, truncatedWidth: false, truncatedSteps: false,
      }], []);

      expect(resolveState(true, probeCatalog(db, 'flows'))).toBe('available');

      // Graph advances without re-running analysis → retained catalog is stale.
      setGwv(db, 6);
      expect(resolveState(true, probeCatalog(db, 'flows'))).toBe('stale');

      // Flag turned off → disabled, even though the rows are still present.
      expect(resolveState(false, probeCatalog(db, 'flows'))).toBe('disabled');
    });

    it('an available-but-empty catalog reports its computed source version, not 0 (FR-022)', () => {
      const db = freshDb();
      setGwv(db, 5);
      // Successfully computed with zero entry points / zero clusters → empty, but
      // still tagged with the version it was computed from (not 0).
      swapFlows(db, 5, [], []);
      const flows = readFlowList(db, true, 20, 0);
      expect(flows.state).toBe('empty');
      expect(flows.total).toBe(0);
      expect(flows.sourceVersion).toBe(5); // ← was 0 before the fix

      swapClusters(db, 5, [], []);
      const clusters = readClusterList(db, true, 1, 20, 0);
      expect(clusters.state).toBe('empty');
      expect(clusters.total).toBe(0);
      expect(clusters.sourceVersion).toBe(5);
    });

    it('a zero-match minSize filter still reports the catalog source version, not 0 (FR-022)', () => {
      const db = freshDb();
      setGwv(db, 7);
      // A real cluster exists, but the minSize filter excludes it → filtered-empty
      // page; sourceVersion must still be the computed-from token.
      swapClusters(
        db,
        7,
        [{ id: 'c1', canonicalLabel: 'x', displayLabel: null, memberCount: 1, isSingleton: true }],
        [{ clusterId: 'c1', filePath: 'src/x.ts' }],
      );
      const clusters = readClusterList(db, true, 5, 20, 0); // minSize 5 excludes the size-1 cluster
      expect(clusters.state).toBe('available');
      expect(clusters.total).toBe(0);
      expect(clusters.sourceVersion).toBe(7); // ← was 0 before the fix
    });
  });
});
