/**
 * SPEC-011 (T006) — the five catalog tables ship and migrate in lockstep.
 *
 * Constitution VII: new SQL ships only because `copy-assets` copies
 * `src/db/schema.sql` into `dist/db/schema.sql`. This proves (a) the shipped
 * asset carries the new DDL, (b) a fresh DB (schema.sql path) and (c) a migrated
 * DB (v9 → current path) both gain the SPEC-011 tables + sort indexes, with
 * byte-equivalent table shapes across the two paths (data-model.md).
 *
 * Real SQLite in temp dirs (no mocking), per repo convention.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseConnection } from '../../src/db';
import { createDatabase, SqliteDatabase } from '../../src/db/sqlite-adapter';
import { CURRENT_SCHEMA_VERSION, runMigrations, getCurrentVersion } from '../../src/db/migrations';

const CATALOG_TABLES = ['flows', 'flow_steps', 'clusters', 'cluster_members', 'catalog_meta'];
const CATALOG_INDEXES = [
  'idx_flows_name',
  'idx_flow_steps_flow',
  'idx_clusters_sort',
  'idx_cluster_members_cluster',
];

const CFG_TABLES = ['cfg_blocks', 'cfg_edges', 'cfg_status'] as const;
const CFG_INDEXES = [
  'idx_cfg_blocks_function_ordinal',
  'idx_cfg_edges_function_ordinal',
  'idx_cfg_status_file_path',
  'idx_cfg_status_source_version',
  'idx_cfg_status_state',
] as const;
const CFG_TRIGGERS = [
  'cfg_blocks_require_available_status_insert',
  'cfg_blocks_require_available_status_update',
  'cfg_status_reject_non_available_payload_update',
] as const;

function objectNames(db: SqliteDatabase, type: 'table' | 'index' | 'trigger'): Set<string> {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = ?`).all(type) as {
    name: string;
  }[];
  return new Set(rows.map((r) => r.name));
}

function matchingObjectNames(db: SqliteDatabase, type: 'table' | 'index' | 'trigger', nameGlob: string): string[] {
  const rows = db
    .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name GLOB ? ORDER BY name')
    .all(type, nameGlob) as { name: string }[];
  return rows.map((row) => row.name);
}

/** A comparable column-shape signature for one table. */
function tableShape(db: SqliteDatabase, table: string): string {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;
  return cols
    .map((c) => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value ?? 'NULL'}:${c.pk}`)
    .join('|');
}

describe('SPEC-011 catalog schema ships + migrates in lockstep', () => {
  const dirs: string[] = [];
  const conns: DatabaseConnection[] = [];
  const dbs: SqliteDatabase[] = [];

  afterEach(() => {
    while (conns.length) conns.pop()?.close();
    while (dbs.length) dbs.pop()?.close();
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('CURRENT_SCHEMA_VERSION includes later schema migrations after SPEC-011 v10', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(11);
  });

  it('a fresh DB (schema.sql path) has all five catalog tables + sort indexes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ship-init-'));
    dirs.push(dir);
    const conn = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    conns.push(conn);
    const db = conn.getDb();
    const tables = objectNames(db, 'table');
    for (const t of CATALOG_TABLES) expect(tables.has(t)).toBe(true);
    const indexes = objectNames(db, 'index');
    for (const idx of CATALOG_INDEXES) expect(indexes.has(idx)).toBe(true);
  });

  it('migrating a v9 DB through current schema creates the SPEC-011 tables + indexes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ship-mig-'));
    dirs.push(dir);
    const { db } = createDatabase(path.join(dir, 'codegraph.db'));
    dbs.push(db);
    // Simulate a pre-v10 (v9) database: schema_versions recorded at 9, none of
    // the catalog tables present yet.
    db.exec(`
      CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, description TEXT);
      INSERT INTO schema_versions (version, applied_at, description) VALUES (9, 0, 'node_vectors');
    `);
    const before = objectNames(db, 'table');
    for (const t of CATALOG_TABLES) expect(before.has(t)).toBe(false);

    runMigrations(db, 9);

    expect(getCurrentVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    const after = objectNames(db, 'table');
    for (const t of CATALOG_TABLES) expect(after.has(t)).toBe(true);
    const indexes = objectNames(db, 'index');
    for (const idx of CATALOG_INDEXES) expect(indexes.has(idx)).toBe(true);
  });

  it('schema.sql and the migration path from v9 define byte-equivalent SPEC-011 table shapes', () => {
    // Fresh (schema.sql) DB.
    const initDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ship-shape-init-'));
    dirs.push(initDir);
    const conn = DatabaseConnection.initialize(path.join(initDir, 'codegraph.db'));
    conns.push(conn);
    const initDb = conn.getDb();

    // Migrated (v9 → current) DB.
    const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ship-shape-mig-'));
    dirs.push(migDir);
    const { db: migDb } = createDatabase(path.join(migDir, 'codegraph.db'));
    dbs.push(migDb);
    migDb.exec(`
      CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, description TEXT);
      INSERT INTO schema_versions (version, applied_at, description) VALUES (9, 0, 'node_vectors');
    `);
    runMigrations(migDb, 9);

    for (const t of CATALOG_TABLES) {
      expect(tableShape(migDb, t)).toBe(tableShape(initDb, t));
    }
  });

  it('copy-assets shipped the new DDL into dist/db/schema.sql (Constitution VII)', () => {
    const shipped = path.resolve(__dirname, '../../dist/db/schema.sql');
    const sql = fs.readFileSync(shipped, 'utf-8');
    for (const t of CATALOG_TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    }
  });

  it('copy-assets keeps source and shipped schema byte-identical with exact SPEC-014 CFG DDL', () => {
    const source = path.resolve(__dirname, '../../src/db/schema.sql');
    const shipped = path.resolve(__dirname, '../../dist/db/schema.sql');
    const sourceBytes = fs.readFileSync(source);
    const shippedBytes = fs.readFileSync(shipped);

    expect(Buffer.compare(shippedBytes, sourceBytes)).toBe(0);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ship-cfg-ddl-'));
    dirs.push(dir);
    const { db } = createDatabase(path.join(dir, 'codegraph.db'));
    dbs.push(db);
    db.exec(shippedBytes.toString('utf-8'));

    const cfgTables = matchingObjectNames(db, 'table', 'cfg_*');
    const cfgIndexes = matchingObjectNames(db, 'index', 'idx_cfg_*');
    const cfgTriggers = matchingObjectNames(db, 'trigger', 'cfg_*');

    expect(cfgTables).toHaveLength(3);
    expect(cfgTables).toEqual([...CFG_TABLES]);
    expect(cfgIndexes).toHaveLength(5);
    expect(cfgIndexes).toEqual([...CFG_INDEXES]);
    expect(cfgTriggers).toHaveLength(3);
    expect(cfgTriggers).toEqual([...CFG_TRIGGERS]);
  });
});
