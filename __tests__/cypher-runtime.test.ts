import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type SqliteStatement = {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
};

type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
};

type StorageNodeRecord = {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  docstring: string | null;
  signature: string | null;
  visibility: string | null;
  is_exported: number | null;
  is_async: number | null;
  is_static: number | null;
  is_abstract: number | null;
  decorators: string | null;
  type_parameters: string | null;
  return_type: string | null;
  updated_at: number;
};

type StorageEdgeRecord = {
  id: number;
  source: string;
  target: string;
  kind: string;
  metadata: string | null;
  line: number | null;
  col: number | null;
  provenance: string | null;
};

export type CypherGraphSnapshot = {
  readonly sqliteSchemaVersion: number;
  readonly sqliteDataVersion: number;
  readonly schemaVersions: number[];
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly activeEdgeCount: number;
  readonly inactiveLspSuppressedEdgeCount: number;
  readonly representativeNode: StorageNodeRecord;
  readonly representativeEdge: StorageEdgeRecord;
};

export type CypherRuntimeFixture = {
  readonly projectRoot: string;
  readonly dbPath: string;
  readonly db: SqliteDatabase;
  readonly nodes: {
    readonly fileMain: string;
    readonly entry: string;
    readonly helper: string;
    readonly lspTarget: string;
    readonly heuristicTarget: string;
    readonly staleLspTarget: string;
    readonly cycleA: string;
    readonly cycleB: string;
    readonly cycleC: string;
    readonly malformedOpaque: string;
    readonly highDegreeHub: string;
    readonly highDegreeTargets: string[];
  };
  readonly edges: {
    readonly activeStaticCall: number;
    readonly activeLspCall: number;
    readonly activeHeuristicCall: number;
    readonly inactiveLspSuppressedCall: number;
    readonly malformedMetadataCall: number;
    readonly cycleCalls: number[];
    readonly highDegreeCalls: number[];
  };
  readonly initialSnapshot: CypherGraphSnapshot;
  readonly snapshot: () => CypherGraphSnapshot;
  readonly close: () => void;
};

export const CYPHER_ACTIVE_EDGE_SQL = `(CASE
  WHEN metadata IS NULL THEN 1
  WHEN json_valid(metadata) = 0 THEN 1
  WHEN json_extract(metadata, '$.lsp.active') = 0 THEN 0
  ELSE 1
END) = 1`;

const openFixtures: CypherRuntimeFixture[] = [];

let nodeSqliteAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:sqlite');
  nodeSqliteAvailable = true;
} catch {
  nodeSqliteAvailable = false;
}

afterEach(() => {
  for (const fixture of openFixtures.splice(0)) {
    fixture.close();
  }
});

function openSqlite(dbPath: string): SqliteDatabase {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (filename: string) => SqliteDatabase;
  };
  return new DatabaseSync(dbPath);
}

