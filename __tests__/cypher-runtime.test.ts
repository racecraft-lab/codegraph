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

type CypherRuntimeBoundarySuccess = {
  readonly status: 'success';
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  readonly effectiveCap: number;
  readonly truncated: boolean;
};

type CypherRuntimeBoundaryDiagnostic = {
  readonly status: 'diagnostic';
  readonly code: string;
};

type CypherRuntimeBoundaryTimeout = {
  readonly status: 'timeout';
  readonly code: 'CYPHER_TIMEOUT';
  readonly deadlineMs: 5000;
  readonly guidance: string;
};

type CypherRuntimeBoundaryResult =
  | CypherRuntimeBoundarySuccess
  | CypherRuntimeBoundaryDiagnostic
  | CypherRuntimeBoundaryTimeout;

type CypherRuntimeBoundaryContract = {
  readonly executeCypherSqlForTests: (
    projectRoot: string,
    request: {
      readonly sql: string;
      readonly boundParameters?: readonly unknown[];
      readonly effectiveCap?: number;
    },
    options?: {
      readonly forceTimeout?: boolean;
      readonly onSqlPrepare?: (sql: string) => void;
    },
  ) => Promise<CypherRuntimeBoundaryResult>;
  readonly getCypherRuntimeStateForTests: () => {
    readonly activeWorkers: number;
    readonly terminatedWorkers: number;
  };
  readonly openCypherReadOnlyDatabaseForTests: (dbPath: string) => SqliteDatabase;
};

async function loadCypherRuntimeBoundaryContract(): Promise<CypherRuntimeBoundaryContract> {
  const runtimeMod = await import('../src/query/cypher/runtime') as Partial<CypherRuntimeBoundaryContract>;
  expect(typeof runtimeMod.executeCypherSqlForTests, 'executeCypherSqlForTests export').toBe('function');
  expect(typeof runtimeMod.getCypherRuntimeStateForTests, 'getCypherRuntimeStateForTests export').toBe('function');
  expect(typeof runtimeMod.openCypherReadOnlyDatabaseForTests, 'openCypherReadOnlyDatabaseForTests export').toBe('function');
  return runtimeMod as CypherRuntimeBoundaryContract;
}

function expectBoundarySuccess(result: CypherRuntimeBoundaryResult): CypherRuntimeBoundarySuccess {
  expect(result.status).toBe('success');
  return result as CypherRuntimeBoundarySuccess;
}

function expectBoundaryDiagnostic(result: CypherRuntimeBoundaryResult, code: string): CypherRuntimeBoundaryDiagnostic {
  expect(result.status).toBe('diagnostic');
  const diagnostic = result as CypherRuntimeBoundaryDiagnostic;
  expect(diagnostic.code).toBe(code);
  return diagnostic;
}

function expectBoundaryTimeout(result: CypherRuntimeBoundaryResult): CypherRuntimeBoundaryTimeout {
  expect(result.status).toBe('timeout');
  const timeout = result as CypherRuntimeBoundaryTimeout;
  expect(timeout.code).toBe('CYPHER_TIMEOUT');
  expect(timeout.deadlineMs).toBe(5000);
  expect(timeout.guidance).toContain('narrow');
  expect(result).not.toHaveProperty('rows');
  return timeout;
}

