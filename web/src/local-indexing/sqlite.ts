import sqlite3InitModule from "@sqlite.org/sqlite-wasm"
import type { Database, SAHPoolUtil } from "@sqlite.org/sqlite-wasm"
import canonicalSchemaSource from "../../../src/db/schema.sql?raw"
import { SHARED_SCHEMA_VERSION } from "../../../src/db/schema-version"
import type { Edge, Node } from "../../../src/types"
import type { SourceManifest } from "./source"
import type {
  CodeEdge,
  CodeNode,
  GraphResult,
  ListResult,
  Repository,
  RepositoryStatus,
  SearchResult,
} from "../lib/api/types"
import {
  normalizeDepthRequest,
  normalizeRelationshipRequest,
  REPOSITORY_QUERY_LIMITS,
  type SourceResult,
} from "../lib/repository-client"
import type {
  BrowserEmbeddingSymbol,
  EmbeddingSemanticState,
  EmbeddingVectorRow,
} from "./embeddings"

export const BROWSER_SCHEMA_VERSION = SHARED_SCHEMA_VERSION
export const BROWSER_VECTOR_WRITE_LIMIT = 500

const REGISTRY_DATABASE = "/codegraph/browser/registry.sqlite3"
const OPAQUE_REPOSITORY_ID = /^[A-Za-z0-9_-]+$/
const MINIMUM_POOL_CAPACITY = 16
const IMPACT_CONTAINER_KINDS = new Set([
  "class",
  "interface",
  "struct",
  "trait",
  "protocol",
  "module",
  "enum",
])

const canonicalSchema = canonicalSchemaSource.replace(
  "INSERT INTO schema_versions (version, applied_at, description)",
  "INSERT OR IGNORE INTO schema_versions (version, applied_at, description)"
)

export interface BrowserGenerationSource {
  path: string
  contentHash: string
  language: string
  size: number
  text: string
  mtimeHint?: number
}

export interface BrowserGenerationInput {
  repositoryId: string
  manifestFingerprint: string
  manifest: unknown
  counts: Record<string, number>
  warnings: unknown[]
  sources: BrowserGenerationSource[]
  nodes: Node[]
  edges: Edge[]
}

export type BrowserStorageFaultPoint =
  | "after-registry-stage"
  | "after-source-staging"
  | "after-graph-write"
  | "after-generation-write"
  | "before-publication"
  | "after-status-update"
  | "after-registry-publish"
  | "after-delete-cleanup"
  | "before-delete-unlink"

export interface BrowserGraphStoreOptions {
  poolName?: string
  clearOnInit?: boolean
  faultInjector?: (point: BrowserStorageFaultPoint) => void
}

export interface StagedBrowserGeneration {
  repositoryId: string
  generation: number
  databasePath: string
}

export interface CurrentBrowserGeneration {
  repositoryId: string
  generation: number
  schemaVersion: number
  manifestFingerprint: string
  nodeNames: string[]
  sourceText: string | null
  sourcePaths: string[]
  edgeCount: number
  manifest: unknown
  counts: Record<string, number>
  warnings: unknown[]
}

export interface BrowserRefreshBase {
  repositoryId: string
  generation: number
  manifest: SourceManifest
  sources: BrowserGenerationSource[]
  nodes: Node[]
  edges: Edge[]
}

export interface BrowserQueryPlanEvidence {
  search: string[]
  callers: string[]
  callees: string[]
  graph: string[]
  impact: string[]
}

export class BrowserStorageError extends Error {
  readonly code:
    | "invalid_repository_id"
    | "invalid_generation"
    | "quota_exceeded"
    | "repository_busy"
    | "storage_write_failed"
    | "store_closed"
    | "schema_version_mismatch"
    | "invalid_vector_state"
    | "operation_cancelled"

  constructor(code: BrowserStorageError["code"], message: string) {
    super(message)
    this.code = code
    this.name = "BrowserStorageError"
  }
}

export function registryDatabasePath() {
  return REGISTRY_DATABASE
}

export function generationDatabasePath(
  repositoryId: string,
  generation: number
) {
  if (!OPAQUE_REPOSITORY_ID.test(repositoryId)) {
    throw new BrowserStorageError(
      "invalid_repository_id",
      "Browser storage requires an opaque repository id."
    )
  }
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw new BrowserStorageError(
      "invalid_generation",
      "Browser generation must be a positive integer."
    )
  }
  return `/codegraph/browser/repositories/${repositoryId}/generations/${generation}.sqlite3`
}

function run(db: Database, sql: string, bindings: readonly unknown[] = []) {
  const statement = db.prepare(sql)
  try {
    if (bindings.length > 0) statement.bind(bindings as never)
    statement.step()
  } finally {
    statement.finalize()
  }
}

function encodeVector(values: readonly number[]) {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setFloat32(index * 4, value, true))
  return bytes
}

function decodeVector(value: unknown, dimensions: number) {
  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : undefined
  if (!bytes || bytes.byteLength !== dimensions * 4) {
    throw new BrowserStorageError(
      "invalid_vector_state",
      "Stored semantic vector dimensions are inconsistent."
    )
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({ length: dimensions }, (_, index) =>
    view.getFloat32(index * 4, true)
  )
}

function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftMagnitude += leftValue * leftValue
    rightMagnitude += rightValue * rightValue
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return -1
  return dot / Math.sqrt(leftMagnitude * rightMagnitude)
}

function codeNode(row: Record<string, unknown>): CodeNode {
  return {
    id: String(row.id),
    kind: String(row.kind),
    name: String(row.name),
    ...(row.file_path == null ? {} : { file: String(row.file_path) }),
    ...(row.start_line == null ? {} : { line: Number(row.start_line) }),
    ...(row.signature == null ? {} : { signature: String(row.signature) }),
    ...(row.docstring == null ? {} : { doc: String(row.docstring) }),
  }
}

