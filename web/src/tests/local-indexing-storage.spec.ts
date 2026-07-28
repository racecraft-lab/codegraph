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
  await expect(request<{ paused: boolean }>("storage-close")).resolves.toEqual({ paused: true })
})
