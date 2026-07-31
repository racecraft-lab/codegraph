import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CypherNode as ExportedCypherNode } from '../src';

/**
 * Force the runtime deadline to expire. The shipped code no longer sniffs query
 * text for a test marker; the enforced deadline is read from the environment,
 * so a test shortens it for the duration of one call instead.
 */
async function withExpiredCypherDeadline<T>(run: () => Promise<T>): Promise<T> {
  return withCypherDeadlineMs(0, run);
}

/**
 * Run with a specific enforced Cypher deadline.
 *
 * Correctness assertions should not be decided by how fast the host is. The two
 * ranged-aggregate probes below walk ~48,000 reachable nodes and take ~2.3s on a
 * developer machine, which is comfortably inside the 5s production deadline but
 * not inside it on a loaded CI runner sharing a box with the rest of the suite —
 * a macOS runner timed one out. Raising the budget for those cases keeps them
 * testing what they are named for (that ranged aggregates are not pruned before
 * grouping and ordering) rather than doubling as a wall-clock benchmark. The
 * production deadline itself stays covered by the T061 timeout probes.
 */
async function withCypherDeadlineMs<T>(deadlineMs: number, run: () => Promise<T>): Promise<T> {
  const previous = process.env.CODEGRAPH_CYPHER_DEADLINE_MS;
  process.env.CODEGRAPH_CYPHER_DEADLINE_MS = String(deadlineMs);
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.CODEGRAPH_CYPHER_DEADLINE_MS;
    } else {
      process.env.CODEGRAPH_CYPHER_DEADLINE_MS = previous;
    }
  }
}

/** Headroom for host-speed-sensitive correctness probes; not a product value. */
const CYPHER_SLOW_HOST_DEADLINE_MS = 60_000;

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
    boolToStorage(input.isExported === undefined ? false : input.isExported),
    boolToStorage(input.isAsync === undefined ? false : input.isAsync),
    boolToStorage(input.isStatic === undefined ? false : input.isStatic),
    boolToStorage(input.isAbstract === undefined ? false : input.isAbstract),
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

    expectBoundaryTimeout(await withExpiredCypherDeadline(() => runtime.executeCypherSqlForTests(
      fixture.projectRoot,
      { sql: 'SELECT 1 AS ok' },
    )));

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

  /**
   * An exhausted deadline must settle as a timeout every time, not most of the
   * time. Node clamps `setTimeout(fn, 0)` up to 1ms rather than firing it
   * immediately, so a zero deadline that raced a dispatched statement against a
   * timer was decided by host speed: a pooled worker holding an already-open
   * database can answer inside that window, and CI observed exactly that,
   * returning `success` where a timeout was required. Repeat against a warm pool
   * — the condition that makes the race winnable — and require every outcome.
   */
  it('settles an exhausted deadline as a timeout on every attempt, never racing the worker', async () => {
    const runtime = await loadCypherRuntimeBoundaryContract();
    const fixture = createCypherRuntimeFixture();

    // Warm the pool first: a cold worker pays a boot the old timer always won.
    expectBoundarySuccess(await runtime.executeCypherSqlForTests(
      fixture.projectRoot,
      { sql: 'SELECT 1 AS ok', effectiveCap: 1 },
    ));

    const statuses = await withExpiredCypherDeadline(async () => {
      const seen: string[] = [];
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const result = await runtime.executeCypherSqlForTests(
          fixture.projectRoot,
          { sql: 'SELECT 1 AS ok', effectiveCap: 1 },
        );
        seen.push(result.status);
      }
      return seen;
    });

    expect(new Set(statuses)).toEqual(new Set(['timeout']));
    expect(runtime.getCypherRuntimeStateForTests().activeWorkers).toBe(0);

    // The pool still works afterwards.
    const followup = expectBoundarySuccess(await runtime.executeCypherSqlForTests(
      fixture.projectRoot,
      { sql: 'SELECT 1 AS ok', effectiveCap: 1 },
    ));
    expect(followup.rows).toEqual([{ ok: 1 }]);
  }, 20000);
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
    expect(result).toMatchObject({
      message: 'Cypher result exceeds the 80-byte machine-output payload ceiling; narrow RETURN, MATCH, or LIMIT.',
      expected: 'serialized payload <= 80 bytes',
    });
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
  readonly isExported?: boolean | null;
  readonly isAsync?: boolean | null;
  readonly isStatic?: boolean | null;
  readonly isAbstract?: boolean | null;
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
  readonly payloadLimitBytes?: number;
  readonly onSqlPrepare?: (sql: string) => void;
  readonly onQueryPlan?: (evidence: CypherPerformancePlanEvidence) => void;
  readonly onRowsInspected?: (count: number) => void;
  readonly onRowsMaterialized?: (count: number) => void;
};

