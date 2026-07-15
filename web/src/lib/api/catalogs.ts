import { apiGet } from "./client"
import { apiPath, repoQuery } from "./routes"
import type { CatalogListResult, ClusterSummary, FlowDetail, FlowSummary } from "./types"

export function listFlows(repoId?: string): Promise<CatalogListResult<FlowSummary>> {
  return apiGet<CatalogListResult<FlowSummary>>(apiPath("/api/flows", repoQuery(repoId)))
}

export function getFlow(id: string, repoId?: string): Promise<FlowDetail> {
  return apiGet<FlowDetail>(apiPath(`/api/flows/${encodeURIComponent(id)}`, repoQuery(repoId)))
}

export function listClusters(repoId?: string): Promise<CatalogListResult<ClusterSummary>> {
  return apiGet<CatalogListResult<ClusterSummary>>(apiPath("/api/clusters", repoQuery(repoId)))
}
