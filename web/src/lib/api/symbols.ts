import { apiGet } from "./client"
import { apiPath, encodeNodeId, repoQuery } from "./routes"
import type { CodeNode } from "./types"

export function getSymbol(id: string, repoId?: string): Promise<CodeNode> {
  return apiGet<CodeNode>(apiPath(`/api/node/${encodeNodeId(id)}`, repoQuery(repoId)))
}
