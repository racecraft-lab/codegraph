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

export type SourceKind = "picked-folder" | "snapshot"

export interface SourceIdentity {
  id: string
  sourceKind: SourceKind
  displayName: string
  virtualRoot: string
  handleRefId?: string
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

export interface SourceManifest {
  entries: Array<Pick<AcceptedSourceEntry, "path" | "contentHash" | "size" | "mtimeHint">>
  fingerprint: string
}

export interface SourceCollection {
  entries: AcceptedSourceEntry[]
  manifest: SourceManifest
  warnings: BoundedWarnings
}

export interface BrowserSourceProvider {
  readonly identity: SourceIdentity
  collect(): Promise<SourceCollection>
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
}

export type SourceHandleLike =
  | FileHandleLike
  | DirectoryHandleLike
  | { readonly kind: string; readonly name: string }

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
}

export class SourceProviderError extends Error {
  readonly code: "user_activation_required"

  constructor(
    code: "user_activation_required",
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
): SourceIdentity {
  const id = (options.createId ?? createOpaqueId)()
  return {
    id,
    sourceKind,
    displayName: safeDisplayName(displayName, sourceKind === "snapshot" ? "Snapshot" : "Local folder"),
    virtualRoot: `local://${id}`,
    ...(sourceKind === "picked-folder" ? { handleRefId: `handle-${id}` } : {}),
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

async function manifestFor(
  entries: readonly AcceptedSourceEntry[],
  hashBytes: (bytes: Uint8Array) => Promise<string>,
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
        manifest: await manifestFor(entries, hashBytes),
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
): BrowserSourceProvider {
  const identity = identityFor("snapshot", options.rootLabel, options)
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
      return {
        entries,
        manifest: await manifestFor(entries, hashBytes),
        warnings: warnings.result(),
      }
    },
  }
}
