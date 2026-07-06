/**
 * CodeGraph
 *
 * A local-first code intelligence system that builds a semantic
 * knowledge graph from any codebase.
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  Node,
  Edge,
  FileRecord,
  ExtractionResult,
  Subgraph,
  TraversalOptions,
  SearchOptions,
  SearchResult,
  SegmentMatch,
  Context,
  GraphStats,
  TaskInput,
  TaskContext,
  BuildContextOptions,
  FindRelevantContextOptions,
} from './types';
import { DatabaseConnection, getDatabasePath, removeDatabaseFiles } from './db';
import { QueryBuilder } from './db/queries';
import {
  isInitialized,
  createDirectory,
  removeDirectory,
  validateDirectory,
} from './directory';
import {
  ExtractionOrchestrator,
  IndexProgress,
  IndexResult,
  SyncResult,
  extractFromSource,
  initGrammars,
} from './extraction';
import {
  ReferenceResolver,
  createResolver,
  ResolutionResult,
} from './resolution';
import { GraphTraverser, GraphQueryManager } from './graph';
import { ContextBuilder, createContextBuilder } from './context';
import { Mutex, FileLock, validatePathWithinRoot } from './utils';
import { FileWatcher, WatchOptions, PendingFile, LockUnavailableError } from './sync';
import { EXTRACTION_VERSION } from './extraction/extraction-version';
import { getCodeGraphDir } from './directory';
import { deriveProjectNameTokens } from './search/query-utils';
import { CodeGraphPackageVersion } from './mcp/version';
import { segmentLookupVariants, splitIdentifierSegments } from './search/identifier-segments';
import { createYielder } from './resolution/cooperative-yield';
import { logWarn } from './errors';
import { loadEmbeddingConfig, isEmbeddingProviderOff, plaintextRemoteWarning, redactEndpoint, LOCAL_VECTOR_MODEL, displayEmbeddingModel, type EmbeddingProviderSelection } from './embeddings/config';
import { EndpointProvider } from './embeddings/endpoint-provider';
import { LocalProvider } from './embeddings/local-provider';
import type { LocalProviderOverrides } from './embeddings/local-provider';
import { runEmbeddingPass } from './embeddings/indexer-hook';
import { probeLocalModelCache } from './embeddings/model-fetch';
import type { ProbeLocalModelCacheOverrides } from './embeddings/model-fetch';
import {
  CliLspActivation,
  createInitialLspStatus,
  LSP_STATUS_METADATA_KEY,
  LspStatus,
  parsePersistedLspStatus,
  resolveLspConfig,
  runLspPrecisionPass,
  serializeLspStatus,
} from './lsp';

// Re-export types for consumers
export * from './types';
// Storage building blocks for embedded/SDK consumers that drive the graph
// directly (open a DB, run prepared queries) rather than through the CodeGraph
// facade. Exposed from the package entry so they no longer require deep imports
// into dist/ (issue #354).
export { getDatabasePath, DatabaseConnection } from './db';
export { QueryBuilder } from './db/queries';
export {
  getCodeGraphDir,
  isInitialized,
  findNearestCodeGraphRoot,
  CODEGRAPH_DIR,
} from './directory';
export { IndexProgress, IndexResult, SyncResult } from './extraction';
export { detectLanguage, isLanguageSupported, isGrammarLoaded, getSupportedLanguages, initGrammars, loadGrammarsForLanguages, loadAllGrammars } from './extraction';
export { ResolutionResult } from './resolution';
export {
  CodeGraphError,
  FileError,
  ParseError,
  DatabaseError,
  SearchError,
  VectorError,
  ConfigError,
  Logger,
  setLogger,
  getLogger,
  silentLogger,
  defaultLogger,
} from './errors';
export { Mutex, FileLock, processInBatches, debounce, throttle, MemoryMonitor } from './utils';
export { FileWatcher, WatchOptions, PendingFile, LockUnavailableError } from './sync';
export { MCPServer } from './mcp';

/**
 * Options for initializing a new CodeGraph project
 */
export interface InitOptions {
  /** Whether to run initial indexing after init */
  index?: boolean;

  /** Progress callback for indexing */
  onProgress?: (progress: IndexProgress) => void;
}

/**
 * Options for opening an existing CodeGraph project
 */
export interface OpenOptions {
  /** Whether to run sync if files have changed */
  sync?: boolean;

  /** Whether to run in read-only mode */
  readOnly?: boolean;
}

/**
 * Options for indexing
 */
export interface IndexOptions {
  /** Progress callback */
  onProgress?: (progress: IndexProgress) => void;

  /** Abort signal for cancellation */
  signal?: AbortSignal;

  /** Enable verbose logging (worker lifecycle, memory, timeouts) */
  verbose?: boolean;

  /**
   * Override the embedding provider for this single call only — `'local'`,
   * `'endpoint'`, or `'off'` (SPEC-002 FR-002). Threaded straight into
   * `loadEmbeddingConfig` as `providerOverride`, taking precedence over
   * `CODEGRAPH_EMBEDDING_PROVIDER` for this one `indexAll`/`sync` call; omit to
   * resolve from the environment as-is. This is what `codegraph index
   * --embeddings <provider>` sets.
   */
  embeddingsProvider?: EmbeddingProviderSelection;

  /** LSP precision activation for this indexing/sync run */
  lsp?: CliLspActivation;
}

/**
 * Embedding coverage counts + derived percentage (SPEC-001 FR-022).
 * `percent = round(embedded / embeddable * 100)`, defined as 100 when nothing is
 * embeddable (a trivially-complete empty graph).
 */
export interface EmbeddingCoverageStatus {
  embedded: number;
  embeddable: number;
  percent: number;
}

/**
 * Distinct, best-effort reason a LOCAL-provider status shows 0% coverage
 * (SPEC-002 FR-020), derived at status time from a network-free filesystem
 * probe of the model cache ({@link probeLocalModelCache} in
 * `src/embeddings/model-fetch.ts`) — never from a persisted record of a past
 * pass's actual abort (none is kept; see `embedding_*` metadata keys, which
 * stay exactly `embedding_dims`/`embedding_model`):
 *  - `offline` — the model/tokenizer are not present+verified in the cache.
 *    Also covers a discarded checksum mismatch: a failed download's bytes are
 *    ALWAYS discarded before promotion (FR-014), so a mismatch and "never
 *    attempted" leave the identical on-disk footprint (FR-020's own allowance
 *    for a generic reason when the transient one isn't persisted);
 *  - `cache` — the resolved cache directory itself is invalid/unwritable;
 *  - `invalid-base-url` — the model is not cached AND `CODEGRAPH_MODEL_BASE_URL`
 *    is set but unusable (unparseable, or a non-http/https scheme), so a download
 *    would fail on the override, not on connectivity — "retry online" would misdirect;
 *  - `session-init-timeout` — the model IS present+verified in cache, so the
 *    skip must be downstream of acquisition (worker/session init or inference).
 * `misconfig` is deliberately NOT a member here: an invalid/unrecognized
 * provider selection reports via {@link EmbeddingStatusMisconfigured} instead
 * — a wholly different (non-`active`) branch of {@link EmbeddingStatus}.
 */
export type LocalEmbeddingSkipReason = 'offline' | 'cache' | 'session-init-timeout' | 'invalid-base-url' | 'insecure-permissions';

/** Active embedding status: the feature is on (FR-001, or an explicit SPEC-002 local selection). */
export interface EmbeddingStatusActive {
  active: true;
  /**
   * Which provider produced this status (SPEC-002 FR-021): the SPEC-001 HTTP
   * endpoint, or the bundled local model. A dedicated discriminant rather than
   * overloading `endpoint` — `endpoint` is meaningful ONLY for `'endpoint'`.
   */
  provider: 'endpoint' | 'local';
  /**
   * Endpoint redacted to scheme + host + port only — never userinfo/path/query
   * (FR-023). Present only when `provider === 'endpoint'`; the local provider
   * has no endpoint to report.
   */
  endpoint?: string;
  model: string;
  /** Enforced/inferred dimension, or null when neither a scalar nor config supplies one. */
  dims: number | null;
  coverage: EmbeddingCoverageStatus;
  /**
   * See {@link LocalEmbeddingSkipReason}. Present only when `provider ===
   * 'local'` and there was something to embed but nothing carries a vector
   * under the active model (FR-020).
   */
  skipReason?: LocalEmbeddingSkipReason;
}

/** Dormant embedding status: the feature is off (neither URL nor MODEL set, FR-002). */
export interface EmbeddingStatusDormant {
  active: false;
  /** The two variables that would activate the feature. */
  activationVars: string[];
  /**
   * True when dormancy is an EXPLICIT `CODEGRAPH_EMBEDDING_PROVIDER=off` (a deliberate kill
   * switch), NOT an unset environment. Lets `status` say "disabled by …=off; set it to local
   * or endpoint" instead of the plain-dormant "set URL and MODEL to enable" — which would not
   * take effect while `off` is set. config still resolves `off`→null (FR-003), so the indexing
   * pass stays byte-identically dormant; only this observability snapshot distinguishes them.
   */
  disabledByProvider?: boolean;
  /** Prior-run snapshot, present only when on-disk scalars + live vectors exist. */
  previousRun?: { model: string; dims: number | null; coverage: EmbeddingCoverageStatus };
}

