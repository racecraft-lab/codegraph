import { normalizeApiError } from "./api/client"
import { getGraph } from "./api/graph"
import { getImpact } from "./api/impact"
import { startReindex } from "./api/reindex"
import { listCallees, listCallers } from "./api/relationships"
import { getRepositoryStatus, listRepositories } from "./api/repositories"
import { searchSymbols } from "./api/search"
import { getSymbol } from "./api/symbols"
import type {
  CodeNode,
  GraphResult,
  ListResult,
  Repository,
  RepositoryStatus,
  ReindexJob,
  SearchResult,
} from "./api/types"

export interface SearchRequest {
  query: string
  mode?: "keyword" | "semantic" | "hybrid" | "auto"
  limit?: number
  offset?: number
}

export interface RelationshipRequest {
  limit?: number
  offset?: number
}

export interface DepthRequest {
  depth?: number
}

export interface SourceResult {
  text: string
  languageId: string
  contentHash: string
  snapshotToken: string
}

export interface RepositoryClient {
  listRepositories(): Promise<Repository[]>
  getRepositoryStatus(repositoryId: string): Promise<RepositoryStatus>
  getOverview(repositoryId: string): Promise<RepositoryStatus>
  search(repositoryId: string, request: SearchRequest): Promise<SearchResult>
  getNode(repositoryId: string, nodeId: string): Promise<CodeNode>
  getSource(repositoryId: string, nodeId: string): Promise<SourceResult>
  getCallers(
    repositoryId: string,
    nodeId: string,
    request?: RelationshipRequest,
  ): Promise<ListResult<CodeNode>>
  getCallees(
    repositoryId: string,
    nodeId: string,
    request?: RelationshipRequest,
  ): Promise<ListResult<CodeNode>>
  getGraph(repositoryId: string, nodeId: string, request?: DepthRequest): Promise<GraphResult>
  getImpact(repositoryId: string, nodeId: string, request?: DepthRequest): Promise<GraphResult>
  refresh(repositoryId: string): Promise<ReindexJob | Record<string, unknown>>
  cancel(operationId: string): Promise<void>
  deleteRepository(repositoryId: string): Promise<void>
}

export type RepositoryClientErrorCode =
  | "capability_unavailable"
  | "permission_denied"
  | "repository_busy"
  | "quota_exceeded"
  | "asset_unavailable"
  | "schema_migration_failed"
  | "operation_cancelled"
  | "network_blocked"
  | "credential_required"
  | "invalid_request"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "unavailable"
  | "internal"

export class RepositoryClientError extends Error {
  readonly code: RepositoryClientErrorCode
  readonly retryable: boolean
  readonly status: number

  constructor(
    code: RepositoryClientErrorCode,
    message: string,
    retryable: boolean,
    status = 0,
  ) {
    super(message)
    this.name = "RepositoryClientError"
    this.code = code
    this.retryable = retryable
    this.status = status
  }
}

async function remoteResult<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof RepositoryClientError) throw error
    const normalized = normalizeApiError(error)
    throw new RepositoryClientError(
      normalized.code as RepositoryClientErrorCode,
      normalized.message,
      normalized.status === 0 || normalized.status >= 500,
      normalized.status,
    )
  }
}

function remoteUnavailable(capability: string): never {
  throw new RepositoryClientError(
    "capability_unavailable",
    `${capability} is provided by the server repository's existing transport.`,
    false,
  )
}

export function createRemoteRepositoryClient(): RepositoryClient {
  return {
    listRepositories: () => remoteResult(() => listRepositories()),
    getRepositoryStatus: (repositoryId) =>
      remoteResult(() => getRepositoryStatus(repositoryId)),
    getOverview: (repositoryId) => remoteResult(() => getRepositoryStatus(repositoryId)),
    search: (repositoryId, request) =>
      remoteResult(() => searchSymbols({ ...request, repoId: repositoryId })),
    getNode: (repositoryId, nodeId) =>
      remoteResult(() => getSymbol(nodeId, repositoryId)),
    getSource: async () => remoteUnavailable("Source content"),
    getCallers: (repositoryId, nodeId) =>
      remoteResult(() => listCallers(nodeId, repositoryId)),
    getCallees: (repositoryId, nodeId) =>
      remoteResult(() => listCallees(nodeId, repositoryId)),
    getGraph: (repositoryId, nodeId, request) =>
      remoteResult(() => getGraph(nodeId, repositoryId, request?.depth)),
    getImpact: (repositoryId, nodeId, request) =>
      remoteResult(() => getImpact(nodeId, repositoryId, request?.depth)),
    refresh: (repositoryId) => remoteResult(() => startReindex(repositoryId)),
    cancel: async () => remoteUnavailable("Reindex cancellation"),
    deleteRepository: async () => remoteUnavailable("Repository deletion"),
  }
}

export function createUnavailableRepositoryClient(
  message = "The browser-local repository is not connected in this tab.",
): RepositoryClient {
  const unavailable = async (): Promise<never> => {
    throw new RepositoryClientError("unavailable", message, true)
  }
  return {
    listRepositories: unavailable,
    getRepositoryStatus: unavailable,
    getOverview: unavailable,
    search: unavailable,
    getNode: unavailable,
    getSource: unavailable,
    getCallers: unavailable,
    getCallees: unavailable,
    getGraph: unavailable,
    getImpact: unavailable,
    refresh: unavailable,
    cancel: unavailable,
    deleteRepository: unavailable,
  }
}
