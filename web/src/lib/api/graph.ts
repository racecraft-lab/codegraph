import { apiGet } from "./client"
import { apiPath, encodeNodeId, repoQuery } from "./routes"
import type { GraphResult } from "./types"

export function getGraph(id: string, repoId?: string, depth = 1): Promise<GraphResult> {
  return apiGet<GraphResult>(apiPath(`/api/graph/${encodeNodeId(id)}`, { depth, ...repoQuery(repoId) }))
}
