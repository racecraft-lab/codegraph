import { expect, test } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function listFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name)
    return entry.isDirectory() ? listFiles(file) : [file]
  })
}

test("publishes and recovers real SQLite-Wasm SAH-pool generations in a worker", async ({
  page,
}) => {
  const workerFile = listFiles(path.join(webRoot, "dist")).find((file) =>
    /local-indexing-worker[^/]*\.js$/.test(file),
  )
  expect(workerFile, "built local-indexing worker").toBeDefined()
  const workerUrl = `/${path.relative(path.join(webRoot, "dist"), workerFile!).replaceAll(path.sep, "/")}`
  const poolName = `spec007-${Date.now()}-${Math.random().toString(16).slice(2)}`

  await page.goto("/")

  const spawnWorker = () =>
    page.evaluate(
      ({ url }) => {
        const worker = new Worker(url, { type: "module" })
        ;(window as typeof window & { spec007Worker?: Worker }).spec007Worker = worker
      },
      { url: workerUrl },
    )

  const request = <T>(kind: string, payload: unknown = {}) =>
    page.evaluate(
      ({ kind: requestKind, payload: requestPayload }) =>
        new Promise<T>((resolve, reject) => {
          const worker = (window as typeof window & { spec007Worker?: Worker }).spec007Worker
          if (!worker) {
            reject(new Error("SPEC-007 worker is not running"))
            return
          }
          const requestId = crypto.randomUUID()
          const timeout = window.setTimeout(() => reject(new Error(`Timed out: ${requestKind}`)), 10_000)
          const onMessage = (event: MessageEvent) => {
            const message = event.data as {
              requestId?: string
              ok?: boolean
              result?: T
              error?: { code?: string; message?: string }
            }
            if (message.requestId !== requestId) return
            window.clearTimeout(timeout)
            worker.removeEventListener("message", onMessage)
            if (message.ok) resolve(message.result as T)
            else reject(new Error(`${message.error?.code}: ${message.error?.message}`))
          }
          worker.addEventListener("message", onMessage)
          worker.postMessage({ requestId, kind: requestKind, payload: requestPayload })
        }),
      { kind, payload },
    )

  const generation = (label: string) => ({
    repositoryId: "repo_opaque",
    manifestFingerprint: `manifest-${label}`,
    manifest: [{ path: "src/main.ts", contentHash: `hash-${label}`, size: label.length }],
    counts: { files: 1, nodes: 1, edges: 0, warnings: 0 },
    warnings: [],
    sources: [
      {
        path: "src/main.ts",
        contentHash: `hash-${label}`,
        language: "typescript",
        size: label.length,
        text: `export const value = "${label}"`,
      },
    ],
    nodes: [
      {
        id: `node-${label}`,
        kind: "variable",
        name: `value${label}`,
        qualifiedName: `src/main.ts::value${label}`,
        filePath: "src/main.ts",
        language: "typescript",
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 5,
        isExported: true,
        updatedAt: 1,
      },
    ],
    edges: [],
  })

  const relationshipGeneration = () => {
    const node = (id: string, name = id, filePath = "src/main.ts") => ({
      id,
      kind: "function",
      name,
      qualifiedName: `${filePath}::${name}`,
      filePath,
      language: "typescript",
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 5,
      isExported: true,
      updatedAt: 1,
    })
    const leaves = Array.from({ length: 2_005 }, (_, index) =>
      node(`leaf-${index.toString().padStart(4, "0")}`),
    )
    const nodes = [
      node("root"),
      node("callee", "callee", "src/callee.ts"),
      node("caller-a", "caller-a", "src/caller-a.ts"),
      node("caller-b", "caller-b", "src/caller-b.ts"),
      node("caller-upstream", "caller-upstream", "src/caller-upstream.ts"),
      node("isolated", "isolated", "src/isolated.ts"),
      ...leaves,
    ]
    const edges = [
      {
        source: "root",
        target: "callee",
        kind: "calls",
        provenance: "tree-sitter",
      },
      {
        source: "caller-a",
        target: "root",
        kind: "calls",
        provenance: "tree-sitter",
      },
      {
        source: "caller-b",
        target: "root",
        kind: "calls",
        provenance: "tree-sitter",
      },
      {
        source: "caller-upstream",
        target: "caller-a",
        kind: "references",
        provenance: "tree-sitter",
      },
      ...leaves.map((leaf) => ({
        source: "root",
        target: leaf.id,
        kind: "references",
        provenance: "tree-sitter",
      })),
    ]
    return {
      repositoryId: "repo_opaque",
      manifestFingerprint: "manifest-relationships",
      manifest: [
        {
          path: "src/main.ts",
          contentHash: "hash-relationships",
          size: 1,
        },
      ],
      counts: {
        files: 1,
        nodes: nodes.length,
        edges: edges.length,
        warnings: 0,
      },
      warnings: [],
      sources: [
        {
          path: "src/main.ts",
          contentHash: "hash-relationships",
          language: "typescript",
          size: 1,
          text: "export function root() {}",
        },
      ],
      nodes,
      edges,
    }
  }

  const unpublishedGeneration = {
    ...generation("unpublished"),
    nodes: [
      {
        ...generation("unpublished").nodes[0],
        id: "root",
        name: "stale-root",
      },
      {
        ...generation("unpublished").nodes[0],
        id: "caller-stale",
        name: "caller-stale",
      },
    ],
    edges: [
      {
        source: "caller-stale",
        target: "root",
        kind: "calls",
        provenance: "tree-sitter",
      },
    ],
  }

  const recoveryGeneration = (label: string) => {
    const candidate = generation(`recovery-${label}`)
    return {
      ...candidate,
      repositoryId: "repo_recovery",
    }
  }

  const refreshInitialGeneration = {
    repositoryId: "repo_refresh",
    manifestFingerprint: "refresh-initial",
    manifest: {
      fingerprint: "refresh-initial",
      entries: [
        { path: "changed.ts", contentHash: "changed-old", size: 30 },
        { path: "deleted.ts", contentHash: "deleted", size: 28 },
        { path: "unchanged.ts", contentHash: "unchanged", size: 27 },
      ],
    },
    counts: { files: 3, nodes: 6, edges: 3, warnings: 0 },
    warnings: [],
    sources: [
      {
        path: "changed.ts",
        contentHash: "changed-old",
        language: "typescript",
        size: 30,
        text: "export function oldValue() {}",
      },
      {
        path: "deleted.ts",
        contentHash: "deleted",
        language: "typescript",
        size: 28,
        text: "export function deleted() {}",
      },
      {
        path: "unchanged.ts",
        contentHash: "unchanged",
        language: "typescript",
        size: 27,
        text: "export function retained() {}",
      },
    ],
    nodes: [
      ...["changed", "deleted", "unchanged"].flatMap((label) => [
        {
          id: `file-${label}`,
          kind: "file",
          name: `${label}.ts`,
          qualifiedName: `${label}.ts`,
          filePath: `${label}.ts`,
          language: "typescript",
          startLine: 1,
          endLine: 1,
          startColumn: 0,
          endColumn: 1,
          updatedAt: 1,
        },
        {
          id: `function-${label}`,
          kind: "function",
          name:
            label === "unchanged"
              ? "retained"
              : label === "changed"
                ? "oldValue"
                : "deleted",
          qualifiedName: `${label}.ts::value`,
          filePath: `${label}.ts`,
          language: "typescript",
          startLine: 1,
          endLine: 1,
          startColumn: 0,
          endColumn: 1,
          updatedAt: 1,
        },
      ]),
    ],
    edges: ["changed", "deleted", "unchanged"].map((label) => ({
      source: `file-${label}`,
      target: `function-${label}`,
      kind: "contains",
      provenance: "tree-sitter",
    })),
  }

  await spawnWorker()
  await request("storage-open", { poolName, clearOnInit: true })
  await expect(request("storage-publish", { generation: generation("one") })).resolves.toMatchObject({
    generation: 1,
  })
  await expect(request("storage-current", { repositoryId: "repo_opaque" })).resolves.toMatchObject({
    generation: 1,
    nodeNames: ["valueone"],
    sourceText: 'export const value = "one"',
    schemaVersion: 12,
  })
  await expect(
    request("storage-embedding-symbols", {
      repositoryId: "repo_opaque",
      graphGeneration: 1,
    }),
  ).resolves.toEqual([
    {
      nodeId: "node-one",
      kind: "variable",
      name: "valueone",
    },
  ])
  await expect(
    request("storage-write-vectors", {
      repositoryId: "repo_opaque",
      graphGeneration: 1,
      rows: [
        {
          nodeId: "node-one",
          model: "model-safe",
          dimensions: 2,
          values: [0.25, 0.75],
          inputHash: "hash-one",
        },
      ],
    }),
  ).resolves.toEqual([
    {
      nodeId: "node-one",
      model: "model-safe",
      dimensions: 2,
      inputHash: "hash-one",
      byteLength: 8,
    },
  ])
  await expect(
    request("storage-save-embedding-state", {
      repositoryId: "repo_opaque",
      state: {
        status: "paused",
        graphGeneration: 1,
        model: "model-safe",
        dimensions: 2,
        completedItems: 1,
        inputHashes: ["hash-one"],
      },
    }),
  ).resolves.toEqual({
    status: "paused",
    graphGeneration: 1,
    model: "model-safe",
    dimensions: 2,
    completedItems: 1,
    inputHashes: ["hash-one"],
  })

  await expect(
    request("storage-publish", {
      generation: generation("quota"),
      fault: "quota-before-publication",
    }),
  ).rejects.toThrow(/quota_exceeded/)
  await expect(request("storage-current", { repositoryId: "repo_opaque" })).resolves.toMatchObject({
    generation: 1,
    nodeNames: ["valueone"],
  })

  await request("storage-leave-staging", { generation: generation("stale") })
  await request("storage-close")
  await page.evaluate(() => {
    const target = window as typeof window & { spec007Worker?: Worker }
    target.spec007Worker?.terminate()
    delete target.spec007Worker
  })

  await spawnWorker()
  await request("storage-open", { poolName, clearOnInit: false })
  await expect(request("storage-statuses", { repositoryId: "repo_opaque" })).resolves.toEqual([
    { generation: 1, status: "published" },
    { generation: 2, status: "failed" },
    { generation: 3, status: "failed" },
  ])
  await expect(request("storage-current", { repositoryId: "repo_opaque" })).resolves.toMatchObject({
    generation: 1,
    nodeNames: ["valueone"],
  })

  await expect(request("storage-publish", { generation: generation("four") })).resolves.toMatchObject({
    generation: 4,
  })
  await expect(request("storage-current", { repositoryId: "repo_opaque" })).resolves.toMatchObject({
    generation: 4,
    nodeNames: ["valuefour"],
    sourceText: 'export const value = "four"',
  })

  await expect(
    request("storage-publish", { generation: relationshipGeneration() }),
  ).resolves.toMatchObject({ generation: 5 })

  await expect(
    request("storage-publish", { generation: refreshInitialGeneration }),
  ).resolves.toMatchObject({ repositoryId: "repo_refresh", generation: 1 })
  const encoder = new TextEncoder()
  const refreshCollection = {
    entries: [
      {
        kind: "file",
        path: "added.ts",
        bytes: encoder.encode("export function added() {}"),
        contentHash: "added",
        size: 27,
      },
      {
        kind: "file",
        path: "changed.ts",
        bytes: encoder.encode("export function changedValue() {}"),
        contentHash: "changed-new",
        size: 34,
      },
      {
        kind: "file",
        path: "skipped.txt",
        bytes: encoder.encode("not source"),
        contentHash: "skipped",
        size: 10,
      },
      {
        kind: "file",
        path: "unchanged.ts",
        bytes: encoder.encode("export function retained() {}"),
        contentHash: "unchanged",
        size: 27,
      },
    ],
    manifest: {
      fingerprint: "refresh-candidate",
      entries: [
        { path: "added.ts", contentHash: "added", size: 27 },
        { path: "changed.ts", contentHash: "changed-new", size: 34 },
        { path: "skipped.txt", contentHash: "skipped", size: 10 },
        { path: "unchanged.ts", contentHash: "unchanged", size: 27 },
      ],
    },
    warnings: { details: [], total: 0, truncated: false },
  }
  await expect(
    request("storage-refresh", {
      repositoryId: "repo_refresh",
      collection: refreshCollection,
    }),
  ).resolves.toEqual({
    repositoryId: "repo_refresh",
    generation: 2,
    changes: {
      added: 1,
      changed: 1,
      deleted: 1,
      unchanged: 1,
      skipped: 1,
    },
    counts: { files: 3, nodes: 6, edges: 3, warnings: 1 },
    extractedPaths: ["added.ts", "changed.ts", "skipped.txt"],
  })
  await expect(
    request("storage-current", { repositoryId: "repo_refresh" }),
  ).resolves.toMatchObject({
    generation: 2,
    counts: { files: 3, nodes: 6, edges: 3, warnings: 1 },
    sourcePaths: ["added.ts", "changed.ts", "unchanged.ts"],
    nodeNames: expect.arrayContaining(["added", "changedValue", "retained"]),
    edgeCount: 3,
    warnings: [expect.objectContaining({ path: "skipped.txt" })],
    manifest: {
      entries: [
        expect.objectContaining({ path: "added.ts", contentHash: "added" }),
        expect.objectContaining({
          path: "changed.ts",
          contentHash: "changed-new",
        }),
        expect.objectContaining({
          path: "unchanged.ts",
          contentHash: "unchanged",
        }),
      ],
    },
  })
  const refreshed = await request<{
    manifestFingerprint: string
    manifest: { fingerprint: string }
  }>("storage-current", { repositoryId: "repo_refresh" })
  expect(refreshed.manifestFingerprint).toBe(refreshed.manifest.fingerprint)
  await expect(
    request("storage-relationships", {
      repositoryId: "repo_opaque",
      nodeId: "root",
      direction: "callers",
      limit: 999,
      offset: 0,
    }),
  ).resolves.toEqual({
    items: [
      expect.objectContaining({ id: "caller-a", name: "caller-a" }),
      expect.objectContaining({ id: "caller-b", name: "caller-b" }),
    ],
    total: 2,
    limit: 500,
    offset: 0,
  })
  await expect(
    request("storage-relationships", {
      repositoryId: "repo_opaque",
      nodeId: "root",
      direction: "callees",
    }),
  ).resolves.toMatchObject({
    items: [expect.objectContaining({ id: "callee" })],
    total: 1,
    limit: 100,
    offset: 0,
  })
  await expect(
    request<{ nodes: unknown[]; edges: unknown[]; truncated: boolean }>(
      "storage-graph",
      {
        repositoryId: "repo_opaque",
        nodeId: "root",
        depth: 99,
      },
    ),
  ).resolves.toMatchObject({
    nodes: expect.arrayContaining([expect.objectContaining({ id: "root" })]),
    truncated: true,
  })
  const graph = await request<{
    nodes: unknown[]
    edges: unknown[]
    truncated: boolean
  }>("storage-graph", {
    repositoryId: "repo_opaque",
    nodeId: "root",
    depth: 99,
  })
  expect(graph.nodes).toHaveLength(2_000)
  expect(graph.edges.length).toBeLessThanOrEqual(10_000)

  const plans = await request<Record<string, string[]>>(
    "storage-query-plans",
    { repositoryId: "repo_opaque" },
  )
  expect(plans.callers.join(" ")).toContain("idx_edges_target_kind")
  expect(plans.callees.join(" ")).toContain("idx_edges_source_kind")
  expect(plans.graph.join(" ")).toContain("MULTI-INDEX OR")
  expect(plans.impact.join(" ")).toContain("idx_edges_target_kind")

  await expect(
    request("storage-impact", {
      repositoryId: "repo_opaque",
      nodeId: "root",
      depth: 99,
    }),
  ).resolves.toEqual({
    nodes: [
      expect.objectContaining({ id: "caller-a", file: "src/caller-a.ts" }),
      expect.objectContaining({ id: "caller-b", file: "src/caller-b.ts" }),
      expect.objectContaining({
        id: "caller-upstream",
        file: "src/caller-upstream.ts",
      }),
      expect.objectContaining({ id: "root", file: "src/main.ts" }),
    ],
    edges: [
      expect.objectContaining({
        source: "caller-a",
        target: "root",
        kind: "calls",
      }),
      expect.objectContaining({
        source: "caller-b",
        target: "root",
        kind: "calls",
      }),
      expect.objectContaining({
        source: "caller-upstream",
        target: "caller-a",
        kind: "references",
      }),
    ],
    truncated: false,
  })
  await expect(
    request("storage-impact", {
      repositoryId: "repo_opaque",
      nodeId: "isolated",
    }),
  ).resolves.toEqual({
    nodes: [expect.objectContaining({ id: "isolated", file: "src/isolated.ts" })],
    edges: [],
    truncated: false,
  })

  await request("storage-leave-staging", {
    generation: unpublishedGeneration,
  })
  await expect(
    request("storage-relationships", {
      repositoryId: "repo_opaque",
      nodeId: "root",
      direction: "callers",
    }),
  ).resolves.toMatchObject({
    items: [
      expect.objectContaining({ id: "caller-a" }),
      expect.objectContaining({ id: "caller-b" }),
    ],
    total: 2,
  })
  await expect(
    request("storage-impact", {
      repositoryId: "repo_opaque",
      nodeId: "root",
    }),
  ).resolves.toMatchObject({
    nodes: expect.not.arrayContaining([
      expect.objectContaining({ id: "caller-stale" }),
    ]),
    edges: expect.not.arrayContaining([
      expect.objectContaining({ source: "caller-stale" }),
    ]),
  })

  await expect(
    request("storage-publish", {
      generation: recoveryGeneration("base"),
    }),
  ).resolves.toMatchObject({
    repositoryId: "repo_recovery",
    generation: 1,
  })
  const recoveryFaults = [
    ["after-source-staging", /storage_write_failed/],
    ["after-graph-write", /storage_write_failed/],
    ["after-status-update", /storage_write_failed/],
    ["after-registry-publish", /storage_write_failed/],
    ["quota-before-publication", /quota_exceeded/],
    ["migration-failed", /schema_version_mismatch/],
    ["after-delete-cleanup", /storage_write_failed/],
  ] as const
  for (const [fault, expected] of recoveryFaults) {
    await expect(
      request("storage-publish", {
        generation: recoveryGeneration(fault),
        fault,
      }),
    ).rejects.toThrow(expected)
    await expect(
      request("storage-current", { repositoryId: "repo_recovery" }),
    ).resolves.toMatchObject({
      generation: 1,
      nodeNames: ["valuerecovery-base"],
    })
  }
  await expect(
    request("storage-statuses", { repositoryId: "repo_recovery" }),
  ).resolves.toEqual([
    { generation: 1, status: "published" },
    ...recoveryFaults.map((_, index) => ({
      generation: index + 2,
      status: "failed",
    })),
  ])
  await request("storage-leave-staging", {
    generation: recoveryGeneration("crashed"),
  })
  await expect(request<{ paused: boolean }>("storage-close")).resolves.toEqual({ paused: true })
  await page.evaluate(() => {
    const target = window as typeof window & { spec007Worker?: Worker }
    target.spec007Worker?.terminate()
    delete target.spec007Worker
  })
  await spawnWorker()
  await request("storage-open", { poolName, clearOnInit: false })
  await expect(
    request("storage-statuses", { repositoryId: "repo_recovery" }),
  ).resolves.toEqual([
    { generation: 1, status: "published" },
    ...recoveryFaults.map((_, index) => ({
      generation: index + 2,
      status: "failed",
    })),
    { generation: recoveryFaults.length + 2, status: "failed" },
  ])
  await expect(
    request("storage-current", { repositoryId: "repo_recovery" }),
  ).resolves.toMatchObject({
    generation: 1,
    nodeNames: ["valuerecovery-base"],
  })
  await expect(
    request("storage-delete", { repositoryId: "repo_recovery" }),
  ).resolves.toEqual({
    repositoryId: "repo_recovery",
    deleted: true,
    generations: recoveryFaults.length + 2,
  })
  await expect(
    request("storage-current", { repositoryId: "repo_recovery" }),
  ).resolves.toBeNull()
  await expect(
    request("storage-statuses", { repositoryId: "repo_recovery" }),
  ).resolves.toEqual([])
  await expect(request<{ paused: boolean }>("storage-close")).resolves.toEqual({
    paused: true,
  })
})

