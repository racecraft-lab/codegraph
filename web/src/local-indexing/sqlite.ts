import sqlite3InitModule from "@sqlite.org/sqlite-wasm"
import type { Database, SAHPoolUtil } from "@sqlite.org/sqlite-wasm"
import canonicalSchemaSource from "../../../src/db/schema.sql?raw"
import { SHARED_SCHEMA_VERSION } from "../../../src/db/schema-version"
import type { Edge, Node } from "../../../src/types"
import type {
  CodeEdge,
  CodeNode,
  GraphResult,
  ListResult,
  Repository,
  RepositoryStatus,
  SearchResult,
} from "../lib/api/types"
import type { SourceResult } from "../lib/repository-client"

export const BROWSER_SCHEMA_VERSION = SHARED_SCHEMA_VERSION

const REGISTRY_DATABASE = "/codegraph/browser/registry.sqlite3"
const OPAQUE_REPOSITORY_ID = /^[A-Za-z0-9_-]+$/
const MINIMUM_POOL_CAPACITY = 16

const canonicalSchema = canonicalSchemaSource.replace(
  "INSERT INTO schema_versions (version, applied_at, description)",
  "INSERT OR IGNORE INTO schema_versions (version, applied_at, description)",
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
  | "after-generation-write"
  | "before-publication"

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
}

export class BrowserStorageError extends Error {
  readonly code:
    | "invalid_repository_id"
    | "invalid_generation"
    | "quota_exceeded"
    | "storage_write_failed"
    | "store_closed"
    | "schema_version_mismatch"

  constructor(code: BrowserStorageError["code"], message: string) {
    super(message)
    this.code = code
    this.name = "BrowserStorageError"
  }
}

export function registryDatabasePath() {
  return REGISTRY_DATABASE
}

export function generationDatabasePath(repositoryId: string, generation: number) {
  if (!OPAQUE_REPOSITORY_ID.test(repositoryId)) {
    throw new BrowserStorageError(
      "invalid_repository_id",
      "Browser storage requires an opaque repository id.",
    )
  }
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw new BrowserStorageError("invalid_generation", "Browser generation must be a positive integer.")
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

function codeEdge(row: Record<string, unknown>): CodeEdge {
  return {
    source: String(row.source),
    target: String(row.target),
    kind: String(row.kind),
    ...(row.provenance == null
      ? {}
      : { provenance: String(row.provenance) }),
  }
}

function ensureCanonicalSchema(db: Database) {
  const hasVersionTable = Number(
    db.selectValue(
      "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'schema_versions'",
    ) ?? 0,
  )
  const recorded = hasVersionTable
    ? Number(db.selectValue("SELECT COALESCE(MAX(version), 0) FROM schema_versions") ?? 0)
    : 0
  if (recorded > BROWSER_SCHEMA_VERSION) {
    throw new BrowserStorageError(
      "schema_version_mismatch",
      `Browser database schema ${recorded} is newer than supported schema ${BROWSER_SCHEMA_VERSION}.`,
    )
  }
  db.exec(canonicalSchema)
  run(
    db,
    "INSERT OR IGNORE INTO schema_versions(version, applied_at, description) VALUES (?, ?, ?)",
    [BROWSER_SCHEMA_VERSION, Date.now(), "Canonical browser schema"],
  )
  const current = Number(db.selectValue("SELECT MAX(version) FROM schema_versions") ?? 0)
  if (current !== BROWSER_SCHEMA_VERSION) {
    throw new BrowserStorageError(
      "schema_version_mismatch",
      `Browser database schema ${current} does not match ${BROWSER_SCHEMA_VERSION}.`,
    )
  }
}

function storageFailure(error: unknown) {
  if (error instanceof BrowserStorageError) return error
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new BrowserStorageError("quota_exceeded", "Browser storage quota was exceeded.")
  }
  return new BrowserStorageError(
    "storage_write_failed",
    error instanceof Error ? error.message.slice(0, 240) : "Browser storage write failed.",
  )
}

export class BrowserGraphStore {
  private closed = false
  private readonly pool: SAHPoolUtil
  private readonly faultInjector?: (point: BrowserStorageFaultPoint) => void

  constructor(
    pool: SAHPoolUtil,
    faultInjector?: (point: BrowserStorageFaultPoint) => void,
  ) {
    this.pool = pool
    this.faultInjector = faultInjector
  }

  private openDatabase(filename: string) {
    if (this.closed) {
      throw new BrowserStorageError("store_closed", "Browser graph store is closed.")
    }
    return new this.pool.OpfsSAHPoolDb(filename)
  }

  private withDatabase<T>(filename: string, callback: (db: Database) => T): T {
    const db = this.openDatabase(filename)
    try {
      ensureCanonicalSchema(db)
      return callback(db)
    } finally {
      db.close()
    }
  }

