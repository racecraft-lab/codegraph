import * as React from "react"

import { errorState } from "@/lib/api/client"
import { classifyRepositoryStatus } from "@/lib/api/repositories"
import type {
  AsyncStatus,
  CodeNode,
  Repository,
  RepositoryState,
  RepositoryStatus,
} from "@/lib/api/types"
import {
  createRemoteRepositoryClient,
  createUnavailableRepositoryClient,
  RepositoryClientError,
  type RepositoryClient,
} from "@/lib/repository-client"
import {
  LocalRepositoryClient,
  type LocalRepositoryProgress,
  type LocalStorageStatus,
} from "@/local-indexing/client"
import {
  EmbeddingProfileStore,
  MemoryOnlyEmbeddingCredentials,
} from "@/local-indexing/embeddings"
import {
  openPickedFolderFromUserAction,
  SourceHandleRegistry,
  type DirectoryHandleLike,
  type SourceConnection,
  type SourceIdentity,
  type SnapshotSourceProvider,
} from "@/local-indexing/source"
import {
  probeBrowserCapabilities,
  type BrowserCapabilityReport,
} from "@/local-indexing/capabilities"

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
  | "deleting"
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
  const unreadable = () =>
    new RepositoryClientError(
      "internal",
      "Browser repository metadata is unreadable. Clear or repair this site's local CodeGraph metadata before continuing.",
      false
    )
  let raw: string | null
  try {
    raw = localStorage.getItem(LOCAL_REPOSITORIES_KEY)
  } catch {
    throw unreadable()
  }
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw unreadable()
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((candidate) => {
      if (!candidate || typeof candidate !== "object") return true
      const repository = candidate as Record<string, unknown>
      const id = repository.id
      const sourceKind = repository.sourceKind
      const duplicate = repository.duplicateSnapshot
      return (
        typeof id !== "string" ||
        id.length === 0 ||
        repository.root !== `local://${id}` ||
        typeof repository.name !== "string" ||
        repository.name.length === 0 ||
        typeof repository.default !== "boolean" ||
        repository.runtime !== "local" ||
        (sourceKind !== "picked-folder" &&
          sourceKind !== "dropped-snapshot" &&
          sourceKind !== "imported-snapshot") ||
        (repository.snapshotImportedAt !== undefined &&
          typeof repository.snapshotImportedAt !== "string") ||
        (repository.manifestFingerprint !== undefined &&
          typeof repository.manifestFingerprint !== "string") ||
        (duplicate !== undefined &&
          (!duplicate ||
            typeof duplicate !== "object" ||
            typeof (duplicate as Record<string, unknown>).repositoryId !==
              "string" ||
            typeof (duplicate as Record<string, unknown>).displayName !==
              "string"))
      )
    })
  ) {
    throw unreadable()
  }
  return parsed as Repository[]
}

function persistLocalRepositories(repositories: Repository[]) {
  localStorage.setItem(
    LOCAL_REPOSITORIES_KEY,
    JSON.stringify(
      repositories.filter((repository) => repository.runtime === "local")
    )
  )
}

function pickedFolderIdentity(
  repository: Repository
): SourceIdentity | undefined {
  if (
    repository.runtime !== "local" ||
    repository.sourceKind !== "picked-folder"
  ) {
    return undefined
  }
  return {
    id: repository.id,
    sourceKind: "picked-folder",
    displayName: repository.name,
    virtualRoot: `local://${repository.id}`,
    handleRefId: `handle-${repository.id}`,
  }
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
  storageStatus?: LocalStorageStatus
  capabilityReport?: BrowserCapabilityReport
  localSourceConnection?: SourceConnection
  openLocalFolder: () => Promise<void>
  importLocalSnapshot: (provider: SnapshotSourceProvider) => Promise<void>
  reconnectLocalRepository: () => Promise<void>
  refreshLocalRepository: () => Promise<void>
  startSemanticIndexing: (request: {
    endpointUrl: string
    model: string
    credential: string
  }) => Promise<void>
  cancelLocalOperation: () => Promise<void>
  requestStoragePersistence: () => Promise<void>
  deleteLocalRepository: (options: {
    confirmationName: string
    cancelActive: boolean
  }) => Promise<void>
  repositoryClient: RepositoryClient
}

