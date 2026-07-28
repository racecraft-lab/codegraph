import * as React from "react"

import { errorState } from "@/lib/api/client"
import { classifyRepositoryStatus } from "@/lib/api/repositories"
import type { AsyncStatus, CodeNode, Repository, RepositoryState, RepositoryStatus } from "@/lib/api/types"
import {
  createRemoteRepositoryClient,
  createUnavailableRepositoryClient,
  RepositoryClientError,
  type RepositoryClient,
} from "@/lib/repository-client"
import {
  LocalRepositoryClient,
  type LocalRepositoryProgress,
} from "@/local-indexing/client"
import {
  openPickedFolderFromUserAction,
  type DirectoryHandleLike,
} from "@/local-indexing/source"

export type LocalOperationState =
  | "complete"
  | "stale"
  | "refreshing"
  | "snapshot"
  | "cancelled"
  | "failed"
  | "partial-warning"
  | "busy"
  | "quota-blocked"
  | "permission-blocked"
  | "deleted"

export interface LocalOperationStatus {
  state: LocalOperationState
  message: string
  phase?: string
  completed?: number
  total?: number
  cancellable: boolean
}

const LOCAL_REPOSITORIES_KEY = "codegraph.localRepositories.v1"

function persistedLocalRepositories(): Repository[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(LOCAL_REPOSITORIES_KEY) ?? "[]",
    ) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (candidate): candidate is Repository =>
        Boolean(
          candidate &&
            typeof candidate === "object" &&
            typeof (candidate as Repository).id === "string" &&
            typeof (candidate as Repository).name === "string" &&
            (candidate as Repository).runtime === "local",
        ),
    )
  } catch {
    return []
  }
}

function persistLocalRepositories(repositories: Repository[]) {
  localStorage.setItem(
    LOCAL_REPOSITORIES_KEY,
    JSON.stringify(
      repositories.filter((repository) => repository.runtime === "local"),
    ),
  )
}

interface AppStateValue {
  repositories: Repository[]
  repositoriesStatus: AsyncStatus
  selectedRepo?: Repository
  repositoryStatus?: RepositoryStatus
  repositoryState: RepositoryState
  statusMessage: string
  selectedNode?: CodeNode
  selectRepository: (repoId: string) => void
  selectNode: (node: CodeNode) => void
  clearNode: () => void
  refreshRepositories: () => Promise<void>
  refreshStatus: () => Promise<void>
  localOperation?: LocalOperationStatus
  openLocalFolder: () => Promise<void>
  cancelLocalOperation: () => Promise<void>
  repositoryClient: RepositoryClient
}

