import { apiGet } from "./client"
import { apiPath, repoQuery } from "./routes"
import type { Repository, RepositoryState, RepositoryStatus } from "./types"

export function listRepositories(): Promise<Repository[]> {
  return apiGet<Repository[]>("/api/repos")
}

export function getRepositoryStatus(repoId?: string): Promise<RepositoryStatus> {
  return apiGet<RepositoryStatus>(apiPath("/api/status", repoQuery(repoId)))
}

export function classifyRepositoryStatus(status?: RepositoryStatus, errorCode?: string): RepositoryState {
  if (errorCode === "unauthorized") return "unauthorized"
  if (errorCode === "unavailable") return "unavailable"
  if (!status) return "missing"
  if (status.index.state === "unindexed") return "unindexed"
  if (status.index.state === "indexing" || status.index.state === "running") return "indexing"
  if (status.index.nodeCount === 0 && status.index.fileCount === 0) return "empty"
  if (status.index.state === "stale") return "stale"
  return "ready"
}
