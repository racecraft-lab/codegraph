/**
 * SPEC-011 (T007) — `graph_write_version` read + monotonic-advance helpers.
 *
 * The live graph version token (data-model.md) mirrors `vectors_write_version`:
 * a monotonic integer in the existing project-metadata store, advanced +1 per
 * successful index/sync when ≥1 catalog is enabled. Staleness is DERIVED
 * (recorded < live), so this token only needs to advance monotonically.
 *
 * Real files + real SQLite in a temp dir (no mocking), per repo convention.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseConnection } from '../../src/db';
import { QueryBuilder } from '../../src/db/queries';

describe('graph_write_version helpers', () => {
  const dirs: string[] = [];
  const conns: DatabaseConnection[] = [];

  function freshQueries(): QueryBuilder {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-gwv-'));
    dirs.push(dir);
    const conn = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    conns.push(conn);
    return new QueryBuilder(conn.getDb());
  }

  afterEach(() => {
    while (conns.length) conns.pop()?.close();
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('reads 0 before the token is ever written', () => {
    const q = freshQueries();
    expect(q.getGraphWriteVersion()).toBe(0);
  });

  it('advances by exactly 1 on each call', () => {
    const q = freshQueries();
    q.advanceGraphWriteVersion();
    expect(q.getGraphWriteVersion()).toBe(1);
    q.advanceGraphWriteVersion();
    expect(q.getGraphWriteVersion()).toBe(2);
    q.advanceGraphWriteVersion();
    expect(q.getGraphWriteVersion()).toBe(3);
  });

  it('is monotonic — repeated advances never decrease', () => {
    const q = freshQueries();
    let prev = q.getGraphWriteVersion();
    for (let i = 0; i < 10; i++) {
      q.advanceGraphWriteVersion();
      const cur = q.getGraphWriteVersion();
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
    expect(q.getGraphWriteVersion()).toBe(10);
  });

  it('persists under the project_metadata key "graph_write_version"', () => {
    const q = freshQueries();
    q.advanceGraphWriteVersion();
    q.advanceGraphWriteVersion();
    expect(q.getMetadata('graph_write_version')).toBe('2');
  });

  it('treats an absent token as 0 without writing it (dormancy byte-parity)', () => {
    const q = freshQueries();
    // A pure read must not create the scalar — a dormant project stays byte-clean.
    expect(q.getGraphWriteVersion()).toBe(0);
    expect(q.getMetadata('graph_write_version')).toBeNull();
  });
});
