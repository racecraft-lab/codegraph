import ignore from "ignore"

export const DEFAULT_SOURCE_LIMITS = {
  maxDepth: 32,
  maxFiles: 20_000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxSnapshotTransferBytes: 64 * 1024 * 1024,
  maxWarnings: 100,
} as const

const BUILT_IN_IGNORES = [".git/", ".codegraph/", "node_modules/"]

export type SnapshotSourceKind = "dropped-snapshot" | "imported-snapshot"
export type SourceKind = "picked-folder" | SnapshotSourceKind

export interface SourceIdentity {
  id: string
  sourceKind: SourceKind
  displayName: string
  virtualRoot: string
  handleRefId?: string
  acceptedAt?: string
}

export interface SourceTraversalLimits {
  maxDepth: number
  maxFiles: number
  maxFileBytes: number
  maxTotalBytes: number
  maxSnapshotTransferBytes: number
  maxWarnings: number
}

export type SourceWarningCode =
  | "invalid_source_path"
  | "duplicate_source_path"
  | "unsupported_entry_kind"
  | "recursive_cycle"
  | "ignored_path"
  | "file_too_large"
  | "file_count_limit"
  | "total_bytes_limit"
  | "snapshot_transfer_limit"
  | "max_depth_exceeded"
  | "unreadable_file"

export interface SourceWarning {
  path: string
  code: SourceWarningCode
}

export interface BoundedWarnings {
  details: SourceWarning[]
  total: number
  truncated: boolean
}

export interface AcceptedSourceEntry {
  kind: "file"
  path: string
  bytes: Uint8Array
  contentHash: string
  size: number
  mtimeHint?: number
}

export type SourceManifestEntry = Pick<
  AcceptedSourceEntry,
  "path" | "contentHash" | "size" | "mtimeHint"
>

export interface SourceManifest {
  entries: SourceManifestEntry[]
  fingerprint: string
}

export interface SourceManifestDiff {
  added: string[]
  changed: string[]
  deleted: string[]
  unchanged: string[]
}

export interface SourceCollection {
  entries: AcceptedSourceEntry[]
  manifest: SourceManifest
  warnings: BoundedWarnings
}

export interface SnapshotImportMetadata {
  acceptedAt: string
  fileCount: number
  totalBytes: number
  manifestFingerprint: string
}

export interface SnapshotSourceCollection extends SourceCollection {
  snapshot: SnapshotImportMetadata
}

export interface BrowserSourceProvider {
  readonly identity: SourceIdentity
  collect(): Promise<SourceCollection>
}

export interface SnapshotSourceProvider extends BrowserSourceProvider {
  readonly identity: SourceIdentity & {
    sourceKind: SnapshotSourceKind
    acceptedAt: string
  }
  collect(): Promise<SnapshotSourceCollection>
}