test("imports an immutable dropped snapshot through the production worker", async ({
  page,
}) => {
  const workerFile = listFiles(path.join(webRoot, "dist")).find((file) =>
    /local-indexing-worker[^/]*\.js$/.test(file),
  )
  expect(workerFile, "built local-indexing worker").toBeDefined()
  const workerUrl = `/${path
    .relative(path.join(webRoot, "dist"), workerFile!)
    .replaceAll(path.sep, "/")}`
  await page.goto("/")

  const result = await page.evaluate(
    ({ url }) =>
      new Promise<{
        repository: { sourceKind: string; snapshotImportedAt?: string }
        search: { total: number }
      }>((resolve, reject) => {
        const worker = new Worker(url, { type: "module" })
        const repositoryId = `snapshot_${crypto.randomUUID().replaceAll("-", "_")}`
        const acceptedAt = "2026-07-28T11:15:00.000Z"
        const timeout = window.setTimeout(() => {
          worker.terminate()
          reject(new Error("Timed out importing the dropped snapshot"))
        }, 15_000)
        const request = (
          requestId: string,
          kind: string,
          payload?: unknown,
          operationId?: string,
        ) =>
          new Promise<unknown>((requestResolve, requestReject) => {
            const onMessage = (event: MessageEvent) => {
              const message = event.data as {
                requestId?: string
                type?: string
                result?: unknown
                error?: { code?: string; message?: string }
              }
              if (
                message.requestId !== requestId ||
                message.type === "progress"
              ) {
                return
              }
              worker.removeEventListener("message", onMessage)
              if (message.type === "result") requestResolve(message.result)
              else {
                requestReject(
                  new Error(
                    `${message.error?.code}: ${message.error?.message}`,
                  ),
                )
              }
            }
            worker.addEventListener("message", onMessage)
            worker.postMessage({
              protocolVersion: 1,
              requestId,
              ...(operationId ? { operationId } : {}),
              repositoryId,
              kind,
              ...(payload === undefined ? {} : { payload }),
            })
          })

        void request(
          "snapshot-import",
          "import-snapshot",
          {
            identity: {
              id: repositoryId,
              sourceKind: "dropped-snapshot",
              displayName: "Dropped project",
              virtualRoot: `local://${repositoryId}`,
              acceptedAt,
            },
            collection: {
              entries: [
                {
                  kind: "file",
                  path: "src/main.ts",
                  bytes: new TextEncoder().encode(
                    "export const snapshotValue = 1",
                  ),
                  contentHash: "snapshot-content",
                  size: 30,
                },
              ],
              manifest: {
                entries: [],
                fingerprint: "snapshot-manifest",
              },
              warnings: { details: [], total: 0, truncated: false },
              snapshot: {
                acceptedAt,
                fileCount: 1,
                totalBytes: 30,
                manifestFingerprint: "snapshot-manifest",
              },
            },
          },
          "snapshot-operation",
        )
          .then(async (repository) => {
            const search = await request("snapshot-search", "query", {
              query: "search",
              request: { query: "snapshotValue", limit: 10 },
            })
            window.clearTimeout(timeout)
            worker.terminate()
            resolve({
              repository: repository as {
                sourceKind: string
                snapshotImportedAt?: string
              },
              search: search as { total: number },
            })
          })
          .catch((error) => {
            window.clearTimeout(timeout)
            worker.terminate()
            reject(error)
          })
      }),
    { url: workerUrl },
  )

  expect(result.repository).toMatchObject({
    sourceKind: "dropped-snapshot",
    snapshotImportedAt: "2026-07-28T11:15:00.000Z",
  })
  expect(result.search.total).toBeGreaterThan(0)
})
