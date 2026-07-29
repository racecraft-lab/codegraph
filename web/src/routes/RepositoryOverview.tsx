import { Link } from "react-router-dom"
import {
  BotIcon,
  KeyRoundIcon,
  RefreshCcwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import { useRef, useState } from "react"

import { useAppState } from "@/app/state"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
    localSourceConnection,
    storageStatus,
    requestStoragePersistence,
    deleteLocalRepository,
    reconnectLocalRepository,
    refreshLocalRepository,
    startSemanticIndexing,
  } = useAppState()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmationName, setConfirmationName] = useState("")
  const [cancelActive, setCancelActive] = useState(false)
  const [semanticEndpoint, setSemanticEndpoint] = useState("")
  const [semanticModel, setSemanticModel] = useState("")
  const [semanticCredential, setSemanticCredential] = useState("")
  const [semanticConsent, setSemanticConsent] = useState(false)
  const reconnectButtonRef = useRef<HTMLButtonElement>(null)
  const semanticButtonRef = useRef<HTMLButtonElement>(null)
  const operationStatusRef = useRef<HTMLParagraphElement>(null)
  const overviewHeadingRef = useRef<HTMLHeadingElement>(null)
  const isLocal = selectedRepo?.runtime === "local"
  const localBusy = isLocal && localOperation?.state === "busy"
  const localDeleting = isLocal && localOperation?.state === "deleting"
  const localActionsBlocked = localBusy || localDeleting
  const activeOperation = localOperation?.state === "refreshing"
  const pickedFolderDisconnected =
    isLocal &&
    selectedRepo?.sourceKind === "picked-folder" &&
    !localSourceConnection?.canRefresh
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

  async function reconnect() {
    try {
      await reconnectLocalRepository()
    } finally {
      reconnectButtonRef.current?.focus()
    }
  }

  async function startSemantic() {
    try {
      await startSemanticIndexing({
        endpointUrl: semanticEndpoint,
        model: semanticModel,
        credential: semanticCredential,
      })
      setSemanticCredential("")
    } finally {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          ;(operationStatusRef.current ?? semanticButtonRef.current)?.focus()
        })
      })
    }
  }

  async function deleteRepository() {
    await deleteLocalRepository({
      confirmationName,
      cancelActive,
    })
    setDeleteOpen(false)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => overviewHeadingRef.current?.focus())
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 overflow-x-hidden p-4">
      <section className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1
            ref={overviewHeadingRef}
            tabIndex={-1}
            className="text-2xl font-semibold"
          >
            Repository overview
          </h1>
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
            ref={operationStatusRef}
            tabIndex={-1}
            className="max-w-3xl text-sm text-muted-foreground"
            role={
              [
                "failed",
                "busy",
                "quota-blocked",
                "permission-blocked",
              ].includes(localOperation.state)
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
            Local reads are disabled until this browser tab acquires the
            repository.
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
                disabled={
                  localBusy ||
                  localDeleting ||
                  activeOperation ||
                  pickedFolderDisconnected
                }
                onClick={() => void refreshLocalRepository()}
              >
                <RefreshCcwIcon data-icon="inline-start" />
                Refresh browser index
              </Button>
              {pickedFolderDisconnected ? (
                <>
                  <Button
                    ref={reconnectButtonRef}
                    variant="outline"
                    size="sm"
                    disabled={localBusy || localDeleting}
                    onClick={() => void reconnect()}
                  >
                    <RefreshCcwIcon data-icon="inline-start" />
                    Reconnect local folder
                  </Button>
                  <p className="text-muted-foreground">
                    Cached browsing remains available. Reconnect explicitly to
                    enable manual refresh.
                  </p>
                </>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
        {isLocal ? (
          <Card>
            <CardHeader>
              <CardTitle>Optional semantic indexing</CardTitle>
              <CardDescription>
                Keyword browsing stays available if semantic indexing is
                cancelled or fails.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex min-w-0 flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void startSemantic()
                }}
              >
                <label className="flex min-w-0 flex-col gap-1">
                  <span>Embedding endpoint</span>
                  <Input
                    type="url"
                    value={semanticEndpoint}
                    onChange={(event) =>
                      setSemanticEndpoint(event.target.value)
                    }
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span>Embedding model</span>
                  <Input
                    value={semanticModel}
                    onChange={(event) => setSemanticModel(event.target.value)}
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span>Page-session bearer key</span>
                  <Input
                    type="password"
                    autoComplete="off"
                    value={semanticCredential}
                    onChange={(event) =>
                      setSemanticCredential(event.target.value)
                    }
                  />
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={semanticConsent}
                    onChange={(event) =>
                      setSemanticConsent(event.target.checked)
                    }
                  />
                  <span>
                    I consent to semantic indexing after the local keyword index
                    is complete.
                  </span>
                </label>
                <p className="text-xs text-muted-foreground">
                  The bearer key remains only in memory for semantic searches
                  during this page session. It is cleared when the local client
                  closes or the page reloads and is never stored durably.
                </p>
                <Button
                  ref={semanticButtonRef}
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={
                    localActionsBlocked ||
                    activeOperation ||
                    !semanticConsent ||
                    semanticEndpoint.length === 0 ||
                    semanticModel.length === 0 ||
                    semanticCredential.length === 0
                  }
                >
                  <KeyRoundIcon data-icon="inline-start" />
                  Start semantic indexing
                </Button>
              </form>
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
            <CardDescription>
              Explore neighborhoods after selecting a symbol.
            </CardDescription>
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
                  <div key={action.to} className="min-w-0 flex-1 basis-full">
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
                      className="mt-1 text-xs break-words text-muted-foreground"
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
              Graph database, accepted source cache, repository metadata, saved
              folder handle, and semantic state will be removed.
            </p>
            <p className="font-medium">
              Source folder files will not be changed
            </p>
            {activeOperation ? (
              <>
                <p role="status">{localOperation.message}</p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={cancelActive}
                    onChange={(event) => setCancelActive(event.target.checked)}
                  />
                  <span>Cancel the active local operation and delete</span>
                </label>
              </>
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
                onClick={() => void deleteRepository()}
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