function ftsPrefixQuery(query: string) {
  return query
    .replace(/::/g, " ")
    .replace(/['"*():^]/g, "")
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .filter((term) => !/^(AND|OR|NOT|NEAR)$/i.test(term))
    .map((term) => `"${term}"*`)
    .join(" OR ")
}

function codeEdge(row: Record<string, unknown>): CodeEdge {
  return {
    source: String(row.source),
    target: String(row.target),
    kind: String(row.kind),
    ...(row.provenance == null ? {} : { provenance: String(row.provenance) }),
  }
}

function storedNode(row: Record<string, unknown>): Node {
  const parseArray = (value: unknown) =>
    value == null ? undefined : (JSON.parse(String(value)) as string[])
  return {
    id: String(row.id),
    kind: String(row.kind) as Node["kind"],
    name: String(row.name),
    qualifiedName: String(row.qualified_name),
    filePath: String(row.file_path),
    language: String(row.language) as Node["language"],
    startLine: Number(row.start_line),
    endLine: Number(row.end_line),
    startColumn: Number(row.start_column),
    endColumn: Number(row.end_column),
    ...(row.docstring == null ? {} : { docstring: String(row.docstring) }),
    ...(row.signature == null ? {} : { signature: String(row.signature) }),
    ...(row.visibility == null
      ? {}
      : { visibility: String(row.visibility) as Node["visibility"] }),
    isExported: Boolean(row.is_exported),
    isAsync: Boolean(row.is_async),
    isStatic: Boolean(row.is_static),
    isAbstract: Boolean(row.is_abstract),
    ...(row.decorators == null
      ? {}
      : { decorators: parseArray(row.decorators) }),
    ...(row.type_parameters == null
      ? {}
      : { typeParameters: parseArray(row.type_parameters) }),
    ...(row.return_type == null ? {} : { returnType: String(row.return_type) }),
    updatedAt: Number(row.updated_at),
  }
}

function storedEdge(row: Record<string, unknown>): Edge {
  return {
    source: String(row.source),
    target: String(row.target),
    kind: String(row.kind) as Edge["kind"],
    ...(row.metadata == null
      ? {}
      : {
          metadata: JSON.parse(String(row.metadata)) as Record<string, unknown>,
        }),
    ...(row.line == null ? {} : { line: Number(row.line) }),
    ...(row.col == null ? {} : { column: Number(row.col) }),
    ...(row.provenance == null
      ? {}
      : { provenance: String(row.provenance) as Edge["provenance"] }),
  }
}

function ensureCanonicalSchema(db: Database) {
  const hasVersionTable = Number(
    db.selectValue(
      "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'schema_versions'"
    ) ?? 0
  )
  const recorded = hasVersionTable
    ? Number(
        db.selectValue(
          "SELECT COALESCE(MAX(version), 0) FROM schema_versions"
        ) ?? 0
      )
    : 0
  if (recorded > BROWSER_SCHEMA_VERSION) {
    throw new BrowserStorageError(
      "schema_version_mismatch",
      `Browser database schema ${recorded} is newer than supported schema ${BROWSER_SCHEMA_VERSION}.`
    )
  }
  db.exec(canonicalSchema)
  run(
    db,
    "INSERT OR IGNORE INTO schema_versions(version, applied_at, description) VALUES (?, ?, ?)",
    [BROWSER_SCHEMA_VERSION, Date.now(), "Canonical browser schema"]
  )
  const current = Number(
    db.selectValue("SELECT MAX(version) FROM schema_versions") ?? 0
  )
  if (current !== BROWSER_SCHEMA_VERSION) {
    throw new BrowserStorageError(
      "schema_version_mismatch",
      `Browser database schema ${current} does not match ${BROWSER_SCHEMA_VERSION}.`
    )
  }
}

function storageFailure(error: unknown) {
  if (error instanceof BrowserStorageError) return error
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new BrowserStorageError(
      "quota_exceeded",
      "Browser storage quota was exceeded."
    )
  }
  return new BrowserStorageError(
    "storage_write_failed",
    error instanceof Error
      ? error.message.slice(0, 240)
      : "Browser storage write failed."
  )
}

export class BrowserGraphStore {
  private closed = false
  private readonly initializedDatabases = new Set<string>()
  private readonly pool: SAHPoolUtil
  private readonly faultInjector?: (point: BrowserStorageFaultPoint) => void

  constructor(
    pool: SAHPoolUtil,
    faultInjector?: (point: BrowserStorageFaultPoint) => void
  ) {
    this.pool = pool
    this.faultInjector = faultInjector
  }

  private openDatabase(filename: string) {
    if (this.closed) {
      throw new BrowserStorageError(
        "store_closed",
        "Browser graph store is closed."
      )
    }
    return new this.pool.OpfsSAHPoolDb(filename)
  }

  private withDatabase<T>(filename: string, callback: (db: Database) => T): T {
    const db = this.openDatabase(filename)
    try {
      if (!this.initializedDatabases.has(filename)) {
        ensureCanonicalSchema(db)
        this.initializedDatabases.add(filename)
      }
      return callback(db)
    } finally {
      db.close()
    }
  }

  private unlinkDatabase(filename: string) {
    this.initializedDatabases.delete(filename)
    this.pool.unlink(filename)
  }

  async initialize() {
    await this.pool.reserveMinimumCapacity(MINIMUM_POOL_CAPACITY)
    this.withDatabase(REGISTRY_DATABASE, () => undefined)
    this.recoverIncompleteGenerations()
    this.cleanupRolledBackGenerationFiles()
  }

  private cleanupRolledBackGenerationFiles(repositoryId?: string): string[] {
    const obsolete = this.withDatabase(REGISTRY_DATABASE, (db) =>
      db.selectObjects(
        `SELECT repository_id, generation, status
         FROM index_generations
         WHERE status IN ('rolled_back', 'deleted')
           AND (? IS NULL OR repository_id = ?)
         ORDER BY repository_id, generation`,
        [repositoryId ?? null, repositoryId ?? null]
      )
    )
    const retained: string[] = []
    for (const row of obsolete) {
      const filename = generationDatabasePath(
        String(row.repository_id),
        Number(row.generation)
      )
      try {
        this.unlinkDatabase(filename)
        this.withDatabase(REGISTRY_DATABASE, (db) => {
          run(
            db,
            `DELETE FROM index_generations
             WHERE repository_id = ? AND generation = ?
               AND status IN ('rolled_back', 'deleted')`,
            [String(row.repository_id), Number(row.generation)]
          )
        })
      } catch {
        retained.push(filename)
      }
    }
    return retained
  }

  listDatabaseFiles(): string[] {
    return this.pool.getFileNames().sort()
  }

  private nextGeneration(repositoryId: string) {
    return this.withDatabase(REGISTRY_DATABASE, (db) => {
      const value = db.selectValue(
        "SELECT COALESCE(MAX(generation), 0) + 1 FROM index_generations WHERE repository_id = ?",
        [repositoryId]
      )
      return Number(value ?? 1)
    })
  }

  private insertRegistryStaging(
    input: BrowserGenerationInput,
    generation: number
  ) {
    this.withDatabase(REGISTRY_DATABASE, (db) => {
      run(
        db,
        `INSERT INTO index_generations(
          repository_id, generation, schema_version, status, manifest_fingerprint,
          manifest_json, counts_json, warnings_json, started_at
        ) VALUES (?, ?, ?, 'building', ?, ?, ?, ?, ?)`,
        [
          input.repositoryId,
          generation,
          BROWSER_SCHEMA_VERSION,
          input.manifestFingerprint,
          JSON.stringify(input.manifest),
          JSON.stringify(input.counts),
          JSON.stringify(input.warnings),
          Date.now(),
        ]
      )
    })
  }

  private writeGenerationDatabase(
    input: BrowserGenerationInput,
    staged: StagedBrowserGeneration
  ) {
    this.withDatabase(staged.databasePath, (db) => {
      db.transaction("IMMEDIATE", () => {
        for (const source of input.sources) {
          run(
            db,
            `INSERT INTO source_cache(
              repository_id, generation, path, content_hash, language,
              size_bytes, mtime_hint, text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              input.repositoryId,
              staged.generation,
              source.path,
              source.contentHash,
              source.language,
              source.size,
              source.mtimeHint ?? null,
              source.text,
            ]
          )
          run(
            db,
            `INSERT INTO files(
              path, content_hash, language, size, modified_at, indexed_at, node_count, errors
            ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
            [
              source.path,
              source.contentHash,
              source.language,
              source.size,
              source.mtimeHint ?? 0,
              Date.now(),
            ]
          )
        }
        this.faultInjector?.("after-source-staging")
        for (const node of input.nodes) {
          run(
            db,
            `INSERT INTO nodes(
              id, kind, name, qualified_name, file_path, language,
              start_line, end_line, start_column, end_column, docstring,
              signature, visibility, is_exported, is_async, is_static,
              is_abstract, decorators, type_parameters, return_type, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              node.id,
              node.kind,
              node.name,
              node.qualifiedName,
              node.filePath,
              node.language,
              node.startLine,
              node.endLine,
              node.startColumn,
              node.endColumn,
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
              node.updatedAt,
            ]
          )
        }
        for (const edge of input.edges) {
          run(
            db,
            `INSERT INTO edges(source, target, kind, metadata, line, col, provenance)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              edge.source,
              edge.target,
              edge.kind,
              edge.metadata ? JSON.stringify(edge.metadata) : null,
              edge.line ?? null,
              edge.column ?? null,
              edge.provenance ?? null,
            ]
          )
        }
        this.faultInjector?.("after-graph-write")
        run(
          db,
          `INSERT INTO index_generations(
            repository_id, generation, schema_version, status, manifest_fingerprint,
            manifest_json, counts_json, warnings_json, started_at, published_at
          ) VALUES (?, ?, ?, 'published', ?, ?, ?, ?, ?, ?)`,
          [
            input.repositoryId,
            staged.generation,
            BROWSER_SCHEMA_VERSION,
            input.manifestFingerprint,
            JSON.stringify(input.manifest),
            JSON.stringify(input.counts),
            JSON.stringify(input.warnings),
            Date.now(),
            Date.now(),
          ]
        )
      })
    })
  }

  async stageGeneration(
    input: BrowserGenerationInput
  ): Promise<StagedBrowserGeneration> {
    const generation = this.nextGeneration(input.repositoryId)
    const staged = {
      repositoryId: input.repositoryId,
      generation,
      databasePath: generationDatabasePath(input.repositoryId, generation),
    }
    try {
      this.insertRegistryStaging(input, generation)
      this.faultInjector?.("after-registry-stage")
      this.writeGenerationDatabase(input, staged)
      this.faultInjector?.("after-generation-write")
      return staged
    } catch (error) {
      const failure = storageFailure(error)
      this.markGenerationFailed(staged, failure)
      this.unlinkDatabase(staged.databasePath)
      try {
        this.faultInjector?.("after-delete-cleanup")
      } catch (cleanupError) {
        throw storageFailure(cleanupError)
      }
      throw failure
    }
  }

  async commitStagedGeneration(
    input: BrowserGenerationInput,
    staged: StagedBrowserGeneration
  ) {
    try {
      this.faultInjector?.("before-publication")
      this.withDatabase(REGISTRY_DATABASE, (db) => {
        db.transaction("IMMEDIATE", () => {
          run(
            db,
            `UPDATE index_generations
             SET status = 'rolled_back'
             WHERE repository_id = ? AND status = 'published'`,
            [input.repositoryId]
          )
          run(
            db,
            `UPDATE index_generations
             SET status = 'published', published_at = ?
             WHERE repository_id = ? AND generation = ? AND status = 'building'`,
            [Date.now(), input.repositoryId, staged.generation]
          )
          this.faultInjector?.("after-status-update")
          run(
            db,
            `INSERT INTO index_publications(
              repository_id, current_generation, last_success_generation, status, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(repository_id) DO UPDATE SET
              current_generation = excluded.current_generation,
              last_success_generation = excluded.last_success_generation,
              status = excluded.status,
              updated_at = excluded.updated_at`,
            [
              input.repositoryId,
              staged.generation,
              staged.generation,
              input.warnings.length > 0 ? "partial" : "ready",
              Date.now(),
            ]
          )
          this.faultInjector?.("after-registry-publish")
        })
      })
    } catch (error) {
      const failure = storageFailure(error)
      this.markGenerationFailed(staged, failure)
      this.unlinkDatabase(staged.databasePath)
      try {
        this.faultInjector?.("after-delete-cleanup")
      } catch (cleanupError) {
        throw storageFailure(cleanupError)
      }
      throw failure
    }
    const cleanupWarnings = this.cleanupRolledBackGenerationFiles(
      input.repositoryId
    )
    return {
      repositoryId: input.repositoryId,
      generation: staged.generation,
      ...(cleanupWarnings.length > 0 ? { cleanupWarnings } : {}),
    }
  }

  async publishGeneration(input: BrowserGenerationInput) {
    const staged = await this.stageGeneration(input)
    return this.commitStagedGeneration(input, staged)
  }

  discardStagedGeneration(staged: StagedBrowserGeneration) {
    this.markGenerationFailed(
      staged,
      new BrowserStorageError(
        "operation_cancelled",
        "Browser generation staging was cancelled before publication."
      )
    )
    this.unlinkDatabase(staged.databasePath)
  }

  private markGenerationFailed(
    staged: StagedBrowserGeneration,
    failure: BrowserStorageError
  ) {
    try {
      this.withDatabase(REGISTRY_DATABASE, (db) => {
        run(
          db,
          `UPDATE index_generations
           SET status = 'failed', failure_code = ?, failure_message = ?
           WHERE repository_id = ? AND generation = ? AND status = 'building'`,
          [
            failure.code,
            failure.message.slice(0, 240),
            staged.repositoryId,
            staged.generation,
          ]
        )
      })
    } catch {
      // The next successful open recovers any row which remains in building.
    }
  }

  recoverIncompleteGenerations() {
    const incomplete = this.withDatabase(REGISTRY_DATABASE, (db) =>
      db.selectObjects(
        `SELECT repository_id, generation
         FROM index_generations
         WHERE status = 'building'
         ORDER BY repository_id, generation`
      )
    )
    if (incomplete.length === 0) return
    this.withDatabase(REGISTRY_DATABASE, (db) => {
      db.transaction("IMMEDIATE", () => {
        for (const row of incomplete) {
          run(
            db,
            `UPDATE index_generations
             SET status = 'failed', failure_code = 'incomplete_staging',
                 failure_message = 'Incomplete staging recovered on open.'
             WHERE repository_id = ? AND generation = ? AND status = 'building'`,
            [String(row.repository_id), Number(row.generation)]
          )
        }
      })
    })
    for (const row of incomplete) {
      this.unlinkDatabase(
        generationDatabasePath(
          String(row.repository_id),
          Number(row.generation)
        )
      )
    }
  }

  readCurrent(repositoryId: string): CurrentBrowserGeneration | null {
    const publication = this.withDatabase(REGISTRY_DATABASE, (db) =>
      db.selectObject(
        `SELECT p.current_generation, g.schema_version, g.manifest_fingerprint,
                g.manifest_json, g.counts_json, g.warnings_json
         FROM index_publications p
         JOIN index_generations g
           ON g.repository_id = p.repository_id
          AND g.generation = p.current_generation
         WHERE p.repository_id = ?`,
        [repositoryId]
      )
    )
    if (!publication) return null
    const generation = Number(publication.current_generation)
    return this.withDatabase(
      generationDatabasePath(repositoryId, generation),
      (db) => ({
        repositoryId,
        generation,
        schemaVersion: Number(publication.schema_version),
        manifestFingerprint: String(publication.manifest_fingerprint),
        nodeNames: db
          .selectValues("SELECT name FROM nodes ORDER BY name")
          .map(String),
        sourceText:
          (db.selectValue(
            "SELECT text FROM source_cache ORDER BY path LIMIT 1"
          ) as string | undefined) ?? null,
        sourcePaths: db
          .selectValues("SELECT path FROM source_cache ORDER BY path")
          .map(String),
        edgeCount: Number(db.selectValue("SELECT COUNT(*) FROM edges") ?? 0),
        manifest: JSON.parse(
          String(publication.manifest_json ?? "[]")
        ) as unknown,
        counts: JSON.parse(String(publication.counts_json ?? "{}")) as Record<
          string,
          number
        >,
        warnings: JSON.parse(
          String(publication.warnings_json ?? "[]")
        ) as unknown[],
      })
    )
  }

  private currentGeneration(repositoryId: string) {
    const publication = this.withDatabase(REGISTRY_DATABASE, (db) =>
      db.selectObject(
        `SELECT p.current_generation, p.status, g.manifest_fingerprint,
                g.manifest_json, g.counts_json, g.warnings_json, g.published_at
         FROM index_publications p
         JOIN index_generations g
           ON g.repository_id = p.repository_id
          AND g.generation = p.current_generation
         WHERE p.repository_id = ?`,
        [repositoryId]
      )
    )
    if (!publication) return null
    const generation = Number(publication.current_generation)
    return {
      generation,
      databasePath: generationDatabasePath(repositoryId, generation),
      status: String(publication.status),
      manifestFingerprint: String(publication.manifest_fingerprint),
      manifest: JSON.parse(
        String(publication.manifest_json ?? "[]")
      ) as unknown,
      counts: JSON.parse(String(publication.counts_json ?? "{}")) as Record<
        string,
        number
      >,
      warnings: JSON.parse(
        String(publication.warnings_json ?? "[]")
      ) as unknown[],
      publishedAt:
        publication.published_at == null
          ? null
          : Number(publication.published_at),
    }
  }

  getPublishedGeneration(repositoryId: string): number {
    const current = this.currentGeneration(repositoryId)
    if (!current) {
      throw new BrowserStorageError(
        "invalid_generation",
        "The browser-local repository has no published generation."
      )
    }
    return current.generation
  }

  listEmbeddingSymbols(
    repositoryId: string,
    graphGeneration: number
  ): BrowserEmbeddingSymbol[] {
    const current = this.currentGeneration(repositoryId)
    if (!current || current.generation !== graphGeneration) {
      throw new BrowserStorageError(
        "invalid_generation",
        "Semantic inputs do not match the published graph generation."
      )
    }
    return this.withDatabase(current.databasePath, (db) =>
      db
        .selectObjects(
          `SELECT id, kind, name, signature, docstring
           FROM nodes
           ORDER BY id`
        )
        .map((row) => ({
          nodeId: String(row.id),
          kind: String(row.kind),
          name: String(row.name),
          ...(row.signature == null
            ? {}
            : { signature: String(row.signature) }),
          ...(row.docstring == null
            ? {}
            : { docstring: String(row.docstring) }),
        }))
    )
  }

  writeEmbeddingVectors(
    repositoryId: string,
    graphGeneration: number,
    rows: readonly EmbeddingVectorRow[]
  ): void {
    const current = this.currentGeneration(repositoryId)
    if (!current || current.generation !== graphGeneration) {
      throw new BrowserStorageError(
        "invalid_generation",
        "Semantic vector writes do not match the published graph generation."
      )
    }
    if (rows.length > BROWSER_VECTOR_WRITE_LIMIT) {
      throw new BrowserStorageError(
        "invalid_vector_state",
        "Semantic vector writes exceed the transaction row budget."
      )
    }
    if (rows.length === 0) return
    const model = rows[0]?.model
    const dimensions = rows[0]?.dimensions
    if (
      !model ||
      !Number.isSafeInteger(dimensions) ||
      (dimensions ?? 0) <= 0 ||
      rows.some(
        (row) =>
          row.model !== model ||
          row.dimensions !== dimensions ||
          row.values.length !== dimensions ||
          row.values.some((value) => !Number.isFinite(value)) ||
          row.inputHash.length === 0
      )
    ) {
      throw new BrowserStorageError(
        "invalid_vector_state",
        "Semantic vector rows must converge on one model and dimension."
      )
    }
    this.withDatabase(current.databasePath, (db) => {
      db.transaction("IMMEDIATE", () => {
        for (const row of rows) {
          const nodeExists = Number(
            db.selectValue("SELECT COUNT(*) FROM nodes WHERE id = ?", [
              row.nodeId,
            ]) ?? 0
          )
          if (nodeExists !== 1) {
            throw new BrowserStorageError(
              "invalid_vector_state",
              "Semantic vector target is absent from the published graph."
            )
          }
          run(
            db,
            `INSERT INTO node_vectors(node_id, model, dims, vector, input_hash)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(node_id) DO UPDATE SET
               model = excluded.model,
               dims = excluded.dims,
               vector = excluded.vector,
               input_hash = excluded.input_hash`,
            [
              row.nodeId,
              row.model,
              row.dimensions,
              encodeVector(row.values),
              row.inputHash,
            ]
          )
        }
        const metadata = [
          ["embedding_model", model],
          ["embedding_dims", String(dimensions)],
          ["embedding_graph_generation", String(graphGeneration)],
        ] as const
        for (const [key, value] of metadata) {
          run(
            db,
            `INSERT INTO project_metadata(key, value, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at`,
            [key, value, Date.now()]
          )
        }
      })
    })
  }

  readEmbeddingVectorMetadata(repositoryId: string): Array<{
    nodeId: string
    model: string
    dimensions: number
    inputHash: string
    byteLength: number
  }> {
    const current = this.currentGeneration(repositoryId)
    if (!current) return []
    return this.withDatabase(current.databasePath, (db) =>
      db
        .selectObjects(
          `SELECT node_id, model, dims, input_hash, length(vector) AS byte_length
           FROM node_vectors
           ORDER BY node_id`
        )
        .map((row) => ({
          nodeId: String(row.node_id),
          model: String(row.model),
          dimensions: Number(row.dims),
          inputHash: String(row.input_hash),
          byteLength: Number(row.byte_length),
        }))
    )
  }

  saveEmbeddingState(
    repositoryId: string,
    state: EmbeddingSemanticState
  ): void {
    const current = this.currentGeneration(repositoryId)
    if (!current || current.generation !== state.graphGeneration) {
      throw new BrowserStorageError(
        "invalid_generation",
        "Semantic state does not match the published graph generation."
      )
    }
    const safeState: EmbeddingSemanticState = {
      status: state.status,
      graphGeneration: state.graphGeneration,
      model: state.model,
      ...(state.dimensions ? { dimensions: state.dimensions } : {}),
      completedItems: state.completedItems,
      inputHashes: [...state.inputHashes],
      ...(state.failureCode ? { failureCode: state.failureCode } : {}),
    }
    this.withDatabase(current.databasePath, (db) => {
      run(
        db,
        `INSERT INTO project_metadata(key, value, updated_at)
         VALUES ('browser_embedding_state', ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
        [JSON.stringify(safeState), Date.now()]
      )
    })
  }

  readEmbeddingState(repositoryId: string): EmbeddingSemanticState | undefined {
    const current = this.currentGeneration(repositoryId)
    if (!current) return undefined
    return this.withDatabase(current.databasePath, (db) => {
      const value = db.selectValue(
        "SELECT value FROM project_metadata WHERE key = 'browser_embedding_state'"
      )
      if (typeof value !== "string") return undefined
      try {
        return JSON.parse(value) as EmbeddingSemanticState
      } catch {
        return undefined
      }
    })
  }

  readRefreshBase(repositoryId: string): BrowserRefreshBase {
    const current = this.currentGeneration(repositoryId)
    if (!current) {
      throw new BrowserStorageError(
        "invalid_generation",
        "The browser-local repository has no published refresh base."
      )
    }
    return this.withDatabase(current.databasePath, (db) => ({
      repositoryId,
      generation: current.generation,
      manifest: current.manifest as SourceManifest,
      sources: db
        .selectObjects(
          `SELECT path, content_hash, language, size_bytes, mtime_hint, text
           FROM source_cache
           WHERE repository_id = ? AND generation = ?
           ORDER BY path`,
          [repositoryId, current.generation]
        )
        .map((row) => ({
          path: String(row.path),
          contentHash: String(row.content_hash),
          language: String(row.language),
          size: Number(row.size_bytes),
          text: String(row.text),
          ...(row.mtime_hint == null
            ? {}
            : { mtimeHint: Number(row.mtime_hint) }),
        })),
      nodes: db
        .selectObjects("SELECT * FROM nodes ORDER BY id")
        .map(storedNode),
      edges: db
        .selectObjects("SELECT * FROM edges ORDER BY source, target, kind, id")
        .map(storedEdge),
    }))
  }

  listRepositories(
    metadata: ReadonlyMap<
      string,
      Pick<Repository, "name" | "sourceKind">
    > = new Map()
  ): Repository[] {
    const publications = this.withDatabase(REGISTRY_DATABASE, (db) =>
      db.selectObjects(
        `SELECT p.repository_id, g.manifest_json
           FROM index_publications p
           JOIN index_generations g
             ON g.repository_id = p.repository_id
            AND g.generation = p.current_generation
           ORDER BY p.updated_at DESC`
      )
    )
    return publications.map((publication, index) => {
      const id = String(publication.repository_id)
      let durable: SourceManifest["repository"]
      try {
        const manifest = JSON.parse(
          String(publication.manifest_json ?? "{}")
        ) as SourceManifest
        if (
          manifest.repository &&
          typeof manifest.repository.name === "string" &&
          (manifest.repository.sourceKind === "picked-folder" ||
            manifest.repository.sourceKind === "dropped-snapshot" ||
            manifest.repository.sourceKind === "imported-snapshot")
        ) {
          durable = manifest.repository
        }
      } catch {
        durable = undefined
      }
      return {
        id,
        root: `local://${id}`,
        name: metadata.get(id)?.name ?? durable?.name ?? "Browser repository",
        default: index === 0,
        runtime: "local",
        sourceKind:
          metadata.get(id)?.sourceKind ??
          durable?.sourceKind ??
          "picked-folder",
      }
    })
  }

  getRepositoryStatus(
    repositoryId: string,
    name = "Browser repository"
  ): RepositoryStatus {
    const current = this.currentGeneration(repositoryId)
    if (!current) {
      throw new BrowserStorageError(
        "invalid_generation",
        "The browser-local repository has no published generation."
      )
    }
    return this.withDatabase(current.databasePath, (db) => ({
      version: String(BROWSER_SCHEMA_VERSION),
      repo: {
        id: repositoryId,
        root: `local://${repositoryId}`,
        name,
      },
      index: {
        state: current.status === "partial" ? "partial-warning" : "ready",
        generation: current.generation,
        fileCount: Number(
          db.selectValue("SELECT COUNT(*) FROM source_cache") ?? 0
        ),
        nodeCount: Number(db.selectValue("SELECT COUNT(*) FROM nodes") ?? 0),
        edgeCount: Number(db.selectValue("SELECT COUNT(*) FROM edges") ?? 0),
        lastIndexed:
          current.publishedAt == null
            ? null
            : new Date(current.publishedAt).toISOString(),
      },
    }))
  }

  search(
    repositoryId: string,
    query: string,
    limit = 50,
    offset = 0
  ): SearchResult {
    const current = this.currentGeneration(repositoryId)
    if (!current) {
      return { items: [], total: 0, limit, offset, degraded: false }
    }
    return this.withDatabase(current.databasePath, (db) => {
      const ftsQuery = ftsPrefixQuery(query)
      if (ftsQuery) {
        const total = Number(
          db.selectValue(
            `SELECT COUNT(*) FROM nodes_fts WHERE nodes_fts MATCH ?`,
            [ftsQuery]
          ) ?? 0
        )
        if (total > 0) {
          const items = db
            .selectObjects(
              `SELECT nodes.id, nodes.kind, nodes.name, nodes.file_path,
                      nodes.start_line, nodes.signature, nodes.docstring
               FROM nodes_fts
               JOIN nodes ON nodes_fts.id = nodes.id
               WHERE nodes_fts MATCH ?
               ORDER BY bm25(nodes_fts, 0, 20, 5, 1, 2), nodes.name, nodes.id
               LIMIT ? OFFSET ?`,
              [ftsQuery, limit, offset]
            )
            .map(codeNode)
          return { items, total, limit, offset, degraded: false }
        }
      }
      const pattern = `%${query}%`
      const total = Number(
        db.selectValue(
          `SELECT COUNT(*) FROM nodes
           WHERE name LIKE ? OR qualified_name LIKE ? OR file_path LIKE ?`,
          [pattern, pattern, pattern]
        ) ?? 0
      )
      const items = db
        .selectObjects(
          `SELECT id, kind, name, file_path, start_line, signature, docstring
           FROM nodes
           WHERE name LIKE ? OR qualified_name LIKE ? OR file_path LIKE ?
           ORDER BY name, id
           LIMIT ? OFFSET ?`,
          [pattern, pattern, pattern, limit, offset]
        )
        .map(codeNode)
      return { items, total, limit, offset, degraded: false }
    })
  }

  semanticSearch(
    repositoryId: string,
    graphGeneration: number,
    model: string,
    dimensions: number,
    vector: readonly number[],
    limit = 50,
    offset = 0
  ): SearchResult {
    const current = this.currentGeneration(repositoryId)
    if (!current || current.generation !== graphGeneration) {
      throw new BrowserStorageError(
        "invalid_generation",
        "Semantic search does not match the published graph generation."
      )
    }
    if (
      !model ||
      !Number.isSafeInteger(dimensions) ||
      dimensions <= 0 ||
      vector.length !== dimensions ||
      vector.some((value) => !Number.isFinite(value))
    ) {
      throw new BrowserStorageError(
        "invalid_vector_state",
        "The semantic query vector is invalid."
      )
    }
    return this.withDatabase(current.databasePath, (db) => {
      const metadata = new Map(
        db
          .selectObjects(
            `SELECT key, value FROM project_metadata
             WHERE key IN ('embedding_model', 'embedding_dims', 'embedding_graph_generation')`
          )
          .map((row) => [String(row.key), String(row.value)])
      )
      if (
        metadata.get("embedding_model") !== model ||
        Number(metadata.get("embedding_dims")) !== dimensions ||
        Number(metadata.get("embedding_graph_generation")) !== graphGeneration
      ) {
        throw new BrowserStorageError(
          "invalid_vector_state",
          "Semantic vectors do not match the requested model, dimensions, and graph generation."
        )
      }
      const scored = db
        .selectObjects(
          `SELECT nodes.id, nodes.kind, nodes.name, nodes.file_path,
                  nodes.start_line, nodes.signature, nodes.docstring,
                  node_vectors.vector
           FROM node_vectors
           JOIN nodes ON nodes.id = node_vectors.node_id
           WHERE node_vectors.model = ? AND node_vectors.dims = ?`,
          [model, dimensions]
        )
        .map((row) => ({
          node: codeNode(row),
          score: cosineSimilarity(vector, decodeVector(row.vector, dimensions)),
        }))
        .sort((left, right) => {
          if (left.score !== right.score) return right.score - left.score
          if (left.node.name !== right.node.name) {
            return left.node.name < right.node.name ? -1 : 1
          }
          return left.node.id < right.node.id
            ? -1
            : left.node.id === right.node.id
              ? 0
              : 1
        })
      return {
        items: scored.slice(offset, offset + limit).map(({ node }) => node),
        total: scored.length,
        limit,
        offset,
        degraded: false,
      }
    })
  }

  getNode(repositoryId: string, nodeId: string): CodeNode {
    const current = this.currentGeneration(repositoryId)
    const row = current
      ? this.withDatabase(current.databasePath, (db) =>
          db.selectObject(
            `SELECT id, kind, name, file_path, start_line, signature, docstring
             FROM nodes WHERE id = ?`,
            [nodeId]
          )
        )
      : undefined
    if (!row) {
      throw new BrowserStorageError(
        "invalid_generation",
        "The requested browser-local symbol is unavailable."
      )
    }
    return codeNode(row)
  }

  getSource(repositoryId: string, nodeId: string): SourceResult {
    const current = this.currentGeneration(repositoryId)
    const row = current
      ? this.withDatabase(current.databasePath, (db) =>
          db.selectObject(
            `SELECT s.text, s.language, s.content_hash
             FROM nodes n
             JOIN source_cache s ON s.path = n.file_path
             WHERE n.id = ? AND s.repository_id = ? AND s.generation = ?`,
            [nodeId, repositoryId, current.generation]
          )
        )
      : undefined
    if (!row) {
      throw new BrowserStorageError(
        "invalid_generation",
        "The requested cached browser source is unavailable."
      )
    }
    return {
      text: String(row.text),
      languageId: String(row.language),
      contentHash: String(row.content_hash),
      snapshotToken: `${repositoryId}:${current!.generation}`,
    }
  }

  relationships(
    repositoryId: string,
    nodeId: string,
    direction: "callers" | "callees",
    limit?: number,
    offset?: number
  ): ListResult<CodeNode> {
    const page = normalizeRelationshipRequest({ limit, offset })
    const current = this.currentGeneration(repositoryId)
    if (!current) {
      return {
        items: [],
        total: 0,
        limit: page.limit,
        offset: page.offset,
      }
    }
    const joinColumn = direction === "callers" ? "source" : "target"
    const matchColumn = direction === "callers" ? "target" : "source"
    const edgeIndex =
      direction === "callers"
        ? "idx_edges_target_kind"
        : "idx_edges_source_kind"
    return this.withDatabase(current.databasePath, (db) => {
      const total = Number(
        db.selectValue(
          `SELECT COUNT(DISTINCT ${joinColumn})
           FROM edges INDEXED BY ${edgeIndex}
           WHERE kind = 'calls' AND ${matchColumn} = ?`,
          [nodeId]
        ) ?? 0
      )
      const items = db
        .selectObjects(
          `SELECT DISTINCT n.id, n.kind, n.name, n.file_path, n.start_line,
                           n.signature, n.docstring
           FROM edges e INDEXED BY ${edgeIndex}
           JOIN nodes n ON n.id = e.${joinColumn}
           WHERE e.kind = 'calls' AND e.${matchColumn} = ?
           ORDER BY n.name, n.id
           LIMIT ? OFFSET ?`,
          [nodeId, page.limit, page.offset]
        )
        .map(codeNode)
      return {
        items,
        total,
        limit: page.limit,
        offset: page.offset,
      }
    })
  }

  graph(repositoryId: string, nodeId: string, depth?: number): GraphResult {
    const graphDepth = normalizeDepthRequest({ depth }).depth
    const current = this.currentGeneration(repositoryId)
    if (!current) return { nodes: [], edges: [], truncated: false }
    return this.withDatabase(current.databasePath, (db) => {
      const focal = db.selectObject(
        `SELECT id, kind, name, file_path, start_line, signature, docstring
         FROM nodes
         WHERE id = ?`,
        [nodeId]
      )
      if (!focal) {
        throw new BrowserStorageError(
          "invalid_generation",
          "The requested browser-local graph root is unavailable."
        )
      }

      const visited = new Set<string>([nodeId])
      let frontier = [nodeId]
      const edgeRows: Array<Record<string, unknown>> = []
      const seenEdges = new Set<string>()
      let inspectedCandidates = 0
      let truncated = false

      for (
        let currentDepth = 0;
        currentDepth < graphDepth && frontier.length > 0;
        currentDepth += 1
      ) {
        const remainingCandidates =
          REPOSITORY_QUERY_LIMITS.maxGraphEdges - inspectedCandidates
        if (remainingCandidates <= 0) {
          truncated = true
          break
        }
        const placeholders = frontier.map(() => "?").join(", ")
        const candidates = db.selectObjects(
          `SELECT source, target, kind, provenance
           FROM edges
           WHERE source IN (${placeholders})
              OR target IN (${placeholders})
           ORDER BY source, target, kind
           LIMIT ?`,
          [...frontier, ...frontier, remainingCandidates + 1]
        )
        if (candidates.length > remainingCandidates) truncated = true
        const next = new Set<string>()
        for (const row of candidates.slice(0, remainingCandidates)) {
          inspectedCandidates += 1
          const source = String(row.source)
          const target = String(row.target)
          const edgeId = `${source}\u0000${target}\u0000${String(row.kind)}`
          let keepEdge = true
          for (const candidateId of [source, target]) {
            if (visited.has(candidateId)) continue
            if (visited.size >= REPOSITORY_QUERY_LIMITS.maxGraphNodes) {
              truncated = true
              keepEdge = false
              continue
            }
            visited.add(candidateId)
            next.add(candidateId)
          }
          if (keepEdge && !seenEdges.has(edgeId)) {
            seenEdges.add(edgeId)
            edgeRows.push(row)
          }
        }
        frontier = [...next].sort()
        if (
          visited.size >= REPOSITORY_QUERY_LIMITS.maxGraphNodes ||
          inspectedCandidates >= REPOSITORY_QUERY_LIMITS.maxGraphEdges
        ) {
          if (frontier.length > 0 || candidates.length > remainingCandidates) {
            truncated = true
          }
          break
        }
      }

      const ids = [...visited].sort()
      const placeholders = ids.map(() => "?").join(", ")
      const nodes = db
        .selectObjects(
          `SELECT id, kind, name, file_path, start_line, signature, docstring
           FROM nodes
           WHERE id IN (${placeholders})
           ORDER BY id`,
          ids
        )
        .map(codeNode)
      return {
        nodes,
        edges: edgeRows.map(codeEdge),
        truncated,
      }
    })
  }

  impact(repositoryId: string, nodeId: string, depth?: number): GraphResult {
    const impactDepth = normalizeDepthRequest(
      { depth },
      REPOSITORY_QUERY_LIMITS.defaultImpactDepth
    ).depth
    const current = this.currentGeneration(repositoryId)
    if (!current) return { nodes: [], edges: [], truncated: false }
    return this.withDatabase(current.databasePath, (db) => {
      const focal = db.selectObject(
        `SELECT id, kind, name, file_path, start_line, signature, docstring
         FROM nodes
         WHERE id = ?`,
        [nodeId]
      )
      if (!focal) {
        throw new BrowserStorageError(
          "invalid_generation",
          "The requested browser-local impact root is unavailable."
        )
      }

      const visited = new Set<string>([nodeId])
      const nodeRows = new Map<string, Record<string, unknown>>([
        [nodeId, focal],
      ])
      const seenEdges = new Set<string>()
      const edgeRows: Array<Record<string, unknown>> = []
      let frontier = [nodeId]
      let inspectedCandidates = 0
      let truncated = false

      const remainingEdgeBudget = () =>
        REPOSITORY_QUERY_LIMITS.maxGraphEdges - inspectedCandidates
      const recordCandidates = (
        candidates: Array<Record<string, unknown>>,
        adjacentColumn: "source" | "target",
        next: Set<string>
      ) => {
        const remaining = remainingEdgeBudget()
        if (candidates.length > remaining) truncated = true
        for (const row of candidates.slice(0, remaining)) {
          inspectedCandidates += 1
          const source = String(row.source)
          const target = String(row.target)
          const adjacentId = String(row[adjacentColumn])
          const edgeId = `${source}\u0000${target}\u0000${String(row.kind)}`
          if (!visited.has(adjacentId)) {
            if (visited.size >= REPOSITORY_QUERY_LIMITS.maxGraphNodes) {
              truncated = true
              continue
            }
            visited.add(adjacentId)
            nodeRows.set(adjacentId, {
              id: adjacentId,
              kind: row.adjacent_kind,
              name: row.name,
              file_path: row.file_path,
              start_line: row.start_line,
              signature: row.signature,
              docstring: row.docstring,
            })
            next.add(adjacentId)
          }
          if (!seenEdges.has(edgeId)) {
            seenEdges.add(edgeId)
            edgeRows.push(row)
          }
        }
      }

      for (
        let currentDepth = 0;
        currentDepth < impactDepth && frontier.length > 0;
        currentDepth += 1
      ) {
        const sameDepth = new Set(frontier)
        let containerFrontier = frontier.filter((id) =>
          IMPACT_CONTAINER_KINDS.has(String(nodeRows.get(id)?.kind ?? ""))
        )

        while (containerFrontier.length > 0 && remainingEdgeBudget() > 0) {
          const placeholders = containerFrontier.map(() => "?").join(", ")
          const candidates = db.selectObjects(
            `SELECT e.source, e.target, e.kind, e.provenance,
                    n.id, n.kind AS adjacent_kind, n.name, n.file_path,
                    n.start_line, n.signature, n.docstring
             FROM edges e INDEXED BY idx_edges_source_kind
             JOIN nodes n ON n.id = e.target
             WHERE e.source IN (${placeholders})
               AND e.kind = 'contains'
             ORDER BY e.source, e.target, e.kind
             LIMIT ?`,
            [...containerFrontier, remainingEdgeBudget() + 1]
          )
          const added = new Set<string>()
          recordCandidates(candidates, "target", added)
          for (const id of added) {
            sameDepth.add(id)
          }
          containerFrontier = [...added]
            .filter((id) =>
              IMPACT_CONTAINER_KINDS.has(String(nodeRows.get(id)?.kind ?? ""))
            )
            .sort()
        }

        if (remainingEdgeBudget() <= 0) {
          truncated = true
          break
        }
        const currentIds = [...sameDepth].sort()
        const placeholders = currentIds.map(() => "?").join(", ")
        const candidates = db.selectObjects(
          `SELECT e.source, e.target, e.kind, e.provenance,
                  n.id, n.kind AS adjacent_kind, n.name, n.file_path,
                  n.start_line, n.signature, n.docstring
           FROM edges e INDEXED BY idx_edges_target_kind
           JOIN nodes n ON n.id = e.source
           WHERE e.target IN (${placeholders})
             AND e.kind <> 'contains'
           ORDER BY e.target, e.source, e.kind
           LIMIT ?`,
          [...currentIds, remainingEdgeBudget() + 1]
        )
        const next = new Set<string>()
        recordCandidates(candidates, "source", next)
        frontier = [...next].sort()
      }

      const ids = [...visited].sort()
      const placeholders = ids.map(() => "?").join(", ")
      const nodes = db
        .selectObjects(
          `SELECT id, kind, name, file_path, start_line, signature, docstring
           FROM nodes
           WHERE id IN (${placeholders})
           ORDER BY id`,
          ids
        )
        .map(codeNode)
      return {
        nodes,
        edges: edgeRows
          .sort(
            (left, right) =>
              String(left.source).localeCompare(String(right.source)) ||
              String(left.target).localeCompare(String(right.target)) ||
              String(left.kind).localeCompare(String(right.kind))
          )
          .map(codeEdge),
        truncated,
      }
    })
  }

  queryPlans(repositoryId: string): BrowserQueryPlanEvidence {
    const current = this.currentGeneration(repositoryId)
    if (!current) {
      throw new BrowserStorageError(
        "invalid_generation",
        "The browser-local repository has no published query plan."
      )
    }
    return this.withDatabase(current.databasePath, (db) => {
      const explain = (sql: string, bindings: readonly unknown[]) =>
        db
          .selectObjects(`EXPLAIN QUERY PLAN ${sql}`, bindings as never)
          .map((row) => String(row.detail))
      return {
        search: explain(
          `SELECT nodes.id
           FROM nodes_fts
           JOIN nodes ON nodes_fts.id = nodes.id
           WHERE nodes_fts MATCH ?
           ORDER BY bm25(nodes_fts, 0, 20, 5, 1, 2), nodes.name, nodes.id
           LIMIT ? OFFSET ?`,
          ['"query"*', 50, 0]
        ),
        callers: explain(
          `SELECT DISTINCT n.id, n.name
           FROM edges e INDEXED BY idx_edges_target_kind
           JOIN nodes n ON n.id = e.source
           WHERE e.kind = 'calls' AND e.target = ?
           ORDER BY n.name, n.id
           LIMIT ? OFFSET ?`,
          ["query-plan-node", 100, 0]
        ),
        callees: explain(
          `SELECT DISTINCT n.id, n.name
           FROM edges e INDEXED BY idx_edges_source_kind
           JOIN nodes n ON n.id = e.target
           WHERE e.kind = 'calls' AND e.source = ?
           ORDER BY n.name, n.id
           LIMIT ? OFFSET ?`,
          ["query-plan-node", 100, 0]
        ),
        graph: explain(
          `SELECT source, target, kind, provenance
           FROM edges
           WHERE source IN (?) OR target IN (?)
           ORDER BY source, target, kind
           LIMIT ?`,
          [
            "query-plan-node",
            "query-plan-node",
            REPOSITORY_QUERY_LIMITS.maxGraphEdges,
          ]
        ),
        impact: explain(
          `SELECT e.source, e.target, e.kind, e.provenance
           FROM edges e INDEXED BY idx_edges_target_kind
           WHERE e.target IN (?)
             AND e.kind <> 'contains'
           ORDER BY e.target, e.source, e.kind
           LIMIT ?`,
          ["query-plan-node", REPOSITORY_QUERY_LIMITS.maxGraphEdges]
        ),
      }
    })
  }

  listGenerationStatuses(repositoryId: string) {
    return this.withDatabase(REGISTRY_DATABASE, (db) =>
      db
        .selectObjects(
          `SELECT generation, status
           FROM index_generations
           WHERE repository_id = ?
           ORDER BY generation`,
          [repositoryId]
        )
        .map((row) => ({
          generation: Number(row.generation),
          status: String(row.status),
        }))
    )
  }

  deleteRepository(repositoryId: string) {
    if (!OPAQUE_REPOSITORY_ID.test(repositoryId)) {
      throw new BrowserStorageError(
        "invalid_repository_id",
        "Browser storage requires an opaque repository id."
      )
    }
    const generations = this.withDatabase(REGISTRY_DATABASE, (db) =>
      db
        .selectValues(
          `SELECT generation
           FROM index_generations
           WHERE repository_id = ?
           ORDER BY generation`,
          [repositoryId]
        )
        .map(Number)
    )
    this.withDatabase(REGISTRY_DATABASE, (db) => {
      db.transaction("IMMEDIATE", () => {
        run(db, "DELETE FROM index_publications WHERE repository_id = ?", [
          repositoryId,
        ])
        run(
          db,
          "UPDATE index_generations SET status = 'deleted' WHERE repository_id = ?",
          [repositoryId]
        )
      })
    })
    const cleanupWarnings: string[] = []
    for (const generation of generations) {
      const databasePath = generationDatabasePath(repositoryId, generation)
      try {
        this.faultInjector?.("before-delete-unlink")
        this.unlinkDatabase(databasePath)
        this.withDatabase(REGISTRY_DATABASE, (db) => {
          run(
            db,
            `DELETE FROM index_generations
             WHERE repository_id = ? AND generation = ? AND status = 'deleted'`,
            [repositoryId, generation]
          )
        })
      } catch {
        cleanupWarnings.push(
          `Generation ${generation} remains queued for browser-storage cleanup.`
        )
      }
    }
    return {
      repositoryId,
      deleted: true,
      generations: generations.length,
      cleanupWarnings,
    }
  }

  close() {
    if (!this.closed) {
      this.closed = true
      this.pool.pauseVfs()
    }
    return { paused: this.pool.isPaused() }
  }
}

export async function openBrowserGraphStore(
  options: BrowserGraphStoreOptions = {}
) {
  const configTarget = globalThis as typeof globalThis & {
    sqlite3ApiConfig?: { disable?: { vfs?: Record<string, boolean> } }
  }
  configTarget.sqlite3ApiConfig = {
    disable: { vfs: { opfs: true, "opfs-wl": true } },
  }
  const sqlite3 = await sqlite3InitModule()
  const poolName = options.poolName ?? "codegraph-opfs-sahpool"
  if (!OPAQUE_REPOSITORY_ID.test(poolName)) {
    throw new BrowserStorageError(
      "invalid_repository_id",
      "Browser storage pool name must be opaque."
    )
  }
  const pool = await sqlite3.installOpfsSAHPoolVfs({
    name: poolName,
    directory: `.${poolName}`,
    clearOnInit: options.clearOnInit,
    initialCapacity: MINIMUM_POOL_CAPACITY,
  })
  const store = new BrowserGraphStore(pool, options.faultInjector)
  await store.initialize()
  return store
}
