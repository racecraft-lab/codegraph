import { describe, expect, it, vi } from "vitest"
import { createRemoteRepositoryClient, RepositoryClientError } from "../lib/repository-client"
import { LocalRepositoryClient } from "../local-indexing/client"
import {
  SourceHandleRegistry,
  type DirectoryHandleLike,
  type SavedSourceHandle,
  type SnapshotRegistryRecord,
  type SnapshotRepositoryRegistry,
  type SourceHandleStore,
  type SourceIdentity,
} from "../local-indexing/source"

class TestWorker extends EventTarget {
  readonly postMessage = vi.fn()
  readonly terminate = vi.fn()

  respond(message: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: message }))
  }
}

function sourceRegistry() {
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
  return new SourceHandleRegistry(store)
}

const pickedIdentity: SourceIdentity = {
  id: "local-1",
  sourceKind: "picked-folder",
  displayName: "project",
  virtualRoot: "local://local-1",
  handleRefId: "handle-local-1",
}

describe("shared repository client boundary", () => {
  it("stages large source collections in bounded worker batches before indexing", async () => {
    const worker = new TestWorker()
    const requestIds = ["batch-1", "batch-2", "open-final"]
    const client = new LocalRepositoryClient(worker, {
      createId: () => requestIds.shift()!,
    })
    const entries = Array.from({ length: 65 }, (_, index) => ({
      kind: "file" as const,
      path: `src/file-${index}.ts`,
      bytes: new Uint8Array([index]),
      contentHash: `hash-${index}`,
      size: 1,
    }))
    const collection = {
      entries,
      manifest: {
        entries: entries.map(({ path, contentHash, size }) => ({
          path,
          contentHash,
          size,
        })),
        fingerprint: "manifest-large",
      },
      warnings: { details: [], total: 0, truncated: false },
    }

    const pending = client.openPickedFolder(
      { identity: pickedIdentity, collection },
      pickedIdentity.id,
      "operation-large",
    )
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
    expect(worker.postMessage.mock.calls[0]?.[0]).toMatchObject({
      requestId: "batch-1",
      operationId: "operation-large",
      repositoryId: pickedIdentity.id,
      kind: "source-batch",
      payload: {
        batchIndex: 0,
        batchCount: 2,
        totalFiles: 65,
        totalBytes: 65,
        entries: expect.arrayContaining([
          expect.objectContaining({ path: "src/file-0.ts" }),
        ]),
      },
    })
    expect(
      (
        worker.postMessage.mock.calls[0]?.[0] as {
          payload: { entries: unknown[] }
        }
      ).payload.entries,
    ).toHaveLength(64)
    expect(worker.postMessage.mock.calls[0]?.[1]).toHaveLength(64)
    worker.respond({
      protocolVersion: 1,
      requestId: "batch-1",
      operationId: "operation-large",
      repositoryId: pickedIdentity.id,
      type: "result",
      result: { batchIndex: 0 },
    })

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2))
    expect(worker.postMessage.mock.calls[1]?.[0]).toMatchObject({
      requestId: "batch-2",
      kind: "source-batch",
      payload: {
        batchIndex: 1,
        batchCount: 2,
        entries: [expect.objectContaining({ path: "src/file-64.ts" })],
      },
    })
    expect(worker.postMessage.mock.calls[1]?.[1]).toHaveLength(1)
    worker.respond({
      protocolVersion: 1,
      requestId: "batch-2",
      operationId: "operation-large",
      repositoryId: pickedIdentity.id,
      type: "result",
      result: { batchIndex: 1 },
    })

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(3))
    expect(worker.postMessage.mock.calls[2]?.[0]).toMatchObject({
      requestId: "open-final",
      operationId: "operation-large",
      repositoryId: pickedIdentity.id,
      kind: "open-picked-folder",
      payload: {
        identity: pickedIdentity,
        collection: { entries: [] },
        sourceBatches: {
          batchCount: 2,
          totalFiles: 65,
          totalBytes: 65,
        },
      },
    })
    worker.respond({
      protocolVersion: 1,
      requestId: "open-final",
      operationId: "operation-large",
      repositoryId: pickedIdentity.id,
      type: "result",
      terminal: "complete",
      result: {
        id: pickedIdentity.id,
        root: pickedIdentity.virtualRoot,
        name: pickedIdentity.displayName,
        default: false,
        runtime: "local",
        sourceKind: "picked-folder",
      },
    })

    await expect(pending).resolves.toMatchObject({ id: pickedIdentity.id })
  })

  it("imports duplicate snapshots as distinct repositories and requires explicit replacement", async () => {
    const worker = new TestWorker()
    const records = new Map<string, SnapshotRegistryRecord>([
      [
        "snapshot-existing",
        {
          repositoryId: "snapshot-existing",
          displayName: "Earlier project",
          sourceKind: "dropped-snapshot",
          acceptedAt: "2026-07-28T10:00:00.000Z",
          manifestFingerprint: "manifest-same",
          fileCount: 1,
          totalBytes: 21,
        },
      ],
    ])
    const snapshotRegistry: SnapshotRepositoryRegistry = {
      list: vi.fn(async () => [...records.values()]),
      put: vi.fn(async (record) => {
        records.set(record.repositoryId, record)
      }),
      delete: vi.fn(async (repositoryId) => {
        records.delete(repositoryId)
      }),
    }
    const client = new LocalRepositoryClient(worker, {
      createId: () => "snapshot-operation",
      snapshotRegistry,
    })
    const identity: SourceIdentity = {
      id: "snapshot-new",
      sourceKind: "dropped-snapshot",
      displayName: "project",
      virtualRoot: "local://snapshot-new",
      acceptedAt: "2026-07-28T11:15:00.000Z",
    }
    const collection = {
      entries: [],
      manifest: { entries: [], fingerprint: "manifest-same" },
      warnings: { details: [], total: 0, truncated: false },
      snapshot: {
        acceptedAt: "2026-07-28T11:15:00.000Z",
        fileCount: 0,
        totalBytes: 0,
        manifestFingerprint: "manifest-same",
      },
    }

    const pending = client.importSnapshot({ identity, collection })
    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalledWith({
        protocolVersion: 1,
        requestId: "snapshot-operation",
        operationId: "snapshot-operation",
        repositoryId: "snapshot-new",
        kind: "import-snapshot",
        payload: { identity, collection },
      })
    })
    worker.respond({
      protocolVersion: 1,
      requestId: "snapshot-operation",
      operationId: "snapshot-operation",
      repositoryId: "snapshot-new",
      type: "result",
      terminal: "complete",
      result: {
        id: "snapshot-new",
        root: "local://snapshot-new",
        name: "project",
        default: false,
        runtime: "local",
        sourceKind: "dropped-snapshot",
      },
    })

    await expect(pending).resolves.toMatchObject({
      id: "snapshot-new",
      sourceKind: "dropped-snapshot",
      snapshotImportedAt: "2026-07-28T11:15:00.000Z",
      manifestFingerprint: "manifest-same",
      duplicateSnapshot: {
        repositoryId: "snapshot-existing",
        displayName: "Earlier project",
      },
    })
    expect(records.has("snapshot-existing")).toBe(true)
    expect(records.has("snapshot-new")).toBe(true)
    await expect(client.refresh("snapshot-new")).rejects.toMatchObject({
      code: "capability_unavailable",
    })
    expect(worker.postMessage).toHaveBeenCalledTimes(1)

    await expect(
      client.importSnapshot({
        identity,
        collection,
        replace: {
          repositoryId: "snapshot-existing",
          confirmed: false,
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" })
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
  })

  it("inspects storage without prompting and requests persistence only explicitly", async () => {
    const storageManager = {
      estimate: vi.fn().mockResolvedValue({
        usage: 1_048_576,
        quota: 4_194_304,
      }),
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(false),
    }
    const client = new LocalRepositoryClient(new TestWorker(), {
      storageManager,
    })

    await expect(client.getStorageStatus()).resolves.toEqual({
      usageBytes: 1_048_576,
      quotaBytes: 4_194_304,
      persisted: "denied",
    })
    expect(storageManager.persist).not.toHaveBeenCalled()

    await expect(client.requestPersistentStorage()).resolves.toEqual({
      usageBytes: 1_048_576,
      quotaBytes: 4_194_304,
      persisted: "denied",
    })
    expect(storageManager.persist).toHaveBeenCalledTimes(1)
  })

  it("degrades storage reporting when estimate or persistence APIs are absent", async () => {
    const client = new LocalRepositoryClient(new TestWorker(), {
      storageManager: {},
    })

    await expect(client.getStorageStatus()).resolves.toEqual({
      persisted: "not-supported",
    })
    await expect(client.requestPersistentStorage()).resolves.toEqual({
      persisted: "not-supported",
    })
  })

  it("deletes browser-owned state without writing to the source folder", async () => {
    const worker = new TestWorker()
    const registry = sourceRegistry()
    const createWritable = vi.fn()
    const handle: DirectoryHandleLike & {
      createWritable: typeof createWritable
    } = {
      kind: "directory",
      name: "project",
      values: async function* () {},
      queryPermission: vi.fn().mockResolvedValue("granted"),
      requestPermission: vi.fn().mockResolvedValue("granted"),
      isSameEntry: vi.fn().mockResolvedValue(true),
      createWritable,
    }
    const client = new LocalRepositoryClient(worker, {
      createId: vi.fn().mockReturnValue("delete-request"),
      sourceRegistry: registry,
    })
    await client.savePickedFolder(pickedIdentity, handle)

    const deleting = client.deleteRepository("local-1", {
      cancelActive: true,
    })
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      protocolVersion: 1,
      requestId: "delete-request",
      repositoryId: "local-1",
      kind: "delete",
      payload: { cancelActive: true },
    })
    worker.respond({
      protocolVersion: 1,
      requestId: "delete-request",
      repositoryId: "local-1",
      type: "result",
      terminal: "complete",
      result: { deleted: true },
    })

    await expect(deleting).resolves.toBeUndefined()
    expect(client.sourceConnection("local-1")).toBeUndefined()
    expect(createWritable).not.toHaveBeenCalled()
  })

  it("bridges existing REST behavior through the shared response shapes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: "server", root: "/repo", name: "Repo", default: true }]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ id: "node-1", kind: "function", name: "main" }],
            total: 1,
            limit: 20,
            offset: 0,
            degraded: false,
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal("fetch", fetchMock)
    const client = createRemoteRepositoryClient()

    await expect(client.listRepositories()).resolves.toEqual([
      { id: "server", root: "/repo", name: "Repo", default: true },
    ])
    await expect(client.search("server", { query: "main", limit: 20 })).resolves.toMatchObject({
      total: 1,
      degraded: false,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/repos",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    )
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/search?q=main&limit=20&repo=server")
    await expect(client.getSource("server", "node-1")).rejects.toMatchObject({
      code: "capability_unavailable",
    })
  })

  it("correlates local worker requests and ignores stale progress and results", async () => {
    const worker = new TestWorker()
    const client = new LocalRepositoryClient(worker, {
      createId: vi.fn().mockReturnValueOnce("request-active"),
    })
    const pending = client.search("local-1", { query: "main", limit: 10 })

    expect(worker.postMessage).toHaveBeenCalledWith({
      protocolVersion: 1,
      requestId: "request-active",
      repositoryId: "local-1",
      kind: "query",
      payload: {
        query: "search",
        request: { query: "main", limit: 10 },
      },
    })
    worker.respond({
      protocolVersion: 1,
      requestId: "request-stale",
      type: "result",
      terminal: "complete",
      result: { items: [{ id: "wrong" }], total: 1 },
    })
    worker.respond({
      protocolVersion: 1,
      requestId: "request-active",
      operationId: "old-operation",
      type: "progress",
      phase: "parse",
      completed: 9,
      total: 10,
    })

    let settled = false
    void pending.finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    const result = {
      items: [{ id: "node-1", kind: "function", name: "main" }],
      total: 1,
      limit: 10,
      offset: 0,
      degraded: false,
    }
    worker.respond({
      protocolVersion: 1,
      requestId: "request-active",
      type: "result",
      terminal: "complete",
      result,
    })
    await expect(pending).resolves.toEqual(result)
  })

  it("clamps relationship pages and graph/impact depth identically for remote and local clients", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              items: [],
              total: 0,
              limit: 500,
              offset: 0,
            }),
            { status: 200 },
          ),
        ),
      )
    vi.stubGlobal("fetch", fetchMock)
    const remote = createRemoteRepositoryClient()

    await remote.getCallers("server", "node-1", {
      limit: 999,
      offset: 0,
    })
    await remote.getGraph("server", "node-1", { depth: 99 })
    await remote.getImpact("server", "node-1")

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/callers/node-1?limit=500&offset=0&repo=server",
    )
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/graph/node-1?depth=3&repo=server",
    )
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "/api/impact/node-1?depth=3&repo=server",
    )

    const worker = new TestWorker()
    const local = new LocalRepositoryClient(worker, {
      createId: vi
        .fn()
        .mockReturnValueOnce("request-callers")
        .mockReturnValueOnce("request-graph")
        .mockReturnValueOnce("request-impact"),
    })
    const callers = local.getCallers("local-1", "node-1", {
      limit: 999,
      offset: 0,
    })
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      protocolVersion: 1,
      requestId: "request-callers",
      repositoryId: "local-1",
      kind: "query",
      payload: {
        query: "callers",
        request: { nodeId: "node-1", limit: 500, offset: 0 },
      },
    })
    worker.respond({
      protocolVersion: 1,
      requestId: "request-callers",
      type: "result",
      result: { items: [], total: 0, limit: 500, offset: 0 },
    })
    await callers

    const graph = local.getGraph("local-1", "node-1", { depth: 99 })
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      protocolVersion: 1,
      requestId: "request-graph",
      repositoryId: "local-1",
      kind: "query",
      payload: {
        query: "graph",
        request: { nodeId: "node-1", depth: 3 },
      },
    })
    worker.respond({
      protocolVersion: 1,
      requestId: "request-graph",
      type: "result",
      result: { nodes: [], edges: [], truncated: false },
    })
    await graph

    const impact = local.getImpact("local-1", "node-1")
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      protocolVersion: 1,
      requestId: "request-impact",
      repositoryId: "local-1",
      kind: "query",
      payload: {
        query: "impact",
        request: { nodeId: "node-1", depth: 3 },
      },
    })
    worker.respond({
      protocolVersion: 1,
      requestId: "request-impact",
      type: "result",
      result: { nodes: [], edges: [], truncated: false },
    })
    await impact
  })

  it("normalizes local failures and exposes the complete shared method surface", async () => {
    const worker = new TestWorker()
    const client = new LocalRepositoryClient(worker, {
      createId: () => "request-error",
    })

    const expectedMethods = [
      "listRepositories",
      "getRepositoryStatus",
      "getOverview",
      "search",
      "getNode",
      "getSource",
      "getCallers",
      "getCallees",
      "getGraph",
      "getImpact",
      "refresh",
      "cancel",
      "deleteRepository",
    ] as const
    for (const method of expectedMethods) expect(client[method]).toEqual(expect.any(Function))

    const pending = client.getNode("local-1", "missing")
    worker.respond({
      protocolVersion: 1,
      requestId: "request-error",
      type: "failure",
      terminal: "failed",
      error: {
        code: "capability_unavailable",
        message: "This local query is not available.",
        retryable: false,
        phase: "query",
      },
    })
    await expect(pending).rejects.toEqual(
      expect.objectContaining({
        name: "RepositoryClientError",
        code: "capability_unavailable",
        message: "This local query is not available.",
        retryable: false,
      }),
    )
    await expect(
      Promise.reject(new RepositoryClientError("quota_exceeded", "Storage full.", false)),
    ).rejects.toMatchObject({ code: "quota_exceeded" })

    const closing = client.close()
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      protocolVersion: 1,
      requestId: "request-error",
      kind: "close",
    })
    expect(worker.terminate).not.toHaveBeenCalled()
    worker.respond({
      protocolVersion: 1,
      requestId: "request-error",
      type: "result",
      terminal: "complete",
      result: { paused: true },
    })
    await closing
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it("keeps cached reads available but gates refresh until an explicit handle reconnect", async () => {
    const worker = new TestWorker()
    const registry = sourceRegistry()
    const client = new LocalRepositoryClient(worker, {
      createId: vi.fn().mockReturnValue("refresh-request"),
      sourceRegistry: registry,
    })

    await expect(client.restorePickedFolder(pickedIdentity)).resolves.toMatchObject({
      status: "stale",
      canRefresh: false,
    })
    expect(client.sourceConnection("local-1")).toMatchObject({
      status: "stale",
      canRefresh: false,
    })
    await expect(client.refresh("local-1")).rejects.toMatchObject({
      code: "permission_denied",
    })
    expect(worker.postMessage).not.toHaveBeenCalled()

    const handle = {
      kind: "directory",
      name: "project",
      async *entries() {},
      queryPermission: vi.fn(async () => "granted" as const),
      requestPermission: vi.fn(async () => "granted" as const),
      isSameEntry: vi.fn(async () => true),
    } satisfies DirectoryHandleLike
    await client.savePickedFolder(pickedIdentity, handle)
    expect(client.sourceConnection("local-1")).toMatchObject({
      status: "granted",
      canRefresh: true,
    })

    const refresh = client.refresh("local-1")
    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          protocolVersion: 1,
          requestId: "refresh-request",
          operationId: "refresh-request",
          repositoryId: "local-1",
          kind: "refresh",
          payload: {
            identity: pickedIdentity,
            collection: expect.objectContaining({
              entries: [],
              warnings: { details: [], total: 0, truncated: false },
            }),
          },
        }),
      ),
    )
    worker.respond({
      protocolVersion: 1,
      requestId: "refresh-request",
      operationId: "refresh-request",
      type: "result",
      terminal: "complete",
      result: { generation: 2 },
    })
    await expect(refresh).resolves.toEqual({ generation: 2 })
  })
})