type CypherPerformancePlanEvidence = {
  readonly probeId: string;
  readonly query: string;
  readonly details: readonly string[];
  readonly edgeIndexes: readonly string[];
  readonly tempWork: readonly string[];
  readonly boundedBy: string;
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

async function queryResultOrUnhandledDiagnostic(result: Promise<CypherQueryResult>): Promise<CypherQueryResult> {
  try {
    return await result;
  } catch (error) {
    return {
      status: 'diagnostic',
      code: 'CYPHER_UNHANDLED_EXCEPTION',
      message: error instanceof Error ? error.message : String(error),
      offset: 0,
      line: 1,
      column: 0,
      expected: 'runtime result',
      anchor: 'queryCypher',
      excerpt: '',
      truncatedBefore: false,
      truncatedAfter: false,
    };
  }
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
  it('preserves nullable storage booleans in scalar and public node results', async () => {
    expectTypeOf<ExportedCypherNode['isExported']>().toEqualTypeOf<boolean | null>();
    expectTypeOf<ExportedCypherNode['isAsync']>().toEqualTypeOf<boolean | null>();
    expectTypeOf<ExportedCypherNode['isStatic']>().toEqualTypeOf<boolean | null>();
    expectTypeOf<ExportedCypherNode['isAbstract']>().toEqualTypeOf<boolean | null>();

    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const nullableId = insertNode(fixture.db, {
      id: 'fn:nullableFlags',
      name: 'nullableFlags',
      isExported: null,
      isAsync: null,
      isStatic: null,
      isAbstract: null,
    }, 1700000000000);
    insertEdge(
      fixture.db,
      fixture.nodes.entry,
      nullableId,
      'calls',
      null,
      200,
      0,
      'tree-sitter',
    );

    const result = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (entry:function)-[:calls]->(target:function)',
        "WHERE entry.name = 'entry' AND target.name = 'nullableFlags'",
        'RETURN target, target.isExported AS isExported, target.isAsync AS isAsync,',
        'target.isStatic AS isStatic, target.isAbstract AS isAbstract',
      ].join(' '),
    ));

    expect(result.rows).toHaveLength(1);
    expect(nodeValue(result.rows[0], 'target')).toMatchObject({
      isExported: null,
      isAsync: null,
      isStatic: null,
      isAbstract: null,
    });
    expect([
      scalarValue(result.rows[0], 'isExported'),
      scalarValue(result.rows[0], 'isAsync'),
      scalarValue(result.rows[0], 'isStatic'),
      scalarValue(result.rows[0], 'isAbstract'),
    ]).toEqual([null, null, null, null]);
  });

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

  it('executes accepted connected chains with fixed relationships before and after one bounded variable segment', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const fixedPrefix = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH p = (entry:function)-[:calls]->(middle:function)-[:calls*1..2]->(finish:function)',
        "WHERE entry.name = 'entry' AND middle.name = 'helper' AND finish.name = 'malformedOpaque'",
        'RETURN p, entry.name AS entryName, middle.name AS middleName, finish.name AS finishName',
      ].join(' '),
    ));
    expect(fixedPrefix.rows).toHaveLength(1);
    expect(pathValue(fixedPrefix.rows[0], 'p').nodes.map((node) => node.id)).toEqual([
      fixture.nodes.entry,
      fixture.nodes.helper,
      fixture.nodes.malformedOpaque,
    ]);

    const fixedSuffix = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH p = (entry:function)-[:calls*1..1]->(middle:function)-[:calls]->(finish:function)',
        "WHERE entry.name = 'entry' AND middle.name = 'helper' AND finish.name = 'malformedOpaque'",
        'RETURN p, entry.name AS entryName, middle.name AS middleName, finish.name AS finishName',
      ].join(' '),
    ));
    expect(fixedSuffix.rows).toHaveLength(1);
    expect(pathValue(fixedSuffix.rows[0], 'p').nodes.map((node) => node.id)).toEqual([
      fixture.nodes.entry,
      fixture.nodes.helper,
      fixture.nodes.malformedOpaque,
    ]);
  });

  it('returns ranged relationship variables as ordered scalar arrays for variable-only and mixed chains', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const variableOnly = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (start:function)-[edge:calls*1..2]->(finish:function)',
        "WHERE start.name = 'entry' AND finish.name = 'malformedOpaque'",
        'RETURN edge',
      ].join(' '),
    ));
    const variableRelationships = scalarValue(variableOnly.rows[0], 'edge');
    expect(Array.isArray(variableRelationships)).toBe(true);
    expect(variableRelationships).toEqual([
      expect.objectContaining({
        source: fixture.nodes.entry,
        target: fixture.nodes.helper,
        kind: 'calls',
      }),
      expect.objectContaining({
        source: fixture.nodes.helper,
        target: fixture.nodes.malformedOpaque,
        kind: 'calls',
      }),
    ]);
    expect(variableRelationships).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.anything() }),
    ]));

    const mixed = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (entry:function)-[:calls]->(middle:function)-[edge:calls*1..1]->(finish:function)',
        "WHERE entry.name = 'entry' AND middle.name = 'helper' AND finish.name = 'malformedOpaque'",
        'RETURN edge',
      ].join(' '),
    ));
    expect(scalarValue(mixed.rows[0], 'edge')).toEqual([
      expect.objectContaining({
        source: fixture.nodes.helper,
        target: fixture.nodes.malformedOpaque,
        kind: 'calls',
      }),
    ]);
  });

  it('executes representative fixed ordered queries as bounded SQL without whole-graph snapshots', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const preparedSql: string[] = [];
    const inspectedRows: number[] = [];

    const result = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      [
        'MATCH (entry:function)-[:calls]->(target:function)',
        "WHERE entry.name = 'entry'",
        'RETURN target.name AS name ORDER BY target.name LIMIT 2',
      ].join(' '),
      {
        onSqlPrepare: (sql) => preparedSql.push(sql),
        onRowsInspected: (count) => inspectedRows.push(count),
      },
    ));

    expect(result.rows.map((row) => scalarValue(row, 'name'))).toEqual([
      'helper',
      'heuristicTarget',
    ]);
    expect(Math.max(...inspectedRows)).toBeLessThanOrEqual(3);
    expect(preparedSql.some((sql) => /FROM nodes\s+ORDER BY id/.test(sql))).toBe(false);
    expect(preparedSql.some((sql) => /FROM edges\s+ORDER BY source, target, kind, line, col, id/.test(sql))).toBe(false);
    expect(preparedSql.some((sql) => /\bLIMIT \?/.test(sql))).toBe(true);
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

  it('applies public node, relationship, and path identity ordering before a default LIMIT', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const updatedAt = 1700000000000;
    const hubId = insertNode(fixture.db, {
      id: 'fn:default-order-hub',
      name: 'defaultOrderHub',
    }, updatedAt);
    const canonicalLastId = insertNode(fixture.db, {
      id: 'fn:zz-default-order',
      name: 'storedFirstCanonicalLast',
    }, updatedAt);
    const canonicalMiddleId = insertNode(fixture.db, {
      id: 'fn:mm-default-order',
      name: 'storedSecondCanonicalMiddle',
    }, updatedAt);
    const canonicalFirstId = insertNode(fixture.db, {
      id: 'fn:aa-default-order',
      name: 'storedThirdCanonicalFirst',
    }, updatedAt);
    insertEdge(fixture.db, hubId, canonicalLastId, 'calls', null, 401, 0, 'tree-sitter');
    insertEdge(fixture.db, hubId, canonicalMiddleId, 'calls', null, 402, 0, 'tree-sitter');
    insertEdge(fixture.db, hubId, canonicalFirstId, 'calls', null, 403, 0, 'tree-sitter');

    const nodeResult = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (hub:function)-[:calls]->(target:function)',
        "WHERE hub.name = 'defaultOrderHub'",
        'RETURN target LIMIT 1',
      ].join(' '),
    ));
    expect(nodeValue(nodeResult.rows[0], 'target').id).toBe(canonicalFirstId);

    const relationshipResult = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (hub:function)-[edge:calls]->(target:function)',
        "WHERE hub.name = 'defaultOrderHub'",
        'RETURN edge LIMIT 1',
      ].join(' '),
    ));
    expect(relationshipValue(relationshipResult.rows[0], 'edge').target).toBe(canonicalFirstId);

    const pathResult = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH p = (hub:function)-[:calls]->(target:function)',
        "WHERE hub.name = 'defaultOrderHub'",
        'RETURN p LIMIT 1',
      ].join(' '),
    ));
    expect(pathValue(pathResult.rows[0], 'p').nodes.map((node) => node.id)).toEqual([
      hubId,
      canonicalFirstId,
    ]);
  });

  it('applies public alternating identity before limiting single ranged paths', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const updatedAt = 1700000000000;
    const hubId = insertNode(fixture.db, {
      id: 'fn:ranged-default-order-hub',
      name: 'rangedDefaultOrderHub',
    }, updatedAt);
    const targetId = insertNode(fixture.db, {
      id: 'fn:ranged-default-order-target',
      name: 'rangedDefaultOrderTarget',
    }, updatedAt);
    insertEdge(fixture.db, hubId, targetId, 'calls', null, 403, 0, 'tree-sitter');
    insertEdge(fixture.db, hubId, targetId, 'calls', null, 402, 0, 'tree-sitter');
    insertEdge(fixture.db, hubId, targetId, 'calls', null, 401, 0, 'tree-sitter');
    const materializedRows: number[] = [];

    const result = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      [
        'MATCH p = (hub:function)-[:calls*1..2]->(target:function)',
        "WHERE hub.name = 'rangedDefaultOrderHub'",
        'RETURN p LIMIT 1',
      ].join(' '),
      { onRowsMaterialized: (count) => materializedRows.push(count) },
    ));

    const path = pathValue(result.rows[0], 'p');
    expect(path.nodes.map((node) => node.id)).toEqual([hubId, targetId]);
    expect(path.relationships.map((relationship) => relationship.line)).toEqual([401]);
    expect(Math.max(...materializedRows)).toBeLessThanOrEqual(2);
  });

  it('orders ranged path extensions before strict public-identity prefixes', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const updatedAt = 1700000000000;
    const hubId = insertNode(fixture.db, {
      id: 'fn:ranged-prefix-order-hub',
      name: 'rangedPrefixOrderHub',
    }, updatedAt);
    const middleId = insertNode(fixture.db, {
      id: 'fn:ranged-prefix-order-middle',
      name: 'rangedPrefixOrderMiddle',
    }, updatedAt);
    const endId = insertNode(fixture.db, {
      id: 'fn:ranged-prefix-order-end',
      name: 'rangedPrefixOrderEnd',
    }, updatedAt);
    const tailId = insertNode(fixture.db, {
      id: 'fn:ranged-prefix-order-tail',
      name: 'rangedPrefixOrderTail',
    }, updatedAt);
    insertEdge(fixture.db, hubId, middleId, 'calls', null, 511, 0, 'tree-sitter');
    insertEdge(fixture.db, middleId, endId, 'calls', null, 512, 0, 'tree-sitter');
    insertEdge(fixture.db, endId, tailId, 'calls', null, 513, 0, 'tree-sitter');
    const materializedRows: number[] = [];

    const result = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      [
        'MATCH p = (hub:function)-[:calls*1..3]->(target:function)',
        "WHERE hub.name = 'rangedPrefixOrderHub'",
        'RETURN p LIMIT 1',
      ].join(' '),
      { onRowsMaterialized: (count) => materializedRows.push(count) },
    ));

    const path = pathValue(result.rows[0], 'p');
    expect(path.nodes.map((node) => node.id)).toEqual([hubId, middleId, endId, tailId]);
    expect(path.relationships.map((relationship) => relationship.line)).toEqual([511, 512, 513]);
    expect(Math.max(...materializedRows)).toBeLessThanOrEqual(2);
  });

  it('orders single-ranged rows by projected values before path identity and LIMIT', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const updatedAt = 1700000000000;
    const hubId = insertNode(fixture.db, {
      id: 'fn:ranged-projection-order-hub',
      name: 'rangedProjectionOrderHub',
    }, updatedAt);
    const pathFirstId = insertNode(fixture.db, {
      id: 'fn:aa-ranged-projection-order',
      name: 'zProjectedLast',
    }, updatedAt);
    const pathMiddleId = insertNode(fixture.db, {
      id: 'fn:mm-ranged-projection-order',
      name: 'mProjectedMiddle',
    }, updatedAt);
    const projectedFirstId = insertNode(fixture.db, {
      id: 'fn:zz-ranged-projection-order',
      name: 'aProjectedFirst',
    }, updatedAt);
    insertEdge(fixture.db, hubId, pathFirstId, 'calls', null, 521, 0, 'tree-sitter');
    insertEdge(fixture.db, hubId, pathMiddleId, 'calls', null, 522, 0, 'tree-sitter');
    insertEdge(fixture.db, hubId, projectedFirstId, 'calls', null, 523, 0, 'tree-sitter');
    const materializedRows: number[] = [];

    const result = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      [
        'MATCH (hub:function)-[:calls*1..1]->(target:function)',
        "WHERE hub.name = 'rangedProjectionOrderHub'",
        'RETURN target.name AS name LIMIT 1',
      ].join(' '),
      { onRowsMaterialized: (count) => materializedRows.push(count) },
    ));

    expect(result.rows.map((row) => scalarValue(row, 'name'))).toEqual(['aProjectedFirst']);
    expect(Math.max(...materializedRows)).toBeLessThanOrEqual(2);
  });

  it('orders ranged relationship-variable projections by public relationship identity', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const updatedAt = 1700000000000;
    const hubId = insertNode(fixture.db, {
      id: 'fn:ranged-relationship-order-hub',
      name: 'rangedRelationshipOrderHub',
    }, updatedAt);
    const canonicalLastId = insertNode(fixture.db, {
      id: 'fn:zz-ranged-relationship-order',
      name: 'rangedRelationshipStoredFirst',
    }, updatedAt);
    const canonicalMiddleId = insertNode(fixture.db, {
      id: 'fn:mm-ranged-relationship-order',
      name: 'rangedRelationshipStoredSecond',
    }, updatedAt);
    const canonicalFirstId = insertNode(fixture.db, {
      id: 'fn:aa-ranged-relationship-order',
      name: 'rangedRelationshipStoredThird',
    }, updatedAt);
    insertEdge(fixture.db, hubId, canonicalLastId, 'calls', '{"tag":"a"}', 541, 10, 'a');
    insertEdge(fixture.db, hubId, canonicalMiddleId, 'calls', '{"tag":"m"}', 542, 20, 'm');
    insertEdge(fixture.db, hubId, canonicalFirstId, 'calls', '{"tag":"z"}', 543, 30, 'z');
    const materializedRows: number[] = [];

    const result = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      [
        'MATCH (hub:function)-[edge:calls*1..1]->(target:function)',
        "WHERE hub.name = 'rangedRelationshipOrderHub'",
        'RETURN edge LIMIT 1',
      ].join(' '),
      { onRowsMaterialized: (count) => materializedRows.push(count) },
    ));

    const relationships = scalarValue(result.rows[0], 'edge');
    expect(Array.isArray(relationships)).toBe(true);
    expect(relationships).toEqual([
      expect.objectContaining({
        target: canonicalFirstId,
        column: 30,
        provenance: 'z',
        metadata: { tag: 'z' },
      }),
    ]);
    expect(relationships).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.anything() }),
    ]));
    expect(Math.max(...materializedRows)).toBeLessThanOrEqual(2);
  });

  it('orders mixed fixed-ranged-fixed paths by full public identity before LIMIT', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const updatedAt = 1700000000000;
    const hubId = insertNode(fixture.db, {
      id: 'fn:mixed-order-hub',
      name: 'mixedOrderHub',
    }, updatedAt);
    const middleId = insertNode(fixture.db, {
      id: 'fn:mixed-order-middle',
      name: 'mixedOrderMiddle',
    }, updatedAt);
    const canonicalLastId = insertNode(fixture.db, {
      id: 'fn:zz-mixed-order',
      name: 'mixedOrderStoredFirst',
    }, updatedAt);
    const canonicalMiddleId = insertNode(fixture.db, {
      id: 'fn:mm-mixed-order',
      name: 'mixedOrderStoredSecond',
    }, updatedAt);
    const canonicalFirstId = insertNode(fixture.db, {
      id: 'fn:aa-mixed-order',
      name: 'mixedOrderStoredThird',
    }, updatedAt);
    const tailId = insertNode(fixture.db, {
      id: 'fn:mixed-order-tail',
      name: 'mixedOrderTail',
    }, updatedAt);
    insertEdge(fixture.db, hubId, middleId, 'imports', null, 531, 0, 'tree-sitter');
    insertEdge(fixture.db, middleId, canonicalLastId, 'calls', null, 532, 0, 'tree-sitter');
    insertEdge(fixture.db, middleId, canonicalMiddleId, 'calls', null, 533, 0, 'tree-sitter');
    insertEdge(fixture.db, middleId, canonicalFirstId, 'calls', null, 534, 0, 'tree-sitter');
    insertEdge(fixture.db, canonicalLastId, tailId, 'imports', null, 535, 0, 'tree-sitter');
    insertEdge(fixture.db, canonicalMiddleId, tailId, 'imports', null, 536, 0, 'tree-sitter');
    insertEdge(fixture.db, canonicalFirstId, tailId, 'imports', null, 537, 0, 'tree-sitter');
    const materializedRows: number[] = [];

    const result = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      [
        'MATCH p = (hub:function)-[:imports]->(middle:function)',
        '-[:calls*1..1]->(candidate:function)-[:imports]->(tail:function)',
        "WHERE hub.name = 'mixedOrderHub'",
        'RETURN p LIMIT 1',
      ].join(' '),
      { onRowsMaterialized: (count) => materializedRows.push(count) },
    ));

    expect(pathValue(result.rows[0], 'p').nodes.map((node) => node.id)).toEqual([
      hubId,
      middleId,
      canonicalFirstId,
      tailId,
    ]);
    expect(Math.max(...materializedRows)).toBeLessThanOrEqual(2);
  });

  it('keeps the 33rd projected row in pure and mixed recursive frontiers', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const updatedAt = 1700000000000;
    const pureHubId = insertNode(fixture.db, {
      id: 'fn:pure-frontier-order-hub',
      name: 'pureFrontierOrderHub',
    }, updatedAt);
    const mixedHubId = insertNode(fixture.db, {
      id: 'fn:mixed-frontier-order-hub',
      name: 'mixedFrontierOrderHub',
    }, updatedAt);
    const mixedMiddleId = insertNode(fixture.db, {
      id: 'fn:mixed-frontier-order-middle',
      name: 'mixedFrontierOrderMiddle',
    }, updatedAt);
    const mixedTailId = insertNode(fixture.db, {
      id: 'fn:mixed-frontier-order-tail',
      name: 'mixedFrontierOrderTail',
    }, updatedAt);
    insertEdge(fixture.db, mixedHubId, mixedMiddleId, 'imports', null, 551, 0, 'tree-sitter');

    fixture.db.exec('BEGIN');
    try {
      for (let index = 1; index <= 33; index += 1) {
        const ordinal = String(index).padStart(2, '0');
        const name = index === 33 ? 'aProjectedFirst' : `zProjected${ordinal}`;
        const pureTargetId = insertNode(fixture.db, {
          id: `fn:pure-frontier-order-target-${ordinal}`,
          name,
        }, updatedAt);
        insertEdge(
          fixture.db,
          pureHubId,
          pureTargetId,
          'calls',
          null,
          560 + index,
          0,
          'tree-sitter',
        );

        const mixedTargetId = insertNode(fixture.db, {
          id: `fn:mixed-frontier-order-target-${ordinal}`,
          name,
        }, updatedAt);
        insertEdge(
          fixture.db,
          mixedMiddleId,
          mixedTargetId,
          'calls',
          null,
          600 + index,
          0,
          'tree-sitter',
        );
        if (index === 33) {
          insertEdge(
            fixture.db,
            mixedTargetId,
            mixedTailId,
            'imports',
            null,
            640,
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

    const pure = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        "MATCH (hub:function {name: 'pureFrontierOrderHub'})-[:calls*1..1]->(target:function)",
        'RETURN target.name AS name LIMIT 1',
      ].join(' '),
    ));
    expect(pure.rows.map((row) => scalarValue(row, 'name'))).toEqual(['aProjectedFirst']);

    const mixed = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        "MATCH (hub:function {name: 'mixedFrontierOrderHub'})",
        '-[:imports]->(middle:function)-[:calls*1..1]->(target:function)',
        'RETURN target.name AS name LIMIT 1',
      ].join(' '),
    ));
    expect(mixed.rows.map((row) => scalarValue(row, 'name'))).toEqual(['aProjectedFirst']);

    const mixedWithFixedSuffix = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        "MATCH (hub:function {name: 'mixedFrontierOrderHub'})",
        '-[:imports]->(middle:function)-[:calls*1..1]->(candidate:function)',
        '-[:imports]->(tail:function)',
        'RETURN tail.name AS name LIMIT 1',
      ].join(' '),
    ));
    expect(mixedWithFixedSuffix.rows.map((row) => scalarValue(row, 'name'))).toEqual([
      'mixedFrontierOrderTail',
    ]);
  });

  it('fails closed at the fixed nonaggregate ranged expansion budget for pure and mixed plans', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const updatedAt = 1700000000000;
    const hubId = insertNode(fixture.db, {
      id: 'fn:nonaggregate-budget-hub',
      name: 'nonaggregateBudgetHub',
    }, updatedAt);
    const prefixId = insertNode(fixture.db, {
      id: 'fn:nonaggregate-budget-prefix',
      name: 'nonaggregateBudgetPrefix',
    }, updatedAt);
    insertEdge(fixture.db, prefixId, hubId, 'imports', null, 645, 0, 'tree-sitter');

    const insertCandidate = (index: number): void => {
      const ordinal = String(index).padStart(5, '0');
      const targetId = insertNode(fixture.db, {
        id: `fn:nonaggregate-budget-target-${ordinal}`,
        name: `nonaggregateBudgetTarget${ordinal}`,
      }, updatedAt);
      insertEdge(
        fixture.db,
        hubId,
        targetId,
        'calls',
        null,
        700 + index,
        0,
        'tree-sitter',
      );
    };

    fixture.db.exec('BEGIN');
    try {
      for (let index = 1; index < 16000; index += 1) {
        insertCandidate(index);
      }
      fixture.db.exec('COMMIT');
    } catch (error) {
      fixture.db.exec('ROLLBACK');
      throw error;
    }

    const pureQuery = [
      "MATCH (hub:function {name: 'nonaggregateBudgetHub'})",
      '-[:calls*1..1]->(target:function)',
      'RETURN target.name AS name LIMIT 1',
    ].join(' ');
    const mixedQuery = [
      "MATCH (prefix:function {name: 'nonaggregateBudgetPrefix'})",
      '-[:imports]->(hub:function)-[:calls*1..1]->(target:function)',
      'RETURN target.name AS name LIMIT 1',
    ].join(' ');
    const belowMaterialized: number[] = [];
    const belowPure = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      pureQuery,
      { onRowsMaterialized: (count) => belowMaterialized.push(count) },
    ));
    const belowMixed = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      mixedQuery,
      { onRowsMaterialized: (count) => belowMaterialized.push(count) },
    ));
    expect(belowPure.rows).toHaveLength(1);
    expect(belowMixed.rows).toHaveLength(1);
    expect(Math.max(...belowMaterialized)).toBeLessThanOrEqual(2);

    insertCandidate(16000);
    const atGuardPure = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      pureQuery,
    ));
    const atGuardMixed = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      mixedQuery,
    ));
    expect(atGuardPure.rows).toHaveLength(1);
    expect(atGuardMixed.rows).toHaveLength(1);

    insertCandidate(16001);
    const aboveGuardPure = await runtime.queryCypher(fixture.projectRoot, pureQuery);
    const aboveGuardMixed = await runtime.queryCypher(fixture.projectRoot, mixedQuery);
    expectDiagnostic(aboveGuardPure, 'CYPHER_PATH_EXPANSION_LIMIT');
    expectDiagnostic(aboveGuardMixed, 'CYPHER_PATH_EXPANSION_LIMIT');
    expect(aboveGuardPure).not.toHaveProperty('rows');
    expect(aboveGuardMixed).not.toHaveProperty('rows');
  }, 30000);

  it('does not prune ranged aggregate matches before grouping and ordering', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const updatedAt = 1700000000000;
    const hubId = insertNode(fixture.db, {
      id: 'fn:aggregate-frontier-hub',
      name: 'aggregateFrontierHub',
    }, updatedAt);
    const prefixId = insertNode(fixture.db, {
      id: 'fn:aggregate-frontier-prefix',
      name: 'aggregateFrontierPrefix',
    }, updatedAt);
    insertEdge(fixture.db, prefixId, hubId, 'imports', null, 649, 0, 'tree-sitter');
    const layerA = Array.from({ length: 30 }, (_, nodeIndex) => insertNode(fixture.db, {
      id: `fn:aggregate-frontier-a-${nodeIndex}`,
      name: `aggregateFrontierA${nodeIndex}`,
    }, updatedAt));
    const layerB = Array.from({ length: 39 }, (_, nodeIndex) => insertNode(fixture.db, {
      id: `fn:aggregate-frontier-b-${nodeIndex}`,
      name: `aggregateFrontierB${nodeIndex}`,
    }, updatedAt));
    const layerC = Array.from({ length: 40 }, (_, nodeIndex) => insertNode(fixture.db, {
      id: `fn:aggregate-frontier-c-${nodeIndex}`,
      name: `aggregateFrontierC${nodeIndex}`,
    }, updatedAt));

    fixture.db.exec('BEGIN');
    try {
      for (const target of layerA) {
        insertEdge(fixture.db, hubId, target, 'calls', null, 650, 0, 'tree-sitter');
      }
      for (const source of layerA) {
        for (const target of layerB) {
          insertEdge(fixture.db, source, target, 'calls', null, 651, 0, 'tree-sitter');
        }
      }
      for (let sourceIndex = 0; sourceIndex < layerB.length; sourceIndex += 1) {
        for (let targetIndex = 0; targetIndex < layerC.length; targetIndex += 1) {
          if (sourceIndex === 0 && targetIndex === 0) {
            continue;
          }
          insertEdge(
            fixture.db,
            layerB[sourceIndex]!,
            layerC[targetIndex]!,
            'calls',
            null,
            652,
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

    const aggregateQuery = [
      "MATCH (start:function {name: 'aggregateFrontierHub'})-[:calls*1..3]->(finish:function)",
      'RETURN start.name AS startName, count(finish.name) AS reachable',
      'ORDER BY reachable DESC LIMIT 1',
    ].join(' ');
    const belowGuard = expectSuccess(await withCypherDeadlineMs(
      CYPHER_SLOW_HOST_DEADLINE_MS,
      () => runtime.queryCypher(fixture.projectRoot, aggregateQuery),
    ));

    expect(belowGuard.rows.map((row) => [
      scalarValue(row, 'startName'),
      scalarValue(row, 'reachable'),
    ])).toEqual([['aggregateFrontierHub', 47970]]);

    insertEdge(
      fixture.db,
      layerB[0]!,
      layerC[0]!,
      'calls',
      null,
      654,
      0,
      'tree-sitter',
    );
    const atGuard = expectSuccess(await withCypherDeadlineMs(
      CYPHER_SLOW_HOST_DEADLINE_MS,
      () => runtime.queryCypher(fixture.projectRoot, aggregateQuery),
    ));
    expect(atGuard.rows.map((row) => [
      scalarValue(row, 'startName'),
      scalarValue(row, 'reachable'),
    ])).toEqual([['aggregateFrontierHub', 48000]]);

    insertEdge(
      fixture.db,
      layerB[0]!,
      layerC[0]!,
      'calls',
      null,
      655,
      0,
      'tree-sitter',
    );
    const aboveGuard = await runtime.queryCypher(
      fixture.projectRoot,
      aggregateQuery,
    );
    const diagnostic = expectDiagnostic(aboveGuard, 'CYPHER_PATH_EXPANSION_LIMIT');
    expect(diagnostic.expected).toContain('narrower MATCH pattern or bounded path range');
    expect(diagnostic.anchor).toBe('runtime');
    expect(diagnostic.message).toContain('Narrow the MATCH pattern or path range');
    expect(aboveGuard).not.toHaveProperty('rows');
    expect(JSON.stringify(aboveGuard)).not.toContain('SELECT');
    expect(JSON.stringify(aboveGuard)).not.toContain('aggregateFrontierHub');

    const zeroGroupAboveGuard = await runtime.queryCypher(
      fixture.projectRoot,
      [
        "MATCH (start:function {name: 'aggregateFrontierHub'})",
        "-[:calls*1..3]->(finish:function {name: 'aggregateFrontierMissing'})",
        'RETURN finish.name AS finishName, count(*) AS reachable',
        'ORDER BY reachable DESC LIMIT 1',
      ].join(' '),
    );
    const zeroGroupDiagnostic = expectDiagnostic(
      zeroGroupAboveGuard,
      'CYPHER_PATH_EXPANSION_LIMIT',
    );
    expect(zeroGroupDiagnostic.expected).toContain(
      'narrower MATCH pattern or bounded path range',
    );
    expect(zeroGroupAboveGuard).not.toHaveProperty('rows');

    const mixedZeroGroupAboveGuard = await runtime.queryCypher(
      fixture.projectRoot,
      [
        "MATCH (prefix:function {name: 'aggregateFrontierPrefix'})",
        '-[:imports]->(start:function)',
        "-[:calls*1..3]->(finish:function {name: 'aggregateFrontierMissing'})",
        'RETURN finish.name AS finishName, count(*) AS reachable',
        'ORDER BY reachable DESC LIMIT 1',
      ].join(' '),
    );
    expectDiagnostic(
      mixedZeroGroupAboveGuard,
      'CYPHER_PATH_EXPANSION_LIMIT',
    );
    expect(mixedZeroGroupAboveGuard).not.toHaveProperty('rows');
  }, 20000);

  it('compares relationship, ranged-list, and path identity tuples with nulls last', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const updatedAt = 1700000000000;
    const hubId = insertNode(fixture.db, {
      id: 'fn:null-identity-order-hub',
      name: 'nullIdentityOrderHub',
    }, updatedAt);
    const targetId = insertNode(fixture.db, {
      id: 'fn:null-identity-order-target',
      name: 'nullIdentityOrderTarget',
    }, updatedAt);
    insertEdge(fixture.db, hubId, targetId, 'calls', null, null, null, 'lsp');
    insertEdge(fixture.db, hubId, targetId, 'calls', null, 701, 7, 'tree-sitter');

    const fixed = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (hub:function)-[edge:calls]->(target:function)',
        "WHERE hub.name = 'nullIdentityOrderHub'",
        'RETURN edge LIMIT 1',
      ].join(' '),
    ));
    expect(relationshipValue(fixed.rows[0], 'edge')).toMatchObject({ line: 701, column: 7 });

    const ranged = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (hub:function)-[edge:calls*1..1]->(target:function)',
        "WHERE hub.name = 'nullIdentityOrderHub'",
        'RETURN edge LIMIT 1',
      ].join(' '),
    ));
    expect(scalarValue(ranged.rows[0], 'edge')).toEqual([
      expect.objectContaining({ line: 701, column: 7 }),
    ]);

    const path = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH p = (hub:function)-[:calls*1..1]->(target:function)',
        "WHERE hub.name = 'nullIdentityOrderHub'",
        'RETURN p LIMIT 1',
      ].join(' '),
    ));
    expect(pathValue(path.rows[0], 'p').relationships).toEqual([
      expect.objectContaining({ line: 701, column: 7 }),
    ]);
  });

  it('uses Unicode code-point ordinal order instead of host locale collation', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    for (const [index, name] of ['Z', 'a', 'z', 'ä', '😀'].entries()) {
      const id = insertNode(fixture.db, {
        id: `fn:unicode-order-${index}`,
        name,
        startLine: 300 + index,
      }, 1700000000000);
      insertEdge(
        fixture.db,
        fixture.nodes.highDegreeHub,
        id,
        'calls',
        null,
        300 + index,
        0,
        'tree-sitter',
      );
    }

    const result = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (hub:function)-[:calls]->(target:function)',
        "WHERE hub.name = 'hub' AND target.startLine >= 300",
        'RETURN target.name AS name ORDER BY target.name',
      ].join(' '),
    ));

    expect(result.rows.map((row) => scalarValue(row, 'name'))).toEqual([
      'Z',
      'a',
      'z',
      'ä',
      '😀',
    ]);
  });
});

