export { default as sqlite3InitModule } from "@sqlite.org/sqlite-wasm"
import {
  BrowserStorageError,
  openBrowserGraphStore,
  type BrowserGenerationInput,
  type BrowserGraphStore,
  type BrowserStorageFaultPoint,
  type StagedBrowserGeneration,
} from "./sqlite"
import { extractLocalSources } from "./extract"
import type { Repository } from "../lib/api/types"
import {
  createSourceManifest,
  DEFAULT_SOURCE_LIMITS,
  diffSourceManifests,
  type SourceManifest,
} from "./source"
import {
  probeWorkerRuntimeCapabilities,
  type WorkerRuntimeCapabilityReport,
} from "./capabilities"
import {
  composeBrowserEmbeddingInput,
  EmbeddingOperationError,
  EmbeddingPolicyError,
  hashEmbeddingInput,
  mapEmbeddingFailure,
  requestEmbeddingBatch,
  validateEmbeddingBatch,
  validateEmbeddingEndpoint,
  validateEmbeddingResume,
  type EmbeddingBatchResult,
  type EmbeddingInputItem,
  type EmbeddingOperationResume,
  type EmbeddingSemanticState,
  type EmbeddingVectorRow,
} from "./embeddings"

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
  | "capabilities"
  | "index"
  | "embed"
  | "acquire"
  | "source-batch"
  | "open-picked-folder"
  | "import-snapshot"
  | "query"
  | "refresh"
  | "delete"
  | "cancel"
  | "close"
type WorkerTerminal = "complete" | "cancelled" | "failed"

interface WorkerRequestBase {
  protocolVersion: number
  requestId: string
}

interface WorkerRequestEnvelope extends WorkerRequestBase {
  operationId?: string
  repositoryId?: string
  kind: string
  payload?: unknown
}

type RepositoryQueryPayload = {
  query: string
  request?: object
}

export type WorkerRequest =
  | (WorkerRequestBase & {
      kind: "capabilities" | "close"
      operationId?: never
      repositoryId?: never
      payload?: never
    })
  | (WorkerRequestBase & {
      kind: "cancel"
      operationId: string
      repositoryId?: string
      payload?: never
    })
  | (WorkerRequestBase & {
      kind: "acquire"
      operationId?: never
      repositoryId: string
      payload?: never
    })
  | (WorkerRequestBase & {
      kind: "index"
      operationId: string
      repositoryId: string
      payload: IndexRequestPayload
    })
  | (WorkerRequestBase & {
      kind: "embed"
      operationId: string
      repositoryId: string
      payload: EmbedRequestPayload
    })
  | (WorkerRequestBase & {
      kind:
        | "source-batch"
        | "open-picked-folder"
        | "import-snapshot"
        | "refresh"
      operationId: string
      repositoryId: string
      payload: object
    })
  | (WorkerRequestBase & {
      kind: "query"
      operationId?: string
      repositoryId?: string
      payload: RepositoryQueryPayload
    })
  | (WorkerRequestBase & {
      kind: "delete"
      operationId?: never
      repositoryId: string
      payload: { cancelActive?: boolean }
    })

export interface WorkerErrorPayload {
  code: string
  message: string
  retryable: boolean
  phase: string
}

interface WorkerResponseBase {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION
  requestId: string
  operationId?: string
  repositoryId?: string
}

export type WorkerResponseBody =
  | {
      type: "progress"
      phase: string
      completed: number
      total: number
      timestamp: number
    }
  | {
      type: "result"
      terminal: "complete"
      result: unknown
    }
  | {
      type: "failure"
      terminal: "cancelled" | "failed"
      error: WorkerErrorPayload
    }

export type WorkerResponse = WorkerResponseBase & WorkerResponseBody

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!isRecord(value)) return false
  if (
    typeof value.protocolVersion !== "number" ||
    typeof value.requestId !== "string" ||
    typeof value.kind !== "string"
  ) {
    return false
  }
  const operationId = value.operationId
  const repositoryId = value.repositoryId
  const hasOperation = typeof operationId === "string" && operationId.length > 0
  const hasRepository =
    typeof repositoryId === "string" && repositoryId.length > 0
  switch (value.kind as WorkerRequestKind) {
    case "capabilities":
    case "close":
      return (
        operationId === undefined &&
        repositoryId === undefined &&
        value.payload === undefined
      )
    case "cancel":
      return (
        hasOperation &&
        (repositoryId === undefined || hasRepository) &&
        value.payload === undefined
      )
    case "acquire":
      return (
        operationId === undefined &&
        hasRepository &&
        value.payload === undefined
      )
    case "index":
    case "embed":
    case "source-batch":
    case "open-picked-folder":
    case "import-snapshot":
    case "refresh":
      return hasOperation && hasRepository && isRecord(value.payload)
    case "query":
      return (
        (operationId === undefined || hasOperation) &&
        (repositoryId === undefined || hasRepository) &&
        isRecord(value.payload) &&
        typeof value.payload.query === "string"
      )
    case "delete":
      return (
        operationId === undefined &&
        hasRepository &&
        isRecord(value.payload) &&
        (value.payload.cancelActive === undefined ||
          typeof value.payload.cancelActive === "boolean")
      )
    default:
      return false
  }
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!isRecord(value)) return false
  if (
    value.protocolVersion !== WORKER_PROTOCOL_VERSION ||
    typeof value.requestId !== "string"
  ) {
    return false
  }
  if (value.type === "progress") {
    return (
      typeof value.phase === "string" &&
      typeof value.completed === "number" &&
      Number.isFinite(value.completed) &&
      typeof value.total === "number" &&
      Number.isFinite(value.total) &&
      typeof value.timestamp === "number" &&
      Number.isFinite(value.timestamp)
    )
  }
  if (value.type === "result") {
    return value.terminal === "complete" && "result" in value
  }
  if (value.type !== "failure") return false
  if (
    (value.terminal !== "failed" && value.terminal !== "cancelled") ||
    !isRecord(value.error)
  ) {
    return false
  }
  return (
    typeof value.error.code === "string" &&
    typeof value.error.message === "string" &&
    typeof value.error.retryable === "boolean" &&
    typeof value.error.phase === "string"
  )
}

interface IndexRequestPayload {
  generation: BrowserGenerationInput
  grammarLoads: string[]
  workItems: number
  estimatedPayloadBytes: number
}

interface EmbedRequestPayload {
  endpointUrl: string
  model: string
  dimensions?: number
  graphGeneration: number
  credential: string
  consentGrantedAt: string
  endpointBatchSize?: number
  vectorWriteBatchSize?: number
  resume?: EmbeddingOperationResume
}

interface WorkerRuntimeStore {
  publishGeneration(input: BrowserGenerationInput): Promise<unknown>
  close(): unknown
}

export interface WorkerEmbeddingDependencies {
  getPublishedGeneration(repositoryId: string): number | Promise<number>
  loadInputs(
    repositoryId: string,
    graphGeneration: number
  ): EmbeddingInputItem[] | Promise<EmbeddingInputItem[]>
  requestBatch(request: {
    endpointUrl: string
    model: string
    credential: string
    items: EmbeddingInputItem[]
  }): Promise<EmbeddingBatchResult>
  writeVectors(
    repositoryId: string,
    graphGeneration: number,
    rows: EmbeddingVectorRow[]
  ): void | Promise<void>
  saveState(
    repositoryId: string,
    state: EmbeddingSemanticState
  ): void | Promise<void>
}

