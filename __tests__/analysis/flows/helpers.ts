/**
 * SPEC-011 US1 flow-analysis test helpers: real temp SQLite (no mocking), a
 * fluent node/edge seeder, and a source-file map for the `FlowAnalysisGraph`
 * `readFile` seam used by CLI/event entry-point detection.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseConnection } from '../../../src/db';
import { QueryBuilder } from '../../../src/db/queries';
import type { SqliteDatabase } from '../../../src/db/sqlite-adapter';
import type { Edge, EdgeKind, EdgeProvenance, Node, NodeKind } from '../../../src/types';
import type { FlowAnalysisGraph } from '../../../src/analysis/flows/entry-points';

export interface SeedHandle {
  db: SqliteDatabase;
  queries: QueryBuilder;
  dir: string;
  conn: DatabaseConnection;
  files: Record<string, string>;
  graph: FlowAnalysisGraph;
}

const open: DatabaseConnection[] = [];
const madeDirs: string[] = [];

export function freshSeed(): SeedHandle {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-flows-'));
  madeDirs.push(dir);
  const conn = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
  open.push(conn);
  const db = conn.getDb();
  const queries = new QueryBuilder(db);
  const files: Record<string, string> = {};
  const graph: FlowAnalysisGraph = { queries, readFile: (p) => files[p] ?? null };
  return { db, queries, dir, conn, files, graph };
}

export function cleanupSeeds(): void {
  while (open.length) {
    try {
      open.pop()!.close();
    } catch {
      /* ignore */
    }
  }
  while (madeDirs.length) {
    try {
      fs.rmSync(madeDirs.pop()!, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

let nodeSeq = 0;

/** Insert a node with sensible defaults; returns the full Node (with its id). */
export function node(
  h: SeedHandle,
  spec: {
    id?: string;
    name: string;
    kind: NodeKind;
    filePath?: string;
    qualifiedName?: string;
    isExported?: boolean;
    startLine?: number;
    endLine?: number;
  },
): Node {
  const filePath = spec.filePath ?? 'src/app.ts';
  const id = spec.id ?? `n${nodeSeq++}:${filePath}:${spec.name}`;
  const n: Node = {
    id,
    kind: spec.kind,
    name: spec.name,
    qualifiedName: spec.qualifiedName ?? `${filePath}::${spec.name}`,
    filePath,
    language: 'typescript',
    startLine: spec.startLine ?? 1,
    endLine: spec.endLine ?? (spec.startLine ?? 1),
    startColumn: 0,
    endColumn: 0,
    isExported: spec.isExported ?? false,
    updatedAt: 0,
  };
  h.queries.insertNode(n);
  return n;
}

/** Insert an edge between two nodes. */
export function edge(
  h: SeedHandle,
  source: string,
  target: string,
  kind: EdgeKind,
  provenance?: EdgeProvenance,
  line?: number,
): Edge {
  const e: Edge = { source, target, kind, provenance, line };
  h.queries.insertEdge(e);
  return e;
}

/**
 * Register a source file for the graph's `readFile` seam AND insert a `files`
 * row (the CLI/event scanners enumerate `queries.getAllFiles()`, exactly as the
 * real pipeline does over indexed files).
 */
export function file(h: SeedHandle, relPath: string, content: string): void {
  h.files[relPath] = content;
  h.queries.upsertFile({
    path: relPath,
    contentHash: 'test',
    language: 'typescript',
    size: content.length,
    modifiedAt: 0,
    indexedAt: 0,
    nodeCount: 0,
  });
}

/** Advance graph_write_version to a concrete value (default 1). */
export function setVersion(h: SeedHandle, to = 1): void {
  for (let i = 0; i < to; i++) h.queries.advanceGraphWriteVersion();
}