describe.skipIf(!nodeSqliteAvailable)('SPEC-013 Cypher runtime — Slice 2 count, grouping, and string predicates', () => {
  it('preserves typed node and fixed relationship projections alongside SQL aggregates', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const groupedNode = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (caller:function)-[:calls]->(callee:function)',
        "WHERE caller.name = 'entry'",
        'RETURN caller, count(*) AS calls',
      ].join(' '),
    ));
    expect(groupedNode.rows).toHaveLength(1);
    expect(nodeValue(groupedNode.rows[0], 'caller')).toMatchObject({
      id: fixture.nodes.entry,
      name: 'entry',
      isExported: true,
    });
    expect(scalarValue(groupedNode.rows[0], 'calls')).toBe(3);

    const groupedRelationship = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (caller:function)-[edge:calls]->(callee:function)',
        "WHERE caller.name = 'entry'",
        'RETURN edge, count(*) AS calls',
        'ORDER BY edge.target',
        'LIMIT 1',
      ].join(' '),
    ));
    expect(groupedRelationship.rows).toHaveLength(1);
    expect(relationshipValue(groupedRelationship.rows[0], 'edge')).toMatchObject({
      source: fixture.nodes.entry,
      target: fixture.nodes.helper,
      kind: 'calls',
      metadata: { resolvedBy: 'static' },
    });
    expect(scalarValue(groupedRelationship.rows[0], 'calls')).toBe(1);
  });

  it('rejects ranged relationship-list property predicates before preparing SQL', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const preparedSql: string[] = [];

    const diagnostic = expectDiagnostic(await runtime.queryCypherForTests(
      fixture.projectRoot,
      [
        'MATCH (start:function)-[edge:calls*1..2]->(finish:function)',
        "WHERE edge.kind = 'calls'",
        'RETURN edge',
      ].join(' '),
      { onSqlPrepare: (sql) => preparedSql.push(sql) },
    ), 'CYPHER_UNSUPPORTED');

    expect(diagnostic.anchor).toBe('whereClause');
    expect(diagnostic.expected).toBe('bare ranged relationship variable');
    expect(preparedSql).toEqual([]);
  });

  it('counts active matches with count(*) and count(expr) without counting null expressions', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const result = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (entry:function)-[:calls]->(target:function)',
        "WHERE entry.name = 'entry'",
        'RETURN count(*) AS totalCalls, count(target.signature) AS documentedTargets',
      ].join(' '),
    ));

    expect(result.columns.map((column) => column.name)).toEqual(['totalCalls', 'documentedTargets']);
    expect(result.rows).toHaveLength(1);
    expect(scalarValue(result.rows[0], 'totalCalls')).toBe(3);
    expect(scalarValue(result.rows[0], 'documentedTargets')).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('hydrates grouped fixed-path projections as typed path values alongside aggregates', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const result = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        "MATCH p = (caller:function)-[:calls]->(callee:function) WHERE caller.name = 'entry'",
        'RETURN caller.name AS caller, count(callee) AS callees, p',
        'ORDER BY caller ASC',
        'LIMIT 1',
      ].join(' '),
    ));

    expect(result.rows).toHaveLength(1);
    expect(scalarValue(result.rows[0], 'caller')).toBe('entry');
    expect(scalarValue(result.rows[0], 'callees')).toBe(1);
    const path = pathValue(result.rows[0], 'p');
    expect(path.length).toBe(1);
    expect(path.nodes).toHaveLength(2);
    expect(path.relationships).toHaveLength(1);
  });

  it('groups implicitly by every non-aggregate projection and orders by aggregate aliases', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const result = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (caller:function)-[:calls]->(target:function)',
        'RETURN caller.name AS callerName, caller.filePath AS filePath, count(*) AS calls, count(target.signature) AS documentedTargets',
        'ORDER BY calls DESC, callerName ASC',
        'LIMIT 4',
      ].join(' '),
    ));

    expect(result.effectiveCap).toBe(4);
    expect(result.truncated).toBe(true);
    expect(result.rows.map((row) => ({
      callerName: scalarValue(row, 'callerName'),
      filePath: scalarValue(row, 'filePath'),
      calls: scalarValue(row, 'calls'),
      documentedTargets: scalarValue(row, 'documentedTargets'),
    }))).toEqual([
      { callerName: 'hub', filePath: 'src/main.ts', calls: 12, documentedTargets: 0 },
      { callerName: 'entry', filePath: 'src/main.ts', calls: 3, documentedTargets: 1 },
      { callerName: 'cycleA', filePath: 'src/main.ts', calls: 1, documentedTargets: 0 },
      { callerName: 'cycleB', filePath: 'src/main.ts', calls: 1, documentedTargets: 0 },
    ]);
  });

  it('groups node-only matches for the exact T057 single-node aggregate demo query', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const preparedSql: string[] = [];
    const updatedAt = 1700000000000;
    insertNode(fixture.db, {
      id: 'fn:t057:queryCypher',
      name: 'queryCypher',
      qualifiedName: 'src/query/cypher.queryCypher',
      filePath: 'src/query/cypher/index.ts',
      startLine: 1200,
    }, updatedAt);
    insertNode(fixture.db, {
      id: 'fn:t057:quoteIdentifier',
      name: 'quoteIdentifier',
      qualifiedName: 'src/query/cypher.quoteIdentifier',
      filePath: 'src/query/cypher/index.ts',
      startLine: 1210,
    }, updatedAt);
    insertNode(fixture.db, {
      id: 'fn:t057:queryCommand',
      name: 'queryCommand',
      qualifiedName: 'src/bin.queryCommand',
      filePath: 'src/bin/codegraph.ts',
      startLine: 1220,
    }, updatedAt);

    const result = await runtime.queryCypherForTests(
      fixture.projectRoot,
      "MATCH (n:function) WHERE n.name STARTS WITH 'q' RETURN n.filePath, count(*) AS callers ORDER BY callers DESC LIMIT 10",
      { onSqlPrepare: (sql) => preparedSql.push(sql) },
    );

    expect(result).not.toMatchObject({ status: 'diagnostic', code: 'CYPHER_DISCONNECTED_PATTERN' });
    const success = expectSuccess(result);
    expect(success.columns.map((column) => column.name)).toEqual(['n.filePath', 'callers']);
    expect(success.effectiveCap).toBe(10);
    expect(success.truncated).toBe(false);
    expect(success.rows.map((row) => ({
      filePath: scalarValue(row, 'n.filePath'),
      callers: scalarValue(row, 'callers'),
    }))).toEqual([
      { filePath: 'src/query/cypher/index.ts', callers: 2 },
      { filePath: 'src/bin/codegraph.ts', callers: 1 },
    ]);
    expect(preparedSql).toHaveLength(1);
    expect(preparedSql[0]).toContain('FROM nodes n0');
    expect(preparedSql[0]).toContain('GROUP BY n0.file_path');
    expect(preparedSql[0]).not.toContain('JOIN edges');
  });

  it('applies STARTS WITH, ENDS WITH, and CONTAINS while preserving Cypher null predicate semantics', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const matchedByStringOperators = expectSuccess(await queryResultOrUnhandledDiagnostic(runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (entry:function)-[:calls]->(target:function)',
        "WHERE entry.name = 'entry'",
        "AND (target.name STARTS WITH 'h' OR target.name ENDS WITH 'Target' OR target.name CONTAINS 'spT')",
        'RETURN target.name AS name',
        'ORDER BY name ASC',
      ].join(' '),
    )));
    expect(matchedByStringOperators.rows.map((row) => scalarValue(row, 'name'))).toEqual([
      'helper',
      'heuristicTarget',
      'lspTarget',
    ]);

    const nullStringPredicate = expectSuccess(await queryResultOrUnhandledDiagnostic(runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (entry:function)-[:calls]->(target:function)',
        "WHERE entry.name = 'entry'",
        "AND NOT (target.signature STARTS WITH 'function')",
        'RETURN target.name AS name',
        'ORDER BY name ASC',
      ].join(' '),
    )));
    expect(nullStringPredicate.rows).toEqual([]);
  });

  it('orders grouped nullable keys with explicit ASC and DESC null placement', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();

    const ascending = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (entry:function)-[:calls]->(target:function)',
        "WHERE entry.name = 'entry'",
        'RETURN target.signature AS signature, count(*) AS calls',
        'ORDER BY signature ASC',
      ].join(' '),
    ));
    expect(ascending.rows.map((row) => ({
      signature: scalarValue(row, 'signature'),
      calls: scalarValue(row, 'calls'),
    }))).toEqual([
      { signature: 'function helper(): number', calls: 1 },
      { signature: null, calls: 2 },
    ]);

    const descending = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      [
        'MATCH (entry:function)-[:calls]->(target:function)',
        "WHERE entry.name = 'entry'",
        'RETURN target.signature AS signature, count(*) AS calls',
        'ORDER BY signature DESC',
      ].join(' '),
    ));
    expect(descending.rows.map((row) => ({
      signature: scalarValue(row, 'signature'),
      calls: scalarValue(row, 'calls'),
    }))).toEqual([
      { signature: null, calls: 2 },
      { signature: 'function helper(): number', calls: 1 },
    ]);
  });

  it('serializes aggregate rows deterministically across repeated runtime executions', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const query = [
      'MATCH (caller:function)-[:calls]->(target:function)',
      'RETURN caller.name AS callerName, count(*) AS calls',
      'ORDER BY calls DESC, callerName ASC',
      'LIMIT 5',
    ].join(' ');

    const runs = await Promise.all([
      runtime.queryCypher(fixture.projectRoot, query),
      runtime.queryCypher(fixture.projectRoot, query),
      runtime.queryCypher(fixture.projectRoot, query),
    ]);
    const successes = runs.map((run) => expectSuccess(run));

    expect(successes.map((result) => JSON.stringify(result))).toEqual([
      JSON.stringify(successes[0]),
      JSON.stringify(successes[0]),
      JSON.stringify(successes[0]),
    ]);
    expect(successes[0].rows.map((row) => [
      scalarValue(row, 'callerName'),
      scalarValue(row, 'calls'),
    ])).toEqual([
      ['hub', 12],
      ['entry', 3],
      ['cycleA', 1],
      ['cycleB', 1],
      ['cycleC', 1],
    ]);
  });

  it('inspects only effectiveCap plus one grouped rows before marking aggregate results truncated', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    addFanout(fixture, 'groupCap', 12);
    const inspectedRows: number[] = [];

    const result = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      [
        'MATCH (hub:function)-[:calls]->(target:function)',
        "WHERE hub.name = 'groupCapHub'",
        'RETURN target.name AS targetName, count(*) AS calls',
        'ORDER BY targetName ASC',
        'LIMIT 5',
      ].join(' '),
      { onRowsInspected: (count) => inspectedRows.push(count) },
    ));

    expect(result.effectiveCap).toBe(5);
    expect(result.rows).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.rows.map((row) => scalarValue(row, 'calls'))).toEqual([1, 1, 1, 1, 1]);
    expect(Math.max(...inspectedRows)).toBeLessThanOrEqual(6);
  });

  it('returns output-too-large diagnostics for aggregate payloads without partial grouped rows', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    addFanout(fixture, 'payloadAggregate', 20);

    const result = await runtime.queryCypherForTests(
      fixture.projectRoot,
      [
        'MATCH (hub:function)-[:calls]->(target:function)',
        "WHERE hub.name = 'payloadAggregateHub'",
        'RETURN target.name AS targetName, count(*) AS calls',
        'ORDER BY targetName ASC',
      ].join(' '),
      { payloadLimitBytes: 220 },
    );

    const diagnostic = expectDiagnostic(result, 'CYPHER_OUTPUT_TOO_LARGE');
    expect(diagnostic.message).toContain('narrow');
    expect(result).not.toHaveProperty('rows');
    expect(JSON.stringify(result)).not.toContain('payloadAggregateTarget');
  });

  it('plans dense variable-path aggregate queries with indexed bounded recursion and stable grouped results', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    addLayeredVariablePathDensity(fixture, 'planDense', 10);
    const preparedSql: string[] = [];

    const result = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      [
        'MATCH p = (start:function)-[:calls*1..2]->(finish:function)',
        "WHERE start.name STARTS WITH 'planDenseL0'",
        'RETURN start.name AS startName, count(finish.name) AS reachable',
        'ORDER BY reachable DESC, startName ASC',
        'LIMIT 5',
      ].join(' '),
      { onSqlPrepare: (sql) => preparedSql.push(sql) },
    ));

    expect(result.effectiveCap).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.rows.map((row) => [
      scalarValue(row, 'startName'),
      scalarValue(row, 'reachable'),
    ])).toEqual([
      ['planDenseL001', 110],
      ['planDenseL002', 110],
      ['planDenseL003', 110],
      ['planDenseL004', 110],
      ['planDenseL005', 110],
    ]);

    const recursiveSql = preparedSql.find((sql) => /^WITH RECURSIVE\b/i.test(sql));
    expect(recursiveSql).toBeDefined();
    expect(recursiveSql).toContain('JOIN edges e0 INDEXED BY idx_edges_source_kind ON e0.source = n0.id');
    expect(recursiveSql).toContain('GROUP BY');
    expect(recursiveSql).toContain('ORDER BY');
    expect(recursiveSql).not.toContain('FROM nodes ORDER BY id');
  });
});

