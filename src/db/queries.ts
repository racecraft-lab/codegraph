/**
 * Database Queries
 *
 * Prepared statements for CRUD operations on the knowledge graph.
 */

import { SqliteDatabase, SqliteStatement } from './sqlite-adapter';
import {
  Node,
  Edge,
  FileRecord,
  UnresolvedReference,
  NodeKind,
  EdgeKind,
  Language,
  GraphStats,
  SearchOptions,
  SearchResult,
} from '../types';
import { safeJsonParse } from '../utils';
import { kindBonus, nameMatchBonus, scorePathRelevance } from '../search/query-utils';
import { parseQuery, boundedEditDistance } from '../search/query-parser';
import { isGeneratedFile } from '../extraction/generated-detection';
import { splitIdentifierSegments } from '../search/identifier-segments';

/**
 * Path-only heuristic for files that should not be candidates for
 * "dominant file" detection: test/spec files and tool-generated files.
 * Generated files (`*.pb.go`, `*.pulsar.go`, mock outputs, …) often
 * have huge in-file edge counts that dwarf the real source — etcd's
 * `rpc.pb.go` has 4× the in-file edges of `server.go`.
 */
function isLowValueFile(filePath: string): boolean {
  const lp = filePath.toLowerCase();
  return (
    /(?:^|\/)(tests?|__tests?__|spec)\//.test(lp) ||
    /_test\.go$/.test(lp) ||
    /(?:^|\/)test_[^/]+\.py$/.test(lp) ||
    /_test\.py$/.test(lp) ||
    /_spec\.rb$/.test(lp) ||
    /_test\.rb$/.test(lp) ||
    /\.(test|spec)\.[jt]sx?$/.test(lp) ||
    /(test|spec|tests)\.(java|kt|scala)$/.test(lp) ||
    /(tests?|spec)\.cs$/.test(lp) ||
    /tests?\.swift$/.test(lp) ||
    /_test\.dart$/.test(lp) ||
    isGeneratedFile(filePath)
  );
}

const SQLITE_PARAM_CHUNK_SIZE = 500;

/**
 * Declaration-level node kinds that receive an embedding (SPEC-001 FR-005).
 * The complement — parameter, import, export, enum_member, field, property,
 * file — is deliberately excluded as embedding noise (FR-006). Shared by the
 * missing-vector selection and the coverage count so the two can never drift.
 */
const EMBEDDABLE_NODE_KINDS: readonly NodeKind[] = [
  'function', 'method', 'class', 'struct', 'interface', 'trait', 'protocol',
  'enum', 'type_alias', 'module', 'namespace', 'component', 'route',
  'constant', 'variable',
];

/** Placeholder list (`?, ?, …`) binding {@link EMBEDDABLE_NODE_KINDS} into an IN(). */
const EMBEDDABLE_KINDS_PLACEHOLDERS = EMBEDDABLE_NODE_KINDS.map(() => '?').join(', ');

/**
 * Database row types (snake_case from SQLite)
 */
interface NodeRow {
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
  is_exported: number;
  is_async: number;
  is_static: number;
  is_abstract: number;
  decorators: string | null;
  type_parameters: string | null;
  return_type: string | null;
  updated_at: number;
}

interface EdgeRow {
  id: number;
  source: string;
  target: string;
  kind: string;
  metadata: string | null;
  line: number | null;
  col: number | null;
  provenance: string | null;
}

interface FileRow {
  path: string;
  content_hash: string;
  language: string;
  size: number;
  modified_at: number;
  indexed_at: number;
  node_count: number;
  errors: string | null;
}

interface UnresolvedRefRow {
  id: number;
  from_node_id: string;
  reference_name: string;
  reference_kind: string;
  line: number;
  col: number;
  candidates: string | null;
  file_path: string;
  language: string;
  status: string;
  name_tail: string;
}

/**
 * Last segment of a (possibly dotted/qualified) reference name — the part a
 * new symbol's plain node name could match: 'util.greet' → 'greet',
 * 'mod::fn' → 'fn', 'greet' → 'greet'. Written to unresolved_refs.name_tail
 * when a ref is marked failed, so the #1240 retry lookup can match dotted
 * refs against newly-added node names.
 */
function referenceNameTail(referenceName: string): string {
  const idx = Math.max(referenceName.lastIndexOf('.'), referenceName.lastIndexOf(':'));
  return idx >= 0 ? referenceName.slice(idx + 1) : referenceName;
}

function activeEdgePredicate(alias?: string): string {
  const column = alias ? `${alias}.metadata` : 'metadata';
  return `(CASE
    WHEN ${column} IS NULL THEN 1
    WHEN json_valid(${column}) = 0 THEN 1
    WHEN json_extract(${column}, '$.lsp.active') = 0 THEN 0
    ELSE 1
  END) = 1`;
}

export interface LspEdgeCandidateRow {
  edgeId: number;
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
  line: number | null;
  column: number | null;
  provenance: Edge['provenance'] | null;
  metadata: Record<string, unknown> | undefined;
  sourceFilePath: string;
  language: Language;
  targetFilePath: string;
  targetStartLine: number;
  targetEndLine: number;
  targetStartColumn: number;
  targetEndColumn: number;
  targetKind: NodeKind;
  targetName: string;
}

export interface LspEdgeCandidateCounts {
  sourceFilesSeen: number;
  candidateWorkItems: number;
  fileCapSkippedWorkItems: number;
  workCapSkippedWorkItems: number;
}

/**
 * SPEC-010 (graph-aware rename): the edge kinds a rename must edit — every kind
 * whose SOURCE POSITION (`edges.line/col`) is a textual occurrence of the
 * referenced symbol's name, NOT just `references`. Empirically grounded (a dist
 * probe over a real TypeScript index): a directly-exported symbol's incoming
 * edges land on the name at a `calls` site (`oldFn(...)`), an `imports` /
 * re-export specifier (`import { oldFn }`), a `references` by-ref / type
 * annotation / return type, and an `extends` / `implements` clause.
 *
 * `type_of` / `returns` / `overrides` / `instantiates` / `decorates` are the
 * remaining symbol-naming kinds other language extractors emit (TS folds type &
 * return annotations into `references`); they are included because span
 * verification (FR-005 — `verifySpan` in graph-rename) is the per-edge safety
 * filter that drops any edge whose recorded position does not carry the old name
 * — which is exactly what makes this broad inclusion safe. An `instantiates` /
 * `decorates` position that points at the `new` / `@` sigil (as TS records it)
 * can never equal an identifier, so it is dropped, never mis-edited.
 *
 * EXCLUDED — the two structural membership kinds that never record a name
 * occurrence: `contains` (parent→child; its position is NULL) and `exports`
 * (module→symbol; re-export & import specifiers are recorded as `imports`, so
 * excluding it loses no occurrence). Tier classification (`classifyEdgeConfidence`)
 * and the self-loop guard still apply per edge downstream in graph-rename.
 */
const RENAME_RELEVANT_EDGE_KINDS: readonly EdgeKind[] = [
  'references', 'calls', 'imports', 'extends', 'implements',
  'type_of', 'returns', 'instantiates', 'overrides', 'decorates',
];

/** Placeholder list (`?, ?, …`) binding {@link RENAME_RELEVANT_EDGE_KINDS} into an IN(). */
const RENAME_RELEVANT_EDGE_KINDS_PLACEHOLDERS = RENAME_RELEVANT_EDGE_KINDS.map(() => '?').join(', ');

/**
 * SPEC-010 (graph-aware rename): one incoming name-occurrence edge to a target
 * (any {@link RENAME_RELEVANT_EDGE_KINDS} kind), denormalized with the
 * referencing (source) node's file so the plan path can build a graph
 * `RenameEdit` without an extra getNodeById per edge. Positions are the
 * occurrence START only (UTF-16 code units) — the end column is derived from the
 * old name's length and span-verified (research Decision 8).
 */
export interface IncomingReferenceRow {
  /** `edges.source` — id of the node the reference occurs in. */
  sourceId: string;
  /** `nodes.file_path` of the referencing node — the file the edit lands in. */
  sourceFilePath: string;
  /** `edges.line` — 1-indexed start line of the occurrence (nullable in schema). */
  line: number | null;
  /** `edges.col` — 0-indexed start column of the occurrence (nullable in schema). */
  column: number | null;
  /** Parsed `edges.metadata` JSON — carries resolvedBy / confidence / refName. */
  metadata: Record<string, unknown> | undefined;
  /** `edges.provenance` — NULL for base resolved edges, `'lsp'` after SPEC-008. */
  provenance: Edge['provenance'];
}

/**
 * Convert database row to Node object
 */
function rowToNode(row: NodeRow): Node {
  return {
    id: row.id,
    kind: row.kind as NodeKind,
    name: row.name,
    qualifiedName: row.qualified_name,
    filePath: row.file_path,
    language: row.language as Language,
    startLine: row.start_line,
    endLine: row.end_line,
    startColumn: row.start_column,
    endColumn: row.end_column,
    docstring: row.docstring ?? undefined,
    signature: row.signature ?? undefined,
    visibility: row.visibility as Node['visibility'],
    isExported: row.is_exported === 1,
    isAsync: row.is_async === 1,
    isStatic: row.is_static === 1,
    isAbstract: row.is_abstract === 1,
    decorators: row.decorators ? safeJsonParse(row.decorators, undefined) : undefined,
    typeParameters: row.type_parameters ? safeJsonParse(row.type_parameters, undefined) : undefined,
    returnType: row.return_type ?? undefined,
    updatedAt: row.updated_at,
  };
}

/**
 * Convert database row to Edge object
 */
function rowToEdge(row: EdgeRow): Edge {
  return {
    source: row.source,
    target: row.target,
    kind: row.kind as EdgeKind,
    metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
    line: row.line ?? undefined,
    column: row.col ?? undefined,
    provenance: row.provenance as Edge['provenance'],
  };
}

function preserveInactiveLspAudit(
  activeMetadata: Record<string, unknown>,
  inactiveMetadata: string | null,
): Record<string, unknown> {
  const previous = inactiveMetadata ? safeJsonParse(inactiveMetadata, undefined) : undefined;
  if (!previous || typeof previous !== 'object') return activeMetadata;
  const currentLsp = activeMetadata.lsp && typeof activeMetadata.lsp === 'object'
    ? activeMetadata.lsp as Record<string, unknown>
    : {};
  return {
    ...activeMetadata,
    lsp: {
      ...currentLsp,
      previousInactiveAudit: previous,
    },
  };
}

/**
 * Convert database row to FileRecord object
 */
function rowToFileRecord(row: FileRow): FileRecord {
  return {
    path: row.path,
    contentHash: row.content_hash,
    language: row.language as Language,
    size: row.size,
    modifiedAt: row.modified_at,
    indexedAt: row.indexed_at,
    nodeCount: row.node_count,
    errors: row.errors ? safeJsonParse(row.errors, undefined) : undefined,
  };
}

/**
 * Query builder for the knowledge graph database
 */
export class QueryBuilder {
  private db: SqliteDatabase;

  // Project-name tokens (go.mod / package.json / repo dir), normalized. A query
  // word matching one is dropped from path-relevance scoring — it names the
  // whole project, not a symbol, so it carries no discriminative signal (#720).
  // Set once by the CodeGraph instance; empty by default (no down-weighting).
  private projectNameTokens: Set<string> = new Set();

  // Node cache for frequently accessed nodes (LRU-style, max 1000 entries)
  private nodeCache: Map<string, Node> = new Map();
  private readonly maxCacheSize = 1000;

  // Prepared statements (lazily initialized)
  private stmts: {
    insertNode?: SqliteStatement;
    updateNode?: SqliteStatement;
    deleteNode?: SqliteStatement;
    deleteNodesByFile?: SqliteStatement;
    getNodeById?: SqliteStatement;
    getNodesByFile?: SqliteStatement;
    getNodesByKind?: SqliteStatement;
    insertEdge?: SqliteStatement;
    reactivateInactiveEdge?: SqliteStatement;
    upsertFile?: SqliteStatement;
    deleteEdgesBySource?: SqliteStatement;
    deleteEdgesByTarget?: SqliteStatement;
    getEdgesBySource?: SqliteStatement;
    getEdgesByTarget?: SqliteStatement;
    insertFile?: SqliteStatement;
    updateFile?: SqliteStatement;
    deleteFile?: SqliteStatement;
    getFileByPath?: SqliteStatement;
    getAllFiles?: SqliteStatement;
    insertUnresolved?: SqliteStatement;
    deleteUnresolvedByNode?: SqliteStatement;
    getUnresolvedByName?: SqliteStatement;
    getNodesByName?: SqliteStatement;
    getNodesByNamePrefix?: SqliteStatement;
    getNodesByQualifiedNameExact?: SqliteStatement;
    getNodesByLowerName?: SqliteStatement;
    getUnresolvedCount?: SqliteStatement;
    getUnresolvedBatch?: SqliteStatement;
    getAllFilePaths?: SqliteStatement;
    getAllNodeNames?: SqliteStatement;
    getDominantFile?: SqliteStatement;
    getTopRouteFile?: SqliteStatement;
    getRoutingManifest?: SqliteStatement;
    insertNameSegment?: SqliteStatement;
    upsertNodeVector?: SqliteStatement;
    selectEmbeddableMissing?: SqliteStatement;
    selectEmbeddedWithHash?: SqliteStatement;
    selectVectorRows?: SqliteStatement;
    deleteRemovedVectors?: SqliteStatement;
    embeddingCoverage?: SqliteStatement;
    bumpVectorsWriteVersion?: SqliteStatement;
    advanceGraphWriteVersion?: SqliteStatement;
    getReferencesToNode?: SqliteStatement;
  } = {};

  // Names whose segments were already written this session — skips re-splitting
  // and re-inserting for the same-named nodes that repeat across files ("get",
  // "render", …). Purely a write-path fast path; INSERT OR IGNORE is the
  // correctness backstop. Bounded so a pathological repo can't grow it forever.
  private segmentedNames: Set<string> = new Set();
  private static readonly MAX_SEGMENTED_NAMES = 65536;

  // Multi-row INSERT statements, cached per (statement kind × row count). The
  // bulk write path decomposes N rows into a few fixed batch sizes so each
  // size's statement is prepared once and reused — one .run() binds a whole
  // chunk instead of one row, which is where the per-call overhead lives.
  // Row order within and across chunks is the input order, so rowid assignment
  // (and therefore resolution's insertion-order disambiguation) is identical
  // to the one-row-per-run path.
  private batchStmts: Map<string, SqliteStatement> = new Map();
  private static readonly BATCH_SIZES: readonly number[] = [128, 32, 8, 1];