export interface WorkerRuntimeDependencies {
  store: WorkerRuntimeStore
  embedding?: WorkerEmbeddingDependencies
  loadGrammars(languages: string[]): Promise<void>
  releaseGrammars(): void
  getCapabilities?: () => Promise<WorkerRuntimeCapabilityReport>
  emit(message: WorkerResponse): void
  yieldControl(): Promise<void>
}

interface ActiveOperation {
  cancelled: boolean
  terminal: boolean
  publishing: boolean
}

class OperationCancelled extends Error {}

function responseBase(request: WorkerRequestEnvelope) {
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
  retryable = false
): WorkerErrorPayload {
  return { code, message, retryable, phase }
}

export function createWorkerRuntime(dependencies: WorkerRuntimeDependencies) {
  const active = new Map<string, ActiveOperation>()
  const completed = new Set<string>()
  const loadedGrammars = new Set<string>()

  const emit = (message: WorkerResponse) => dependencies.emit(message)

  const emitFailure = (
    request: WorkerRequestEnvelope,
    operation: ActiveOperation | undefined,
    error: WorkerErrorPayload,
    terminal: Exclude<WorkerTerminal, "complete"> = "failed"
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
    total: number
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
    const operation = request.operationId
      ? active.get(request.operationId)
      : undefined
    const cancellable = Boolean(
      operation && !operation.terminal && !operation.publishing
    )
    if (operation && cancellable) operation.cancelled = true
    emit({
      ...responseBase(request),
      type: "result",
      terminal: "complete",
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
          "queued"
        )
      )
      return
    }
    if (active.has(request.operationId) || completed.has(request.operationId)) {
      emit({
        ...responseBase(request),
        type: "result",
        terminal: "complete",
        result: { noop: true, stale: true },
      })
      return
    }

    const payload = request.payload as Partial<IndexRequestPayload> | undefined
    const estimatedPayloadBytes = Number(payload?.estimatedPayloadBytes ?? 0)
    const workItems = Math.max(0, Number(payload?.workItems ?? 0))
    const grammarLoads = Array.isArray(payload?.grammarLoads)
      ? [
          ...new Set(
            payload.grammarLoads.filter(
              (value): value is string => typeof value === "string"
            )
          ),
        ]
      : []
    const operation: ActiveOperation = {
      cancelled: false,
      terminal: false,
      publishing: false,
    }
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
          "queued"
        )
      )
      active.delete(request.operationId)
      return
    }

    try {
      emitProgress(request, "queued", 0, workItems)
      const missingGrammars = grammarLoads.filter(
        (language) => !loadedGrammars.has(language)
      )
      if (missingGrammars.length > 0) {
        emitProgress(request, "grammar-load", 0, missingGrammars.length)
        await dependencies.loadGrammars(missingGrammars)
        for (const language of missingGrammars) loadedGrammars.add(language)
      }

      const batchSize = WORKER_BUDGETS.maxFilesPerReadBatch
      for (let offset = 0; offset < workItems; offset += batchSize) {
        if (operation.cancelled) throw new OperationCancelled()
        if (offset === 0 || offset + batchSize >= workItems) {
          emitProgress(
            request,
            "parse",
            Math.min(offset + batchSize, workItems),
            workItems
          )
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
        payload?.generation as BrowserGenerationInput
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
            "cancelled"
          ),
          "cancelled"
        )
      } else {
        emitFailure(
          request,
          operation,
          plainError(
            "worker_operation_failed",
            "The local indexing operation failed.",
            "failed",
            true
          )
        )
      }
    } finally {
      active.delete(request.operationId)
    }
  }

  const handleEmbed = async (request: WorkerRequest) => {
    if (!request.operationId || !request.repositoryId) {
      emitFailure(
        request,
        undefined,
        plainError(
          "invalid_worker_request",
          "Embedding requests require operation and repository identifiers.",
          "embedding"
        )
      )
      return
    }
    if (active.has(request.operationId) || completed.has(request.operationId)) {
      emit({
        ...responseBase(request),
        type: "result",
        terminal: "complete",
        result: { noop: true, stale: true },
      })
      return
    }
    if (!dependencies.embedding) {
      emitFailure(
        request,
        undefined,
        plainError(
          "capability_unavailable",
          "Semantic indexing is unavailable in this worker.",
          "embedding"
        )
      )
      return
    }

    const payload = request.payload as Partial<EmbedRequestPayload> | undefined
    const endpointBatchSize = Number(
      payload?.endpointBatchSize ?? WORKER_BUDGETS.maxEmbeddingBatchItems
    )
    const vectorWriteBatchSize = Number(
      payload?.vectorWriteBatchSize ??
        WORKER_BUDGETS.maxVectorRowsPerTransaction
    )
    const graphGeneration = Number(payload?.graphGeneration)
    const dimensions =
      payload?.dimensions === undefined ? undefined : Number(payload.dimensions)
    const operation: ActiveOperation = {
      cancelled: false,
      terminal: false,
      publishing: false,
    }
    active.set(request.operationId, operation)

    const state = (
      status: EmbeddingSemanticState["status"],
      completedItems: number,
      inputHashes: string[],
      failureCode?: string,
      resolvedDimensions = dimensions
    ): EmbeddingSemanticState => ({
      status,
      graphGeneration,
      model: String(payload?.model ?? ""),
      ...(resolvedDimensions ? { dimensions: resolvedDimensions } : {}),
      completedItems,
      inputHashes,
      ...(failureCode ? { failureCode } : {}),
    })

    let completedItems = 0
    let completedHashes: string[] = []
    let resolvedDimensions = dimensions
    try {
      if (
        !Number.isSafeInteger(endpointBatchSize) ||
        endpointBatchSize <= 0 ||
        endpointBatchSize > WORKER_BUDGETS.maxEmbeddingBatchItems ||
        !Number.isSafeInteger(vectorWriteBatchSize) ||
        vectorWriteBatchSize <= 0 ||
        vectorWriteBatchSize > WORKER_BUDGETS.maxVectorRowsPerTransaction
      ) {
        throw new EmbeddingOperationError({
          code: "embedding_budget_exceeded",
          message:
            "The semantic indexing request exceeds a declared batch budget.",
          retryable: false,
          phase: "embedding",
          guidance: "Use the shipped endpoint and vector batch ceilings.",
        })
      }
      if (!Number.isSafeInteger(graphGeneration) || graphGeneration <= 0) {
        throw new EmbeddingOperationError({
          code: "semantic_stale",
          message: "The semantic graph generation is invalid.",
          retryable: false,
          phase: "embedding",
          guidance: "Restart semantic indexing from the published graph.",
        })
      }
      if (
        dimensions !== undefined &&
        (!Number.isSafeInteger(dimensions) || dimensions <= 0)
      ) {
        throw new EmbeddingOperationError(
          mapEmbeddingFailure({ kind: "dimensions" })
        )
      }
      const consentGrantedAt = new Date(String(payload?.consentGrantedAt ?? ""))
      if (!Number.isFinite(consentGrantedAt.getTime())) {
        throw new EmbeddingOperationError({
          code: "consent_required",
          message: "Semantic indexing requires explicit consent.",
          retryable: false,
          phase: "embedding",
          guidance:
            "Confirm semantic indexing and re-enter the page-session credential.",
        })
      }
      const endpointUrl = validateEmbeddingEndpoint(
        String(payload?.endpointUrl ?? "")
      )
      const model = String(payload?.model ?? "")
      const credential = String(payload?.credential ?? "")
      if (!model || !credential) {
        throw new EmbeddingOperationError(
          mapEmbeddingFailure(
            credential ? { kind: "model" } : { kind: "http", status: 401 }
          )
        )
      }
      const publishedGeneration =
        await dependencies.embedding.getPublishedGeneration(
          request.repositoryId
        )
      if (publishedGeneration !== graphGeneration) {
        throw new EmbeddingOperationError({
          code: "semantic_stale",
          message: "The semantic operation does not match the published graph.",
          retryable: false,
          phase: "embedding",
          guidance:
            "Restart semantic indexing for the current graph generation.",
        })
      }
      const items = await dependencies.embedding.loadInputs(
        request.repositoryId,
        graphGeneration
      )
      completedItems = validateEmbeddingResume(
        payload?.resume,
        { graphGeneration, model, dimensions },
        items
      )
      completedHashes = items
        .slice(0, completedItems)
        .map((item) => item.inputHash)
      await dependencies.embedding.saveState(
        request.repositoryId,
        state("active", completedItems, completedHashes)
      )

      emitProgress(request, "embedding", completedItems, items.length)
      for (
        let offset = completedItems;
        offset < items.length;
        offset += endpointBatchSize
      ) {
        if (operation.cancelled) throw new OperationCancelled()
        const batch = items.slice(offset, offset + endpointBatchSize)
        const result = await dependencies.embedding.requestBatch({
          endpointUrl,
          model,
          credential,
          items: batch,
        })
        if (operation.cancelled) throw new OperationCancelled()
        const rows = validateEmbeddingBatch(batch, result, {
          model,
          dimensions: resolvedDimensions,
        })
        resolvedDimensions ??= result.dimensions
        for (
          let writeOffset = 0;
          writeOffset < rows.length;
          writeOffset += vectorWriteBatchSize
        ) {
          if (operation.cancelled) throw new OperationCancelled()
          await dependencies.embedding.writeVectors(
            request.repositoryId,
            graphGeneration,
            rows.slice(writeOffset, writeOffset + vectorWriteBatchSize)
          )
        }
        completedItems += batch.length
        completedHashes.push(...batch.map((item) => item.inputHash))
        emitProgress(request, "embedding", completedItems, items.length)
        await dependencies.yieldControl()
      }

      const completeState = state(
        "complete",
        completedItems,
        completedHashes,
        undefined,
        resolvedDimensions
      )
      await dependencies.embedding.saveState(
        request.repositoryId,
        completeState
      )
      operation.terminal = true
      completed.add(request.operationId)
      emit({
        ...responseBase(request),
        type: "result",
        terminal: "complete",
        result: {
          status: "complete",
          graphGeneration,
          embedded: completedItems,
          dimensions: resolvedDimensions,
        },
      })
    } catch (error) {
      const cancelled = error instanceof OperationCancelled
      const envelope =
        error instanceof EmbeddingOperationError ||
        error instanceof EmbeddingPolicyError
          ? error.toEnvelope()
          : mapEmbeddingFailure({ kind: "unavailable" })
      const failureState = state(
        cancelled
          ? "paused"
          : envelope.code === "semantic_stale"
            ? "stale"
            : "unavailable",
        completedItems,
        completedHashes,
        cancelled ? "operation_cancelled" : envelope.code,
        resolvedDimensions
      )
      try {
        await dependencies.embedding.saveState(
          request.repositoryId,
          failureState
        )
      } catch {
        // The stable worker failure remains authoritative if advisory state save fails.
      }
      emitFailure(
        request,
        operation,
        cancelled
          ? plainError(
              "operation_cancelled",
              "The semantic indexing operation was cancelled.",
              "embedding"
            )
          : {
              code: envelope.code,
              message: envelope.message,
              retryable: envelope.retryable,
              phase: envelope.phase,
            },
        cancelled ? "cancelled" : "failed"
      )
    } finally {
      active.delete(request.operationId)
    }
  }

  return {
    async handle(candidate: WorkerRequestEnvelope) {
      const request = candidate
      if (request.protocolVersion !== WORKER_PROTOCOL_VERSION) {
        emitFailure(
          request,
          undefined,
          plainError(
            "unsupported_protocol",
            `Worker protocol ${request.protocolVersion} is not supported.`,
            "queued"
          )
        )
        return
      }
      if (!isWorkerRequest(request)) {
        emitFailure(
          request,
          undefined,
          plainError(
            "invalid_worker_request",
            "The worker request does not match its declared operation.",
            "queued"
          )
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
      if (request.kind === "capabilities") {
        if (!dependencies.getCapabilities) {
          emitFailure(
            request,
            undefined,
            plainError(
              "capability_unavailable",
              "The worker capability probe is unavailable.",
              "capability-check"
            )
          )
          return
        }
        try {
          emit({
            ...responseBase(request),
            type: "result",
            terminal: "complete",
            result: await dependencies.getCapabilities(),
          })
        } catch {
          emitFailure(
            request,
            undefined,
            plainError(
              "capability_unavailable",
              "The worker capability probe failed.",
              "capability-check",
              true
            )
          )
        }
        return
      }
      if (request.kind === "embed") {
        await handleEmbed(request)
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
  { cancelled: boolean; publishing: boolean; repositoryId: string }
>()
interface StagedSourceEntry {
  kind?: string
  path?: string
  bytes?: Uint8Array
  contentHash?: string
  size?: number
  mtimeHint?: number
}
interface StagedSourceCollection {
  repositoryId: string
  sourceKind: Repository["sourceKind"]
  batchCount: number
  totalFiles: number
  totalBytes: number
  nextBatch: number
  receivedBytes: number
  entries: StagedSourceEntry[]
  paths: Set<string>
}
const stagedSourceCollections = new Map<string, StagedSourceCollection>()
const repositoryMetadata = new Map<
  string,
  Pick<Repository, "name" | "sourceKind">
>()
interface HeldRepositoryLock {
  release(): void
  settled: Promise<void>
}
interface RepositoryLockManager {
  request(
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: object | null) => Promise<void>
  ): Promise<void>
}
const heldRepositoryLocks = new Map<string, HeldRepositoryLock>()
const openingRepositoryLocks = new Map<string, Promise<void>>()

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
  response: WorkerResponseBody
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

async function acquireRepositoryOwnership(repositoryId: string) {
  if (heldRepositoryLocks.has(repositoryId)) return
  const opening = openingRepositoryLocks.get(repositoryId)
  if (opening) return opening

  const acquisition = (async () => {
    const locks = (
      globalThis.navigator as typeof globalThis.navigator & {
        locks?: RepositoryLockManager
      }
    ).locks
    if (!locks) {
      throw new BrowserStorageError(
        "repository_busy",
        "This browser cannot acquire exclusive ownership of the local repository."
      )
    }

    let signalAcquired!: (lock: object | null) => void
    let signalFailed!: (error: unknown) => void
    const acquired = new Promise<object | null>((resolve, reject) => {
      signalAcquired = resolve
      signalFailed = reject
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const settled = locks
      .request(
        `codegraph:local-repository:${repositoryId}`,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          signalAcquired(lock)
          if (lock) await released
        }
      )
      .catch((error: unknown) => {
        signalFailed(error)
        throw error
      })
    const lock = await acquired
    if (!lock) {
      await settled
      throw new BrowserStorageError(
        "repository_busy",
        "This local repository is open in another browser tab."
      )
    }
    heldRepositoryLocks.set(repositoryId, { release, settled })
  })()

  openingRepositoryLocks.set(repositoryId, acquisition)
  try {
    await acquisition
  } finally {
    openingRepositoryLocks.delete(repositoryId)
  }
}

async function closeRepositoryStorageAndRelease() {
  let result: unknown = { paused: true }
  let closeError: unknown
  try {
    result = storage?.close() ?? result
    storage = undefined
  } catch (error) {
    closeError = error
  } finally {
    const ownerships = [...heldRepositoryLocks.values()]
    heldRepositoryLocks.clear()
    for (const ownership of ownerships) ownership.release()
    await Promise.allSettled(ownerships.map((ownership) => ownership.settled))
  }
  if (closeError) throw closeError
  return result
}

async function handleRepositoryAcquire(request: WorkerRequest) {
  const repositoryId = request.repositoryId
  if (!repositoryId) {
    emitRepositoryResponse(request, {
      type: "failure",
      terminal: "failed",
      error: plainError(
        "invalid_repository_id",
        "Repository ownership requires a repository id.",
        "acquire"
      ),
    })
    return
  }
  try {
    await acquireRepositoryOwnership(repositoryId)
    await ensureRepositoryStorage()
    emitRepositoryResponse(request, {
      type: "result",
      terminal: "complete",
      result: { repositoryId, acquired: true },
    })
  } catch (error) {
    emitRepositoryResponse(request, {
      type: "failure",
      terminal: "failed",
      error: plainError(
        error instanceof BrowserStorageError
          ? error.code
          : "worker_acquire_failed",
        error instanceof BrowserStorageError
          ? error.message
          : "The browser-local repository could not be acquired.",
        "acquire",
        true
      ),
    })
  }
}

async function handleRepositoryClose(request: WorkerRequest) {
  for (const operation of activePickedFolders.values()) {
    if (!operation.publishing) operation.cancelled = true
  }
  stagedSourceCollections.clear()
  try {
    const result = await closeRepositoryStorageAndRelease()
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
        error instanceof BrowserStorageError
          ? error.code
          : "storage_close_failed",
        error instanceof Error
          ? error.message
          : "The browser-local repository could not close cleanly.",
        "close"
      ),
    })
  }
}

interface PickedFolderPayload {
  identity?: {
    id?: string
    displayName?: string
    virtualRoot?: string
    sourceKind?: Repository["sourceKind"]
    acceptedAt?: string
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
    snapshot?: {
      acceptedAt?: string
      fileCount?: number
      totalBytes?: number
      manifestFingerprint?: string
    }
  }
  sourceBatches?: {
    batchCount?: number
    totalFiles?: number
    totalBytes?: number
  }
}

class SourceBatchValidationError extends Error {
  readonly code: "invalid_worker_request" | "worker_payload_too_large"

  constructor(code: "invalid_worker_request" | "worker_payload_too_large") {
    super("The browser source transfer is invalid.")
    this.code = code
  }
}

function requireBatchInteger(
  value: unknown,
  minimum: number,
  maximum: number
) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new SourceBatchValidationError("invalid_worker_request")
  }
  return value
}

