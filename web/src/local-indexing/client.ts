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
import { WORKER_PROTOCOL_VERSION, type WorkerResponse } from "./worker"
import {
  createPickedFolderProvider,
  type DirectoryHandleLike,
  type SourceConnection,
  type SourceHandleRegistry,
  type SourceIdentity,
} from "./source"

interface WorkerTransport {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
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

function createId() {
  return crypto.randomUUID()
}

export class LocalRepositoryClient implements RepositoryClient {
  private readonly worker: WorkerTransport
  private readonly createId: () => string
  private readonly onProgress?: (progress: LocalRepositoryProgress) => void
  private readonly sourceRegistry?: SourceHandleRegistry
  private readonly storageManager: BrowserStorageManager
  private readonly sourceConnections = new Map<string, SourceConnection>()
  private readonly sourceIdentities = new Map<string, SourceIdentity>()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly onMessage: (event: MessageEvent) => void
  private closed = false
  private closing?: Promise<void>

  constructor(worker: WorkerTransport, options: LocalRepositoryClientOptions = {}) {
    this.worker = worker
    this.createId = options.createId ?? createId
    this.onProgress = options.onProgress
    this.sourceRegistry = options.sourceRegistry
    this.storageManager =
      options.storageManager ??
      ((typeof navigator === "undefined"
        ? undefined
        : navigator.storage) as BrowserStorageManager | undefined) ??
      {}
    this.onMessage = (event) => this.handleMessage(event.data)
    this.worker.addEventListener("message", this.onMessage)
  }

