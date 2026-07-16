import { apiGet } from "./client"
import { apiPath, repoQuery } from "./routes"
import type { SearchResult } from "./types"

export function searchSymbols(args: {
  query: string
  repoId?: string
  mode?: "keyword" | "semantic" | "hybrid" | "auto"
  limit?: number
  offset?: number
}): Promise<SearchResult> {
  return apiGet<SearchResult>(
    apiPath("/api/search", {
      q: args.query,
      mode: args.mode,
      limit: args.limit,
      offset: args.offset,
      ...repoQuery(args.repoId),
    }),
  )
}
