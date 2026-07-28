import { describe, expect, it, vi } from "vitest"
import type {
  SavedSourceHandle,
  SourceHandleStore,
} from "../local-indexing/source"

type EntryHandle = TestDirectoryHandle | TestFileHandle | { kind: "unsupported"; name: string }

class TestFileHandle {
  readonly kind = "file" as const

  constructor(
    readonly name: string,
    private readonly bytes: Uint8Array,
    readonly read = vi.fn(),
    private readonly declaredSize = bytes.byteLength,
  ) {}

  async getFile() {
    const bytes = this.bytes
    const read = this.read
    return {
      name: this.name,
      size: this.declaredSize,
      lastModified: 123,
      async arrayBuffer() {
        read()
        return bytes.slice().buffer
      },
    }
  }
}

class TestDirectoryHandle {
  readonly kind = "directory" as const
  readonly children: Array<[string, EntryHandle]> = []

  constructor(readonly name: string) {}

  async *entries(): AsyncIterableIterator<[string, EntryHandle]> {
    yield* this.children
  }
}

class PermissionDirectoryHandle extends TestDirectoryHandle {
  readonly queryPermission = vi.fn()
  readonly requestPermission = vi.fn()
  readonly isSameEntry = vi.fn()
}

const bytes = (value: string) => new TextEncoder().encode(value)
const deterministicHash = async (value: Uint8Array) => `hash-${value.byteLength}-${value[0] ?? 0}`

