/**
 * Embedding index — SPEC-001 (Embedding Infrastructure & Endpoint Provider).
 *
 * The embedding store persists one vector per symbol in a new `node_vectors`
 * table. That table is defined in TWO places that MUST stay in lockstep
 * (FR-012): `src/db/schema.sql` (the shape a FRESH install gets) and the v8
 * migration in `src/db/migrations.ts` (the shape a database UPGRADED from v7
 * gets). If the two definitions ever drift, a freshly-created DB and an
 * upgraded DB silently end up with different table shapes — a divergence only
 * visible later, when a query built for one shape runs against the other. The
 * schema-convergence suite below pins both paths to an identical
 * `PRAGMA table_info(node_vectors)`.
 *
 * Real SQLite, real temp files — no DB mocking (repo test convention). The
 * suite is skipped where `node:sqlite` is unavailable (Node < 22.5).
 *
 * NOTE: later SPEC-001 tasks append further sections (codec, input-hash,
 * indexer wiring) to this file — keep new `describe` blocks additive.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConnection, SqliteDatabase } from '../src/db';
import { runMigrations, getCurrentVersion, CURRENT_SCHEMA_VERSION } from '../src/db/migrations';

let HAS_SQLITE = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:sqlite');
  HAS_SQLITE = true;
} catch {
  HAS_SQLITE = false;
}

type ColumnShape = { name: string; type: string; notnull: number; pk: number };

/** The (name, type, notnull, pk) of every `node_vectors` column, in order. */
function nodeVectorsShape(db: SqliteDatabase): ColumnShape[] {
  const rows = db.prepare('PRAGMA table_info(node_vectors)').all() as Array<Record<string, unknown>>;
  return rows.map((c) => ({
    name: c.name as string,
    type: c.type as string,
    notnull: c.notnull as number,
    pk: c.pk as number,
  }));
}

/**
 * The shape BOTH the fresh-install schema and the v8 migration must produce.
 * `node_id` is a `TEXT PRIMARY KEY` — SQLite reports notnull=0 for a PK column
 * that isn't ALSO explicitly declared `NOT NULL`, so it is the one column here
 * with notnull=0. The other four carry an explicit `NOT NULL` (notnull=1).
 */
const EXPECTED_SHAPE: ColumnShape[] = [
  { name: 'node_id', type: 'TEXT', notnull: 0, pk: 1 },
  { name: 'model', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'dims', type: 'INTEGER', notnull: 1, pk: 0 },
  { name: 'vector', type: 'BLOB', notnull: 1, pk: 0 },
  { name: 'input_hash', type: 'TEXT', notnull: 1, pk: 0 },
];

describe.skipIf(!HAS_SQLITE)('node_vectors schema convergence (FR-012)', () => {
  const conns: DatabaseConnection[] = [];
  const dirs: string[] = [];

  /** A fresh DB built straight from `schema.sql` (the real fresh-install path). */
  function freshDb(prefix: string): DatabaseConnection {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    const conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
    conns.push(conn);
    return conn;
  }

  /**
   * Rewind a freshly-initialized DB into a genuine pre-embedding v7 database:
   * drop the `node_vectors` table and re-stamp `schema_versions` so
   * `getCurrentVersion` reads exactly 7 with no v8 row — indistinguishable from
   * a DB created before this table existed. (`initialize` stamps only
   * {1, CURRENT_SCHEMA_VERSION}, so an explicit v7 stamp is required.)
   */
  function rewindToV7(db: SqliteDatabase): void {
    db.exec('DROP TABLE IF EXISTS node_vectors');
    db.prepare('DELETE FROM schema_versions WHERE version >= 8').run();
    db.prepare(
      'INSERT OR IGNORE INTO schema_versions (version, applied_at, description) VALUES (7, ?, ?)'
    ).run(Date.now(), 'test: simulate a pre-embedding v7 database');
  }

  afterEach(() => {
    while (conns.length) conns.pop()!.close();
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CURRENT_SCHEMA_VERSION is 8 (the node_vectors migration)', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(8);
  });

  it('a fresh schema.sql DB and a v7→v8 upgraded DB yield an identical node_vectors shape', () => {
    // Path A — fresh install straight from schema.sql.
    const freshShape = nodeVectorsShape(freshDb('cg-nv-fresh-').getDb());

    // Path B — a genuine v7 database, upgraded through the migration runner
    // exactly as `DatabaseConnection.open` does (read the version, then run).
    const raw = freshDb('cg-nv-upgrade-').getDb();
    rewindToV7(raw);
    expect(getCurrentVersion(raw)).toBe(7); // genuinely a v7 DB...
    expect(nodeVectorsShape(raw)).toEqual([]); // ...with no node_vectors table yet

    runMigrations(raw, getCurrentVersion(raw));
    const upgradedShape = nodeVectorsShape(raw);

    // Guard against an empty-vs-empty false match: both paths really built it.
    expect(freshShape).toEqual(EXPECTED_SHAPE);
    // FR-012 convergence: the two independent definitions produce an identical
    // table shape, row-for-row (name, type, notnull, pk).
    expect(upgradedShape).toEqual(freshShape);
    expect(getCurrentVersion(raw)).toBe(8);
  });

  it('the v8 migration is DDL-only and idempotent — a re-open is a safe no-op', () => {
    const raw = freshDb('cg-nv-idem-').getDb();
    rewindToV7(raw);
    runMigrations(raw, getCurrentVersion(raw));

    const shape = nodeVectorsShape(raw);
    expect(shape).toEqual(EXPECTED_SHAPE); // built on the first upgrade

    // (a) A normal re-open re-runs the runner from the recorded version. At v8
    // nothing is pending, so it is a version-gated no-op — no throw, no change.
    expect(() => runMigrations(raw, getCurrentVersion(raw))).not.toThrow();
    expect(getCurrentVersion(raw)).toBe(8);
    expect(nodeVectorsShape(raw)).toEqual(shape);

    // (b) Even forced to EXECUTE a second time over the now-existing table, the
    // v8 DDL is `CREATE TABLE IF NOT EXISTS` — a no-op, never a throw.
    raw.prepare('DELETE FROM schema_versions WHERE version >= 8').run();
    expect(() => runMigrations(raw, 7)).not.toThrow();
    expect(nodeVectorsShape(raw)).toEqual(shape);
    expect(getCurrentVersion(raw)).toBe(8);
  });
});