describe.skipIf(!nodeSqliteAvailable)('SPEC-013 Cypher runtime — caps, diagnostics, and execution safety', () => {
  it('rejects multiple ranged relationship segments before preparing SQL', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const preparedSql: string[] = [];

    const diagnostic = expectDiagnostic(await runtime.queryCypherForTests(
      fixture.projectRoot,
      [
        'MATCH (a:function)-[:calls*1..2]->(b:function)',
        '-[:calls*1..2]->(c:function)',
        'RETURN c',
      ].join(' '),
      { onSqlPrepare: (sql) => preparedSql.push(sql) },
    ), 'CYPHER_UNSUPPORTED');

    expect(diagnostic.anchor).toBe('relationshipPattern');
    expect(diagnostic.expected).toBe('at most one ranged relationship segment');
    expect(preparedSql).toEqual([]);
  });

  it('returns canonical located diagnostics instead of rejecting malformed WHERE promises', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const query = 'MATCH (n:function) WHERE n.name = RETURN n.name';

    const diagnostic = expectDiagnostic(
      await runtime.queryCypher(fixture.projectRoot, query),
      'CYPHER_SYNTAX',
    );
    expect(diagnostic.offset).toBe(query.indexOf('RETURN'));
    expect(diagnostic.anchor).toBe('whereClause');
    expect(diagnostic.excerpt).toContain('RETURN n.name');
  });

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
  }, 15_000);

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

  it('keeps final mutating/direct-SQL guardrails before prepare with no graph storage drift', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const before = fixture.snapshot();
    const preparedSql: string[] = [];

    const mutating = await runtime.queryCypherForTests(
      fixture.projectRoot,
      "MATCH (n:function)-[:calls]->(m:function) CREATE (x:function {name: 'forbidden'}) RETURN n",
      { onSqlPrepare: (sql) => preparedSql.push(sql) },
    );
    const directSql = await runtime.queryCypherForTests(
      fixture.projectRoot,
      "UPDATE nodes SET name = 'forbidden' WHERE id = 'fn:entry'",
      { onSqlPrepare: (sql) => preparedSql.push(sql) },
    );

    expectDiagnostic(mutating, 'CYPHER_UNSUPPORTED_CLAUSE');
    expectDiagnostic(directSql, 'CYPHER_DIRECT_SQL_UNSUPPORTED');
    expect(preparedSql).toEqual([]);
    expect(fixture.snapshot()).toMatchObject({
      sqliteSchemaVersion: before.sqliteSchemaVersion,
      sqliteDataVersion: before.sqliteDataVersion,
      schemaVersions: before.schemaVersions,
      nodeCount: before.nodeCount,
      edgeCount: before.edgeCount,
      activeEdgeCount: before.activeEdgeCount,
      inactiveLspSuppressedEdgeCount: before.inactiveLspSuppressedEdgeCount,
      representativeNode: before.representativeNode,
      representativeEdge: before.representativeEdge,
    });
  });

  it('rejects external parameter syntax before prepare without graph storage drift', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const before = fixture.snapshot();
    const preparedSql: string[] = [];

    const result = await runtime.queryCypherForTests(
      fixture.projectRoot,
      'MATCH (entry:function)-[:calls]->(target:function) WHERE entry.name = $entryName RETURN target.name',
      { onSqlPrepare: (sql) => preparedSql.push(sql) },
    );

    expect(preparedSql).toEqual([]);
    expect(fixture.snapshot()).toEqual(before);
    expectDiagnostic(result, 'CYPHER_EXTERNAL_PARAMETER_UNSUPPORTED');
  });

  it('rejects unsupported openCypher clauses before prepare without graph storage drift', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const before = fixture.snapshot();
    const preparedSql: string[] = [];

    const unsupported = await Promise.all([
      runtime.queryCypherForTests(
        fixture.projectRoot,
        'OPTIONAL MATCH (entry:function)-[:calls]->(target:function) RETURN target.name',
        { onSqlPrepare: (sql) => preparedSql.push(sql) },
      ),
      runtime.queryCypherForTests(
        fixture.projectRoot,
        'MATCH (entry:function)-[:calls]->(target:function) WITH entry RETURN entry.name',
        { onSqlPrepare: (sql) => preparedSql.push(sql) },
      ),
    ]);

    expect(preparedSql).toEqual([]);
    expect(fixture.snapshot()).toEqual(before);
    for (const result of unsupported) {
      expectDiagnostic(result, 'CYPHER_UNSUPPORTED_OPENCYPHER');
    }
  });

  it('keeps read-only connection dormancy separate from timeout worker replacement', async () => {
    const boundary = await loadCypherRuntimeBoundaryContract();
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    const beforeSnapshot = fixture.snapshot();
    const beforeState = runtime.getCypherRuntimeStateForTests();
    const readOnlyDb = boundary.openCypherReadOnlyDatabaseForTests(fixture.dbPath);

    try {
      expect(readOnlyDb.prepare('SELECT count(*) AS count FROM nodes').get()).toEqual({ count: beforeSnapshot.nodeCount });
      expect(() => {
        readOnlyDb.prepare("UPDATE nodes SET name = 'forbidden' WHERE id = 'fn:entry'").run();
      }).toThrow();
    } finally {
      readOnlyDb.close();
    }

    expect(runtime.getCypherRuntimeStateForTests()).toEqual(beforeState);
    expect(fixture.snapshot()).toEqual(beforeSnapshot);

    expectTimeout(await withExpiredCypherDeadline(() => runtime.queryCypherForTests(
      fixture.projectRoot,
      "MATCH p = (hub:function)-[:calls*1..8]->(target:function) WHERE hub.name = 'hub' RETURN p",
    )));

    const afterTimeoutState = runtime.getCypherRuntimeStateForTests();
    expect(afterTimeoutState.activeWorkers).toBe(0);
    expect(afterTimeoutState.terminatedWorkers).toBe(beforeState.terminatedWorkers + 1);
    expect(fixture.snapshot()).toEqual(beforeSnapshot);

    const followup = expectSuccess(await runtime.queryCypher(
      fixture.projectRoot,
      "MATCH (entry:function)-[:calls]->(target:function) WHERE entry.name = 'entry' RETURN target.name AS name ORDER BY target.name LIMIT 1",
    ));
    expect(followup.rows.map((row) => scalarValue(row, 'name'))).toEqual(['helper']);
    expect(runtime.getCypherRuntimeStateForTests().activeWorkers).toBe(0);
  }, 7000);

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

    expectTimeout(await withExpiredCypherDeadline(() => runtime.queryCypherForTests(
      fixture.projectRoot,
      "MATCH p = (hub:function)-[:calls*1..8]->(target:function) WHERE hub.name = 'hub' RETURN p",
    )));

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