function sourceTransferLimit(sourceKind: Repository["sourceKind"]) {
  return sourceKind === "picked-folder"
    ? DEFAULT_SOURCE_LIMITS.maxTotalBytes
    : WORKER_BUDGETS.maxBytesPerSnapshotTransfer
}

function handleSourceBatch(request: WorkerRequest) {
  const operationId = request.operationId
  const repositoryId = request.repositoryId
  try {
    if (
      request.protocolVersion !== WORKER_PROTOCOL_VERSION ||
      !operationId ||
      !repositoryId
    ) {
      throw new SourceBatchValidationError("invalid_worker_request")
    }
    const payload = request.payload as
      | {
          sourceKind?: Repository["sourceKind"]
          batchIndex?: number
          batchCount?: number
          totalFiles?: number
          totalBytes?: number
          entries?: StagedSourceEntry[]
        }
      | undefined
    const sourceKind = payload?.sourceKind
    if (
      sourceKind !== "picked-folder" &&
      sourceKind !== "dropped-snapshot" &&
      sourceKind !== "imported-snapshot"
    ) {
      throw new SourceBatchValidationError("invalid_worker_request")
    }
    const batchCount = requireBatchInteger(
      payload?.batchCount,
      1,
      DEFAULT_SOURCE_LIMITS.maxFiles
    )
    const batchIndex = requireBatchInteger(
      payload?.batchIndex,
      0,
      batchCount - 1
    )
    const totalFiles = requireBatchInteger(
      payload?.totalFiles,
      1,
      DEFAULT_SOURCE_LIMITS.maxFiles
    )
    const totalBytes = requireBatchInteger(
      payload?.totalBytes,
      0,
      sourceTransferLimit(sourceKind)
    )
    const entries = payload?.entries
    if (
      !Array.isArray(entries) ||
      entries.length === 0 ||
      entries.length > WORKER_BUDGETS.maxFilesPerReadBatch
    ) {
      throw new SourceBatchValidationError("worker_payload_too_large")
    }

    let batchBytes = 0
    const batchPaths = new Set<string>()
    for (const entry of entries) {
      if (
        entry?.kind !== "file" ||
        typeof entry.path !== "string" ||
        !entry.path ||
        !(entry.bytes instanceof Uint8Array) ||
        typeof entry.contentHash !== "string" ||
        typeof entry.size !== "number" ||
        entry.size !== entry.bytes.byteLength ||
        entry.bytes.byteLength > DEFAULT_SOURCE_LIMITS.maxFileBytes ||
        batchPaths.has(entry.path)
      ) {
        throw new SourceBatchValidationError("invalid_worker_request")
      }
      batchPaths.add(entry.path)
      batchBytes += entry.bytes.byteLength
    }
    if (
      batchBytes > WORKER_BUDGETS.maxBytesPerReadBatch ||
      batchBytes > WORKER_BUDGETS.maxBytesPerWorkerPayload
    ) {
      throw new SourceBatchValidationError("worker_payload_too_large")
    }

    let staged = stagedSourceCollections.get(operationId)
    if (!staged) {
      if (batchIndex !== 0) {
        throw new SourceBatchValidationError("invalid_worker_request")
      }
      staged = {
        repositoryId,
        sourceKind,
        batchCount,
        totalFiles,
        totalBytes,
        nextBatch: 0,
        receivedBytes: 0,
        entries: [],
        paths: new Set(),
      }
      stagedSourceCollections.set(operationId, staged)
    }
    if (
      staged.repositoryId !== repositoryId ||
      staged.sourceKind !== sourceKind ||
      staged.batchCount !== batchCount ||
      staged.totalFiles !== totalFiles ||
      staged.totalBytes !== totalBytes ||
      staged.nextBatch !== batchIndex ||
      entries.some((entry) => staged.paths.has(entry.path!)) ||
      staged.entries.length + entries.length > totalFiles ||
      staged.receivedBytes + batchBytes > totalBytes
    ) {
      throw new SourceBatchValidationError("invalid_worker_request")
    }

    staged.entries.push(...entries)
    for (const entry of entries) staged.paths.add(entry.path!)
    staged.receivedBytes += batchBytes
    staged.nextBatch += 1
    if (
      staged.nextBatch === staged.batchCount &&
      (staged.entries.length !== staged.totalFiles ||
        staged.receivedBytes !== staged.totalBytes)
    ) {
      throw new SourceBatchValidationError("invalid_worker_request")
    }
    emitRepositoryResponse(request, {
      type: "result",
      terminal: "complete",
      result: {
        batchIndex,
        receivedFiles: staged.entries.length,
        receivedBytes: staged.receivedBytes,
      },
    })
  } catch (error) {
    if (request.operationId) {
      stagedSourceCollections.delete(request.operationId)
    }
    emitRepositoryResponse(request, {
      type: "failure",
      terminal: "failed",
      error: plainError(
        error instanceof SourceBatchValidationError
          ? error.code
          : "invalid_worker_request",
        error instanceof SourceBatchValidationError &&
          error.code === "worker_payload_too_large"
          ? "The browser source transfer exceeds the worker budget."
          : "The browser source transfer is invalid.",
        "read"
      ),
    })
  }
}

