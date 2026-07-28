export { default as sqlite3InitModule } from "@sqlite.org/sqlite-wasm"
import {
  BrowserStorageError,
  openBrowserGraphStore,
  type BrowserGenerationInput,
  type BrowserGraphStore,
  type BrowserStorageFaultPoint,
} from "./sqlite"
import { extractLocalSources } from "./extract"
import type { Repository } from "../lib/api/types"

export const WORKER_PROTOCOL_VERSION = 1 as const

export const WORKER_BUDGETS = {
  maxFilesPerReadBatch: 64,
  maxBytesPerReadBatch: 4 * 1024 * 1024,
  maxBytesPerWorkerPayload: 8 * 1024 * 1024,
  maxBytesPerSnapshotTransfer: 64 * 1024 * 1024,
  maxProgressEventsPerSecond: 10,
  maxEmbeddingBatchItems: 32,
  maxVectorRowsPerTransaction: 500,
} as const

type WorkerRequestKind =
  | "index"
  | "open-picked-folder"
  | "query"
  | "refresh"
  | "delete"
  | "cancel"
  | "close"
type WorkerTerminal = "complete" | "cancelled" | "failed"

export interface WorkerRequest {
  protocolVersion: number
  requestId: string
  operationId?: string
  repositoryId?: string
  kind: WorkerRequestKind
  payload?: unknown
}

export interface WorkerErrorPayload {
  code: string
  message: string
  retryable: boolean
  phase: string
}

export interface WorkerResponse {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION
  requestId: string
  operationId?: string
  repositoryId?: string
  type: "progress" | "result" | "failure"
  phase?: string
  completed?: number
  total?: number
  timestamp?: number
  terminal?: WorkerTerminal
  result?: unknown
  error?: WorkerErrorPayload
}

interface IndexRequestPayload {
  generation: BrowserGenerationInput
  grammarLoads: string[]
  workItems: number
  estimatedPayloadBytes: number
}

interface WorkerRuntimeStore {
  publishGeneration(input: BrowserGenerationInput): Promise<unknown>
  close(): unknown
}

export interface WorkerRuntimeDependencies {
  store: WorkerRuntimeStore
  loadGrammars(languages: string[]): Promise<void>
  releaseGrammars(): void
  emit(message: WorkerResponse): void
  yieldControl(): Promise<void>
}

interface ActiveOperation {
  cancelled: boolean
  terminal: boolean
  publishing: boolean
}

class OperationCancelled extends Error {}

function responseBase(request: WorkerRequest) {
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    requestId: request.requestId,
    ...(request.operationId ? { operationId: request.operationId } : {}),
    ...(request.repositoryId ? { repositoryId: request.repositoryId } : {}),
  }
}

function plainError(
  code: string,
  message: string,
  phase: string,
  retryable = false,
): WorkerErrorPayload {
  return { code, message, retryable, phase }
}

