import { apiGet, apiPost } from "./client"
import type { ReindexJob, ReindexProgressEvent } from "./types"

export function startReindex(repoId: string, full = false): Promise<ReindexJob> {
  return apiPost<ReindexJob>(`/api/reindex/${repoId}${full ? "?full=true" : ""}`)
}

export function getLatestReindexJob(repoId: string): Promise<ReindexJob> {
  return apiGet<ReindexJob>(`/api/reindex/${repoId}`)
}

export function subscribeReindexEvents(
  repoId: string,
  handlers: {
    snapshot?: (job: ReindexJob) => void
    progress?: (event: ReindexProgressEvent) => void
    done?: (job: ReindexJob) => void
    error?: (job: ReindexJob) => void
    disconnected?: () => void
  },
): EventSource {
  const source = new EventSource(`/api/reindex/${repoId}/events`)
  source.addEventListener("snapshot", (event) => handlers.snapshot?.(JSON.parse(event.data) as ReindexJob))
  source.addEventListener("progress", (event) => handlers.progress?.(JSON.parse(event.data) as ReindexProgressEvent))
  source.addEventListener("done", (event) => handlers.done?.(JSON.parse(event.data) as ReindexJob))
  source.addEventListener("error", (event) => {
    if ("data" in event && typeof event.data === "string" && event.data) {
      handlers.error?.(JSON.parse(event.data) as ReindexJob)
    } else {
      handlers.disconnected?.()
    }
  })
  return source
}