function resolveSourceCollection(
  request: WorkerRequest,
  payload: PickedFolderPayload | undefined
) {
  const collection = payload?.collection
  const batchMetadata = payload?.sourceBatches
  if (!batchMetadata) return collection
  const operationId = request.operationId
  const repositoryId = request.repositoryId
  const staged = operationId
    ? stagedSourceCollections.get(operationId)
    : undefined
  if (
    !operationId ||
    !repositoryId ||
    !staged ||
    staged.repositoryId !== repositoryId ||
    staged.nextBatch !== staged.batchCount ||
    staged.batchCount !== batchMetadata.batchCount ||
    staged.totalFiles !== batchMetadata.totalFiles ||
    staged.totalBytes !== batchMetadata.totalBytes ||
    !collection ||
    !Array.isArray(collection.entries) ||
    collection.entries.length !== 0
  ) {
    throw new SourceBatchValidationError("invalid_worker_request")
  }
  stagedSourceCollections.delete(operationId)
  return { ...collection, entries: staged.entries }
}

function normalizedManifest(
  candidate: unknown,
  fallbackFingerprint: string
): SourceManifest {
  if (candidate && typeof candidate === "object") {
    const value = candidate as {
      entries?: unknown
      fingerprint?: unknown
    }
    if (Array.isArray(value.entries)) {
      return {
        entries: value.entries as SourceManifest["entries"],
        fingerprint:
          typeof value.fingerprint === "string"
            ? value.fingerprint
            : fallbackFingerprint,
      }
    }
  }
  if (Array.isArray(candidate)) {
    return {
      entries: candidate as SourceManifest["entries"],
      fingerprint: fallbackFingerprint,
    }
  }
  return { entries: [], fingerprint: fallbackFingerprint }
}