export function createWorkerRuntime(dependencies: WorkerRuntimeDependencies) {
  const active = new Map<string, ActiveOperation>()
  const completed = new Set<string>()
  const loadedGrammars = new Set<string>()

  const emit = (message: WorkerResponse) => dependencies.emit(message)

  const emitFailure = (
    request: WorkerRequest,
    operation: ActiveOperation | undefined,
    error: WorkerErrorPayload,
    terminal: WorkerTerminal = "failed",
  ) => {
    if (operation?.terminal) return
    if (operation) operation.terminal = true
    if (request.operationId) completed.add(request.operationId)
    emit({
      ...responseBase(request),
      type: "failure",
      terminal,
      error,
    })
  }

  const emitProgress = (
    request: WorkerRequest,
    phase: string,
    completedItems: number,
    total: number,
  ) => {
    emit({
      ...responseBase(request),
      type: "progress",
      phase,
      completed: completedItems,
      total,
      timestamp: Date.now(),
    })
  }

  const handleCancel = (request: WorkerRequest) => {
    const operation = request.operationId ? active.get(request.operationId) : undefined
    const cancellable = Boolean(operation && !operation.terminal && !operation.publishing)
    if (operation && cancellable) operation.cancelled = true
    emit({
      ...responseBase(request),
      type: "result",
      result: cancellable
        ? { cancelled: true, noop: false }
        : { cancelled: false, noop: true },
    })
  }

  const handleIndex = async (request: WorkerRequest) => {
    if (!request.operationId || !request.repositoryId) {
      emitFailure(
        request,
        undefined,
        plainError(
          "invalid_worker_request",
          "Index requests require operation and repository identifiers.",
          "queued",
        ),
      )
      return
    }
    if (active.has(request.operationId) || completed.has(request.operationId)) {
      emit({
        ...responseBase(request),
        type: "result",
        result: { noop: true, stale: true },
      })
      return
    }

    const payload = request.payload as Partial<IndexRequestPayload> | undefined
    const estimatedPayloadBytes = Number(payload?.estimatedPayloadBytes ?? 0)
    const workItems = Math.max(0, Number(payload?.workItems ?? 0))
    const grammarLoads = Array.isArray(payload?.grammarLoads)
      ? [...new Set(payload.grammarLoads.filter((value): value is string => typeof value === "string"))]
      : []
    const operation: ActiveOperation = { cancelled: false, terminal: false, publishing: false }
    active.set(request.operationId, operation)

    if (
      !Number.isFinite(estimatedPayloadBytes) ||
      estimatedPayloadBytes < 0 ||
      estimatedPayloadBytes > WORKER_BUDGETS.maxBytesPerWorkerPayload
    ) {
      emitFailure(
        request,
        operation,
        plainError(
          "worker_payload_too_large",
          "The local indexing request exceeds the worker payload budget.",
          "queued",
        ),
      )
      active.delete(request.operationId)
      return
    }

    try {
      emitProgress(request, "queued", 0, workItems)
      const missingGrammars = grammarLoads.filter((language) => !loadedGrammars.has(language))
      if (missingGrammars.length > 0) {
        emitProgress(request, "grammar-load", 0, missingGrammars.length)
        await dependencies.loadGrammars(missingGrammars)
        for (const language of missingGrammars) loadedGrammars.add(language)
      }

      const batchSize = WORKER_BUDGETS.maxFilesPerReadBatch
      for (let offset = 0; offset < workItems; offset += batchSize) {
        if (operation.cancelled) throw new OperationCancelled()
        if (offset === 0 || offset + batchSize >= workItems) {
          emitProgress(request, "parse", Math.min(offset + batchSize, workItems), workItems)
        }
        await dependencies.yieldControl()
      }
      if (operation.cancelled) throw new OperationCancelled()

      emitProgress(request, "store", workItems, workItems)
      await dependencies.yieldControl()
      if (operation.cancelled) throw new OperationCancelled()

      emitProgress(request, "publish", workItems, workItems)
      operation.publishing = true
      const result = await dependencies.store.publishGeneration(
        payload?.generation as BrowserGenerationInput,
      )
      operation.terminal = true
      completed.add(request.operationId)
      emit({
        ...responseBase(request),
        type: "result",
        terminal: "complete",
        result,
      })
    } catch (error) {
      if (error instanceof OperationCancelled) {
        emitFailure(
          request,
          operation,
          plainError(
            "operation_cancelled",
            "The local indexing operation was cancelled.",
            "cancelled",
          ),
          "cancelled",
        )
      } else {
        emitFailure(
          request,
          operation,
          plainError(
            "worker_operation_failed",
            "The local indexing operation failed.",
            "failed",
            true,
          ),
        )
      }
    } finally {
      active.delete(request.operationId)
    }
  }

  return {
    async handle(request: WorkerRequest) {
      if (request.protocolVersion !== WORKER_PROTOCOL_VERSION) {
        emitFailure(
          request,
          undefined,
          plainError(
            "unsupported_protocol",
            `Worker protocol ${request.protocolVersion} is not supported.`,
            "queued",
          ),
        )
        return
      }
      if (request.kind === "cancel") {
        handleCancel(request)
        return
      }
      if (request.kind === "close") {
        for (const operation of active.values()) operation.cancelled = true
        dependencies.releaseGrammars()
        emit({
          ...responseBase(request),
          type: "result",
          terminal: "complete",
          result: dependencies.store.close(),
        })
        return
      }
      await handleIndex(request)
    },
  }
}