/** Misconfigured embedding status: exactly one of URL/MODEL set — off, but intent signaled (FR-001a). */
export interface EmbeddingStatusMisconfigured {
  active: false;
  misconfigured: true;
  /**
   * The single unset variable (`CODEGRAPH_EMBEDDING_URL`/`CODEGRAPH_EMBEDDING_MODEL`),
   * or `CODEGRAPH_EMBEDDING_PROVIDER` for an unrecognized provider value.
   */
  missingVariable: string;
  /**
   * ALL unset variables, populated ONLY when more than one is missing (explicit
   * `CODEGRAPH_EMBEDDING_PROVIDER=endpoint` with BOTH URL and MODEL unset) — lets a
   * renderer avoid the "X is set but Y is missing" phrasing that would falsely claim the
   * counterpart is set. Absent for a genuine one-variable half-config.
   */
  missingVariables?: string[];
  /**
   * Set only for an INVALID (not missing) provider value: the offending value + the
   * recognized set, so a renderer says "must be one of: …" instead of "not set"
   * (SPEC-002 P2-1). Absent for a genuine URL/MODEL half-config.
   */
  invalidValue?: string;
  allowedValues?: string[];
  activationVars: string[];
}

/**
 * Embedding observability snapshot returned by {@link CodeGraph.getEmbeddingStatus}
 * — the machine shape behind `codegraph status` / `--json` (contract:
 * `status-embedding-json.md`). A discriminated union over the activation state:
 *  - active (URL+MODEL set, OR an explicit SPEC-002 local selection): `provider`
 *    discriminates `endpoint` (redacted URL) vs `local` (no endpoint) — plus
 *    model/dims/live coverage, and for `local`, a best-effort FR-020 skip
 *    reason when coverage is 0%;
 *  - dormant (neither set): the two activation variables, plus `previousRun` IFF a
 *    prior run's scalars and live vectors survive on disk;
 *  - misconfigured (exactly one set, or an unrecognized provider selection): the
 *    single missing variable.
 * Every state is network-free — dormancy is never broken to compute it (FR-023).
 */
export type EmbeddingStatus =
  | EmbeddingStatusActive
  | EmbeddingStatusDormant
  | EmbeddingStatusMisconfigured;

/** The two environment variables that activate embeddings (FR-001). */
const EMBEDDING_ACTIVATION_VARS = ['CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL'];

