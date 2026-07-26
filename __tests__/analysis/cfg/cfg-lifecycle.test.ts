import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import CodeGraph from '../../../src/index';
import { setCfgComputeFailureOverrideForTests } from '../../../src/analysis/cfg';
import { DatabaseConnection } from '../../../src/db';
import { CURRENT_SCHEMA_VERSION, getCurrentVersion, runMigrations } from '../../../src/db/migrations';
import { createDatabase, SqliteDatabase } from '../../../src/db/sqlite-adapter';
import { getCodeGraphDir } from '../../../src/directory';
import {
  clearProjectConfigCache,
  deriveProjectConfigRevision,
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

function cfgSnapshotForFile(db: SqliteDatabase, filePath: string): {
  blocks: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  statuses: Array<Record<string, unknown>>;
} {
  return {
    statuses: db
      .prepare(
        `SELECT ${STATUS_COLUMNS.join(', ')}
         FROM cfg_status
         WHERE file_path = ?
         ORDER BY function_id`,
      )
      .all(filePath) as Array<Record<string, unknown>>,
    blocks: db
      .prepare(
        `SELECT cfg_blocks.function_id, block_id, ordinal, role, spans_json
         FROM cfg_blocks
         INNER JOIN cfg_status ON cfg_status.function_id = cfg_blocks.function_id
         WHERE cfg_status.file_path = ?
         ORDER BY cfg_blocks.function_id, ordinal, block_id`,
      )
      .all(filePath) as Array<Record<string, unknown>>,
    edges: db
      .prepare(
        `SELECT cfg_edges.function_id, edge_ordinal, source_block_id, target_block_id, kind
         FROM cfg_edges
         INNER JOIN cfg_status ON cfg_status.function_id = cfg_edges.function_id
         WHERE cfg_status.file_path = ?
         ORDER BY cfg_edges.function_id, edge_ordinal`,
      )
      .all(filePath) as Array<Record<string, unknown>>,
  };
}

function cfgSnapshotForFunction(db: SqliteDatabase, functionId: string): {
  blocks: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  statuses: Array<Record<string, unknown>>;
} {
  return {
    statuses: db
      .prepare(`SELECT ${STATUS_COLUMNS.join(', ')} FROM cfg_status WHERE function_id = ? ORDER BY function_id`)
      .all(functionId) as Array<Record<string, unknown>>,
    blocks: db
      .prepare('SELECT function_id, block_id, ordinal, role, spans_json FROM cfg_blocks WHERE function_id = ? ORDER BY ordinal, block_id')
      .all(functionId) as Array<Record<string, unknown>>,
    edges: db
      .prepare(
        'SELECT function_id, edge_ordinal, source_block_id, target_block_id, kind FROM cfg_edges WHERE function_id = ? ORDER BY edge_ordinal',
      )
      .all(functionId) as Array<Record<string, unknown>>,
  };
}

function cfgTableSnapshot(db: SqliteDatabase): {
  blocks: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  statuses: Array<Record<string, unknown>>;
} {
  return {
    statuses: db
      .prepare(`SELECT ${STATUS_COLUMNS.join(', ')} FROM cfg_status ORDER BY function_id`)
      .all() as Array<Record<string, unknown>>,
    blocks: db
      .prepare('SELECT function_id, block_id, ordinal, role, spans_json FROM cfg_blocks ORDER BY function_id, ordinal, block_id')
      .all() as Array<Record<string, unknown>>,
    edges: db
      .prepare(
        'SELECT function_id, edge_ordinal, source_block_id, target_block_id, kind FROM cfg_edges ORDER BY function_id, edge_ordinal',
      )
      .all() as Array<Record<string, unknown>>,
  };
}

function cfgRefreshFailureMarkerCount(db: SqliteDatabase): number {
  return Number(
    (db.prepare("SELECT COUNT(*) AS count FROM project_metadata WHERE key LIKE 'cfg_refresh_failure:%'").get() as {
      count: number;
    }).count,
  );
}

function signalThatAbortsAfterCfgStatusRows(db: SqliteDatabase): AbortSignal {
  return {
    get aborted(): boolean {
      return rowCount(db, 'cfg_status') > 0;
    },
    addEventListener: () => undefined,
    dispatchEvent: () => false,
    onabort: null,
    reason: undefined,
    removeEventListener: () => undefined,
    throwIfAborted(): void {
      if (rowCount(db, 'cfg_status') > 0) throw new Error('Aborted');
    },
  } as unknown as AbortSignal;
}

function writeConfigAt(configPath: string, contents: string, mtimeMs: number): void {
  fs.writeFileSync(configPath, contents);
  const time = new Date(mtimeMs);
  fs.utimesSync(configPath, time, time);
  clearProjectConfigCache();
}

describe('SPEC-014 CFG SQLite lifecycle schema', () => {
  const dirs: string[] = [];
  const conns: DatabaseConnection[] = [];
  const dbs: SqliteDatabase[] = [];

  afterEach(() => {
    setCfgComputeFailureOverrideForTests(null);
    vi.restoreAllMocks();
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

  it('reuses the config revision while the file stat identity is unchanged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-config-revision-cache-'));
    dirs.push(dir);
    const configPath = path.join(dir, PROJECT_CONFIG_FILENAME);
    fs.writeFileSync(configPath, JSON.stringify({ analysis: { cfg: true } }));
    clearProjectConfigCache();

    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalReadFile = mutableFs.readFileSync;
    const readFile = vi.fn(originalReadFile);
    mutableFs.readFileSync = readFile as typeof fs.readFileSync;
    syncBuiltinESMExports();
    try {
      const readsBefore = readFile.mock.calls.length;
      const first = deriveProjectConfigRevision(dir);
      const readsAfterFirst = readFile.mock.calls.length;
      const second = deriveProjectConfigRevision(dir);

      expect(second).toBe(first);
      expect(readsAfterFirst - readsBefore).toBe(1);
      expect(readFile.mock.calls.length).toBe(readsAfterFirst);

      fs.writeFileSync(configPath, JSON.stringify({ analysis: { cfg: false }, changed: true }));
      const changed = deriveProjectConfigRevision(dir);
      expect(changed).not.toBe(first);
      expect(readFile.mock.calls.length).toBe(readsAfterFirst + 1);
    } finally {
      mutableFs.readFileSync = originalReadFile;
      syncBuiltinESMExports();
    }
  });

  it('backfills CFG payload on first enable during an ordinary zero-change sync', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-first-enable-sync-'));
    dirs.push(dir);
    const configPath = path.join(dir, PROJECT_CONFIG_FILENAME);
    fs.writeFileSync(configPath, JSON.stringify({ analysis: { cfg: false } }));
    fs.writeFileSync(
      path.join(dir, 'app.ts'),
      [
        'export function addOne(value: number): number {',
        '  return value + 1;',
        '}',
        '',
        'export const doubleValue = (value: number): number => {',
        '  return value * 2;',
        '};',
        '',
      ].join('\n'),
    );

    clearProjectConfigCache();
    const cg = CodeGraph.initSync(dir);
    try {
      const indexResult = await cg.indexAll();
      expect(indexResult.success).toBe(true);
      expect(indexResult.filesIndexed).toBe(1);

      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const currentFunctions = db
        .prepare(
          [
            'SELECT id FROM nodes',
            'WHERE file_path = ? AND kind IN (\'function\', \'method\')',
            'ORDER BY id',
          ].join(' '),
        )
        .all('app.ts') as Array<{ id: string }>;

      expect(currentFunctions).toHaveLength(2);
      for (const table of CFG_TABLES) expect(rowCount(db, table)).toBe(0);

      fs.writeFileSync(configPath, JSON.stringify({ analysis: { cfg: true } }));
      clearProjectConfigCache();
      const syncResult = await cg.sync();

      expect(syncResult.filesAdded).toBe(0);
      expect(syncResult.filesModified).toBe(0);
      expect(syncResult.filesRemoved).toBe(0);

      const statuses = db
        .prepare(
          [
            'SELECT function_id, state, reason, source_version FROM cfg_status',
            'ORDER BY function_id',
          ].join(' '),
        )
        .all() as Array<{
          function_id: string;
          reason: string | null;
          source_version: string | null;
          state: string;
        }>;

      expect(statuses.map((row) => row.function_id)).toEqual(currentFunctions.map((row) => row.id));
      for (const status of statuses) {
        expect(status).toMatchObject({
          reason: null,
          state: 'available',
        });
        expect(status.source_version).toMatch(/^cfgsrc:v1:/);

        const readResult = cg.getCfg(status.function_id, { limit: 20, offset: 0 });
        expect(readResult.state).toBe('available');
        expect(readResult.cfg).not.toBeNull();
        expect(readResult.cfg!.blocks.map((block) => block.role)).toEqual(expect.arrayContaining(['entry', 'exit']));
        expect(
          db.prepare('SELECT COUNT(*) AS count FROM cfg_blocks WHERE function_id = ?').get(status.function_id),
        ).toEqual({ count: readResult.cfg!.blocks.length });
        expect(
          db.prepare('SELECT COUNT(*) AS count FROM cfg_edges WHERE function_id = ?').get(status.function_id),
        ).toEqual({ count: readResult.cfg!.edges.length });
      }

      const backfilledSnapshot = cfgSnapshotForFile(db, 'app.ts');
      vi.spyOn(Date, 'now').mockReturnValue(3_000);
      const secondSyncResult = await cg.sync();

      expect(secondSyncResult.filesAdded).toBe(0);
      expect(secondSyncResult.filesModified).toBe(0);
      expect(secondSyncResult.filesRemoved).toBe(0);
      expect(cfgSnapshotForFile(db, 'app.ts')).toEqual(backfilledSnapshot);
    } finally {
      cg.close();
    }
  });

  it('refreshes only affected-file CFG rows during an ordinary changed-file sync', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-affected-file-sync-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, PROJECT_CONFIG_FILENAME), JSON.stringify({ analysis: { cfg: true } }));
    fs.writeFileSync(
      path.join(dir, 'changed.ts'),
      [
        'export function changedAvailable(value: number): number {',
        '  return value + 1;',
        '}',
        '',
        'export function changesToUnsupported(value: number): number {',
        '  return value * 2;',
        '}',
        '',
        'export function removedFromChanged(value: number): number {',
        '  return value * 3;',
        '}',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'unchanged.ts'),
      [
        'export function staysByteIdentical(value: number): number {',
        '  return value - 1;',
        '}',
        '',
      ].join('\n'),
    );

    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const cg = CodeGraph.initSync(dir);
    try {
      const indexResult = await cg.indexAll();
      expect(indexResult.success).toBe(true);
      expect(indexResult.filesIndexed).toBe(2);

      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const unchangedBefore = cfgSnapshotForFile(db, 'unchanged.ts');
      const changedBefore = cfgSnapshotForFile(db, 'changed.ts');
      expect(unchangedBefore.statuses).toHaveLength(1);
      expect(changedBefore.statuses).toHaveLength(3);
      const changedBeforeRows = new Set(changedBefore.statuses.map((row) => JSON.stringify(row)));

      vi.mocked(Date.now).mockReturnValue(2_000);
      fs.writeFileSync(
        path.join(dir, 'changed.ts'),
        [
          'export function changedAvailable(value: number): number {',
          '  if (value > 0) {',
          '    return value + 2;',
          '  }',
          '  return value - 2;',
          '}',
          '',
          'export function changesToUnsupported(value: number): number {',
          '  do {',
          '    value += 1;',
          '  } while (value < 10);',
          '  return value;',
          '}',
          '',
        ].join('\n'),
      );

      const syncResult = await cg.sync();
      expect(syncResult.filesAdded).toBe(0);
      expect(syncResult.filesModified).toBe(1);
      expect(syncResult.filesRemoved).toBe(0);
      expect(syncResult.changedFilePaths).toEqual(['changed.ts']);

      expect(cfgSnapshotForFile(db, 'unchanged.ts')).toEqual(unchangedBefore);

      const changedAfter = cfgSnapshotForFile(db, 'changed.ts');
      const currentStatuses = changedAfter.statuses.filter((row) => row.state !== 'deleted');
      const deletedStatuses = changedAfter.statuses.filter((row) => row.state === 'deleted');
      expect(currentStatuses).toHaveLength(2);
      expect(currentStatuses.map((row) => row.function_name).sort()).toEqual([
        'changedAvailable',
        'changesToUnsupported',
      ]);
      for (const status of currentStatuses) {
        expect(changedBeforeRows.has(JSON.stringify(status))).toBe(false);
        expect(status.source_version).toMatch(/^cfgsrc:v1:/);
        expect(status.updated_at).toBe(2_000);
      }
      for (const status of deletedStatuses) {
        expect(status).toMatchObject({
          reason: 'function_deleted',
          source_version: null,
          updated_at: 2_000,
        });
      }

      const available = currentStatuses.find((row) => row.function_name === 'changedAvailable')!;
      const unsupported = currentStatuses.find((row) => row.function_name === 'changesToUnsupported')!;
      expect(available).toMatchObject({ state: 'available', reason: null });
      expect(unsupported).toMatchObject({ state: 'unsupported', reason: 'unsupported_construct' });
      expect(changedAfter.blocks.filter((row) => row.function_id === available.function_id).length).toBeGreaterThan(0);
      expect(changedAfter.edges.filter((row) => row.function_id === available.function_id).length).toBeGreaterThan(0);
      expect(changedAfter.blocks.filter((row) => row.function_id === unsupported.function_id)).toHaveLength(0);
      expect(changedAfter.edges.filter((row) => row.function_id === unsupported.function_id)).toHaveLength(0);
    } finally {
      cg.close();
    }
  });

  it('keeps compact tombstones for functions deleted from affected files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-deleted-tombstones-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, PROJECT_CONFIG_FILENAME), JSON.stringify({ analysis: { cfg: true } }));
    fs.writeFileSync(
      path.join(dir, 'changed.ts'),
      [
        'export function staysCurrent(value: number): number {',
        '  return value + 1;',
        '}',
        '',
        'export function removedFromChangedFile(value: number): number {',
        '  return value * 2;',
        '}',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'removed-file.ts'),
      [
        'export function removedWithFile(value: number): number {',
        '  return value - 1;',
        '}',
        '',
        'export const removedArrow = (value: number): number => {',
        '  return value - 2;',
        '};',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'unaffected.ts'),
      [
        'export function untouched(value: number): number {',
        '  return value;',
        '}',
        '',
      ].join('\n'),
    );

    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const cg = CodeGraph.initSync(dir);
    try {
      const indexResult = await cg.indexAll();
      expect(indexResult.success).toBe(true);
      expect(indexResult.filesIndexed).toBe(3);

      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const changedBefore = cfgSnapshotForFile(db, 'changed.ts');
      const removedFileBefore = cfgSnapshotForFile(db, 'removed-file.ts');
      const unaffectedBefore = cfgSnapshotForFile(db, 'unaffected.ts');
      const currentBefore = changedBefore.statuses.find((row) => row.function_name === 'staysCurrent')!;
      const removedFromChanged = changedBefore.statuses.find(
        (row) => row.function_name === 'removedFromChangedFile',
      )!;
      const removedWithFileIds = removedFileBefore.statuses.map((row) => String(row.function_id));

      expect(changedBefore.statuses).toHaveLength(2);
      expect(removedFileBefore.statuses).toHaveLength(2);
      expect(unaffectedBefore.statuses).toHaveLength(1);

      vi.mocked(Date.now).mockReturnValue(2_000);
      fs.writeFileSync(
        path.join(dir, 'changed.ts'),
        [
          'export function staysCurrent(value: number): number {',
          '  return value + 2;',
          '}',
          '',
        ].join('\n'),
      );
      fs.rmSync(path.join(dir, 'removed-file.ts'));

      const syncResult = await cg.sync();
      expect(syncResult.filesAdded).toBe(0);
      expect(syncResult.filesModified).toBe(1);
      expect(syncResult.filesRemoved).toBe(1);
      expect(syncResult.changedFilePaths).toEqual(['changed.ts']);

      expect(cfgSnapshotForFile(db, 'unaffected.ts')).toEqual(unaffectedBefore);

      const currentAfter = db
        .prepare('SELECT state, reason, source_version, updated_at FROM cfg_status WHERE function_id = ?')
        .get(currentBefore.function_id) as {
          reason: string | null;
          source_version: string | null;
          state: string;
          updated_at: number;
        };
      expect(currentAfter).toMatchObject({
        reason: null,
        state: 'available',
        updated_at: 2_000,
      });
      expect(currentAfter.source_version).toMatch(/^cfgsrc:v1:/);

      const deletedIds = [String(removedFromChanged.function_id), ...removedWithFileIds];
      for (const functionId of deletedIds) {
        expect(
          db.prepare(
            [
              'SELECT state, reason, source_version, updated_at, file_path, language, function_kind, function_name,',
              'start_line, start_column, end_line, end_column',
              'FROM cfg_status WHERE function_id = ?',
            ].join(' '),
          ).get(functionId),
        ).toMatchObject({
          reason: 'function_deleted',
          source_version: null,
          state: 'deleted',
          updated_at: 2_000,
        });
        expect(
          db.prepare('SELECT COUNT(*) AS count FROM cfg_blocks WHERE function_id = ?').get(functionId),
        ).toEqual({ count: 0 });
        expect(
          db.prepare('SELECT COUNT(*) AS count FROM cfg_edges WHERE function_id = ?').get(functionId),
        ).toEqual({ count: 0 });

        const readResult = cg.getCfg(functionId, { limit: 20, offset: 0 });
        expect(readResult).toMatchObject({
          analysis: 'cfg',
          cfg: null,
          functionId,
          page: null,
          reason: 'function_deleted',
          sourceVersion: null,
          stale: false,
          state: 'deleted',
        });
      }

      expect(cg.getCfg('function:never-seen', { limit: 20, offset: 0 })).toMatchObject({
        analysis: 'cfg',
        cfg: null,
        functionId: 'function:never-seen',
        page: null,
        reason: 'function_unknown',
        sourceVersion: null,
        stale: false,
        state: 'unknown_function',
      });
    } finally {
      cg.close();
    }
  });

  it('keeps retained CFG rows dormant while disabled and refreshes them after re-enable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-disable-reenable-'));
    dirs.push(dir);
    const configPath = path.join(dir, PROJECT_CONFIG_FILENAME);
    const enabledConfig = JSON.stringify({ analysis: { cfg: true } });
    const disabledConfig = JSON.stringify({ analysis: { cfg: false } });
    fs.writeFileSync(
      path.join(dir, 'app.ts'),
      [
        'export function reenabled(value: number): number {',
        '  return value + 1;',
        '}',
        '',
      ].join('\n'),
    );

    writeConfigAt(configPath, enabledConfig, 1_000);
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    let cg = CodeGraph.initSync(dir);
    let functionId: string;
    try {
      expect((await cg.indexAll()).success).toBe(true);
      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      functionId = (db
        .prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?')
        .get('app.ts', 'reenabled') as { id: string }).id;
      expect(cg.getCfg(functionId, { limit: 20, offset: 0 })).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: null,
        state: 'available',
      });
      expect(cfgTableSnapshot(db).statuses).toHaveLength(1);
    } finally {
      cg.close();
    }

    writeConfigAt(configPath, disabledConfig, 2_000);
    vi.mocked(Date.now).mockReturnValue(20_000);
    cg = await CodeGraph.open(dir);
    try {
      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const retainedWhileDisabled = cfgTableSnapshot(db);

      expect(cg.getCfg(functionId!, { limit: 20, offset: 0 })).toMatchObject({
        analysis: 'cfg',
        cfg: null,
        functionId: functionId!,
        page: null,
        reason: 'analysis_disabled',
        sourceVersion: null,
        stale: false,
        state: 'disabled',
      });

      const disabledSync = await cg.sync();
      expect(disabledSync.filesAdded).toBe(0);
      expect(disabledSync.filesModified).toBe(0);
      expect(disabledSync.filesRemoved).toBe(0);
      expect(cfgTableSnapshot(db)).toEqual(retainedWhileDisabled);
    } finally {
      cg.close();
    }

    writeConfigAt(configPath, enabledConfig, 3_000);
    vi.mocked(Date.now).mockReturnValue(30_000);
    cg = await CodeGraph.open(dir);
    try {
      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const retainedBeforeRefresh = cfgTableSnapshot(db);

      expect(cg.getCfg(functionId!, { limit: 20, offset: 0 })).toMatchObject({
        analysis: 'cfg',
        cfg: null,
        functionId: functionId!,
        page: null,
        reason: 'cfg_not_computed',
        sourceVersion: null,
        stale: false,
        state: 'not_computed',
      });
      expect(cfgTableSnapshot(db)).toEqual(retainedBeforeRefresh);

      const reenabledSync = await cg.sync();
      expect(reenabledSync.filesAdded).toBe(0);
      expect(reenabledSync.filesModified).toBe(0);
      expect(reenabledSync.filesRemoved).toBe(0);

      const refreshed = cfgTableSnapshot(db);
      expect(refreshed.statuses).toHaveLength(1);
      expect(refreshed.statuses[0]).toMatchObject({
        function_id: functionId!,
        reason: null,
        state: 'available',
        updated_at: 30_000,
      });
      expect(refreshed.statuses[0]!.source_version).toMatch(/^cfgsrc:v1:/);
      expect(cg.getCfg(functionId!, { limit: 20, offset: 0 })).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: null,
        state: 'available',
      });
      expect(refreshed).not.toEqual(retainedBeforeRefresh);
    } finally {
      cg.close();
    }
  });

  it('contains unexpected CFG refresh failures while retaining prior successful payloads as stale', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-refresh-failures-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, PROJECT_CONFIG_FILENAME), JSON.stringify({ analysis: { cfg: true } }));
    const sourcePath = path.join(dir, 'app.ts');
    const writeSource = (unstableValue: number, healthyValue: number): void => {
      fs.writeFileSync(
        sourcePath,
        [
          'export function unstable(value: number): number {',
          `  return value + ${unstableValue};`,
          '}',
          '',
          'export function healthy(value: number): number {',
          `  return value * ${healthyValue};`,
          '}',
          '',
        ].join('\n'),
      );
    };

    writeSource(1, 2);
    const secret = 'SECRET_SOURCE_SNIPPET return value + 99 at /private/cfg/app.ts';
    setCfgComputeFailureOverrideForTests(({ functionName }) => {
      if (functionName === 'unstable') throw new Error(secret);
    });
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const cg = CodeGraph.initSync(dir);
    try {
      const indexResult = await cg.indexAll();
      expect(indexResult.success).toBe(true);
      expect(indexResult.filesIndexed).toBe(1);

      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const ids = db
        .prepare('SELECT name, id FROM nodes WHERE file_path = ? AND name IN (?, ?) ORDER BY name')
        .all('app.ts', 'healthy', 'unstable') as Array<{ id: string; name: string }>;
      const functionIds = new Map(ids.map((row) => [row.name, row.id]));
      const unstableId = functionIds.get('unstable')!;
      const healthyId = functionIds.get('healthy')!;

      const firstFailedRead = cg.getCfg(unstableId, { limit: 20, offset: 0 });
      expect(firstFailedRead).toMatchObject({
        cfg: null,
        page: null,
        reason: 'first_refresh_failed',
        stale: false,
        state: 'unavailable',
      });
      expect(firstFailedRead.sourceVersion).toMatch(/^cfgsrc:v1:/);
      expect(firstFailedRead.message).toBe('CFG analysis result unavailable.');
      expect(firstFailedRead.message.length).toBeLessThanOrEqual(64);
      expect(firstFailedRead.message).not.toContain('SECRET_SOURCE_SNIPPET');
      expect(firstFailedRead.message).not.toContain('return value + 99');
      expect(cfgSnapshotForFunction(db, unstableId)).toMatchObject({
        blocks: [],
        edges: [],
        statuses: [
          {
            function_id: unstableId,
            reason: 'first_refresh_failed',
            source_version: firstFailedRead.sourceVersion,
            state: 'unavailable',
            updated_at: 1_000,
          },
        ],
      });

      const healthyInitialRead = cg.getCfg(healthyId, { limit: 20, offset: 0 });
      expect(healthyInitialRead).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: null,
        stale: false,
        state: 'available',
      });

      setCfgComputeFailureOverrideForTests(null);
      vi.mocked(Date.now).mockReturnValue(2_000);
      writeSource(2, 3);
      const firstRecoverySync = await cg.sync();
      expect(firstRecoverySync.filesAdded).toBe(0);
      expect(firstRecoverySync.filesModified).toBe(1);
      expect(firstRecoverySync.filesRemoved).toBe(0);

      const recoveredRead = cg.getCfg(unstableId, { limit: 20, offset: 0 });
      expect(recoveredRead).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: null,
        stale: false,
        state: 'available',
      });
      const retainedPayload = cfgSnapshotForFunction(db, unstableId);
      expect(retainedPayload.statuses[0]).toMatchObject({
        reason: null,
        state: 'available',
        updated_at: 2_000,
      });
      expect(retainedPayload.blocks.length).toBeGreaterThan(0);
      expect(retainedPayload.edges.length).toBeGreaterThan(0);
      const healthyBeforeLaterFailure = cfgSnapshotForFunction(db, healthyId);

      setCfgComputeFailureOverrideForTests(({ functionName }) => {
        if (functionName === 'unstable') throw new Error(secret);
      });
      vi.mocked(Date.now).mockReturnValue(3_000);
      writeSource(3, 4);
      const retainedFailureSync = await cg.sync();
      expect(retainedFailureSync.filesAdded).toBe(0);
      expect(retainedFailureSync.filesModified).toBe(1);
      expect(retainedFailureSync.filesRemoved).toBe(0);

      expect(cfgSnapshotForFunction(db, unstableId)).toEqual(retainedPayload);
      const staleRead = cg.getCfg(unstableId, { limit: 20, offset: 0 });
      expect(staleRead).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: 'refresh_failed_retained_stale',
        sourceVersion: retainedPayload.statuses[0]!.source_version,
        stale: true,
        state: 'stale',
      });
      expect(staleRead.message).toBe('CFG analysis result unavailable.');
      expect(staleRead.message.length).toBeLessThanOrEqual(64);
      expect(staleRead.message).not.toContain('SECRET_SOURCE_SNIPPET');
      expect(staleRead.message).not.toContain('return value + 99');

      const healthyAfterLaterFailure = cfgSnapshotForFunction(db, healthyId);
      expect(healthyAfterLaterFailure).not.toEqual(healthyBeforeLaterFailure);
      expect(healthyAfterLaterFailure.statuses[0]).toMatchObject({
        reason: null,
        state: 'available',
        updated_at: 3_000,
      });
      expect(cg.getCfg(healthyId, { limit: 20, offset: 0 })).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: null,
        stale: false,
        state: 'available',
      });

      setCfgComputeFailureOverrideForTests(null);
      vi.mocked(Date.now).mockReturnValue(4_000);
      writeSource(4, 5);
      const finalRecoverySync = await cg.sync();
      expect(finalRecoverySync.filesAdded).toBe(0);
      expect(finalRecoverySync.filesModified).toBe(1);
      expect(finalRecoverySync.filesRemoved).toBe(0);

      const finalRead = cg.getCfg(unstableId, { limit: 20, offset: 0 });
      expect(finalRead).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: null,
        stale: false,
        state: 'available',
      });
      const finalSnapshot = cfgSnapshotForFunction(db, unstableId);
      expect(finalSnapshot).not.toEqual(retainedPayload);
      expect(finalSnapshot.statuses[0]).toMatchObject({
        reason: null,
        state: 'available',
        updated_at: 4_000,
      });
    } finally {
      cg.close();
    }
  });

  it('retains a prior successful payload when a later refresh cannot read indexed source', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-source-read-failure-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, PROJECT_CONFIG_FILENAME), JSON.stringify({ analysis: { cfg: true } }));
    const sourcePath = path.join(dir, 'app.ts');
    const writeSource = (increment: number): void => {
      fs.writeFileSync(
        sourcePath,
        [
          'export function sourceReadProbe(value: number): number {',
          `  return value + ${increment};`,
          '}',
          '',
        ].join('\n'),
      );
    };

    writeSource(1);
    const cg = CodeGraph.initSync(dir);
    try {
      const firstIndex = await cg.indexAll();
      expect(firstIndex.success).toBe(true);

      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const row = db
        .prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?')
        .get('app.ts', 'sourceReadProbe') as { id: string };
      const initialSnapshot = cfgSnapshotForFunction(db, row.id);
      expect(initialSnapshot.statuses[0]).toMatchObject({
        reason: null,
        state: 'available',
      });
      expect(initialSnapshot.blocks.length).toBeGreaterThan(0);

      writeSource(2);
      setCfgComputeFailureOverrideForTests(({ functionName }) => {
        if (functionName === 'sourceReadProbe' && fs.existsSync(sourcePath)) {
          fs.unlinkSync(sourcePath);
        }
      });

      const failedRefresh = await cg.sync();
      expect(failedRefresh.filesModified).toBe(1);
      expect(cfgSnapshotForFunction(db, row.id)).toEqual(initialSnapshot);
      expect(cg.getCfg(row.id, { limit: 20, offset: 0 })).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: 'refresh_failed_retained_stale',
        sourceVersion: initialSnapshot.statuses[0]!.source_version,
        stale: true,
        state: 'stale',
      });
    } finally {
      setCfgComputeFailureOverrideForTests(null);
      cg.close();
    }
  });

  it('turns retained disabled CFG rows for removed functions into tombstones on re-enable full backfill', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-disabled-delete-reenable-'));
    dirs.push(dir);
    const configPath = path.join(dir, PROJECT_CONFIG_FILENAME);
    const enabledConfig = JSON.stringify({ analysis: { cfg: true } });
    const disabledConfig = JSON.stringify({ analysis: { cfg: false } });
    const sourcePath = path.join(dir, 'removed.ts');
    fs.writeFileSync(
      sourcePath,
      [
        'export function removedWhileDisabled(value: number): number {',
        '  return value + 1;',
        '}',
        '',
      ].join('\n'),
    );

    writeConfigAt(configPath, enabledConfig, 1_000);
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    let cg = CodeGraph.initSync(dir);
    let functionId: string;
    try {
      expect((await cg.indexAll()).success).toBe(true);
      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      functionId = (db
        .prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?')
        .get('removed.ts', 'removedWhileDisabled') as { id: string }).id;
      const initialSnapshot = cfgSnapshotForFunction(db, functionId);
      expect(initialSnapshot.statuses).toHaveLength(1);
      expect(initialSnapshot.statuses[0]).toMatchObject({
        reason: null,
        state: 'available',
      });
      expect(initialSnapshot.blocks.length).toBeGreaterThan(0);
      expect(initialSnapshot.edges.length).toBeGreaterThan(0);
    } finally {
      cg.close();
    }

    writeConfigAt(configPath, disabledConfig, 2_000);
    fs.rmSync(sourcePath);
    vi.mocked(Date.now).mockReturnValue(20_000);
    cg = await CodeGraph.open(dir);
    let retainedWhileDisabled: ReturnType<typeof cfgSnapshotForFunction>;
    try {
      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const disabledSync = await cg.sync();
      expect(disabledSync.filesAdded).toBe(0);
      expect(disabledSync.filesModified).toBe(0);
      expect(disabledSync.filesRemoved).toBe(1);
      retainedWhileDisabled = cfgSnapshotForFunction(db, functionId!);
      expect(retainedWhileDisabled.statuses).toHaveLength(1);
      expect(retainedWhileDisabled.statuses[0]).toMatchObject({
        reason: null,
        state: 'available',
      });
      expect(retainedWhileDisabled.blocks.length).toBeGreaterThan(0);
      expect(retainedWhileDisabled.edges.length).toBeGreaterThan(0);
      expect(cg.getCfg(functionId!, { limit: 20, offset: 0 })).toMatchObject({
        cfg: null,
        page: null,
        reason: 'analysis_disabled',
        sourceVersion: null,
        state: 'disabled',
      });
    } finally {
      cg.close();
    }

    writeConfigAt(configPath, enabledConfig, 3_000);
    vi.mocked(Date.now).mockReturnValue(30_000);
    cg = await CodeGraph.open(dir);
    try {
      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      expect(cfgSnapshotForFunction(db, functionId!)).toEqual(retainedWhileDisabled!);

      const reenabledSync = await cg.sync();
      expect(reenabledSync.filesAdded).toBe(0);
      expect(reenabledSync.filesModified).toBe(0);
      expect(reenabledSync.filesRemoved).toBe(0);

      expect(cfgSnapshotForFunction(db, functionId!)).toMatchObject({
        blocks: [],
        edges: [],
        statuses: [
          {
            function_id: functionId!,
            reason: 'function_deleted',
            source_version: null,
            state: 'deleted',
            updated_at: 30_000,
          },
        ],
      });
      expect(cg.getCfg(functionId!, { limit: 20, offset: 0 })).toMatchObject({
        analysis: 'cfg',
        cfg: null,
        functionId: functionId!,
        page: null,
        reason: 'function_deleted',
        sourceVersion: null,
        stale: false,
        state: 'deleted',
      });
    } finally {
      cg.close();
    }
  });

  it('leaves first CFG refresh uncomputed when cancellation happens before the full swap', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-cancel-first-refresh-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, PROJECT_CONFIG_FILENAME), JSON.stringify({ analysis: { cfg: true } }));
    fs.writeFileSync(
      path.join(dir, 'app.ts'),
      [
        'export function cancelled(value: number): number {',
        '  return value + 1;',
        '}',
        '',
      ].join('\n'),
    );
    const abortController = new AbortController();
    setCfgComputeFailureOverrideForTests(({ functionName }) => {
      if (functionName === 'cancelled') abortController.abort();
    });

    const cg = CodeGraph.initSync(dir);
    try {
      expect((await cg.indexAll({ signal: abortController.signal })).success).toBe(true);
      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const functionId = (db
        .prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?')
        .get('app.ts', 'cancelled') as { id: string }).id;

      expect(cfgTableSnapshot(db)).toEqual({ blocks: [], edges: [], statuses: [] });
      expect(cfgRefreshFailureMarkerCount(db)).toBe(0);
      expect(cg.getCfg(functionId, { limit: 20, offset: 0 })).toMatchObject({
        cfg: null,
        page: null,
        reason: 'cfg_not_computed',
        stale: false,
        state: 'not_computed',
      });
    } finally {
      cg.close();
    }
  });

  it('keeps prior CFG payload byte-identical when cancellation happens before an affected-file swap', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-cancel-affected-refresh-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, PROJECT_CONFIG_FILENAME), JSON.stringify({ analysis: { cfg: true } }));
    const sourcePath = path.join(dir, 'app.ts');
    fs.writeFileSync(
      sourcePath,
      [
        'export function cancelled(value: number): number {',
        '  return value + 1;',
        '}',
        '',
      ].join('\n'),
    );

    const cg = CodeGraph.initSync(dir);
    try {
      expect((await cg.indexAll()).success).toBe(true);
      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const functionId = (db
        .prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?')
        .get('app.ts', 'cancelled') as { id: string }).id;
      const priorSnapshot = cfgSnapshotForFunction(db, functionId);
      expect(priorSnapshot.statuses[0]).toMatchObject({
        reason: null,
        state: 'available',
      });

      fs.writeFileSync(
        sourcePath,
        [
          'export function cancelled(value: number): number {',
          '  return value + 2;',
          '}',
          '',
        ].join('\n'),
      );
      const abortController = new AbortController();
      setCfgComputeFailureOverrideForTests(({ functionName }) => {
        if (functionName === 'cancelled') abortController.abort();
      });

      const syncResult = await cg.sync({ signal: abortController.signal });
      expect(syncResult.filesAdded).toBe(0);
      expect(syncResult.filesModified).toBe(1);
      expect(syncResult.filesRemoved).toBe(0);

      expect(cfgSnapshotForFunction(db, functionId)).toEqual(priorSnapshot);
      expect(cfgRefreshFailureMarkerCount(db)).toBe(0);
      expect(cg.getCfg(functionId, { limit: 20, offset: 0 })).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: 'source_version_mismatch',
        sourceVersion: priorSnapshot.statuses[0]!.source_version,
        stale: true,
        state: 'stale',
      });
    } finally {
      cg.close();
    }
  });

  it('keeps a committed full-refresh swap and config revision when cancellation flips immediately after commit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-cancel-after-full-swap-'));
    dirs.push(dir);
    const configPath = path.join(dir, PROJECT_CONFIG_FILENAME);
    fs.writeFileSync(
      path.join(dir, 'app.ts'),
      [
        'export function committed(value: number): number {',
        '  return value + 1;',
        '}',
        '',
      ].join('\n'),
    );

    writeConfigAt(configPath, JSON.stringify({ analysis: { cfg: false } }), 1_000);
    const cg = CodeGraph.initSync(dir);
    try {
      expect((await cg.indexAll()).success).toBe(true);
      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const functionId = (db
        .prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?')
        .get('app.ts', 'committed') as { id: string }).id;
      expect(cfgTableSnapshot(db)).toEqual({ blocks: [], edges: [], statuses: [] });

      writeConfigAt(configPath, JSON.stringify({ analysis: { cfg: true } }), 2_000);
      const signal = signalThatAbortsAfterCfgStatusRows(db);
      const syncResult = await cg.sync({ signal });
      expect(syncResult.filesAdded).toBe(0);
      expect(syncResult.filesModified).toBe(0);
      expect(syncResult.filesRemoved).toBe(0);
      expect(signal.aborted).toBe(true);
      expect(cfgRefreshFailureMarkerCount(db)).toBe(0);

      const committedSnapshot = cfgSnapshotForFunction(db, functionId);
      expect(committedSnapshot.statuses).toHaveLength(1);
      expect(committedSnapshot.statuses[0]).toMatchObject({
        reason: null,
        state: 'available',
      });
      expect(committedSnapshot.blocks.length).toBeGreaterThan(0);
      expect(committedSnapshot.edges.length).toBeGreaterThan(0);
      expect(cg.getCfg(functionId, { limit: 20, offset: 0 })).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: null,
        stale: false,
        state: 'available',
      });
    } finally {
      cg.close();
    }
  });

  it('keeps unchanged CFG rows current through unrelated writes and projects contract mismatch as stale', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-unrelated-writes-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, PROJECT_CONFIG_FILENAME), JSON.stringify({ analysis: { cfg: true } }));
    fs.writeFileSync(
      path.join(dir, 'tracked.ts'),
      [
        'export function tracked(value: number): number {',
        '  return value + 1;',
        '}',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'other.ts'),
      [
        'export function other(value: number): number {',
        '  return value * 2;',
        '}',
        '',
      ].join('\n'),
    );

    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const cg = CodeGraph.initSync(dir);
    try {
      expect((await cg.indexAll()).success).toBe(true);
      const db = (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      const queries = (cg as unknown as { queries: { advanceGraphWriteVersion(): void } }).queries;
      const functionId = (db
        .prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?')
        .get('tracked.ts', 'tracked') as { id: string }).id;
      const initialSnapshot = cfgSnapshotForFunction(db, functionId);
      const initialRead = cg.getCfg(functionId, { limit: 20, offset: 0 });
      expect(initialRead).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: null,
        stale: false,
        state: 'available',
      });
      expect(initialRead.sourceVersion).toBe(initialSnapshot.statuses[0]!.source_version);

      const graphVersionBefore = db
        .prepare("SELECT value FROM project_metadata WHERE key = 'graph_write_version'")
        .get() as { value: string } | undefined;
      vi.mocked(Date.now).mockReturnValue(20_000);
      queries.advanceGraphWriteVersion();
      const graphVersionAfter = db
        .prepare("SELECT value FROM project_metadata WHERE key = 'graph_write_version'")
        .get() as { value: string };
      expect(graphVersionAfter.value).not.toBe(graphVersionBefore?.value ?? null);
      expect(cfgSnapshotForFunction(db, functionId)).toEqual(initialSnapshot);
      expect(cg.getCfg(functionId, { limit: 20, offset: 0 })).toMatchObject({
        reason: null,
        sourceVersion: initialRead.sourceVersion,
        stale: false,
        state: 'available',
      });

      vi.mocked(Date.now).mockReturnValue(30_000);
      fs.writeFileSync(
        path.join(dir, 'other.ts'),
        [
          'export function other(value: number): number {',
          '  return value * 3;',
          '}',
          '',
        ].join('\n'),
      );
      const unrelatedSync = await cg.sync();
      expect(unrelatedSync.filesAdded).toBe(0);
      expect(unrelatedSync.filesModified).toBe(1);
      expect(unrelatedSync.filesRemoved).toBe(0);
      expect(unrelatedSync.changedFilePaths).toEqual(['other.ts']);
      expect(cfgSnapshotForFunction(db, functionId)).toEqual(initialSnapshot);
      const currentAfterUnrelatedSync = cg.getCfg(functionId, { limit: 20, offset: 0 });
      expect(currentAfterUnrelatedSync).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: null,
        sourceVersion: initialRead.sourceVersion,
        stale: false,
        state: 'available',
      });
      expect(currentAfterUnrelatedSync.cfg!.blocks).toEqual(initialRead.cfg!.blocks);
      expect(currentAfterUnrelatedSync.cfg!.edges).toEqual(initialRead.cfg!.edges);

      db.prepare('UPDATE cfg_status SET block_version = block_version + 1 WHERE function_id = ?').run(functionId);
      const mismatchedSnapshot = cfgSnapshotForFunction(db, functionId);
      expect(mismatchedSnapshot.blocks).toEqual(initialSnapshot.blocks);
      expect(mismatchedSnapshot.edges).toEqual(initialSnapshot.edges);
      expect(mismatchedSnapshot.statuses[0]!.block_version).not.toBe(initialSnapshot.statuses[0]!.block_version);

      const staleRead = cg.getCfg(functionId, { limit: 20, offset: 0 });
      expect(staleRead).toMatchObject({
        cfg: expect.any(Object),
        page: expect.any(Object),
        reason: 'source_version_mismatch',
        sourceVersion: initialRead.sourceVersion,
        stale: true,
        state: 'stale',
      });
      expect(staleRead.cfg!.blocks).toEqual(initialRead.cfg!.blocks);
      expect(staleRead.cfg!.edges).toEqual(initialRead.cfg!.edges);
      expect(cfgSnapshotForFunction(db, functionId)).toEqual(mismatchedSnapshot);
    } finally {
      cg.close();
    }
  });
});