  /**
   * Run `rows` through a multi-row `INSERT` built as `head + (tuple,)*n`,
   * decomposed greedily into the cached batch sizes. Preserves row order.
   */
  private runBatched(kind: string, head: string, tuple: string, rows: unknown[][]): void {
    if (rows.length === 0) return;
    let i = 0;
    for (const size of QueryBuilder.BATCH_SIZES) {
      while (rows.length - i >= size) {
        const key = `${kind}:${size}`;
        let stmt = this.batchStmts.get(key);
        if (!stmt) {
          stmt = this.db.prepare(head + new Array(size).fill(tuple).join(','));
          this.batchStmts.set(key, stmt);
        }
        if (size === 1) {
          stmt.run(...rows[i]!);
        } else {
          const params: unknown[] = [];
          for (let r = 0; r < size; r++) {
            const row = rows[i + r]!;
            for (let c = 0; c < row.length; c++) params.push(row[c]);
          }
          stmt.run(...params);
        }
        i += size;
      }
    }
  }

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  /**
   * The underlying SqliteDatabase handle. The SPEC-011 catalog-store reads/writes
   * operate directly on this connection so both catalog surfaces share the
   * daemon's warm WAL connection (FR-021a).
   */
  getDb(): SqliteDatabase {
    return this.db;
  }

  /** Set the normalized project-name tokens used to down-weight non-discriminative
   * query words in path scoring (#720). Called once when the project opens. */
  setProjectNameTokens(tokens: Set<string>): void {
    this.projectNameTokens = tokens;
  }

  /** The normalized project-name tokens (#720); empty if none were derived. */
  getProjectNameTokens(): Set<string> {
    return this.projectNameTokens;
  }

  // ===========================================================================
  // Node Operations
  // ===========================================================================

  /**
   * Insert a new node
   */
  insertNode(node: Node): void {
    if (!this.stmts.insertNode) {
      this.stmts.insertNode = this.db.prepare(`
        INSERT OR REPLACE INTO nodes (
          id, kind, name, qualified_name, file_path, language,
          start_line, end_line, start_column, end_column,
          docstring, signature, visibility,
          is_exported, is_async, is_static, is_abstract,
          decorators, type_parameters, return_type, updated_at
        ) VALUES (
          @id, @kind, @name, @qualifiedName, @filePath, @language,
          @startLine, @endLine, @startColumn, @endColumn,
          @docstring, @signature, @visibility,
          @isExported, @isAsync, @isStatic, @isAbstract,
          @decorators, @typeParameters, @returnType, @updatedAt
        )
      `);
    }

    // Validate required fields to prevent SQLite bind errors
    if (!node.id || !node.kind || !node.name || !node.filePath || !node.language) {
      console.error('[CodeGraph] Skipping node with missing required fields:', {
        id: node.id,
        kind: node.kind,
        name: node.name,
        filePath: node.filePath,
        language: node.language,
      });
      return;
    }

    // INSERT OR REPLACE may overwrite a node we have cached. Drop the
    // stale entry so the next getNodeById sees the new row, not the old
    // one (matches the cache-invalidation pattern used by updateNode and
    // deleteNode below).
    this.nodeCache.delete(node.id);

    this.stmts.insertNode.run({
      id: node.id,
      kind: node.kind,
      name: node.name,
      qualifiedName: node.qualifiedName ?? node.name,
      filePath: node.filePath,
      language: node.language,
      startLine: node.startLine ?? 0,
      endLine: node.endLine ?? 0,
      startColumn: node.startColumn ?? 0,
      endColumn: node.endColumn ?? 0,
      docstring: node.docstring ?? null,
      signature: node.signature ?? null,
      visibility: node.visibility ?? null,
      isExported: node.isExported ? 1 : 0,
      isAsync: node.isAsync ? 1 : 0,
      isStatic: node.isStatic ? 1 : 0,
      isAbstract: node.isAbstract ? 1 : 0,
      decorators: node.decorators ? JSON.stringify(node.decorators) : null,
      typeParameters: node.typeParameters ? JSON.stringify(node.typeParameters) : null,
      returnType: node.returnType ?? null,
      updatedAt: node.updatedAt ?? Date.now(),
    });

    // Segment vocabulary rides the same write path (and transaction) so it can
    // never drift ahead of the nodes it describes. Deletes intentionally leave
    // orphans behind — vocab rows are proposals re-verified against nodes
    // before use, and a full index clears the table at its start. File nodes
    // are excluded: a file's basename duplicates the symbols inside it
    // (state-machine.ts / OrderStateMachine), which double-counts every
    // concept and defeats the singleton-vs-cluster rarity statistics. Import
    // nodes are excluded too (#1144): they're named after module specifiers
    // ("external-unindexed-pkg", "./utils/helpers"), not symbols — an
    // import-only name can never be surfaced (getSegmentMatches requires a
    // real definition), so its rows would only inflate the rarity statistics.
    if (this.isSegmentableKind(node.kind)) this.insertNameSegments(node.name);
  }

  /** Which node kinds contribute their name to the segment vocabulary — the
   *  single gate shared by insertNode, updateNode, and the rebuild page query
   *  (getDistinctNodeNames), so the write paths can't drift apart. */
  private isSegmentableKind(kind: string): boolean {
    return kind !== 'file' && kind !== 'import';
  }

  /** Write `name`'s segments into name_segment_vocab (idempotent). */
  private insertNameSegments(name: string): void {
    const rows: unknown[][] = [];
    this.collectNameSegmentRows(name, rows);
    this.runBatched(
      'insertNameSegments',
      'INSERT OR IGNORE INTO name_segment_vocab (segment, name) VALUES ',
      '(?,?)',
      rows
    );
  }

  /**
   * Insert multiple nodes in a transaction
   */
  insertNodes(nodes: Node[]): void {
    this.db.transaction(() => {
      // Bulk path: same semantics as insertNode() per row (validation, cache
      // invalidation, segment vocab), but bound as multi-row INSERTs — the
      // per-.run() call overhead dominates the store phase on full indexes.
      const rows: unknown[][] = [];
      const segmentRows: unknown[][] = [];
      for (const node of nodes) {
        if (!node.id || !node.kind || !node.name || !node.filePath || !node.language) {
          console.error('[CodeGraph] Skipping node with missing required fields:', {
            id: node.id,
            kind: node.kind,
            name: node.name,
            filePath: node.filePath,
            language: node.language,
          });
          continue;
        }
        this.nodeCache.delete(node.id);
        rows.push([
          node.id,
          node.kind,
          node.name,
          node.qualifiedName ?? node.name,
          node.filePath,
          node.language,
          node.startLine ?? 0,
          node.endLine ?? 0,
          node.startColumn ?? 0,
          node.endColumn ?? 0,
          node.docstring ?? null,
          node.signature ?? null,
          node.visibility ?? null,
          node.isExported ? 1 : 0,
          node.isAsync ? 1 : 0,
          node.isStatic ? 1 : 0,
          node.isAbstract ? 1 : 0,
          node.decorators ? JSON.stringify(node.decorators) : null,
          node.typeParameters ? JSON.stringify(node.typeParameters) : null,
          node.returnType ?? null,
          node.updatedAt ?? Date.now(),
        ]);
        if (this.isSegmentableKind(node.kind)) this.collectNameSegmentRows(node.name, segmentRows);
      }
      this.runBatched(
        'insertNodes',
        `INSERT OR REPLACE INTO nodes (
          id, kind, name, qualified_name, file_path, language,
          start_line, end_line, start_column, end_column,
          docstring, signature, visibility,
          is_exported, is_async, is_static, is_abstract,
          decorators, type_parameters, return_type, updated_at
        ) VALUES `,
        '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        rows
      );
      this.runBatched(
        'insertNameSegments',
        'INSERT OR IGNORE INTO name_segment_vocab (segment, name) VALUES ',
        '(?,?)',
        segmentRows
      );
    })();
  }

  /**
   * Store one file's whole extraction bundle — nodes, edges, unresolved refs,
   * and the file record — in a SINGLE transaction. The bulk-index path calls
   * this once per file instead of opening one transaction per table (#1015
   * file-order commit discipline is unchanged: callers still invoke it in file
   * order, and row order within is input order).
   *
   * Edges MUST already be endpoint-filtered by the caller (the store path
   * filters to the file's own inserted node ids), so the per-file existence
   * SELECT that insertEdges() pays is skipped here.
   */
  storeFileBundle(bundle: {
    nodes: Node[];
    edges: Edge[];
    refs: UnresolvedReference[];
    file: FileRecord;
  }): void {
    this.db.transaction(() => {
      this.insertNodes(bundle.nodes);
      if (bundle.edges.length > 0) {
        const rows: unknown[][] = [];
        for (const edge of bundle.edges) {
          rows.push([
            edge.source,
            edge.target,
            edge.kind,
            edge.metadata ? JSON.stringify(edge.metadata) : null,
            edge.line ?? null,
            edge.column ?? null,
            edge.provenance ?? null,
          ]);
        }
        this.runBatched(
          'insertEdges',
          'INSERT OR IGNORE INTO edges (source, target, kind, metadata, line, col, provenance) VALUES ',
          '(?,?,?,?,?,?,?)',
          rows
        );
      }
      if (bundle.refs.length > 0) this.insertUnresolvedRefsBatch(bundle.refs);
      this.upsertFile(bundle.file);
    })();
  }

  /**
   * Collect (segment, name) rows for a name, honouring the same session-dedupe
   * semantics as insertNameSegments(). Shared by the bulk write paths.
   */
  private collectNameSegmentRows(name: string, out: unknown[][]): void {
    if (this.segmentedNames.has(name)) return;
    if (this.segmentedNames.size >= QueryBuilder.MAX_SEGMENTED_NAMES) this.segmentedNames.clear();
    this.segmentedNames.add(name);
    for (const segment of splitIdentifierSegments(name)) out.push([segment, name]);
  }

  /**
   * Update an existing node
   */
  updateNode(node: Node): void {
    if (!this.stmts.updateNode) {
      this.stmts.updateNode = this.db.prepare(`
        UPDATE nodes SET
          kind = @kind,
          name = @name,
          qualified_name = @qualifiedName,
          file_path = @filePath,
          language = @language,
          start_line = @startLine,
          end_line = @endLine,
          start_column = @startColumn,
          end_column = @endColumn,
          docstring = @docstring,
          signature = @signature,
          visibility = @visibility,
          is_exported = @isExported,
          is_async = @isAsync,
          is_static = @isStatic,
          is_abstract = @isAbstract,
          decorators = @decorators,
          type_parameters = @typeParameters,
          return_type = @returnType,
          updated_at = @updatedAt
        WHERE id = @id
      `);
    }

    // Invalidate cache before update
    this.nodeCache.delete(node.id);

    // Validate required fields
    if (!node.id || !node.kind || !node.name || !node.filePath || !node.language) {
      console.error('[CodeGraph] Skipping node update with missing required fields:', node.id);
      return;
    }

    this.stmts.updateNode.run({
      id: node.id,
      kind: node.kind,
      name: node.name,
      qualifiedName: node.qualifiedName ?? node.name,
      filePath: node.filePath,
      language: node.language,
      startLine: node.startLine ?? 0,
      endLine: node.endLine ?? 0,
      startColumn: node.startColumn ?? 0,
      endColumn: node.endColumn ?? 0,
      docstring: node.docstring ?? null,
      signature: node.signature ?? null,
      visibility: node.visibility ?? null,
      isExported: node.isExported ? 1 : 0,
      isAsync: node.isAsync ? 1 : 0,
      isStatic: node.isStatic ? 1 : 0,
      isAbstract: node.isAbstract ? 1 : 0,
      decorators: node.decorators ? JSON.stringify(node.decorators) : null,
      typeParameters: node.typeParameters ? JSON.stringify(node.typeParameters) : null,
      returnType: node.returnType ?? null,
      updatedAt: node.updatedAt ?? Date.now(),
    });

    // updateNode is a second real write path to `nodes` — framework
    // post-extract passes rewrite names through it (NestJS route prefixing),
    // and a renamed node's new name must reach the segment vocabulary just
    // like an inserted one's (#1141). Without this the rename left the new
    // name permanently unsearchable: the old name's rows became honest-gate
    // orphans and the only backfill is gated on the vocab being EMPTY.
    // insertNameSegments is idempotent (in-memory set + INSERT OR IGNORE),
    // so no name-changed check is needed.
    if (this.isSegmentableKind(node.kind)) this.insertNameSegments(node.name);
  }

  /**
   * Delete a node by ID
   */
  deleteNode(id: string): void {
    if (!this.stmts.deleteNode) {
      this.stmts.deleteNode = this.db.prepare('DELETE FROM nodes WHERE id = ?');
    }
    // Invalidate cache
    this.nodeCache.delete(id);
    this.stmts.deleteNode.run(id);
  }

  /**
   * Delete all nodes for a file
   */
  deleteNodesByFile(filePath: string): void {
    if (!this.stmts.deleteNodesByFile) {
      this.stmts.deleteNodesByFile = this.db.prepare('DELETE FROM nodes WHERE file_path = ?');
    }
    // Invalidate cache for nodes in this file
    for (const [id, node] of this.nodeCache) {
      if (node.filePath === filePath) {
        this.nodeCache.delete(id);
      }
    }
    this.stmts.deleteNodesByFile.run(filePath);
  }

  // ===========================================================================
  // Name-segment vocabulary (prompt-hook graph-derived gate)
  // ===========================================================================

  /** Wipe the segment vocabulary. A full index calls this at its start; the
   *  node write path repopulates it as files (re-)index, so the end state is
   *  exactly the current names with no orphan rows. */
  clearNameSegmentVocab(): void {
    this.db.exec('DELETE FROM name_segment_vocab');
    this.segmentedNames.clear();
  }

  /** True when the vocab has no rows — an index built before the table existed.
   *  `sync` uses this to heal such databases (see rebuildNameSegmentVocabFrom). */
  isNameSegmentVocabEmpty(): boolean {
    const row = this.db.prepare('SELECT 1 FROM name_segment_vocab LIMIT 1').get();
    return row === undefined;
  }

  /** One page of distinct segmentable node names, for batched vocab rebuilds
   *  (file basenames and import specifiers are excluded from the vocab — see
   *  insertNode). */
  getDistinctNodeNames(limit: number, offset: number): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT name FROM nodes WHERE kind NOT IN ('file', 'import') ORDER BY name LIMIT ? OFFSET ?")
      .all(limit, offset) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  /** Insert segments for a batch of names in one transaction (vocab heal path). */
  insertNameSegmentsBatch(names: string[]): void {
    this.db.transaction(() => {
      const rows: unknown[][] = [];
      for (const name of names) this.collectNameSegmentRows(name, rows);
      this.runBatched(
        'insertNameSegments',
        'INSERT OR IGNORE INTO name_segment_vocab (segment, name) VALUES ',
        '(?,?)',
        rows
      );
    })();
  }

  /**
   * Names whose segments cover at least `minWords` distinct PROMPT WORDS —
   * the co-occurrence probe behind the prompt hook's medium tier: the words
   * "state" and "machine" both being segments of `OrderStateMachine` is strong
   * evidence the prompt names that symbol in prose. Ordered by coverage.
   *
   * Takes (segment variant → original word) pairs and folds variants back to
   * their word INSIDE the SQL: a name matching both `service` and `services`
   * counts ONE word, not two. Counting raw variants let plural-variant pairs
   * of a single word tie with genuine two-word matches and — because ORDER
   * BY/LIMIT run here, before any JS-side re-check — crowd a real match past
   * the LIMIT on vocab-heavy repos (#1146).
   */
  getSegmentCoOccurrence(
    variants: Array<{ segment: string; word: string }>,
    minWords: number,
    limit: number,
  ): Array<{ name: string; matches: number }> {
    if (variants.length === 0) return [];
    const placeholders = variants.map(() => '?').join(', ');
    const whens = variants.map(() => 'WHEN ? THEN ?').join(' ');
    const rows = this.db
      .prepare(
        `SELECT name, COUNT(DISTINCT CASE segment ${whens} END) AS matches
         FROM name_segment_vocab
         WHERE segment IN (${placeholders})
         GROUP BY name
         HAVING matches >= ?
         ORDER BY matches DESC, length(name) ASC
         LIMIT ?`,
      )
      .all(
        ...variants.flatMap((v) => [v.segment, v.word]),
        ...variants.map((v) => v.segment),
        minWords,
        limit,
      ) as Array<{ name: string; matches: number }>;
    return rows;
  }

