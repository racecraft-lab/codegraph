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
import {
  captureDroppedDirectory,
  createDroppedSnapshotProvider,
  createSnapshotProvider,
  type DroppedDataTransferItemLike,
  type SnapshotSourceEntry,
} from "@/local-indexing/source"
import { FolderOpenIcon, ImportIcon, XIcon } from "lucide-react"
import { useRef, useState, type ChangeEvent, type DragEvent } from "react"
import { useLocation, useNavigate } from "react-router-dom"

const REPO_SCOPED_SYMBOL_ROUTES = ["/symbol/", "/graph/", "/impact/"]

export function repositoryRuntimeLabel(repository?: Repository) {
  if (repository?.runtime !== "local") return "Server"
  return repository.sourceKind === "picked-folder"
    ? "Local folder"
    : "Local snapshot"
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
    capabilityReport,
    importLocalSnapshot,
  } = useAppState()
  const location = useLocation()
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const snapshotInputRef = useRef<HTMLInputElement>(null)
  const operationStatusRef = useRef<HTMLDivElement>(null)
  const focusTerminalStatusRef = useRef(false)
  const [snapshotError, setSnapshotError] = useState<string>()

  function changeRepository(repoId: string) {
    selectRepository(repoId)
    if (
      REPO_SCOPED_SYMBOL_ROUTES.some((prefix) =>
        location.pathname.startsWith(prefix)
      )
    ) {
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
      if (!focusTerminalStatusRef.current) {
        openButtonRef.current?.focus()
      }
    }
  }

  async function importDroppedSnapshot(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setSnapshotError(undefined)
    const captured = captureDroppedDirectory(
      Array.from(event.dataTransfer.items) as DroppedDataTransferItemLike[]
    )
    try {
      const root = await captured
      if (!root) {
        throw new Error(
          "This drop does not expose a usable directory snapshot."
        )
      }
      await importLocalSnapshot(createDroppedSnapshotProvider(root))
    } catch (error) {
      setSnapshotError(
        error instanceof Error
          ? error.message
          : "Directory snapshot import failed."
      )
    }
  }

  async function importSelectedSnapshot(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ""
    if (files.length === 0) return
    setSnapshotError(undefined)
    try {
      const entries: SnapshotSourceEntry[] = await Promise.all(
        files.map(async (file) => ({
          kind: "file",
          path: file.webkitRelativePath || file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          mtimeHint: file.lastModified,
        }))
      )
      const firstPath = entries[0]?.path.replaceAll("\\", "/")
      const rootLabel = firstPath?.split("/")[0] || "Imported snapshot"
      await importLocalSnapshot(
        createSnapshotProvider(entries, {
          rootLabel,
          sourceKind: "imported-snapshot",
        })
      )
    } catch (error) {
      setSnapshotError(
        error instanceof Error
          ? error.message
          : "Directory snapshot import failed."
      )
    }
  }

  async function cancelAndFocusStatus() {
    focusTerminalStatusRef.current = true
    try {
      await cancelLocalOperation()
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      operationStatusRef.current?.focus()
      focusTerminalStatusRef.current = false
    } catch {
      focusTerminalStatusRef.current = false
      operationStatusRef.current?.focus()
    }
  }

  const operationProgress =
    localOperation?.total && localOperation.total > 0
      ? Math.round(
          ((localOperation.completed ?? 0) / localOperation.total) * 100
        )
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
      <label
        className="text-xs font-medium text-muted-foreground"
        htmlFor="repository-switcher"
      >
        Repository
      </label>
      <Select
        value={selectedRepo?.id ?? ""}
        onValueChange={(value) => value && changeRepository(value)}
      >
        <SelectTrigger id="repository-switcher" className="w-full">
          <SelectValue
            placeholder={
              repositoriesStatus === "loading"
                ? "Loading repositories"
                : "Select repository"
            }
          />
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
        <span className="truncate text-muted-foreground">
          {selectedRepo?.name}
        </span>
        <span className="shrink-0 font-medium">
          {repositoryRuntimeLabel(selectedRepo)}
        </span>
      </div>
      <Button
        ref={openButtonRef}
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => void activateLocalFolder()}
        disabled={
          (capabilityReport !== undefined &&
            capabilityReport.tier !== "full") ||
          localOperation?.state === "refreshing"
        }
      >
        <FolderOpenIcon data-icon="inline-start" />
        Open local folder
      </Button>
      {capabilityReport ? (
        <details
          data-testid="local-capability-report"
          className="min-w-0 rounded-md border p-2 text-xs"
        >
          <summary className="cursor-pointer font-medium">
            Browser local indexing:{" "}
            <span data-testid="capability-tier">{capabilityReport.tier}</span>
          </summary>
          <dl className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2">
            <dt>Secure context</dt>
            <dd data-testid="capability-secure-context">
              {capabilityReport.secureContext ? "available" : "missing"}
            </dd>
            <dt>Folder picker</dt>
            <dd data-testid="capability-folder-picker">
              {capabilityReport.folderPicker}
            </dd>
            <dt>Directory drop</dt>
            <dd data-testid="capability-directory-drop">
              {capabilityReport.directoryDrop}
            </dd>
            <dt>Origin-private storage</dt>
            <dd data-testid="capability-opfs">{capabilityReport.opfs}</dd>
            <dt>Repository locks</dt>
            <dd data-testid="capability-web-locks">
              {capabilityReport.webLocks}
            </dd>
            <dt>Module worker</dt>
            <dd data-testid="capability-module-worker">
              {capabilityReport.moduleWorker ? "available" : "missing"}
            </dd>
            <dt>WebAssembly</dt>
            <dd data-testid="capability-wasm">{capabilityReport.wasm}</dd>
          </dl>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {capabilityReport.guidance.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="text-xs text-muted-foreground">
          Checking browser-local support.
        </p>
      )}
      {capabilityReport?.tier === "full" ||
      capabilityReport?.tier === "snapshot-only" ? (
        <details
          data-testid="snapshot-import"
          className="min-w-0 rounded-md border border-dashed p-2 text-xs"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => void importDroppedSnapshot(event)}
        >
          <summary className="cursor-pointer font-medium">
            Import directory snapshot
          </summary>
          <p>Drop a directory snapshot here.</p>
          <p className="text-muted-foreground">
            Snapshots are immutable and will not reconnect or refresh
            automatically.
          </p>
          <input
            ref={snapshotInputRef}
            className="sr-only"
            type="file"
            multiple
            aria-label="Choose directory snapshot files"
            onChange={(event) => void importSelectedSnapshot(event)}
            {...({ webkitdirectory: "" } as Record<string, string>)}
          />
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => snapshotInputRef.current?.click()}
          >
            <ImportIcon data-icon="inline-start" />
            Choose directory snapshot
          </Button>
        </details>
      ) : null}
      {snapshotError ? (
        <p className="text-xs text-destructive" role="alert">
          {snapshotError}
        </p>
      ) : null}
      {localOperation ? (
        <div
          ref={operationStatusRef}
          tabIndex={-1}
          className="flex min-w-0 flex-col gap-2 rounded-md border p-2 text-xs motion-reduce:transition-none"
          role={ALERT_STATES.has(localOperation.state) ? "alert" : "status"}
          aria-live={
            ALERT_STATES.has(localOperation.state) ? "assertive" : "polite"
          }
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
              onClick={() => void cancelAndFocusStatus()}
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
                disabled={
                  !repositories.some(
                    (repository) => repository.id !== selectedRepo?.id
                  )
                }
                onClick={() => {
                  const alternative = repositories.find(
                    (repository) => repository.id !== selectedRepo?.id
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