  private handleMessage(candidate: unknown) {
    if (!candidate || typeof candidate !== "object") return
    const message = candidate as WorkerResponse
    if (
      message.protocolVersion !== WORKER_PROTOCOL_VERSION ||
      typeof message.requestId !== "string"
    ) {
      return
    }
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
        phase: message.phase ?? "working",
        completed: message.completed ?? 0,
        total: message.total ?? 0,
      })
      return
    }
    this.pending.delete(message.requestId)
    if (message.type === "failure") {
      pending.reject(
        new RepositoryClientError(
          (message.error?.code ?? "internal") as RepositoryClientErrorCode,
          message.error?.message ?? "The local repository request failed.",
          message.error?.retryable ?? false,
        ),
      )
      return
    }
    pending.resolve(message.result)
  }

  private request<T>(
    kind: string,
    payload?: unknown,
    repositoryId?: string,
    operationId?: string,
    transfer?: Transferable[],
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(
        new RepositoryClientError("unavailable", "The local repository client is closed.", false),
      )
    }
    const requestId = this.createId()
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        ...(operationId ? { operationId } : {}),
        resolve: (value) => resolve(value as T),
        reject,
      })
      const message = {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId,
        ...(operationId ? { operationId } : {}),
        ...(repositoryId ? { repositoryId } : {}),
        kind,
        ...(payload === undefined ? {} : { payload }),
      }
      if (transfer) this.worker.postMessage(message, transfer)
      else this.worker.postMessage(message)
    })
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
        persisted: (await this.storageManager.persist())
          ? "granted"
          : "denied",
      }
    } catch {
      return { ...estimate, persisted: "denied" }
    }
  }

  acquireRepository(repositoryId: string) {
    return this.request<{ repositoryId: string; acquired: true }>(
      "acquire",
      undefined,
      repositoryId,
    )
  }

  getRepositoryStatus(repositoryId: string) {
    return this.request<RepositoryStatus>(
      "query",
      { query: "repository-status" },
      repositoryId,
    )
  }

  getOverview(repositoryId: string) {
    return this.getRepositoryStatus(repositoryId)
  }

  search(repositoryId: string, request: SearchRequest) {
    return this.request<SearchResult>(
      "query",
      { query: "search", request },
      repositoryId,
    )
  }

  getNode(repositoryId: string, nodeId: string) {
    return this.request<CodeNode>(
      "query",
      { query: "node", request: { nodeId } },
      repositoryId,
    )
  }

  getSource(repositoryId: string, nodeId: string) {
    return this.request<SourceResult>(
      "query",
      { query: "source", request: { nodeId } },
      repositoryId,
    )
  }

  getCallers(
    repositoryId: string,
    nodeId: string,
    request?: RelationshipRequest,
  ) {
    const page = normalizeRelationshipRequest(request)
    return this.request<ListResult<CodeNode>>(
      "query",
      { query: "callers", request: { nodeId, ...page } },
      repositoryId,
    )
  }

  getCallees(
    repositoryId: string,
    nodeId: string,
    request?: RelationshipRequest,
  ) {
    const page = normalizeRelationshipRequest(request)
    return this.request<ListResult<CodeNode>>(
      "query",
      { query: "callees", request: { nodeId, ...page } },
      repositoryId,
    )
  }

  getGraph(repositoryId: string, nodeId: string, request?: DepthRequest) {
    const depth = normalizeDepthRequest(request)
    return this.request<GraphResult>(
      "query",
      { query: "graph", request: { nodeId, ...depth } },
      repositoryId,
    )
  }

  getImpact(repositoryId: string, nodeId: string, request?: DepthRequest) {
    const depth = normalizeDepthRequest(
      request,
      REPOSITORY_QUERY_LIMITS.defaultImpactDepth,
    )
    return this.request<GraphResult>(
      "query",
      { query: "impact", request: { nodeId, ...depth } },
      repositoryId,
    )
  }

  async refresh(repositoryId: string) {
    if (
      this.sourceRegistry &&
      !this.sourceConnections.get(repositoryId)?.canRefresh
    ) {
      throw new RepositoryClientError(
        "permission_denied",
        "Reconnect the saved local folder before refreshing its index.",
        true,
      )
    }
    const identity = this.sourceIdentities.get(repositoryId)
    const handle = this.sourceRegistry?.connectedHandle(repositoryId)
    const payload =
      identity && handle
        ? {
            identity,
            collection: await createPickedFolderProvider(handle, {
              createId: () => identity.id,
            }).collect(),
          }
        : undefined
    const operationId = this.createId()
    return this.request<Record<string, unknown>>(
      "refresh",
      payload,
      repositoryId,
      operationId,
    )
  }

  async cancel(operationId: string) {
    await this.request("cancel", undefined, undefined, operationId)
  }

  async deleteRepository(
    repositoryId: string,
    options: { cancelActive?: boolean } = {},
  ) {
    await this.request(
      "delete",
      { cancelActive: options.cancelActive === true },
      repositoryId,
    )
    const identity = this.sourceIdentities.get(repositoryId)
    if (identity && this.sourceRegistry) {
      await this.sourceRegistry.forget(identity)
    }
    this.sourceConnections.delete(repositoryId)
    this.sourceIdentities.delete(repositoryId)
  }

  getCapabilities() {
    return this.request<Record<string, unknown>>("capabilities")
  }

  openPickedFolder(
    payload: unknown,
    repositoryId: string,
    operationId: string,
  ) {
    return this.request<Repository>(
      "open-picked-folder",
      payload,
      repositoryId,
      operationId,
    )
  }

  importSnapshot(payload: unknown, transfer: Transferable[] = []) {
    return this.request<Repository>("import-snapshot", payload, undefined, undefined, transfer)
  }

  async savePickedFolder(
    identity: SourceIdentity,
    handle: DirectoryHandleLike,
  ) {
    if (!this.sourceRegistry) {
      throw new RepositoryClientError(
        "unavailable",
        "The browser source registry is unavailable.",
        false,
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

  connectPickedFolder(
    identity: SourceIdentity,
    handle: DirectoryHandleLike,
  ) {
    this.sourceIdentities.set(identity.id, { ...identity })
    const connection =
      this.sourceRegistry?.connect(identity, handle) ?? {
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
    },
  ) {
    this.sourceIdentities.set(identity.id, { ...identity })
    if (!this.sourceRegistry) {
      throw new RepositoryClientError(
        "unavailable",
        "The browser source registry is unavailable.",
        false,
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
    this.closing = this.request("close")
      .catch(() => undefined)
      .then(() => {
        this.closed = true
        this.worker.removeEventListener("message", this.onMessage)
        for (const pending of this.pending.values()) {
          pending.reject(
            new RepositoryClientError(
              "unavailable",
              "The local repository client closed.",
              false,
            ),
          )
        }
        this.pending.clear()
        this.worker.terminate?.()
      })
    return this.closing
  }
}
