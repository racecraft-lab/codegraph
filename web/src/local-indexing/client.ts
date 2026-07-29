import {
  RepositoryClientError,
  normalizeDepthRequest,
  normalizeRelationshipRequest,
  REPOSITORY_QUERY_LIMITS,
  type DepthRequest,
  type RelationshipRequest,
  type RepositoryClient,
  type RepositoryClientErrorCode,
  type SearchRequest,
  type SourceResult,
} from "../lib/repository-client"
import type {
  CodeNode,
  GraphResult,
  ListResult,
  Repository,
  RepositoryStatus,
  SearchResult,
} from "../lib/api/types"
import {
  WORKER_BUDGETS,
  WORKER_PROTOCOL_VERSION,
  isWorkerRequest,
  isWorkerResponse,
  type WorkerRequestKind,
  type WorkerResponse,
} from "./worker"
import {
  createPickedFolderProvider,
  LocalStorageSnapshotRepositoryRegistry,
  type DirectoryHandleLike,
  type SnapshotRepositoryRegistry,
  type SnapshotSourceKind,
  type SnapshotSourceCollection,
  type SourceCollection,
  type SourceConnection,
  type SourceHandleRegistry,
  type SourceIdentity,
} from "./source"
import {
  mergeWorkerCapabilityReport,
  probeBrowserCapabilities,
  type BrowserCapabilityReport,
  type CapabilityProbeEnvironment,
  type WorkerRuntimeCapabilityReport,
} from "./capabilities"

interface WorkerTransport {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: EventListener
  ): void
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: EventListener
  ): void
  terminate?(): void
}

interface PendingRequest {
  operationId?: string
  resolve(value: unknown): void
  reject(error: unknown): void
}

export interface LocalRepositoryClientOptions {
  createId?: () => string
  onProgress?: (progress: LocalRepositoryProgress) => void
  sourceRegistry?: SourceHandleRegistry
  storageManager?: BrowserStorageManager
  capabilityEnvironment?: CapabilityProbeEnvironment
  snapshotRegistry?: SnapshotRepositoryRegistry
}

export interface BrowserStorageManager {
  estimate?: () => Promise<{ usage?: number; quota?: number }>
  persisted?: () => Promise<boolean>
  persist?: () => Promise<boolean>
}

export interface LocalStorageStatus {
  usageBytes?: number
  quotaBytes?: number
  persisted: "granted" | "denied" | "unknown" | "not-supported"
}

export interface LocalRepositoryProgress {
  requestId: string
  operationId?: string
  repositoryId?: string
  phase: string
  completed: number
  total: number
}

export interface SnapshotImportRequest {
  identity: SourceIdentity
  collection: SnapshotSourceCollection
  replace?: {
    repositoryId: string
    confirmed: boolean
  }
}

export interface SemanticIndexRequest {
  endpointUrl: string
  model: string
  dimensions?: number
  graphGeneration: number
  credential: string
  consentGrantedAt: string
  resume?: {
    graphGeneration: number
    model: string
    dimensions?: number
    completedItems: number
    inputHashes: string[]
  }
}

interface SemanticSearchSession {
  endpointUrl: string
  model: string
  dimensions?: number
  graphGeneration: number
  credential: string
}

function createId() {
  return crypto.randomUUID()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isRepository(value: unknown): value is Repository {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.root === "string" &&
    typeof value.name === "string" &&
    typeof value.default === "boolean"
  )
}

function invalidWorkerResult(): never {
  throw new RepositoryClientError(
    "internal",
    "The browser-local indexing worker returned an invalid result.",
    false
  )
}

function decodeWorkerResult<T>(
  kind: WorkerRequestKind,
  payload: unknown,
  value: unknown
): T {
  if (
    kind === "query" &&
    isRecord(payload) &&
    payload.query === "list-repositories"
  ) {
    if (!Array.isArray(value) || !value.every(isRepository)) {
      return invalidWorkerResult()
    }
    return value as T
  }
  if (kind === "open-picked-folder" || kind === "import-snapshot") {
    if (!isRepository(value)) return invalidWorkerResult()
    return value as T
  }
  if (kind === "embed") {
    if (
      !isRecord(value) ||
      value.status !== "complete" ||
      !Number.isSafeInteger(value.graphGeneration) ||
      Number(value.graphGeneration) <= 0 ||
      !Number.isSafeInteger(value.embedded) ||
      Number(value.embedded) < 0 ||
      (value.dimensions !== undefined &&
        (!Number.isSafeInteger(value.dimensions) ||
          Number(value.dimensions) <= 0))
    ) {
      return invalidWorkerResult()
    }
    return value as T
  }
  if (!isRecord(value)) return invalidWorkerResult()
  return value as T
}