describe("browser-local source providers", () => {
  it("opens picked folders only from direct user activation and mints opaque identity", async () => {
    const source = await import("../local-indexing/source")
    const root = new TestDirectoryHandle("/Users/alice/private-project")
    const picker = vi.fn(async () => root)

    await expect(
      source.openPickedFolderFromUserAction(picker, {
        userActivated: false,
        createId: () => "repo-opaque",
        hashBytes: deterministicHash,
      }),
    ).rejects.toMatchObject({ code: "user_activation_required" })
    expect(picker).not.toHaveBeenCalled()

    const provider = await source.openPickedFolderFromUserAction(picker, {
      userActivated: true,
      createId: () => "repo-opaque",
      hashBytes: deterministicHash,
    })

    expect(picker).toHaveBeenCalledTimes(1)
    expect(provider.identity).toEqual({
      id: "repo-opaque",
      sourceKind: "picked-folder",
      displayName: "private-project",
      virtualRoot: "local://repo-opaque",
      handleRefId: "handle-repo-opaque",
    })
    expect(JSON.stringify(provider.identity)).not.toContain("/Users/")
    expect(provider).not.toHaveProperty("handle")
  })

  it("persists opaque handle identity and reconnects only from direct activation", async () => {
    const source = await import("../local-indexing/source")
    const records = new Map<string, SavedSourceHandle>()
    const store: SourceHandleStore = {
      get: vi.fn(async (handleRefId) => records.get(handleRefId)),
      put: vi.fn(async (record) => {
        records.set(record.identity.handleRefId!, record)
      }),
      delete: vi.fn(async (handleRefId) => {
        records.delete(handleRefId)
      }),
    }
    const registry = new source.SourceHandleRegistry(store)
    const identity = {
      id: "repo-opaque",
      sourceKind: "picked-folder" as const,
      displayName: "project",
      virtualRoot: "local://repo-opaque",
      handleRefId: "handle-repo-opaque",
    }
    const granted = new PermissionDirectoryHandle("project")
    granted.queryPermission.mockResolvedValue("granted")

    await registry.save(identity, granted)
    await expect(registry.restore(identity)).resolves.toMatchObject({
      status: "granted",
      canRefresh: true,
    })
    expect(granted.requestPermission).not.toHaveBeenCalled()
    expect(JSON.stringify(records.get("handle-repo-opaque")?.identity)).not.toContain(
      "/Users/",
    )

    const prompted = new PermissionDirectoryHandle("project")
    prompted.queryPermission.mockResolvedValue("prompt")
    prompted.requestPermission.mockResolvedValue("granted")
    prompted.isSameEntry.mockResolvedValue(true)
    records.set("handle-repo-opaque", { identity, handle: prompted })

    await expect(registry.restore(identity)).resolves.toMatchObject({
      status: "prompt",
      canRefresh: false,
    })
    expect(prompted.requestPermission).not.toHaveBeenCalled()
    await expect(
      registry.reconnect(identity, { userActivated: false }),
    ).rejects.toMatchObject({ code: "user_activation_required" })
    expect(prompted.requestPermission).not.toHaveBeenCalled()
    await expect(
      registry.reconnect(identity, { userActivated: true }),
    ).resolves.toMatchObject({ status: "granted", canRefresh: true })
    expect(prompted.requestPermission).toHaveBeenCalledTimes(1)
  })

  it("rejects stale, denied, mismatched, and host-path handle identities", async () => {
    const source = await import("../local-indexing/source")
    const records = new Map<string, SavedSourceHandle>()
    const store: SourceHandleStore = {
      get: async (handleRefId) => records.get(handleRefId),
      put: async (record) => {
        records.set(record.identity.handleRefId!, record)
      },
      delete: async (handleRefId) => {
        records.delete(handleRefId)
      },
    }
    const registry = new source.SourceHandleRegistry(store)
    const identity = {
      id: "repo-opaque",
      sourceKind: "picked-folder" as const,
      displayName: "project",
      virtualRoot: "local://repo-opaque",
      handleRefId: "handle-repo-opaque",
    }

    await expect(registry.restore(identity)).resolves.toMatchObject({
      status: "stale",
      canRefresh: false,
    })

    const denied = new PermissionDirectoryHandle("project")
    denied.queryPermission.mockResolvedValue("denied")
    denied.requestPermission.mockResolvedValue("denied")
    records.set("handle-repo-opaque", { identity, handle: denied })
    await expect(
      registry.reconnect(identity, { userActivated: true }),
    ).rejects.toMatchObject({ code: "permission_denied" })

    const saved = new PermissionDirectoryHandle("project")
    saved.queryPermission.mockResolvedValue("granted")
    saved.isSameEntry.mockResolvedValue(false)
    records.set("handle-repo-opaque", { identity, handle: saved })
    await expect(
      registry.reconnect(identity, {
        userActivated: true,
        candidate: new PermissionDirectoryHandle("different"),
      }),
    ).rejects.toMatchObject({ code: "source_mismatch" })

    await expect(
      registry.save(
        {
          ...identity,
          id: "/Users/alice/project",
          virtualRoot: "local:///Users/alice/project",
        },
        saved,
      ),
    ).rejects.toMatchObject({ code: "invalid_source_identity" })
  })

  it("derives bounded POSIX paths from ancestry and rejects cycles, duplicates, ignores, and oversize reads", async () => {
    const source = await import("../local-indexing/source")
    const root = new TestDirectoryHandle("project")
    const src = new TestDirectoryHandle("src")
    const main = new TestFileHandle("main.ts", bytes("export const main = true"))
    const duplicate = new TestFileHandle("main.ts", bytes("duplicate"))
    const ignored = new TestFileHandle("secret.ts", bytes("do not read"))
    const oversizedRead = vi.fn()
    const oversized = new TestFileHandle("huge.ts", bytes("x"), oversizedRead, 101)
    const traversal = new TestFileHandle("..", bytes("escape"))

    src.children.push(
      ["main.ts", main],
      ["main.ts", duplicate],
      ["secret.ts", ignored],
      ["huge.ts", oversized],
      ["..", traversal],
      ["loop", root],
      ["device", { kind: "unsupported", name: "device" }],
    )
    root.children.push(["src", src])

    const provider = source.createPickedFolderProvider(root, {
      createId: () => "repo-1",
      hashBytes: deterministicHash,
      ignorePatterns: ["src/secret.ts"],
      limits: {
        maxDepth: 4,
        maxFiles: 20,
        maxFileBytes: 100,
        maxTotalBytes: 1_000,
        maxSnapshotTransferBytes: 1_000,
        maxWarnings: 100,
      },
    })
    const result = await provider.collect()

    expect(result.entries.map((entry) => entry.path)).toEqual(["src/main.ts"])
    expect(result.manifest.entries.map((entry) => entry.path)).toEqual(["src/main.ts"])
    expect(result.warnings.details.map((warning) => warning.code).sort()).toEqual([
      "duplicate_source_path",
      "file_too_large",
      "ignored_path",
      "invalid_source_path",
      "recursive_cycle",
      "unsupported_entry_kind",
    ])
    expect(result.warnings).toMatchObject({ total: 6, truncated: false })
    expect(ignored.read).not.toHaveBeenCalled()
    expect(oversizedRead).not.toHaveBeenCalled()
    expect(duplicate.read).not.toHaveBeenCalled()
    expect(traversal.read).not.toHaveBeenCalled()
  })

  it("caps warning details while retaining aggregate counts", async () => {
    const source = await import("../local-indexing/source")
    const root = new TestDirectoryHandle("project")
    for (let index = 0; index < 6; index += 1) {
      root.children.push(["..", new TestFileHandle(`bad-${index}`, bytes("bad"))])
    }

    const result = await source
      .createPickedFolderProvider(root, {
        createId: () => "repo-2",
        hashBytes: deterministicHash,
        limits: {
          maxDepth: 2,
          maxFiles: 10,
          maxFileBytes: 100,
          maxTotalBytes: 1_000,
          maxSnapshotTransferBytes: 1_000,
          maxWarnings: 3,
        },
      })
      .collect()

    expect(result.warnings).toMatchObject({ total: 6, truncated: true })
    expect(result.warnings.details).toHaveLength(3)
    expect(result.entries).toEqual([])
  })

  it("diffs manifests deterministically by content hash", async () => {
    const source = await import("../local-indexing/source")
    expect(
      source.diffSourceManifests(
        {
          fingerprint: "before",
          entries: [
            { path: "changed.ts", contentHash: "old", size: 1 },
            { path: "deleted.ts", contentHash: "deleted", size: 1 },
            { path: "unchanged.ts", contentHash: "same", size: 1 },
          ],
        },
        {
          fingerprint: "after",
          entries: [
            { path: "added.ts", contentHash: "added", size: 1 },
            { path: "changed.ts", contentHash: "new", size: 1 },
            { path: "unchanged.ts", contentHash: "same", size: 99 },
          ],
        },
      ),
    ).toEqual({
      added: ["added.ts"],
      changed: ["changed.ts"],
      deleted: ["deleted.ts"],
      unchanged: ["unchanged.ts"],
    })
  })

  it("builds immutable snapshot manifests without path leakage or rejected payloads", async () => {
    const source = await import("../local-indexing/source")
    const input = [
      { kind: "file" as const, path: "src/main.ts", bytes: bytes("export const value = 1") },
      { kind: "file" as const, path: "src\\main.ts", bytes: bytes("duplicate") },
      { kind: "file" as const, path: "/Users/alice/secret.ts", bytes: bytes("secret") },
      { kind: "file" as const, path: "dist/out.ts", bytes: bytes("ignored") },
      { kind: "file" as const, path: "src/huge.ts", bytes: new Uint8Array(101) },
    ]

    const provider = source.createSnapshotProvider(input, {
      rootLabel: "/Users/alice/project",
      createId: () => "snapshot-opaque",
      hashBytes: deterministicHash,
      ignorePatterns: ["dist/"],
      limits: {
        maxDepth: 4,
        maxFiles: 20,
        maxFileBytes: 100,
        maxTotalBytes: 1_000,
        maxSnapshotTransferBytes: 1_000,
        maxWarnings: 100,
      },
    })
    const first = await provider.collect()
    const second = await provider.collect()

    expect(provider.identity).toEqual({
      id: "snapshot-opaque",
      sourceKind: "snapshot",
      displayName: "project",
      virtualRoot: "local://snapshot-opaque",
    })
    expect(JSON.stringify(provider.identity)).not.toContain("/Users/")
    expect(first.entries.map((entry) => entry.path)).toEqual(["src/main.ts"])
    expect(first.manifest.entries).toEqual(second.manifest.entries)
    expect(first.manifest.fingerprint).toBe(second.manifest.fingerprint)
    expect(first.warnings.details.map((warning) => warning.code).sort()).toEqual([
      "duplicate_source_path",
      "file_too_large",
      "ignored_path",
      "invalid_source_path",
    ])
    expect(first.entries[0]?.bytes).not.toBe(input[0]?.bytes)
  })

  it("rejects snapshot transfer and traversal budgets before accepting payloads", async () => {
    const source = await import("../local-indexing/source")
    const provider = source.createSnapshotProvider(
      [
        { kind: "file", path: "a.ts", bytes: new Uint8Array(6) },
        { kind: "file", path: "b.ts", bytes: new Uint8Array(6) },
        { kind: "file", path: "deep/nested/file.ts", bytes: new Uint8Array(1) },
      ],
      {
        rootLabel: "budget",
        createId: () => "snapshot-budget",
        hashBytes: deterministicHash,
        limits: {
          maxDepth: 2,
          maxFiles: 10,
          maxFileBytes: 10,
          maxTotalBytes: 100,
          maxSnapshotTransferBytes: 10,
          maxWarnings: 100,
        },
      },
    )
    const result = await provider.collect()

    expect(result.entries.map((entry) => entry.path)).toEqual(["a.ts"])
    expect(result.warnings.details.map((warning) => warning.code).sort()).toEqual([
      "max_depth_exceeded",
      "snapshot_transfer_limit",
    ])
  })
})