export interface FileLike {
  readonly size: number
  readonly lastModified?: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface FileHandleLike {
  readonly kind: "file"
  readonly name: string
  getFile(): Promise<FileLike>
}

export interface DirectoryHandleLike {
  readonly kind: "directory"
  readonly name: string
  entries(): AsyncIterableIterator<[string, SourceHandleLike]>
  queryPermission?(options?: { mode: "read" }): Promise<SourcePermissionState>
  requestPermission?(options?: { mode: "read" }): Promise<SourcePermissionState>
  isSameEntry?(other: DirectoryHandleLike): Promise<boolean>
}

export type SourceHandleLike =
  | FileHandleLike
  | DirectoryHandleLike
  | { readonly kind: string; readonly name: string }

export type SourcePermissionState = "granted" | "prompt" | "denied"
export type SourceConnectionStatus =
  | SourcePermissionState
  | "stale"

export interface SourceConnection {
  repositoryId: string
  handleRefId: string
  status: SourceConnectionStatus
  canRefresh: boolean
}

export interface SavedSourceHandle {
  identity: SourceIdentity
  handle: DirectoryHandleLike
}

export interface SnapshotRegistryRecord {
  repositoryId: string
  displayName: string
  sourceKind: SnapshotSourceKind
  acceptedAt: string
  manifestFingerprint: string
  fileCount: number
  totalBytes: number
}

export interface SnapshotRepositoryRegistry {
  list(): Promise<SnapshotRegistryRecord[]>
  put(record: SnapshotRegistryRecord): Promise<void>
  delete(repositoryId: string): Promise<void>
}

const SNAPSHOT_REGISTRY_KEY = "codegraph.localSnapshotRegistry.v1"

export class LocalStorageSnapshotRepositoryRegistry
  implements SnapshotRepositoryRegistry
{
  private readonly storage?: Pick<Storage, "getItem" | "setItem">

  constructor(
    storage: Pick<Storage, "getItem" | "setItem"> | undefined =
      typeof localStorage === "undefined" ? undefined : localStorage,
  ) {
    this.storage = storage
  }

  async list(): Promise<SnapshotRegistryRecord[]> {
    if (!this.storage) return []
    try {
      const raw = this.storage.getItem(SNAPSHOT_REGISTRY_KEY)
      if (raw === null) return []
      const candidate = JSON.parse(raw) as unknown
      if (!Array.isArray(candidate)) throw new TypeError("invalid registry")
      const valid = candidate.every((record) => {
        if (!record || typeof record !== "object") return false
        const value = record as Record<string, unknown>
        return (
          typeof value.repositoryId === "string" &&
          value.repositoryId.length > 0 &&
          typeof value.displayName === "string" &&
          value.displayName.length > 0 &&
          (value.sourceKind === "dropped-snapshot" ||
            value.sourceKind === "imported-snapshot") &&
          typeof value.acceptedAt === "string" &&
          Number.isFinite(new Date(value.acceptedAt).getTime()) &&
          typeof value.manifestFingerprint === "string" &&
          value.manifestFingerprint.length > 0 &&
          Number.isSafeInteger(value.fileCount) &&
          Number(value.fileCount) >= 0 &&
          Number.isSafeInteger(value.totalBytes) &&
          Number(value.totalBytes) >= 0
        )
      })
      if (!valid) throw new TypeError("invalid registry record")
      return candidate as SnapshotRegistryRecord[]
    } catch {
      throw new Error(
        "Browser snapshot metadata is unreadable. Clear or repair this site's local CodeGraph metadata before importing another snapshot."
      )
    }
  }

  async put(record: SnapshotRegistryRecord): Promise<void> {
    if (!this.storage) return
    const records = (await this.list()).filter(
      (candidate) => candidate.repositoryId !== record.repositoryId,
    )
    this.storage.setItem(
      SNAPSHOT_REGISTRY_KEY,
      JSON.stringify([...records, { ...record }]),
    )
  }

  async delete(repositoryId: string): Promise<void> {
    if (!this.storage) return
    this.storage.setItem(
      SNAPSHOT_REGISTRY_KEY,
      JSON.stringify(
        (await this.list()).filter(
          (record) => record.repositoryId !== repositoryId,
        ),
      ),
    )
  }
}

export interface SourceHandleStore {
  get(handleRefId: string): Promise<SavedSourceHandle | undefined>
  put(record: SavedSourceHandle): Promise<void>
  delete(handleRefId: string): Promise<void>
}

interface PersistedSourceHandle {
  handleRefId: string
  repositoryId: string
  sourceKind: SourceKind
  displayName: string
  virtualRoot: string
  handle: DirectoryHandleLike
}

const SOURCE_REGISTRY_DATABASE = "codegraph-browser-source-registry"
const SOURCE_REGISTRY_STORE = "handles"
const OPAQUE_SOURCE_ID = /^[A-Za-z0-9_-]+$/

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    })
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    })
  })
}

function idbTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true })
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("Source registry transaction aborted.")),
      { once: true },
    )
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("Source registry transaction failed.")),
      { once: true },
    )
  })
}

export class IndexedDbSourceHandleStore implements SourceHandleStore {
  private database?: Promise<IDBDatabase>