export class LocalRepositoryClient implements RepositoryClient {
  private readonly worker: WorkerTransport
  private readonly createId: () => string
  private readonly onProgress?: (progress: LocalRepositoryProgress) => void
  private readonly sourceRegistry?: SourceHandleRegistry
  private readonly storageManager: BrowserStorageManager
  private readonly capabilityEnvironment?: CapabilityProbeEnvironment
  private readonly snapshotRegistry: SnapshotRepositoryRegistry
  private readonly sourceConnections = new Map<string, SourceConnection>()
  private readonly sourceIdentities = new Map<string, SourceIdentity>()
  private readonly semanticSessions = new Map<string, SemanticSearchSession>()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly onMessage: EventListener
  private readonly onWorkerFailure: EventListener
  private closed = false
  private closing?: Promise<void>

  constructor(
    worker: WorkerTransport,
    options: LocalRepositoryClientOptions = {}
  ) {
    this.worker = worker
    this.createId = options.createId ?? createId
    this.onProgress = options.onProgress
    this.sourceRegistry = options.sourceRegistry
    this.capabilityEnvironment = options.capabilityEnvironment
    this.snapshotRegistry =
      options.snapshotRegistry ?? new LocalStorageSnapshotRepositoryRegistry()
    this.storageManager =
      options.storageManager ??
      ((typeof navigator === "undefined" ? undefined : navigator.storage) as
        BrowserStorageManager | undefined) ??
      {}
    this.onMessage = (event) => this.handleMessage((event as MessageEvent).data)
    this.onWorkerFailure = () => this.failWorker()
    this.worker.addEventListener("message", this.onMessage)
    this.worker.addEventListener("error", this.onWorkerFailure)
    this.worker.addEventListener("messageerror", this.onWorkerFailure)
  }

  private handleMessage(candidate: unknown) {
    if (!candidate || typeof candidate !== "object") return
    const requestId =
      "requestId" in candidate && typeof candidate.requestId === "string"
        ? candidate.requestId
        : undefined
    if (!isWorkerResponse(candidate)) {
      const pending = requestId ? this.pending.get(requestId) : undefined
      if (pending) {
        this.pending.delete(requestId!)
        pending.reject(
          new RepositoryClientError(
            "internal",
            "The browser-local indexing worker returned an invalid response.",
            false
          )
        )
      }
      return
    }
    const message: WorkerResponse = candidate
    const pending = this.pending.get(message.requestId)
    if (!pending) return
    if (
      pending.operationId &&
      message.operationId &&
      pending.operationId !== message.operationId
    ) {
      return
    }
    if (message.type === "progress") {
      this.onProgress?.({
        requestId: message.requestId,
        ...(message.operationId ? { operationId: message.operationId } : {}),
        ...(message.repositoryId ? { repositoryId: message.repositoryId } : {}),
        phase: message.phase,
        completed: message.completed,
        total: message.total,
      })
      return
    }
    this.pending.delete(message.requestId)
    if (message.type === "failure") {
      pending.reject(
        new RepositoryClientError(
          (message.error?.code ?? "internal") as RepositoryClientErrorCode,
          message.error?.message ?? "The local repository request failed.",
          message.error?.retryable ?? false
        )
      )
      return
    }
    pending.resolve(message.result)
  }

  private failWorker() {
    if (this.closed) return
    this.closed = true
    this.worker.removeEventListener("message", this.onMessage)
    this.worker.removeEventListener("error", this.onWorkerFailure)
    this.worker.removeEventListener("messageerror", this.onWorkerFailure)
    const error = new RepositoryClientError(
      "unavailable",
      "The browser-local indexing worker stopped unexpectedly.",
      true
    )
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    this.semanticSessions.clear()
    this.worker.terminate?.()
  }