describe("browser-local SQLite generation contract", () => {
  it("uses the canonical schema version and opaque absolute SAH-pool filenames", async () => {
    const sqlite = await import("../local-indexing/sqlite")

    expect(sqlite.BROWSER_SCHEMA_VERSION).toBe(12)
    expect(sqlite.registryDatabasePath()).toBe("/codegraph/browser/registry.sqlite3")
    expect(sqlite.generationDatabasePath("repo_opaque-1", 7)).toBe(
      "/codegraph/browser/repositories/repo_opaque-1/generations/7.sqlite3",
    )
    expect(() => sqlite.generationDatabasePath("/Users/alice/repo", 1)).toThrow(
      /opaque repository id/,
    )
    expect(() => sqlite.generationDatabasePath("repo", 0)).toThrow(/positive integer/)
  })
})

describe("versioned local-index worker RPC", () => {
  const request = (
    overrides: Record<string, unknown> = {},
  ) => ({
    protocolVersion: 1 as const,
    requestId: "request-1",
    operationId: "operation-1",
    repositoryId: "repo_opaque",
    kind: "index" as const,
    payload: {
      generation: {},
      grammarLoads: ["typescript"],
      workItems: 100,
      estimatedPayloadBytes: 1024,
    },
    ...overrides,
  })

  it("declares exact worker budgets and lazily loads each grammar once", async () => {
    const worker = await import("../local-indexing/worker")
    const emitted: unknown[] = []
    const store = {
      publishGeneration: vi.fn(async () => ({ generation: 1 })),
      close: vi.fn(() => ({ paused: true })),
    }
    const loadGrammars = vi.fn(async () => undefined)
    const releaseGrammars = vi.fn()
    const runtime = worker.createWorkerRuntime({
      store,
      loadGrammars,
      releaseGrammars,
      emit: (message) => emitted.push(message),
      yieldControl: async () => undefined,
    })

    expect(worker.WORKER_BUDGETS).toEqual({
      maxFilesPerReadBatch: 64,
      maxBytesPerReadBatch: 4 * 1024 * 1024,
      maxBytesPerWorkerPayload: 8 * 1024 * 1024,
      maxBytesPerSnapshotTransfer: 64 * 1024 * 1024,
      maxProgressEventsPerSecond: 10,
      maxEmbeddingBatchItems: 32,
      maxVectorRowsPerTransaction: 500,
    })

    await runtime.handle(request())
    await runtime.handle(
      request({
        requestId: "request-2",
        operationId: "operation-2",
      }),
    )

    expect(loadGrammars).toHaveBeenCalledTimes(1)
    expect(loadGrammars).toHaveBeenCalledWith(["typescript"])
    expect(store.publishGeneration).toHaveBeenCalledTimes(2)
    const progress = emitted.filter(
      (message) => (message as { type?: string }).type === "progress",
    )
    expect(progress.length).toBeLessThanOrEqual(12)
    const terminals = emitted.filter(
      (message) => (message as { terminal?: string }).terminal !== undefined,
    )
    expect(terminals.map((message) => (message as { terminal: string }).terminal)).toEqual([
      "complete",
      "complete",
    ])
    expect(() => structuredClone(emitted)).not.toThrow()

    await runtime.handle({
      protocolVersion: 1,
      requestId: "close-1",
      kind: "close",
    })
    expect(releaseGrammars).toHaveBeenCalledTimes(1)
    expect(store.close).toHaveBeenCalledTimes(1)
  })

  it("cancels operation-scoped work without publishing or emitting multiple terminals", async () => {
    const worker = await import("../local-indexing/worker")
    const emitted: unknown[] = []
    const store = {
      publishGeneration: vi.fn(async () => ({ generation: 1 })),
      close: vi.fn(() => ({ paused: true })),
    }
    let releaseYield: (() => void) | undefined
    const firstYield = new Promise<void>((resolve) => {
      releaseYield = resolve
    })
    let yielded = false
    const runtime = worker.createWorkerRuntime({
      store,
      loadGrammars: async () => undefined,
      releaseGrammars: () => undefined,
      emit: (message) => emitted.push(message),
      yieldControl: async () => {
        if (!yielded) {
          yielded = true
          await firstYield
        }
      },
    })

    const active = runtime.handle(request())
    await vi.waitFor(() => expect(yielded).toBe(true))
    await runtime.handle({
      protocolVersion: 1,
      requestId: "cancel-1",
      operationId: "operation-1",
      repositoryId: "repo_opaque",
      kind: "cancel",
    })
    releaseYield?.()
    await active

    expect(store.publishGeneration).not.toHaveBeenCalled()
    expect(
      emitted.filter(
        (message) =>
          (message as { operationId?: string; terminal?: string }).operationId === "operation-1" &&
          (message as { terminal?: string }).terminal !== undefined,
      ),
    ).toEqual([
      expect.objectContaining({
        terminal: "cancelled",
        error: expect.objectContaining({ code: "operation_cancelled" }),
      }),
    ])

    await runtime.handle({
      protocolVersion: 1,
      requestId: "cancel-stale",
      operationId: "operation-missing",
      kind: "cancel",
    })
    expect(emitted.at(-1)).toMatchObject({
      type: "result",
      result: { cancelled: false, noop: true },
    })
  })

  it("treats cancellation after atomic publication begins as a no-op", async () => {
    const worker = await import("../local-indexing/worker")
    const emitted: unknown[] = []
    let finishPublish: (() => void) | undefined
    let publishing = false
    const store = {
      publishGeneration: vi.fn(
        () =>
          new Promise<{ generation: number }>((resolve) => {
            publishing = true
            finishPublish = () => resolve({ generation: 1 })
          }),
      ),
      close: vi.fn(() => ({ paused: true })),
    }
    const runtime = worker.createWorkerRuntime({
      store,
      loadGrammars: async () => undefined,
      releaseGrammars: () => undefined,
      emit: (message) => emitted.push(message),
      yieldControl: async () => undefined,
    })

    const active = runtime.handle(request())
    await vi.waitFor(() => expect(publishing).toBe(true))
    await runtime.handle({
      protocolVersion: 1,
      requestId: "cancel-publishing",
      operationId: "operation-1",
      repositoryId: "repo_opaque",
      kind: "cancel",
    })
    finishPublish?.()
    await active

    expect(
      emitted.find(
        (message) => (message as { requestId?: string }).requestId === "cancel-publishing",
      ),
    ).toMatchObject({
      type: "result",
      result: { cancelled: false, noop: true },
    })
    expect(
      emitted.filter(
        (message) =>
          (message as { operationId?: string; terminal?: string }).operationId === "operation-1" &&
          (message as { terminal?: string }).terminal !== undefined,
      ),
    ).toEqual([expect.objectContaining({ terminal: "complete" })])
  })

  it("fails closed on protocol and payload budgets with plain redacted errors", async () => {
    const worker = await import("../local-indexing/worker")
    const emitted: unknown[] = []
    const store = {
      publishGeneration: vi.fn(async () => {
        throw new Error("secret source contents")
      }),
      close: vi.fn(() => ({ paused: true })),
    }
    const loadGrammars = vi.fn(async () => undefined)
    const runtime = worker.createWorkerRuntime({
      store,
      loadGrammars,
      releaseGrammars: () => undefined,
      emit: (message) => emitted.push(message),
      yieldControl: async () => undefined,
    })

    await runtime.handle(request({ protocolVersion: 2 }))
    await runtime.handle(
      request({
        requestId: "request-budget",
        operationId: "operation-budget",
        payload: {
          generation: {},
          grammarLoads: [],
          workItems: 1,
          estimatedPayloadBytes: worker.WORKER_BUDGETS.maxBytesPerWorkerPayload + 1,
        },
      }),
    )
    await runtime.handle(
      request({
        requestId: "request-error",
        operationId: "operation-error",
      }),
    )

    expect(loadGrammars).toHaveBeenCalledTimes(1)
    expect(store.publishGeneration).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(emitted)).not.toContain("secret source contents")
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "failure",
          terminal: "failed",
          error: expect.objectContaining({ code: "unsupported_protocol" }),
        }),
        expect.objectContaining({
          type: "failure",
          terminal: "failed",
          error: expect.objectContaining({ code: "worker_payload_too_large" }),
        }),
        expect.objectContaining({
          type: "failure",
          terminal: "failed",
          error: expect.objectContaining({
            code: "worker_operation_failed",
            message: "The local indexing operation failed.",
          }),
        }),
      ]),
    )
    expect(() => structuredClone(emitted)).not.toThrow()
  })
})
