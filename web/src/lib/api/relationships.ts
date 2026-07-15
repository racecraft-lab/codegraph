import { apiGet } from "./client"
import { apiPath, encodeNodeId, repoQuery } from "./routes"
import type { CodeNode, ListResult } from "./types"

export function listCallers(id: string, repoId?: string): Promise<ListResult<CodeNode>> {
  return apiGet<ListResult<CodeNode>>(apiPath(`/api/callers/${encodeNodeId(id)}`, repoQuery(repoId)))
}

export function listCallees(id: string, repoId?: string): Promise<ListResult<CodeNode>> {
  return apiGet<ListResult<CodeNode>>(apiPath(`/api/callees/${encodeNodeId(id)}`, repoQuery(repoId)))
}
