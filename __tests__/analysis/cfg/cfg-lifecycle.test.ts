import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import CodeGraph from '../../../src/index';
import { DatabaseConnection } from '../../../src/db';
import { CURRENT_SCHEMA_VERSION, getCurrentVersion, runMigrations } from '../../../src/db/migrations';
import { createDatabase, SqliteDatabase } from '../../../src/db/sqlite-adapter';
import { getCodeGraphDir } from '../../../src/directory';
import {
  clearProjectConfigCache,
  loadAnalysisConfig,
  PROJECT_CONFIG_FILENAME,
} from '../../../src/project-config';

const CFG_TABLES = ['cfg_status', 'cfg_blocks', 'cfg_edges'] as const;

const CFG_INDEXES = [
  'idx_cfg_status_file_path',
  'idx_cfg_status_source_version',
  'idx_cfg_status_state',
  'idx_cfg_blocks_function_ordinal',
  'idx_cfg_edges_function_ordinal',
] as const;

const CFG_TRIGGERS = [
  'cfg_blocks_require_available_status_insert',
  'cfg_blocks_require_available_status_update',
  'cfg_status_reject_non_available_payload_update',
] as const;

const STATUS_COLUMNS = [
  'function_id',
  'file_path',
  'language',
  'function_kind',
  'function_name',
  'start_line',
  'start_column',
  'end_line',
  'end_column',
  'state',
  'reason',
  'message',
  'source_version',
  'status_version',
  'block_version',
  'edge_version',
  'schema_version',
  'updated_at',
];

const BLOCK_COLUMNS = ['function_id', 'block_id', 'ordinal', 'role', 'spans_json'];
const EDGE_COLUMNS = ['function_id', 'edge_ordinal', 'source_block_id', 'target_block_id', 'kind'];

function objectNames(db: SqliteDatabase, type: 'table' | 'index' | 'trigger'): Set<string> {
  const rows = db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type) as Array<{
    name: string;
  }>;
  return new Set(rows.map((row) => row.name));
}

function columnNames(db: SqliteDatabase, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function primaryKeyColumns(db: SqliteDatabase, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; pk: number }>;
  return rows
    .filter((row) => row.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((row) => row.name);
}

function indexColumns(db: SqliteDatabase, index: string): string[] {
  const rows = db.prepare(`PRAGMA index_info(${index})`).all() as Array<{ name: string; seqno: number }>;
  return rows.sort((left, right) => left.seqno - right.seqno).map((row) => row.name);
}

function foreignKeys(db: SqliteDatabase, table: string): string[] {
  const rows = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
    id: number;
    seq: number;
    table: string;
    from: string;
    to: string;
    on_delete: string;
  }>;
  return rows
    .sort((left, right) => left.id - right.id || left.seq - right.seq)
    .map((row) => `${row.from}->${row.table}.${row.to}:${row.on_delete}`);
}

function normalizedObjectSql(db: SqliteDatabase, name: string): string {
  const row = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name) as
    | { sql: string | null }
    | undefined;
  return (row?.sql ?? '').replace(/\s+/g, ' ').trim();
}