const AppStateContext = React.createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [repositories, setRepositories] = React.useState<Repository[]>([])
  const [repositoriesStatus, setRepositoriesStatus] = React.useState<AsyncStatus>("idle")
  const [selectedRepoId, setSelectedRepoId] = React.useState<string | undefined>()
  const [repositoryStatus, setRepositoryStatus] = React.useState<RepositoryStatus | undefined>()
  const [repositoryState, setRepositoryState] = React.useState<RepositoryState>("missing")
  const [statusMessage, setStatusMessage] = React.useState("Loading repository state.")
  const [selectedNode, setSelectedNode] = React.useState<CodeNode | undefined>()
  const [localOperation, setLocalOperation] = React.useState<LocalOperationStatus | undefined>()
  const [activeLocalClient, setActiveLocalClient] =
    React.useState<LocalRepositoryClient | undefined>()
  const [remoteClient] = React.useState<RepositoryClient>(() =>
    createRemoteRepositoryClient(),
  )
  const [unavailableLocalClient] = React.useState<RepositoryClient>(() =>
    createUnavailableRepositoryClient(),
  )
  const statusRequestRef = React.useRef(0)
  const localClientRef = React.useRef<LocalRepositoryClient | undefined>(undefined)
  const localOperationIdRef = React.useRef<string | undefined>(undefined)

  const selectedRepo = React.useMemo(
    () => repositories.find((repo) => repo.id === selectedRepoId) ?? repositories.find((repo) => repo.default) ?? repositories[0],
    [repositories, selectedRepoId],
  )
  const repositoryClient =
    selectedRepo?.runtime === "local"
      ? activeLocalClient ?? unavailableLocalClient
      : remoteClient

  const updateLocalProgress = React.useCallback((progress: LocalRepositoryProgress) => {
    if (progress.operationId !== localOperationIdRef.current) return
    setLocalOperation({
      state: "refreshing",
      message: "Building the browser-local keyword index.",
      phase: progress.phase,
      completed: progress.completed,
      total: progress.total,
      cancellable: progress.phase !== "publish",
    })
  }, [])

  const localClient = React.useCallback(() => {
    if (!localClientRef.current) {
      const worker = new Worker(
        new URL("../local-indexing/worker.ts", import.meta.url),
        { type: "module", name: "codegraph-local-indexer" },
      )
      const client = new LocalRepositoryClient(worker, {
        onProgress: updateLocalProgress,
      })
      localClientRef.current = client
      setActiveLocalClient(client)
    }
    return localClientRef.current
  }, [updateLocalProgress])

  const refreshRepositories = React.useCallback(async () => {
    setRepositoriesStatus("loading")
    try {
      const persisted = persistedLocalRepositories()
      let nextRepos: Repository[]
      if (persisted.length > 0) {
        const publishedIds = new Set(
          (await localClient().listRepositories()).map(
            (repository) => repository.id,
          ),
        )
        nextRepos = persisted.filter((repository) =>
          publishedIds.has(repository.id),
        )
        persistLocalRepositories(nextRepos)
      } else {
        nextRepos = await remoteClient.listRepositories()
      }
      setRepositories(nextRepos)
      setSelectedRepoId((current) => current ?? nextRepos.find((repo) => repo.default)?.id ?? nextRepos[0]?.id)
      setRepositoriesStatus("success")
    } catch (error) {
      const nextError = errorState(error)
      setRepositoriesStatus("error")
      setRepositoryState(nextError.code === "unauthorized" ? "unauthorized" : "unavailable")
      setStatusMessage(nextError.message)
    }
  }, [localClient, remoteClient])

  const refreshStatus = React.useCallback(async () => {
    const repoId = selectedRepo?.id
    const requestId = statusRequestRef.current + 1
    statusRequestRef.current = requestId
    try {
      if (!repoId) throw new RepositoryClientError("not_found", "Select a repository first.", false)
      const status = await repositoryClient.getRepositoryStatus(repoId)
      if (statusRequestRef.current !== requestId) return
      if (repoId && status.repo.id !== repoId) return
      setRepositoryStatus(status)
      setRepositoryState(classifyRepositoryStatus(status))
      setStatusMessage(`${status.index.nodeCount.toLocaleString()} symbols across ${status.index.fileCount.toLocaleString()} files.`)
    } catch (error) {
      if (statusRequestRef.current !== requestId) return
      const nextError = errorState(error)
      setRepositoryStatus(undefined)
      setRepositoryState(classifyRepositoryStatus(undefined, nextError.code))
      setStatusMessage(nextError.message)
    }
  }, [repositoryClient, selectedRepo?.id])

  const selectRepository = React.useCallback((repoId: string) => {
    statusRequestRef.current += 1
    setSelectedRepoId(repoId)
    setRepositoryStatus(undefined)
    setRepositoryState("missing")
    setStatusMessage("Loading repository state.")
    setSelectedNode(undefined)
  }, [])

  const selectNode = React.useCallback((node: CodeNode) => {
    setSelectedNode(node)
  }, [])

  const clearNode = React.useCallback(() => {
    setSelectedNode(undefined)
  }, [])

  const openLocalFolder = React.useCallback(async () => {
    const picker = (
      window as Window & {
        showDirectoryPicker?: () => Promise<DirectoryHandleLike>
      }
    ).showDirectoryPicker
    if (!picker) {
      setLocalOperation({
        state: "permission-blocked",
        message: "This browser does not provide local folder selection.",
        cancellable: false,
      })
      throw new RepositoryClientError(
        "capability_unavailable",
        "This browser does not provide local folder selection.",
        false,
      )
    }

    setLocalOperation({
      state: "refreshing",
      message: "Choose a local folder to index in this browser.",
      phase: "Waiting for folder",
      completed: 0,
      total: 0,
      cancellable: false,
    })

    try {
      const provider = await openPickedFolderFromUserAction(
        () => picker.call(window),
        { userActivated: true },
      )
      setLocalOperation({
        state: "refreshing",
        message: "Reading accepted source files.",
        phase: "Reading files",
        completed: 0,
        total: 0,
        cancellable: false,
      })
      const collection = await provider.collect()
      const operationId = crypto.randomUUID()
      localOperationIdRef.current = operationId
      const repository = await localClient().openPickedFolder(
        {
          identity: provider.identity,
          collection,
        },
        provider.identity.id,
        operationId,
      )
      const localRepository: Repository = {
        ...repository,
        id: provider.identity.id,
        root: provider.identity.virtualRoot,
        name: provider.identity.displayName,
        default: false,
        runtime: "local",
        sourceKind: "picked-folder",
      }
      setRepositories((current) => [
        ...current.filter((candidate) => candidate.id !== localRepository.id),
        localRepository,
      ])
      persistLocalRepositories([
        ...persistedLocalRepositories().filter(
          (candidate) => candidate.id !== localRepository.id,
        ),
        localRepository,
      ])
      setSelectedRepoId(localRepository.id)
      setLocalOperation({
        state: collection.warnings.details.length > 0 ? "partial-warning" : "complete",
        message:
          collection.warnings.details.length > 0
            ? `Indexed with ${collection.warnings.total.toLocaleString()} source warnings.`
            : "Local keyword index complete.",
        phase: "Complete",
        completed: collection.entries.length,
        total: collection.entries.length,
        cancellable: false,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setLocalOperation({
          state: "cancelled",
          message: "Folder selection was cancelled.",
          cancellable: false,
        })
      } else {
        const code =
          error instanceof RepositoryClientError ? error.code : "internal"
        setLocalOperation({
          state:
            code === "operation_cancelled"
              ? "cancelled"
              : code === "quota_exceeded"
              ? "quota-blocked"
              : code === "permission_denied"
                ? "permission-blocked"
                : code === "repository_busy"
                  ? "busy"
                  : "failed",
          message:
            code === "operation_cancelled"
              ? "Local indexing was cancelled."
              : error instanceof Error
              ? error.message
              : "The local indexing operation failed.",
          cancellable: false,
        })
      }
      throw error
    } finally {
      localOperationIdRef.current = undefined
    }
  }, [localClient])

  const cancelLocalOperation = React.useCallback(async () => {
    const operationId = localOperationIdRef.current
    if (!operationId) return
    await localClient().cancel(operationId)
  }, [localClient])

  React.useEffect(() => {
    void refreshRepositories()
  }, [refreshRepositories])

  React.useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  React.useEffect(
    () => () => {
      localClientRef.current?.close()
      localClientRef.current = undefined
    },
    [],
  )

  const value = React.useMemo<AppStateValue>(
    () => ({
      repositories,
      repositoriesStatus,
      selectedRepo,
      repositoryStatus,
      repositoryState,
      statusMessage,
      selectedNode,
      selectRepository,
      selectNode,
      clearNode,
      refreshRepositories,
      refreshStatus,
      localOperation,
      openLocalFolder,
      cancelLocalOperation,
      repositoryClient,
    }),
    [
      repositories,
      repositoriesStatus,
      selectedRepo,
      repositoryStatus,
      repositoryState,
      statusMessage,
      selectedNode,
      selectRepository,
      selectNode,
      clearNode,
      refreshRepositories,
      refreshStatus,
      localOperation,
      openLocalFolder,
      cancelLocalOperation,
      repositoryClient,
    ],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppStateValue {
  const context = React.useContext(AppStateContext)
  if (!context) {
    throw new Error("useAppState must be used within AppStateProvider")
  }
  return context
}