  /** How many distinct names each segment appears in — the rarity signal that
   *  separates a discriminative word ("checkout") from a ubiquitous one ("state"). */
  getSegmentNameCounts(segments: string[]): Map<string, number> {
    if (segments.length === 0) return new Map();
    const placeholders = segments.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT segment, COUNT(*) AS n FROM name_segment_vocab
         WHERE segment IN (${placeholders}) GROUP BY segment`,
      )
      .all(...segments) as Array<{ segment: string; n: number }>;
    return new Map(rows.map((r) => [r.segment, r.n]));
  }

  /** Names containing the given segment (rare-single-word tier). */
  getNamesForSegment(segment: string, limit: number): string[] {
    const rows = this.db
      .prepare('SELECT name FROM name_segment_vocab WHERE segment = ? ORDER BY length(name) ASC LIMIT ?')
      .all(segment, limit) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  /**
   * Get a node by ID
   */
  getNodeById(id: string): Node | null {
    // Check cache first
    if (this.nodeCache.has(id)) {
      const cached = this.nodeCache.get(id)!;
      // Move to end to implement LRU (delete and re-add)
      this.nodeCache.delete(id);
      this.nodeCache.set(id, cached);
      return cached;
    }

    if (!this.stmts.getNodeById) {
      this.stmts.getNodeById = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
    }
    const row = this.stmts.getNodeById.get(id) as NodeRow | undefined;
    if (!row) {
      return null;
    }

    const node = rowToNode(row);
    this.cacheNode(node);
    return node;
  }

  /**
   * Batch lookup: fetch many nodes by ID in a single SQL round-trip.
   *
   * Replaces the N+1 pattern in graph traversal where every edge would
   * trigger its own `getNodeById` call. For a function with 50 callers
   * this collapses 50 point reads into one IN-list query (~10-50x
   * faster end-to-end).
   *
   * Returns a Map keyed by id so callers can preserve their own ordering
   * (typically the order edges were returned from the graph). Missing IDs
   * are simply absent from the map.
   *
   * Cache-aware: ids already in the LRU cache are served from memory and
   * the SQL query only touches the misses.
   */
  getNodesByIds(ids: readonly string[]): Map<string, Node> {
    const out = new Map<string, Node>();
    if (ids.length === 0) return out;

    // Serve cache hits first; build the miss list for SQL.
    const misses: string[] = [];
    for (const id of ids) {
      const cached = this.nodeCache.get(id);
      if (cached !== undefined) {
        // LRU touch
        this.nodeCache.delete(id);
        this.nodeCache.set(id, cached);
        out.set(id, cached);
      } else {
        misses.push(id);
      }
    }
    if (misses.length === 0) return out;

    // Chunk under SQLite's parameter limit (default 999, raised to 32766
    // in better-sqlite3 builds — chunk at 500 for safety across both
    // backends and to keep the query plan simple).
    for (let i = 0; i < misses.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = misses.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
        .all(...chunk) as NodeRow[];
      for (const row of rows) {
        const node = rowToNode(row);
        out.set(node.id, node);
        this.cacheNode(node);
      }
    }
    return out;
  }

  private getExistingNodeIds(ids: readonly string[]): Set<string> {
    const out = new Set<string>();
    if (ids.length === 0) return out;

    const uniqueIds = [...new Set(ids)];
    for (let i = 0; i < uniqueIds.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT id FROM nodes WHERE id IN (${placeholders})`)
        .all(...chunk) as { id: string }[];
      for (const row of rows) {
        out.add(row.id);
      }
    }

    return out;
  }

  /**
   * Add a node to the cache, evicting oldest if needed
   */
  private cacheNode(node: Node): void {
    if (this.nodeCache.size >= this.maxCacheSize) {
      // Evict oldest (first) entry
      const firstKey = this.nodeCache.keys().next().value;
      if (firstKey) {
        this.nodeCache.delete(firstKey);
      }
    }
    this.nodeCache.set(node.id, node);
  }

  /**
   * Clear the node cache
   */
  clearCache(): void {
    this.nodeCache.clear();
  }

  /**
   * Get all nodes in a file
   */
  getNodesByFile(filePath: string): Node[] {
    if (!this.stmts.getNodesByFile) {
      this.stmts.getNodesByFile = this.db.prepare(
        'SELECT * FROM nodes WHERE file_path = ? ORDER BY start_line'
      );
    }
    const rows = this.stmts.getNodesByFile.all(filePath) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * Find the file that holds the densest concentration of the project's
   * internal call graph — the "core" file. Used by context-builder to
   * boost ranking of symbols in that file's directory (so e.g. sinatra
   * queries surface `lib/sinatra/base.rb`'s `route!` instead of
   * `sinatra-contrib/lib/sinatra/multi_route.rb`'s `route` extension).
   *
   * Returns null if no file has a meaningful concentration (e.g. spread
   * evenly across many files, or empty index).
   *
   * "Internal" = source and target are in the same file. Cross-file
   * edges aren't useful here — they don't tell us which file is the
   * functional center.
   *
   * Excludes test/spec files from candidacy via path-pattern. The agent's
   * typical question is "how does X work", not "how is X tested", so
   * boosting a test file's directory would be a misfire.
   */
  getDominantFile(): { filePath: string; edgeCount: number; nextEdgeCount: number } | null {
    if (!this.stmts.getDominantFile) {
      // Pull top 20 candidates; we then filter out test/generated files
      // in code (regex-grade matching that SQL LIKE can't express). The
      // generated-file filter is critical — without it, etcd's
      // `api/etcdserverpb/rpc.pb.go` (1916 in-file edges, generated
      // protobuf stub) outranks the real `server/etcdserver/server.go`
      // (470 edges) by 4×, and the boost would push the agent toward
      // generated code.
      this.stmts.getDominantFile = this.db.prepare(`
        SELECT n.file_path AS file_path, COUNT(*) AS edge_count
        FROM edges e
        JOIN nodes n ON e.source = n.id
        JOIN nodes m ON e.target = m.id
        WHERE n.file_path = m.file_path
          AND ${activeEdgePredicate('e')}
        GROUP BY n.file_path
        ORDER BY edge_count DESC
        LIMIT 20
      `);
    }
    const rows = this.stmts.getDominantFile.all() as Array<{ file_path: string; edge_count: number }>;
    const filtered = rows.filter(r => !isLowValueFile(r.file_path));
    if (filtered.length === 0 || filtered[0]!.edge_count < 20) return null;
    return {
      filePath: filtered[0]!.file_path,
      edgeCount: filtered[0]!.edge_count,
      nextEdgeCount: filtered[1]?.edge_count ?? 0,
    };
  }

  /**
   * Find the file that holds the densest concentration of the project's
   * `route` nodes (framework-emitted: Express/Gin/Flask/Rails/Drupal/etc.).
   * Used by handleContext on small repos to inline the project's routing
   * config when the agent's query is about request flow — eliminating the
   * "Glob + Read routes.rb" pattern that beats codegraph on tiny realworld
   * template repos.
   *
   * Excludes test/generated files from candidacy. Returns null if there
   * are fewer than 3 non-test routes total, or if no file holds at least
   * 30% of them (diffuse routing → no single answer file).
   */
  getTopRouteFile(): { filePath: string; routeCount: number; totalRoutes: number } | null {
    if (!this.stmts.getTopRouteFile) {
      this.stmts.getTopRouteFile = this.db.prepare(`
        SELECT file_path, COUNT(*) AS cnt
        FROM nodes
        WHERE kind = 'route'
        GROUP BY file_path
        ORDER BY cnt DESC
        LIMIT 20
      `);
    }
    const rows = this.stmts.getTopRouteFile.all() as Array<{ file_path: string; cnt: number }>;
    const filtered = rows.filter(r => !isLowValueFile(r.file_path));
    if (filtered.length === 0) return null;
    const totalRoutes = filtered.reduce((sum, r) => sum + r.cnt, 0);
    const top = filtered[0]!;
    if (totalRoutes < 3 || top.cnt < 3) return null;
    if (top.cnt / totalRoutes < 0.30) return null;
    return { filePath: top.file_path, routeCount: top.cnt, totalRoutes };
  }

  /**
   * Build a URL → handler manifest from the index. Each route node's
   * `references` edge points at the function/method that handles the
   * request. We join them in one pass; the agent gets the canonical
   * routing answer ("POST /users/login → AuthController#login") without
   * having to parse the framework's route DSL itself.
   *
   * Also returns the file with the most handler endpoints — used as the
   * "top handler file" to inline source for, so the agent has both the
   * mapping AND the handler implementations.
   */
  getRoutingManifest(limit: number = 40): {
    entries: Array<{ url: string; handler: string; handlerFile: string; handlerLine: number; handlerKind: string }>;
    topHandlerFile: string | null;
    topHandlerFileCount: number;
    totalRoutes: number;
  } | null {
    if (!this.stmts.getRoutingManifest) {
      // Edge kind varies across framework resolvers: Spring/Rails/
      // Laravel/Drupal emit `references`, Express emits `calls`. Accept
      // both — the semantic is the same (route → its handler).
      this.stmts.getRoutingManifest = this.db.prepare(`
        SELECT
          r.name AS url,
          h.name AS handler,
          h.file_path AS handler_file,
          h.start_line AS handler_line,
          h.kind AS handler_kind
        FROM nodes r
        JOIN edges e ON e.source = r.id
        JOIN nodes h ON e.target = h.id
        WHERE r.kind = 'route'
          AND e.kind IN ('references', 'calls')
          AND ${activeEdgePredicate('e')}
          AND h.kind IN ('function', 'method', 'class')
        ORDER BY r.file_path, r.start_line
        LIMIT ?
      `);
    }
    const rows = this.stmts.getRoutingManifest.all(limit) as Array<{
      url: string; handler: string; handler_file: string; handler_line: number; handler_kind: string;
    }>;
    // Drop test/generated handlers — same hygiene as elsewhere.
    const filtered = rows.filter(r => !isLowValueFile(r.handler_file));
    if (filtered.length < 3) return null;
    // Identify the file holding the most handlers (the "primary handler file").
    const fileCounts = new Map<string, number>();
    for (const r of filtered) {
      fileCounts.set(r.handler_file, (fileCounts.get(r.handler_file) ?? 0) + 1);
    }
    let topHandlerFile: string | null = null;
    let topHandlerFileCount = 0;
    for (const [file, count] of fileCounts) {
      if (count > topHandlerFileCount) {
        topHandlerFile = file;
        topHandlerFileCount = count;
      }
    }
    return {
      entries: filtered.map(r => ({
        url: r.url,
        handler: r.handler,
        handlerFile: r.handler_file,
        handlerLine: r.handler_line,
        handlerKind: r.handler_kind,
      })),
      topHandlerFile,
      topHandlerFileCount,
      totalRoutes: filtered.length,
    };
  }

  /**
   * Get all nodes of a specific kind
   */
  getNodesByKind(kind: NodeKind): Node[] {
    if (!this.stmts.getNodesByKind) {
      this.stmts.getNodesByKind = this.db.prepare('SELECT * FROM nodes WHERE kind = ?');
    }
    const rows = this.stmts.getNodesByKind.all(kind) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * Stream every node of a kind one at a time (lazy) instead of materializing
   * them all like {@link getNodesByKind}. For unbounded kinds (`function`,
   * `method`) on a symbol-dense project the full array is gigabytes; the
   * dynamic-edge synthesizers only scan-and-filter, so they iterate to keep
   * memory O(1) in the node count rather than O(nodes) (#610).
   */
  *iterateNodesByKind(kind: NodeKind): IterableIterator<Node> {
    // Fresh statement per call (not a cached one): an iterator holds an open
    // cursor, so a shared statement would conflict across overlapping scans.
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE kind = ?');
    for (const row of stmt.iterate(kind)) {
      yield rowToNode(row as NodeRow);
    }
  }

  /**
   * Get all nodes in the database
   */
  getAllNodes(): Node[] {
    const rows = this.db.prepare('SELECT * FROM nodes').all() as NodeRow[];
    return rows.map(rowToNode);
  }

  /** Bounded deterministic candidates for the foundational LSP workspace read. */
  getBoundedLspWorkspaceNodes(limit: number): Node[] {
    const rows = this.db.prepare(`
      SELECT * FROM nodes
      ORDER BY qualified_name COLLATE BINARY,
        file_path COLLATE BINARY,
        start_line,
        start_column,
        end_line,
        end_column,
        id COLLATE BINARY
      LIMIT ?
    `).all(Math.max(0, Math.trunc(limit))) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * Stream nodes of one language whose `decorators` JSON array contains
   * `decorator`. The LIKE on the JSON text is a cheap index-free pre-filter
   * (a decorator name can appear as a substring of another), so callers must
   * still exact-check `node.decorators.includes(decorator)`. Exists so the
   * kotlin expect/actual synthesizer never materializes the whole node table
   * the way `getAllNodes().filter(...)` did — that array alone OOM'd Node's
   * default heap on a 2M-node graph (#1212).
   */
  *iterateNodesByLanguageWithDecorator(language: Language, decorator: string): IterableIterator<Node> {
    // Fresh statement per call — an iterator holds an open cursor (see
    // iterateNodesByKind).
    const stmt = this.db.prepare(
      "SELECT * FROM nodes WHERE language = ? AND decorators LIKE '%' || ? || '%'"
    );
    for (const row of stmt.iterate(language, `"${decorator}"`)) {
      yield rowToNode(row as NodeRow);
    }
  }

  /**
   * Distinct languages present in the files table. One indexed aggregate —
   * lets the dynamic-edge synthesizers skip passes for languages the project
   * doesn't contain at all (a Kotlin pass has no work on a pure-C repo), so
   * their cost is zero rather than a full-graph scan that finds nothing (#1212).
   */
  getDistinctFileLanguages(): Set<string> {
    const rows = this.db.prepare('SELECT DISTINCT language FROM files').all() as Array<{ language: string }>;
    return new Set(rows.map((r) => r.language));
  }

  /**
   * Get nodes by exact name match (uses idx_nodes_name index)
   */
  getNodesByName(name: string): Node[] {
    if (!this.stmts.getNodesByName) {
      this.stmts.getNodesByName = this.db.prepare('SELECT * FROM nodes WHERE name = ?');
    }
    const rows = this.stmts.getNodesByName.all(name) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * Nodes whose name starts with `prefix`, by index range scan (a LIKE would
   * skip idx_nodes_name under SQLite's default case-insensitive LIKE).
   */
  getNodesByNamePrefix(prefix: string, limit = 20): Node[] {
    if (!this.stmts.getNodesByNamePrefix) {
      this.stmts.getNodesByNamePrefix = this.db.prepare(
        'SELECT * FROM nodes WHERE name >= ? AND name < ? ORDER BY name LIMIT ?'
      );
    }
    const rows = this.stmts.getNodesByNamePrefix.all(prefix, prefix + '￿', limit) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * Nodes named `name` scoped to a set of file paths — the FR-018 post-check's
   * "no node named the old name remains in the touched files" probe (SPEC-010).
   * File-scoped counterpart of {@link getNodesByName}; chunked under SQLite's
   * parameter limit exactly like {@link getUnresolvedReferencesByFiles} so a
   * post-check over a large touched-file set never trips "too many SQL
   * variables". The placeholder count varies per chunk, so the statement is
   * prepared fresh (not cached) — matching every other dynamic IN-list here.
   */
  getNodesByNameInFiles(name: string, filePaths: string[]): Node[] {
    if (filePaths.length === 0) return [];

    const rows: NodeRow[] = [];
    for (let i = 0; i < filePaths.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const chunkRows = this.db
        .prepare(`SELECT * FROM nodes WHERE name = ? AND file_path IN (${placeholders})`)
        .all(name, ...chunk) as NodeRow[];
      rows.push(...chunkRows);
    }
    return rows.map(rowToNode);
  }

  /**
   * Get nodes by exact qualified name match (uses idx_nodes_qualified_name index)
   */
  getNodesByQualifiedNameExact(qualifiedName: string): Node[] {
    if (!this.stmts.getNodesByQualifiedNameExact) {
      this.stmts.getNodesByQualifiedNameExact = this.db.prepare(
        'SELECT * FROM nodes WHERE qualified_name = ?'
      );
    }
    const rows = this.stmts.getNodesByQualifiedNameExact.all(qualifiedName) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * Get nodes by lowercase name match (uses idx_nodes_lower_name expression index)
   */
  getNodesByLowerName(lowerName: string): Node[] {
    if (!this.stmts.getNodesByLowerName) {
      this.stmts.getNodesByLowerName = this.db.prepare(
        'SELECT * FROM nodes WHERE lower(name) = ?'
      );
    }
    const rows = this.stmts.getNodesByLowerName.all(lowerName) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * Search nodes by name using FTS with fallback to LIKE for better matching
   *
   * Search strategy:
   * 1. Try FTS5 prefix match (query*) for word-start matching
   * 2. If no results, try LIKE for substring matching (e.g., "signIn" finds "signInWithGoogle")
   * 3. Score results based on match quality
   */
  searchNodes(query: string, options: SearchOptions = {}): SearchResult[] {
    const { limit = 100, offset = 0 } = options;

    // Parse field-qualified bits out of the raw query (kind:, lang:,
    // path:, name:). Anything not recognised stays in `text` and goes
    // to FTS unchanged. Filters compose with the SearchOptions arg —
    // both are applied (intersection-style).
    const parsed = parseQuery(query);
    const mergedKinds =
      parsed.kinds.length > 0
        ? Array.from(new Set([...(options.kinds ?? []), ...parsed.kinds]))
        : options.kinds;
    const mergedLanguages =
      parsed.languages.length > 0
        ? Array.from(new Set([...(options.languages ?? []), ...parsed.languages]))
        : options.languages;
    const pathFilters = parsed.pathFilters;
    const nameFilters = parsed.nameFilters;
    // The text portion drives FTS/LIKE; if all the user typed was
    // filters (`kind:function`), we still need *some* candidate set,
    // so synthesise an empty-text path that returns everything matching
    // the filters.
    const text = parsed.text;
    const kinds = mergedKinds;
    const languages = mergedLanguages;

    // First try FTS5 with prefix matching
    let results = text
      ? this.searchNodesFTS(text, { kinds, languages, limit, offset })
      // Over-fetch by 5× when running filter-only (no text). The
      // post-scoring path: + name: filters can be very selective, so
      // a smaller multiplier risks returning fewer than `limit`
      // results despite the DB having plenty of matches.
      : this.searchAllByFilters({ kinds, languages, limit: limit * 5 });

    // If no FTS results, try LIKE-based substring search
    if (results.length === 0 && text.length >= 2) {
      results = this.searchNodesLike(text, { kinds, languages, limit, offset });
    }

    // Final fuzzy fallback: scan all known names and keep those within
    // a tight Levenshtein distance. Only fires when both FTS and LIKE
    // returned nothing AND there's a text portion long enough to be
    // worth fuzzing (1-char queries would match too much).
    if (results.length === 0 && text.length >= 3) {
      results = this.searchNodesFuzzy(text, { kinds, languages, limit });
    }

    // Supplement: ensure exact name matches are always candidates.
    // BM25 can bury short exact-match names (e.g. "getBean") under hundreds of
    // compound names (e.g. "getBeanDescriptor") in large codebases,
    // pushing them past the FTS fetch limit before post-hoc scoring can help.
    // Use the max BM25 score as the base so the nameMatchBonus (exact=30 vs
    // prefix=20) actually differentiates them after rescoring.
    if (results.length > 0 && query) {
      const existingIds = new Set(results.map(r => r.node.id));
      const maxFtsScore = Math.max(...results.map(r => r.score));
      const terms = query.split(/\s+/).filter(t => t.length >= 2);
      for (const term of terms) {
        let sql = 'SELECT * FROM nodes WHERE name = ? COLLATE NOCASE';
        const params: (string | number)[] = [term];
        if (kinds && kinds.length > 0) {
          sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
          params.push(...kinds);
        }
        if (languages && languages.length > 0) {
          sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
          params.push(...languages);
        }
        sql += ' LIMIT 20';
        const rows = this.db.prepare(sql).all(...params) as NodeRow[];
        for (const row of rows) {
          if (!existingIds.has(row.id)) {
            results.push({ node: rowToNode(row), score: maxFtsScore });
            existingIds.add(row.id);
          }
        }
      }
    }

    // Apply multi-signal scoring
    if (results.length > 0 && (text || query)) {
      const scoringQuery = text || query;
      results = results.map(r => ({
        ...r,
        score: r.score
          + kindBonus(r.node.kind)
          + scorePathRelevance(r.node.filePath, scoringQuery, this.projectNameTokens)
          + nameMatchBonus(r.node.name, scoringQuery),
      }));
      results.sort((a, b) => b.score - a.score);
      // Trim to requested limit after rescoring
      if (results.length > limit) {
        results = results.slice(0, limit);
      }
    }

    // Apply path: + name: filters AFTER scoring. Scoring already uses
    // path/name as a soft signal; the explicit filters here are a hard
    // gate. Done last so the FTS limit fetched plenty of candidates to
    // narrow from.
    if (pathFilters.length > 0) {
      const lowered = pathFilters.map((p) => p.toLowerCase());
      results = results.filter((r) => {
        const fp = r.node.filePath.toLowerCase();
        return lowered.some((p) => fp.includes(p));
      });
    }
    if (nameFilters.length > 0) {
      const lowered = nameFilters.map((n) => n.toLowerCase());
      results = results.filter((r) => {
        const nm = r.node.name.toLowerCase();
        return lowered.some((n) => nm.includes(n));
      });
    }

    return results;
  }

  /**
   * Match-everything path used when the user supplied only field
   * filters (`kind:function lang:typescript`) with no text. Returns
   * candidates ordered by name; the caller's filter pass narrows to
   * what was asked for.
   */
  private searchAllByFilters(options: {
    kinds?: NodeKind[];
    languages?: Language[];
    limit: number;
  }): SearchResult[] {
    const { kinds, languages, limit } = options;
    let sql = 'SELECT * FROM nodes WHERE 1=1';
    const params: (string | number)[] = [];
    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
      params.push(...kinds);
    }
    if (languages && languages.length > 0) {
      sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
      params.push(...languages);
    }
    sql += ' ORDER BY name LIMIT ?';
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as NodeRow[];
    return rows.map((row) => ({ node: rowToNode(row), score: 1 }));
  }

  /**
   * Fuzzy fallback: when zero FTS/LIKE hits, try an edit-distance
   * sweep over the distinct symbol-name set. Caps `maxDist` at 2 so
   * `getUssr` finds `getUser` but `process` doesn't match `prosody`.
   * Bounded edit distance keeps each comparison cheap; the per-query
   * scan is O(distinct-name-count) which is far smaller than total
   * node count on any real codebase.
   */
  private searchNodesFuzzy(
    text: string,
    options: { kinds?: NodeKind[]; languages?: Language[]; limit: number }
  ): SearchResult[] {
    const { kinds, languages, limit } = options;
    const lowered = text.toLowerCase();
    const maxDist = lowered.length <= 4 ? 1 : 2;

    // Pull the distinct name list once. The set is cached on QueryBuilder
    // by getAllNodeNames(); even on a 200k-node project the distinct
    // name set is typically O(10k) because most names repeat. The
    // candidate-cap below bounds memory regardless.
    const allNames = this.getAllNodeNames();
    const candidates: Array<{ name: string; dist: number }> = [];
    for (const name of allNames) {
      const dist = boundedEditDistance(name.toLowerCase(), lowered, maxDist);
      if (dist <= maxDist) candidates.push({ name, dist });
    }
    candidates.sort((a, b) => a.dist - b.dist);

    // Cap the per-name follow-up queries. Each survivor triggers a
    // separate `SELECT * FROM nodes WHERE name = ?`; without this cap
    // a project with many similar names (`getUser1`, `getUser2`...)
    // could fan out far beyond `limit` queries before the inner-loop
    // limit kicks in.
    const FUZZY_FOLLOWUP_CAP = Math.max(limit * 2, 50);
    const cappedCandidates = candidates.slice(0, FUZZY_FOLLOWUP_CAP);

    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const c of cappedCandidates) {
      if (results.length >= limit) break;
      let sql = 'SELECT * FROM nodes WHERE name = ?';
      const params: (string | number)[] = [c.name];
      if (kinds && kinds.length > 0) {
        sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
        params.push(...kinds);
      }
      if (languages && languages.length > 0) {
        sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
        params.push(...languages);
      }
      sql += ' LIMIT 5';
      const rows = this.db.prepare(sql).all(...params) as NodeRow[];
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        // Lower the score for each edit step away from the query so
        // exact-match fallbacks (dist 0) outrank dist-2 typos.
        results.push({ node: rowToNode(row), score: 1 / (1 + c.dist) });
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  /**
   * FTS5 search with prefix matching
   */
  private searchNodesFTS(query: string, options: SearchOptions): SearchResult[] {
    const { kinds, languages, limit = 100, offset = 0 } = options;

    // Add prefix wildcard for better matching (e.g., "auth" matches "AuthService", "authenticate")
    // Escape special FTS5 characters and add prefix wildcard.
    //
    // `::` is a qualifier separator in Rust/C++/Ruby, not a token char,
    // so treat it as whitespace before the strip step. Otherwise queries
    // like `stage_apply::run` collapse to `stage_applyrun` (the colons
    // are stripped without splitting) and find nothing. See #173.
    const ftsQuery = query
      .replace(/::/g, ' ') // Rust/C++/Ruby qualifier separator
      .replace(/['"*():^]/g, '') // Remove FTS5 special chars
      .split(/\s+/)
      .filter(term => term.length > 0)
      // Strip FTS5 boolean operators to prevent query manipulation
      .filter(term => !/^(AND|OR|NOT|NEAR)$/i.test(term))
      .map(term => `"${term}"*`) // Prefix match each term
      .join(' OR ');

    if (!ftsQuery) {
      return [];
    }

    // BM25 column weights: id=0, name=20, qualified_name=5, docstring=1, signature=2
    // Heavy name weight ensures exact/prefix name matches rank above incidental
    // mentions in long docstrings or qualified names of nested symbols.
    // Fetch 5x requested limit so post-hoc rescoring (kindBonus, pathRelevance,
    // nameMatchBonus) can promote results that BM25 alone undervalues.
    const ftsLimit = Math.max(limit * 5, 100);

    let sql = `
      SELECT nodes.*, bm25(nodes_fts, 0, 20, 5, 1, 2) as score
      FROM nodes_fts
      JOIN nodes ON nodes_fts.id = nodes.id
      WHERE nodes_fts MATCH ?
    `;

    const params: (string | number)[] = [ftsQuery];

    if (kinds && kinds.length > 0) {
      sql += ` AND nodes.kind IN (${kinds.map(() => '?').join(',')})`;
      params.push(...kinds);
    }

    if (languages && languages.length > 0) {
      sql += ` AND nodes.language IN (${languages.map(() => '?').join(',')})`;
      params.push(...languages);
    }

    sql += ' ORDER BY score LIMIT ? OFFSET ?';
    params.push(ftsLimit, offset);

    try {
      const rows = this.db.prepare(sql).all(...params) as (NodeRow & { score: number })[];
      return rows.map((row) => ({
        node: rowToNode(row),
        score: Math.abs(row.score), // bm25 returns negative scores
      }));
    } catch {
      // FTS query failed, return empty
      return [];
    }
  }

  /**
   * LIKE-based substring search for cases where FTS doesn't match
   * Useful for camelCase matching (e.g., "signIn" finds "signInWithGoogle")
   */
  private searchNodesLike(query: string, options: SearchOptions): SearchResult[] {
    const { kinds, languages, limit = 100, offset = 0 } = options;

    let sql = `
      SELECT nodes.*,
        CASE
          WHEN name = ? THEN 1.0
          WHEN name LIKE ? THEN 0.9
          WHEN name LIKE ? THEN 0.8
          WHEN qualified_name LIKE ? THEN 0.7
          ELSE 0.5
        END as score
      FROM nodes
      WHERE (
        name LIKE ? OR
        qualified_name LIKE ? OR
        name LIKE ?
      )
    `;

    // Pattern variants for better matching
    const exactMatch = query;
    const startsWith = `${query}%`;
    const contains = `%${query}%`;

    const params: (string | number)[] = [
      exactMatch,     // Exact match score
      startsWith,     // Starts with score
      contains,       // Contains score
      contains,       // Qualified name score
      contains,       // WHERE: name contains
      contains,       // WHERE: qualified_name contains
      startsWith,     // WHERE: name starts with
    ];

    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
      params.push(...kinds);
    }

    if (languages && languages.length > 0) {
      sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
      params.push(...languages);
    }

    sql += ' ORDER BY score DESC, length(name) ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as (NodeRow & { score: number })[];

    return rows.map((row) => ({
      node: rowToNode(row),
      score: row.score,
    }));
  }

  /**
   * Find nodes by exact name match
   *
   * Used for hybrid search - looks up symbols by exact name or case-insensitive match.
   * Returns high-confidence matches for known symbol names extracted from query.
   *
   * @param names - Array of symbol names to look up
   * @param options - Search options (kinds, languages, limit)
   * @returns SearchResult array with exact matches scored at 1.0
   */
  findNodesByExactName(names: string[], options: SearchOptions = {}): SearchResult[] {
    if (names.length === 0) return [];

    const { kinds, languages, limit = 50 } = options;

    // Two-pass approach to handle common names (e.g., "run" has 40+ matches):
    // Pass 1: Find which files contain distinctive (rare) symbols from the query.
    // Pass 2: Query each name, boosting results that co-locate with distinctive symbols.

    // Pass 1: Find files containing each queried name, identify distinctive names
    const nameToFiles = new Map<string, Set<string>>();
    for (const name of names) {
      let sql = 'SELECT DISTINCT file_path FROM nodes WHERE name COLLATE NOCASE = ?';
      const params: (string | number)[] = [name];
      if (kinds && kinds.length > 0) {
        sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
        params.push(...kinds);
      }
      sql += ' LIMIT 100';
      const rows = this.db.prepare(sql).all(...params) as { file_path: string }[];
      nameToFiles.set(name.toLowerCase(), new Set(rows.map(r => r.file_path)));
    }

    // Distinctive names are those with fewer than 10 file matches (e.g., "scrapeLoop" = 1 file)
    const distinctiveFiles = new Set<string>();
    for (const [, files] of nameToFiles) {
      if (files.size > 0 && files.size < 10) {
        for (const f of files) distinctiveFiles.add(f);
      }
    }

    // Pass 2: Query each name with per-name limit, scoring by co-location
    const perNameLimit = Math.max(8, Math.ceil(limit / names.length));
    const allResults: SearchResult[] = [];
    const seenIds = new Set<string>();

    for (const name of names) {
      let sql = `
        SELECT nodes.*, 1.0 as score
        FROM nodes
        WHERE name COLLATE NOCASE = ?
      `;
      const params: (string | number)[] = [name];

      if (kinds && kinds.length > 0) {
        sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
        params.push(...kinds);
      }

      if (languages && languages.length > 0) {
        sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
        params.push(...languages);
      }

      // Fetch enough to find co-located results among common names
      sql += ' LIMIT ?';
      params.push(Math.max(perNameLimit * 3, 50));

      const rows = this.db.prepare(sql).all(...params) as (NodeRow & { score: number })[];
      const nameResults: SearchResult[] = [];
      for (const row of rows) {
        const node = rowToNode(row);
        if (seenIds.has(node.id)) continue;
        // Boost results in files that also contain distinctive symbols
        const coLocationBoost = distinctiveFiles.has(node.filePath) ? 20 : 0;
        nameResults.push({ node, score: row.score + coLocationBoost });
      }

      // Sort by score (co-located first), take per-name limit
      nameResults.sort((a, b) => b.score - a.score);
      for (const r of nameResults.slice(0, perNameLimit)) {
        seenIds.add(r.node.id);
        allResults.push(r);
      }
    }

    // Sort all results by score so co-located results bubble up
    allResults.sort((a, b) => b.score - a.score);
    return allResults.slice(0, limit);
  }

  /**
   * Find nodes whose name contains a substring (LIKE-based).
   * Useful for CamelCase-part matching where FTS fails because
   * e.g. "TransportSearchAction" is one FTS token, not matchable by "Search"*.
   *
   * Results are ordered by name length (shorter = more likely to be the core type).
   */
  findNodesByNameSubstring(
    substring: string,
    options: SearchOptions & { excludePrefix?: boolean } = {}
  ): SearchResult[] {
    const { kinds, languages, limit = 30, excludePrefix } = options;

    let sql = `
      SELECT nodes.*, 1.0 as score
      FROM nodes
      WHERE name LIKE ?
    `;
    const params: (string | number)[] = [`%${substring}%`];

    // Exclude prefix matches (handled by FTS-based prefix search in Step 2b)
    if (excludePrefix) {
      sql += ` AND name NOT LIKE ?`;
      params.push(`${substring}%`);
    }

    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
      params.push(...kinds);
    }

    if (languages && languages.length > 0) {
      sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
      params.push(...languages);
    }

    sql += ' ORDER BY length(name) ASC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as (NodeRow & { score: number })[];
    return rows.map((row) => ({
      node: rowToNode(row),
      score: row.score,
    }));
  }

  // ===========================================================================
  // Edge Operations
  // ===========================================================================

  /**
   * Insert a new edge
   */
  insertEdge(edge: Edge): void {
    const params = {
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      metadata: edge.metadata ? JSON.stringify(edge.metadata) : null,
      line: edge.line ?? null,
      col: edge.column ?? null,
      provenance: edge.provenance ?? null,
    };

    if (!this.stmts.reactivateInactiveEdge) {
      this.stmts.reactivateInactiveEdge = this.db.prepare(`
        UPDATE edges
        SET metadata = @metadata,
            provenance = @provenance
        WHERE source = @source
          AND target = @target
          AND kind = @kind
          AND IFNULL(line, -1) = IFNULL(@line, -1)
          AND IFNULL(col, -1) = IFNULL(@col, -1)
          AND NOT ${activeEdgePredicate()}
      `);
    }
    const reactivated = this.stmts.reactivateInactiveEdge.run(params);
    if (reactivated.changes > 0) return;

    if (!this.stmts.insertEdge) {
      this.stmts.insertEdge = this.db.prepare(`
        INSERT OR IGNORE INTO edges (source, target, kind, metadata, line, col, provenance)
        VALUES (@source, @target, @kind, @metadata, @line, @col, @provenance)
      `);
    }

    this.stmts.insertEdge.run(params);
  }

  /**
   * Candidate active edges for an opt-in LSP verification pass. This is a
   * deliberately narrow API so the LSP layer does not reach through QueryBuilder
   * into raw SQL.
   */
  getLspEdgeCandidates(
    languages: Language[],
    limit: number,
    sourceFilePaths?: readonly string[],
  ): LspEdgeCandidateRow[] {
    if (languages.length === 0 || limit <= 0) return [];
    const uniqueSourceFilePaths = sourceFilePaths ? [...new Set(sourceFilePaths)] : [];
    if (sourceFilePaths && uniqueSourceFilePaths.length === 0) return [];
    const languagePlaceholders = languages.map(() => '?').join(',');
    const sourceFileFilter = uniqueSourceFilePaths.length > 0
      ? `AND s.file_path IN (${uniqueSourceFilePaths.map(() => '?').join(',')})`
      : '';
    const rows = this.db.prepare(`
      SELECT
        e.id AS edge_id,
        e.source AS source_id,
        e.target AS target_id,
        e.kind AS edge_kind,
        e.line AS edge_line,
        e.col AS edge_col,
        e.provenance AS edge_provenance,
        e.metadata AS edge_metadata,
        s.file_path AS source_file_path,
        s.language AS source_language,
        t.file_path AS target_file_path,
        t.start_line AS target_start_line,
        t.end_line AS target_end_line,
        t.start_column AS target_start_column,
        t.end_column AS target_end_column,
        t.kind AS target_kind,
        t.name AS target_name
      FROM edges e
      JOIN nodes s ON s.id = e.source
      JOIN nodes t ON t.id = e.target
      WHERE s.language IN (${languagePlaceholders})
        ${sourceFileFilter}
        AND e.kind IN ('calls', 'references', 'imports', 'instantiates')
        AND e.line IS NOT NULL
        AND ${activeEdgePredicate('e')}
      ORDER BY s.file_path, e.line, e.col, e.id
      LIMIT ?
    `).all(...languages, ...uniqueSourceFilePaths, limit) as Array<{
      edge_id: number;
      source_id: string;
      target_id: string;
      edge_kind: string;
      edge_line: number | null;
      edge_col: number | null;
      edge_provenance: string | null;
      edge_metadata: string | null;
      source_file_path: string;
      source_language: string;
      target_file_path: string;
      target_start_line: number;
      target_end_line: number;
      target_start_column: number;
      target_end_column: number;
      target_kind: string;
      target_name: string;
    }>;

    return rows.map((row) => ({
      edgeId: row.edge_id,
      sourceId: row.source_id,
      targetId: row.target_id,
      kind: row.edge_kind as EdgeKind,
      line: row.edge_line,
      column: row.edge_col,
      provenance: row.edge_provenance as Edge['provenance'] | null,
      metadata: row.edge_metadata ? safeJsonParse(row.edge_metadata, undefined) : undefined,
      sourceFilePath: row.source_file_path,
      language: row.source_language as Language,
      targetFilePath: row.target_file_path,
      targetStartLine: row.target_start_line,
      targetEndLine: row.target_end_line,
      targetStartColumn: row.target_start_column,
      targetEndColumn: row.target_end_column,
      targetKind: row.target_kind as NodeKind,
      targetName: row.target_name,
    }));
  }

  getLspEdgeCandidateCounts(
    languages: Language[],
    caps?: {
      fullIndexSourceFilesPerLanguage: number;
      fullIndexWorkItemsPerLanguage: number;
    },
  ): LspEdgeCandidateCounts {
    if (languages.length === 0) {
      return {
        sourceFilesSeen: 0,
        candidateWorkItems: 0,
        fileCapSkippedWorkItems: 0,
        workCapSkippedWorkItems: 0,
      };
    }
    const placeholders = languages.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT
        s.file_path AS source_file_path,
        COUNT(*) AS candidate_work_items
      FROM edges e
      JOIN nodes s ON s.id = e.source
      WHERE s.language IN (${placeholders})
        AND e.kind IN ('calls', 'references', 'imports', 'instantiates')
        AND ${activeEdgePredicate('e')}
        AND e.line IS NOT NULL
      GROUP BY s.file_path
      ORDER BY s.file_path
    `).all(...languages) as Array<{
      source_file_path: string;
      candidate_work_items: number;
    }>;

    const perFileCounts = rows.map((row) => row.candidate_work_items);
    const allowedFileCounts = caps
      ? perFileCounts.slice(0, caps.fullIndexSourceFilesPerLanguage)
      : perFileCounts;
    const fileCapSkippedWorkItems = caps
      ? perFileCounts.slice(caps.fullIndexSourceFilesPerLanguage).reduce((sum, count) => sum + count, 0)
      : 0;
    const allowedFileWorkItems = allowedFileCounts.reduce((sum, count) => sum + count, 0);

    return {
      sourceFilesSeen: rows.length,
      candidateWorkItems: perFileCounts.reduce((sum, count) => sum + count, 0),
      fileCapSkippedWorkItems,
      workCapSkippedWorkItems: caps
        ? Math.max(0, allowedFileWorkItems - caps.fullIndexWorkItemsPerLanguage)
        : 0,
    };
  }

  /**
   * Find graph nodes that cover a 1-based source location in one indexed file.
   */
  findNodesAtLocation(filePath: string, line: number, language?: Language, column?: number): Node[] {
    let sql = `
      SELECT * FROM nodes
      WHERE file_path = ?
        AND start_line <= ?
        AND end_line >= ?
    `;
    const params: (string | number)[] = [filePath, line, line];
    if (column !== undefined) {
      sql += `
        AND (start_line < ? OR (start_line = ? AND start_column <= ?))
        AND (end_line > ? OR (end_line = ? AND end_column >= ?))
      `;
      params.push(line, line, column, line, line, column);
    }
    if (language) {
      sql += ' AND language = ?';
      params.push(language);
    }
    sql += ' ORDER BY (end_line - start_line) ASC, (end_column - start_column) ASC, length(name) DESC';
    const rows = this.db.prepare(sql).all(...params) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * Targets of `imports` edges recorded at an exact (line, column) in a file —
   * the graph-side view of an import/export BINDING. The LSP precision pass
   * uses this to resolve a definition answer that lands on the binding
   * (tsserver's alias behavior: `helper()` resolves to the
   * `import { helper } from './a'` specifier in the caller's own file) through
   * our own edge instead of treating it as a disproof. Exact (line, col) match
   * first; falls back to a UNIQUE imports edge on that line (column
   * conventions can differ per grammar), else empty.
   */
  getImportBindingTargetsAt(filePath: string, line: number, column: number): string[] {
    const exact = this.db.prepare(`
      SELECT e.target AS target FROM edges e
      JOIN nodes s ON s.id = e.source
      WHERE e.kind = 'imports' AND s.file_path = ? AND e.line = ? AND e.col = ?
        AND ${activeEdgePredicate('e')}
    `).all(filePath, line, column) as Array<{ target: string }>;
    if (exact.length > 0) return exact.map((row) => row.target);
    const sameLine = this.db.prepare(`
      SELECT e.target AS target FROM edges e
      JOIN nodes s ON s.id = e.source
      WHERE e.kind = 'imports' AND s.file_path = ? AND e.line = ?
        AND ${activeEdgePredicate('e')}
    `).all(filePath, line) as Array<{ target: string }>;
    return sameLine.length === 1 ? sameLine.map((row) => row.target) : [];
  }

  /**
   * Mark an existing edge row as LSP-verified/corrected without duplicating it.
   */
  updateEdgeLspProvenance(edgeId: number, metadata: Record<string, unknown>): number {
    const result = this.db.prepare(`
      UPDATE edges
      SET provenance = 'lsp',
          metadata = ?
      WHERE id = ?
    `).run(JSON.stringify(metadata), edgeId);
    return result.changes;
  }

  /**
   * Retarget an LSP-corrected edge. If an equivalent active edge already exists,
   * keep that edge active and mark the old row inactive with audit metadata.
   */
  retargetEdgeWithLspCorrection(
    edgeId: number,
    targetId: string,
    metadata: Record<string, unknown>,
    replacedMetadata: Record<string, unknown>,
  ): number {
    const current = this.db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId) as EdgeRow | undefined;
    if (!current) return 0;

    const conflict = this.db.prepare(`
      SELECT * FROM edges
      WHERE id != ?
        AND source = ?
        AND target = ?
        AND kind = ?
        AND IFNULL(line, -1) = IFNULL(?, -1)
        AND IFNULL(col, -1) = IFNULL(?, -1)
        AND ${activeEdgePredicate()}
      LIMIT 1
    `).get(edgeId, current.source, targetId, current.kind, current.line, current.col) as EdgeRow | undefined;

    if (conflict) {
      const updateConflict = this.db.prepare(`
        UPDATE edges
        SET provenance = 'lsp',
            metadata = ?
        WHERE id = ?
      `).run(JSON.stringify(metadata), conflict.id);
      this.db.prepare('UPDATE edges SET metadata = ? WHERE id = ?').run(
        JSON.stringify(replacedMetadata),
        edgeId,
      );
      return updateConflict.changes;
    }

    const inactiveConflict = this.db.prepare(`
      SELECT * FROM edges
      WHERE id != ?
        AND source = ?
        AND target = ?
        AND kind = ?
        AND IFNULL(line, -1) = IFNULL(?, -1)
        AND IFNULL(col, -1) = IFNULL(?, -1)
        AND NOT ${activeEdgePredicate()}
      LIMIT 1
    `).get(edgeId, current.source, targetId, current.kind, current.line, current.col) as EdgeRow | undefined;

    if (inactiveConflict) {
      const updateConflict = this.db.prepare(`
        UPDATE edges
        SET provenance = 'lsp',
            metadata = ?
        WHERE id = ?
      `).run(
        JSON.stringify(preserveInactiveLspAudit(metadata, inactiveConflict.metadata)),
        inactiveConflict.id,
      );
      this.db.prepare('UPDATE edges SET metadata = ? WHERE id = ?').run(
        JSON.stringify(replacedMetadata),
        edgeId,
      );
      return updateConflict.changes;
    }

    const result = this.db.prepare(`
      UPDATE edges
      SET target = ?,
          provenance = 'lsp',
          metadata = ?
      WHERE id = ?
    `).run(targetId, JSON.stringify(metadata), edgeId);
    return result.changes;
  }

  /**
   * Keep the historical row for audit, but remove it from active retrieval.
   */
  suppressEdgeWithLspAudit(edgeId: number, metadata: Record<string, unknown>): number {
    const result = this.db.prepare('UPDATE edges SET metadata = ? WHERE id = ?')
      .run(JSON.stringify(metadata), edgeId);
    return result.changes;
  }

  /**
   * Insert multiple edges in a transaction
   */
  insertEdges(edges: Edge[]): void {
    if (edges.length === 0) return;

    this.db.transaction(() => {
      const endpointIds = new Set<string>();
      for (const edge of edges) {
        endpointIds.add(edge.source);
        endpointIds.add(edge.target);
      }
      const existingNodeIds = this.getExistingNodeIds([...endpointIds]);

      const rows: unknown[][] = [];
      for (const edge of edges) {
        if (!existingNodeIds.has(edge.source) || !existingNodeIds.has(edge.target)) {
          continue;
        }
        rows.push([
          edge.source,
          edge.target,
          edge.kind,
          edge.metadata ? JSON.stringify(edge.metadata) : null,
          edge.line ?? null,
          edge.column ?? null,
          edge.provenance ?? null,
        ]);
      }
      this.runBatched(
        'insertEdges',
        'INSERT OR IGNORE INTO edges (source, target, kind, metadata, line, col, provenance) VALUES ',
        '(?,?,?,?,?,?,?)',
        rows
      );
    })();
  }

  /**
   * Delete all edges from a source node
   */
  deleteEdgesBySource(sourceId: string): void {
    if (!this.stmts.deleteEdgesBySource) {
      this.stmts.deleteEdgesBySource = this.db.prepare('DELETE FROM edges WHERE source = ?');
    }
    this.stmts.deleteEdgesBySource.run(sourceId);
  }

  /**
   * Get outgoing edges from a node
   */
  getOutgoingEdges(sourceId: string, kinds?: EdgeKind[], provenance?: string): Edge[] {
    if ((kinds && kinds.length > 0) || provenance) {
      let sql = `SELECT * FROM edges WHERE source = ? AND ${activeEdgePredicate()}`;
      const params: (string | number)[] = [sourceId];

      if (kinds && kinds.length > 0) {
        sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
        params.push(...kinds);
      }

      if (provenance) {
        sql += ' AND provenance = ?';
        params.push(provenance);
      }

      const rows = this.db.prepare(sql).all(...params) as EdgeRow[];
      return rows.map(rowToEdge);
    }

    if (!this.stmts.getEdgesBySource) {
      this.stmts.getEdgesBySource = this.db.prepare(`SELECT * FROM edges WHERE source = ? AND ${activeEdgePredicate()}`);
    }
    const rows = this.stmts.getEdgesBySource.all(sourceId) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  /**
   * Get incoming edges to a node
   */
  getIncomingEdges(targetId: string, kinds?: EdgeKind[]): Edge[] {
    if (kinds && kinds.length > 0) {
      const sql = `SELECT * FROM edges WHERE target = ? AND ${activeEdgePredicate()} AND kind IN (${kinds.map(() => '?').join(',')})`;
      const rows = this.db.prepare(sql).all(targetId, ...kinds) as EdgeRow[];
      return rows.map(rowToEdge);
    }

    if (!this.stmts.getEdgesByTarget) {
      this.stmts.getEdgesByTarget = this.db.prepare(`SELECT * FROM edges WHERE target = ? AND ${activeEdgePredicate()}`);
    }
    const rows = this.stmts.getEdgesByTarget.all(targetId) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  /** Bounded exact incoming-edge candidates for the foundational LSP read. */
  getBoundedLspIncomingEdges(targetId: string, limit: number): Edge[] {
    const rows = this.db.prepare(`
      SELECT e.*
      FROM edges e INDEXED BY idx_edges_target_kind
      WHERE e.target = ?
        AND e.kind <> 'contains'
        AND (e.provenance IS NULL OR e.provenance <> 'heuristic')
        AND e.line IS NOT NULL
        AND e.col IS NOT NULL
        AND ${activeEdgePredicate('e')}
      ORDER BY e.kind COLLATE BINARY,
        e.id
      LIMIT ?
    `).all(targetId, Math.max(0, Math.trunc(limit))) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  /**
   * SPEC-010 (graph-aware rename): every incoming name-occurrence edge to
   * `targetId` — the full {@link RENAME_RELEVANT_EDGE_KINDS} set (`references`
   * PLUS `calls` / `imports` / `extends` / `implements` / … ), JOINed to the
   * referencing (source) node so each row already carries the file to edit — the
   * plan path builds a graph `RenameEdit` from this alone, avoiding an N+1
   * getNodeById per edge. A `calls` call site and an `imports` specifier ARE
   * rename occurrences (their position names the target); span verification
   * (FR-005, downstream in graph-rename) drops any edge whose recorded position
   * does not carry the old name, so broad inclusion is safe. Scoped to LSP-active
   * edges (SPEC-008 parity with {@link getIncomingEdges}). `line`/`col` are the
   * occurrence START point; `metadata` carries resolvedBy / confidence / refName
   * for the FR-004 tier and old-name recovery.
   */
  getReferencesToNode(targetId: string): IncomingReferenceRow[] {
    if (!this.stmts.getReferencesToNode) {
      this.stmts.getReferencesToNode = this.db.prepare(
        `SELECT e.source AS source, e.line AS line, e.col AS col,
                e.metadata AS metadata, e.provenance AS provenance,
                n.file_path AS file_path
         FROM edges e
         JOIN nodes n ON n.id = e.source
         WHERE e.target = ? AND e.kind IN (${RENAME_RELEVANT_EDGE_KINDS_PLACEHOLDERS}) AND ${activeEdgePredicate('e')}`,
      );
    }
    const rows = this.stmts.getReferencesToNode.all(targetId, ...RENAME_RELEVANT_EDGE_KINDS) as Array<{
      source: string;
      line: number | null;
      col: number | null;
      metadata: string | null;
      provenance: string | null;
      file_path: string;
    }>;
    return rows.map((r) => ({
      sourceId: r.source,
      sourceFilePath: r.file_path,
      line: r.line ?? null,
      column: r.col ?? null,
      metadata: r.metadata ? safeJsonParse(r.metadata, undefined) : undefined,
      provenance: r.provenance as Edge['provenance'],
    }));
  }

  /**
   * Find all edges where both source and target are in the given node set.
   * Useful for recovering inter-node connectivity after BFS.
   */
  findEdgesBetweenNodes(nodeIds: string[], kinds?: EdgeKind[]): Edge[] {
    if (nodeIds.length === 0) return [];

    const idsJson = JSON.stringify(nodeIds);
    let sql = `SELECT * FROM edges WHERE source IN (SELECT value FROM json_each(?)) AND target IN (SELECT value FROM json_each(?)) AND ${activeEdgePredicate()}`;
    const params: string[] = [idsJson, idsJson];

    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
      params.push(...kinds);
    }

    const rows = this.db.prepare(sql).all(...params) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  /**
   * Distinct file paths that DEPEND ON `filePath`: every file containing a
   * symbol with a cross-file edge (any kind except `contains`) into a symbol
   * of this file. This is the file-level projection of the symbol dependency
   * graph and the basis for blast-radius / `affected` test selection.
   *
   * It deliberately does NOT restrict to `imports` edges. In this graph an
   * `imports` edge connects a file to its own local import declarations
   * (it is always same-file), so an imports-only lookup returns zero
   * cross-file dependents for every file. The real cross-file dependency
   * signal is the resolved call/reference graph — calls, references,
   * instantiates, extends, implements, overrides, type_of, returns,
   * decorates — exactly what {@link GraphTraverser.getImpactRadius} traverses.
   * `contains` is excluded: a parent containing a symbol does not *depend* on
   * it. One indexed query (idx_nodes_file_path + idx_edges_target_kind).
   */
  getDependentFilePaths(filePath: string): string[] {
    const sql = `SELECT DISTINCT src.file_path AS fp
      FROM edges e
      JOIN nodes tgt ON tgt.id = e.target
      JOIN nodes src ON src.id = e.source
      WHERE tgt.file_path = ?
        AND e.kind != 'contains'
        AND src.file_path != ?
        AND ${activeEdgePredicate('e')}`;
    const rows = this.db.prepare(sql).all(filePath, filePath) as Array<{ fp: string }>;
    return rows.map((r) => r.fp);
  }

  /**
   * Distinct file paths that `filePath` DEPENDS ON — the inverse of
   * {@link getDependentFilePaths}: every file containing a symbol that a
   * symbol of this file has a cross-file edge into. Same edge-kind rules
   * (all kinds except `contains`); same reason imports-only is insufficient.
   */
  getDependencyFilePaths(filePath: string): string[] {
    const sql = `SELECT DISTINCT tgt.file_path AS fp
      FROM edges e
      JOIN nodes src ON src.id = e.source
      JOIN nodes tgt ON tgt.id = e.target
      WHERE src.file_path = ?
        AND e.kind != 'contains'
        AND tgt.file_path != ?
        AND ${activeEdgePredicate('e')}`;
    const rows = this.db.prepare(sql).all(filePath, filePath) as Array<{ fp: string }>;
    return rows.map((r) => r.fp);
  }

  /**
   * Cross-file edges whose TARGET is a node in `filePath` and whose SOURCE is a
   * node in a *different* file, paired with the target node's (name, kind) so a
   * caller can re-resolve the edge to the re-indexed target's new ID (node IDs
   * are `sha256(filePath:kind:name:line)`, so any line shift in the callee file
   * changes target IDs and a naive re-insert by old ID silently drops them).
   * Used by `storeExtractionResult` to preserve incoming edges across a file
   * re-index (issue #899). Same edge-kind rules as
   * {@link getDependentFilePaths}: all kinds except `contains`.
   */
  getCrossFileIncomingEdgesWithTarget(
    filePath: string
  ): Array<Edge & { targetName: string; targetKind: NodeKind; sourceFilePath: string; sourceLanguage: Language }> {
    const sql = `SELECT e.*, tgt.name AS target_name, tgt.kind AS target_kind,
        src.file_path AS source_file_path, src.language AS source_language
      FROM edges e
      JOIN nodes tgt ON tgt.id = e.target
      JOIN nodes src ON src.id = e.source
      WHERE tgt.file_path = ?
        AND e.kind != 'contains'
        AND src.file_path != ?
        AND ${activeEdgePredicate('e')}`;
    const rows = this.db.prepare(sql).all(filePath, filePath) as Array<
      EdgeRow & { target_name: string; target_kind: NodeKind; source_file_path: string; source_language: Language }
    >;
    return rows.map(row => ({
      ...rowToEdge(row),
      targetName: row.target_name,
      targetKind: row.target_kind,
      sourceFilePath: row.source_file_path,
      sourceLanguage: row.source_language,
    }));
  }

  /**
   * SPEC-011 T032 (FR-011/012) — count-aggregated reference evidence per file
   * pair, for the functional-cluster file graph. One row per DIRECTED
   * (source file, target file) pair over ACTIVE `calls`/`imports` edges, where
   * `weight` is the number of such edges between those files. Same-file pairs
   * (source == target) are returned too; the undirected fold and self-loop drop
   * happen in the analysis layer (`src/analysis/clusters/file-graph.ts`, FR-012).
   * Rows come back in a stable order so the downstream aggregation is
   * deterministic (FR-013). A read-only scan — never mutates the graph.
   */
  getFilePairEdgeWeights(): Array<{ sourceFile: string; targetFile: string; weight: number }> {
    const sql = `SELECT src.file_path AS source_file, tgt.file_path AS target_file, COUNT(*) AS weight
      FROM edges e
      JOIN nodes src ON src.id = e.source
      JOIN nodes tgt ON tgt.id = e.target
      WHERE e.kind IN ('calls', 'imports')
        AND ${activeEdgePredicate('e')}
      GROUP BY src.file_path, tgt.file_path
      ORDER BY src.file_path, tgt.file_path`;
    const rows = this.db.prepare(sql).all() as Array<{
      source_file: string;
      target_file: string;
      weight: number;
    }>;
    return rows.map((r) => ({
      sourceFile: r.source_file,
      targetFile: r.target_file,
      weight: Number(r.weight),
    }));
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Insert or update a file record
   */
  upsertFile(file: FileRecord): void {
    if (!this.stmts.upsertFile) {
      this.stmts.upsertFile = this.db.prepare(`
        INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, errors)
        VALUES (@path, @contentHash, @language, @size, @modifiedAt, @indexedAt, @nodeCount, @errors)
        ON CONFLICT(path) DO UPDATE SET
          content_hash = @contentHash,
          language = @language,
          size = @size,
          modified_at = @modifiedAt,
          indexed_at = @indexedAt,
          node_count = @nodeCount,
          errors = @errors
      `);
    }

    this.stmts.upsertFile.run({
      path: file.path,
      contentHash: file.contentHash,
      language: file.language,
      size: file.size,
      modifiedAt: file.modifiedAt,
      indexedAt: file.indexedAt,
      nodeCount: file.nodeCount,
      errors: file.errors ? JSON.stringify(file.errors) : null,
    });
  }

  /**
   * Delete a file record and its nodes
   */
  deleteFile(filePath: string): void {
    this.db.transaction(() => {
      this.deleteNodesByFile(filePath);
      if (!this.stmts.deleteFile) {
        this.stmts.deleteFile = this.db.prepare('DELETE FROM files WHERE path = ?');
      }
      this.stmts.deleteFile.run(filePath);
    })();
  }

  /**
   * Get a file record by path
   */
  getFileByPath(filePath: string): FileRecord | null {
    if (!this.stmts.getFileByPath) {
      this.stmts.getFileByPath = this.db.prepare('SELECT * FROM files WHERE path = ?');
    }
    const row = this.stmts.getFileByPath.get(filePath) as FileRow | undefined;
    return row ? rowToFileRecord(row) : null;
  }

  /**
   * Get all tracked files
   */
  getAllFiles(): FileRecord[] {
    if (!this.stmts.getAllFiles) {
      this.stmts.getAllFiles = this.db.prepare('SELECT * FROM files ORDER BY path');
    }
    const rows = this.stmts.getAllFiles.all() as FileRow[];
    return rows.map(rowToFileRecord);
  }

  /**
   * Most recent index timestamp (ms since epoch) across all tracked files, or
   * null when nothing is indexed yet. One indexed aggregate, no per-row scan. (#329)
   */
  getLastIndexedAt(): number | null {
    const row = this.db
      .prepare('SELECT MAX(indexed_at) AS last FROM files')
      .get() as { last: number | null } | undefined;
    return row?.last ?? null;
  }

  /**
   * Get files that need re-indexing (hash changed)
   */
  getStaleFiles(currentHashes: Map<string, string>): FileRecord[] {
    const files = this.getAllFiles();
    return files.filter((f) => {
      const currentHash = currentHashes.get(f.path);
      return currentHash && currentHash !== f.contentHash;
    });
  }

  // ===========================================================================
  // Unresolved References
  // ===========================================================================

  /**
   * Insert an unresolved reference
   */
  insertUnresolvedRef(ref: UnresolvedReference): void {
    if (!this.stmts.insertUnresolved) {
      this.stmts.insertUnresolved = this.db.prepare(`
        INSERT INTO unresolved_refs (from_node_id, reference_name, reference_kind, line, col, candidates, file_path, language)
        VALUES (@fromNodeId, @referenceName, @referenceKind, @line, @col, @candidates, @filePath, @language)
      `);
    }

    this.stmts.insertUnresolved.run({
      fromNodeId: ref.fromNodeId,
      referenceName: ref.referenceName,
      referenceKind: ref.referenceKind,
      line: ref.line,
      col: ref.column,
      candidates: ref.candidates ? JSON.stringify(ref.candidates) : null,
      filePath: ref.filePath ?? '',
      language: ref.language ?? 'unknown',
    });
  }

  /**
   * Insert multiple unresolved references in a transaction
   */
  insertUnresolvedRefsBatch(refs: UnresolvedReference[]): void {
    if (refs.length === 0) return;
    const insert = this.db.transaction(() => {
      const rows: unknown[][] = [];
      for (const ref of refs) {
        rows.push([
          ref.fromNodeId,
          ref.referenceName,
          ref.referenceKind,
          ref.line,
          ref.column,
          ref.candidates ? JSON.stringify(ref.candidates) : null,
          ref.filePath ?? '',
          ref.language ?? 'unknown',
        ]);
      }
      this.runBatched(
        'insertUnresolvedRefs',
        'INSERT INTO unresolved_refs (from_node_id, reference_name, reference_kind, line, col, candidates, file_path, language) VALUES ',
        '(?,?,?,?,?,?,?,?)',
        rows
      );
    });
    insert();
  }

  /**
   * Delete unresolved references from a node
   */
  deleteUnresolvedByNode(nodeId: string): void {
    if (!this.stmts.deleteUnresolvedByNode) {
      this.stmts.deleteUnresolvedByNode = this.db.prepare(
        'DELETE FROM unresolved_refs WHERE from_node_id = ?'
      );
    }
    this.stmts.deleteUnresolvedByNode.run(nodeId);
  }

  /**
   * Get unresolved references by name (for resolution)
   */
  getUnresolvedByName(name: string): UnresolvedReference[] {
    if (!this.stmts.getUnresolvedByName) {
      this.stmts.getUnresolvedByName = this.db.prepare(
        'SELECT * FROM unresolved_refs WHERE reference_name = ?'
      );
    }
    const rows = this.stmts.getUnresolvedByName.all(name) as UnresolvedRefRow[];
    return rows.map((row) => ({
      fromNodeId: row.from_node_id,
      referenceName: row.reference_name,
      referenceKind: row.reference_kind as EdgeKind,
      line: row.line,
      column: row.col,
      candidates: row.candidates ? safeJsonParse(row.candidates, undefined) : undefined,
      filePath: row.file_path,
      language: row.language as Language,
      rowId: row.id,
    }));
  }

  /**
   * Get all unresolved references
   */
  getUnresolvedReferences(): UnresolvedReference[] {
    const rows = this.db.prepare('SELECT * FROM unresolved_refs').all() as UnresolvedRefRow[];
    return rows.map((row) => ({
      fromNodeId: row.from_node_id,
      referenceName: row.reference_name,
      referenceKind: row.reference_kind as EdgeKind,
      line: row.line,
      column: row.col,
      candidates: row.candidates ? safeJsonParse(row.candidates, undefined) : undefined,
      filePath: row.file_path,
      language: row.language as Language,
      rowId: row.id,
    }));
  }

  /**
   * Get the count of PENDING (never-attempted) references without loading
   * them into memory. Rows marked status='failed' — attempted by a completed
   * pass, no match — are excluded: they are not outstanding work, only retry
   * candidates for the #1240 sweep, so they must not trip the #1187 orphan
   * sweep or the `status` pending-refs warning.
   */
  getUnresolvedReferencesCount(): number {
    if (!this.stmts.getUnresolvedCount) {
      this.stmts.getUnresolvedCount = this.db.prepare(
        "SELECT COUNT(*) as count FROM unresolved_refs WHERE status = 'pending'"
      );
    }
    const row = this.stmts.getUnresolvedCount.get() as { count: number };
    return row.count;
  }

  /**
   * Get a batch of PENDING unresolved references using LIMIT/OFFSET
   * pagination. Used to process references in bounded memory chunks; failed
   * rows are excluded so the batched drain loop terminates once every row
   * has been attempted.
   */
  getUnresolvedReferencesBatch(offset: number, limit: number): UnresolvedReference[] {
    if (!this.stmts.getUnresolvedBatch) {
      this.stmts.getUnresolvedBatch = this.db.prepare(
        "SELECT * FROM unresolved_refs WHERE status = 'pending' LIMIT ? OFFSET ?"
      );
    }
    const rows = this.stmts.getUnresolvedBatch.all(limit, offset) as UnresolvedRefRow[];
    return rows.map((row) => ({
      fromNodeId: row.from_node_id,
      referenceName: row.reference_name,
      referenceKind: row.reference_kind as EdgeKind,
      line: row.line,
      column: row.col,
      candidates: row.candidates ? safeJsonParse(row.candidates, undefined) : undefined,
      filePath: row.file_path,
      language: row.language as Language,
      rowId: row.id,
    }));
  }

  /**
   * Get all tracked file paths (lightweight — no full FileRecord objects)
   */
  getAllFilePaths(): string[] {
    if (!this.stmts.getAllFilePaths) {
      this.stmts.getAllFilePaths = this.db.prepare('SELECT path FROM files ORDER BY path');
    }
    const rows = this.stmts.getAllFilePaths.all() as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  /**
   * Get all distinct node names (lightweight — just name strings for pre-filtering)
   */
  getAllNodeNames(): string[] {
    if (!this.stmts.getAllNodeNames) {
      this.stmts.getAllNodeNames = this.db.prepare('SELECT DISTINCT name FROM nodes');
    }
    const rows = this.stmts.getAllNodeNames.all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  /**
   * Stream the distinct node names one row at a time — the incremental
   * counterpart to {@link getAllNodeNames} for callers that need to yield
   * to the event loop mid-scan (resolver cache warm-up on multi-million-node
   * indexes). Fresh statement per call: the iterator holds an open cursor.
   */
  *iterateNodeNames(): IterableIterator<string> {
    const stmt = this.db.prepare('SELECT DISTINCT name FROM nodes');
    for (const row of stmt.iterate()) {
      yield (row as { name: string }).name;
    }
  }

  /**
   * Get unresolved references scoped to specific file paths.
   * Uses the idx_unresolved_file_path index for efficient lookup.
   */
  getUnresolvedReferencesByFiles(filePaths: string[]): UnresolvedReference[] {
    if (filePaths.length === 0) return [];

    // Chunk under SQLite's parameter limit: the first sync of a very large repo
    // passes every changed file here, which an unbounded `IN (...)` would bind
    // as one parameter each — exceeding MAX_VARIABLE_NUMBER and aborting with
    // "too many SQL variables". (#540)
    const rows: UnresolvedRefRow[] = [];
    for (let i = 0; i < filePaths.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const chunkRows = this.db
        .prepare(`SELECT * FROM unresolved_refs WHERE status = 'pending' AND file_path IN (${placeholders})`)
        .all(...chunk) as UnresolvedRefRow[];
      rows.push(...chunkRows);
    }

    return rows.map((row) => ({
      fromNodeId: row.from_node_id,
      referenceName: row.reference_name,
      referenceKind: row.reference_kind as EdgeKind,
      line: row.line,
      column: row.col,
      candidates: row.candidates ? safeJsonParse(row.candidates, undefined) : undefined,
      filePath: row.file_path,
      language: row.language as Language,
      rowId: row.id,
    }));
  }

  /**
   * Unresolved references named `name` scoped to a set of file paths — the
   * FR-018 post-check's "no unresolved reference in the touched files still
   * carries the old name" probe (SPEC-010). Deliberately status-AGNOSTIC,
   * unlike {@link getUnresolvedReferencesByFiles}: a genuine dangling reference
   * is parked status='failed' by the resolution-complete re-sync the post-check
   * runs after, so inheriting that statement's status='pending' filter would
   * miss exactly the dangling references this probe exists to catch. Chunked
   * under SQLite's parameter limit like the sibling file-scoped lookups;
   * prepared fresh per chunk since the placeholder count varies.
   */
  getUnresolvedRefsByNameInFiles(name: string, filePaths: string[]): UnresolvedReference[] {
    if (filePaths.length === 0) return [];

    const rows: UnresolvedRefRow[] = [];
    for (let i = 0; i < filePaths.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      // B6 (rp-review): also match `name_tail` (the last segment of a dotted/
      // scoped reference name — `util.oldName`/`Mod::oldName` → `oldName`), written
      // when a ref is marked failed. A genuine QUALIFIED dangle keeps its dotted
      // reference_name, so a bare `reference_name = ?` match MISSED it and the
      // FR-018 post-check wrongly passed. Bind the name twice.
      const chunkRows = this.db
        .prepare(`SELECT * FROM unresolved_refs WHERE (reference_name = ? OR name_tail = ?) AND file_path IN (${placeholders})`)
        .all(name, name, ...chunk) as UnresolvedRefRow[];
      rows.push(...chunkRows);
    }

    return rows.map((row) => ({
      fromNodeId: row.from_node_id,
      referenceName: row.reference_name,
      referenceKind: row.reference_kind as EdgeKind,
      line: row.line,
      column: row.col,
      candidates: row.candidates ? safeJsonParse(row.candidates, undefined) : undefined,
      filePath: row.file_path,
      language: row.language as Language,
    }));
  }

  /**
   * Delete all unresolved references (after resolution)
   */
  clearUnresolvedReferences(): void {
    this.db.exec('DELETE FROM unresolved_refs');
  }

  /**
   * Delete resolved references by their IDs
   */
  deleteResolvedReferences(fromNodeIds: string[]): void {
    if (fromNodeIds.length === 0) return;
    // Chunk under SQLite's parameter limit, matching every other IN-list in
    // this file. The internal resolution path uses deleteSpecificResolvedReferences
    // instead, but QueryBuilder is part of the public API, so a library consumer
    // passing more ids than SQLITE_MAX_VARIABLE_NUMBER (32766 on the bundled
    // node:sqlite) would otherwise hit "too many SQL variables". (#540, #1001)
    for (let i = 0; i < fromNodeIds.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = fromNodeIds.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM unresolved_refs WHERE from_node_id IN (${placeholders})`).run(...chunk);
    }
  }

  /**
   * Delete specific resolved references by (fromNodeId, referenceName, referenceKind) tuples.
   * More precise than deleteResolvedReferences — only removes refs that were actually resolved.
   */
  deleteSpecificResolvedReferences(refs: Array<{ fromNodeId: string; referenceName: string; referenceKind: string }>): void {
    if (refs.length === 0) return;
    const stmt = this.db.prepare(
      'DELETE FROM unresolved_refs WHERE from_node_id = ? AND reference_name = ? AND reference_kind = ?'
    );
    const deleteMany = this.db.transaction((items: typeof refs) => {
      for (const ref of items) {
        stmt.run(ref.fromNodeId, ref.referenceName, ref.referenceKind);
      }
    });
    deleteMany(refs);
  }

  /**
   * Delete unresolved-ref rows by row id — the precise cleanup for refs a
   * resolution pass actually processed. The key-tuple variant above also
   * deletes SIBLING rows (same caller calling the same callee at other lines)
   * that a later batch hasn't attempted yet, so when a batch boundary split a
   * caller's same-named call sites, the later sites' edges were silently never
   * created (#1269).
   */
  deleteReferencesByRowIds(rowIds: number[]): void {
    if (rowIds.length === 0) return;
    for (let i = 0; i < rowIds.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = rowIds.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM unresolved_refs WHERE id IN (${placeholders})`).run(...chunk);
    }
  }

  /**
   * Mark refs a completed resolution pass could not resolve as status='failed'
   * instead of deleting them (#1240). Failed rows are invisible to the pending
   * count/batch readers (so drain loops and the #1187 orphan sweep still
   * terminate) but stay queryable by name_tail so a later sync can retry them
   * when a changed file introduces a symbol that could satisfy them. name_tail
   * is (re)written here so rows inserted before the v8 migration get their
   * tail the first time they're attempted.
   */
  markReferencesFailed(refs: Array<{ fromNodeId: string; referenceName: string; referenceKind: string }>): void {
    if (refs.length === 0) return;
    const stmt = this.db.prepare(
      "UPDATE unresolved_refs SET status = 'failed', name_tail = ? WHERE from_node_id = ? AND reference_name = ? AND reference_kind = ?"
    );
    const markMany = this.db.transaction((items: typeof refs) => {
      for (const ref of items) {
        stmt.run(referenceNameTail(ref.referenceName), ref.fromNodeId, ref.referenceName, ref.referenceKind);
      }
    });
    markMany(refs);
  }

  /**
   * Park refs as status='failed' by row id — the precise counterpart of
   * markReferencesFailed, for the same reason as deleteReferencesByRowIds:
   * the key-tuple variant also flips same-key sibling rows in later batches
   * to 'failed' before they were ever attempted (#1269). Resolution outcome
   * can differ per call site (receiver-type inference reads the ref's line),
   * so a sibling must not inherit this row's failure.
   */
  markReferencesFailedByRowIds(refs: Array<{ rowId: number; referenceName: string }>): void {
    if (refs.length === 0) return;
    const stmt = this.db.prepare(
      "UPDATE unresolved_refs SET status = 'failed', name_tail = ? WHERE id = ?"
    );
    const markMany = this.db.transaction((items: typeof refs) => {
      for (const ref of items) {
        stmt.run(referenceNameTail(ref.referenceName), ref.rowId);
      }
    });
    markMany(refs);
  }

  /**
   * Failed refs whose name tail matches one of the given symbol names — the
   * candidates a sync should retry after files carrying those names changed
   * (#1240). Names matching more than `perNameCeiling` failed refs are
   * skipped entirely: at that population a name is external/builtin noise
   * (`get`, `map`, …) that one new definition won't resolve — the same
   * rationale as resolution's AMBIGUOUS_NAME_CEILING (#999) — and retrying an
   * arbitrary subset would be both wasted work and incoherent coverage.
   */
  getRetryableFailedReferences(names: string[], perNameCeiling: number = 500): UnresolvedReference[] {
    if (names.length === 0) return [];

    // Pass 1: per-tail counts, chunked under the SQLite parameter limit.
    const retryNames: string[] = [];
    for (let i = 0; i < names.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = names.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const counts = this.db
        .prepare(
          `SELECT name_tail, COUNT(*) as count FROM unresolved_refs WHERE status = 'failed' AND name_tail IN (${placeholders}) GROUP BY name_tail`
        )
        .all(...chunk) as Array<{ name_tail: string; count: number }>;
      for (const row of counts) {
        if (row.count <= perNameCeiling) retryNames.push(row.name_tail);
      }
    }
    if (retryNames.length === 0) return [];

    // Pass 2: load the surviving rows.
    const rows: UnresolvedRefRow[] = [];
    for (let i = 0; i < retryNames.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = retryNames.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const chunkRows = this.db
        .prepare(`SELECT * FROM unresolved_refs WHERE status = 'failed' AND name_tail IN (${placeholders})`)
        .all(...chunk) as UnresolvedRefRow[];
      rows.push(...chunkRows);
    }

    return rows.map((row) => ({
      fromNodeId: row.from_node_id,
      referenceName: row.reference_name,
      referenceKind: row.reference_kind as EdgeKind,
      line: row.line,
      column: row.col,
      candidates: row.candidates ? safeJsonParse(row.candidates, undefined) : undefined,
      filePath: row.file_path,
      language: row.language as Language,
      rowId: row.id,
    }));
  }

  /**
   * Distinct node names present in the given files — the symbol names a sync
   * pass uses to look up retryable failed refs after those files changed.
   */
  getNodeNamesByFiles(filePaths: string[]): string[] {
    if (filePaths.length === 0) return [];
    const names = new Set<string>();
    for (let i = 0; i < filePaths.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT DISTINCT name FROM nodes WHERE file_path IN (${placeholders})`)
        .all(...chunk) as Array<{ name: string }>;
      for (const row of rows) names.add(row.name);
    }
    return [...names];
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Lightweight (nodes, edges) count snapshot. Used around an index/sync
   * run to compute true additions across extraction + resolution +
   * synthesis — the per-phase counter in the orchestrator only sees
   * extraction's contribution, which is why the CLI summary under-reported
   * the edge count (resolution + synthesizer edges were invisible).
   */
  getNodeAndEdgeCount(): { nodes: number; edges: number } {
    return this.db
      .prepare('SELECT (SELECT COUNT(*) FROM nodes) AS nodes, (SELECT COUNT(*) FROM edges) AS edges')
      .get() as { nodes: number; edges: number };
  }

  /**
   * Get graph statistics
   */
  getStats(): GraphStats {
    // Single query for all three aggregate counts
    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM nodes) AS node_count,
        (SELECT COUNT(*) FROM edges) AS edge_count,
        (SELECT COUNT(*) FROM files) AS file_count
    `).get() as { node_count: number; edge_count: number; file_count: number };

    const nodesByKind = {} as Record<NodeKind, number>;
    const nodeKindRows = this.db
      .prepare('SELECT kind, COUNT(*) as count FROM nodes GROUP BY kind')
      .all() as Array<{ kind: string; count: number }>;
    for (const row of nodeKindRows) {
      nodesByKind[row.kind as NodeKind] = row.count;
    }

    const edgesByKind = {} as Record<EdgeKind, number>;
    const edgeKindRows = this.db
      .prepare('SELECT kind, COUNT(*) as count FROM edges GROUP BY kind')
      .all() as Array<{ kind: string; count: number }>;
    for (const row of edgeKindRows) {
      edgesByKind[row.kind as EdgeKind] = row.count;
    }

    const filesByLanguage = {} as Record<Language, number>;
    const languageRows = this.db
      .prepare('SELECT language, COUNT(*) as count FROM files GROUP BY language')
      .all() as Array<{ language: string; count: number }>;
    for (const row of languageRows) {
      filesByLanguage[row.language as Language] = row.count;
    }

    return {
      nodeCount: counts.node_count,
      edgeCount: counts.edge_count,
      fileCount: counts.file_count,
      nodesByKind,
      edgesByKind,
      filesByLanguage,
      dbSizeBytes: 0, // Set by caller using DatabaseConnection.getSize()
      lastUpdated: Date.now(),
    };
  }

  // ===========================================================================
  // Embedding Vectors (SPEC-001)
  // ===========================================================================

  /**
   * Upsert a symbol's embedding vector. Keyed on `node_id`, so a second write
   * for the same symbol REPLACES the first — exactly one active-model vector is
   * ever held per symbol (FR-009). `vector` is the raw little-endian f32 BLOB,
   * `dims` its element count, and `inputHash` the sha256 of the composed
   * embedding input that drives staleness detection (FR-010).
   */
  upsertNodeVector(nodeId: string, model: string, dims: number, vector: Uint8Array, inputHash: string): void {
    if (!this.stmts.upsertNodeVector) {
      this.stmts.upsertNodeVector = this.db.prepare(`
        INSERT INTO node_vectors (node_id, model, dims, vector, input_hash)
        VALUES (@nodeId, @model, @dims, @vector, @inputHash)
        ON CONFLICT(node_id) DO UPDATE SET
          model = @model,
          dims = @dims,
          vector = @vector,
          input_hash = @inputHash
      `);
    }
    this.stmts.upsertNodeVector.run({ nodeId, model, dims, vector, inputHash });
    // Every node_vectors mutation bumps the monotonic write-version so the hybrid
    // staleness probe (SPEC-003 review item 6) detects a same-count in-place re-embed
    // (this ON CONFLICT DO UPDATE leaves the count unchanged) that count/model/dims miss.
    this.bumpVectorsWriteVersion();
  }

  /**
   * Bump the monotonic `vectors_write_version` metadata counter (SPEC-003 review
   * item 6). Called on EVERY `node_vectors` mutation (upsert + orphan-delete) so the
   * hybrid staleness probe invalidates the resident matrix even for changes that leave
   * the matching-model count unchanged — an in-place re-embed or a 1-for-1 rename. A
   * single atomic increment (SQL CAST arithmetic), monotonic and cheap; the token only
   * needs to CHANGE, so batched call paths may bump more than once per logical change.
   * Written ONLY on the vector-write path (embedding active), so a dormant project never
   * creates the scalar and its byte-parity is untouched (SC-004).
   */
  private bumpVectorsWriteVersion(): void {
    if (!this.stmts.bumpVectorsWriteVersion) {
      this.stmts.bumpVectorsWriteVersion = this.db.prepare(`
        INSERT INTO project_metadata (key, value, updated_at)
        VALUES ('vectors_write_version', '1', @updatedAt)
        ON CONFLICT(key) DO UPDATE SET
          value = CAST(CAST(value AS INTEGER) + 1 AS TEXT),
          updated_at = @updatedAt
      `);
    }
    this.stmts.bumpVectorsWriteVersion.run({ updatedAt: Date.now() });
  }

  /**
   * Read the monotonic `graph_write_version` metadata token (SPEC-011,
   * data-model.md). This is the LIVE graph version; a catalog is stale when the
   * version it recorded is strictly less than this (staleness is DERIVED, never
   * stored). Absent (dormant/never-advanced project) or malformed ⇒ 0. A pure
   * read — it MUST NOT create the scalar, so a not-opted-in project stays
   * byte-identical to the pre-feature state (FR-025/SC-007).
   */
  getGraphWriteVersion(): number {
    const raw = this.getMetadata('graph_write_version');
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  /**
   * Advance `graph_write_version` by 1 (SPEC-011). Called once per successful
   * index/sync when ≥1 catalog is enabled (the dormancy gate lives in the
   * analysis orchestrator, FR-025), as part of the graph-update commit BEFORE
   * catalog analysis runs, so a post-update analysis failure leaves the retained
   * catalog's recorded version strictly less than live — deriving as stale
   * (FR-022). Mirrors `bumpVectorsWriteVersion`: a single atomic CAST-arithmetic
   * increment, monotonic and cheap.
   */
  advanceGraphWriteVersion(): void {
    if (!this.stmts.advanceGraphWriteVersion) {
      this.stmts.advanceGraphWriteVersion = this.db.prepare(`
        INSERT INTO project_metadata (key, value, updated_at)
        VALUES ('graph_write_version', '1', @updatedAt)
        ON CONFLICT(key) DO UPDATE SET
          value = CAST(CAST(value AS INTEGER) + 1 AS TEXT),
          updated_at = @updatedAt
      `);
    }
    this.stmts.advanceGraphWriteVersion.run({ updatedAt: Date.now() });
  }

  /**
   * Live declaration-level symbols (FR-005 kinds) that still need an embedding
   * for `activeModel`: either they carry no vector at all, or their stored
   * vector was written under a DIFFERENT model and is therefore stale (FR-010).
   * The model comparison uses SQLite's default BINARY collation — exact and
   * case-sensitive, so a 'Nomic' row is stale against an active 'nomic'. The
   * LEFT JOIN keys on (node_id, model); a NULL right side is precisely "no
   * current-model vector for this node".
   */
  selectEmbeddableNodesMissingVector(activeModel: string): Node[] {
    if (!this.stmts.selectEmbeddableMissing) {
      this.stmts.selectEmbeddableMissing = this.db.prepare(`
        SELECT n.*
        FROM nodes n
        LEFT JOIN node_vectors v ON v.node_id = n.id AND v.model = ?
        WHERE n.kind IN (${EMBEDDABLE_KINDS_PLACEHOLDERS})
          AND v.node_id IS NULL
      `);
    }
    const rows = this.stmts.selectEmbeddableMissing.all(activeModel, ...EMBEDDABLE_NODE_KINDS) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * Embedding coverage for `activeModel`: `embeddable` is the count of live
   * FR-005 symbols, `embedded` the count of those with a current-model vector.
   * `embedded` counts FROM nodes JOINed to node_vectors, so an ORPHAN vector row
   * (a `node_id` no longer present in `nodes`) is never counted, and a vector
   * under another model doesn't count either (FR-022). `embeddable === 0` is a
   * valid empty graph — the caller derives the percentage (100 when nothing is
   * embeddable), this method only reports the two counts.
   */
  getEmbeddingCoverage(activeModel: string): { embeddable: number; embedded: number } {
    if (!this.stmts.embeddingCoverage) {
      this.stmts.embeddingCoverage = this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM nodes
             WHERE kind IN (${EMBEDDABLE_KINDS_PLACEHOLDERS})) AS embeddable,
          (SELECT COUNT(*) FROM nodes n
             JOIN node_vectors v ON v.node_id = n.id AND v.model = ?
             WHERE n.kind IN (${EMBEDDABLE_KINDS_PLACEHOLDERS})) AS embedded
      `);
    }
    const row = this.stmts.embeddingCoverage.get(
      ...EMBEDDABLE_NODE_KINDS,
      activeModel,
      ...EMBEDDABLE_NODE_KINDS,
    ) as { embeddable: number; embedded: number };
    return { embeddable: row.embeddable, embedded: row.embedded };
  }

  /**
   * Live declaration-level symbols (FR-005 kinds) that ALREADY carry a
   * current-model vector, paired with that vector's stored `input_hash`. The
   * incremental embed pass (SPEC-001 Slice B) recomposes each symbol's input and
   * re-embeds only those whose fresh hash no longer matches — a network-free
   * O(embeddable) staleness scan (FR-016/FR-027). This is the exact complement of
   * {@link selectEmbeddableNodesMissingVector}: that returns the symbols with NO
   * current-model vector (always re-embedded), this returns the ones WITH one (re-
   * embedded only when their input changed). The two sets are disjoint by the join.
   */
  selectEmbeddedNodeHashes(activeModel: string): Array<{ node: Node; inputHash: string }> {
    if (!this.stmts.selectEmbeddedWithHash) {
      this.stmts.selectEmbeddedWithHash = this.db.prepare(`
        SELECT n.*, v.input_hash AS input_hash
        FROM nodes n
        JOIN node_vectors v ON v.node_id = n.id AND v.model = ?
        WHERE n.kind IN (${EMBEDDABLE_KINDS_PLACEHOLDERS})
      `);
    }
    const rows = this.stmts.selectEmbeddedWithHash.all(
      activeModel,
      ...EMBEDDABLE_NODE_KINDS,
    ) as Array<NodeRow & { input_hash: string }>;
    return rows.map((row) => ({ node: rowToNode(row), inputHash: row.input_hash }));
  }

  /**
   * Every current-model vector row joined to its live node, carrying the raw
   * little-endian f32 BLOB plus the node's `kind`/`language` for the SPEC-003
   * matrix-cache pre-filter arrays (data-model E4; research D6). Read-only — the
   * hybrid matrix cache (`src/search/hybrid.ts`) decodes each BLOB via
   * {@link decodeVector} into one contiguous `Float32Array`. The JOIN on
   * `nodes` drops orphan vector rows (a `node_id` no longer present) exactly as
   * {@link getEmbeddingCoverage}'s `embedded` count does, so the enumerated row
   * count matches that count. `vector` is normalized to a `Buffer` (node:sqlite
   * hands BLOBs back as a plain `Uint8Array`, which lacks `readFloatLE`).
   */
  selectVectorRowsForModel(
    activeModel: string,
  ): Array<{ nodeId: string; kind: NodeKind; language: Language; vector: Buffer }> {
    if (!this.stmts.selectVectorRows) {
      this.stmts.selectVectorRows = this.db.prepare(`
        SELECT v.node_id AS nodeId, n.kind AS kind, n.language AS language, v.vector AS vector
        FROM node_vectors v
        JOIN nodes n ON n.id = v.node_id
        WHERE v.model = ?
          AND n.kind IN (${EMBEDDABLE_KINDS_PLACEHOLDERS})
      `);
    }
    const rows = this.stmts.selectVectorRows.all(activeModel, ...EMBEDDABLE_NODE_KINDS) as Array<{
      nodeId: string;
      kind: string;
      language: string;
      vector: Uint8Array;
    }>;
    return rows.map((r) => ({
      nodeId: r.nodeId,
      kind: r.kind as NodeKind,
      language: r.language as Language,
      vector: Buffer.isBuffer(r.vector)
        ? r.vector
        : Buffer.from(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength),
    }));
  }

  /**
   * Reconcile the vector layer against the live node set: delete every
   * `node_vectors` row whose `node_id` is no longer present in `nodes` (FR-017).
   * `node_vectors` has no foreign key (D6/FR-016a), so a removed symbol — and the
   * transient orphan a delete-reinsert cycle leaves behind — persists until this
   * anti-join sweeps it. Evaluated over the WHOLE `nodes` table, so a vector for a
   * file untouched by the current pass is never falsely deleted. Returns the number
   * of orphan rows removed.
   */
  deleteRemovedVectors(): number {
    if (!this.stmts.deleteRemovedVectors) {
      this.stmts.deleteRemovedVectors = this.db.prepare(
        'DELETE FROM node_vectors WHERE node_id NOT IN (SELECT id FROM nodes)',
      );
    }
    const removed = this.stmts.deleteRemovedVectors.run().changes;
    // A real vector removal (e.g. a symbol renamed/deleted) is a node_vectors mutation:
    // bump the write-version so the staleness probe rebuilds even when a matching-model
    // add elsewhere leaves the net count unchanged (SPEC-003 review item 6). No rows
    // removed ⇒ no mutation ⇒ no bump (keeps the token from moving spuriously).
    if (removed > 0) this.bumpVectorsWriteVersion();
    return removed;
  }

  // ===========================================================================
  // Project Metadata
  // ===========================================================================

  /**
   * Get a metadata value by key
   */
  getMetadata(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM project_metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * Set a metadata key-value pair (upsert)
   */
  setMetadata(key: string, value: string): void {
    this.db.prepare(
      'INSERT INTO project_metadata (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(key, value, Date.now());
  }

  /**
   * Get all metadata as a key-value record
   */
  getAllMetadata(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM project_metadata').all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  /**
   * Clear all data from the database
   */
  clear(): void {
    this.nodeCache.clear();
    this.db.transaction(() => {
      this.db.exec('DELETE FROM unresolved_refs');
      this.db.exec('DELETE FROM edges');
      this.db.exec('DELETE FROM nodes');
      this.db.exec('DELETE FROM files');
    })();
  }
}