describe.skipIf(!nodeSqliteAvailable)('SPEC-013 Cypher runtime — T024 internal read-only worker boundary', () => {
  it('opens a dedicated SQLite read-only connection that cannot mutate graph storage', async () => {
    const runtime = await loadCypherRuntimeBoundaryContract();
    const fixture = createCypherRuntimeFixture();
    const before = fixture.snapshot();
    const readOnlyDb = runtime.openCypherReadOnlyDatabaseForTests(fixture.dbPath);

    try {
      expect(() => {
        readOnlyDb.prepare(`
          INSERT INTO nodes (
            id, kind, name, qualified_name, file_path, language,
            start_line, end_line, start_column, end_column, updated_at
          )
          VALUES ('forbidden', 'function', 'forbidden', 'forbidden', 'x.ts', 'typescript', 1, 1, 0, 1, 0)
        `).run();
      }).toThrow();
    } finally {
      readOnlyDb.close();
    }

    expect(fixture.snapshot()).toEqual(before);
  });

  it('executes validated SELECT SQL off-thread and rejects write SQL before prepare or repository initialization', async () => {
    const runtime = await loadCypherRuntimeBoundaryContract();
    const fixture = createCypherRuntimeFixture();
    const before = fixture.snapshot();
    const preparedSql: string[] = [];

    const result = expectBoundarySuccess(await runtime.executeCypherSqlForTests(
      fixture.projectRoot,
      { sql: 'SELECT count(*) AS count FROM nodes', effectiveCap: 1 },
      { onSqlPrepare: (sql) => preparedSql.push(sql) },
    ));

    expect(result.columns).toEqual(['count']);
    expect(result.rows).toEqual([{ count: 23 }]);
    expect(result.truncated).toBe(false);
    expect(preparedSql).toEqual(['SELECT count(*) AS count FROM nodes']);
    expect(fixture.snapshot()).toEqual(before);

    expectBoundaryDiagnostic(await runtime.executeCypherSqlForTests(
      fixture.projectRoot,
      { sql: "INSERT INTO nodes (id) VALUES ('forbidden')" },
      { onSqlPrepare: (sql) => preparedSql.push(sql) },
    ), 'CYPHER_UNSUPPORTED_CLAUSE');
    expect(preparedSql).toEqual(['SELECT count(*) AS count FROM nodes']);
    expect(fixture.snapshot()).toEqual(before);

    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cypher-runtime-boundary-missing-'));
    try {
      expectBoundaryDiagnostic(await runtime.executeCypherSqlForTests(
        projectRoot,
        { sql: 'SELECT 1 AS ok' },
      ), 'CYPHER_NOT_INDEXED');
      expect(fs.existsSync(path.join(projectRoot, '.codegraph'))).toBe(false);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns a shared timeout state, terminates the worker, and accepts a follow-up query without partial rows', async () => {
    const runtime = await loadCypherRuntimeBoundaryContract();
    const fixture = createCypherRuntimeFixture();
    const beforeState = runtime.getCypherRuntimeStateForTests();

    expectBoundaryTimeout(await runtime.executeCypherSqlForTests(
      fixture.projectRoot,
      { sql: 'SELECT 1 AS ok' },
      { forceTimeout: true },
    ));

    const afterTimeout = runtime.getCypherRuntimeStateForTests();
    expect(afterTimeout.activeWorkers).toBe(0);
    expect(afterTimeout.terminatedWorkers).toBe(beforeState.terminatedWorkers + 1);

    const followup = expectBoundarySuccess(await runtime.executeCypherSqlForTests(
      fixture.projectRoot,
      { sql: 'SELECT 1 AS ok', effectiveCap: 1 },
    ));
    expect(followup.rows).toEqual([{ ok: 1 }]);
    expect(runtime.getCypherRuntimeStateForTests().activeWorkers).toBe(0);
  }, 7000);
});

type CypherSerializerContract = {
  readonly serializeCypherResultForTests: (
    result: unknown,
    options?: { readonly payloadLimitBytes?: number },
  ) => string | CypherRuntimeBoundaryDiagnostic;
  readonly cypherRowsToTableForTests: (
    rows: readonly Record<string, unknown>[],
    columns: readonly string[],
  ) => readonly Record<string, string>[];
};

async function loadCypherSerializerContract(): Promise<CypherSerializerContract> {
  const serializerMod = await import('../src/query/cypher/serializer') as Partial<CypherSerializerContract>;
  expect(typeof serializerMod.serializeCypherResultForTests, 'serializeCypherResultForTests export').toBe('function');
  expect(typeof serializerMod.cypherRowsToTableForTests, 'cypherRowsToTableForTests export').toBe('function');
  return serializerMod as CypherSerializerContract;
}

describe('SPEC-013 Cypher serializer — T025 shared result serialization', () => {
  it('serializes minified canonical bytes with stable object keys, preserved arrays, and no trailing newline', async () => {
    const serializer = await loadCypherSerializerContract();
    const bytes = serializer.serializeCypherResultForTests({
      status: 'success',
      rows: [{
        z: { beta: 2, alpha: 1 },
        a: [{ b: 2, a: 1 }, 'x'],
      }],
      columns: [{ name: 'z' }, { name: 'a' }],
      truncated: false,
      effectiveCap: 100,
    });

    expect(typeof bytes).toBe('string');
    expect(bytes).toBe('{"columns":[{"name":"z"},{"name":"a"}],"effectiveCap":100,"rows":[{"a":[{"a":1,"b":2},"x"],"z":{"alpha":1,"beta":2}}],"status":"success","truncated":false}');
    expect(bytes).not.toContain('\n');
    expect(Buffer.byteLength(bytes as string, 'utf8')).toBe((bytes as string).length);
  });

  it('returns CYPHER_OUTPUT_TOO_LARGE without partial rows when the canonical payload exceeds the ceiling', async () => {
    const serializer = await loadCypherSerializerContract();
    const result = serializer.serializeCypherResultForTests({
      status: 'success',
      columns: [{ name: 'value' }],
      rows: [{ value: '0123456789'.repeat(20) }],
      effectiveCap: 100,
      truncated: false,
    }, { payloadLimitBytes: 80 });

    expectBoundaryDiagnostic(result as CypherRuntimeBoundaryResult, 'CYPHER_OUTPUT_TOO_LARGE');
    expect(JSON.stringify(result)).not.toContain('0123456789');
    expect(result).not.toHaveProperty('rows');
  });

  it('adapts bounded result rows into deterministic human table rows', async () => {
    const serializer = await loadCypherSerializerContract();
    const tableRows = serializer.cypherRowsToTableForTests([
      {
        name: { type: 'scalar', value: 'entry' },
        node: { type: 'node', value: { id: 'fn:entry', name: 'entry', kind: 'function' } },
        path: { type: 'path', value: { length: 2 } },
        nullable: { type: 'scalar', value: null },
      },
    ], ['name', 'node', 'path', 'nullable']);

    expect(tableRows).toEqual([{
      name: 'entry',
      node: 'function fn:entry',
      path: 'path length 2',
      nullable: '',
    }]);
  });
});

type CypherColumn = {
  readonly name: string;
};

type PublicNode = Record<string, unknown> & {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
};

type PublicRelationship = Record<string, unknown> & {
  readonly source: string;
  readonly target: string;
  readonly kind: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly provenance: string | null;
};

type CypherPath = {
  readonly nodes: readonly PublicNode[];
  readonly relationships: readonly PublicRelationship[];
  readonly length: number;
};

type CypherValue =
  | { readonly type: 'node'; readonly value: PublicNode }
  | { readonly type: 'relationship'; readonly value: PublicRelationship }
  | { readonly type: 'path'; readonly value: CypherPath }
  | { readonly type: 'scalar'; readonly value: null | boolean | number | string | Record<string, unknown> | unknown[] };

type CypherRow = Record<string, CypherValue>;

type CypherSuccessResult = {
  readonly status: 'success';
  readonly columns: readonly CypherColumn[];
  readonly rows: readonly CypherRow[];
  readonly effectiveCap: number;
  readonly truncated: boolean;
};

type CypherDiagnosticResult = {
  readonly status: 'diagnostic';
  readonly code: string;
  readonly message: string;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  readonly expected: string;
  readonly anchor: string;
  readonly excerpt: string;
  readonly truncatedBefore: boolean;
  readonly truncatedAfter: boolean;
};

type CypherTimeoutResult = {
  readonly status: 'timeout';
  readonly code: 'CYPHER_TIMEOUT';
  readonly deadlineMs: 5000;
  readonly guidance: string;
};

type CypherQueryResult = CypherSuccessResult | CypherDiagnosticResult | CypherTimeoutResult;

type CypherRuntimeTestOptions = {
  readonly forceTimeout?: boolean;
  readonly payloadLimitBytes?: number;
  readonly onSqlPrepare?: (sql: string) => void;
  readonly onRowsInspected?: (count: number) => void;
  readonly onRowsMaterialized?: (count: number) => void;
};

type CypherRuntimeTestState = {
  readonly activeWorkers: number;
  readonly terminatedWorkers: number;
};

type CypherRuntimeContract = {
  readonly queryCypher: (projectRoot: string, query: string) => Promise<CypherQueryResult>;
  readonly queryCypherForTests: (
    projectRoot: string,
    query: string,
    options?: CypherRuntimeTestOptions,
  ) => Promise<CypherQueryResult>;
  readonly getCypherRuntimeStateForTests: () => CypherRuntimeTestState;
};

async function loadCypherRuntimeContract(): Promise<CypherRuntimeContract> {
  let publicMod: unknown;
  let cypherMod: unknown;
  try {
    publicMod = await import('../src');
    cypherMod = await import('../src/query/cypher/index');
  } catch (error) {
    throw new Error(
      'SPEC-013 Cypher runtime production contract missing: expected ' +
        '`src/index.ts` to export public `queryCypher(projectRoot, query)` and ' +
        '`src/query/cypher/index.ts` to export internal test seams ' +
        '`queryCypherForTests(projectRoot, query, options)` and ' +
        '`getCypherRuntimeStateForTests()`. ' +
        `Original load failure: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const publicContract = publicMod as Partial<CypherRuntimeContract>;
  const internalContract = cypherMod as Partial<CypherRuntimeContract>;
  expect(typeof publicContract.queryCypher, 'queryCypher public export').toBe('function');
  expect(typeof internalContract.queryCypherForTests, 'queryCypherForTests export').toBe('function');
  expect(typeof internalContract.getCypherRuntimeStateForTests, 'getCypherRuntimeStateForTests export').toBe('function');

  return {
    queryCypher: publicContract.queryCypher as CypherRuntimeContract['queryCypher'],
    queryCypherForTests: internalContract.queryCypherForTests as CypherRuntimeContract['queryCypherForTests'],
    getCypherRuntimeStateForTests: internalContract.getCypherRuntimeStateForTests as CypherRuntimeContract['getCypherRuntimeStateForTests'],
  };
}

function expectSuccess(result: CypherQueryResult): CypherSuccessResult {
  expect(result.status).toBe('success');
  return result as CypherSuccessResult;
}

function expectDiagnostic(result: CypherQueryResult, code: string): CypherDiagnosticResult {
  expect(result.status).toBe('diagnostic');
  const diagnostic = result as CypherDiagnosticResult;
  expect(diagnostic.code).toBe(code);
  expect(typeof diagnostic.offset).toBe('number');
  expect(typeof diagnostic.line).toBe('number');
  expect(typeof diagnostic.column).toBe('number');
  expect(diagnostic.expected.length).toBeGreaterThan(0);
  expect(diagnostic.anchor.length).toBeGreaterThan(0);
  expect(diagnostic.excerpt.length).toBeLessThanOrEqual(160);
  expect(typeof diagnostic.truncatedBefore).toBe('boolean');
  expect(typeof diagnostic.truncatedAfter).toBe('boolean');
  return diagnostic;
}

function expectTimeout(result: CypherQueryResult): CypherTimeoutResult {
  expect(result.status).toBe('timeout');
  const timeout = result as CypherTimeoutResult;
  expect(timeout.code).toBe('CYPHER_TIMEOUT');
  expect(timeout.deadlineMs).toBe(5000);
  expect(timeout.guidance).toContain('narrow');
  expect(result).not.toHaveProperty('rows');
  return timeout;
}

function diagnosticJson(diagnostic: CypherDiagnosticResult): string {
  return JSON.stringify(diagnostic);
}

function expectNoDiagnosticLeak(
  diagnostic: CypherDiagnosticResult,
  options: {
    readonly fullQuery: string;
    readonly forbiddenFragments?: readonly string[];
  },
): void {
  const serialized = diagnosticJson(diagnostic);
  expect(serialized).not.toContain(options.fullQuery);
  expect(diagnostic).not.toHaveProperty('sql');
  expect(diagnostic).not.toHaveProperty('boundParameters');
  expect(diagnostic).not.toHaveProperty('parameters');
  expect(serialized).not.toMatch(/\b(SELECT|WITH RECURSIVE)\b/i);
  expect(serialized).not.toMatch(/\b[ne][0-9]\./);
  for (const fragment of options.forbiddenFragments ?? []) {
    expect(serialized).not.toContain(fragment);
  }
}

function rowValue(row: CypherRow, column: string): CypherValue {
  expect(row).toHaveProperty(column);
  return row[column];
}

function scalarValue(row: CypherRow, column: string): CypherValue['value'] {
  const value = rowValue(row, column);
  expect(value.type).toBe('scalar');
  return (value as Extract<CypherValue, { type: 'scalar' }>).value;
}

function nodeValue(row: CypherRow, column: string): PublicNode {
  const value = rowValue(row, column);
  expect(value.type).toBe('node');
  return (value as Extract<CypherValue, { type: 'node' }>).value;
}

function relationshipValue(row: CypherRow, column: string): PublicRelationship {
  const value = rowValue(row, column);
  expect(value.type).toBe('relationship');
  return (value as Extract<CypherValue, { type: 'relationship' }>).value;
}

function pathValue(row: CypherRow, column: string): CypherPath {
  const value = rowValue(row, column);
  expect(value.type).toBe('path');
  return (value as Extract<CypherValue, { type: 'path' }>).value;
}

function addFanout(fixture: CypherRuntimeFixture, prefix: string, count: number): {
  readonly hubId: string;
  readonly targetIds: readonly string[];
} {
  const updatedAt = 1700000000000;
  const hubId = insertNode(fixture.db, {
    id: `fn:${prefix}:hub`,
    name: `${prefix}Hub`,
    qualifiedName: `src/main.${prefix}Hub`,
    startLine: 200,
  }, updatedAt);
  const targetIds = Array.from({ length: count }, (_, index) => {
    const ordinal = String(index + 1).padStart(4, '0');
    const targetId = insertNode(fixture.db, {
      id: `fn:${prefix}:target${ordinal}`,
      name: `${prefix}Target${ordinal}`,
      qualifiedName: `src/main.${prefix}Target${ordinal}`,
      startLine: 201 + index,
    }, updatedAt);
    insertEdge(
      fixture.db,
      hubId,
      targetId,
      'calls',
      JSON.stringify({ fanout: index + 1 }),
      300 + index,
      index,
      'tree-sitter',
    );
    return targetId;
  });

  return { hubId, targetIds };
}

function addLayeredVariablePathDensity(fixture: CypherRuntimeFixture, prefix: string, layerSize: number): void {
  const updatedAt = 1700000000000;
  const layers = Array.from({ length: 4 }, (_, layerIndex) => {
    return Array.from({ length: layerSize }, (_, nodeIndex) => {
      const ordinal = String(nodeIndex + 1).padStart(2, '0');
      return insertNode(fixture.db, {
        id: `fn:${prefix}:l${layerIndex}:${ordinal}`,
        name: `${prefix}L${layerIndex}${ordinal}`,
        qualifiedName: `src/main.${prefix}L${layerIndex}${ordinal}`,
        startLine: 500 + layerIndex * 100 + nodeIndex,
      }, updatedAt);
    });
  });

  for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
    for (const source of layers[layerIndex] ?? []) {
      for (const target of layers[layerIndex + 1] ?? []) {
        insertEdge(fixture.db, source, target, 'calls', null, 600 + layerIndex, 0, 'tree-sitter');
      }
    }
  }
}

function addVariablePathStartNoise(fixture: CypherRuntimeFixture, prefix: string, count: number): void {
  const updatedAt = 1700000000000;
  fixture.db.exec('BEGIN');
  try {
    for (let index = 0; index < count; index += 1) {
      const ordinal = String(index + 1).padStart(4, '0');
      const sourceId = insertNode(fixture.db, {
        id: `fn:${prefix}:noise:${ordinal}`,
        name: `${prefix}Noise${ordinal}`,
        qualifiedName: `src/main.${prefix}Noise${ordinal}`,
        startLine: 900 + index,
      }, updatedAt);

      if (index % 2 === 0) {
        insertEdge(
          fixture.db,
          sourceId,
          fixture.nodes.fileMain,
          'imports',
          null,
          950 + index,
          0,
          'tree-sitter',
        );
      }
    }
    fixture.db.exec('COMMIT');
  } catch (error) {
    fixture.db.exec('ROLLBACK');
    throw error;
  }
}

describe.skipIf(!nodeSqliteAvailable)('SPEC-013 Cypher runtime — public API and graph mapping', () => {
  it('exports queryCypher and maps active fixed traversals to public nodes and relationships', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const result = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      "MATCH (entry:function)-[call:calls]->(target:function) WHERE entry.name = 'entry' RETURN entry, call, target ORDER BY target.name",
    ));

    expect(result.columns.map((column) => column.name)).toEqual(['entry', 'call', 'target']);
    expect(result.effectiveCap).toBe(100);
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => nodeValue(row, 'target').name)).toEqual(['helper', 'heuristicTarget', 'lspTarget']);
    expect(result.rows.map((row) => nodeValue(row, 'target').name)).not.toContain('staleLspTarget');

    const entry = nodeValue(result.rows[0], 'entry');
    expect(entry).toMatchObject({
      id: fixture.nodes.entry,
      kind: 'function',
      name: 'entry',
      qualifiedName: 'src/main.entry',
      filePath: 'src/main.ts',
      startLine: 3,
      startColumn: 0,
      isExported: true,
      returnType: 'void',
    });
    expect(entry).not.toHaveProperty('updatedAt');
    expect(entry).not.toHaveProperty('qualified_name');

    const call = relationshipValue(result.rows[0], 'call');
    expect(call).toMatchObject({
      source: fixture.nodes.entry,
      target: fixture.nodes.helper,
      kind: 'calls',
      line: 5,
      column: 2,
      provenance: 'tree-sitter',
      metadata: { resolvedBy: 'static' },
    });
    expect(call).not.toHaveProperty('col');
  });

  it('returns bounded relationship-simple variable paths with recurring nodes in ordered typed path values', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const result = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      "MATCH p = (start:function)-[:calls*1..8]->(finish:function) WHERE start.name = 'cycleA' AND finish.name = 'cycleA' RETURN p",
    ));

    expect(result.rows).toHaveLength(1);
    const pathResult = pathValue(result.rows[0], 'p');
    expect(pathResult.length).toBe(3);
    expect(pathResult.nodes.map((node) => node.id)).toEqual([
      fixture.nodes.cycleA,
      fixture.nodes.cycleB,
      fixture.nodes.cycleC,
      fixture.nodes.cycleA,
    ]);
    expect(pathResult.relationships.map((relationship) => [
      relationship.source,
      relationship.target,
      relationship.kind,
      relationship.line,
      relationship.column,
    ])).toEqual([
      [fixture.nodes.cycleA, fixture.nodes.cycleB, 'calls', 41, 0],
      [fixture.nodes.cycleB, fixture.nodes.cycleC, 'calls', 45, 0],
      [fixture.nodes.cycleC, fixture.nodes.cycleA, 'calls', 49, 0],
    ]);

    const relationshipIdentities = pathResult.relationships.map((relationship) => [
      relationship.source,
      relationship.target,
      relationship.kind,
      relationship.line,
      relationship.column,
    ].join('|'));
    expect(new Set(relationshipIdentities).size).toBe(pathResult.relationships.length);
  });

  it('bounds broad variable-path materialization before applying the public LIMIT', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    addVariablePathStartNoise(fixture, 'early', 128);
    addLayeredVariablePathDensity(fixture, 'dense', 14);

    const materializedRows: number[] = [];
    const preparedSql: string[] = [];
    const result = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      'MATCH p = (a:function)-[:calls*1..1]->(b:function) RETURN p LIMIT 5',
      {
        onRowsMaterialized: (count) => materializedRows.push(count),
        onSqlPrepare: (sql) => preparedSql.push(sql),
      },
    ));

    expect(result.effectiveCap).toBe(5);
    expect(result.rows).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(materializedRows).toEqual([1, 2, 3, 4, 5, 6]);
    for (const row of result.rows) {
      const path = pathValue(row, 'p');
      expect(path.length).toBe(1);
    }
    const recursiveSql = preparedSql.find((sql) => /^WITH RECURSIVE\b/i.test(sql));
    expect(recursiveSql).toBeDefined();
    expect(recursiveSql).toContain('SELECT 1, n0.id, e0.target');
    expect(recursiveSql).toContain('JOIN edges e0 INDEXED BY idx_edges_source_kind ON e0.source = n0.id');
    expect(recursiveSql).not.toContain('SELECT 0, n0.id, n0.id');
    expect(recursiveSql).toContain('WHERE cg_path_0.depth BETWEEN ? AND ?');
    expect(recursiveSql).toContain('__cg_visited_edge_ids');
    expect(preparedSql.some((sql) => /FROM nodes WHERE id IN \(/.test(sql))).toBe(true);
    expect(preparedSql.some((sql) => /FROM edges WHERE id IN \(/.test(sql))).toBe(true);
    expect(preparedSql.some((sql) => /FROM nodes\s+ORDER BY id/.test(sql))).toBe(false);
    expect(preparedSql.some((sql) => /FROM edges\s+ORDER BY source, target, kind, line, col, id/.test(sql))).toBe(false);
  });

  it('applies top-level property filters, null checks, boolean operators, and comparisons with Cypher null semantics', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const result = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (entry:function)-[:calls]->(target:function)',
        "WHERE entry.name = 'entry'",
        'AND (target.signature IS NULL OR target.startLine >= 20)',
        'AND NOT target.endLine = 18',
        "AND target.name <> 'staleLspTarget'",
        'RETURN target.name AS name, target.signature AS signature, target.startLine AS line',
        'ORDER BY target.name',
      ].join(' '),
    ));

    expect(result.rows.map((row) => scalarValue(row, 'name'))).toEqual(['heuristicTarget', 'lspTarget']);
    expect(result.rows.map((row) => scalarValue(row, 'signature'))).toEqual([null, null]);
    expect(result.rows.map((row) => scalarValue(row, 'line'))).toEqual([26, 20]);
  });

  it('returns opaque JSON fields only as valid public shapes and rejects opaque WHERE predicates', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const activeOpaque = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      "MATCH (entry:function)-[call:calls]->(target:function) WHERE entry.name = 'entry' RETURN entry.decorators AS decorators, entry.typeParameters AS typeParameters, call.metadata AS metadata ORDER BY target.name LIMIT 1",
    ));
    expect(scalarValue(activeOpaque.rows[0], 'decorators')).toEqual(['@trace']);
    expect(scalarValue(activeOpaque.rows[0], 'typeParameters')).toEqual(['T']);
    expect(scalarValue(activeOpaque.rows[0], 'metadata')).toEqual({ resolvedBy: 'static' });

    const malformedOpaque = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      "MATCH (helper:function)-[call:calls]->(target:function) WHERE helper.name = 'helper' RETURN target.decorators AS decorators, target.typeParameters AS typeParameters, call.metadata AS metadata",
    ));
    expect(scalarValue(malformedOpaque.rows[0], 'decorators')).toBeNull();
    expect(scalarValue(malformedOpaque.rows[0], 'typeParameters')).toBeNull();
    expect(scalarValue(malformedOpaque.rows[0], 'metadata')).toBeNull();
    expect(JSON.stringify(malformedOpaque.rows)).not.toContain('broken json');
    expect(JSON.stringify(malformedOpaque.rows)).not.toContain('{bad decorators');
    expect(JSON.stringify(malformedOpaque.rows)).not.toContain('"wrong":"shape"');

    expectDiagnostic(
      await runtime.queryCypher(
        fixture.projectRoot,
        'MATCH (entry:function)-[:calls]->(target:function) WHERE entry.decorators IS NOT NULL RETURN target.name',
      ),
      'CYPHER_UNSUPPORTED_OPAQUE_FILTER',
    );
  });

  it('uses deterministic stable ordering by projected values and honors explicit ORDER BY null placement', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const defaultOrdered = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      "MATCH (hub:function)-[:calls]->(target:function) WHERE hub.name = 'hub' RETURN target.name AS name LIMIT 5",
    ));
    expect(defaultOrdered.rows.map((row) => scalarValue(row, 'name'))).toEqual([
      'target01',
      'target02',
      'target03',
      'target04',
      'target05',
    ]);

    const explicitDescending = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      "MATCH (hub:function)-[:calls]->(target:function) WHERE hub.name = 'hub' RETURN target.name AS name ORDER BY target.name DESC LIMIT 3",
    ));
    expect(explicitDescending.rows.map((row) => scalarValue(row, 'name'))).toEqual([
      'target12',
      'target11',
      'target10',
    ]);

    const nullsAfter = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      "MATCH (entry:function)-[:calls]->(target:function) WHERE entry.name = 'entry' RETURN target.signature AS signature, target.name AS name ORDER BY target.signature ASC, target.name ASC",
    ));
    expect(nullsAfter.rows.map((row) => scalarValue(row, 'name'))).toEqual(['helper', 'heuristicTarget', 'lspTarget']);

    const nullsBefore = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      "MATCH (entry:function)-[:calls]->(target:function) WHERE entry.name = 'entry' RETURN target.signature AS signature, target.name AS name ORDER BY target.signature DESC, target.name ASC",
    ));
    expect(nullsBefore.rows.map((row) => scalarValue(row, 'name'))).toEqual(['heuristicTarget', 'lspTarget', 'helper']);
  });
});

describe.skipIf(!nodeSqliteAvailable)('SPEC-013 Cypher runtime — caps, diagnostics, and execution safety', () => {
  it('applies LIMIT, default cap, hard cap, truncation, effectiveCap, and effectiveCap plus one inspection', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    addFanout(fixture, 'cap', 1005);

    const defaultCapped = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      "MATCH (hub:function)-[:calls]->(target:function) WHERE hub.name = 'capHub' RETURN target.name AS name",
    ));
    expect(defaultCapped.effectiveCap).toBe(100);
    expect(defaultCapped.rows).toHaveLength(100);
    expect(defaultCapped.truncated).toBe(true);
    expect(defaultCapped).not.toHaveProperty('totalRows');

    const inspectedRows: number[] = [];
    const limited = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      "MATCH (hub:function)-[:calls]->(target:function) WHERE hub.name = 'capHub' RETURN target.name AS name ORDER BY target.name LIMIT 5",
      { onRowsInspected: (count) => inspectedRows.push(count) },
    ));
    expect(limited.effectiveCap).toBe(5);
    expect(limited.rows).toHaveLength(5);
    expect(limited.truncated).toBe(true);
    expect(Math.max(...inspectedRows)).toBeLessThanOrEqual(6);

    const hardCapped = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      "MATCH (hub:function)-[:calls]->(target:function) WHERE hub.name = 'capHub' RETURN target.name AS name ORDER BY target.name LIMIT 1500",
    ));
    expect(hardCapped.effectiveCap).toBe(1000);
    expect(hardCapped.rows).toHaveLength(1000);
    expect(hardCapped.truncated).toBe(true);
  });

  it('returns output-too-large diagnostic without partial rows when canonical JSON exceeds the payload ceiling', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const result = await runtime.queryCypherForTests(
      fixture.projectRoot,
      "MATCH (entry:function)-[call:calls]->(target:function) WHERE entry.name = 'entry' RETURN entry, call, target ORDER BY target.name",
      { payloadLimitBytes: 512 },
    );

    const diagnostic = expectDiagnostic(result, 'CYPHER_OUTPUT_TOO_LARGE');
    expect(diagnostic.message).toContain('narrow');
    expect(result).not.toHaveProperty('rows');
  });

  it('redacts full query text, string literals, emitted SQL, and bound parameters from semantic diagnostics', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const secretLiteral = `top-secret-${'value'.repeat(80)}`;
    const query = [
      'MATCH (entry:function)-[:calls]->(target:function)',
      `WHERE entry.decorators = '${secretLiteral}'`,
      'RETURN target.name',
    ].join(' ');
    const preparedSql: string[] = [];

    const diagnostic = expectDiagnostic(
      await runtime.queryCypherForTests(fixture.projectRoot, query, {
        onSqlPrepare: (sql) => preparedSql.push(sql),
      }),
      'CYPHER_UNSUPPORTED_OPAQUE_FILTER',
    );

    expect(preparedSql).toEqual([]);
    expectNoDiagnosticLeak(diagnostic, {
      fullQuery: query,
      forbiddenFragments: [secretLiteral, 'top-secret', 'valuevaluevalue'],
    });
  });

  it('returns oversized-input diagnostics without echoing oversized query text or string literal content', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const oversizedSecret = `oversized-secret-${'sensitive'.repeat(1_400)}`;
    const query = `MATCH (entry:function)-[:calls]->(target:function) WHERE entry.name = '${oversizedSecret}' RETURN target.name`;

    const diagnostic = expectDiagnostic(
      await runtime.queryCypher(fixture.projectRoot, query),
      'CYPHER_INPUT_TOO_LONG',
    );

    expect(diagnostic.excerpt).toBe('');
    expectNoDiagnosticLeak(diagnostic, {
      fullQuery: query,
      forbiddenFragments: [oversizedSecret, 'oversized-secret', 'sensitivesensitive'],
    });
  });

  it('caps escaped excerpts at 160 UTF-16 code units after escaping control characters', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const query = `MATCH (entry:function)-[:calls]->(target:function) RETURN ${'\t'.repeat(120)}@`;

    const diagnostic = expectDiagnostic(
      await runtime.queryCypher(fixture.projectRoot, query),
      'CYPHER_SYNTAX',
    );

    expect(diagnostic.excerpt).not.toContain('\t');
    expect(diagnostic.excerpt).toContain('\\t');
    expect(diagnostic.excerpt.length).toBeLessThanOrEqual(160);
  });

  it('keeps Unicode and multiline diagnostics line-local across astral, combining, CRLF, and LF spans', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const unicodeLiteral = `astral-\u{1f4a9}-combining-e\u0301-secret`;
    const query = [
      'MATCH (entry:function)-[:calls]->(target:function)\r\n',
      `WHERE entry.name = '${unicodeLiteral}'\n`,
      'RETURN target.unknownProperty',
    ].join('');

    const diagnostic = expectDiagnostic(
      await runtime.queryCypher(fixture.projectRoot, query),
      'CYPHER_UNKNOWN_PROPERTY',
    );

    expect(diagnostic.line).toBe(3);
    expect(diagnostic.column).toBe('RETURN target.'.length);
    expect(diagnostic.excerpt).toBe('RETURN target.unknownProperty');
    expect(diagnostic.excerpt).not.toContain('\r');
    expect(diagnostic.excerpt).not.toContain('\n');
    expectNoDiagnosticLeak(diagnostic, {
      fullQuery: query,
      forbiddenFragments: [unicodeLiteral, 'astral-', 'combining'],
    });
  });

  it('rejects mutating and direct-SQL input before SQLite prepare and leaves the database unchanged', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const before = fixture.snapshot();
    const preparedSql: string[] = [];

    expectDiagnostic(
      await runtime.queryCypherForTests(
        fixture.projectRoot,
        'MATCH (n:function)-[:calls]->(m:function) DELETE m RETURN n',
        { onSqlPrepare: (sql) => preparedSql.push(sql) },
      ),
      'CYPHER_UNSUPPORTED_CLAUSE',
    );
    expectDiagnostic(
      await runtime.queryCypherForTests(
        fixture.projectRoot,
        'PRAGMA database_list',
        { onSqlPrepare: (sql) => preparedSql.push(sql) },
      ),
      'CYPHER_DIRECT_SQL_UNSUPPORTED',
    );

    expect(preparedSql).toEqual([]);
    expect(fixture.snapshot()).toEqual(before);
  });

  it('returns a stable not-indexed diagnostic without initializing or healing repository state', async () => {
    const runtime = await loadCypherRuntimeContract();
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cypher-not-indexed-'));

    try {
      const result = await runtime.queryCypher(
        projectRoot,
        'MATCH (n:function)-[:calls]->(m:function) RETURN n.name',
      );
      expectDiagnostic(result, 'CYPHER_NOT_INDEXED');
      expect(fs.existsSync(path.join(projectRoot, '.codegraph'))).toBe(false);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns timeout state with no partial rows and cleans terminated workers before reuse', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const beforeState = runtime.getCypherRuntimeStateForTests();

    expectTimeout(await runtime.queryCypherForTests(
      fixture.projectRoot,
      "MATCH p = (hub:function)-[:calls*1..8]->(target:function) WHERE hub.name = 'hub' RETURN p",
      { forceTimeout: true },
    ));

    const afterState = runtime.getCypherRuntimeStateForTests();
    expect(afterState.activeWorkers).toBe(0);
    expect(afterState.terminatedWorkers).toBe(beforeState.terminatedWorkers + 1);

    const followup = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      "MATCH (entry:function)-[:calls]->(target:function) WHERE entry.name = 'entry' RETURN target.name AS name ORDER BY target.name LIMIT 1",
    ));
    expect(followup.rows.map((row) => scalarValue(row, 'name'))).toEqual(['helper']);
  });
});