function browserSources(
  collection: NonNullable<PickedFolderPayload["collection"]>,
  acceptedManifest: Array<{
    path: string
    contentHash: string
    language: string
  }>
) {
  const sourceByPath = new Map(
    collection.entries?.map((entry) => [String(entry.path), entry]) ?? []
  )
  return acceptedManifest.map((entry) => {
    const source = sourceByPath.get(entry.path)
    const bytes =
      source?.bytes instanceof Uint8Array ? source.bytes : new Uint8Array()
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
  })
}

async function initialGeneration(
  repositoryId: string,
  collection: NonNullable<PickedFolderPayload["collection"]>
) {
  const entries = collection.entries ?? []
  const extraction = await extractLocalSources(
    entries.map((entry) => ({
      kind: entry.kind === "file" ? "file" : "directory",
      path: String(entry.path ?? ""),
      bytes: entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(),
    }))
  )
  const sources = browserSources(collection, extraction.acceptedManifest)
  const manifest = await createSourceManifest(sources)
  const providerWarnings = collection.warnings?.details ?? []
  const warnings = [...providerWarnings, ...extraction.warnings].slice(
    0,
    DEFAULT_SOURCE_LIMITS.maxWarnings
  )
  const warningCount =
    Number(collection.warnings?.total ?? providerWarnings.length) +
    extraction.warnings.length
  return {
    extraction,
    generation: {
      repositoryId,
      manifestFingerprint: manifest.fingerprint,
      manifest,
      counts: {
        files: sources.length,
        nodes: extraction.nodes.length,
        edges: extraction.edges.length,
        warnings: warningCount,
      },
      warnings,
      sources,
      nodes: extraction.nodes,
      edges: extraction.edges,
    } satisfies BrowserGenerationInput,
  }
}

export async function refreshPublishedGeneration(
  store: BrowserGraphStore,
  repositoryId: string,
  collection: NonNullable<PickedFolderPayload["collection"]>
) {
  const base = store.readRefreshBase(repositoryId)
  const candidateManifest = normalizedManifest(
    collection.manifest,
    collection.manifest?.fingerprint ?? ""
  )
  const diff = diffSourceManifests(base.manifest, candidateManifest)
  const extractedPaths = [...diff.added, ...diff.changed].sort()
  const extractedPathSet = new Set(extractedPaths)
  const extraction = await extractLocalSources(
    (collection.entries ?? [])
      .filter((entry) => extractedPathSet.has(String(entry.path)))
      .map((entry) => ({
        kind: entry.kind === "file" ? "file" : "directory",
        path: String(entry.path ?? ""),
        bytes:
          entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(),
      }))
  )
  const acceptedChangedPaths = new Set(
    extraction.acceptedManifest.map((entry) => entry.path)
  )
  const unchangedPaths = new Set(diff.unchanged)
  const retainedSources = base.sources.filter((source) =>
    unchangedPaths.has(source.path)
  )
  const changedSources = browserSources(collection, extraction.acceptedManifest)
  const sources = [...retainedSources, ...changedSources].sort((left, right) =>
    left.path.localeCompare(right.path)
  )
  const retainedNodes = base.nodes.filter((node) =>
    unchangedPaths.has(node.filePath)
  )
  const retainedNodeIds = new Set(retainedNodes.map((node) => node.id))
  const retainedEdges = base.edges.filter(
    (edge) =>
      retainedNodeIds.has(edge.source) && retainedNodeIds.has(edge.target)
  )
  const nodes = [...retainedNodes, ...extraction.nodes].sort((left, right) =>
    left.id.localeCompare(right.id)
  )
  const edges = [...retainedEdges, ...extraction.edges].sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target) ||
      left.kind.localeCompare(right.kind)
  )
  const manifest = await createSourceManifest(sources)
  const providerWarnings = collection.warnings?.details ?? []
  const warnings = [...providerWarnings, ...extraction.warnings].slice(
    0,
    DEFAULT_SOURCE_LIMITS.maxWarnings
  )
  const warningCount =
    Number(collection.warnings?.total ?? providerWarnings.length) +
    extraction.warnings.length
  const counts = {
    files: sources.length,
    nodes: nodes.length,
    edges: edges.length,
    warnings: warningCount,
  }
  const publication = await store.publishGeneration({
    repositoryId,
    manifestFingerprint: manifest.fingerprint,
    manifest,
    counts,
    warnings,
    sources,
    nodes,
    edges,
  })
  return {
    ...publication,
    changes: {
      added: diff.added.filter((path) => acceptedChangedPaths.has(path)).length,
      changed: diff.changed.filter((path) => acceptedChangedPaths.has(path))
        .length,
      deleted: diff.deleted.length,
      unchanged: diff.unchanged.length,
      skipped: extractedPaths.filter((path) => !acceptedChangedPaths.has(path))
        .length,
    },
    counts,
    extractedPaths,
  }
}

