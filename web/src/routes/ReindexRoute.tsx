import * as React from "react"

import { useAppState } from "@/app/state"
import { ReindexControls } from "@/components/reindex/ReindexControls"
import { ReindexProgress } from "@/components/reindex/ReindexProgress"
import { errorState } from "@/lib/api/client"
import { getLatestReindexJob, startReindex, subscribeReindexEvents } from "@/lib/api/reindex"
import type { ReindexJob, ReindexProgressEvent } from "@/lib/api/types"

export function ReindexRoute() {
  const { selectedRepo, repositoryState, refreshStatus } = useAppState()
  const [job, setJob] = React.useState<ReindexJob | undefined>()
  const [progress, setProgress] = React.useState<ReindexProgressEvent | undefined>()
  const [disconnected, setDisconnected] = React.useState(false)
  const [message, setMessage] = React.useState("Ready to start re-analysis.")
  const [hydrating, setHydrating] = React.useState(false)
  const [starting, setStarting] = React.useState(false)
  const operationRef = React.useRef(0)
  const startingRef = React.useRef(false)
  const activeRepoRef = React.useRef<string | undefined>(undefined)
  const jobRef = React.useRef<ReindexJob | undefined>(undefined)
  const recoveryRequestRef = React.useRef(0)

  function replaceJob(nextJob: ReindexJob | undefined) {
    jobRef.current = nextJob
    setJob(nextJob)
  }

  function applyJobUpdate(nextJob: ReindexJob): boolean {
    const current = jobRef.current
    if (current?.repo === nextJob.repo && current.id === nextJob.id && current.status !== "running" && nextJob.status === "running") {
      return false
    }
    replaceJob(nextJob)
    return true
  }

  React.useEffect(() => {
    activeRepoRef.current = selectedRepo?.id
  }, [selectedRepo?.id])

  React.useEffect(() => {
    const repoId = selectedRepo?.id
    const operationId = operationRef.current + 1
    operationRef.current = operationId
    let active = true
    replaceJob(undefined)
    setProgress(undefined)
    setDisconnected(false)
    setStarting(false)
    startingRef.current = false
    recoveryRequestRef.current += 1
    setMessage(repoId ? "Ready to start re-analysis." : "Select a repository to start re-analysis.")
    setHydrating(Boolean(repoId))
    if (!repoId) {
      return () => {
        active = false
      }
    }

    void getLatestReindexJob(repoId)
      .then((nextJob) => {
        if (!active || operationRef.current !== operationId || activeRepoRef.current !== repoId || nextJob.repo !== repoId) return
        applyJobUpdate(nextJob)
        setMessage(nextJob.status === "running" ? "Re-analysis job in progress." : "Latest re-analysis job loaded.")
      })
      .catch((error) => {
        if (!active || operationRef.current !== operationId || activeRepoRef.current !== repoId) return
        const nextError = errorState(error)
        setMessage(nextError.code === "not_found" ? "Ready to start re-analysis." : nextError.message)
      })
      .finally(() => {
        if (active && operationRef.current === operationId && activeRepoRef.current === repoId) {
          setHydrating(false)
        }
      })

    return () => {
      active = false
    }
  }, [selectedRepo?.id])

  React.useEffect(() => {
    const repoId = selectedRepo?.id
    const jobStatus = job?.status
    if (!repoId || jobStatus !== "running") return undefined

    let active = true
    function applyJob(nextJob: ReindexJob) {
      if (!active || activeRepoRef.current !== repoId || nextJob.repo !== repoId) return
      if (nextJob.status !== "running") recoveryRequestRef.current += 1
      if (!applyJobUpdate(nextJob)) return
      if (nextJob.status !== "running") {
        setDisconnected(false)
        void refreshStatus()
      }
    }

    const source = subscribeReindexEvents(repoId, {
      snapshot(nextJob) {
        setDisconnected(false)
        applyJob(nextJob)
      },
      progress(nextProgress) {
        if (!active) return
        setDisconnected(false)
        setProgress(nextProgress)
      },
      done: applyJob,
      error: applyJob,
      disconnected() {
        const recoveryRequestId = recoveryRequestRef.current + 1
        recoveryRequestRef.current = recoveryRequestId
        void getLatestReindexJob(repoId)
          .then((nextJob) => {
            if (!active || activeRepoRef.current !== repoId || nextJob.repo !== repoId) return
            if (recoveryRequestRef.current !== recoveryRequestId) return
            if (!applyJobUpdate(nextJob)) {
              setDisconnected(false)
              return
            }
            if (nextJob.status === "running") {
              setDisconnected(true)
            } else {
              recoveryRequestRef.current += 1
              setDisconnected(false)
              void refreshStatus()
            }
          })
          .catch(() => {
            if (active && recoveryRequestRef.current === recoveryRequestId) setDisconnected(true)
          })
      },
    })
    return () => {
      active = false
      source.close()
    }
  }, [job?.id, job?.status, refreshStatus, selectedRepo?.id])

  async function start(full: boolean) {
    if (!selectedRepo || hydrating || repositoryState === "unindexed" || startingRef.current) return
    const repoId = selectedRepo.id
    const operationId = operationRef.current + 1
    operationRef.current = operationId
    startingRef.current = true
    setStarting(true)
    try {
      setDisconnected(false)
      setProgress(undefined)
      const nextJob = await startReindex(repoId, full)
      if (operationRef.current !== operationId || activeRepoRef.current !== repoId || nextJob.repo !== repoId) return
      applyJobUpdate(nextJob)
      setMessage("Re-analysis job accepted.")
    } catch (error) {
      if (operationRef.current !== operationId || activeRepoRef.current !== repoId) return
      const nextError = errorState(error)
      if (nextError.code === "conflict") {
        try {
          const latest = await getLatestReindexJob(repoId)
          if (operationRef.current === operationId && activeRepoRef.current === repoId && latest.repo === repoId) {
            applyJobUpdate(latest)
            setMessage(latest.status === "running" ? "Re-analysis job already running." : "Latest re-analysis job loaded.")
          }
        } catch {
          if (operationRef.current === operationId && activeRepoRef.current === repoId) {
            setMessage(nextError.message)
          }
        }
      } else {
        setMessage(nextError.message)
      }
    } finally {
      if (operationRef.current === operationId && activeRepoRef.current === repoId) {
        startingRef.current = false
        setStarting(false)
      }
    }
  }

  const reindexUnavailable = repositoryState === "unindexed"

  return (
    <div className="flex flex-col gap-4 p-4">
      <section>
        <h1 className="text-2xl font-semibold">Re-analysis</h1>
        <p className="text-sm text-muted-foreground">
          {reindexUnavailable ? "Initialize this repository before running re-analysis." : message}
        </p>
      </section>
      <ReindexControls disabled={!selectedRepo || reindexUnavailable || hydrating || starting || job?.status === "running"} onSync={() => void start(false)} onFull={() => void start(true)} />
      <ReindexProgress job={job} progress={progress} disconnected={disconnected} />
    </div>
  )
}