  async initialize() {
    await this.pool.reserveMinimumCapacity(MINIMUM_POOL_CAPACITY)
    this.withDatabase(REGISTRY_DATABASE, () => undefined)
    this.recoverIncompleteGenerations()
  }

  private nextGeneration(repositoryId: string) {
    return this.withDatabase(REGISTRY_DATABASE, (db) => {
      const value = db.selectValue(
        "SELECT COALESCE(MAX(generation), 0) + 1 FROM index_generations WHERE repository_id = ?",
        [repositoryId],
      )
      return Number(value ?? 1)
    })
  }

  private insertRegistryStaging(input: BrowserGenerationInput, generation: number) {
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
        ],
      )
    })
  }

  private writeGenerationDatabase(input: BrowserGenerationInput, staged: StagedBrowserGeneration) {
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
            ],
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
            ],
          )
        }
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
            ],
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
            ],
          )
        }
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
          ],
        )
      })
    })
  }

  async stageGeneration(input: BrowserGenerationInput): Promise<StagedBrowserGeneration> {
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
      this.pool.unlink(staged.databasePath)
      throw failure
    }
  }

  async commitStagedGeneration(
    input: BrowserGenerationInput,
    staged: StagedBrowserGeneration,
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
            [input.repositoryId],
          )
          run(
            db,
            `UPDATE index_generations
             SET status = 'published', published_at = ?
             WHERE repository_id = ? AND generation = ? AND status = 'building'`,
            [Date.now(), input.repositoryId, staged.generation],
          )
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
            ],
          )
        })
      })
      return { repositoryId: input.repositoryId, generation: staged.generation }
    } catch (error) {
      const failure = storageFailure(error)
      this.markGenerationFailed(staged, failure)
      this.pool.unlink(staged.databasePath)
      throw failure
    }
  }

  async publishGeneration(input: BrowserGenerationInput) {
    const staged = await this.stageGeneration(input)
    return this.commitStagedGeneration(input, staged)
  }

  private markGenerationFailed(
    staged: StagedBrowserGeneration,
    failure: BrowserStorageError,
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
          ],
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
         ORDER BY repository_id, generation`,
      ),
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
            [String(row.repository_id), Number(row.generation)],
          )
        }
      })
    })
    for (const row of incomplete) {
      this.pool.unlink(
        generationDatabasePath(String(row.repository_id), Number(row.generation)),
      )
    }
  }

  readCurrent(repositoryId: string): CurrentBrowserGeneration | null {
    const publication = this.withDatabase(REGISTRY_DATABASE, (db) =>
      db.selectObject(
        `SELECT p.current_generation, g.schema_version, g.manifest_fingerprint
         FROM index_publications p
         JOIN index_generations g
           ON g.repository_id = p.repository_id
          AND g.generation = p.current_generation
         WHERE p.repository_id = ?`,
        [repositoryId],
      ),
    )
    if (!publication) return null
    const generation = Number(publication.current_generation)
    return this.withDatabase(generationDatabasePath(repositoryId, generation), (db) => ({
      repositoryId,
      generation,
      schemaVersion: Number(publication.schema_version),
      manifestFingerprint: String(publication.manifest_fingerprint),
      nodeNames: db.selectValues("SELECT name FROM nodes ORDER BY name").map(String),
      sourceText: (db.selectValue("SELECT text FROM source_cache ORDER BY path LIMIT 1") as
        | string
        | undefined) ?? null,
    }))
  }

  private currentGeneration(repositoryId: string) {
    const publication = this.withDatabase(REGISTRY_DATABASE, (db) =>
      db.selectObject(
        `SELECT p.current_generation, p.status, g.manifest_fingerprint,
                g.counts_json, g.warnings_json, g.published_at
         FROM index_publications p
         JOIN index_generations g
           ON g.repository_id = p.repository_id
          AND g.generation = p.current_generation
         WHERE p.repository_id = ?`,
        [repositoryId],
      ),
    )
    if (!publication) return null
    const generation = Number(publication.current_generation)
    return {
      generation,
      databasePath: generationDatabasePath(repositoryId, generation),
      status: String(publication.status),
      manifestFingerprint: String(publication.manifest_fingerprint),
      counts: JSON.parse(String(publication.counts_json ?? "{}")) as Record<
        string,
        number
      >,
      warnings: JSON.parse(String(publication.warnings_json ?? "[]")) as unknown[],
      publishedAt:
        publication.published_at == null
          ? null
          : Number(publication.published_at),
    }
  }

  listRepositories(
    metadata: ReadonlyMap<string, Pick<Repository, "name" | "sourceKind">> =
      new Map(),
  ): Repository[] {
    const ids = this.withDatabase(REGISTRY_DATABASE, (db) =>
      db
        .selectValues(
          "SELECT repository_id FROM index_publications ORDER BY updated_at DESC",
        )
        .map(String),
    )
    return ids.map((id, index) => ({
      id,
      root: `local://${id}`,
      name: metadata.get(id)?.name ?? "Browser repository",
      default: index === 0,
      runtime: "local",
      sourceKind: metadata.get(id)?.sourceKind ?? "picked-folder",
    }))
  }

  getRepositoryStatus(
    repositoryId: string,
    name = "Browser repository",
  ): RepositoryStatus {
    const current = this.currentGeneration(repositoryId)
    if (!current) {
      throw new BrowserStorageError(
        "invalid_generation",
        "The browser-local repository has no published generation.",
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
        fileCount: Number(
          db.selectValue("SELECT COUNT(*) FROM source_cache") ?? 0,
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
    offset = 0,
  ): SearchResult {
    const current = this.currentGeneration(repositoryId)
    if (!current) {
      return { items: [], total: 0, limit, offset, degraded: false }
    }
    const pattern = `%${query}%`
    return this.withDatabase(current.databasePath, (db) => {
      const total = Number(
        db.selectValue(
          `SELECT COUNT(*) FROM nodes
           WHERE name LIKE ? OR qualified_name LIKE ? OR file_path LIKE ?`,
          [pattern, pattern, pattern],
        ) ?? 0,
      )
      const items = db
        .selectObjects(
          `SELECT id, kind, name, file_path, start_line, signature, docstring
           FROM nodes
           WHERE name LIKE ? OR qualified_name LIKE ? OR file_path LIKE ?
           ORDER BY name, id
           LIMIT ? OFFSET ?`,
          [pattern, pattern, pattern, limit, offset],
        )
        .map(codeNode)
      return { items, total, limit, offset, degraded: false }
    })
  }

  getNode(repositoryId: string, nodeId: string): CodeNode {
    const current = this.currentGeneration(repositoryId)
    const row = current
      ? this.withDatabase(current.databasePath, (db) =>
          db.selectObject(
            `SELECT id, kind, name, file_path, start_line, signature, docstring
             FROM nodes WHERE id = ?`,
            [nodeId],
          ),
        )
      : undefined
    if (!row) {
      throw new BrowserStorageError(
        "invalid_generation",
        "The requested browser-local symbol is unavailable.",
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
            [nodeId, repositoryId, current.generation],
          ),
        )
      : undefined
    if (!row) {
      throw new BrowserStorageError(
        "invalid_generation",
        "The requested cached browser source is unavailable.",
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
    limit = 100,
    offset = 0,
  ): ListResult<CodeNode> {
    const current = this.currentGeneration(repositoryId)
    if (!current) return { items: [], total: 0, limit, offset }
    const joinColumn = direction === "callers" ? "source" : "target"
    const matchColumn = direction === "callers" ? "target" : "source"
    return this.withDatabase(current.databasePath, (db) => {
      const total = Number(
        db.selectValue(
          `SELECT COUNT(*) FROM edges WHERE kind = 'calls' AND ${matchColumn} = ?`,
          [nodeId],
        ) ?? 0,
      )
      const items = db
        .selectObjects(
          `SELECT n.id, n.kind, n.name, n.file_path, n.start_line,
                  n.signature, n.docstring
           FROM edges e
           JOIN nodes n ON n.id = e.${joinColumn}
           WHERE e.kind = 'calls' AND e.${matchColumn} = ?
           ORDER BY n.name, n.id
           LIMIT ? OFFSET ?`,
          [nodeId, limit, offset],
        )
        .map(codeNode)
      return { items, total, limit, offset }
    })
  }

  graph(repositoryId: string, nodeId: string): GraphResult {
    const current = this.currentGeneration(repositoryId)
    if (!current) return { nodes: [], edges: [], truncated: false }
    return this.withDatabase(current.databasePath, (db) => {
      const edgeRows = db.selectObjects(
        `SELECT source, target, kind, provenance
         FROM edges WHERE source = ? OR target = ?
         ORDER BY source, target, kind`,
        [nodeId, nodeId],
      )
      const ids = new Set<string>([nodeId])
      for (const edge of edgeRows) {
        ids.add(String(edge.source))
        ids.add(String(edge.target))
      }
      const nodes = [...ids]
        .map((id) =>
          db.selectObject(
            `SELECT id, kind, name, file_path, start_line, signature, docstring
             FROM nodes WHERE id = ?`,
            [id],
          ),
        )
        .filter((row) => row !== undefined)
        .map(codeNode)
      return {
        nodes,
        edges: edgeRows.map(codeEdge),
        truncated: false,
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
          [repositoryId],
        )
        .map((row) => ({
          generation: Number(row.generation),
          status: String(row.status),
        })),
    )
  }

  close() {
    if (!this.closed) {
      this.closed = true
      this.pool.pauseVfs()
    }
    return { paused: this.pool.isPaused() }
  }
}

export async function openBrowserGraphStore(options: BrowserGraphStoreOptions = {}) {
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
      "Browser storage pool name must be opaque.",
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