  private open() {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(SOURCE_REGISTRY_DATABASE, 1)
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains(SOURCE_REGISTRY_STORE)) {
          request.result.createObjectStore(SOURCE_REGISTRY_STORE, {
            keyPath: "handleRefId",
          })
        }
      })
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      })
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      })
    })
    return this.database
  }

  async get(handleRefId: string): Promise<SavedSourceHandle | undefined> {
    const database = await this.open()
    const transaction = database.transaction(SOURCE_REGISTRY_STORE, "readonly")
    const completed = idbTransaction(transaction)
    const record = await idbRequest(
      transaction.objectStore(SOURCE_REGISTRY_STORE).get(handleRefId),
    ) as PersistedSourceHandle | undefined
    await completed
    if (!record) return undefined
    return {
      identity: {
        id: record.repositoryId,
        sourceKind: record.sourceKind,
        displayName: record.displayName,
        virtualRoot: record.virtualRoot,
        handleRefId: record.handleRefId,
      },
      handle: record.handle,
    }
  }

  async put(record: SavedSourceHandle): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction(SOURCE_REGISTRY_STORE, "readwrite")
    const completed = idbTransaction(transaction)
    transaction.objectStore(SOURCE_REGISTRY_STORE).put({
      handleRefId: record.identity.handleRefId!,
      repositoryId: record.identity.id,
      sourceKind: record.identity.sourceKind,
      displayName: record.identity.displayName,
      virtualRoot: record.identity.virtualRoot,
      handle: record.handle,
    } satisfies PersistedSourceHandle)
    await completed
  }

  async delete(handleRefId: string): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction(SOURCE_REGISTRY_STORE, "readwrite")
    const completed = idbTransaction(transaction)
    transaction.objectStore(SOURCE_REGISTRY_STORE).delete(handleRefId)
    await completed
  }
}

function assertPickedFolderIdentity(identity: SourceIdentity) {
  if (
    identity.sourceKind !== "picked-folder" ||
    !OPAQUE_SOURCE_ID.test(identity.id) ||
    identity.virtualRoot !== `local://${identity.id}` ||
    identity.handleRefId !== `handle-${identity.id}`
  ) {
    throw new SourceProviderError(
      "invalid_source_identity",
      "Saved folders require an opaque browser-local identity.",
    )
  }
}

async function readPermission(handle: DirectoryHandleLike) {
  return handle.queryPermission?.({ mode: "read" }) ?? "granted"
}

export class SourceHandleRegistry {
  private readonly store: SourceHandleStore
  private readonly liveHandles = new Map<string, DirectoryHandleLike>()

  constructor(store: SourceHandleStore = new IndexedDbSourceHandleStore()) {
    this.store = store
  }

  async save(identity: SourceIdentity, handle: DirectoryHandleLike) {
    assertPickedFolderIdentity(identity)
    this.liveHandles.set(identity.id, handle)
    await this.store.put({ identity: { ...identity }, handle })
    return {
      repositoryId: identity.id,
      handleRefId: identity.handleRefId!,
      status: "granted",
      canRefresh: true,
    } satisfies SourceConnection
  }

  async restore(identity: SourceIdentity): Promise<SourceConnection> {
    assertPickedFolderIdentity(identity)
    const record = await this.store.get(identity.handleRefId!)
    if (
      !record ||
      record.identity.id !== identity.id ||
      record.identity.virtualRoot !== identity.virtualRoot ||
      record.identity.handleRefId !== identity.handleRefId
    ) {
      this.liveHandles.delete(identity.id)
      return {
        repositoryId: identity.id,
        handleRefId: identity.handleRefId!,
        status: "stale",
        canRefresh: false,
      }
    }
    let status: SourceConnectionStatus
    try {
      status = await readPermission(record.handle)
    } catch {
      status = "stale"
    }
    if (status === "granted") {
      this.liveHandles.set(identity.id, record.handle)
    } else {
      this.liveHandles.delete(identity.id)
    }
    return {
      repositoryId: identity.id,
      handleRefId: identity.handleRefId!,
      status,
      canRefresh: status === "granted",
    }
  }

  async reconnect(
    identity: SourceIdentity,
    options: {
      userActivated: boolean
      candidate?: DirectoryHandleLike
    },
  ): Promise<SourceConnection> {
    assertPickedFolderIdentity(identity)
    if (!options.userActivated) {
      throw new SourceProviderError(
        "user_activation_required",
        "Reconnecting a local folder requires direct user activation.",
      )
    }
    const record = await this.store.get(identity.handleRefId!)
    if (!record) {
      throw new SourceProviderError(
        "stale_handle",
        "The saved folder handle is unavailable. Select the original folder again.",
      )
    }
    const handle = options.candidate ?? record.handle
    if (options.candidate) {
      const sameEntry =
        (await record.handle.isSameEntry?.(options.candidate)) ??
        (await options.candidate.isSameEntry?.(record.handle)) ??
        false
      if (!sameEntry) {
        throw new SourceProviderError(
          "source_mismatch",
          "The selected folder does not match this browser-local repository.",
        )
      }
    }
    let permission = await readPermission(handle)
    if (permission !== "granted") {
      permission =
        (await handle.requestPermission?.({ mode: "read" })) ?? permission
    }
    if (permission !== "granted") {
      this.liveHandles.delete(identity.id)
      throw new SourceProviderError(
        "permission_denied",
        "Read permission was not granted for the saved local folder.",
      )
    }
    this.liveHandles.set(identity.id, handle)
    if (options.candidate) {
      await this.store.put({ identity: { ...identity }, handle })
    }
    return {
      repositoryId: identity.id,
      handleRefId: identity.handleRefId!,
      status: "granted",
      canRefresh: true,
    }
  }

