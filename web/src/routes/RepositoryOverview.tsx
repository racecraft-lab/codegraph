import { Link } from "react-router-dom"
import { BotIcon, RefreshCcwIcon, SearchIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { useAppState } from "@/app/state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { repositoryRuntimeLabel } from "@/components/layout/RepositorySwitcher"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const ACTIONS = [
  { to: "/search", label: "Search symbols", icon: SearchIcon },
  {
    to: "/reindex",
    label: "Re-analyze",
    localLabel: "Refresh local index",
    localUnavailable:
      "Local refresh requires a connected folder. Server re-analysis is unavailable for local repositories.",
    icon: RefreshCcwIcon,
  },
  {
    to: "/chat",
    label: "Ask with context",
    localUnavailable:
      "Chat is available only for server repositories. Local keyword browsing remains available.",
    icon: BotIcon,
  },
]

export function RepositoryOverview() {
  const {
    selectedRepo,
    repositoryStatus,
    repositoryState,
    localOperation,
    storageStatus,
    requestStoragePersistence,
    deleteLocalRepository,
    refreshLocalRepository,
  } = useAppState()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmationName, setConfirmationName] = useState("")
  const [cancelActive, setCancelActive] = useState(false)
  const isLocal = selectedRepo?.runtime === "local"
  const localBusy = isLocal && localOperation?.state === "busy"
  const localDeleting = isLocal && localOperation?.state === "deleting"
  const localActionsBlocked = localBusy || localDeleting
  const activeOperation = localOperation?.state === "refreshing"
  const storageUsage =
    storageStatus?.usageBytes === undefined
      ? "Storage usage is unavailable."
      : storageStatus.quotaBytes === undefined
        ? `${Math.round(storageStatus.usageBytes / 1_048_576)} MB used`
        : `${Math.round(storageStatus.usageBytes / 1_048_576)} MB used of approximately ${Math.round(storageStatus.quotaBytes / 1_048_576)} MB`
  const persistenceLabel =
    storageStatus?.persisted === "granted"
      ? "Storage is persistent."
      : storageStatus?.persisted === "denied"
        ? "Storage is not persistent."
        : storageStatus?.persisted === "unknown"
          ? "Persistence status is unknown."
          : "Persistent storage requests are not supported."

  return (
    <div className="flex min-w-0 flex-col gap-4 overflow-x-hidden p-4">
      <section className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Repository overview</h1>
          <Badge variant={isLocal ? "secondary" : "outline"}>
            {repositoryRuntimeLabel(selectedRepo)}
          </Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {selectedRepo
            ? isLocal
              ? selectedRepo.name
              : selectedRepo.root
            : "Connect to a local CodeGraph repository to inspect symbols and graph context."}
        </p>
        {isLocal && localOperation ? (
          <p
            className="max-w-3xl text-sm text-muted-foreground"
            role={
              ["failed", "busy", "quota-blocked", "permission-blocked"].includes(
                localOperation.state,
              )
                ? "alert"
                : "status"
            }
            aria-live="polite"
          >
            {localOperation.message}
          </p>
        ) : null}
        {localBusy ? (
          <p
            id="local-repository-busy-actions"
            className="max-w-3xl text-sm text-muted-foreground"
          >
            Local reads are disabled until this browser tab acquires the repository.
          </p>
        ) : null}
      </section>
      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Index</CardTitle>
            <CardDescription>{repositoryState}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {repositoryStatus
              ? `${repositoryStatus.index.nodeCount.toLocaleString()} symbols and ${repositoryStatus.index.edgeCount.toLocaleString()} edges`
              : "Status is not available yet."}
          </CardContent>
        </Card>
        {isLocal ? (
          <Card>
            <CardHeader>
              <CardTitle>Browser storage</CardTitle>
              <CardDescription>{persistenceLabel}</CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col items-start gap-2 text-sm">
              <p>{storageUsage}</p>
              <p className="text-muted-foreground">
                CodeGraph never deletes local indexes automatically.
              </p>
              {localOperation?.state === "quota-blocked" ? (
                <p role="alert">
                  Free browser site storage, then retry. The previous complete
                  local index remains available.
                </p>
              ) : null}
              {storageStatus &&
              storageStatus.persisted !== "granted" &&
              storageStatus.persisted !== "not-supported" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void requestStoragePersistence()}
                >
                  Request persistent storage
                </Button>
              ) : null}
              <Button
                variant="destructive"
                size="sm"
                disabled={localBusy || localDeleting}
                onClick={() => {
                  setConfirmationName("")
                  setCancelActive(false)
                  setDeleteOpen(true)
                }}
              >
                <Trash2Icon data-icon="inline-start" />
                Delete browser index
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={localBusy || localDeleting || activeOperation}
                onClick={() => void refreshLocalRepository()}
              >
                <RefreshCcwIcon data-icon="inline-start" />
                Refresh browser index
              </Button>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Search</CardTitle>
            <CardDescription>Open symbols and source context.</CardDescription>
          </CardHeader>
          <CardContent>
            {localActionsBlocked ? (
              <Button
                disabled
                aria-describedby={
                  localBusy ? "local-repository-busy-actions" : undefined
                }
              >
                <SearchIcon data-icon="inline-start" />
                Start search
              </Button>
            ) : (
              <Button nativeButton={false} render={<Link to="/search" />}>
                <SearchIcon data-icon="inline-start" />
                Start search
              </Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Graph</CardTitle>
            <CardDescription>Explore neighborhoods after selecting a symbol.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-wrap gap-3">
            {ACTIONS.map((action) => {
              const descriptionId = `local-action-${action.to.slice(1)}`
              if (localActionsBlocked) {
                return (
                  <Button
                    key={action.to}
                    variant="outline"
                    size="sm"
                    disabled
                    aria-describedby={
                      localBusy ? "local-repository-busy-actions" : undefined
                    }
                  >
                    <action.icon data-icon="inline-start" />
                    {action.localLabel ?? action.label}
                  </Button>
                )
              }
              if (isLocal && action.localUnavailable) {
                return (
                  <div
                    key={action.to}
                    className="min-w-0 flex-1 basis-full"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="max-w-full"
                      disabled
                      aria-describedby={descriptionId}
                    >
                      <action.icon data-icon="inline-start" />
                      {action.localLabel ?? action.label}
                    </Button>
                    <p
                      id={descriptionId}
                      className="mt-1 break-words text-xs text-muted-foreground"
                    >
                      {action.localUnavailable}
                    </p>
                  </div>
                )
              }
              return (
                <Button
                  key={action.to}
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link to={action.to} />}
                >
                  <action.icon data-icon="inline-start" />
                  {action.label}
                </Button>
              )
            })}
          </CardContent>
        </Card>
      </div>
      {isLocal && selectedRepo ? (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete browser-owned repository data?</DialogTitle>
              <DialogDescription>
                {repositoryRuntimeLabel(selectedRepo)} — {selectedRepo.name}
              </DialogDescription>
            </DialogHeader>
            <p>
              Graph database, accepted source cache, repository metadata,
              saved folder handle, and semantic state will be removed.
            </p>
            <p className="font-medium">
              Source folder files will not be changed
            </p>
            {activeOperation ? (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={cancelActive}
                  onChange={(event) => setCancelActive(event.target.checked)}
                />
                <span>Cancel the active refresh and delete</span>
              </label>
            ) : null}
            <label className="flex flex-col gap-1">
              <span>Type {selectedRepo.name} to confirm</span>
              <Input
                aria-label={`Type ${selectedRepo.name} to confirm`}
                value={confirmationName}
                onChange={(event) => setConfirmationName(event.target.value)}
              />
            </label>
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={
                  confirmationName !== selectedRepo.name ||
                  (activeOperation && !cancelActive)
                }
                onClick={() => {
                  void Promise.resolve(
                    deleteLocalRepository({
                      confirmationName,
                      cancelActive,
                    }),
                  ).then(() => setDeleteOpen(false))
                }}
              >
                Delete browser data
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