async function handleInitialSourceIndex(
  request: WorkerRequest,
  sourceKind: "picked-folder" | "dropped-snapshot" | "imported-snapshot"
) {
  const operationId = request.operationId
  const repositoryId = request.repositoryId
  const payload = request.payload as PickedFolderPayload | undefined
  const identity = payload?.identity
  let collection: PickedFolderPayload["collection"]
  try {
    collection = resolveSourceCollection(request, payload)
  } catch {
    if (operationId) stagedSourceCollections.delete(operationId)
    emitRepositoryResponse(request, {
      type: "failure",
      terminal: "failed",
      error: plainError(
        "invalid_worker_request",
        "The browser source transfer is incomplete.",
        "queued"
      ),
    })
    return
  }
  if (
    !operationId ||
    !repositoryId ||
    identity?.id !== repositoryId ||
    identity.sourceKind !== sourceKind ||
    !Array.isArray(collection?.entries) ||
    typeof collection.manifest?.fingerprint !== "string" ||
    (sourceKind !== "picked-folder" &&
      (collection.snapshot?.acceptedAt !== identity.acceptedAt ||
        collection.snapshot?.manifestFingerprint !==
          collection.manifest.fingerprint))
  ) {
    emitRepositoryResponse(request, {
      type: "failure",
      terminal: "failed",
      error: plainError(
        "invalid_worker_request",
        sourceKind === "picked-folder"
          ? "The picked-folder request is incomplete."
          : "The snapshot import request is incomplete.",
        "queued"
      ),
    })
    return
  }

  if (activePickedFolders.has(operationId)) {
    emitRepositoryResponse(request, {
      type: "result",
      terminal: "complete",
      result: { noop: true, stale: true },
    })
    return
  }
  const operation = { cancelled: false, publishing: false, repositoryId }
  activePickedFolders.set(operationId, operation)
  let staged: StagedBrowserGeneration | undefined
  let publicationStarted = false
  let activeStore: BrowserGraphStore | undefined

  try {
    await acquireRepositoryOwnership(repositoryId)
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
    activeStore = store
    emitRepositoryResponse(request, {
      type: "progress",
      phase: "grammar-load",
      completed: 0,
      total: 1,
      timestamp: Date.now(),
    })
    const { extraction, generation } = await initialGeneration(
      repositoryId,
      collection
    )
    throwIfPickedFolderCancelled(operation)
    emitRepositoryResponse(request, {
      type: "progress",
      phase: "parse",
      completed: extraction.acceptedManifest.length,
      total: extraction.acceptedManifest.length,
      timestamp: Date.now(),
    })
    throwIfPickedFolderCancelled(operation)
    emitRepositoryResponse(request, {
      type: "progress",
      phase: "store",
      completed: extraction.acceptedManifest.length,
      total: extraction.acceptedManifest.length,
      timestamp: Date.now(),
    })
    staged = await store.stageGeneration(generation)
    await yieldForActionableProgress()
    throwIfPickedFolderCancelled(operation)
    operation.publishing = true
    publicationStarted = true
    emitRepositoryResponse(request, {
      type: "progress",
      phase: "publish",
      completed: extraction.acceptedManifest.length,
      total: extraction.acceptedManifest.length,
      timestamp: Date.now(),
    })
    await store.commitStagedGeneration(generation, staged)
    const repository: Repository = {
      id: repositoryId,
      root: identity.virtualRoot ?? `local://${repositoryId}`,
      name: identity.displayName ?? "Browser repository",
      default: false,
      runtime: "local",
      sourceKind,
      ...(sourceKind === "picked-folder"
        ? {}
        : {
            snapshotImportedAt: collection.snapshot!.acceptedAt,
            manifestFingerprint: collection.snapshot!.manifestFingerprint,
          }),
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
    if (cancelled && staged && !publicationStarted) {
      activeStore?.discardStagedGeneration(staged)
    }
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
        !cancelled
      ),
    })
  } finally {
    activePickedFolders.delete(operationId)
    stagedSourceCollections.delete(operationId)
  }
}

function handleOpenPickedFolder(request: WorkerRequest) {
  return handleInitialSourceIndex(request, "picked-folder")
}

function handleSnapshotImport(request: WorkerRequest) {
  const sourceKind = (request.payload as PickedFolderPayload | undefined)
    ?.identity?.sourceKind
  return handleInitialSourceIndex(
    request,
    sourceKind === "imported-snapshot"
      ? "imported-snapshot"
      : "dropped-snapshot"
  )
}

async function handleRefreshPickedFolder(request: WorkerRequest) {
  const operationId = request.operationId
  const repositoryId = request.repositoryId
  const payload = request.payload as PickedFolderPayload | undefined
  let collection: PickedFolderPayload["collection"]
  try {
    collection = resolveSourceCollection(request, payload)
  } catch {
    if (operationId) stagedSourceCollections.delete(operationId)
    emitRepositoryResponse(request, {
      type: "failure",
      terminal: "failed",
      error: plainError(
        "invalid_worker_request",
        "The browser source transfer is incomplete.",
        "queued"
      ),
    })
    return
  }
  if (
    !operationId ||
    !repositoryId ||
    !Array.isArray(collection?.entries) ||
    typeof collection.manifest?.fingerprint !== "string"
  ) {
    emitRepositoryResponse(request, {
      type: "failure",
      terminal: "failed",
      error: plainError(
        "invalid_worker_request",
        "The refresh request is incomplete.",
        "queued"
      ),
    })
    return
  }
  if (activePickedFolders.has(operationId)) {
    emitRepositoryResponse(request, {
      type: "result",
      terminal: "complete",
      result: { noop: true, stale: true },
    })
    return
  }
  const operation = { cancelled: false, publishing: false, repositoryId }
  activePickedFolders.set(operationId, operation)
  try {
    await acquireRepositoryOwnership(repositoryId)
    emitRepositoryResponse(request, {
      type: "progress",
      phase: "refresh-diff",
      completed: 0,
      total: collection.entries.length,
      timestamp: Date.now(),
    })
    const store = await ensureRepositoryStorage()
    throwIfPickedFolderCancelled(operation)
    const result = await refreshPublishedGeneration(
      store,
      repositoryId,
      collection
    )
    operation.publishing = true
    emitRepositoryResponse(request, {
      type: "result",
      terminal: "complete",
      result,
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
          ? "The browser-local refresh was cancelled."
          : error instanceof BrowserStorageError
            ? error.message
            : "The browser-local refresh failed.",
        cancelled ? "cancelled" : "failed",
        !cancelled
      ),
    })
  } finally {
    activePickedFolders.delete(operationId)
    stagedSourceCollections.delete(operationId)
  }
}

function handlePickedFolderCancel(request: WorkerRequest) {
  const operation = request.operationId
    ? activePickedFolders.get(request.operationId)
    : undefined
  const staged = request.operationId
    ? stagedSourceCollections.has(request.operationId)
    : false
  const cancellable = staged || Boolean(operation && !operation.publishing)
  if (operation && cancellable) operation.cancelled = true
  if (request.operationId) stagedSourceCollections.delete(request.operationId)
  emitRepositoryResponse(request, {
    type: "result",
    terminal: "complete",
    result: {
      cancelled: cancellable,
      noop: !cancellable,
    },
  })
}