  connectedHandle(repositoryId: string) {
    return this.liveHandles.get(repositoryId)
  }

  connect(identity: SourceIdentity, handle: DirectoryHandleLike) {
    assertPickedFolderIdentity(identity)
    this.liveHandles.set(identity.id, handle)
    return {
      repositoryId: identity.id,
      handleRefId: identity.handleRefId!,
      status: "granted" as const,
      canRefresh: true,
    }
  }

  async forget(identity: SourceIdentity) {
    assertPickedFolderIdentity(identity)
    this.liveHandles.delete(identity.id)
    await this.store.delete(identity.handleRefId!)
  }
}

export interface SnapshotSourceEntry {
  readonly kind: string
  readonly path: string
  readonly bytes: Uint8Array
  readonly mtimeHint?: number
}

interface SourceProviderOptions {
  createId?: () => string
  hashBytes?: (bytes: Uint8Array) => Promise<string>
  ignorePatterns?: readonly string[]
  limits?: Partial<SourceTraversalLimits>
}

export interface PickedFolderOptions extends SourceProviderOptions {
  userActivated?: boolean
}

export interface SnapshotProviderOptions extends SourceProviderOptions {
  rootLabel: string
  sourceKind?: SnapshotSourceKind
  now?: () => Date
}

export interface DroppedDataTransferItemLike {
  getAsFileSystemHandle?: () => Promise<SourceHandleLike | null>
  webkitGetAsEntry?: () => LegacyFileSystemEntryLike | null
}

interface LegacyFileSystemEntryLike {
  readonly isFile: boolean
  readonly isDirectory: boolean
  readonly name: string
}

interface LegacyFileSystemFileEntryLike extends LegacyFileSystemEntryLike {
  file(
    success: (file: FileLike) => void,
    failure?: (error: unknown) => void,
  ): void
}

interface LegacyFileSystemDirectoryEntryLike
  extends LegacyFileSystemEntryLike {
  createReader(): {
    readEntries(
      success: (entries: LegacyFileSystemEntryLike[]) => void,
      failure?: (error: unknown) => void,
    ): void
  }
}

export class SourceProviderError extends Error {
  readonly code:
    | "user_activation_required"
    | "invalid_source_identity"
    | "stale_handle"
    | "source_mismatch"
    | "permission_denied"

  constructor(
    code: SourceProviderError["code"],
    message: string,
  ) {
    super(message)
    this.code = code
    this.name = "SourceProviderError"
  }
}

class WarningCollector {
  readonly details: SourceWarning[] = []
  total = 0
  private readonly limit: number

  constructor(limit: number) {
    this.limit = limit
  }

  add(path: string, code: SourceWarningCode) {
    this.total += 1
    if (this.details.length < this.limit) {
      this.details.push({ path, code })
    }
  }

  result(): BoundedWarnings {
    return {
      details: this.details,
      total: this.total,
      truncated: this.total > this.details.length,
    }
  }
}

function sourceLimits(overrides?: Partial<SourceTraversalLimits>): SourceTraversalLimits {
  return { ...DEFAULT_SOURCE_LIMITS, ...overrides }
}

function createOpaqueId() {
  return crypto.randomUUID()
}

async function sha256(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")
}

function safeDisplayName(candidate: string, fallback: string) {
  const normalized = candidate.replaceAll("\\", "/")
  const lastSegment = normalized.split("/").filter(Boolean).at(-1)?.trim()
  return lastSegment || fallback
}

export function normalizeSourcePath(candidate: string): string | null {
  if (!candidate || candidate.startsWith("/") || /^[A-Za-z]:[\\/]/.test(candidate)) {
    return null
  }
  const normalized = candidate.replaceAll("\\", "/")
  const segments = normalized.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null
  }
  return segments.join("/")
}

function ancestryPath(segments: readonly string[]): string | null {
  if (segments.some((segment) => segment.includes("/") || segment.includes("\\"))) {
    return null
  }
  return normalizeSourcePath(segments.join("/"))
}