interface StorageTestRequest {
  requestId: string
  kind: string
  payload?: Record<string, unknown>
}

let storage: BrowserGraphStore | undefined
let storageOpening: Promise<BrowserGraphStore> | undefined
let requestedFault: string | undefined
const activePickedFolders = new Map<
  string,
  { cancelled: boolean; publishing: boolean }
>()
const repositoryMetadata = new Map<
  string,
  Pick<Repository, "name" | "sourceKind">
>()

class PickedFolderCancelled extends Error {}

function throwIfPickedFolderCancelled(operation: {
  cancelled: boolean
  publishing: boolean
}) {
  if (operation.cancelled) throw new PickedFolderCancelled()
}

function yieldForActionableProgress() {
  return new Promise<void>((resolve) => setTimeout(resolve, 100))
}

function emitRepositoryResponse(
  request: WorkerRequest,
  response: Omit<WorkerResponse, keyof ReturnType<typeof responseBase>>,
) {
  globalThis.postMessage({
    ...responseBase(request),
    ...response,
  })
}

async function ensureRepositoryStorage() {
  if (storage) return storage
  storageOpening ??= openBrowserGraphStore({
    poolName: "codegraph-local",
    clearOnInit: false,
  })
  try {
    storage = await storageOpening
    return storage
  } finally {
    storageOpening = undefined
  }
}

interface PickedFolderPayload {
  identity?: {
    id?: string
    displayName?: string
    virtualRoot?: string
  }
  collection?: {
    entries?: Array<{
      kind?: string
      path?: string
      bytes?: Uint8Array
      contentHash?: string
      size?: number
      mtimeHint?: number
    }>
    manifest?: {
      entries?: unknown[]
      fingerprint?: string
    }
    warnings?: {
      details?: unknown[]
      total?: number
      truncated?: boolean
    }
  }
}