function insertStatus(
  db: SqliteDatabase,
  functionId: string,
  state: 'available' | 'deleted' = 'available',
): void {
  db.prepare(
    `INSERT INTO cfg_status
      (function_id, file_path, language, function_kind, function_name,
       start_line, start_column, end_line, end_column,
       state, reason, message, source_version,
       status_version, block_version, edge_version, schema_version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    functionId,
    functionId === 'fn:other' ? 'src/other.ts' : 'src/app.ts',
    'typescript',
    'function',
    functionId.replace('fn:', ''),
    1,
    0,
    5,
    1,
    state,
    state === 'available' ? null : 'function_deleted',
    state === 'available' ? null : 'function removed',
    state === 'available' ? `${functionId}:source:v1` : null,
    1,
    1,
    1,
    CURRENT_SCHEMA_VERSION,
    123,
  );
}

function insertBlock(db: SqliteDatabase, functionId: string, blockId: string, ordinal: number): void {
  db.prepare(
    `INSERT INTO cfg_blocks (function_id, block_id, ordinal, role, spans_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(functionId, blockId, ordinal, ordinal === 0 ? 'entry' : 'exit', '[]');
}

function rowCount(db: SqliteDatabase, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe('SPEC-014 CFG SQLite lifecycle schema', () => {
  const dirs: string[] = [];
  const conns: DatabaseConnection[] = [];
  const dbs: SqliteDatabase[] = [];

  afterEach(() => {
    while (conns.length) conns.pop()?.close();
    while (dbs.length) dbs.pop()?.close();
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
    clearProjectConfigCache();
  });

  function freshDb(): SqliteDatabase {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-fresh-'));
    dirs.push(dir);
    const conn = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    conns.push(conn);
    return conn.getDb();
  }

  function migratedDb(): SqliteDatabase {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-migrated-'));
    dirs.push(dir);
    const { db } = createDatabase(path.join(dir, 'codegraph.db'));
    dbs.push(db);
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, description TEXT);
      INSERT INTO schema_versions (version, applied_at, description) VALUES (10, 0, 'SPEC-011 catalogs');
    `);
    runMigrations(db, 10);
    return db;
  }

  it('fresh schema creates CFG status, block, and edge tables with by-value ownership and required indexes', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(11);

    const db = freshDb();
    const tables = objectNames(db, 'table');
    for (const table of CFG_TABLES) expect(tables.has(table)).toBe(true);

    expect(columnNames(db, 'cfg_status')).toEqual(STATUS_COLUMNS);
    expect(columnNames(db, 'cfg_blocks')).toEqual(BLOCK_COLUMNS);
    expect(columnNames(db, 'cfg_edges')).toEqual(EDGE_COLUMNS);
    expect(primaryKeyColumns(db, 'cfg_status')).toEqual(['function_id']);
    expect(primaryKeyColumns(db, 'cfg_blocks')).toEqual(['function_id', 'block_id']);
    expect(foreignKeys(db, 'cfg_status')).toEqual([]);

    const indexes = objectNames(db, 'index');
    for (const index of CFG_INDEXES) expect(indexes.has(index)).toBe(true);
    expect(indexColumns(db, 'idx_cfg_status_file_path')).toEqual(['file_path']);
    expect(indexColumns(db, 'idx_cfg_status_source_version')).toEqual(['source_version']);
    expect(indexColumns(db, 'idx_cfg_status_state')).toEqual(['state']);
    expect(indexColumns(db, 'idx_cfg_blocks_function_ordinal')).toEqual(['function_id', 'ordinal']);
    expect(indexColumns(db, 'idx_cfg_edges_function_ordinal')).toEqual(['function_id', 'edge_ordinal']);

    const triggers = objectNames(db, 'trigger');
    for (const trigger of CFG_TRIGGERS) expect(triggers.has(trigger)).toBe(true);
  });

  it('migration-created CFG schema matches fresh schema for tables, indexes, triggers, and version', () => {
    const fresh = freshDb();
    const migrated = migratedDb();

    expect(getCurrentVersion(migrated)).toBe(CURRENT_SCHEMA_VERSION);

    const migratedTables = objectNames(migrated, 'table');
    const migratedIndexes = objectNames(migrated, 'index');
    const migratedTriggers = objectNames(migrated, 'trigger');
    for (const table of CFG_TABLES) expect(migratedTables.has(table)).toBe(true);
    for (const index of CFG_INDEXES) expect(migratedIndexes.has(index)).toBe(true);
    for (const trigger of CFG_TRIGGERS) expect(migratedTriggers.has(trigger)).toBe(true);
    for (const objectName of [...CFG_TABLES, ...CFG_INDEXES, ...CFG_TRIGGERS]) {
      expect(normalizedObjectSql(migrated, objectName)).toBe(normalizedObjectSql(fresh, objectName));
    }
    for (const table of CFG_TABLES) {
      expect(foreignKeys(migrated, table)).toEqual(foreignKeys(fresh, table));
    }
  });

  it('enforces CFG-owned cascades, same-function edges, contract versions, and compact tombstones', () => {
    const db = freshDb();

    insertStatus(db, 'fn:main');
    insertBlock(db, 'fn:main', 'main-entry', 0);
    insertBlock(db, 'fn:main', 'main-exit', 1);
    db.prepare(
      `INSERT INTO cfg_edges (function_id, edge_ordinal, source_block_id, target_block_id, kind)
       VALUES (?, ?, ?, ?, ?)`
    ).run('fn:main', 0, 'main-entry', 'main-exit', 'fallthrough');

    expect(() => insertBlock(db, 'fn:main', 'main-other', 1)).toThrow(/constraint/i);

    insertStatus(db, 'fn:other');
    insertBlock(db, 'fn:other', 'other-entry', 0);
    expect(() =>
      db.prepare(
        `INSERT INTO cfg_edges (function_id, edge_ordinal, source_block_id, target_block_id, kind)
         VALUES (?, ?, ?, ?, ?)`
      ).run('fn:main', 1, 'main-entry', 'other-entry', 'fallthrough')
    ).toThrow(/constraint/i);

    expect(() =>
      db.prepare(
        `INSERT INTO cfg_status
          (function_id, file_path, language, function_kind, function_name,
           start_line, start_column, end_line, end_column,
           state, reason, message, source_version,
           status_version, block_version, edge_version, schema_version, updated_at)
         VALUES ('fn:bad-state', 'src/app.ts', 'typescript', 'function', 'badState',
           1, 0, 1, 1, 'stale', 'source_version_mismatch', NULL, 'source:v1',
           1, 1, 1, 11, 123)`
      ).run()
    ).toThrow(/constraint/i);

    expect(() =>
      db.prepare(
        `INSERT INTO cfg_status
          (function_id, file_path, language, function_kind, function_name,
           start_line, start_column, end_line, end_column,
           state, reason, message, source_version,
           status_version, block_version, edge_version, schema_version, updated_at)
         VALUES (?, 'src/app.ts', 'typescript', 'function', 'badVersion',
           1, 0, 1, 1, 'available', NULL, NULL, 'source:v1',
           0, 1, 1, 11, 123)`
      ).run('fn:bad-version')
    ).toThrow(/constraint/i);

    expect(() =>
      db.prepare(
        `INSERT INTO cfg_status
          (function_id, file_path, language, function_kind, function_name,
           start_line, start_column, end_line, end_column,
           state, reason, message, source_version,
           status_version, block_version, edge_version, schema_version, updated_at)
         VALUES (?, 'src/app.ts', 'typescript', 'function', 'longMessage',
           1, 0, 1, 1, 'unsupported', 'unsupported_construct', ?, 'source:v1',
           1, 1, 1, 11, 123)`
      ).run('fn:long-message', 'x'.repeat(241))
    ).toThrow(/constraint/i);

    db.prepare('DELETE FROM cfg_status WHERE function_id = ?').run('fn:main');
    expect(db.prepare('SELECT COUNT(*) AS count FROM cfg_blocks WHERE function_id = ?').get('fn:main')).toEqual({
      count: 0,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM cfg_edges WHERE function_id = ?').get('fn:main')).toEqual({
      count: 0,
    });

    insertStatus(db, 'fn:deleted', 'deleted');
    expect(
      db.prepare('SELECT state, reason, source_version FROM cfg_status WHERE function_id = ?').get('fn:deleted')
    ).toEqual({
      state: 'deleted',
      reason: 'function_deleted',
      source_version: null,
    });
    expect(() => insertBlock(db, 'fn:deleted', 'deleted-entry', 0)).toThrow(/available status/i);
  });

  it('keeps CFG dormant by default and when explicitly disabled without affecting indexing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-dormant-'));
    dirs.push(dir);
    const configPath = path.join(dir, PROJECT_CONFIG_FILENAME);

    clearProjectConfigCache();
    expect(loadAnalysisConfig(dir)).toEqual({ flows: false, clusters: false, cfg: false });

    fs.writeFileSync(configPath, JSON.stringify({ analysis: { cfg: false, flows: false, clusters: 'yes' } }));
    clearProjectConfigCache();
    expect(loadAnalysisConfig(dir)).toEqual({ flows: false, clusters: false, cfg: false });

    fs.writeFileSync(path.join(dir, 'app.ts'), 'export function live(value: number) { return value + 1; }\n');
    const cg = CodeGraph.initSync(dir);
    try {
      const result = await cg.indexAll();
      expect(result.success).toBe(true);
      expect(result.filesIndexed).toBe(1);
    } finally {
      cg.close();
    }

    const conn = DatabaseConnection.open(path.join(getCodeGraphDir(dir), 'codegraph.db'));
    conns.push(conn);
    const db = conn.getDb();
    expect(rowCount(db, 'nodes')).toBeGreaterThan(0);
    for (const table of CFG_TABLES) expect(rowCount(db, table)).toBe(0);

    fs.writeFileSync(configPath, JSON.stringify({ analysis: { cfg: true } }));
    clearProjectConfigCache();
    expect(loadAnalysisConfig(dir)).toEqual({ flows: false, clusters: false, cfg: true });
  });
});
