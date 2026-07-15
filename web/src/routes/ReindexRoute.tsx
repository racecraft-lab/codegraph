import * as React from "react"

import { useAppState } from "@/app/state"
import { ReindexControls } from "@/components/reindex/ReindexControls"
import { ReindexProgress } from "@/components/reindex/ReindexProgress"
import { errorState } from "@/lib/api/client"
import { getLatestReindexJob, startReindex, subscribeReindexEvents } from "@/lib/api/reindex"
import type { ReindexJob, ReindexProgressEvent } from "@/lib/api/types"

export function ReindexRoute() {
  const { selectedRepo, refreshStatus } = useAppState()
  const [job, setJob] = React.useState<ReindexJob | undefined>()
  const [progress, setProgress] = React.useState<ReindexProgressEvent | undefined>()
  const [disconnected, setDisconnected] = React.useState(false)
  const [message, setMessage] = React.useState("Ready to start re-analysis.")

  React.useEffect(() => {
    const repoId = selectedRepo?.id
    const jobStatus = job?.status
    if (!repoId || jobStatus !== "running") return undefined

    let active = true
    function applyJob(nextJob: ReindexJob) {
      if (!active) return
      setJob(nextJob)
      if (nextJob.status !== "running") {
        setDisconnected(false)
        void refreshStatus()
      }
    }

    const source = subscribeReindexEvents(repoId, {
      snapshot(nextJob) {
        applyJob(nextJob)
      },
      progress(nextProgress) {
        if (!active) return
        setProgress(nextProgress)
      },
      done: applyJob,
      error: applyJob,
      disconnected() {
        void getLatestReindexJob(repoId)
          .then((nextJob) => {
            if (!active) return
            setJob(nextJob)
            if (nextJob.status === "running") {
              setDisconnected(true)
            } else {
              setDisconnected(false)
              void refreshStatus()
            }
          })
          .catch(() => {
            if (active) setDisconnected(true)
          })
      },
    })
    return () => {
      active = false
      source.close()
    }
  }, [job?.id, job?.status, refreshStatus, selectedRepo?.id])

  async function start(full: boolean) {
    if (!selectedRepo) return
    try {
      setDisconnected(false)
      setProgress(undefined)
      const nextJob = await startReindex(selectedRepo.id, full)
      setJob(nextJob)
      setMessage("Re-analysis job accepted.")
    } catch (error) {
      setMessage(errorState(error).message)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <section>
        <h1 className="text-2xl font-semibold">Re-analysis</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </section>
      <ReindexControls disabled={!selectedRepo || job?.status === "running"} onSync={() => void start(false)} onFull={() => void start(true)} />
      <ReindexProgress job={job} progress={progress} disconnected={disconnected} />
    </div>
  )
}