function schemaSql(): string {
  return fs.readFileSync(path.join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf8');
}

function numericPragma(db: SqliteDatabase, pragma: 'schema_version' | 'data_version'): number {
  const row = db.prepare(`PRAGMA ${pragma}`).get();
  if (row && typeof row === 'object') {
    const value = Object.values(row as Record<string, unknown>)[0];
    if (typeof value === 'number') return value;
  }
  throw new Error(`Unexpected PRAGMA ${pragma} result`);
}

function scalarCount(db: SqliteDatabase, sql: string): number {
  const row = db.prepare(sql).get();
  if (row && typeof row === 'object') {
    const value = Object.values(row as Record<string, unknown>)[0];
    if (typeof value === 'number') return value;
  }
  throw new Error(`Unexpected count result for ${sql}`);
}

type NodeInput = {
  id: string;
  kind?: string;
  name: string;
  qualifiedName?: string;
  filePath?: string;
  language?: string;
  startLine?: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  docstring?: string | null;
  signature?: string | null;
  visibility?: string | null;
  isExported?: boolean | null;
  isAsync?: boolean | null;
  isStatic?: boolean | null;
  isAbstract?: boolean | null;
  decorators?: string | null;
  typeParameters?: string | null;
  returnType?: string | null;
};

function boolToStorage(value: boolean | null | undefined): number | null {
  if (value === null) return null;
  return value ? 1 : 0;
}

function insertNode(db: SqliteDatabase, input: NodeInput, updatedAt: number): string {
  db.prepare(`
    INSERT INTO nodes (
      id, kind, name, qualified_name, file_path, language,
      start_line, end_line, start_column, end_column,
      docstring, signature, visibility,
      is_exported, is_async, is_static, is_abstract,
      decorators, type_parameters, return_type, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.kind ?? 'function',
    input.name,
    input.qualifiedName ?? input.name,
    input.filePath ?? 'src/main.ts',
    input.language ?? 'typescript',
    input.startLine ?? 1,
    input.endLine ?? input.startLine ?? 1,
    input.startColumn ?? 0,
    input.endColumn ?? 0,
    input.docstring ?? null,
    input.signature ?? null,
    input.visibility ?? null,
    boolToStorage(input.isExported ?? false),
    boolToStorage(input.isAsync ?? false),
    boolToStorage(input.isStatic ?? false),
    boolToStorage(input.isAbstract ?? false),
    input.decorators ?? null,
    input.typeParameters ?? null,
    input.returnType ?? null,
    updatedAt
  );
  return input.id;
}

function insertEdge(
  db: SqliteDatabase,
  source: string,
  target: string,
  kind: string,
  metadata: string | null,
  line: number | null,
  column: number | null,
  provenance: string | null
): number {
  db.prepare(`
    INSERT INTO edges (source, target, kind, metadata, line, col, provenance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(source, target, kind, metadata, line, column, provenance);

  const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
  return row.id;
}

function nodeRecord(db: SqliteDatabase, id: string): StorageNodeRecord {
  const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
  if (!row) throw new Error(`Missing node ${id}`);
  return row as StorageNodeRecord;
}

function edgeRecord(db: SqliteDatabase, id: number): StorageEdgeRecord {
  const row = db.prepare('SELECT * FROM edges WHERE id = ?').get(id);
  if (!row) throw new Error(`Missing edge ${id}`);
  return row as StorageEdgeRecord;
}

export function snapshotCypherGraph(db: SqliteDatabase, representative: {
  readonly nodeId: string;
  readonly edgeId: number;
}): CypherGraphSnapshot {
  const schemaRows = db.prepare('SELECT version FROM schema_versions ORDER BY version').all() as Array<{ version: number }>;

  return {
    sqliteSchemaVersion: numericPragma(db, 'schema_version'),
    sqliteDataVersion: numericPragma(db, 'data_version'),
    schemaVersions: schemaRows.map((row) => row.version),
    nodeCount: scalarCount(db, 'SELECT count(*) AS count FROM nodes'),
    edgeCount: scalarCount(db, 'SELECT count(*) AS count FROM edges'),
    activeEdgeCount: scalarCount(db, `SELECT count(*) AS count FROM edges WHERE ${CYPHER_ACTIVE_EDGE_SQL}`),
    inactiveLspSuppressedEdgeCount: scalarCount(
      db,
      `SELECT count(*) AS count FROM edges WHERE provenance = 'lsp' AND NOT ${CYPHER_ACTIVE_EDGE_SQL}`
    ),
    representativeNode: nodeRecord(db, representative.nodeId),
    representativeEdge: edgeRecord(db, representative.edgeId),
  };
}

export function createCypherRuntimeFixture(): CypherRuntimeFixture {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cypher-runtime-'));
  const codegraphDir = path.join(projectRoot, '.codegraph');
  fs.mkdirSync(codegraphDir, { recursive: true });
  const dbPath = path.join(codegraphDir, 'codegraph.db');
  const db = openSqlite(dbPath);

  db.exec(schemaSql());
  db.prepare(`
    INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, errors)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('src/main.ts', 'hash-main', 'typescript', 321, 1700000000000, 1700000000100, 0, '[]');

  const updatedAt = 1700000000000;
  const nodes = {
    fileMain: insertNode(db, {
      id: 'file:src/main.ts',
      kind: 'file',
      name: 'main.ts',
      qualifiedName: 'src/main.ts',
      filePath: 'src/main.ts',
      startLine: 1,
      endLine: 80,
      decorators: '[]',
      typeParameters: '[]',
    }, updatedAt),
    entry: insertNode(db, {
      id: 'fn:entry',
      name: 'entry',
      qualifiedName: 'src/main.entry',
      startLine: 3,
      endLine: 12,
      signature: 'function entry(): void',
      visibility: 'public',
      isExported: true,
      decorators: '["@trace"]',
      typeParameters: '["T"]',
      returnType: 'void',
    }, updatedAt),
    helper: insertNode(db, {
      id: 'fn:helper',
      name: 'helper',
      qualifiedName: 'src/main.helper',
      startLine: 14,
      endLine: 18,
      signature: 'function helper(): number',
      returnType: 'number',
    }, updatedAt),
    lspTarget: insertNode(db, {
      id: 'fn:lspTarget',
      name: 'lspTarget',
      qualifiedName: 'src/main.lspTarget',
      startLine: 20,
      endLine: 24,
    }, updatedAt),
    heuristicTarget: insertNode(db, {
      id: 'fn:heuristicTarget',
      name: 'heuristicTarget',
      qualifiedName: 'src/main.heuristicTarget',
      startLine: 26,
      endLine: 30,
    }, updatedAt),
    staleLspTarget: insertNode(db, {
      id: 'fn:staleLspTarget',
      name: 'staleLspTarget',
      qualifiedName: 'src/main.staleLspTarget',
      startLine: 32,
      endLine: 36,
    }, updatedAt),
    cycleA: insertNode(db, { id: 'fn:cycleA', name: 'cycleA', qualifiedName: 'src/main.cycleA', startLine: 40 }, updatedAt),
    cycleB: insertNode(db, { id: 'fn:cycleB', name: 'cycleB', qualifiedName: 'src/main.cycleB', startLine: 44 }, updatedAt),
    cycleC: insertNode(db, { id: 'fn:cycleC', name: 'cycleC', qualifiedName: 'src/main.cycleC', startLine: 48 }, updatedAt),
    malformedOpaque: insertNode(db, {
      id: 'fn:malformedOpaque',
      name: 'malformedOpaque',
      qualifiedName: 'src/main.malformedOpaque',
      startLine: 52,
      decorators: '{bad decorators',
      typeParameters: '{"wrong":"shape"}',
    }, updatedAt),
    highDegreeHub: insertNode(db, {
      id: 'fn:hub',
      name: 'hub',
      qualifiedName: 'src/main.hub',
      startLine: 60,
    }, updatedAt),
    highDegreeTargets: Array.from({ length: 12 }, (_, index) => insertNode(db, {
      id: `fn:target${String(index + 1).padStart(2, '0')}`,
      name: `target${String(index + 1).padStart(2, '0')}`,
      qualifiedName: `src/main.target${String(index + 1).padStart(2, '0')}`,
      startLine: 61 + index,
    }, updatedAt)),
  };

  const edges = {
    activeStaticCall: insertEdge(db, nodes.entry, nodes.helper, 'calls', JSON.stringify({ resolvedBy: 'static' }), 5, 2, 'tree-sitter'),
    activeLspCall: insertEdge(db, nodes.entry, nodes.lspTarget, 'calls', JSON.stringify({ lsp: { active: true, decision: 'verified' } }), 6, 4, 'lsp'),
    activeHeuristicCall: insertEdge(db, nodes.entry, nodes.heuristicTarget, 'calls', JSON.stringify({ synthesizedBy: 'callback' }), 7, 6, 'heuristic'),
    inactiveLspSuppressedCall: insertEdge(
      db,
      nodes.entry,
      nodes.staleLspTarget,
      'calls',
      JSON.stringify({ lsp: { active: false, decision: 'suppressed' } }),
      8,
      8,
      'lsp'
    ),
    malformedMetadataCall: insertEdge(db, nodes.helper, nodes.malformedOpaque, 'calls', 'broken json {{{', 16, 3, 'tree-sitter'),
    cycleCalls: [
      insertEdge(db, nodes.cycleA, nodes.cycleB, 'calls', null, 41, 0, 'tree-sitter'),
      insertEdge(db, nodes.cycleB, nodes.cycleC, 'calls', null, 45, 0, 'tree-sitter'),
      insertEdge(db, nodes.cycleC, nodes.cycleA, 'calls', null, 49, 0, 'tree-sitter'),
    ],
    highDegreeCalls: nodes.highDegreeTargets.map((target, index) => insertEdge(
      db,
      nodes.highDegreeHub,
      target,
      'calls',
      JSON.stringify({ fanout: index + 1 }),
      100 + index,
      index,
      'tree-sitter'
    )),
  };

  let closed = false;
  const snapshot = () => snapshotCypherGraph(db, {
    nodeId: nodes.entry,
    edgeId: edges.activeStaticCall,
  });
  const fixture: CypherRuntimeFixture = {
    projectRoot,
    dbPath,
    db,
    nodes,
    edges,
    initialSnapshot: snapshot(),
    snapshot,
    close: () => {
      if (closed) return;
      closed = true;
      db.close();
      fs.rmSync(projectRoot, { recursive: true, force: true });
    },
  };

  openFixtures.push(fixture);
  return fixture;
}

describe.skipIf(!nodeSqliteAvailable)('cypher runtime fixture helpers', () => {
  it('create a real SQLite graph fixture with the required SPEC-013 records', () => {
    const fixture = createCypherRuntimeFixture();

    expect(fs.existsSync(fixture.dbPath)).toBe(true);
    expect(fixture.dbPath).toContain(path.join('.codegraph', 'codegraph.db'));
    expect(fixture.initialSnapshot.schemaVersions).toEqual([1]);
    expect(fixture.initialSnapshot.nodeCount).toBe(23);
    expect(fixture.initialSnapshot.edgeCount).toBe(20);
    expect(fixture.initialSnapshot.activeEdgeCount).toBe(19);
    expect(fixture.initialSnapshot.inactiveLspSuppressedEdgeCount).toBe(1);
    expect(fixture.initialSnapshot.representativeNode).toMatchObject({
      id: 'fn:entry',
      kind: 'function',
      name: 'entry',
      qualified_name: 'src/main.entry',
    });
    expect(fixture.initialSnapshot.representativeEdge).toMatchObject({
      source: 'fn:entry',
      target: 'fn:helper',
      kind: 'calls',
      provenance: 'tree-sitter',
    });

    const activeProvenances = fixture.db.prepare(`
      SELECT provenance, count(*) AS count
      FROM edges
      WHERE ${CYPHER_ACTIVE_EDGE_SQL}
      GROUP BY provenance
      ORDER BY provenance
    `).all() as Array<{ provenance: string | null; count: number }>;
    expect(activeProvenances).toEqual([
      { provenance: 'heuristic', count: 1 },
      { provenance: 'lsp', count: 1 },
      { provenance: 'tree-sitter', count: 17 },
    ]);

    const suppressed = edgeRecord(fixture.db, fixture.edges.inactiveLspSuppressedCall);
    expect(JSON.parse(suppressed.metadata ?? '{}')).toMatchObject({ lsp: { active: false } });

    const malformedNode = nodeRecord(fixture.db, fixture.nodes.malformedOpaque);
    expect(malformedNode.decorators).toBe('{bad decorators');
    expect(malformedNode.type_parameters).toBe('{"wrong":"shape"}');
    expect(edgeRecord(fixture.db, fixture.edges.malformedMetadataCall).metadata).toBe('broken json {{{');

    expect(fixture.edges.cycleCalls).toHaveLength(3);
    expect(fixture.edges.highDegreeCalls).toHaveLength(12);
    expect(fixture.nodes.highDegreeTargets).toHaveLength(12);
  });
});