function identityFor(
  sourceKind: SourceKind,
  displayName: string,
  options: SourceProviderOptions,
  acceptedAt?: string,
): SourceIdentity {
  const id = (options.createId ?? createOpaqueId)()
  return {
    id,
    sourceKind,
    displayName: safeDisplayName(
      displayName,
      sourceKind === "picked-folder" ? "Local folder" : "Snapshot",
    ),
    virtualRoot: `local://${id}`,
    ...(sourceKind === "picked-folder" ? { handleRefId: `handle-${id}` } : {}),
    ...(acceptedAt ? { acceptedAt } : {}),
  }
}

function ignoreMatcher(patterns: readonly string[] = []) {
  return ignore().add([...BUILT_IN_IGNORES, ...patterns])
}

function isIgnored(
  matcher: ReturnType<typeof ignore>,
  path: string,
  directory: boolean,
) {
  return matcher.ignores(directory ? `${path}/` : path)
}

export async function createSourceManifest(
  entries: readonly SourceManifestEntry[],
  hashBytes: (bytes: Uint8Array) => Promise<string> = sha256,
): Promise<SourceManifest> {
  const manifestEntries = entries.map(({ path, contentHash, size, mtimeHint }) => ({
    path,
    contentHash,
    size,
    ...(mtimeHint === undefined ? {} : { mtimeHint }),
  }))
  const canonical = manifestEntries
    .map(({ path, contentHash, size, mtimeHint }) => `${path}\0${contentHash}\0${size}\0${mtimeHint ?? ""}`)
    .join("\n")
  return {
    entries: manifestEntries,
    fingerprint: await hashBytes(new TextEncoder().encode(canonical)),
  }
}

export function diffSourceManifests(
  previous: SourceManifest,
  current: SourceManifest,
): SourceManifestDiff {
  const previousByPath = new Map(
    previous.entries.map((entry) => [entry.path, entry]),
  )
  const currentByPath = new Map(
    current.entries.map((entry) => [entry.path, entry]),
  )
  const added: string[] = []
  const changed: string[] = []
  const unchanged: string[] = []
  for (const entry of current.entries) {
    const old = previousByPath.get(entry.path)
    if (!old) added.push(entry.path)
    else if (old.contentHash === entry.contentHash) unchanged.push(entry.path)
    else changed.push(entry.path)
  }
  const deleted = previous.entries
    .filter((entry) => !currentByPath.has(entry.path))
    .map((entry) => entry.path)
  return {
    added: added.sort(),
    changed: changed.sort(),
    deleted: deleted.sort(),
    unchanged: unchanged.sort(),
  }
}

export function createPickedFolderProvider(
  root: DirectoryHandleLike,
  options: SourceProviderOptions = {},
): BrowserSourceProvider {
  const identity = identityFor("picked-folder", root.name, options)
  const limits = sourceLimits(options.limits)
  const hashBytes = options.hashBytes ?? sha256

  return {
    identity,
    async collect() {
      const matcher = ignoreMatcher(options.ignorePatterns)
      const warnings = new WarningCollector(limits.maxWarnings)
      const seenPaths = new Set<string>()
      const visitedDirectories = new Set<DirectoryHandleLike>()
      const entries: AcceptedSourceEntry[] = []
      let acceptedBytes = 0

      const visit = async (directory: DirectoryHandleLike, ancestry: string[]): Promise<void> => {
        if (visitedDirectories.has(directory)) {
          warnings.add(ancestryPath(ancestry) ?? ancestry.join("/"), "recursive_cycle")
          return
        }
        visitedDirectories.add(directory)

        try {
          for await (const [entryName, handle] of directory.entries()) {
            const path = ancestryPath([...ancestry, entryName])
            if (!path) {
              warnings.add(entryName, "invalid_source_path")
              continue
            }
            if (seenPaths.has(path)) {
              warnings.add(path, "duplicate_source_path")
              continue
            }
            seenPaths.add(path)

            if (path.split("/").length > limits.maxDepth) {
              warnings.add(path, "max_depth_exceeded")
              continue
            }
            if (handle.kind === "directory") {
              if (isIgnored(matcher, path, true)) {
                warnings.add(path, "ignored_path")
                continue
              }
              await visit(handle as DirectoryHandleLike, [...ancestry, entryName])
              continue
            }
            if (handle.kind !== "file") {
              warnings.add(path, "unsupported_entry_kind")
              continue
            }
            if (isIgnored(matcher, path, false)) {
              warnings.add(path, "ignored_path")
              continue
            }
            if (entries.length >= limits.maxFiles) {
              warnings.add(path, "file_count_limit")
              continue
            }

            try {
              const file = await (handle as FileHandleLike).getFile()
              if (file.size > limits.maxFileBytes) {
                warnings.add(path, "file_too_large")
                continue
              }
              if (acceptedBytes + file.size > limits.maxTotalBytes) {
                warnings.add(path, "total_bytes_limit")
                continue
              }
              const bytes = new Uint8Array(await file.arrayBuffer())
              if (bytes.byteLength > limits.maxFileBytes) {
                warnings.add(path, "file_too_large")
                continue
              }
              if (acceptedBytes + bytes.byteLength > limits.maxTotalBytes) {
                warnings.add(path, "total_bytes_limit")
                continue
              }
              entries.push({
                kind: "file",
                path,
                bytes,
                contentHash: await hashBytes(bytes),
                size: bytes.byteLength,
                ...(file.lastModified === undefined ? {} : { mtimeHint: file.lastModified }),
              })
              acceptedBytes += bytes.byteLength
            } catch {
              warnings.add(path, "unreadable_file")
            }
          }
        } catch {
          warnings.add(ancestryPath(ancestry) ?? ancestry.join("/"), "unreadable_file")
        }
      }

      await visit(root, [])
      entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
      return {
        entries,
        manifest: await createSourceManifest(entries, hashBytes),
        warnings: warnings.result(),
      }
    },
  }
}

