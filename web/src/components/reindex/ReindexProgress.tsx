import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import type { ReindexJob, ReindexProgressEvent } from "@/lib/api/types"

const JOB_REASON_MESSAGES: Record<NonNullable<ReindexJob["reason"]>, string> = {
  aborted: "Re-analysis was canceled before it finished.",
  lock_unavailable: "The index is busy with another process. Try re-analysis again after it finishes.",
  index_failed: "Re-analysis failed while updating the index. Check the server logs and try again.",
}

function numberField(result: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = result?.[key]
  return typeof value === "number" ? value : undefined
}

function statusMessage(job?: ReindexJob, progress?: ReindexProgressEvent): string {
  if (job?.status === "error") {
    return job.reason ? JOB_REASON_MESSAGES[job.reason] : `${job.mode} job failed.`
  }
  if (job?.status === "done") {
    const checked = numberField(job.result, "filesChecked")
    const added = numberField(job.result, "filesAdded") ?? 0
    const modified = numberField(job.result, "filesModified") ?? 0
    const removed = numberField(job.result, "filesRemoved") ?? 0
    const updated = numberField(job.result, "nodesUpdated")
    const changed = added + modified + removed
    if (checked !== undefined && updated !== undefined) {
      return `Checked ${checked.toLocaleString()} files; ${changed.toLocaleString()} changed; updated ${updated.toLocaleString()} nodes.`
    }
    return `${job.mode} job completed.`
  }
  return progress?.phase ?? job?.reason ?? (job ? `${job.mode} job ${job.id}` : "Start a sync or full re-analysis job.")
}

export function ReindexProgress({ job, progress, disconnected }: { job?: ReindexJob; progress?: ReindexProgressEvent; disconnected?: boolean }) {
  const value = progress?.total ? Math.round(((progress.current ?? 0) / progress.total) * 100) : job?.status === "done" ? 100 : null

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Re-analysis progress</h2>
        <Badge variant={job?.status === "error" || disconnected ? "destructive" : "secondary"}>
          {disconnected ? "Disconnected" : job?.status ?? "Idle"}
        </Badge>
      </div>
      <Progress value={value} aria-label="Re-analysis progress" />
      <p className="text-sm text-muted-foreground">
        {statusMessage(job, progress)}
      </p>
    </section>
  )
}