/** Parse a persisted positive-integer dims scalar; null/blank/invalid → null. */
function parseStoredDims(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Test-only seam (mirrors `__setFsWatchForTests` in `src/sync/watcher.ts`): inject
 * hermetic {@link LocalProvider} dependencies — a fake `worker_threads` worker and a
 * fake `acquireLocalModel` — so the SPEC-002 local embed path can be driven end-to-end
 * through `indexAll`/`sync` without spawning a thread or downloading the 22MB model.
 * Production never sets this (it stays `undefined`), so `maybeRunEmbeddingPass` builds
 * a real LocalProvider; only a test injects fakes. Clear with `undefined`.
 * @internal
 */
let localProviderOverridesForTests: LocalProviderOverrides | undefined;
export function __setLocalProviderOverridesForTests(overrides: LocalProviderOverrides | undefined): void {
  localProviderOverridesForTests = overrides;
}

/**
 * Test-only seam so {@link CodeGraph.getEmbeddingStatus}'s FR-020 best-effort
 * cache probe can be exercised hermetically — substituting tiny fixture
 * artifacts (a fake sha256+size) in place of the real ~22MB pinned model,
 * mirroring the seam `AcquireLocalModelOverrides.artifacts` already provides
 * for acquisition itself (SHA-256 preimage resistance makes the real pin
 * infeasible to satisfy by hand). Production never sets this (stays
 * `undefined`), so `getEmbeddingStatus` probes the real pinned artifacts; only
 * a test injects fixtures. Clear with `undefined`.
 * @internal
 */
let localModelCacheProbeOverridesForTests: ProbeLocalModelCacheOverrides | undefined;
export function __setLocalModelCacheProbeOverridesForTests(overrides: ProbeLocalModelCacheOverrides | undefined): void {
  localModelCacheProbeOverridesForTests = overrides;
}

/**
 * Main CodeGraph class
 *
 * Provides the primary interface for interacting with the code knowledge graph.
 */
export class CodeGraph {
  private db: DatabaseConnection;
  private queries: QueryBuilder;
  private projectRoot: string;
  // Assigned via wireLayers() from the constructor (and again on reopen) — the
  // `!` tells TS these are definitely set even though the assignment is one
  // method call away from the constructor body.
  private orchestrator!: ExtractionOrchestrator;
  private resolver!: ReferenceResolver;
  private graphManager!: GraphQueryManager;
  private traverser!: GraphTraverser;
  private contextBuilder!: ContextBuilder;

  // Mutex for preventing concurrent indexing operations (in-process)
  private indexMutex = new Mutex();

  // File lock for preventing concurrent writes across processes (CLI, MCP, git hooks)
  private fileLock: FileLock;

  // File watcher for auto-sync on file changes
  private watcher: FileWatcher | null = null;

  private constructor(
    db: DatabaseConnection,
    queries: QueryBuilder,
    projectRoot: string
  ) {
    this.db = db;
    this.queries = queries;
    this.projectRoot = projectRoot;
    this.fileLock = new FileLock(
      path.join(getCodeGraphDir(projectRoot), 'codegraph.lock')
    );
    this.wireLayers();
  }

  /**
   * (Re)build the query/extraction/graph layers over the current `this.queries`
   * (which wraps `this.db`). Factored out of the constructor so `reopenIfReplaced`
   * can rebuild them against a fresh connection without duplicating the wiring.
   * The path-based `fileLock` is independent of the DB handle, so it stays put.
   */
  private wireLayers(): void {
    // Down-weight the project name as a query term in search ranking — it names
    // the whole repo, not a symbol, so it has no discriminative value (#720).
    try {
      this.queries.setProjectNameTokens(deriveProjectNameTokens(this.projectRoot));
    } catch {
      // Best-effort: ranking still works without it.
    }
    this.orchestrator = new ExtractionOrchestrator(this.projectRoot, this.queries);
    this.resolver = createResolver(this.projectRoot, this.queries);
    this.graphManager = new GraphQueryManager(this.queries);
    this.traverser = new GraphTraverser(this.queries);
    this.contextBuilder = createContextBuilder(
      this.projectRoot,
      this.queries,
      this.traverser
    );
  }

  /**
   * Heal a stale database handle in place. If `.codegraph/` was removed and
   * recreated at the SAME path while this instance held the DB open — a git
   * worktree removed and re-added, or `rm -rf .codegraph` + `codegraph init` —
   * our open fd points at the now-unlinked inode and can never see the new
   * index, so every query returns the pre-removal snapshot until the process
   * restarts (#925). When that's detected, open the live file at the same path,
   * rebuild the query layers, and swap them IN PLACE, so every holder of this
   * instance (the MCP daemon's default project, cached projectPath connections)
   * heals without a restart. Returns true iff it reopened.
   *
   * POSIX-only in practice: `isReplacedOnDisk` never fires on Windows (an open
   * file can't be unlinked there, and st_ino is unreliable).
   */
  reopenIfReplaced(): boolean {
    if (!this.db.isReplacedOnDisk()) return false;
    const dbPath = this.db.getPath();
    // Open the live file FIRST — if that throws (e.g. mid-recreate), the old
    // handle stays in place and the caller retries on the next query, rather
    // than leaving this instance with no connection at all.
    const fresh = DatabaseConnection.open(dbPath);
    const stale = this.db;
    this.db = fresh;
    this.queries = new QueryBuilder(fresh.getDb());
    this.wireLayers();
    // Releasing the dead handle also frees the leaked db/-wal/-shm fds that were
    // pinning the unlinked inode (#925).
    try { stale.close(); } catch { /* the old inode is gone; closing just frees fds */ }
    return true;
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Initialize a new CodeGraph project
   *
   * Creates the .CodeGraph directory, database, and configuration.
   *
   * @param projectRoot - Path to the project root directory
   * @param options - Initialization options
   * @returns A new CodeGraph instance
   */
  static async init(projectRoot: string, options: InitOptions = {}): Promise<CodeGraph> {
    await initGrammars();
    const resolvedRoot = path.resolve(projectRoot);

    // Check if already initialized
    if (isInitialized(resolvedRoot)) {
      throw new Error(`CodeGraph already initialized in ${resolvedRoot}`);
    }

    // Create directory structure
    createDirectory(resolvedRoot);

    // Initialize database
    const dbPath = getDatabasePath(resolvedRoot);
    const db = DatabaseConnection.initialize(dbPath);
    const queries = new QueryBuilder(db.getDb());

    const instance = new CodeGraph(db, queries, resolvedRoot);

    // Run initial indexing if requested
    if (options.index) {
      await instance.indexAll({ onProgress: options.onProgress });
    }

    return instance;
  }

  /**
   * Initialize synchronously (without indexing)
   */
  static initSync(projectRoot: string): CodeGraph {
    const resolvedRoot = path.resolve(projectRoot);

    // Check if already initialized
    if (isInitialized(resolvedRoot)) {
      throw new Error(`CodeGraph already initialized in ${resolvedRoot}`);
    }

    // Create directory structure
    createDirectory(resolvedRoot);

    // Initialize database
    const dbPath = getDatabasePath(resolvedRoot);
    const db = DatabaseConnection.initialize(dbPath);
    const queries = new QueryBuilder(db.getDb());

    return new CodeGraph(db, queries, resolvedRoot);
  }

  /**
   * Open an existing CodeGraph project
   *
   * @param projectRoot - Path to the project root directory
   * @param options - Open options
   * @returns A CodeGraph instance
   */
  static async open(projectRoot: string, options: OpenOptions = {}): Promise<CodeGraph> {
    await initGrammars();
    const resolvedRoot = path.resolve(projectRoot);

    // Check if initialized
    if (!isInitialized(resolvedRoot)) {
      throw new Error(`CodeGraph not initialized in ${resolvedRoot}. Run init() first.`);
    }

    // Validate directory structure
    const validation = validateDirectory(resolvedRoot);
    if (!validation.valid) {
      throw new Error(`Invalid CodeGraph directory: ${validation.errors.join(', ')}`);
    }

    // Open database
    const dbPath = getDatabasePath(resolvedRoot);
    const db = DatabaseConnection.open(dbPath);
    const queries = new QueryBuilder(db.getDb());

    const instance = new CodeGraph(db, queries, resolvedRoot);

    // Sync if requested
    if (options.sync) {
      await instance.sync();
    }

    return instance;
  }

  /**
   * Rebuild the project's database from scratch and return a fresh, empty
   * instance — the "same result as a fresh init" semantics that `codegraph
   * index` documents.
   *
   * Unlike `open()` followed by `clear()`, this DISCARDS the existing
   * `.codegraph/codegraph.db` (and its `-wal`/`-shm` sidecars) before
   * re-initializing, instead of opening the old database and DELETE-ing every
   * row. On a large or pre-fix poisoned index — e.g. an old graph that scanned
   * an ignored gitlink corpus (#1065) into ~1.6M nodes with a multi-GB WAL —
   * the per-row `nodes_fts` delete-trigger churn blocks the main thread long
   * enough to trip the #850 liveness watchdog before indexing even starts, so a
   * full re-index could never recover the bad state (#1067). Discarding the
   * files is O(1) regardless of size, reclaims the disk, and sidesteps opening
   * (and running migrations against) the poisoned database entirely.
   */
  static async recreate(projectRoot: string): Promise<CodeGraph> {
    await initGrammars();
    const resolvedRoot = path.resolve(projectRoot);

    // Check if initialized — recreate REBUILDS an existing project; it is not a
    // first-time `init`.
    if (!isInitialized(resolvedRoot)) {
      throw new Error(`CodeGraph not initialized in ${resolvedRoot}. Run init() first.`);
    }

    const dbPath = getDatabasePath(resolvedRoot);
    try {
      removeDatabaseFiles(dbPath);
    } catch (err) {
      // POSIX unlinks an open file fine; this fires mainly on Windows when a
      // live daemon/MCP server still holds the database. Turn the raw EBUSY into
      // an actionable instruction instead of a generic failure.
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not rebuild the index — the database file is in use (${reason}). ` +
          `Stop any running CodeGraph MCP server/daemon for this project and retry, ` +
          `or remove the ${getCodeGraphDir(resolvedRoot)} directory and run "codegraph init".`
      );
    }

    // Re-create an empty, freshly-schema'd database at the same path.
    const db = DatabaseConnection.initialize(dbPath);
    const queries = new QueryBuilder(db.getDb());

    return new CodeGraph(db, queries, resolvedRoot);
  }

  /**
   * Open synchronously (without sync)
   */
  static openSync(projectRoot: string): CodeGraph {
    const resolvedRoot = path.resolve(projectRoot);

    // Check if initialized
    if (!isInitialized(resolvedRoot)) {
      throw new Error(`CodeGraph not initialized in ${resolvedRoot}. Run init() first.`);
    }

    // Validate directory structure
    const validation = validateDirectory(resolvedRoot);
    if (!validation.valid) {
      throw new Error(`Invalid CodeGraph directory: ${validation.errors.join(', ')}`);
    }

    // Open database
    const dbPath = getDatabasePath(resolvedRoot);
    const db = DatabaseConnection.open(dbPath);
    const queries = new QueryBuilder(db.getDb());

    return new CodeGraph(db, queries, resolvedRoot);
  }

  /**
   * Check if a directory has been initialized as a CodeGraph project
   */
  static isInitialized(projectRoot: string): boolean {
    return isInitialized(path.resolve(projectRoot));
  }

  /**
   * Close the CodeGraph instance and release resources
   */
  close(): void {
    this.unwatch();
    // Release file lock if held
    this.fileLock.release();
    this.db.close();
  }

  /**
   * Get the project root directory
   */
  getProjectRoot(): string {
    return this.projectRoot;
  }

  // ===========================================================================
  // Indexing
  // ===========================================================================

  /**
   * Index all files in the project
   *
   * Uses a mutex to prevent concurrent indexing operations.
   */
  async indexAll(options: IndexOptions = {}): Promise<IndexResult> {
    return this.indexMutex.withLock(async () => {
      try {
        this.fileLock.acquire();
      } catch {
        return { success: false, filesIndexed: 0, filesSkipped: 0, filesErrored: 0, nodesCreated: 0, edgesCreated: 0, errors: [{ message: 'Could not acquire file lock - another process may be indexing', severity: 'error' as const }], durationMs: 0 };
      }
      try {
        const structuralStartedAt = Date.now();
        const before = this.queries.getNodeAndEdgeCount();
        // Segment vocabulary starts empty and is repopulated by the node write
        // path as every file (re-)indexes below — so a full index is also the
        // orphan-cleanup pass for names deleted since the last one.
        try { this.queries.clearNameSegmentVocab(); } catch { /* vocab is advisory — never fail an index over it */ }
        const result = await this.orchestrator.indexAll(options.onProgress, options.signal, options.verbose);

        // Re-detect frameworks now that the index is populated. The resolver
        // is constructed with createResolver() before any files exist, so
        // framework resolvers whose detect() consults the indexed file list
        // (e.g. UIKit/SwiftUI scanning for imports, swift-objc-bridge looking
        // for both Swift and ObjC files) all return false on that initial pass
        // and silently drop themselves. Re-initializing here gives them a
        // chance to see the actual project before resolution runs.
        if (result.success && result.filesIndexed > 0) {
          this.resolver.initialize();
          // Cross-file finalization (e.g. NestJS RouterModule prefixes). Runs
          // before resolution so updated names show up in subsequent reads.
          this.resolver.runPostExtract();
        }

        // Resolve references to create call/import/extends edges
        if (result.success && result.filesIndexed > 0) {
          // Get count without loading all refs into memory
          const unresolvedCount = this.queries.getUnresolvedReferencesCount();

          options.onProgress?.({
            phase: 'resolving',
            current: 0,
            total: unresolvedCount,
          });

          await this.resolveReferencesBatched((current, total) => {
            options.onProgress?.({
              phase: 'resolving',
              current,
              total,
            });
          });

          // Second pass: chained calls whose method lives on a supertype the
          // receiver conforms to (protocol-extension / inherited / default-
          // interface). Needs the implements/extends edges the main pass just
          // built, so it runs after resolution (#750).
          await this.resolver.resolveChainedCallsViaConformance();
          // Same lifecycle for `this.<member>` callback registrations whose
          // member is inherited from a supertype (#808).
          await this.resolver.resolveDeferredThisMemberRefs();
        }

        if (result.success && result.filesIndexed > 0) {
          await this.maybeRunLspPrecisionPass(options.lsp, Date.now() - structuralStartedAt);
        }

        // Refresh planner stats + checkpoint the WAL after bulk writes.
        // Cheap and non-blocking; never load-bearing for correctness.
        if (result.success && result.filesIndexed > 0) {
          this.db.runMaintenance();
        }

        // The orchestrator only sees extraction-phase counts; resolution and
        // synthesizer edges (often >50% of the graph on JVM repos) come later.
        // Recompute against the DB so the CLI summary reports the true totals.
        if (result.success && result.filesIndexed > 0) {
          const after = this.queries.getNodeAndEdgeCount();
          result.nodesCreated = after.nodes - before.nodes;
          result.edgesCreated = after.edges - before.edges;
        }

        // Stamp the index with the engine that built it, so `codegraph status`
        // and `codegraph upgrade` can recommend a re-index when the running
        // engine produces richer extraction than the one on disk. Only on a
        // real full index — a sync touches a subset, so it must NOT advance the
        // extraction stamp (the bulk would still be stale). See extraction-version.ts.
        if (result.success && result.filesIndexed > 0) {
          try {
            this.queries.setMetadata('indexed_with_version', CodeGraphPackageVersion);
            this.queries.setMetadata('indexed_with_extraction_version', String(EXTRACTION_VERSION));
          } catch { /* metadata is advisory — never fail an index over it */ }
        }

        // Optional embedding pass over the fully-resolved graph. Fully dormant
        // unless CODEGRAPH_EMBEDDING_URL + CODEGRAPH_EMBEDDING_MODEL are set, and
        // strictly advisory: any failure (misconfig, endpoint down, dim conflict)
        // is swallowed here so a broken embed can never fail an index (FR-014/019).
        if (result.success && result.filesIndexed > 0) {
          try {
            await this.maybeRunEmbeddingPass(options.onProgress, options.embeddingsProvider, options.signal);
          } catch (err) {
            // Advisory — an unexpected throw from the embedding wiring itself (config
            // load, provider construction) never fails the index, but it must not be
            // invisible either. Only the error's NAME is surfaced (never its message or
            // cause), keeping endpoint/key redaction total (FR-023).
            logWarn(
              `Embedding pass skipped after an unexpected ${err instanceof Error ? err.name : 'error'} ` +
              '— the enclosing index/sync operation is unaffected.'
            );
          }
        }

        return result;
      } finally {
        this.fileLock.release();
      }
    });
  }

  /**
   * Advisory embedding pass, run inside {@link indexAll} after resolution. Reads
   * the embedding config from the environment and does exactly one of three
   * things:
   *  - unconfigured (neither URL nor MODEL set) → nothing at all: no network, no
   *    writes, no log line — the wiring is byte-silent when off (FR-002);
   *  - half-configured (exactly one set) → one advisory line naming the missing
   *    variable, then skip (FR-001a);
   *  - active (both set) → stream every embeddable-but-unembedded symbol through
   *    the endpoint provider, persisting one vector per symbol.
   *
   * The pass itself never throws (it reports an advisory abort instead), and the
   * call site additionally wraps this in a try/catch, so embedding can never fail
   * the surrounding index (FR-014/019).
   *
   * @param providerOverride the caller's `IndexOptions.embeddingsProvider`, if any
   *   (SPEC-002 FR-002) — threaded into `loadEmbeddingConfig` so it wins over
   *   `CODEGRAPH_EMBEDDING_PROVIDER` for this one call only.
   */
  private async maybeRunEmbeddingPass(
    onProgress?: (progress: IndexProgress) => void,
    providerOverride?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    // Honor the caller's IndexOptions.signal (extraction already does): if it aborted after
    // extraction, do NO embedding work — no model download, no worker spawn, no scan/inference.
    if (signal?.aborted) return;
    const config = loadEmbeddingConfig(process.env, providerOverride);
    // Fully dormant — indistinguishable from a build without the feature (FR-002).
    if (config === null) return;
    // Half-config — feature stays off, but name the missing variable (FR-001a). An
    // unrecognized provider value gets its own message: the variable IS set, just to
    // something bad, so "not set" would mislead — name it + the allowed set (P2-1).
    if ('misconfigured' in config) {
      if (config.invalidValue !== undefined) {
        logWarn(
          `Embedding is disabled because CODEGRAPH_EMBEDDING_PROVIDER="${config.invalidValue}" is not a valid provider — ` +
          `set it to one of: ${(config.allowedValues ?? []).join(', ')}.`
        );
      } else {
        logWarn(
          `Embedding is disabled because ${config.missingVariable} is not set — ` +
          `set both CODEGRAPH_EMBEDDING_URL and CODEGRAPH_EMBEDDING_MODEL to enable it.`
        );
      }
      return;
    }
    // SPEC-002: the local provider is a distinct arm of EmbeddingConfigResult (no
    // `url`) — the bundled ONNX model, no endpoint. It drives the SAME advisory
    // `runEmbeddingPass` over `node_vectors`, reusing SPEC-001's model-column re-embed
    // (a symbol embedded under a prior model is re-selected here — FR-022, no new
    // mechanism). Acquisition/session-init failures degrade to an advisory abort exactly
    // like the endpoint arm (FR-008/019): the pass reports `{ aborted, abortReason }`,
    // the structural index/sync is unaffected. The worker + one-time model download are
    // the provider's own concern; here we only wire it to the pass and tear it down after.
    if ('provider' in config) {
      const localLockPath = path.join(getCodeGraphDir(this.projectRoot), 'codegraph.lock');
      const provider = new LocalProvider(config, localProviderOverridesForTests, (message) => {
        // FR-021a: surface the one-time model acquisition + session cold-load (first run
        // downloads ~22MB, then a ~215ms session build) over the same progress channel.
        onProgress?.({ phase: 'embedding', current: 0, total: 0, currentFile: message });
      });
      // Cancel the ~22MB model acquisition mid-flight when the caller aborts: closing the provider
      // aborts its in-progress download (idempotent with the finally close below; the pass loop
      // separately honors `signal` for the scan + inference).
      const onAcquireAbort = (): void => { void provider.close(); };
      signal?.addEventListener('abort', onAcquireAbort, { once: true });
      try {
        const localResult = await runEmbeddingPass({
          queries: this.queries,
          provider,
          // Persist local vectors under the provider-qualified key so they never collide
          // with an endpoint pointed at the same model name (FR-022): the pass keys
          // selection/upsert/coverage + the embedding_model scalar off config.model, and
          // LOCAL_VECTOR_MODEL keeps that distinct from the bare display id. `status` still
          // DISPLAYS the unprefixed model (getEmbeddingStatus below).
          //
          // Also force concurrency:1. runEmbeddingPass sizes its super-chunk as
          // batchSize*concurrency to keep an ENDPOINT's concurrent request pool busy, but the
          // local worker serializes one session (no pool — it processes the super-chunk one
          // text at a time), so a >1 multiplier gives zero throughput gain and only inflates
          // the single-message size, the memory held at once, and the span of the one embed
          // timeout. A batchSize-sized super-chunk preserves the per-batch commit cadence
          // (FR-029) and shrinks the abort-loss window.
          config: { ...config, model: LOCAL_VECTOR_MODEL, concurrency: 1 },
          transaction: <T>(fn: () => T): T => this.db.transaction(fn),
          runMaintenance: () => this.db.runMaintenance(),
          onProgress: (current, total) => onProgress?.({ phase: 'embedding', current, total }),
          refreshLock: () => {
            try {
              const now = new Date();
              fs.utimesSync(localLockPath, now, now);
            } catch { /* lock refresh is advisory */ }
          },
          readSource: (() => {
            const fileLines = new Map<string, string[] | undefined>();
            return (node: Node) => this.readNodeSource(node, fileLines);
          })(),
          signal,
        });
        // Don't warn about an abort the CALLER requested (cancellation is not a degradation).
        if (localResult.aborted && !signal?.aborted) {
          // Already redacted by construction (the LocalProvider reason is source-free —
          // FR-019c/FR-025a); carries the actionable degrade guidance (offline/checksum/
          // cache, or a session-init timeout). The pass never threw — embedding stays advisory.
          logWarn(
            'Embedding pass aborted; some symbols are unembedded but the enclosing index/sync operation is unaffected. ' +
            `Reason: ${localResult.abortReason ?? 'unknown'}`
          );
        }
      } finally {
        signal?.removeEventListener('abort', onAcquireAbort);
        // Tear down the worker at end of pass (idempotent; a no-op if init never spawned one).
        await provider.close();
      }
      return;
    }

    // Active (endpoint). Warn once if source code would cross the network in cleartext (FR-023).
    const cleartextWarning = plaintextRemoteWarning(config.url);
    if (cleartextWarning) logWarn(cleartextWarning);

    const provider = new EndpointProvider(config);
    const lockPath = path.join(getCodeGraphDir(this.projectRoot), 'codegraph.lock');

    const result = await runEmbeddingPass({
      queries: this.queries,
      provider,
      config,
      transaction: <T>(fn: () => T): T => this.db.transaction(fn),
      runMaintenance: () => this.db.runMaintenance(),
      onProgress: (current, total) => onProgress?.({ phase: 'embedding', current, total }),
      refreshLock: () => {
        // Keep the held index lock fresh across a long pass so it isn't reaped as
        // stale (FR-031). Best-effort — a refresh failure never stops the pass.
        try {
          const now = new Date();
          fs.utimesSync(lockPath, now, now);
        } catch { /* lock refresh is advisory */ }
      },
      // Pass-scoped per-file cache: the staleness scan recomposes inputs for every
      // embedded symbol, so without memoization a multi-symbol file would be re-read
      // and re-split once per symbol. The cache lives only for this pass (dropped when
      // the closure goes out of scope), so it never serves stale content across passes.
      readSource: (() => {
        const fileLines = new Map<string, string[] | undefined>();
        return (node: Node) => this.readNodeSource(node, fileLines);
      })(),
      signal,
    });

    // Surface an advisory abort's reason to the log rather than silently discarding the
    // result. The reason is already redacted by construction (endpoint + status only,
    // never source or credentials — FR-023/FR-025a), and it carries the actionable
    // guidance a user needs: FR-021's `CODEGRAPH_EMBEDDING_DIMS` message on a dimension
    // conflict, or the redacted endpoint-failure reason on an outage. The pass itself
    // never threw — embedding stays advisory, the index/sync is unaffected either way.
    // A caller-requested cancellation is not a degradation → no warning for it.
    if (result.aborted && !signal?.aborted) {
      logWarn(
        'Embedding pass aborted; some symbols are unembedded but the enclosing index/sync operation is unaffected. ' +
        `Reason: ${result.abortReason ?? 'unknown'}`
      );
    }
  }

  private async maybeRunLspPrecisionPass(
    cliActivation: CliLspActivation | undefined,
    structuralElapsedMs: number,
  ): Promise<void> {
    const config = resolveLspConfig({
      projectRoot: this.projectRoot,
      cliActivation: cliActivation ?? 'unspecified',
    });
    if (!config.enabled) return;

    const status = await runLspPrecisionPass({
      projectRoot: this.projectRoot,
      queries: this.queries,
      config,
      structuralElapsedMs,
    });
    this.queries.setMetadata(LSP_STATUS_METADATA_KEY, serializeLspStatus(status));
  }

  /**
   * Resolve a symbol's on-disk source snippet for the embedding pass: the file
   * slice `startLine`..`endLine`, read under the project root (mirrors the
   * context builder's node-source extraction). Any path escape, missing file, or
   * read error yields `undefined`, so the pass composes that symbol from its
   * in-graph fields alone rather than failing (FR-028).
   */
  private readNodeSource(node: Node, fileLines?: Map<string, string[] | undefined>): string | undefined {
    try {
      let lines = fileLines?.get(node.filePath);
      if (lines === undefined && !(fileLines?.has(node.filePath) ?? false)) {
        const absolutePath = validatePathWithinRoot(this.projectRoot, node.filePath);
        lines = absolutePath ? fs.readFileSync(absolutePath, 'utf-8').split('\n') : undefined;
        fileLines?.set(node.filePath, lines);
      }
      if (lines === undefined) return undefined;
      const startIdx = Math.max(0, node.startLine - 1);
      const endIdx = Math.min(lines.length, node.endLine);
      return lines.slice(startIdx, endIdx).join('\n');
    } catch {
      return undefined;
    }
  }

  /**
   * Index specific files
   *
   * Uses a mutex to prevent concurrent indexing operations.
   */
  async indexFiles(filePaths: string[]): Promise<IndexResult> {
    return this.indexMutex.withLock(async () => {
      try {
        this.fileLock.acquire();
      } catch {
        return { success: false, filesIndexed: 0, filesSkipped: 0, filesErrored: 0, nodesCreated: 0, edgesCreated: 0, errors: [{ message: 'Could not acquire file lock - another process may be indexing', severity: 'error' as const }], durationMs: 0 };
      }
      try {
        return this.orchestrator.indexFiles(filePaths);
      } finally {
        this.fileLock.release();
      }
    });
  }

  /**
   * Sync with current file state (incremental update)
   *
   * Uses a mutex to prevent concurrent indexing operations.
   */
  async sync(options: IndexOptions = {}): Promise<SyncResult> {
    return this.indexMutex.withLock(async () => {
      try {
        this.fileLock.acquire();
      } catch {
        return { filesChecked: 0, filesAdded: 0, filesModified: 0, filesRemoved: 0, nodesUpdated: 0, durationMs: 0 };
      }
      try {
        const structuralStartedAt = Date.now();
        // Captured BEFORE the sync runs: the sync's own incremental writes
        // populate vocab rows for the files it touches, so an end-of-sync
        // emptiness check would see "non-empty" and skip the backfill forever,
        // leaving every unchanged file's names unsegmented.
        const vocabWasEmpty = (() => {
          try { return this.queries.isNameSegmentVocabEmpty(); } catch { return false; }
        })();

        const result = await this.orchestrator.sync(options.onProgress);

        // Cross-file finalization (e.g. NestJS RouterModule prefixes). Run on
        // every sync that touched files so edits to `app.module.ts` propagate
        // to controllers in unchanged files. The pass is idempotent and cheap
        // (regex over *.module.ts only).
        if (result.filesAdded > 0 || result.filesModified > 0) {
          this.resolver.runPostExtract();
        }

        // Resolve references if files were updated
        if (result.filesAdded > 0 || result.filesModified > 0) {
          if (result.changedFilePaths) {
            // Scope resolution to changed files (git fast path — bounded set)
            const unresolvedRefs = this.queries.getUnresolvedReferencesByFiles(result.changedFilePaths);

            options.onProgress?.({
              phase: 'resolving',
              current: 0,
              total: unresolvedRefs.length,
            });

            this.resolver.resolveAndPersist(unresolvedRefs, (current, total) => {
              options.onProgress?.({
                phase: 'resolving',
                current,
                total,
              });
            });
          } else {
            // No git info — use batched resolution to avoid OOM
            const unresolvedCount = this.queries.getUnresolvedReferencesCount();

            options.onProgress?.({
              phase: 'resolving',
              current: 0,
              total: unresolvedCount,
            });

            await this.resolveReferencesBatched((current, total) => {
              options.onProgress?.({
                phase: 'resolving',
                current,
                total,
              });
            });
          }

          // Second pass: chained calls whose method lives on a supertype the
          // receiver conforms to (protocol-extension / inherited). Needs the
          // implements/extends edges built above (#750).
          await this.resolver.resolveChainedCallsViaConformance();
          // Same lifecycle for `this.<member>` callback registrations whose
          // member is inherited from a supertype (#808).
          await this.resolver.resolveDeferredThisMemberRefs();
        }

        if (result.filesAdded > 0 || result.filesModified > 0) {
          await this.maybeRunLspPrecisionPass(options.lsp, Date.now() - structuralStartedAt);
        }

        // Refresh planner stats + checkpoint the WAL after bulk writes.
        if (result.filesAdded > 0 || result.filesModified > 0 || result.filesRemoved > 0) {
          this.db.runMaintenance();
        }

        // Heal the segment vocabulary on indexes built before the table
        // existed (upgrade path): incremental writes above only cover changed
        // files, so a vocab that was empty when this sync STARTED means the
        // bulk was never segmented — backfill it (INSERT OR IGNORE, so the
        // rows the sync just wrote are fine). Batched + yielding — sync can
        // run on the daemon's liveness-watchdog thread (#850/#1091).
        try {
          if (vocabWasEmpty && this.queries.getNodeAndEdgeCount().nodes > 0) {
            await this.rebuildNameSegmentVocab();
          }
        } catch { /* vocab is advisory — never fail a sync over it */ }

        // Optional embedding pass over the resolved graph — the SAME advisory pass
        // indexAll runs, in sync()'s post-resolution slot. Run on every successful
        // sync REGARDLESS of change count: an incremental sync re-embeds only the
        // symbols whose input changed and reconciles deletions, while a zero-change
        // sync backfills any still-missing vectors (the FR-018 heal a plain
        // `codegraph sync` relies on — mirrors the vocab heal above, which also runs
        // independent of file changes). Fully dormant unless the embedding env vars
        // are set, and strictly advisory: any failure is swallowed so a broken embed
        // can never fail a sync (FR-014/019). The file watcher and the daemon both
        // drive this same sync(), so they inherit the pass with no extra wiring (FR-015).
        try {
          await this.maybeRunEmbeddingPass(options.onProgress, options.embeddingsProvider, options.signal);
        } catch (err) {
          // Advisory — an unexpected throw from the embedding wiring never fails a sync,
          // but must not be invisible. Only the error's NAME is surfaced (never its
          // message or cause), keeping endpoint/key redaction total (FR-023).
          logWarn(
            `Embedding pass skipped after an unexpected ${err instanceof Error ? err.name : 'error'} ` +
            '— the sync is unaffected.'
          );
        }

        return result;
      } finally {
        this.fileLock.release();
      }
    });
  }

  /**
   * Check if an indexing operation is currently in progress
   */
  isIndexing(): boolean {
    return this.indexMutex.isLocked();
  }

  // ===========================================================================
  // File Watching
  // ===========================================================================

  /**
   * Start watching for file changes and auto-syncing.
   *
   * Uses native OS file events (FSEvents on macOS, inotify on Linux 19+,
   * ReadDirectoryChangesW on Windows) with debouncing to avoid thrashing.
   *
   * @param options - Watch options (debounce delay, callbacks)
   * @returns true if watching started successfully
   */
  watch(options: WatchOptions = {}): boolean {
    if (this.watcher?.isActive()) return true;

    this.watcher = new FileWatcher(
      this.projectRoot,
      async () => {
        const result = await this.sync();
        // sync() returns this exact zero-shape iff it failed to acquire the
        // file lock (a real empty sync always has filesChecked > 0 because
        // scanDirectory ran). Surface that to the watcher as a typed error
        // so it keeps pendingFiles + reschedules instead of clearing them
        // (#449).
        if (result.filesChecked === 0 && result.durationMs === 0) {
          throw new LockUnavailableError();
        }
        const filesChanged = result.filesAdded + result.filesModified + result.filesRemoved;
        return { filesChanged, durationMs: result.durationMs };
      },
      options
    );

    return this.watcher.start();
  }

  /**
   * Stop watching for file changes.
   */
  unwatch(): void {
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }
  }

  /**
   * Check if the file watcher is active.
   */
  isWatching(): boolean {
    return this.watcher?.isActive() ?? false;
  }

  /**
   * True once live watching has permanently degraded (OS watch-resource
   * exhaustion, or a write lock held past the retry budget) and auto-sync is
   * disabled until the next {@link watch} call. Distinct from `!isWatching()`:
   * a stopped/never-started watcher is inactive but NOT degraded. MCP tools use
   * this to surface a whole-index "results may be stale" notice, since
   * `getPendingFiles()` goes empty once watching stops (#876).
   */
  isWatcherDegraded(): boolean {
    return this.watcher?.isDegraded() ?? false;
  }

  /** The reason live watching degraded, or null if it is healthy (#876). */
  getWatcherDegradedReason(): string | null {
    return this.watcher?.getDegradedReason() ?? null;
  }

  /**
   * Files seen by the file watcher since the last successful sync —
   * the per-file "stale" signal MCP tools attach to responses so an agent
   * can fall back to {@link Read} for just the affected file without
   * waiting for a debounced sync to complete (issue #403).
   *
   * Returns an empty list when the watcher isn't active, or no events have
   * arrived. Each entry includes `firstSeenMs` and `lastSeenMs` (wall-clock
   * `Date.now()` values) so callers can render "edited Nms ago", plus an
   * `indexing` flag indicating whether the in-flight sync (if any) will
   * absorb that file.
   */
  getPendingFiles(): PendingFile[] {
    return this.watcher?.getPendingFiles() ?? [];
  }

  /**
   * Resolves once the file watcher has installed its watch set. Useful for
   * tests that need a deterministic boundary before asserting on
   * `getPendingFiles()`. Resolves immediately when no watcher is active.
   */
  waitUntilWatcherReady(timeoutMs?: number): Promise<void> {
    return this.watcher ? this.watcher.waitUntilReady(timeoutMs) : Promise.resolve();
  }

  /**
   * Get files that have changed since last index
   */
  getChangedFiles(): { added: string[]; modified: string[]; removed: string[] } {
    return this.orchestrator.getChangedFiles();
  }

  /**
   * Most recent index timestamp (ms since epoch) across all tracked files, or
   * null when nothing is indexed yet. Lets library consumers check index
   * freshness without shelling out to `codegraph status --json`. (#329)
   */
  getLastIndexedAt(): number | null {
    return this.queries.getLastIndexedAt();
  }

  /**
   * Which engine built the current index: the package version + extraction
   * version stamped at the last full `indexAll`. Either field is null for an
   * index built before stamping existed (treated as stale). See
   * `extraction-version.ts` and `isIndexStale()`.
   */
  getIndexBuildInfo(): { version: string | null; extractionVersion: number | null } {
    const version = this.queries.getMetadata('indexed_with_version');
    const ev = this.queries.getMetadata('indexed_with_extraction_version');
    const parsed = ev != null ? parseInt(ev, 10) : NaN;
    return { version, extractionVersion: Number.isFinite(parsed) ? parsed : null };
  }

  /**
   * True when the on-disk index was built by an engine whose extraction is
   * older than the one now running — i.e. a re-index would add data a migration
   * can't backfill. False when there's no index yet (nothing to refresh) or the
   * stamp is current. This is the signal behind `codegraph status`'s re-index
   * hint and `codegraph upgrade`'s reminder.
   */
  isIndexStale(): boolean {
    if (this.queries.getLastIndexedAt() == null) return false;
    const { extractionVersion } = this.getIndexBuildInfo();
    return extractionVersion == null || extractionVersion < EXTRACTION_VERSION;
  }

  /**
   * Extract nodes and edges from source code (without storing)
   */
  extractFromSource(filePath: string, source: string): ExtractionResult {
    return extractFromSource(filePath, source);
  }

  // ===========================================================================
  // Reference Resolution
  // ===========================================================================

  /**
   * Resolve unresolved references and create edges
   *
   * This method takes unresolved references from extraction and attempts
   * to resolve them using multiple strategies:
   * - Framework-specific patterns (React, Express, Laravel)
   * - Import-based resolution
   * - Name-based symbol matching
   */
  resolveReferences(onProgress?: (current: number, total: number) => void): ResolutionResult {
    // Get all unresolved references from the database
    const unresolvedRefs = this.queries.getUnresolvedReferences();
    return this.resolver.resolveAndPersist(unresolvedRefs, onProgress);
  }

  /**
   * Resolve references in batches to keep memory bounded on large codebases.
   * Processes chunks of unresolved refs, persisting results after each batch.
   */
  async resolveReferencesBatched(onProgress?: (current: number, total: number) => void): Promise<ResolutionResult> {
    return this.resolver.resolveAndPersistBatched(onProgress);
  }

  /**
   * Get detected frameworks in the project
   */
  getDetectedFrameworks(): string[] {
    return this.resolver.getDetectedFrameworks();
  }

  /**
   * Re-initialize the resolver (useful after adding new files)
   */
  reinitializeResolver(): void {
    this.resolver.initialize();
  }

  // ===========================================================================
  // Graph Statistics
  // ===========================================================================

  /**
   * Get statistics about the knowledge graph
   */
  getStats(): GraphStats {
    const stats = this.queries.getStats();
    stats.dbSizeBytes = this.db.getSize();
    return stats;
  }

  /**
   * Active SQLite backend for this project's connection (`node-sqlite` — Node's
   * built-in real-SQLite module). Surfaced via `codegraph status` and the
   * `codegraph_status` MCP tool alongside the effective journal mode.
   */
  getBackend(): import('./db').SqliteBackend {
    return this.db.getBackend();
  }

  /**
   * The journal mode actually in effect ('wal', 'delete', …). 'wal' means
   * readers never block on a concurrent writer; anything else means they can,
   * which is the precondition for the "database is locked" failures in issue
   * #238. Surfaced via `codegraph status` and the `codegraph_status` MCP tool.
   */
  getJournalMode(): string {
    return this.db.getJournalMode();
  }

  /**
   * Embedding observability snapshot for `codegraph status` (SPEC-001 FR-022 /
   * contract `status-embedding-json.md`). Pure and network-free in every state:
   * it reads the activation config from the environment and the model/dims
   * scalars + coverage counts from the on-disk index — dormancy is never broken
   * to produce it (FR-023). See {@link EmbeddingStatus} for the three variants
   * (active / dormant — optionally carrying prior-run data / misconfigured).
   */
  getEmbeddingStatus(): EmbeddingStatus {
    const config = loadEmbeddingConfig(process.env);

    // Half-config — exactly one of URL/MODEL set: feature off, name the gap (FR-001a).
    // Or an unrecognized CODEGRAPH_EMBEDDING_PROVIDER value: propagate the invalid-value
    // shape so the status renderer says "must be one of: …" instead of "not set" (P2-1).
    if (config !== null && 'misconfigured' in config) {
      const status: EmbeddingStatusMisconfigured = {
        active: false,
        misconfigured: true,
        missingVariable: config.missingVariable,
        activationVars: EMBEDDING_ACTIVATION_VARS.slice(),
      };
      if (config.missingVariables !== undefined) status.missingVariables = config.missingVariables;
      if (config.invalidValue !== undefined) {
        status.invalidValue = config.invalidValue;
        if (config.allowedValues !== undefined) status.allowedValues = config.allowedValues;
      }
      return status;
    }

    // SPEC-002: an explicit local selection is active — no endpoint exists to reach
    // (network-free). Report the ACTIVE local model, NOT the persisted scalar: a
    // project embedded via an endpoint before the switch to local still carries that
    // PRIOR model's scalars + vectors on disk, and surfacing them (a stale model and
    // its stale coverage) would hide that no local vectors exist yet. Coverage is for
    // the active model too (0% until a local pass runs), and the persisted dimension
    // is trusted ONLY when the persisted model IS this active model — otherwise it
    // describes the other (endpoint) model, so the config's pinned 384 stands in. When
    // there was something to embed but nothing carries a vector under this model,
    // attach the best-effort FR-020 skip reason.
    if (config !== null && 'provider' in config) {
      // Vectors persist under the provider-qualified key (see maybeRunEmbeddingPass) —
      // coverage + the dims scalar are keyed by it, while the user sees the unprefixed model.
      const displayModel = config.model;
      const storageModel = LOCAL_VECTOR_MODEL;
      const persistedModel = this.queries.getMetadata('embedding_model');
      const dims = persistedModel === storageModel
        ? parseStoredDims(this.queries.getMetadata('embedding_dims')) ?? config.dims
        : config.dims;
      const coverage = this.embeddingCoverageOf(storageModel);
      const status: EmbeddingStatusActive = {
        active: true,
        provider: 'local',
        model: displayModel,
        dims,
        coverage,
      };
      if (coverage.embeddable > 0 && coverage.embedded === 0) {
        status.skipReason = this.localEmbeddingSkipReason();
      }
      return status;
    }

    // Active — both URL and MODEL set (FR-001). Report the ACTIVE endpoint model, NOT
    // the persisted scalar (mirrors the local branch above / P1-1): a project embedded
    // under a DIFFERENT model — a prior endpoint model, or local before the switch to
    // endpoint — still carries that model's scalars + vectors on disk, and surfacing them
    // (a stale model at its stale/100% coverage) would hide that no vectors exist for the
    // ACTIVE endpoint model yet. Coverage is for the active model too; the persisted
    // dimension is trusted ONLY when the persisted model IS this active model — otherwise
    // it describes the other model, so the live config's dimension (which may be null for
    // an endpoint) stands in.
    if (config !== null && !('provider' in config)) {
      const model = config.model;
      const persistedModel = this.queries.getMetadata('embedding_model');
      const dims = persistedModel === model
        ? parseStoredDims(this.queries.getMetadata('embedding_dims')) ?? config.dims ?? null
        : config.dims ?? null;
      return {
        active: true,
        provider: 'endpoint',
        endpoint: redactEndpoint(config.url),
        model,
        dims,
        coverage: this.embeddingCoverageOf(model),
      };
    }

    // Fully dormant — neither set (FR-002), OR an explicit CODEGRAPH_EMBEDDING_PROVIDER=off
    // (which config collapses to null too). Flag the explicit-off case so `status` can give
    // accurate guidance rather than the plain "set URL and MODEL" hint. Attach a prior-run
    // snapshot ONLY when a model scalar and at least one live vector for it survive on disk;
    // read entirely from disk, so reporting a prior run never reaches the (now-unset) endpoint.
    const dormant: EmbeddingStatusDormant = {
      active: false,
      activationVars: EMBEDDING_ACTIVATION_VARS.slice(),
    };
    if (isEmbeddingProviderOff(process.env)) dormant.disabledByProvider = true;
    const previousModel = this.queries.getMetadata('embedding_model');
    if (previousModel !== null) {
      const coverage = this.embeddingCoverageOf(previousModel);
      if (coverage.embedded > 0) {
        dormant.previousRun = {
          // Coverage is keyed by the raw stored key; the display strips a local: prefix
          // so a prior local run shows the bare checkpoint id (mirrors the active branch).
          model: displayEmbeddingModel(previousModel),
          dims: parseStoredDims(this.queries.getMetadata('embedding_dims')),
          coverage,
        };
      }
    }
    return dormant;
  }

  /**
   * LSP precision status for `codegraph status`. Reading status never starts a
   * language server; it returns the last persisted LSP run when present, or the
   * current default/project config context otherwise.
   */
  getLspStatus(): LspStatus {
    const persisted = parsePersistedLspStatus(this.queries.getMetadata(LSP_STATUS_METADATA_KEY));
    if (persisted) return persisted;
    const config = resolveLspConfig({ projectRoot: this.projectRoot });
    return createInitialLspStatus(config);
  }

  /**
   * Coverage counts for `model` with the derived percentage: `round(embedded /
   * embeddable * 100)`, or 100 when nothing is embeddable (trivially complete).
   */
  private embeddingCoverageOf(model: string): EmbeddingCoverageStatus {
    const { embeddable, embedded } = this.queries.getEmbeddingCoverage(model);
    const percent = embeddable === 0 ? 100 : Math.round((embedded / embeddable) * 100);
    return { embedded, embeddable, percent };
  }

  /**
   * Best-effort FR-020 skip reason for a 0%-coverage LOCAL-provider status —
   * a network-free filesystem probe of the resolved model cache (never a
   * persisted record of a specific past pass's abort; none is kept). See
   * {@link LocalEmbeddingSkipReason}.
   */
  private localEmbeddingSkipReason(): LocalEmbeddingSkipReason {
    switch (probeLocalModelCache(process.env, localModelCacheProbeOverridesForTests)) {
      case 'invalid-cache': return 'cache';
      case 'invalid-base-url': return 'invalid-base-url';
      case 'insecure-permissions': return 'insecure-permissions';
      case 'verified': return 'session-init-timeout';
      case 'missing': default: return 'offline';
    }
  }

  // ===========================================================================
  // Node Operations
  // ===========================================================================

  /**
   * Get a node by ID
   */
  getNode(id: string): Node | null {
    return this.queries.getNodeById(id);
  }

  /**
   * Get all nodes in a file
   */
  getNodesInFile(filePath: string): Node[] {
    return this.queries.getNodesByFile(filePath);
  }

  /**
   * Get all nodes of a specific kind
   */
  getNodesByKind(kind: Node['kind']): Node[] {
    return this.queries.getNodesByKind(kind);
  }

  /**
   * Get ALL nodes with an exact name (direct index lookup, not FTS-ranked/capped).
   * Used to enumerate every overload of a heavily-overloaded name so the specific
   * definition the caller wants is never dropped below a search cut.
   */
  getNodesByName(name: string): Node[] {
    return this.queries.getNodesByName(name);
  }

  /**
   * Search nodes by text
   */
  searchNodes(query: string, options?: SearchOptions): SearchResult[] {
    return this.queries.searchNodes(query, options);
  }

  /**
   * Graph-derived prompt matching for the front-load hook's MEDIUM tier:
   * which indexed symbols do these prose words name? "state machine des
   * commandes" → `OrderStateMachine`, in any human language whose technical
   * nouns are Latin script — no keyword list involved.
   *
   * Precision comes from the repo's own naming statistics, not vocabulary:
   * - CO-OCCURRENCE: ≥2 words that are segments of the SAME name ("state" +
   *   "machine" → OrderStateMachine) is strong evidence and always qualifies.
   * - RARITY: a single matched word qualifies only when its segment is
   *   discriminative here (≤ {@link SEGMENT_RARITY_CEILING} distinct names) —
   *   "checkout" in a shop backend yes, "state" in a react app no.
   * Every candidate is re-verified against `nodes` before being returned
   * (vocab rows are proposals; deletions leave orphans by design), so a
   * returned symbol is guaranteed to exist right now.
   */
  getSegmentMatches(words: string[], limit: number = 6): SegmentMatch[] {
    if (words.length === 0) return [];
    // Variant → original word (plural folding), for coverage accounting.
    const variantToWord = new Map<string, string>();
    for (const word of words) {
      for (const variant of segmentLookupVariants(word)) {
        if (!variantToWord.has(variant)) variantToWord.set(variant, word);
      }
    }
    const variants = [...variantToWord.keys()];

    // Tier A: co-occurrence. The SQL folds variants back to their original
    // word (#1146), so minWords=2 means two distinct PROMPT WORDS — a name
    // matching both `service` and `services` can't tie with (or crowd past
    // the LIMIT) a genuine two-word match. The JS re-check below recomputes
    // the fold from live segments as the honesty layer.
    const variantPairs = [...variantToWord.entries()].map(([segment, word]) => ({ segment, word }));
    const candidates: Array<{ name: string; matchedWords: Set<string> }> = [];
    for (const hit of this.queries.getSegmentCoOccurrence(variantPairs, 2, 24)) {
      const matched = this.wordsMatchingName(hit.name, variantToWord);
      if (matched.size >= 2) candidates.push({ name: hit.name, matchedWords: matched });
    }

    // Tier B: single rare word. Only when co-occurrence found nothing — a
    // co-occurring name is categorically stronger evidence — and under
    // stricter rules, because one word is thin: the word must be ≥5 chars
    // (measured FPs: "this", "typo"); the segment must appear in AT LEAST TWO
    // names (a concept the codebase is about clusters across names —
    // CheckoutService/CheckoutController — while a prose coincidence is a
    // singleton: measured FP "deploy to PRODUCTION" → the one name
    // matchesNonProductionDir); and the candidate name must have ≥2 segments
    // (a bare common verb matching a bare function name — "write" → `write` —
    // is prose coincidence, not the user naming a symbol).
    if (candidates.length === 0) {
      const singleWordVariants = variants.filter((v) => variantToWord.get(v)!.length >= 5);
      const counts = this.queries.getSegmentNameCounts(singleWordVariants);
      const rare = [...counts.entries()]
        .filter(([, n]) => n >= 2 && n <= CodeGraph.SEGMENT_RARITY_CEILING)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 2);
      for (const [variant] of rare) {
        const word = variantToWord.get(variant)!;
        for (const name of this.queries.getNamesForSegment(variant, 12)) {
          if (splitIdentifierSegments(name).length < 2) continue;
          candidates.push({ name, matchedWords: new Set([word]) });
        }
      }
    }

    // Verify against nodes (the honesty gate) and pick a representative
    // definition per name. A name whose only nodes are file/import kind has
    // no real definition to point at — surfacing the import statement instead
    // reads as a matched symbol but isn't one (#1144) — so it's skipped, the
    // same way an orphaned vocab row is. (Import names no longer enter the
    // vocab at write time, but rows written before that exclusion persist
    // until the next full index.)
    const out: SegmentMatch[] = [];
    const seen = new Set<string>();
    candidates.sort((a, b) => b.matchedWords.size - a.matchedWords.size || a.name.length - b.name.length);
    for (const candidate of candidates) {
      if (out.length >= limit) break;
      if (seen.has(candidate.name)) continue;
      seen.add(candidate.name);
      const nodes = this.queries.getNodesByName(candidate.name);
      if (nodes.length === 0) continue; // orphaned vocab row — name no longer exists
      const rep = nodes.find((n) => n.kind !== 'file' && n.kind !== 'import');
      if (!rep) continue; // no real definition — don't surface an import/file as one
      out.push({
        name: candidate.name,
        kind: rep.kind,
        filePath: rep.filePath,
        startLine: rep.startLine ?? 0,
        matchedWords: [...candidate.matchedWords].sort(),
      });
    }
    return out;
  }

  /** A single word ("state") can match hundreds of names in a big repo — that
   *  is noise, not signal. Ceiling for the single-word tier; co-occurrence is
   *  exempt because two words on one name is already discriminative. */
  private static readonly SEGMENT_RARITY_CEILING = 25;

  /** Which of the prompt's original words match `name`'s segments (via
   *  variants). Segments are recomputed in JS — a name-keyed vocab lookup
   *  would scan the (segment, name) primary key. */
  private wordsMatchingName(name: string, variantToWord: Map<string, string>): Set<string> {
    const segments = new Set(splitIdentifierSegments(name));
    const matched = new Set<string>();
    for (const [variant, word] of variantToWord) {
      if (segments.has(variant)) matched.add(word);
    }
    return matched;
  }

  /**
   * One-shot upgrade heal for callers that open the graph WITHOUT syncing —
   * concretely the prompt hook, whose MEDIUM tier reads the segment
   * vocabulary: a database migrated from before the vocab table existed
   * starts with it empty, and the only other backfill lives inside `sync()`,
   * which such callers never run (#1142). Returns true when the vocab is
   * usable (already populated — the overwhelmingly common one-SELECT case —
   * or healed here); false when it isn't (empty graph, or another process
   * holds the index lock — that process's own sync heals it).
   */
  async healSegmentVocabIfEmpty(): Promise<boolean> {
    const empty = (() => {
      try { return this.queries.isNameSegmentVocabEmpty(); } catch { return false; }
    })();
    if (!empty) return true;
    if (this.queries.getNodeAndEdgeCount().nodes === 0) return false;
    return this.indexMutex.withLock(async () => {
      try {
        this.fileLock.acquire();
      } catch {
        return false; // an index/sync is running — it backfills the vocab itself
      }
      try {
        if (!this.queries.isNameSegmentVocabEmpty()) return true; // raced: healed meanwhile
        await this.rebuildNameSegmentVocab();
        return true;
      } finally {
        this.fileLock.release();
      }
    });
  }

  /**
   * Rebuild the segment vocabulary from the current graph, batched and
   * yielding — the upgrade-heal path for indexes built before the vocab table
   * existed. Runs inside the index mutex/lock (sync and
   * healSegmentVocabIfEmpty hold them).
   */
  private async rebuildNameSegmentVocab(): Promise<void> {
    const maybeYield = createYielder();
    const BATCH = 2000;
    for (let offset = 0; ; offset += BATCH) {
      const names = this.queries.getDistinctNodeNames(BATCH, offset);
      if (names.length === 0) break;
      this.queries.insertNameSegmentsBatch(names);
      await maybeYield();
    }
  }

  /**
   * Normalized project-name tokens (go.mod / package.json / repo dir) used to
   * down-weight the non-discriminative project name in search ranking (#720).
   * Exposed so explore can exclude it from the PascalCase type-disambiguation
   * bias, which would otherwise pull overloaded tokens toward whichever stack
   * embeds the project name.
   */
  getProjectNameTokens(): Set<string> {
    return this.queries.getProjectNameTokens();
  }

  /**
   * Find the project's "primary route file" — the file with the densest
   * concentration of framework-emitted `route` nodes (≥3 routes, ≥30%
   * of all non-test routes). Used to inline the routing config in
   * `codegraph_explore` responses on small realworld template repos
   * (rails-realworld, laravel-realworld, drupal-admintoolbar, …) where
   * Glob+Read of `routes.rb`/`urls.py`/etc. otherwise beats codegraph.
   */
  getTopRouteFile(): { filePath: string; routeCount: number; totalRoutes: number } | null {
    return this.queries.getTopRouteFile();
  }

  /**
   * Build a URL → handler routing manifest from the index. Each entry
   * pairs a route node (URL + method) with its handler function/method
   * via the `references` edge that framework resolvers emit. Returns
   * null when fewer than 3 valid (non-test) routes exist.
   */
  getRoutingManifest(limit?: number): {
    entries: Array<{ url: string; handler: string; handlerFile: string; handlerLine: number; handlerKind: string }>;
    topHandlerFile: string | null;
    topHandlerFileCount: number;
    totalRoutes: number;
  } | null {
    return this.queries.getRoutingManifest(limit);
  }

  // ===========================================================================
  // Edge Operations
  // ===========================================================================

  /**
   * Get outgoing edges from a node
   */
  getOutgoingEdges(nodeId: string): Edge[] {
    return this.queries.getOutgoingEdges(nodeId);
  }

  /**
   * Get incoming edges to a node
   */
  getIncomingEdges(nodeId: string): Edge[] {
    return this.queries.getIncomingEdges(nodeId);
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Get a file record by path
   */
  getFile(filePath: string): FileRecord | null {
    return this.queries.getFileByPath(filePath);
  }

  /**
   * Get all tracked files
   */
  getFiles(): FileRecord[] {
    return this.queries.getAllFiles();
  }

  // ===========================================================================
  // Graph Query Methods
  // ===========================================================================

  /**
   * Get the context for a node (ancestors, children, references)
   *
   * Returns comprehensive context about a node including its containment
   * hierarchy, children, incoming/outgoing references, type information,
   * and relevant imports.
   *
   * @param nodeId - ID of the focal node
   * @returns Context object with all related information
   */
  getContext(nodeId: string): Context {
    return this.graphManager.getContext(nodeId);
  }

  /**
   * Traverse the graph from a starting node
   *
   * Uses breadth-first search by default. Supports filtering by edge types,
   * node types, and traversal direction.
   *
   * @param startId - Starting node ID
   * @param options - Traversal options
   * @returns Subgraph containing traversed nodes and edges
   */
  traverse(startId: string, options?: TraversalOptions): Subgraph {
    return this.traverser.traverseBFS(startId, options);
  }

  /**
   * Get the call graph for a function
   *
   * Returns both callers (functions that call this function) and
   * callees (functions called by this function) up to the specified depth.
   *
   * @param nodeId - ID of the function/method node
   * @param depth - Maximum depth in each direction (default: 2)
   * @returns Subgraph containing the call graph
   */
  getCallGraph(nodeId: string, depth: number = 2): Subgraph {
    return this.traverser.getCallGraph(nodeId, depth);
  }

  /**
   * Get the type hierarchy for a class/interface
   *
   * Returns both ancestors (types this extends/implements) and
   * descendants (types that extend/implement this).
   *
   * @param nodeId - ID of the class/interface node
   * @returns Subgraph containing the type hierarchy
   */
  getTypeHierarchy(nodeId: string): Subgraph {
    return this.traverser.getTypeHierarchy(nodeId);
  }

  /**
   * Find all usages of a symbol
   *
   * Returns all nodes that reference the specified symbol through
   * any edge type (calls, references, type_of, etc.).
   *
   * @param nodeId - ID of the symbol node
   * @returns Array of nodes and edges that reference this symbol
   */
  findUsages(nodeId: string): Array<{ node: Node; edge: Edge }> {
    return this.traverser.findUsages(nodeId);
  }

  /**
   * Get callers of a function/method
   *
   * @param nodeId - ID of the function/method node
   * @param maxDepth - Maximum depth to traverse (default: 1)
   * @returns Array of nodes that call this function
   */
  getCallers(nodeId: string, maxDepth: number = 1): Array<{ node: Node; edge: Edge }> {
    return this.traverser.getCallers(nodeId, maxDepth);
  }

  /**
   * Get callees of a function/method
   *
   * @param nodeId - ID of the function/method node
   * @param maxDepth - Maximum depth to traverse (default: 1)
   * @returns Array of nodes called by this function
   */
  getCallees(nodeId: string, maxDepth: number = 1): Array<{ node: Node; edge: Edge }> {
    return this.traverser.getCallees(nodeId, maxDepth);
  }

  /**
   * Calculate the impact radius of a node
   *
   * Returns all nodes that could be affected by changes to this node.
   *
   * @param nodeId - ID of the node
   * @param maxDepth - Maximum depth to traverse (default: 3)
   * @returns Subgraph containing potentially impacted nodes
   */
  getImpactRadius(nodeId: string, maxDepth: number = 3): Subgraph {
    return this.traverser.getImpactRadius(nodeId, maxDepth);
  }

  /**
   * Find the shortest path between two nodes
   *
   * @param fromId - Starting node ID
   * @param toId - Target node ID
   * @param edgeKinds - Edge types to consider (all if empty)
   * @returns Array of nodes and edges forming the path, or null if no path exists
   */
  findPath(
    fromId: string,
    toId: string,
    edgeKinds?: Edge['kind'][]
  ): Array<{ node: Node; edge: Edge | null }> | null {
    return this.traverser.findPath(fromId, toId, edgeKinds);
  }

  /**
   * Get ancestors of a node in the containment hierarchy
   *
   * @param nodeId - ID of the node
   * @returns Array of ancestor nodes from immediate parent to root
   */
  getAncestors(nodeId: string): Node[] {
    return this.traverser.getAncestors(nodeId);
  }

  /**
   * Get immediate children of a node
   *
   * @param nodeId - ID of the node
   * @returns Array of child nodes
   */
  getChildren(nodeId: string): Node[] {
    return this.traverser.getChildren(nodeId);
  }

  /**
   * Get dependencies of a file
   *
   * @param filePath - Path to the file
   * @returns Array of file paths this file depends on
   */
  getFileDependencies(filePath: string): string[] {
    return this.graphManager.getFileDependencies(filePath);
  }

  /**
   * Get dependents of a file
   *
   * @param filePath - Path to the file
   * @returns Array of file paths that depend on this file
   */
  getFileDependents(filePath: string): string[] {
    return this.graphManager.getFileDependents(filePath);
  }

  /**
   * Find circular dependencies in the codebase
   *
   * @returns Array of cycles, each cycle is an array of file paths
   */
  findCircularDependencies(): string[][] {
    return this.graphManager.findCircularDependencies();
  }

  /**
   * Find dead code (unreferenced symbols)
   *
   * @param kinds - Node kinds to check (default: functions, methods, classes)
   * @returns Array of unreferenced nodes
   */
  findDeadCode(kinds?: Node['kind'][]): Node[] {
    return this.graphManager.findDeadCode(kinds);
  }

  /**
   * Get complexity metrics for a node
   *
   * @param nodeId - ID of the node
   * @returns Object containing various complexity metrics
   */
  getNodeMetrics(nodeId: string): {
    incomingEdgeCount: number;
    outgoingEdgeCount: number;
    callCount: number;
    callerCount: number;
    childCount: number;
    depth: number;
  } {
    return this.graphManager.getNodeMetrics(nodeId);
  }

  // ===========================================================================
  // Context Building
  // ===========================================================================

  /**
   * Get the source code for a node
   *
   * Reads the file and extracts the code between startLine and endLine.
   *
   * @param nodeId - ID of the node
   * @returns Code string or null if not found
   */
  async getCode(nodeId: string): Promise<string | null> {
    return this.contextBuilder.getCode(nodeId);
  }

  /**
   * Find relevant subgraph for a query
   *
   * Combines semantic search with graph traversal to find the most
   * relevant nodes and their relationships for a given query.
   *
   * @param query - Natural language query describing the task
   * @param options - Search and traversal options
   * @returns Subgraph of relevant nodes and edges
   */
  async findRelevantContext(
    query: string,
    options?: FindRelevantContextOptions
  ): Promise<Subgraph> {
    return this.contextBuilder.findRelevantContext(query, options);
  }

  /**
   * Build context for a task
   *
   * Creates comprehensive context by:
   * 1. Running FTS search to find entry points
   * 2. Expanding the graph around entry points
   * 3. Extracting code blocks for key nodes
   * 4. Formatting output for Claude
   *
   * @param input - Task description (string or {title, description})
   * @param options - Build options (maxNodes, includeCode, format, etc.)
   * @returns TaskContext object or formatted string (markdown/JSON)
   */
  async buildContext(
    input: TaskInput,
    options?: BuildContextOptions
  ): Promise<TaskContext | string> {
    return this.contextBuilder.buildContext(input, options);
  }

  // ===========================================================================
  // Database Management
  // ===========================================================================

  /**
   * Optimize the database (vacuum and analyze)
   */
  optimize(): void {
    this.db.optimize();
  }

  /**
   * Clear all data from the graph
   */
  clear(): void {
    this.queries.clear();
  }

  /**
   * Alias for close() for backwards compatibility.
   * @deprecated Use close() instead
   */
  destroy(): void {
    this.close();
  }

  /**
   * Completely remove CodeGraph from the project.
   * This closes the database and deletes the .CodeGraph directory.
   *
   * WARNING: This permanently deletes all CodeGraph data for the project.
   */
  uninitialize(): void {
    this.close();
    removeDirectory(this.projectRoot);
  }
}

// Default export
export default CodeGraph;