export async function openPickedFolderFromUserAction(
  pickDirectory: () => Promise<DirectoryHandleLike>,
  options: PickedFolderOptions,
) {
  if (!options.userActivated) {
    throw new SourceProviderError(
      "user_activation_required",
      "Opening a local folder requires direct user activation.",
    )
  }
  return createPickedFolderProvider(await pickDirectory(), options)
}

export function createSnapshotProvider(
  sourceEntries: readonly SnapshotSourceEntry[],
  options: SnapshotProviderOptions,
): SnapshotSourceProvider {
  const acceptedAt = (options.now ?? (() => new Date()))().toISOString()
  const identity = identityFor(
    options.sourceKind ?? "dropped-snapshot",
    options.rootLabel,
    options,
    acceptedAt,
  ) as SnapshotSourceProvider["identity"]
  const limits = sourceLimits(options.limits)
  const hashBytes = options.hashBytes ?? sha256
  const snapshot = sourceEntries.map((entry) => ({
    ...entry,
    bytes: entry.bytes.slice(),
  }))

  return {
    identity,
    async collect() {
      const matcher = ignoreMatcher(options.ignorePatterns)
      const warnings = new WarningCollector(limits.maxWarnings)
      const seenPaths = new Set<string>()
      const entries: AcceptedSourceEntry[] = []
      let acceptedBytes = 0

      for (const candidate of snapshot) {
        const path = normalizeSourcePath(candidate.path)
        if (!path) {
          warnings.add(candidate.path, "invalid_source_path")
          continue
        }
        if (seenPaths.has(path)) {
          warnings.add(path, "duplicate_source_path")
          continue
        }
        seenPaths.add(path)
        if (path.split("/").length > limits.maxDepth) {
          warnings.add(path, "max_depth_exceeded")
          continue
        }
        if (candidate.kind !== "file") {
          warnings.add(path, "unsupported_entry_kind")
          continue
        }
        if (isIgnored(matcher, path, false)) {
          warnings.add(path, "ignored_path")
          continue
        }
        if (entries.length >= limits.maxFiles) {
          warnings.add(path, "file_count_limit")
          continue
        }
        if (candidate.bytes.byteLength > limits.maxFileBytes) {
          warnings.add(path, "file_too_large")
          continue
        }
        if (acceptedBytes + candidate.bytes.byteLength > limits.maxSnapshotTransferBytes) {
          warnings.add(path, "snapshot_transfer_limit")
          continue
        }
        if (acceptedBytes + candidate.bytes.byteLength > limits.maxTotalBytes) {
          warnings.add(path, "total_bytes_limit")
          continue
        }

        const bytes = candidate.bytes.slice()
        entries.push({
          kind: "file",
          path,
          bytes,
          contentHash: await hashBytes(bytes),
          size: bytes.byteLength,
          ...(candidate.mtimeHint === undefined ? {} : { mtimeHint: candidate.mtimeHint }),
        })
        acceptedBytes += bytes.byteLength
      }

      entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
      const manifest = await createSourceManifest(entries, hashBytes)
      return {
        entries,
        manifest,
        warnings: warnings.result(),
        snapshot: {
          acceptedAt,
          fileCount: entries.length,
          totalBytes: acceptedBytes,
          manifestFingerprint: manifest.fingerprint,
        },
      }
    },
  }
}

