import { apiGet } from "./client"
import { apiPath, encodeNodeId, repoQuery } from "./routes"
import type { GraphResult } from "./types"

export function getImpact(id: string, repoId?: string, depth = 3): Promise<GraphResult> {
  return apiGet<GraphResult>(apiPath(`/api/impact/${encodeNodeId(id)}`, { depth, ...repoQuery(repoId) }))
}
