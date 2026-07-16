export function apiPath(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value))
    }
  }
  const suffix = search.toString()
  return suffix ? `${path}?${suffix}` : path
}

export function encodeNodeId(id: string): string {
  return encodeURIComponent(id)
}

export function repoQuery(repoId?: string): Record<string, string | undefined> {
  return repoId ? { repo: repoId } : {}
}