  private request<T>(
    kind: WorkerRequestKind,
    payload?: unknown,
    repositoryId?: string,
    operationId?: string,
    transfer?: Transferable[]
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(
        new RepositoryClientError(
          "unavailable",
          "The local repository client is closed.",
          false
        )
      )
    }
    const requestId = this.createId()
    const message = {
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId,
      ...(operationId ? { operationId } : {}),
      ...(repositoryId ? { repositoryId } : {}),
      kind,
      ...(payload === undefined ? {} : { payload }),
    }
    if (!isWorkerRequest(message)) {
      return Promise.reject(
        new RepositoryClientError(
          "invalid_request",
          "The browser-local client constructed an invalid worker request.",
          false
        )
      )
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        ...(operationId ? { operationId } : {}),
        resolve: (value) => {
          try {
            resolve(decodeWorkerResult<T>(kind, payload, value))
          } catch (error) {
            reject(error)
          }
        },
        reject,
      })
      if (transfer) this.worker.postMessage(message, transfer)
      else this.worker.postMessage(message)
    })
  }

  private async batchedSourcePayload(
    payload: {
      identity: SourceIdentity
      collection: SourceCollection | SnapshotSourceCollection
    },
    repositoryId: string,
    operationId: string
  ) {
    const { entries } = payload.collection
    const totalBytes = entries.reduce(
      (total, entry) => total + entry.bytes.byteLength,
      0
    )
    if (
      entries.length <= WORKER_BUDGETS.maxFilesPerReadBatch &&
      totalBytes <= WORKER_BUDGETS.maxBytesPerReadBatch
    ) {
      return { payload, batched: false }
    }

    const batches: (typeof entries)[] = []
    let batch: typeof entries = []
    let batchBytes = 0
    for (const entry of entries) {
      const entryBytes = entry.bytes.byteLength
      if (
        entryBytes > WORKER_BUDGETS.maxBytesPerReadBatch ||
        entryBytes > WORKER_BUDGETS.maxBytesPerWorkerPayload
      ) {
        throw new RepositoryClientError(
          "invalid_request",
          "A source file exceeds the browser worker transfer budget.",
          false
        )
      }
      if (
        batch.length === WORKER_BUDGETS.maxFilesPerReadBatch ||
        batchBytes + entryBytes > WORKER_BUDGETS.maxBytesPerReadBatch
      ) {
        batches.push(batch)
        batch = []
        batchBytes = 0
      }
      batch.push(entry)
      batchBytes += entryBytes
    }
    if (batch.length > 0) batches.push(batch)

    try {
      for (const [batchIndex, batchEntries] of batches.entries()) {
        await this.request(
          "source-batch",
          {
            sourceKind: payload.identity.sourceKind,
            batchIndex,
            batchCount: batches.length,
            totalFiles: entries.length,
            totalBytes,
            entries: batchEntries,
          },
          repositoryId,
          operationId,
          batchEntries.map((entry) => entry.bytes.buffer as ArrayBuffer)
        )
      }
    } catch (error) {
      await this.request("cancel", undefined, repositoryId, operationId).catch(
        () => undefined
      )
      throw error
    }

    return {
      payload: {
        identity: payload.identity,
        collection: { ...payload.collection, entries: [] },
        sourceBatches: {
          batchCount: batches.length,
          totalFiles: entries.length,
          totalBytes,
        },
      },
      batched: true,
    }
  }

  listRepositories() {
    return this.request<Repository[]>("query", { query: "list-repositories" })
  }

  private async storageEstimate() {
    if (!this.storageManager.estimate) return {}
    try {
      const estimate = await this.storageManager.estimate()
      return {
        ...(Number.isFinite(estimate.usage)
          ? { usageBytes: estimate.usage }
          : {}),
        ...(Number.isFinite(estimate.quota)
          ? { quotaBytes: estimate.quota }
          : {}),
      }
    } catch {
      return {}
    }
  }

  async getStorageStatus(): Promise<LocalStorageStatus> {
    const estimate = await this.storageEstimate()
    if (!this.storageManager.persisted) {
      return {
        ...estimate,
        persisted: this.storageManager.persist ? "unknown" : "not-supported",
      }
    }
    try {
      return {
        ...estimate,
        persisted: (await this.storageManager.persisted())
          ? "granted"
          : "denied",
      }
    } catch {
      return { ...estimate, persisted: "unknown" }
    }
  }

  async requestPersistentStorage(): Promise<LocalStorageStatus> {
    if (!this.storageManager.persist) return this.getStorageStatus()
    const estimate = await this.storageEstimate()
    try {
      return {
        ...estimate,
        persisted: (await this.storageManager.persist()) ? "granted" : "denied",
      }
    } catch {
      return { ...estimate, persisted: "denied" }
    }
  }

  acquireRepository(repositoryId: string) {
    return this.request<{ repositoryId: string; acquired: true }>(
      "acquire",
      undefined,
      repositoryId
    )
  }

  getRepositoryStatus(repositoryId: string) {
    return this.request<RepositoryStatus>(
      "query",
      { query: "repository-status" },
      repositoryId
    )
  }

  getOverview(repositoryId: string) {
    return this.getRepositoryStatus(repositoryId)
  }

  search(repositoryId: string, request: SearchRequest) {
    const session = this.semanticSessions.get(repositoryId)
    if (request.mode === "semantic" && !session) {
      return Promise.reject(
        new RepositoryClientError(
          "credential_required",
          "Semantic search requires re-entering the page-session embedding credential.",
          false
        )
      )
    }
    const semanticMode = request.mode ?? "keyword"
    const workerRequest =
      session &&
      (semanticMode === "auto" ||
        semanticMode === "hybrid" ||
        semanticMode === "semantic")
        ? {
            ...request,
            mode: semanticMode === "auto" ? ("hybrid" as const) : semanticMode,
            semantic: session,
          }
        : semanticMode === "auto"
          ? { ...request, mode: "keyword" as const }
          : request
    return this.request<SearchResult>(
      "query",
      { query: "search", request: workerRequest },
      repositoryId
    )
  }

  getNode(repositoryId: string, nodeId: string) {
    return this.request<CodeNode>(
      "query",
      { query: "node", request: { nodeId } },
      repositoryId
    )
  }

  getSource(repositoryId: string, nodeId: string) {
    return this.request<SourceResult>(
      "query",
      { query: "source", request: { nodeId } },
      repositoryId
    )
  }

  getCallers(
    repositoryId: string,
    nodeId: string,
    request?: RelationshipRequest
  ) {
    const page = normalizeRelationshipRequest(request)
    return this.request<ListResult<CodeNode>>(
      "query",
      { query: "callers", request: { nodeId, ...page } },
      repositoryId
    )
  }

  getCallees(
    repositoryId: string,
    nodeId: string,
    request?: RelationshipRequest
  ) {
    const page = normalizeRelationshipRequest(request)
    return this.request<ListResult<CodeNode>>(
      "query",
      { query: "callees", request: { nodeId, ...page } },
      repositoryId
    )
  }

  getGraph(repositoryId: string, nodeId: string, request?: DepthRequest) {
    const depth = normalizeDepthRequest(request)
    return this.request<GraphResult>(
      "query",
      { query: "graph", request: { nodeId, ...depth } },
      repositoryId
    )
  }

  getImpact(repositoryId: string, nodeId: string, request?: DepthRequest) {
    const depth = normalizeDepthRequest(
      request,
      REPOSITORY_QUERY_LIMITS.defaultImpactDepth
    )
    return this.request<GraphResult>(
      "query",
      { query: "impact", request: { nodeId, ...depth } },
      repositoryId
    )
  }

  async refresh(repositoryId: string, operationId = this.createId()) {
    const identity = this.sourceIdentities.get(repositoryId)
    if (identity && identity.sourceKind !== "picked-folder") {
      throw new RepositoryClientError(
        "capability_unavailable",
        "Snapshot repositories are immutable. Import a new snapshot instead.",
        false
      )
    }
    if (
      this.sourceRegistry &&
      !this.sourceConnections.get(repositoryId)?.canRefresh
    ) {
      throw new RepositoryClientError(
        "permission_denied",
        "Reconnect the saved local folder before refreshing its index.",
        true
      )
    }
    const handle = this.sourceRegistry?.connectedHandle(repositoryId)
    const sourcePayload =
      identity && handle
        ? {
            identity,
            collection: await createPickedFolderProvider(handle, {
              createId: () => identity.id,
            }).collect(),
          }
        : undefined
    const payload = sourcePayload
      ? (
          await this.batchedSourcePayload(
            sourcePayload,
            repositoryId,
            operationId
          )
        ).payload
      : undefined
    const result = await this.request<Record<string, unknown>>(
      "refresh",
      payload,
      repositoryId,
      operationId
    )
    this.semanticSessions.delete(repositoryId)
    return result
  }

  async cancel(operationId: string) {
    await this.request("cancel", undefined, undefined, operationId)
  }

  async startSemanticIndexing(
    repositoryId: string,
    request: SemanticIndexRequest,
    operationId: string
  ) {
    const result = await this.request<{
      status: "complete"
      graphGeneration: number
      embedded: number
      dimensions?: number
    }>("embed", request, repositoryId, operationId)
    this.semanticSessions.set(repositoryId, {
      endpointUrl: request.endpointUrl,
      model: request.model,
      ...((result.dimensions ?? request.dimensions)
        ? { dimensions: result.dimensions ?? request.dimensions }
        : {}),
      graphGeneration: result.graphGeneration,
      credential: request.credential,
    })
    return result
  }

  async deleteRepository(
    repositoryId: string,
    options: { cancelActive?: boolean } = {}
  ) {
    const deletion = await this.request<{
      deleted: boolean
      cleanupWarnings?: string[]
    }>("delete", { cancelActive: options.cancelActive === true }, repositoryId)
    const cleanupWarnings = [...(deletion.cleanupWarnings ?? [])]
    const identity = this.sourceIdentities.get(repositoryId)
    if (identity?.sourceKind === "picked-folder" && this.sourceRegistry) {
      try {
        await this.sourceRegistry.forget(identity)
      } catch {
        cleanupWarnings.push(
          "Saved folder-handle cleanup could not be completed. Site-data repair may be required."
        )
      }
    }
    try {
      await this.snapshotRegistry.delete(repositoryId)
    } catch {
      cleanupWarnings.push(
        "Snapshot metadata cleanup could not be completed. Site-data repair may be required."
      )
    }
    this.sourceConnections.delete(repositoryId)
    this.sourceIdentities.delete(repositoryId)
    this.semanticSessions.delete(repositoryId)
    return { deleted: true as const, cleanupWarnings }
  }

  async getCapabilities(): Promise<BrowserCapabilityReport> {
    const browser = await probeBrowserCapabilities(this.capabilityEnvironment)
    try {
      const worker =
        await this.request<WorkerRuntimeCapabilityReport>("capabilities")
      return mergeWorkerCapabilityReport(browser, worker)
    } catch {
      return mergeWorkerCapabilityReport(browser, {
        moduleWorker: false,
        wasm: browser.wasm,
        opfs: browser.opfs,
        webLocks: browser.webLocks,
      })
    }
  }

  async openPickedFolder(
    payload: {
      identity: SourceIdentity
      collection: SourceCollection
    },
    repositoryId: string,
    operationId: string
  ) {
    const batched = await this.batchedSourcePayload(
      payload,
      repositoryId,
      operationId
    )
    return this.request<Repository>(
      "open-picked-folder",
      batched.payload,
      repositoryId,
      operationId
    )
  }

  async importSnapshot(
    input: SnapshotImportRequest,
    transfer: Transferable[] = []
  ): Promise<Repository & { metadataWarnings?: string[] }> {
    const { identity, collection, replace } = input
    if (
      (identity.sourceKind !== "dropped-snapshot" &&
        identity.sourceKind !== "imported-snapshot") ||
      identity.virtualRoot !== `local://${identity.id}` ||
      Boolean(identity.handleRefId) ||
      !identity.acceptedAt ||
      collection.snapshot.acceptedAt !== identity.acceptedAt ||
      collection.snapshot.manifestFingerprint !==
        collection.manifest.fingerprint
    ) {
      throw new RepositoryClientError(
        "invalid_request",
        "The snapshot import identity or accepted manifest is invalid.",
        false
      )
    }
    if (replace && replace.confirmed !== true) {
      throw new RepositoryClientError(
        "invalid_request",
        "Replacing a browser repository requires explicit confirmation.",
        false
      )
    }

    const existing = await this.snapshotRegistry.list()
    const duplicate = existing.find(
      (record) =>
        record.manifestFingerprint ===
          collection.snapshot.manifestFingerprint &&
        record.repositoryId !== replace?.repositoryId
    )
    const repositoryId = replace?.repositoryId ?? identity.id
    const sourceKind = identity.sourceKind as SnapshotSourceKind
    const targetIdentity: SourceIdentity & {
      sourceKind: SnapshotSourceKind
    } = {
      ...identity,
      id: repositoryId,
      sourceKind,
      virtualRoot: `local://${repositoryId}`,
    }
    const operationId = this.createId()
    const sourcePayload = { identity: targetIdentity, collection }
    const batched = await this.batchedSourcePayload(
      sourcePayload,
      repositoryId,
      operationId
    )
    const repository = await this.request<Repository>(
      "import-snapshot",
      batched.payload,
      repositoryId,
      operationId,
      !batched.batched && transfer.length > 0 ? transfer : undefined
    )
    const result: Repository = {
      ...repository,
      id: repositoryId,
      root: targetIdentity.virtualRoot,
      name: targetIdentity.displayName,
      runtime: "local",
      sourceKind: targetIdentity.sourceKind,
      snapshotImportedAt: collection.snapshot.acceptedAt,
      manifestFingerprint: collection.snapshot.manifestFingerprint,
      ...(duplicate
        ? {
            duplicateSnapshot: {
              repositoryId: duplicate.repositoryId,
              displayName: duplicate.displayName,
            },
          }
        : {}),
    }
    const metadataWarnings: string[] = []
    if (replace && replace.repositoryId !== identity.id) {
      try {
        await this.snapshotRegistry.delete(replace.repositoryId)
      } catch {
        metadataWarnings.push(
          "Previous snapshot metadata could not be removed."
        )
      }
    }
    try {
      await this.snapshotRegistry.put({
        repositoryId,
        displayName: result.name,
        sourceKind: targetIdentity.sourceKind,
        acceptedAt: collection.snapshot.acceptedAt,
        manifestFingerprint: collection.snapshot.manifestFingerprint,
        fileCount: collection.snapshot.fileCount,
        totalBytes: collection.snapshot.totalBytes,
      })
    } catch {
      metadataWarnings.push(
        "Snapshot registry metadata could not be saved; the published index remains available."
      )
    }
    this.sourceIdentities.set(repositoryId, targetIdentity)
    return {
      ...result,
      ...(metadataWarnings.length > 0 ? { metadataWarnings } : {}),
    }
  }

  async savePickedFolder(
    identity: SourceIdentity,
    handle: DirectoryHandleLike
  ) {
    if (!this.sourceRegistry) {
      throw new RepositoryClientError(
        "unavailable",
        "The browser source registry is unavailable.",
        false
      )
    }
    const connection: SourceConnection = {
      repositoryId: identity.id,
      handleRefId: identity.handleRefId ?? "",
      status: "granted",
      canRefresh: true,
    }
    this.sourceConnections.set(identity.id, connection)
    this.sourceIdentities.set(identity.id, { ...identity })
    await this.sourceRegistry.save(identity, handle)
    return connection
  }

  connectPickedFolder(identity: SourceIdentity, handle: DirectoryHandleLike) {
    this.sourceIdentities.set(identity.id, { ...identity })
    const connection = this.sourceRegistry?.connect(identity, handle) ?? {
      repositoryId: identity.id,
      handleRefId: identity.handleRefId ?? "",
      status: "granted" as const,
      canRefresh: true,
    }
    this.sourceConnections.set(identity.id, connection)
    return connection
  }

  async restorePickedFolder(identity: SourceIdentity) {
    this.sourceIdentities.set(identity.id, { ...identity })
    if (!this.sourceRegistry) {
      const connection: SourceConnection = {
        repositoryId: identity.id,
        handleRefId: identity.handleRefId ?? "",
        status: "stale",
        canRefresh: false,
      }
      this.sourceConnections.set(identity.id, connection)
      return connection
    }
    const connection = await this.sourceRegistry.restore(identity)
    this.sourceConnections.set(identity.id, connection)
    return connection
  }

  async reconnectPickedFolder(
    identity: SourceIdentity,
    options: {
      userActivated: boolean
      candidate?: DirectoryHandleLike
    }
  ) {
    this.sourceIdentities.set(identity.id, { ...identity })
    if (!this.sourceRegistry) {
      throw new RepositoryClientError(
        "unavailable",
        "The browser source registry is unavailable.",
        false
      )
    }
    const connection = await this.sourceRegistry.reconnect(identity, options)
    this.sourceConnections.set(identity.id, connection)
    return connection
  }

  sourceConnection(repositoryId: string) {
    return this.sourceConnections.get(repositoryId)
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    if (this.closed) return Promise.resolve()
    this.closing = this.request("close")
      .catch(() => undefined)
      .then(() => {
        this.closed = true
        this.worker.removeEventListener("message", this.onMessage)
        this.worker.removeEventListener("error", this.onWorkerFailure)
        this.worker.removeEventListener("messageerror", this.onWorkerFailure)
        for (const pending of this.pending.values()) {
          pending.reject(
            new RepositoryClientError(
              "unavailable",
              "The local repository client closed.",
              false
            )
          )
        }
        this.pending.clear()
        this.semanticSessions.clear()
        this.worker.terminate?.()
      })
    return this.closing
  }
}
