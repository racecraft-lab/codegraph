import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useAppState } from "@/app/state"

const LABELS = {
  ready: "Ready",
  stale: "Stale",
  indexing: "Indexing",
  unavailable: "Unavailable",
  unauthorized: "Token required",
  empty: "No index",
  missing: "No repository",
} as const

export function RepositoryStatus() {
  const { repositoryState, repositoryStatus, statusMessage } = useAppState()
  const progressValue = repositoryState === "indexing" ? 45 : 100

  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Index status</span>
        <Badge variant={repositoryState === "ready" ? "default" : "secondary"}>{LABELS[repositoryState]}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{statusMessage}</p>
      {repositoryStatus ? (
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Files</dt>
            <dd className="font-medium">{repositoryStatus.index.fileCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Symbols</dt>
            <dd className="font-medium">{repositoryStatus.index.nodeCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Edges</dt>
            <dd className="font-medium">{repositoryStatus.index.edgeCount.toLocaleString()}</dd>
          </div>
        </dl>
      ) : null}
      {repositoryState === "indexing" ? (
        <Progress value={progressValue} aria-label="Indexing progress" />
      ) : null}
    </section>
  )
}