async function handleOpenPickedFolder(request: WorkerRequest) {
  const operationId = request.operationId
  const repositoryId = request.repositoryId
  const payload = request.payload as PickedFolderPayload | undefined
  const identity = payload?.identity
  const collection = payload?.collection
  if (
    !operationId ||
    !repositoryId ||
    identity?.id !== repositoryId ||
    !Array.isArray(collection?.entries) ||
    typeof collection.manifest?.fingerprint !== "string"
  ) {
    emitRepositoryResponse(request, {
      type: "failure",
      terminal: "failed",
      error: plainError(
        "invalid_worker_request",
        "The picked-folder request is incomplete.",
        "queued",
      ),
    })
    return
  }

  if (activePickedFolders.has(operationId)) {
    emitRepositoryResponse(request, {
      type: "result",
      result: { noop: true, stale: true },
    })
    return
  }
  const operation = { cancelled: false, publishing: false }
  activePickedFolders.set(operationId, operation)

  try {
    emitRepositoryResponse(request, {
      type: "progress",
      phase: "read",
      completed: collection.entries.length,
      total: collection.entries.length,
      timestamp: Date.now(),
    })
    await yieldForActionableProgress()
    throwIfPickedFolderCancelled(operation)
    const store = await ensureRepositoryStorage()
    emitRepositoryResponse(request, {
      type: "progress",
      phase: "grammar-load",
      completed: 0,
      total: 1,
      timestamp: Date.now(),
    })
    const extraction = await extractLocalSources(
      collection.entries.map((entry) => ({
        kind: entry.kind === "file" ? "file" : "directory",
        path: String(entry.path ?? ""),
        bytes:
          entry.bytes instanceof Uint8Array
            ? entry.bytes
            : new Uint8Array(),
      })),
    )
    throwIfPickedFolderCancelled(operation)
    emitRepositoryResponse(request, {
      type: "progress",
      phase: "parse",
      completed: extraction.acceptedManifest.length,
      total: extraction.acceptedManifest.length,
      timestamp: Date.now(),
    })
    const sourceByPath = new Map(
      collection.entries.map((entry) => [String(entry.path), entry]),
    )
    const providerWarnings = collection.warnings?.details ?? []
    const warnings = [...providerWarnings, ...extraction.warnings]
    const generation: BrowserGenerationInput = {
      repositoryId,
      manifestFingerprint: collection.manifest.fingerprint,
      manifest: collection.manifest.entries ?? [],
      counts: {
        files: extraction.acceptedManifest.length,
        nodes: extraction.nodes.length,
        edges: extraction.edges.length,
        warnings: warnings.length,
      },
      warnings,
      sources: extraction.acceptedManifest.map((entry) => {
        const source = sourceByPath.get(entry.path)
        const bytes =
          source?.bytes instanceof Uint8Array
            ? source.bytes
            : new Uint8Array()
        return {
          path: entry.path,
          contentHash: source?.contentHash ?? entry.contentHash,
          language: entry.language,
          size: bytes.byteLength,
          ...(source?.mtimeHint === undefined
            ? {}
            : { mtimeHint: source.mtimeHint }),
          text: new TextDecoder().decode(bytes),
        }
      }),
      nodes: extraction.nodes,
      edges: extraction.edges,
    }
    throwIfPickedFolderCancelled(operation)
    operation.publishing = true
    emitRepositoryResponse(request, {
      type: "progress",
      phase: "publish",
      completed: extraction.acceptedManifest.length,
      total: extraction.acceptedManifest.length,
      timestamp: Date.now(),
    })
    await store.publishGeneration(generation)
    const repository: Repository = {
      id: repositoryId,
      root: identity.virtualRoot ?? `local://${repositoryId}`,
      name: identity.displayName ?? "Browser repository",
      default: false,
      runtime: "local",
      sourceKind: "picked-folder",
    }
    repositoryMetadata.set(repositoryId, {
      name: repository.name,
      sourceKind: repository.sourceKind,
    })
    emitRepositoryResponse(request, {
      type: "result",
      terminal: "complete",
      result: repository,
    })
  } catch (error) {
    const cancelled = error instanceof PickedFolderCancelled
    emitRepositoryResponse(request, {
      type: "failure",
      terminal: cancelled ? "cancelled" : "failed",
      error: plainError(
        cancelled
          ? "operation_cancelled"
          : error instanceof BrowserStorageError
            ? error.code
            : "worker_operation_failed",
        cancelled
          ? "The browser-local indexing operation was cancelled."
          : error instanceof BrowserStorageError
          ? error.message
          : "The browser-local indexing operation failed.",
        cancelled ? "cancelled" : "failed",
        !cancelled,
      ),
    })
  } finally {
    activePickedFolders.delete(operationId)
  }
}

function handlePickedFolderCancel(request: WorkerRequest) {
  const operation = request.operationId
    ? activePickedFolders.get(request.operationId)
    : undefined
  const cancellable = Boolean(operation && !operation.publishing)
  if (operation && cancellable) operation.cancelled = true
  emitRepositoryResponse(request, {
    type: "result",
    result: {
      cancelled: cancellable,
      noop: !cancellable,
    },
  })
}

async function handleRepositoryQuery(request: WorkerRequest) {
  const payload = request.payload as
    | {
        query?: string
        request?: {
          query?: string
          nodeId?: string
          limit?: number
          offset?: number
        }
      }
    | undefined
  try {
    const store = await ensureRepositoryStorage()
    const query = payload?.query
    const repositoryId = request.repositoryId
    let result: unknown
    if (query === "list-repositories") {
      result = store.listRepositories(repositoryMetadata)
    } else {
      if (!repositoryId) {
        throw new BrowserStorageError(
          "invalid_repository_id",
          "A browser-local query requires a repository id.",
        )
      }
      const queryRequest = payload?.request ?? {}
      switch (query) {
        case "repository-status":
          result = store.getRepositoryStatus(
            repositoryId,
            repositoryMetadata.get(repositoryId)?.name,
          )
          break
        case "search":
          result = store.search(
            repositoryId,
            String(queryRequest.query ?? ""),
            queryRequest.limit,
            queryRequest.offset,
          )
          break
        case "node":
          result = store.getNode(repositoryId, String(queryRequest.nodeId ?? ""))
          break
        case "source":
          result = store.getSource(repositoryId, String(queryRequest.nodeId ?? ""))
          break
        case "callers":
        case "callees":
          result = store.relationships(
            repositoryId,
            String(queryRequest.nodeId ?? ""),
            query,
            queryRequest.limit,
            queryRequest.offset,
          )
          break
        case "graph":
        case "impact":
          result = store.graph(repositoryId, String(queryRequest.nodeId ?? ""))
          break
        default:
          throw new BrowserStorageError(
            "invalid_generation",
            "The browser-local query is not supported.",
          )
      }
    }
    emitRepositoryResponse(request, {
      type: "result",
      terminal: "complete",
      result,
    })
  } catch (error) {
    emitRepositoryResponse(request, {
      type: "failure",
      terminal: "failed",
      error: plainError(
        error instanceof BrowserStorageError ? error.code : "worker_query_failed",
        error instanceof BrowserStorageError
          ? error.message
          : "The browser-local query failed.",
        "query",
      ),
    })
  }
}