const AppStateContext = React.createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [repositories, setRepositories] = React.useState<Repository[]>([])
  const [repositoriesStatus, setRepositoriesStatus] =
    React.useState<AsyncStatus>("idle")
  const [selectedRepoId, setSelectedRepoId] = React.useState<
    string | undefined
  >()
  const [repositoryStatus, setRepositoryStatus] = React.useState<
    RepositoryStatus | undefined
  >()
  const [repositoryState, setRepositoryState] =
    React.useState<RepositoryState>("missing")
  const [statusMessage, setStatusMessage] = React.useState(
    "Loading repository state."
  )
  const [selectedNode, setSelectedNode] = React.useState<CodeNode | undefined>()
  const [localOperation, setLocalOperation] = React.useState<
    LocalOperationStatus | undefined
  >()
  const [storageStatus, setStorageStatus] = React.useState<
    LocalStorageStatus | undefined
  >()
  const [capabilityReport, setCapabilityReport] = React.useState<
    BrowserCapabilityReport | undefined
  >()
  const [localSourceConnection, setLocalSourceConnection] = React.useState<
    SourceConnection | undefined
  >()
  const [activeLocalClient, setActiveLocalClient] = React.useState<
    LocalRepositoryClient | undefined
  >()
  const [remoteClient] = React.useState<RepositoryClient>(() =>
    createRemoteRepositoryClient()
  )
  const [unavailableLocalClient] = React.useState<RepositoryClient>(() =>
    createUnavailableRepositoryClient()
  )
  const statusRequestRef = React.useRef(0)
  const localClientRef = React.useRef<LocalRepositoryClient | undefined>(
    undefined
  )
  const localOperationIdRef = React.useRef<string | undefined>(undefined)
  const localOperationKindRef = React.useRef<"keyword" | "semantic">("keyword")
  const embeddingProfilesRef = React.useRef<EmbeddingProfileStore | undefined>(
    undefined
  )
  const embeddingCredentialsRef = React.useRef<
    MemoryOnlyEmbeddingCredentials | undefined
  >(undefined)
  const sourceRegistryRef = React.useRef<SourceHandleRegistry | undefined>(
    undefined
  )
  sourceRegistryRef.current ??= new SourceHandleRegistry()
  embeddingProfilesRef.current ??= new EmbeddingProfileStore()
  embeddingCredentialsRef.current ??= new MemoryOnlyEmbeddingCredentials()

  const selectedRepo = React.useMemo(
    () =>
      repositories.find((repo) => repo.id === selectedRepoId) ??
      repositories.find((repo) => repo.default) ??
      repositories[0],
    [repositories, selectedRepoId]
  )
  const repositoryClient =
    selectedRepo?.runtime === "local"
      ? (activeLocalClient ?? unavailableLocalClient)
      : remoteClient

  const updateLocalProgress = React.useCallback(
    (progress: LocalRepositoryProgress) => {
      if (progress.operationId !== localOperationIdRef.current) return
      setLocalOperation({
        state: "refreshing",
        message:
          localOperationKindRef.current === "semantic"
            ? "Building optional semantic vectors. Keyword search remains available."
            : "Building the browser-local keyword index.",
        phase: progress.phase,
        completed: progress.completed,
        total: progress.total,
        cancellable: progress.phase !== "publish",
      })
    },
    []
  )

  const localClient = React.useCallback(() => {
    if (!localClientRef.current) {
      if (typeof Worker !== "function") {
        throw new RepositoryClientError(
          "capability_unavailable",
          "This browser cannot start the local indexing worker.",
          false
        )
      }
      const worker = new Worker(
        new URL("../local-indexing/worker.ts", import.meta.url),
        { type: "module", name: "codegraph-local-indexer" }
      )
      const client = new LocalRepositoryClient(worker, {
        onProgress: updateLocalProgress,
        sourceRegistry: sourceRegistryRef.current,
      })
      localClientRef.current = client
      setActiveLocalClient(client)
    }
    return localClientRef.current
  }, [updateLocalProgress])

  const refreshRepositories = React.useCallback(async () => {
    setRepositoriesStatus("loading")
    let persisted: Repository[] = []
    try {
      persisted = persistedLocalRepositories()
      let nextRepos: Repository[]
      if (persisted.length > 0) {
        const repositoryToAcquire =
          persisted.find((repository) => repository.default) ?? persisted[0]
        await localClient().acquireRepository(repositoryToAcquire.id)
        setStorageStatus(await localClient().getStorageStatus())
        const publishedIds = new Set(
          (await localClient().listRepositories()).map(
            (repository) => repository.id
          )
        )
        nextRepos = persisted.filter((repository) =>
          publishedIds.has(repository.id)
        )
        await Promise.allSettled(
          nextRepos.map((repository) => {
            const identity = pickedFolderIdentity(repository)
            const activeConnection = localClient().sourceConnection(
              repository.id
            )
            return identity
              ? activeConnection?.canRefresh
                ? Promise.resolve(activeConnection)
                : localClient().restorePickedFolder(identity)
              : Promise.resolve()
          })
        )
        setLocalSourceConnection(
          localClient().sourceConnection(repositoryToAcquire.id)
        )
        persistLocalRepositories(nextRepos)
      } else {
        setStorageStatus(undefined)
        setLocalSourceConnection(undefined)
        nextRepos = await remoteClient.listRepositories()
      }
      setRepositories(nextRepos)
      setSelectedRepoId(
        (current) =>
          current ??
          nextRepos.find((repo) => repo.default)?.id ??
          nextRepos[0]?.id
      )
      setRepositoriesStatus("success")
      setLocalOperation((current) =>
        current?.state === "busy" ? undefined : current
      )
    } catch (error) {
      const nextError =
        error instanceof RepositoryClientError
          ? { code: error.code, message: error.message }
          : errorState(error)
      if (nextError.code === "repository_busy") {
        setRepositories(persisted)
        setSelectedRepoId(
          (current) =>
            current ??
            persisted.find((repository) => repository.default)?.id ??
            persisted[0]?.id
        )
        setLocalOperation({
          state: "busy",
          message: nextError.message,
          cancellable: false,
        })
      } else if (
        error instanceof RepositoryClientError &&
        error.message.startsWith("Browser repository metadata is unreadable.")
      ) {
        setLocalOperation({
          state: "failed",
          message: error.message,
          cancellable: false,
        })
      }
      setRepositoriesStatus("error")
      setRepositoryState(
        nextError.code === "unauthorized" ? "unauthorized" : "unavailable"
      )
      setStatusMessage(nextError.message)
    }
  }, [localClient, remoteClient])

  const refreshStatus = React.useCallback(async () => {
    const repoId = selectedRepo?.id
    const requestId = statusRequestRef.current + 1
    statusRequestRef.current = requestId
    try {
      if (!repoId)
        throw new RepositoryClientError(
          "not_found",
          "No repository is selected.",
          false
        )
      const status = await repositoryClient.getRepositoryStatus(repoId)
      if (statusRequestRef.current !== requestId) return
      if (repoId && status.repo.id !== repoId) return
      setRepositoryStatus(status)
      setRepositoryState(classifyRepositoryStatus(status))
      setStatusMessage(
        `${status.index.nodeCount.toLocaleString()} symbols across ${status.index.fileCount.toLocaleString()} files.`
      )
    } catch (error) {
      if (statusRequestRef.current !== requestId) return
      const nextError =
        error instanceof RepositoryClientError
          ? { code: error.code, message: error.message }
          : errorState(error)
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
    setLocalSourceConnection(localClientRef.current?.sourceConnection(repoId))
  }, [])

  const selectNode = React.useCallback((node: CodeNode) => {
    setSelectedNode(node)
  }, [])

  const clearNode = React.useCallback(() => {
    setSelectedNode(undefined)
  }, [])

  const openLocalFolder = React.useCallback(async () => {
    if (capabilityReport && capabilityReport.tier !== "full") {
      throw new RepositoryClientError(
        "capability_unavailable",
        capabilityReport.guidance.join(" "),
        false
      )
    }
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
      setStorageStatus(await localClient().getStorageStatus())
      throw new RepositoryClientError(
        "capability_unavailable",
        "This browser does not provide local folder selection.",
        false
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
      let pickedHandle: DirectoryHandleLike | undefined
      const provider = await openPickedFolderFromUserAction(
        async () => {
          pickedHandle = await picker.call(window)
          return pickedHandle
        },
        { userActivated: true }
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
      localOperationKindRef.current = "keyword"
      const repository = await localClient().openPickedFolder(
        {
          identity: provider.identity,
          collection,
        },
        provider.identity.id,
        operationId
      )
      if (pickedHandle) {
        setLocalSourceConnection(
          localClient().connectPickedFolder(provider.identity, pickedHandle)
        )
      }
      if (
        pickedHandle?.queryPermission &&
        pickedHandle.requestPermission &&
        pickedHandle.isSameEntry
      ) {
        await localClient().savePickedFolder(provider.identity, pickedHandle)
      }
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
          (candidate) => candidate.id !== localRepository.id
        ),
        localRepository,
      ])
      setSelectedRepoId(localRepository.id)
      setLocalOperation({
        state:
          collection.warnings.details.length > 0
            ? "partial-warning"
            : "complete",
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
  }, [capabilityReport, localClient])

  const importLocalSnapshot = React.useCallback(
    async (provider: SnapshotSourceProvider) => {
      if (
        !capabilityReport ||
        (capabilityReport.tier !== "full" &&
          capabilityReport.tier !== "snapshot-only")
      ) {
        throw new RepositoryClientError(
          "capability_unavailable",
          capabilityReport?.guidance.join(" ") ??
            "Directory snapshot import is unavailable.",
          false
        )
      }
      setLocalOperation({
        state: "snapshot",
        message: "Reading an immutable directory snapshot.",
        phase: "Reading files",
        completed: 0,
        total: 0,
        cancellable: false,
      })
      try {
        const collection = await provider.collect()
        const repository = await localClient().importSnapshot(
          { identity: provider.identity, collection },
          collection.entries.map((entry) => entry.bytes.buffer as ArrayBuffer)
        )
        setRepositories((current) => [
          ...current.filter((candidate) => candidate.id !== repository.id),
          repository,
        ])
        persistLocalRepositories([
          ...persistedLocalRepositories().filter(
            (candidate) => candidate.id !== repository.id
          ),
          repository,
        ])
        setSelectedRepoId(repository.id)
        setLocalSourceConnection(undefined)
        setLocalOperation({
          state: collection.warnings.total > 0 ? "partial-warning" : "snapshot",
          message: repository.duplicateSnapshot
            ? `Snapshot imported. Its accepted files match ${repository.duplicateSnapshot.displayName}; both repositories remain separate.`
            : `Snapshot imported at ${new Date(
                collection.snapshot.acceptedAt
              ).toLocaleString()}. It will not reconnect or refresh automatically.`,
          phase: "Complete",
          completed: collection.snapshot.fileCount,
          total: collection.snapshot.fileCount,
          cancellable: false,
        })
      } catch (error) {
        setLocalOperation({
          state: "failed",
          message:
            error instanceof Error
              ? error.message
              : "Directory snapshot import failed.",
          cancellable: false,
        })
        throw error
      }
    },
    [capabilityReport, localClient]
  )

  const cancelLocalOperation = React.useCallback(async () => {
    const operationId = localOperationIdRef.current
    if (!operationId) return
    await localClient().cancel(operationId)
  }, [localClient])

  const reconnectLocalRepository = React.useCallback(async () => {
    if (!selectedRepo) {
      throw new RepositoryClientError(
        "invalid_request",
        "Select a saved local folder to reconnect.",
        false
      )
    }
    const identity = pickedFolderIdentity(selectedRepo)
    if (!identity) {
      throw new RepositoryClientError(
        "capability_unavailable",
        "Snapshot repositories cannot reconnect.",
        false
      )
    }
    try {
      const connection = await localClient().reconnectPickedFolder(identity, {
        userActivated: true,
      })
      setLocalSourceConnection(connection)
      setLocalOperation({
        state: "complete",
        message: `${selectedRepo.name} reconnected. Manual refresh is available.`,
        cancellable: false,
      })
    } catch (error) {
      setLocalSourceConnection(localClient().sourceConnection(selectedRepo.id))
      setLocalOperation({
        state: "permission-blocked",
        message:
          error instanceof Error
            ? error.message
            : "Read permission was not granted for the saved local folder.",
        cancellable: false,
      })
      throw error
    }
  }, [localClient, selectedRepo])

  const refreshLocalRepository = React.useCallback(async () => {
    if (!selectedRepo || selectedRepo.runtime !== "local") {
      throw new RepositoryClientError(
        "invalid_request",
        "Select a browser-local repository to refresh.",
        false
      )
    }
    setLocalOperation({
      state: "refreshing",
      message: `Refreshing ${selectedRepo.name}.`,
      phase: "refresh-diff",
      completed: 0,
      total: 0,
      cancellable: true,
    })
    localOperationKindRef.current = "keyword"
    try {
      const result = await localClient().refresh(selectedRepo.id)
      const changes = (result.changes ?? {}) as Record<string, number>
      setLocalOperation({
        state: (result.counts as { warnings?: number } | undefined)?.warnings
          ? "partial-warning"
          : "complete",
        message: `Local refresh complete: ${changes.added ?? 0} added, ${changes.changed ?? 0} changed, ${changes.deleted ?? 0} deleted, ${changes.unchanged ?? 0} unchanged, ${changes.skipped ?? 0} skipped.`,
        phase: "Complete",
        cancellable: false,
      })
      await refreshStatus()
    } catch (error) {
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
                : "failed",
        message:
          error instanceof Error
            ? error.message
            : "The local refresh failed; the previous complete index remains available.",
        cancellable: false,
      })
      throw error
    }
  }, [localClient, refreshStatus, selectedRepo])

  const startSemanticIndexing = React.useCallback(
    async (request: {
      endpointUrl: string
      model: string
      credential: string
    }) => {
      const graphGeneration = repositoryStatus?.index.generation
      if (
        !selectedRepo ||
        selectedRepo.runtime !== "local" ||
        !graphGeneration
      ) {
        throw new RepositoryClientError(
          "invalid_request",
          "Complete the browser-local keyword index before semantic indexing.",
          false
        )
      }
      const consentGrantedAt = new Date().toISOString()
      const profile = embeddingProfilesRef.current!.save({
        repositoryId: selectedRepo.id,
        enabled: true,
        consentGrantedAt,
        endpointUrl: request.endpointUrl,
        model: request.model,
        graphGeneration,
        coverage: { embedded: 0, skipped: 0 },
        inputHashes: [],
        resume: { status: "idle", completedItems: 0, nextBatch: 0 },
      })
      embeddingCredentialsRef.current!.set(selectedRepo.id, request.credential)
      const operationId = crypto.randomUUID()
      localOperationIdRef.current = operationId
      localOperationKindRef.current = "semantic"
      setLocalOperation({
        state: "refreshing",
        message:
          "Building optional semantic vectors. Keyword search remains available.",
        phase: "embedding",
        completed: 0,
        total: repositoryStatus.index.nodeCount,
        cancellable: true,
      })
      try {
        const result = await localClient().startSemanticIndexing(
          selectedRepo.id,
          {
            endpointUrl: request.endpointUrl,
            model: request.model,
            graphGeneration,
            credential:
              embeddingCredentialsRef.current!.get(selectedRepo.id) ?? "",
            consentGrantedAt,
          },
          operationId
        )
        embeddingProfilesRef.current!.save({
          repositoryId: selectedRepo.id,
          enabled: true,
          consentGrantedAt,
          endpointUrl: profile.endpointOrigin,
          model: request.model,
          ...(result.dimensions ? { dimensions: result.dimensions } : {}),
          graphGeneration,
          vectorGeneration: graphGeneration,
          coverage: { embedded: result.embedded, skipped: 0 },
          inputHashes: [],
          resume: {
            status: "complete",
            completedItems: result.embedded,
            nextBatch: result.embedded,
          },
        })
        setLocalOperation({
          state: "complete",
          message: `Semantic indexing complete for ${result.embedded.toLocaleString()} symbols. Keyword search remains available.`,
          phase: "Complete",
          completed: result.embedded,
          total: result.embedded,
          cancellable: false,
        })
      } catch (error) {
        const code =
          error instanceof RepositoryClientError ? error.code : "internal"
        setLocalOperation({
          state: code === "operation_cancelled" ? "cancelled" : "failed",
          message:
            code === "operation_cancelled"
              ? "Semantic indexing was cancelled. Keyword search remains available."
              : `${error instanceof Error ? error.message : "Semantic indexing failed."} Keyword search remains available.`,
          cancellable: false,
        })
        throw error
      } finally {
        embeddingCredentialsRef.current!.clear(selectedRepo.id)
        localOperationIdRef.current = undefined
      }
    },
    [localClient, repositoryStatus, selectedRepo]
  )

  const requestStoragePersistence = React.useCallback(async () => {
    setStorageStatus(await localClient().requestPersistentStorage())
  }, [localClient])

  const deleteLocalRepository = React.useCallback(
    async (options: { confirmationName: string; cancelActive: boolean }) => {
      if (!selectedRepo || selectedRepo.runtime !== "local") {
        throw new RepositoryClientError(
          "invalid_request",
          "Select a browser-local repository to delete.",
          false
        )
      }
      if (options.confirmationName !== selectedRepo.name) {
        throw new RepositoryClientError(
          "invalid_request",
          "Type the displayed repository name exactly.",
          false
        )
      }
      if (localOperation?.state === "refreshing" && !options.cancelActive) {
        throw new RepositoryClientError(
          "conflict",
          "Choose whether to cancel the active local operation.",
          false
        )
      }
      const repository = selectedRepo
      setLocalOperation({
        state: "deleting",
        message: `Deleting browser-owned data for ${repository.name}.`,
        cancellable: false,
      })
      let deletion
      try {
        deletion = await localClient().deleteRepository(repository.id, {
          cancelActive: options.cancelActive,
        })
      } catch (error) {
        setLocalOperation({
          state: "failed",
          message:
            error instanceof Error
              ? error.message
              : "Browser repository deletion failed; the previous readable state was retained.",
          cancellable: false,
        })
        throw error
      }

      const cleanupWarnings = [...deletion.cleanupWarnings]
      const remaining = repositories.filter(
        (candidate) => candidate.id !== repository.id
      )
      setRepositories(remaining)
      try {
        persistLocalRepositories(remaining)
      } catch {
        cleanupWarnings.push(
          "Repository-list metadata cleanup could not be completed. Clear or repair this site's local CodeGraph metadata."
        )
      }
      setSelectedRepoId(
        remaining.find((candidate) => candidate.default)?.id ??
          remaining[0]?.id
      )
      setRepositoryStatus(undefined)
      setStorageStatus(undefined)
      setLocalSourceConnection(undefined)
      try {
        embeddingProfilesRef.current?.delete(repository.id)
      } catch {
        cleanupWarnings.push(
          "Semantic-profile metadata cleanup could not be completed. Clear or repair this site's local CodeGraph metadata."
        )
      }
      embeddingCredentialsRef.current?.clear(repository.id)
      setLocalOperation({
        state: cleanupWarnings.length > 0 ? "partial-warning" : "deleted",
        message:
          cleanupWarnings.length > 0
            ? `${repository.name} browser-owned graph data was deleted. ${cleanupWarnings.join(" ")} Source folder files were not changed.`
            : `${repository.name} browser-owned data was deleted. Source folder files were not changed.`,
        cancellable: false,
      })
    },
    [localClient, localOperation?.state, repositories, selectedRepo]
  )

  React.useEffect(() => {
    void refreshRepositories()
  }, [refreshRepositories])

  React.useEffect(() => {
    let active = true
    const report =
      typeof Worker === "function"
        ? localClient().getCapabilities()
        : probeBrowserCapabilities()
    void report
      .then((report) => {
        if (active) setCapabilityReport(report)
      })
    return () => {
      active = false
    }
  }, [localClient])

  React.useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  React.useEffect(
    () => () => {
      void localClientRef.current?.close()
      localClientRef.current = undefined
    },
    []
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
      storageStatus,
      capabilityReport,
      localSourceConnection,
      openLocalFolder,
      importLocalSnapshot,
      reconnectLocalRepository,
      refreshLocalRepository,
      startSemanticIndexing,
      cancelLocalOperation,
      requestStoragePersistence,
      deleteLocalRepository,
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
      storageStatus,
      capabilityReport,
      localSourceConnection,
      openLocalFolder,
      importLocalSnapshot,
      reconnectLocalRepository,
      refreshLocalRepository,
      startSemanticIndexing,
      cancelLocalOperation,
      requestStoragePersistence,
      deleteLocalRepository,
      repositoryClient,
    ]
  )

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  )
}

export function useAppState(): AppStateValue {
  const context = React.useContext(AppStateContext)
  if (!context) {
    throw new Error("useAppState must be used within AppStateProvider")
  }
  return context
}
