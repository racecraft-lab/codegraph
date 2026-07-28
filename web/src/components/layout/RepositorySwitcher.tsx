import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSidebar } from "@/components/ui/sidebar"
import { useAppState } from "@/app/state"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { Repository } from "@/lib/api/types"
import { FolderOpenIcon, XIcon } from "lucide-react"
import { useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"

const REPO_SCOPED_SYMBOL_ROUTES = ["/symbol/", "/graph/", "/impact/"]

export function repositoryRuntimeLabel(repository?: Repository) {
  if (repository?.runtime !== "local") return "Server"
  return repository.sourceKind === "snapshot" ? "Local snapshot" : "Local folder"
}

const OPERATION_LABELS = {
  complete: "Complete",
  stale: "Stale",
  refreshing: "Refreshing",
  snapshot: "Snapshot",
  cancelled: "Cancelled",
  failed: "Failed",
  "partial-warning": "Completed with warnings",
  busy: "Repository busy",
  "quota-blocked": "Storage quota blocked",
  "permission-blocked": "Permission blocked",
  deleting: "Deleting",
  deleted: "Deleted",
} as const

const ALERT_STATES = new Set([
  "failed",
  "busy",
  "quota-blocked",
  "permission-blocked",
])

export function RepositorySwitcher() {
  const {
    repositories,
    selectedRepo,
    repositoriesStatus,
    selectRepository,
    openLocalFolder,
    cancelLocalOperation,
    refreshRepositories,
    localOperation,
  } = useAppState()
  const location = useLocation()
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()
  const openButtonRef = useRef<HTMLButtonElement>(null)

  function changeRepository(repoId: string) {
    selectRepository(repoId)
    if (REPO_SCOPED_SYMBOL_ROUTES.some((prefix) => location.pathname.startsWith(prefix))) {
      navigate("/", { replace: true })
    }
    if (isMobile) setOpenMobile(false)
  }

  async function activateLocalFolder() {
    try {
      await openLocalFolder()
    } catch {
      // The app state owns the user-visible terminal message.
    } finally {
      openButtonRef.current?.focus()
    }
  }

  const operationProgress =
    localOperation?.total && localOperation.total > 0
      ? Math.round(((localOperation.completed ?? 0) / localOperation.total) * 100)
      : undefined
  const operationText = localOperation
    ? `${OPERATION_LABELS[localOperation.state]}. ${
        localOperation.phase
          ? `${localOperation.phase} ${localOperation.completed ?? 0} of ${localOperation.total ?? 0}. `
          : ""
      }${localOperation.message}`
    : ""

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="repository-switcher">
        Repository
      </label>
      <Select value={selectedRepo?.id ?? ""} onValueChange={(value) => value && changeRepository(value)}>
        <SelectTrigger id="repository-switcher" className="w-full">
          <SelectValue placeholder={repositoriesStatus === "loading" ? "Loading repositories" : "Select repository"} />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            {repositories.map((repo) => (
              <SelectItem key={repo.id} value={repo.id}>
                <span className="min-w-0 truncate">{repo.name}</span>
                <span className="text-xs text-muted-foreground">
                  {repositoryRuntimeLabel(repo)}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{selectedRepo?.name}</span>
        <span className="shrink-0 font-medium">{repositoryRuntimeLabel(selectedRepo)}</span>
      </div>
      <Button
        ref={openButtonRef}
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => void activateLocalFolder()}
        disabled={localOperation?.state === "refreshing"}
      >
        <FolderOpenIcon data-icon="inline-start" />
        Open local folder
      </Button>
      {localOperation ? (
        <div
          className="flex min-w-0 flex-col gap-2 rounded-md border p-2 text-xs"
          role={ALERT_STATES.has(localOperation.state) ? "alert" : "status"}
          aria-live={ALERT_STATES.has(localOperation.state) ? "assertive" : "polite"}
          aria-atomic="true"
        >
          <span>{operationText}</span>
          {localOperation.state === "refreshing" ? (
            <Progress
              value={operationProgress ?? null}
              aria-label={localOperation.phase ?? "Local indexing progress"}
            />
          ) : null}
          {localOperation.cancellable ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => void cancelLocalOperation()}
            >
              <XIcon data-icon="inline-start" />
              Cancel local indexing
            </Button>
          ) : null}
          {localOperation.state === "busy" ? (
            <div className="flex min-w-0 flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refreshRepositories()}
              >
                Retry
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!repositories.some(
                  (repository) => repository.id !== selectedRepo?.id,
                )}
                onClick={() => {
                  const alternative = repositories.find(
                    (repository) => repository.id !== selectedRepo?.id,
                  )
                  if (alternative) changeRepository(alternative.id)
                }}
              >
                Switch repository
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