const protocolRuntime = createWorkerRuntime({
  store: {
    async publishGeneration(input) {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.publishGeneration(input)
    },
    close() {
      const result = storage?.close() ?? { paused: true }
      storage = undefined
      return result
    },
  },
  loadGrammars: async () => undefined,
  releaseGrammars: () => undefined,
  emit: (message) => globalThis.postMessage(message),
  yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
})

function faultInjector(point: BrowserStorageFaultPoint) {
  if (requestedFault === "quota-before-publication" && point === "before-publication") {
    throw new BrowserStorageError("quota_exceeded", "Injected browser storage quota failure.")
  }
}

function requestPayload(request: StorageTestRequest) {
  return request.payload ?? {}
}

async function handleStorageTestRequest(request: StorageTestRequest) {
  const payload = requestPayload(request)
  switch (request.kind) {
    case "storage-open": {
      storage = await openBrowserGraphStore({
        poolName: String(payload.poolName),
        clearOnInit: Boolean(payload.clearOnInit),
        faultInjector,
      })
      return { opened: true }
    }
    case "storage-publish": {
      if (!storage) throw new Error("Browser graph store is not open.")
      requestedFault = typeof payload.fault === "string" ? payload.fault : undefined
      try {
        return await storage.publishGeneration(payload.generation as unknown as BrowserGenerationInput)
      } finally {
        requestedFault = undefined
      }
    }
    case "storage-leave-staging": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.stageGeneration(payload.generation as unknown as BrowserGenerationInput)
    }
    case "storage-current": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.readCurrent(String(payload.repositoryId))
    }
    case "storage-statuses": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.listGenerationStatuses(String(payload.repositoryId))
    }
    case "storage-close": {
      if (!storage) return { paused: true }
      const result = storage.close()
      storage = undefined
      return result
    }
    default:
      throw new Error(`Unsupported storage test request: ${request.kind}`)
  }
}

globalThis.addEventListener("message", (event: MessageEvent<StorageTestRequest>) => {
  const request = event.data
  if (!request || typeof request.requestId !== "string") {
    return
  }
  if (!request.kind.startsWith("storage-")) {
    const protocolRequest = request as unknown as WorkerRequest
    if (typeof protocolRequest.protocolVersion === "number") {
      if (protocolRequest.kind === "open-picked-folder") {
        void handleOpenPickedFolder(protocolRequest)
      } else if (protocolRequest.kind === "query") {
        void handleRepositoryQuery(protocolRequest)
      } else if (
        protocolRequest.kind === "cancel" &&
        protocolRequest.operationId &&
        activePickedFolders.has(protocolRequest.operationId)
      ) {
        handlePickedFolderCancel(protocolRequest)
      } else {
        void protocolRuntime.handle(protocolRequest)
      }
    }
    return
  }
  void handleStorageTestRequest(request).then(
    (result) => globalThis.postMessage({ requestId: request.requestId, ok: true, result }),
    (error: unknown) => {
      const code =
        error instanceof BrowserStorageError
          ? error.code
          : "storage_worker_failed"
      const message = error instanceof Error ? error.message : "Browser storage worker failed."
      globalThis.postMessage({
        requestId: request.requestId,
        ok: false,
        error: { code, message: message.slice(0, 240) },
      })
    },
  )
})