describe.skipIf(!nodeSqliteAvailable)('SPEC-013 Cypher runtime — final performance probes (T061)', () => {
  it('captures representative query-plan evidence for variable paths, edge index use, grouped ordering, and bounded temp work', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    addLayeredVariablePathDensity(fixture, 't061Plan', 10);
    const preparedSql: string[] = [];
    const materializedRows: number[] = [];
    const inspectedRows: number[] = [];
    const planEvidence: CypherPerformancePlanEvidence[] = [];
    const query = [
      'MATCH p = (start:function)-[:calls*1..2]->(finish:function)',
      "WHERE start.name STARTS WITH 't061PlanL0'",
      'RETURN start.name AS startName, count(finish.name) AS reachable',
      'ORDER BY reachable DESC, startName ASC',
      'LIMIT 5',
    ].join(' ');

    const result = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      query,
      {
        onSqlPrepare: (sql) => preparedSql.push(sql),
        onRowsMaterialized: (count) => materializedRows.push(count),
        onRowsInspected: (count) => inspectedRows.push(count),
        onQueryPlan: (evidence) => planEvidence.push(evidence),
      },
    ));

    expect(result.effectiveCap).toBe(5);
    expect(result.rows).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.rows.map((row) => [
      scalarValue(row, 'startName'),
      scalarValue(row, 'reachable'),
    ])).toEqual([
      ['t061PlanL001', 110],
      ['t061PlanL002', 110],
      ['t061PlanL003', 110],
      ['t061PlanL004', 110],
      ['t061PlanL005', 110],
    ]);
    expect(Math.max(...materializedRows)).toBeLessThanOrEqual(6);
    expect(Math.max(...inspectedRows)).toBeLessThanOrEqual(6);

    const recursiveSql = preparedSql.find((sql) => /^WITH RECURSIVE\b/i.test(sql));
    expect(recursiveSql).toBeDefined();
    expect(recursiveSql).toContain('JOIN edges e0 INDEXED BY idx_edges_source_kind ON e0.source = n0.id');
    expect(recursiveSql).toContain('GROUP BY');
    expect(recursiveSql).toContain('ORDER BY');

    expect(planEvidence, 'T061 requires EXPLAIN QUERY PLAN or equivalent evidence rows').not.toEqual([]);
    expect(planEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        probeId: 'PERF-VARIABLE-PATH-PLAN',
        query,
        edgeIndexes: expect.arrayContaining(['idx_edges_source_kind']),
        boundedBy: expect.stringMatching(/effectiveCap \+ 1|LIMIT 5|timeout/i),
      }),
    ]));
    expect(planEvidence.flatMap((evidence) => evidence.details).join('\n')).toMatch(/QUERY PLAN|SEARCH|SCAN/i);
    expect(planEvidence.flatMap((evidence) => evidence.tempWork).join('\n')).toMatch(/TEMP|ORDER BY|GROUP BY/i);
  });

  it('keeps row-cap, stable ordering, output-size, and timeout performance probes bounded', async () => {
    const runtime = await loadCypherRuntimeContract();
    const fixture = createCypherRuntimeFixture();
    addFanout(fixture, 't061Cap', 24);

    const inspectedRows: number[] = [];
    const capped = expectSuccess(await runtime.queryCypherForTests(
      fixture.projectRoot,
      "MATCH (hub:function)-[:calls]->(target:function) WHERE hub.name = 't061CapHub' RETURN target.name AS name LIMIT 5",
      { onRowsInspected: (count) => inspectedRows.push(count) },
    ));
    expect(capped.effectiveCap).toBe(5);
    expect(capped.rows).toHaveLength(5);
    expect(capped.truncated).toBe(true);
    expect(capped.rows.map((row) => scalarValue(row, 'name'))).toEqual([
      't061CapTarget0001',
      't061CapTarget0002',
      't061CapTarget0003',
      't061CapTarget0004',
      't061CapTarget0005',
    ]);
    expect(Math.max(...inspectedRows)).toBeLessThanOrEqual(6);
    expect(capped).not.toHaveProperty('totalRows');

    const payloadTooLarge = await runtime.queryCypherForTests(
      fixture.projectRoot,
      "MATCH (hub:function)-[:calls]->(target:function) WHERE hub.name = 't061CapHub' RETURN target.name AS name ORDER BY target.name",
      { payloadLimitBytes: 180 },
    );
    expectDiagnostic(payloadTooLarge, 'CYPHER_OUTPUT_TOO_LARGE');
    expect(payloadTooLarge).not.toHaveProperty('rows');

    expectTimeout(await withExpiredCypherDeadline(() => runtime.queryCypherForTests(
      fixture.projectRoot,
      "MATCH p = (hub:function)-[:calls*1..8]->(target:function) WHERE hub.name = 't061CapHub' RETURN p",
    )));
    expect(runtime.getCypherRuntimeStateForTests().activeWorkers).toBe(0);
  }, 7000);
});
