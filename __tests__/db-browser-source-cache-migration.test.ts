import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseConnection } from '../src/db';
import { createDatabase, type SqliteDatabase } from '../src/db/sqlite-adapter';
import {
  CURRENT_SCHEMA_VERSION,
  getCurrentVersion,
  runMigrations,
} from '../src/db/migrations';

const TABLES = ['source_cache', 'index_generations', 'index_publications'] as const;
const INDEXES = [
  'idx_source_cache_path',
  'idx_index_generations_status',
  'idx_index_generations_published',
] as const;

const EXPECTED_COLUMNS = {
  source_cache: [
    'repository_id',
    'generation',
    'path',
    'content_hash',
    'language',
    'size_bytes',
    'mtime_hint',
    'text',
  ],
  index_generations: [
    'repository_id',
    'generation',
    'schema_version',
    'status',
    'manifest_fingerprint',
    'manifest_json',
    'counts_json',
    'warnings_json',
    'started_at',
    'published_at',
    'failure_code',
    'failure_message',
  ],
  index_publications: [
    'repository_id',
    'current_generation',
    'last_success_generation',
    'status',
    'updated_at',
  ],
} satisfies Record<(typeof TABLES)[number], string[]>;

function objectNames(db: SqliteDatabase, type: 'table' | 'index'): Set<string> {
  const rows = db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type) as Array<{
    name: string;
  }>;
  return new Set(rows.map(({ name }) => name));
}

function columns(db: SqliteDatabase, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map(({ name }) => name);
}

function normalizedSql(db: SqliteDatabase, name: string): string {
  const row = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name) as
    | { sql: string | null }
    | undefined;
  return (row?.sql ?? '').replace(/\s+/g, ' ').trim();
}

function sqlFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return sqlFiles(file);
    return entry.name.endsWith('.sql') ? [file] : [];
  });
}

describe('SPEC-007 shared browser source-cache migration', () => {
  const dirs: string[] = [];
  const connections: DatabaseConnection[] = [];
  const databases: SqliteDatabase[] = [];

  afterEach(() => {
    while (connections.length) connections.pop()?.close();
    while (databases.length) databases.pop()?.close();
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  function freshDatabase(): SqliteDatabase {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-browser-schema-fresh-'));
    dirs.push(dir);
    const connection = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    connections.push(connection);
    return connection.getDb();
  }

  function migratedDatabase(): SqliteDatabase {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-browser-schema-migrated-'));
    dirs.push(dir);
    const { db } = createDatabase(path.join(dir, 'codegraph.db'));
    databases.push(db);
    db.exec(`
      CREATE TABLE schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      );
      INSERT INTO schema_versions (version, applied_at, description)
      VALUES (11, 0, 'SPEC-014 CFG');
    `);
    runMigrations(db, 11);
    return db;
  }

  it('advances the canonical version and never creates a browser-only SQL fork', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(12);
    expect(sqlFiles(path.resolve(__dirname, '../web'))).toEqual([]);
  });

  it('creates source-cache, generation, and publication metadata in fresh schema.sql', () => {
    const db = freshDatabase();
    const tables = objectNames(db, 'table');
    const indexes = objectNames(db, 'index');

    for (const table of TABLES) {
      expect(tables.has(table), `missing fresh table ${table}`).toBe(true);
      expect(columns(db, table)).toEqual(EXPECTED_COLUMNS[table]);
    }
    for (const index of INDEXES) {
      expect(indexes.has(index), `missing fresh index ${index}`).toBe(true);
    }
  });

  it('migrates v11 through the same canonical schema-version stream', () => {
    const db = migratedDatabase();
    expect(getCurrentVersion(db)).toBe(CURRENT_SCHEMA_VERSION);

    const tables = objectNames(db, 'table');
    const indexes = objectNames(db, 'index');
    for (const table of TABLES) expect(tables.has(table)).toBe(true);
    for (const index of INDEXES) expect(indexes.has(index)).toBe(true);
  });

  it('keeps fresh and migrated table/index definitions equivalent', () => {
    const fresh = freshDatabase();
    const migrated = migratedDatabase();

    for (const object of [...TABLES, ...INDEXES]) {
      const freshSql = normalizedSql(fresh, object);
      expect(freshSql, `missing fresh definition for ${object}`).not.toBe('');
      expect(normalizedSql(migrated, object)).toBe(freshSql);
    }
  });

  it('rejects oversized cache rows, duplicate published generations, and dangling pointers', () => {
    const db = freshDatabase();
    db.pragma('foreign_keys = ON');

    expect(() => db.prepare(`
      INSERT INTO source_cache (
        repository_id, generation, path, content_hash, size_bytes, text
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('repo-1', 1, 'src/huge.ts', 'hash', 1024 * 1024 + 1, 'x')).toThrow(/constraint/i);

    db.prepare(`
      INSERT INTO index_generations (
        repository_id, generation, schema_version, status,
        manifest_fingerprint, manifest_json, started_at, published_at
      ) VALUES (?, ?, ?, 'published', ?, ?, ?, ?)
    `).run('repo-1', 1, CURRENT_SCHEMA_VERSION, 'fingerprint-1', '{}', 1, 2);

    expect(() => db.prepare(`
      INSERT INTO index_generations (
        repository_id, generation, schema_version, status,
        manifest_fingerprint, manifest_json, started_at, published_at
      ) VALUES (?, ?, ?, 'published', ?, ?, ?, ?)
    `).run('repo-1', 2, CURRENT_SCHEMA_VERSION, 'fingerprint-2', '{}', 3, 4)).toThrow(/unique/i);

    expect(() => db.prepare(`
      INSERT INTO index_publications (
        repository_id, current_generation, last_success_generation, status, updated_at
      ) VALUES (?, ?, ?, 'ready', ?)
    `).run('repo-2', 99, 99, 5)).toThrow(/foreign key/i);
  });
});