async function handleRepositoryDelete(request: WorkerRequest) {
  const repositoryId = request.repositoryId
  const cancelActive =
    (request.payload as { cancelActive?: boolean } | undefined)
      ?.cancelActive === true
  if (!repositoryId) {
    emitRepositoryResponse(request, {
      type: "failure",
      terminal: "failed",
      error: plainError(
        "invalid_repository_id",
        "Repository deletion requires a repository id.",
        "delete"
      ),
    })
    return
  }
  try {
    await acquireRepositoryOwnership(repositoryId)
    for (const [operationId, staged] of stagedSourceCollections) {
      if (staged.repositoryId === repositoryId) {
        stagedSourceCollections.delete(operationId)
      }
    }
    const active = [...activePickedFolders.values()].find(
      (operation) => operation.repositoryId === repositoryId
    )
    if (active) {
      if (!cancelActive || active.publishing) {
        throw new BrowserStorageError(
          "storage_write_failed",
          "An active local operation must be cancelled before deletion."
        )
      }
      active.cancelled = true
      while (
        [...activePickedFolders.values()].some(
          (operation) => operation.repositoryId === repositoryId
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    const store = await ensureRepositoryStorage()
    const result = store.deleteRepository(repositoryId)
    repositoryMetadata.delete(repositoryId)
    await closeRepositoryStorageAndRelease()
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
        error instanceof BrowserStorageError
          ? error.code
          : "repository_delete_failed",
        error instanceof Error
          ? error.message
          : "Browser repository deletion failed.",
        "delete",
        true
      ),
    })
  }
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
          depth?: number
          mode?: "keyword" | "semantic" | "hybrid" | "auto"
          semantic?: {
            endpointUrl: string
            model: string
            dimensions?: number
            graphGeneration: number
            credential: string
          }
        }
      }
    | undefined
  try {
    const query = payload?.query
    const repositoryId = request.repositoryId
    let result: unknown
    if (query === "list-repositories") {
      if (heldRepositoryLocks.size === 0) {
        throw new BrowserStorageError(
          "repository_busy",
          "Acquire a local repository before reading browser storage."
        )
      }
      const store = await ensureRepositoryStorage()
      result = store.listRepositories(repositoryMetadata)
    } else {
      if (!repositoryId) {
        throw new BrowserStorageError(
          "invalid_repository_id",
          "A browser-local query requires a repository id."
        )
      }
      await acquireRepositoryOwnership(repositoryId)
      const store = await ensureRepositoryStorage()
      const queryRequest = payload?.request ?? {}
      switch (query) {
        case "repository-status":
          result = store.getRepositoryStatus(
            repositoryId,
            repositoryMetadata.get(repositoryId)?.name
          )
          break
        case "search":
          {
            const searchText = String(queryRequest.query ?? "")
            const mode = queryRequest.mode ?? "keyword"
            const semantic = queryRequest.semantic
            if (mode === "keyword") {
              result = store.search(
                repositoryId,
                searchText,
                queryRequest.limit,
                queryRequest.offset
              )
              break
            }
            if (!semantic) {
              const keyword = store.search(
                repositoryId,
                searchText,
                queryRequest.limit,
                queryRequest.offset
              )
              result = {
                ...keyword,
                degraded: true,
                degradationReason:
                  "Semantic search requires re-entering the page-session embedding credential.",
              }
              break
            }
            try {
              const input: EmbeddingInputItem = {
                nodeId: "__query__",
                inputHash: await hashEmbeddingInput(searchText),
                text: searchText,
              }
              const batch = await requestEmbeddingBatch({
                endpointUrl: semantic.endpointUrl,
                model: semantic.model,
                credential: semantic.credential,
                items: [input],
              })
              const [queryVector] = validateEmbeddingBatch([input], batch, {
                model: semantic.model,
                dimensions: semantic.dimensions,
              })
              if (!queryVector) {
                throw new BrowserStorageError(
                  "invalid_vector_state",
                  "The semantic query vector is unavailable."
                )
              }
              const semanticResult = store.semanticSearch(
                repositoryId,
                semantic.graphGeneration,
                semantic.model,
                queryVector.dimensions,
                queryVector.values,
                queryRequest.limit,
                queryRequest.offset
              )
              if (mode === "semantic") {
                result = semanticResult
                break
              }
              const keyword = store.search(
                repositoryId,
                searchText,
                queryRequest.limit,
                queryRequest.offset
              )
              const seen = new Set<string>()
              const items = [...semanticResult.items, ...keyword.items].filter(
                (item) => {
                  if (seen.has(item.id)) return false
                  seen.add(item.id)
                  return true
                }
              )
              const limit = semanticResult.limit
              result = {
                ...semanticResult,
                items: items.slice(0, limit),
                total: items.length,
              }
            } catch (error) {
              if (mode === "semantic") throw error
              const keyword = store.search(
                repositoryId,
                searchText,
                queryRequest.limit,
                queryRequest.offset
              )
              result = {
                ...keyword,
                degraded: true,
                degradationReason:
                  error instanceof Error
                    ? `${error.message} Keyword results are shown instead.`
                    : "Semantic search failed. Keyword results are shown instead.",
              }
            }
          }
          break
        case "node":
          result = store.getNode(
            repositoryId,
            String(queryRequest.nodeId ?? "")
          )
          break
        case "source":
          result = store.getSource(
            repositoryId,
            String(queryRequest.nodeId ?? "")
          )
          break
        case "callers":
        case "callees":
          result = store.relationships(
            repositoryId,
            String(queryRequest.nodeId ?? ""),
            query,
            queryRequest.limit,
            queryRequest.offset
          )
          break
        case "graph":
          result = store.graph(
            repositoryId,
            String(queryRequest.nodeId ?? ""),
            queryRequest.depth
          )
          break
        case "impact":
          result = store.impact(
            repositoryId,
            String(queryRequest.nodeId ?? ""),
            queryRequest.depth
          )
          break
        default:
          throw new BrowserStorageError(
            "invalid_generation",
            "The browser-local query is not supported."
          )
      }
    }
    emitRepositoryResponse(request, {
      type: "result",
      terminal: "complete",
      result,
    })
  } catch (error) {
    const embeddingEnvelope =
      error instanceof EmbeddingOperationError ||
      error instanceof EmbeddingPolicyError
        ? error.toEnvelope()
        : undefined
    emitRepositoryResponse(request, {
      type: "failure",
      terminal: "failed",
      error: plainError(
        embeddingEnvelope?.code ??
          (error instanceof BrowserStorageError
            ? error.code
            : "worker_query_failed"),
        embeddingEnvelope?.message ??
          (error instanceof BrowserStorageError
            ? error.message
            : "The browser-local query failed."),
        "query",
        embeddingEnvelope?.retryable ?? false
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
  embedding: {
    getPublishedGeneration(repositoryId) {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.getPublishedGeneration(repositoryId)
    },
    async loadInputs(repositoryId, graphGeneration) {
      if (!storage) throw new Error("Browser graph store is not open.")
      const symbols = storage.listEmbeddingSymbols(
        repositoryId,
        graphGeneration
      )
      return Promise.all(
        symbols.map(async (symbol) => {
          const text = composeBrowserEmbeddingInput(symbol)
          return {
            nodeId: symbol.nodeId,
            inputHash: await hashEmbeddingInput(text),
            text,
          }
        })
      )
    },
    requestBatch: requestEmbeddingBatch,
    writeVectors(repositoryId, graphGeneration, rows) {
      if (!storage) throw new Error("Browser graph store is not open.")
      storage.writeEmbeddingVectors(repositoryId, graphGeneration, rows)
    },
    saveState(repositoryId, state) {
      if (!storage) throw new Error("Browser graph store is not open.")
      storage.saveEmbeddingState(repositoryId, state)
    },
  },
  loadGrammars: async () => undefined,
  releaseGrammars: () => undefined,
  getCapabilities: probeWorkerRuntimeCapabilities,
  emit: (message) => globalThis.postMessage(message),
  yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
})

function faultInjector(point: BrowserStorageFaultPoint) {
  if (
    requestedFault === "quota-before-publication" &&
    point === "before-publication"
  ) {
    throw new BrowserStorageError(
      "quota_exceeded",
      "Injected browser storage quota failure."
    )
  }
  if (
    requestedFault === "migration-failed" &&
    point === "after-generation-write"
  ) {
    throw new BrowserStorageError(
      "schema_version_mismatch",
      "Injected browser schema migration failure."
    )
  }
  if (
    requestedFault === "after-delete-cleanup" &&
    point === "after-source-staging"
  ) {
    throw new BrowserStorageError(
      "storage_write_failed",
      "Injected browser staging write failure before cleanup."
    )
  }
  if (
    requestedFault === point &&
    [
      "after-source-staging",
      "after-graph-write",
      "after-status-update",
      "after-registry-publish",
      "after-delete-cleanup",
    ].includes(point)
  ) {
    throw new BrowserStorageError(
      "storage_write_failed",
      `Injected browser storage failure at ${point}.`
    )
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
      requestedFault =
        typeof payload.fault === "string" ? payload.fault : undefined
      try {
        return await storage.publishGeneration(
          payload.generation as unknown as BrowserGenerationInput
        )
      } finally {
        requestedFault = undefined
      }
    }
    case "storage-leave-staging": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.stageGeneration(
        payload.generation as unknown as BrowserGenerationInput
      )
    }
    case "storage-current": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.readCurrent(String(payload.repositoryId))
    }
    case "storage-statuses": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.listGenerationStatuses(String(payload.repositoryId))
    }
    case "storage-file-names": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.listDatabaseFiles()
    }
    case "storage-relationships": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.relationships(
        String(payload.repositoryId),
        String(payload.nodeId),
        payload.direction === "callees" ? "callees" : "callers",
        payload.limit === undefined ? undefined : Number(payload.limit),
        payload.offset === undefined ? undefined : Number(payload.offset)
      )
    }
    case "storage-graph": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.graph(
        String(payload.repositoryId),
        String(payload.nodeId),
        payload.depth === undefined ? undefined : Number(payload.depth)
      )
    }
    case "storage-impact": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.impact(
        String(payload.repositoryId),
        String(payload.nodeId),
        payload.depth === undefined ? undefined : Number(payload.depth)
      )
    }
    case "storage-refresh": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return refreshPublishedGeneration(
        storage,
        String(payload.repositoryId),
        payload.collection as NonNullable<PickedFolderPayload["collection"]>
      )
    }
    case "storage-query-plans": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.queryPlans(String(payload.repositoryId))
    }
    case "storage-embedding-symbols": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.listEmbeddingSymbols(
        String(payload.repositoryId),
        Number(payload.graphGeneration)
      )
    }
    case "storage-write-vectors": {
      if (!storage) throw new Error("Browser graph store is not open.")
      storage.writeEmbeddingVectors(
        String(payload.repositoryId),
        Number(payload.graphGeneration),
        payload.rows as EmbeddingVectorRow[]
      )
      return storage.readEmbeddingVectorMetadata(String(payload.repositoryId))
    }
    case "storage-vector-metadata": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.readEmbeddingVectorMetadata(String(payload.repositoryId))
    }
    case "storage-semantic-search": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.semanticSearch(
        String(payload.repositoryId),
        Number(payload.graphGeneration),
        String(payload.model),
        Number(payload.dimensions),
        payload.vector as number[],
        payload.limit === undefined ? undefined : Number(payload.limit),
        payload.offset === undefined ? undefined : Number(payload.offset)
      )
    }
    case "storage-save-embedding-state": {
      if (!storage) throw new Error("Browser graph store is not open.")
      storage.saveEmbeddingState(
        String(payload.repositoryId),
        payload.state as EmbeddingSemanticState
      )
      return storage.readEmbeddingState(String(payload.repositoryId))
    }
    case "storage-embedding-state": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.readEmbeddingState(String(payload.repositoryId))
    }
    case "storage-delete": {
      if (!storage) throw new Error("Browser graph store is not open.")
      return storage.deleteRepository(String(payload.repositoryId))
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

globalThis.addEventListener(
  "message",
  (event: MessageEvent<unknown>) => {
    const candidate = event.data
    if (!isRecord(candidate) || typeof candidate.requestId !== "string") {
      return
    }
    if (typeof candidate.kind !== "string") {
      if (typeof candidate.protocolVersion === "number") {
        globalThis.postMessage({
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId: candidate.requestId,
          type: "failure",
          terminal: "failed",
          error: plainError(
            "invalid_worker_request",
            "The worker request does not match its declared operation.",
            "queued"
          ),
        } satisfies WorkerResponse)
      }
      return
    }
    const request = candidate as unknown as StorageTestRequest
    if (!request.kind.startsWith("storage-")) {
      const protocolRequest = request as unknown as WorkerRequestEnvelope
      if (typeof protocolRequest.protocolVersion === "number") {
        if (!isWorkerRequest(protocolRequest)) {
          void protocolRuntime.handle(protocolRequest)
          return
        }
        if (protocolRequest.kind === "source-batch") {
          handleSourceBatch(protocolRequest)
        } else if (protocolRequest.kind === "open-picked-folder") {
          void handleOpenPickedFolder(protocolRequest)
        } else if (protocolRequest.kind === "import-snapshot") {
          void handleSnapshotImport(protocolRequest)
        } else if (protocolRequest.kind === "acquire") {
          void handleRepositoryAcquire(protocolRequest)
        } else if (protocolRequest.kind === "refresh") {
          void handleRefreshPickedFolder(protocolRequest)
        } else if (protocolRequest.kind === "query") {
          void handleRepositoryQuery(protocolRequest)
        } else if (protocolRequest.kind === "delete") {
          void handleRepositoryDelete(protocolRequest)
        } else if (
          protocolRequest.kind === "cancel" &&
          protocolRequest.operationId &&
          (activePickedFolders.has(protocolRequest.operationId) ||
            stagedSourceCollections.has(protocolRequest.operationId))
        ) {
          handlePickedFolderCancel(protocolRequest)
        } else if (protocolRequest.kind === "close") {
          void handleRepositoryClose(protocolRequest)
        } else {
          void protocolRuntime.handle(protocolRequest)
        }
      }
      return
    }
    void handleStorageTestRequest(request).then(
      (result) =>
        globalThis.postMessage({
          requestId: request.requestId,
          ok: true,
          result,
        }),
      (error: unknown) => {
        const code =
          error instanceof BrowserStorageError
            ? error.code
            : "storage_worker_failed"
        const message =
          error instanceof Error
            ? error.message
            : "Browser storage worker failed."
        globalThis.postMessage({
          requestId: request.requestId,
          ok: false,
          error: { code, message: message.slice(0, 240) },
        })
      }
    )
  }
)
