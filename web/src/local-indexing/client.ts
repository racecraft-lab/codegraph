import {
  RepositoryClientError,
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
  private readonly pending = new Map<string, PendingRequest>()
  private readonly onMessage: (event: MessageEvent) => void
  private closed = false

  constructor(worker: WorkerTransport, options: LocalRepositoryClientOptions = {}) {
    this.worker = worker
    this.createId = options.createId ?? createId
    this.onProgress = options.onProgress
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
    return this.request<ListResult<CodeNode>>(
      "query",
      { query: "callers", request: { nodeId, ...request } },
      repositoryId,
    )
  }

  getCallees(
    repositoryId: string,
    nodeId: string,
    request?: RelationshipRequest,
  ) {
    return this.request<ListResult<CodeNode>>(
      "query",
      { query: "callees", request: { nodeId, ...request } },
      repositoryId,
    )
  }

  getGraph(repositoryId: string, nodeId: string, request?: DepthRequest) {
    return this.request<GraphResult>(
      "query",
      { query: "graph", request: { nodeId, ...request } },
      repositoryId,
    )
  }

  getImpact(repositoryId: string, nodeId: string, request?: DepthRequest) {
    return this.request<GraphResult>(
      "query",
      { query: "impact", request: { nodeId, ...request } },
      repositoryId,
    )
  }

  refresh(repositoryId: string) {
    const operationId = this.createId()
    return this.request<Record<string, unknown>>(
      "refresh",
      undefined,
      repositoryId,
      operationId,
    )
  }

  async cancel(operationId: string) {
    await this.request("cancel", undefined, undefined, operationId)
  }

  async deleteRepository(repositoryId: string) {
    await this.request("delete", undefined, repositoryId)
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

  close() {
    if (this.closed) return
    this.closed = true
    this.worker.removeEventListener("message", this.onMessage)
    for (const pending of this.pending.values()) {
      pending.reject(
        new RepositoryClientError("unavailable", "The local repository client closed.", false),
      )
    }
    this.pending.clear()
    this.worker.terminate?.()
  }
}