function readLegacyFile(entry: LegacyFileSystemFileEntryLike) {
  return new Promise<FileLike>((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

function readLegacyEntries(
  reader: ReturnType<LegacyFileSystemDirectoryEntryLike["createReader"]>,
) {
  return new Promise<LegacyFileSystemEntryLike[]>((resolve, reject) => {
    reader.readEntries(resolve, reject)
  })
}

function legacyHandle(entry: LegacyFileSystemEntryLike): SourceHandleLike {
  if (entry.isDirectory) {
    const directory = entry as LegacyFileSystemDirectoryEntryLike
    return {
      kind: "directory",
      name: entry.name,
      async *entries() {
        const reader = directory.createReader()
        while (true) {
          const batch = await readLegacyEntries(reader)
          if (batch.length === 0) return
          for (const child of batch) {
            yield [child.name, legacyHandle(child)]
          }
        }
      },
    }
  }
  if (entry.isFile) {
    const fileEntry = entry as LegacyFileSystemFileEntryLike
    return {
      kind: "file",
      name: entry.name,
      getFile: () => readLegacyFile(fileEntry),
    }
  }
  return { kind: "unsupported", name: entry.name }
}

export async function captureDroppedDirectory(
  items: readonly DroppedDataTransferItemLike[],
): Promise<DirectoryHandleLike | undefined> {
  // Browser drop handles must be captured synchronously inside the drop event.
  // Build every promise/legacy entry before the first await.
  const captured = items.map((item) => ({
    modern: item.getAsFileSystemHandle?.(),
    legacy: item.webkitGetAsEntry?.() ?? undefined,
  }))
  for (const candidate of captured) {
    const modern = await candidate.modern
    if (modern?.kind === "directory") return modern as DirectoryHandleLike
    if (candidate.legacy?.isDirectory) {
      return legacyHandle(candidate.legacy) as DirectoryHandleLike
    }
  }
  return undefined
}

export function createDroppedSnapshotProvider(
  root: DirectoryHandleLike,
  options: Omit<
    SnapshotProviderOptions,
    "rootLabel" | "sourceKind"
  > = {},
): SnapshotSourceProvider {
  const acceptedAt = (options.now ?? (() => new Date()))().toISOString()
  const identity = identityFor(
    "dropped-snapshot",
    root.name,
    options,
    acceptedAt,
  ) as SnapshotSourceProvider["identity"]
  const limits = sourceLimits(options.limits)
  const directoryProvider = createPickedFolderProvider(root, {
    ...options,
    createId: () => `${identity.id}_scan`,
  })

  return {
    identity,
    async collect() {
      const collected = await directoryProvider.collect()
      const entries: AcceptedSourceEntry[] = []
      const transferWarnings: SourceWarning[] = []
      let totalBytes = 0
      for (const entry of collected.entries) {
        if (
          totalBytes + entry.bytes.byteLength >
          limits.maxSnapshotTransferBytes
        ) {
          transferWarnings.push({
            path: entry.path,
            code: "snapshot_transfer_limit",
          })
          continue
        }
        entries.push({ ...entry, bytes: entry.bytes.slice() })
        totalBytes += entry.bytes.byteLength
      }
      const manifest = await createSourceManifest(
        entries,
        options.hashBytes ?? sha256,
      )
      const totalWarnings =
        collected.warnings.total + transferWarnings.length
      return {
        entries,
        manifest,
        warnings: {
          details: [
            ...collected.warnings.details,
            ...transferWarnings,
          ].slice(0, limits.maxWarnings),
          total: totalWarnings,
          truncated:
            totalWarnings >
            Math.min(totalWarnings, limits.maxWarnings),
        },
        snapshot: {
          acceptedAt,
          fileCount: entries.length,
          totalBytes,
          manifestFingerprint: manifest.fingerprint,
        },
      }
    },
  }
}
