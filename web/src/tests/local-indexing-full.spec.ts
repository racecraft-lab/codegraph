import { expect, test, type Locator, type Page } from "@playwright/test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  classifyWebAssetPath,
  validateWebAssetDirectory,
} from "../../../scripts/web-asset-manifest.mjs"

const READ_SAMPLE_COUNT = 20
const READ_P95_BUDGET_MS = 150
const WORKER_PAYLOAD_BUDGET_BYTES = 8 * 1024 * 1024
const WORKER_READ_BATCH_BUDGET_BYTES = 4 * 1024 * 1024
const WORKER_FILE_BATCH_BUDGET = 64
const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
)
const repositoryRoot = path.resolve(webRoot, "..")
const SELF_REPO_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".vue",
])

interface SelfRepositorySource {
  path: string
  text: string
  bytes: number
  lastModified: number
}

function listFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name)
    return entry.isDirectory() ? listFiles(file) : [file]
  })
}

function p95(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY
}

function selfRepositorySources(): SelfRepositorySource[] {
  const trackedAndUnignored = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot }
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
  return trackedAndUnignored
    .filter((relativePath) =>
      SELF_REPO_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
    )
    .flatMap((relativePath) => {
      const absolutePath = path.join(repositoryRoot, relativePath)
      let descriptor: number | undefined
      try {
        descriptor = fs.openSync(absolutePath, "r")
        const stat = fs.fstatSync(descriptor)
        if (!stat.isFile() || stat.size > 1024 * 1024) return []
        return [
          {
            path: relativePath.replaceAll(path.sep, "/"),
            text: fs.readFileSync(descriptor, "utf8"),
            bytes: stat.size,
            lastModified: Math.trunc(stat.mtimeMs),
          },
        ]
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
        throw error
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor)
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}

function runtimeDisclosure() {
  const packageManager =
    process.env.npm_config_user_agent?.split(" ")[0] ??
    "npm version unavailable"
  return {
    cpuModel: os.cpus()[0]?.model ?? "unavailable",
    logicalCores: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytesAtStart: os.freemem(),
    operatingSystem: `${os.type()} ${os.release()} ${os.arch()}`,
    powerMode: "not exposed programmatically",
    node: process.version,
    packageManager,
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim(),
    hostMode: "Vite production preview on loopback",
  }
}

function builtWorkerUrl() {
  const workerFile = listFiles(path.join(webRoot, "dist")).find((file) =>
    /local-indexing-worker[^/]*\.js$/.test(file)
  )
  if (!workerFile)
    throw new Error("Built local-indexing worker is unavailable.")
  return `/${path
    .relative(path.join(webRoot, "dist"), workerFile)
    .replaceAll(path.sep, "/")}`
}

async function measureUserObserved(
  page: Page,
  action: () => Promise<void>,
  rendered: () => Promise<void>
) {
  const startedAt = await page.evaluate(() => performance.now())
  await action()
  await rendered()
  return page.evaluate((start) => performance.now() - start, startedAt)
}

async function activateWithKeyboard(page: Page, control: Locator) {
  await control.focus()
  await expect(control).toBeFocused()
  await page.keyboard.press("Enter")
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    )
    .toBe(true)
}

async function captureQueryPlans(page: Page) {
  const workerUrl = builtWorkerUrl()
  return page.evaluate(
    async ({ url, poolName }) => {
      const worker = new Worker(url, { type: "module" })
      const request = <T>(kind: string, payload: unknown = {}) =>
        new Promise<T>((resolve, reject) => {
          const requestId = crypto.randomUUID()
          const timeout = window.setTimeout(
            () => reject(new Error(`Timed out: ${kind}`)),
            10_000
          )
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
            else
              reject(
                new Error(`${message.error?.code}: ${message.error?.message}`)
              )
          }
          worker.addEventListener("message", onMessage)
          worker.postMessage({ requestId, kind, payload })
        })
      const generation = {
        repositoryId: "query_plan_evidence",
        manifestFingerprint: "query-plan-evidence",
        manifest: [{ path: "src/main.ts", contentHash: "query-plan", size: 1 }],
        counts: { files: 1, nodes: 1, edges: 0, warnings: 0 },
        warnings: [],
        sources: [
          {
            path: "src/main.ts",
            contentHash: "query-plan",
            language: "typescript",
            size: 1,
            text: "export function root() {}",
          },
        ],
        nodes: [
          {
            id: "query-plan-node",
            kind: "function",
            name: "root",
            qualifiedName: "src/main.ts::root",
            filePath: "src/main.ts",
            language: "typescript",
            startLine: 1,
            endLine: 1,
            startColumn: 0,
            endColumn: 4,
            isExported: true,
            updatedAt: 1,
          },
        ],
        edges: [],
      }
      try {
        await request("storage-open", { poolName, clearOnInit: true })
        await request("storage-publish", { generation })
        return await request<Record<string, string[]>>("storage-query-plans", {
          repositoryId: generation.repositoryId,
        })
      } finally {
        await request("storage-close").catch(() => undefined)
        worker.terminate()
      }
    },
    {
      url: workerUrl,
      poolName: `spec007-plans-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    }
  )
}

test("keeps local reads responsive while semantic indexing cancels, resumes, and fails safely", async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const tracePath = testInfo.outputPath("spec007-semantic-trace.zip")
  if (testInfo.retry === 0) {
    await context.tracing.start({ screenshots: true, snapshots: true })
  }

  try {
    const endpointCalls: Array<{
      url: string
      method: string
      authorizationPresent: boolean
      inputCount: number
    }> = []
    let releaseFirstEndpoint: (() => void) | undefined
    const firstEndpointGate = new Promise<void>((resolve) => {
      releaseFirstEndpoint = resolve
    })
    await page.route("https://embeddings.example/**", async (route) => {
      const request = route.request()
      const body = request.postDataJSON() as {
        input?: unknown[]
        model?: string
      }
      endpointCalls.push({
        url: request.url(),
        method: request.method(),
        authorizationPresent:
          request.headers().authorization?.startsWith("Bearer ") === true,
        inputCount: Array.isArray(body.input) ? body.input.length : 0,
      })
      if (request.url().endsWith("/fail")) {
        await route.fulfill({
          status: 503,
          headers: {
            "access-control-allow-origin": "*",
            "content-type": "application/json",
          },
          body: JSON.stringify({ error: "redacted by worker policy" }),
        })
        return
      }
      if (endpointCalls.length === 1) await firstEndpointGate
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: body.model,
          data: (body.input ?? []).map((_, index) => ({
            index,
            embedding: [index + 0.1, index + 0.2, index + 0.3],
          })),
        }),
      })
    })

    await page.goto("/")
    const repositoryId = "semantic_acceptance"
    const generation = await page.evaluate(
      async ({ poolName, repositoryId: activeRepositoryId, workerUrl }) => {
        const worker = new Worker(workerUrl, { type: "module" })
        Object.assign(window, { spec007SemanticWorker: worker })
        const storageRequest = <T>(kind: string, payload: unknown = {}) =>
          new Promise<T>((resolve, reject) => {
            const requestId = crypto.randomUUID()
            const timeout = window.setTimeout(
              () => reject(new Error(`Timed out: ${kind}`)),
              10_000
            )
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
              else
                reject(
                  new Error(`${message.error?.code}: ${message.error?.message}`)
                )
            }
            worker.addEventListener("message", onMessage)
            worker.postMessage({ requestId, kind, payload })
          })
        const source = [
          "export function root() { return callee(); }",
          "export function callee() { return leaf(); }",
          "export function leaf() { return 1; }",
        ].join("\n")
        const generationInput = {
          repositoryId: activeRepositoryId,
          manifestFingerprint: "semantic-acceptance-v1",
          manifest: [
            {
              path: "src/main.ts",
              contentHash: "semantic-v1",
              size: source.length,
            },
          ],
          counts: { files: 1, nodes: 3, edges: 2, warnings: 0 },
          warnings: [],
          sources: [
            {
              path: "src/main.ts",
              contentHash: "semantic-v1",
              language: "typescript",
              size: source.length,
              text: source,
            },
          ],
          nodes: [
            {
              id: "root",
              kind: "function",
              name: "root",
              qualifiedName: "src/main.ts::root",
              filePath: "src/main.ts",
              language: "typescript",
              startLine: 1,
              endLine: 1,
              startColumn: 0,
              endColumn: 42,
              isExported: true,
              updatedAt: 1,
            },
            {
              id: "callee",
              kind: "function",
              name: "callee",
              qualifiedName: "src/main.ts::callee",
              filePath: "src/main.ts",
              language: "typescript",
              startLine: 2,
              endLine: 2,
              startColumn: 0,
              endColumn: 44,
              isExported: true,
              updatedAt: 1,
            },
            {
              id: "leaf",
              kind: "function",
              name: "leaf",
              qualifiedName: "src/main.ts::leaf",
              filePath: "src/main.ts",
              language: "typescript",
              startLine: 3,
              endLine: 3,
              startColumn: 0,
              endColumn: 36,
              isExported: true,
              updatedAt: 1,
            },
          ],
          edges: [
            {
              id: "root-calls-callee",
              source: "root",
              target: "callee",
              kind: "calls",
              confidence: 1,
              metadata: {},
            },
            {
              id: "callee-calls-leaf",
              source: "callee",
              target: "leaf",
              kind: "calls",
              confidence: 1,
              metadata: {},
            },
          ],
        }
        await storageRequest("storage-open", { poolName, clearOnInit: true })
        return storageRequest<{ repositoryId: string; generation: number }>(
          "storage-publish",
          { generation: generationInput }
        )
      },
      {
        poolName: `spec007-semantic-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        repositoryId,
        workerUrl: builtWorkerUrl(),
      }
    )

    const startOperation = (input: {
      operationId: string
      endpointUrl: string
      graphGeneration: number
      resume?: {
        graphGeneration: number
        model: string
        dimensions?: number
        completedItems: number
        inputHashes: string[]
      }
    }) =>
      page.evaluate(
        ({
          endpointUrl,
          graphGeneration,
          operationId,
          repositoryId: activeRepositoryId,
          resume,
        }) =>
          new Promise<{
            terminal: string
            result?: unknown
            error?: { code?: string; message?: string }
            progress: Array<{
              phase?: string
              completed?: number
              total?: number
            }>
          }>((resolve, reject) => {
            const worker = (
              window as typeof window & { spec007SemanticWorker: Worker }
            ).spec007SemanticWorker
            const requestId = crypto.randomUUID()
            const progress: Array<{
              phase?: string
              completed?: number
              total?: number
            }> = []
            const timeout = window.setTimeout(
              () => reject(new Error(`Timed out: ${operationId}`)),
              20_000
            )
            const onMessage = (event: MessageEvent) => {
              const message = event.data as {
                requestId?: string
                type?: string
                phase?: string
                completed?: number
                total?: number
                terminal?: string
                result?: unknown
                error?: { code?: string; message?: string }
              }
              if (message.requestId !== requestId) return
              if (message.type === "progress") {
                progress.push({
                  phase: message.phase,
                  completed: message.completed,
                  total: message.total,
                })
                return
              }
              if (!message.terminal) return
              window.clearTimeout(timeout)
              worker.removeEventListener("message", onMessage)
              resolve({
                terminal: message.terminal,
                result: message.result,
                error: message.error,
                progress,
              })
            }
            worker.addEventListener("message", onMessage)
            worker.postMessage({
              protocolVersion: 1,
              requestId,
              operationId,
              repositoryId: activeRepositoryId,
              kind: "embed",
              payload: {
                endpointUrl,
                model: "spec007-model",
                graphGeneration,
                dimensions: 3,
                credential: "page-session-only-secret",
                consentGrantedAt: new Date().toISOString(),
                ...(resume ? { resume } : {}),
              },
            })
          }),
        { ...input, repositoryId }
      )

    const measureQueries = (
      label: string,
      operations: Array<{
        query: "search" | "graph" | "impact"
        request: Record<string, unknown>
      }>
    ) =>
      page.evaluate(
        async ({
          label: sampleLabel,
          operations: queryOperations,
          repositoryId: activeRepositoryId,
        }) => {
          const worker = (
            window as typeof window & { spec007SemanticWorker: Worker }
          ).spec007SemanticWorker
          const query = (payload: unknown) =>
            new Promise<void>((resolve, reject) => {
              const requestId = crypto.randomUUID()
              const timeout = window.setTimeout(
                () => reject(new Error("Timed out: local query")),
                10_000
              )
              const onMessage = (event: MessageEvent) => {
                const message = event.data as {
                  requestId?: string
                  terminal?: string
                  error?: { code?: string; message?: string }
                }
                if (message.requestId !== requestId || !message.terminal) return
                window.clearTimeout(timeout)
                worker.removeEventListener("message", onMessage)
                if (message.terminal === "complete") resolve()
                else
                  reject(
                    new Error(
                      `${message.error?.code}: ${message.error?.message}`
                    )
                  )
              }
              worker.addEventListener("message", onMessage)
              worker.postMessage({
                protocolVersion: 1,
                requestId,
                operationId: crypto.randomUUID(),
                repositoryId: activeRepositoryId,
                kind: "query",
                payload,
              })
            })
          for (const operation of queryOperations) await query(operation)
          const samples: Record<string, number[]> = {}
          for (const operation of queryOperations) {
            samples[operation.query] = []
            for (let index = 0; index < 20; index += 1) {
              const startedAt = performance.now()
              await query(operation)
              samples[operation.query]?.push(performance.now() - startedAt)
            }
          }
          return { label: sampleLabel, samples }
        },
        { label, operations, repositoryId }
      )

    const initialOperationId = "semantic-cancel"
    const cancelledOperationPromise = startOperation({
      operationId: initialOperationId,
      endpointUrl: "https://embeddings.example/v1/embed",
      graphGeneration: generation.generation,
    })
    await expect.poll(() => endpointCalls.length).toBe(1)
    const activeReadEvidence = await measureQueries("active", [
      { query: "search", request: { query: "root" } },
      { query: "graph", request: { nodeId: "root", depth: 2 } },
      { query: "impact", request: { nodeId: "leaf", depth: 2 } },
    ])

    const cancelResult = await page.evaluate(
      ({ operationId }) =>
        new Promise<{ cancelled: boolean; noop: boolean }>(
          (resolve, reject) => {
            const worker = (
              window as typeof window & { spec007SemanticWorker: Worker }
            ).spec007SemanticWorker
            const requestId = crypto.randomUUID()
            const timeout = window.setTimeout(
              () => reject(new Error("Timed out: semantic cancel")),
              10_000
            )
            const onMessage = (event: MessageEvent) => {
              const message = event.data as {
                requestId?: string
                result?: { cancelled: boolean; noop: boolean }
              }
              if (message.requestId !== requestId || !message.result) return
              window.clearTimeout(timeout)
              worker.removeEventListener("message", onMessage)
              resolve(message.result)
            }
            worker.addEventListener("message", onMessage)
            worker.postMessage({
              protocolVersion: 1,
              requestId,
              operationId,
              kind: "cancel",
            })
          }
        ),
      { operationId: initialOperationId }
    )
    expect(cancelResult).toEqual({ cancelled: true, noop: false })
    releaseFirstEndpoint?.()
    const cancelledOperation = await cancelledOperationPromise
    expect(cancelledOperation.terminal).toBe("cancelled")
    expect(cancelledOperation.error?.code).toBe("operation_cancelled")
    expect(endpointCalls).toHaveLength(1)

    const storageRead = <T>(kind: string, payload: unknown = {}) =>
      page.evaluate(
        ({ kind: requestKind, payload: requestPayload }) =>
          new Promise<T>((resolve, reject) => {
            const worker = (
              window as typeof window & { spec007SemanticWorker: Worker }
            ).spec007SemanticWorker
            const requestId = crypto.randomUUID()
            const timeout = window.setTimeout(
              () => reject(new Error(`Timed out: ${requestKind}`)),
              10_000
            )
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
              else
                reject(
                  new Error(`${message.error?.code}: ${message.error?.message}`)
                )
            }
            worker.addEventListener("message", onMessage)
            worker.postMessage({
              requestId,
              kind: requestKind,
              payload: requestPayload,
            })
          }),
        { kind, payload }
      )

    type SemanticState = {
      status: "active" | "paused" | "stale" | "unavailable" | "complete"
      graphGeneration: number
      model: string
      dimensions?: number
      completedItems: number
      inputHashes: string[]
      failureCode?: string
    }
    type VectorMetadata = Array<{
      nodeId: string
      model: string
      dimensions: number
      inputHash: string
      byteLength: number
    }>
    const pausedState = await storageRead<SemanticState>(
      "storage-embedding-state",
      { repositoryId }
    )
    expect(pausedState).toMatchObject({
      status: "paused",
      graphGeneration: generation.generation,
      completedItems: 0,
      failureCode: "operation_cancelled",
    })
    expect(
      await storageRead<VectorMetadata>("storage-vector-metadata", {
        repositoryId,
      })
    ).toEqual([])
    const pausedReadEvidence = await measureQueries("paused-cancelled", [
      { query: "search", request: { query: "callee" } },
    ])

    const resumedOperation = await startOperation({
      operationId: "semantic-resume",
      endpointUrl: "https://embeddings.example/v1/embed",
      graphGeneration: generation.generation,
      resume: {
        graphGeneration: pausedState.graphGeneration,
        model: pausedState.model,
        dimensions: pausedState.dimensions,
        completedItems: pausedState.completedItems,
        inputHashes: pausedState.inputHashes,
      },
    })
    expect(resumedOperation.terminal).toBe("complete")
    expect(resumedOperation.progress.at(-1)).toMatchObject({
      phase: "embedding",
      completed: 3,
      total: 3,
    })
    const completedState = await storageRead<SemanticState>(
      "storage-embedding-state",
      { repositoryId }
    )
    expect(completedState).toMatchObject({
      status: "complete",
      graphGeneration: generation.generation,
      dimensions: 3,
      completedItems: 3,
    })
    const completedVectors = await storageRead<VectorMetadata>(
      "storage-vector-metadata",
      { repositoryId }
    )
    expect(completedVectors).toHaveLength(3)
    expect(
      completedVectors.every(
        (row) =>
          row.model === "spec007-model" &&
          row.dimensions === 3 &&
          row.byteLength === 12 &&
          row.inputHash.length === 64
      )
    ).toBe(true)

    const failedOperation = await startOperation({
      operationId: "semantic-failure",
      endpointUrl: "https://embeddings.example/v1/fail",
      graphGeneration: generation.generation,
    })
    expect(failedOperation.terminal).toBe("failed")
    expect(failedOperation.error?.code).toBe("provider_unavailable")
    const unavailableState = await storageRead<SemanticState>(
      "storage-embedding-state",
      { repositoryId }
    )
    expect(unavailableState.status).toBe("unavailable")
    const failedReadEvidence = await measureQueries("failed-unavailable", [
      { query: "search", request: { query: "leaf" } },
    ])

    const secondGeneration = await storageRead<{
      repositoryId: string
      generation: number
    }>("storage-publish", {
      generation: {
        repositoryId,
        manifestFingerprint: "semantic-acceptance-v2",
        manifest: [
          { path: "src/main.ts", contentHash: "semantic-v2", size: 1 },
        ],
        counts: { files: 1, nodes: 3, edges: 2, warnings: 0 },
        warnings: [],
        sources: [
          {
            path: "src/main.ts",
            contentHash: "semantic-v2",
            language: "typescript",
            size: 1,
            text: "updated",
          },
        ],
        nodes: [
          {
            id: "root",
            kind: "function",
            name: "root",
            qualifiedName: "src/main.ts::root",
            filePath: "src/main.ts",
            language: "typescript",
            startLine: 1,
            endLine: 1,
            startColumn: 0,
            endColumn: 1,
            isExported: true,
            updatedAt: 2,
          },
          {
            id: "callee",
            kind: "function",
            name: "callee",
            qualifiedName: "src/main.ts::callee",
            filePath: "src/main.ts",
            language: "typescript",
            startLine: 1,
            endLine: 1,
            startColumn: 0,
            endColumn: 1,
            isExported: true,
            updatedAt: 2,
          },
          {
            id: "leaf",
            kind: "function",
            name: "leaf",
            qualifiedName: "src/main.ts::leaf",
            filePath: "src/main.ts",
            language: "typescript",
            startLine: 1,
            endLine: 1,
            startColumn: 0,
            endColumn: 1,
            isExported: true,
            updatedAt: 2,
          },
        ],
        edges: [
          {
            id: "root-calls-callee-v2",
            source: "root",
            target: "callee",
            kind: "calls",
            confidence: 1,
            metadata: {},
          },
          {
            id: "callee-calls-leaf-v2",
            source: "callee",
            target: "leaf",
            kind: "calls",
            confidence: 1,
            metadata: {},
          },
        ],
      },
    })
    expect(secondGeneration.generation).toBe(generation.generation + 1)
    expect(
      await storageRead<VectorMetadata>("storage-vector-metadata", {
        repositoryId,
      })
    ).toEqual([])

    const callsBeforeStale = endpointCalls.length
    const staleOperation = await startOperation({
      operationId: "semantic-stale",
      endpointUrl: "https://embeddings.example/v1/embed",
      graphGeneration: generation.generation,
      resume: {
        graphGeneration: completedState.graphGeneration,
        model: completedState.model,
        dimensions: completedState.dimensions,
        completedItems: completedState.completedItems,
        inputHashes: completedState.inputHashes,
      },
    })
    expect(staleOperation.terminal).toBe("failed")
    expect(staleOperation.error?.code).toBe("semantic_stale")
    expect(endpointCalls).toHaveLength(callsBeforeStale)
    const staleReadEvidence = await measureQueries("stale", [
      { query: "search", request: { query: "root" } },
    ])

    const readEvidence = [
      activeReadEvidence,
      pausedReadEvidence,
      failedReadEvidence,
      staleReadEvidence,
    ]
    const p95Evidence = Object.fromEntries(
      readEvidence.flatMap((state) =>
        Object.entries(state.samples).map(([operation, samples]) => [
          `${state.label}:${operation}`,
          p95(samples),
        ])
      )
    )
    await testInfo.attach("spec007-semantic-operation-evidence.json", {
      body: JSON.stringify(
        {
          graphGenerations: [
            generation.generation,
            secondGeneration.generation,
          ],
          endpointCalls,
          operations: {
            cancelled: cancelledOperation,
            resumed: resumedOperation,
            failed: failedOperation,
            stale: staleOperation,
          },
          readEvidence,
          p95Ms: p95Evidence,
          budgetMs: READ_P95_BUDGET_MS,
          completedVectors,
        },
        null,
        2
      ),
      contentType: "application/json",
    })
    console.info(
      `SPEC007_SEMANTIC_OPERATION_EVIDENCE ${JSON.stringify({
        endpointCallCount: endpointCalls.length,
        graphGenerations: [generation.generation, secondGeneration.generation],
        budgetMs: READ_P95_BUDGET_MS,
        p95Ms: p95Evidence,
      })}`
    )
    for (const observedP95 of Object.values(p95Evidence)) {
      expect(observedP95).toBeLessThanOrEqual(READ_P95_BUDGET_MS)
    }
    expect(endpointCalls).toEqual([
      {
        url: "https://embeddings.example/v1/embed",
        method: "POST",
        authorizationPresent: true,
        inputCount: 3,
      },
      {
        url: "https://embeddings.example/v1/embed",
        method: "POST",
        authorizationPresent: true,
        inputCount: 3,
      },
      {
        url: "https://embeddings.example/v1/fail",
        method: "POST",
        authorizationPresent: true,
        inputCount: 3,
      },
    ])

    await storageRead("storage-close")
    await page.evaluate(() => {
      ;(
        window as typeof window & { spec007SemanticWorker: Worker }
      ).spec007SemanticWorker.terminate()
    })
  } finally {
    if (testInfo.retry === 0) {
      await context.tracing.stop({ path: tracePath })
      await testInfo.attach("spec007-semantic-playwright-trace.zip", {
        path: tracePath,
        contentType: "application/zip",
      })
    }
  }
})

const mainSource = [
  "export function normalizeName(value: string): string {",
  "  return value.trim().toLowerCase();",
  "}",
  "",
  "export function greet(name: string): string {",
  "  return `Hello ${normalizeName(name)}`;",
  "}",
  "",
].join("\n")

test("indexes the actual CodeGraph repository within declared performance and resource budgets", async ({
  browser,
  context,
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const tracePath = testInfo.outputPath("spec007-self-repository-trace.zip")
  if (testInfo.retry === 0) {
    await context.tracing.start({ screenshots: false, snapshots: false })
  }

  const sources = selfRepositorySources()
  expect(sources.length).toBeGreaterThanOrEqual(600)
  const sourceBytes = sources.reduce((total, source) => total + source.bytes, 0)
  const assetInventory = validateWebAssetDirectory(path.join(webRoot, "dist"))
  const assetRequests: Array<{ id: string; pathname: string }> = []
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname
    const id = classifyWebAssetPath(pathname)
    if (id) assetRequests.push({ id, pathname })
  })

  await page.addInitScript(
    ({ files }) => {
      interface BenchmarkMetrics {
        active: boolean
        currentPhase: string
        maxMainThreadGapMs: number
        phaseMaxGapMs: Record<string, number>
        phases: string[]
        longTasksMs: number[]
        workerPayloads: Array<{
          kind: string
          bytes: number
          files: number
        }>
      }
      interface DirectoryNode {
        directories: Map<string, DirectoryNode>
        files: Map<
          string,
          { text: string; bytes: number; lastModified: number }
        >
      }
      const metrics: BenchmarkMetrics = {
        active: false,
        currentPhase: "idle",
        maxMainThreadGapMs: 0,
        phaseMaxGapMs: {},
        phases: [],
        longTasksMs: [],
        workerPayloads: [],
      }
      Object.assign(window, { spec007BenchmarkMetrics: metrics })

      let lastFrame = performance.now()
      const heartbeat = (now: number) => {
        const gap = now - lastFrame
        lastFrame = now
        if (metrics.active) {
          metrics.maxMainThreadGapMs = Math.max(metrics.maxMainThreadGapMs, gap)
          metrics.phaseMaxGapMs[metrics.currentPhase] = Math.max(
            metrics.phaseMaxGapMs[metrics.currentPhase] ?? 0,
            gap
          )
        }
        requestAnimationFrame(heartbeat)
      }
      requestAnimationFrame(heartbeat)
      if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
        new PerformanceObserver((list) => {
          if (!metrics.active) return
          metrics.longTasksMs.push(
            ...list.getEntries().map((entry) => entry.duration)
          )
        }).observe({ entryTypes: ["longtask"] })
      }

      const originalAddEventListener = Worker.prototype.addEventListener
      const observedWorkers = new WeakSet<Worker>()
      Object.defineProperty(Worker.prototype, "addEventListener", {
        configurable: true,
        value: function (
          this: Worker,
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions
        ) {
          if (!observedWorkers.has(this)) {
            observedWorkers.add(this)
            originalAddEventListener.call(this, "message", ((
              event: MessageEvent
            ) => {
              const message = event.data as {
                type?: string
                phase?: string
              }
              if (
                metrics.active &&
                message.type === "progress" &&
                message.phase
              ) {
                metrics.currentPhase = message.phase
                if (!metrics.phases.includes(message.phase)) {
                  metrics.phases.push(message.phase)
                }
              }
            }) as EventListener)
          }
          return originalAddEventListener.call(this, type, listener, options)
        },
      })
      const originalPostMessage = Worker.prototype.postMessage
      Object.defineProperty(Worker.prototype, "postMessage", {
        configurable: true,
        value: function (
          this: Worker,
          message: unknown,
          transferOrOptions?: Transferable[] | StructuredSerializeOptions
        ) {
          const request = message as {
            kind?: string
            payload?: {
              collection?: {
                entries?: Array<{ bytes?: Uint8Array }>
              }
              entries?: Array<{ bytes?: Uint8Array }>
            }
          }
          const entries =
            request.payload?.entries ??
            request.payload?.collection?.entries ??
            []
          metrics.workerPayloads.push({
            kind: request.kind ?? "unknown",
            bytes: entries.reduce(
              (total, entry) => total + (entry.bytes?.byteLength ?? 0),
              0
            ),
            files: entries.length,
          })
          return transferOrOptions === undefined
            ? originalPostMessage.call(this, message)
            : originalPostMessage.call(this, message, transferOrOptions)
        },
      })

      const root: DirectoryNode = {
        directories: new Map(),
        files: new Map(),
      }
      for (const file of files) {
        const segments = file.path.split("/")
        const name = segments.pop()!
        let directory = root
        for (const segment of segments) {
          let child = directory.directories.get(segment)
          if (!child) {
            child = { directories: new Map(), files: new Map() }
            directory.directories.set(segment, child)
          }
          directory = child
        }
        directory.files.set(name, file)
      }
      const directoryHandle = (
        name: string,
        directory: DirectoryNode
      ): {
        kind: "directory"
        name: string
        entries(): AsyncIterableIterator<
          [
            string,
            (
              | ReturnType<typeof directoryHandle>
              | {
                  kind: "file"
                  name: string
                  getFile(): Promise<{
                    size: number
                    lastModified: number
                    arrayBuffer(): Promise<ArrayBuffer>
                  }>
                }
            ),
          ]
        >
      } => ({
        kind: "directory",
        name,
        async *entries() {
          for (const [childName, child] of [
            ...directory.directories.entries(),
          ].sort(([left], [right]) => left.localeCompare(right))) {
            yield [childName, directoryHandle(childName, child)]
          }
          for (const [fileName, file] of [...directory.files.entries()].sort(
            ([left], [right]) => left.localeCompare(right)
          )) {
            yield [
              fileName,
              {
                kind: "file",
                name: fileName,
                async getFile() {
                  const bytes = new TextEncoder().encode(file.text)
                  return {
                    size: bytes.byteLength,
                    lastModified: file.lastModified,
                    async arrayBuffer() {
                      return bytes.slice().buffer
                    },
                  }
                },
              },
            ]
          }
        },
      })
      const pickedRoot = directoryHandle("CodeGraph self repository", root)
      Object.assign(window, {
        showDirectoryPicker: async () => pickedRoot,
      })
    },
    { files: sources }
  )

  type BenchmarkSnapshot = {
    active: boolean
    currentPhase: string
    maxMainThreadGapMs: number
    phaseMaxGapMs: Record<string, number>
    phases: string[]
    longTasksMs: number[]
    workerPayloads: Array<{ kind: string; bytes: number; files: number }>
  }
  const beginBenchmarkRun = () =>
    page.evaluate(() => {
      const metrics = (
        window as typeof window & {
          spec007BenchmarkMetrics: BenchmarkSnapshot
        }
      ).spec007BenchmarkMetrics
      metrics.active = true
      metrics.currentPhase = "scan"
      return performance.now()
    })
  const endBenchmarkRun = (startedAt: number) =>
    page.evaluate((start) => {
      const metrics = (
        window as typeof window & {
          spec007BenchmarkMetrics: BenchmarkSnapshot
        }
      ).spec007BenchmarkMetrics
      metrics.active = false
      return performance.now() - start
    }, startedAt)
  const resourceSnapshot = () =>
    page.evaluate(async () => {
      const memory = performance as Performance & {
        memory?: { usedJSHeapSize?: number }
      }
      const storage = await navigator.storage.estimate()
      return {
        heapBytes: memory.memory?.usedJSHeapSize,
        storageUsageBytes: storage.usage,
        storageQuotaBytes: storage.quota,
      }
    })

  const indexDurationsMs: number[] = []
  const countEvidence: Array<{
    files: number
    nodes: number
    edges: number
  }> = []
  const resources: Array<{
    point: string
    heapBytes?: number
    storageUsageBytes?: number
    storageQuotaBytes?: number
  }> = []

  async function indexSelfRepository(run: number) {
    const startedAt = await beginBenchmarkRun()
    await page.getByRole("button", { name: "Open local folder" }).click()
    const cancel = page.getByRole("button", {
      name: "Cancel local indexing",
    })
    await expect(cancel).toBeVisible()
    await expect(cancel).toBeEnabled()
    const routeChrome = page
      .getByRole("button", { name: "Search symbols" })
      .first()
    await expect(routeChrome).toBeEnabled()
    await routeChrome.click()
    await expect(
      page.getByRole("heading", { name: "Search symbols" })
    ).toBeVisible()
    await page.getByRole("button", { name: "Overview" }).click()
    await expect(
      page.getByText("Local keyword index complete.", { exact: true })
    ).toBeVisible({ timeout: 60_000 })
    const elapsedMs = await endBenchmarkRun(startedAt)
    indexDurationsMs.push(elapsedMs)
    expect(elapsedMs).toBeLessThanOrEqual(60_000)

    const overviewText = await page
      .getByText(/\d[\d,]* symbols and \d[\d,]* edges/)
      .innerText()
    const counts = /([\d,]+) symbols and ([\d,]+) edges/.exec(overviewText)
    expect(counts).not.toBeNull()
    await page.getByRole("button", { name: "Search symbols" }).first().click()
    const fileText = await page
      .getByText(/\d[\d,]* symbols across \d[\d,]* files\./)
      .innerText()
    const files = /across ([\d,]+) files/.exec(fileText)
    expect(files).not.toBeNull()
    countEvidence.push({
      files: Number(files![1].replaceAll(",", "")),
      nodes: Number(counts![1].replaceAll(",", "")),
      edges: Number(counts![2].replaceAll(",", "")),
    })
    expect(countEvidence.at(-1)!.files).toBeGreaterThanOrEqual(600)
    resources.push({
      point: `run-${run}-high-water`,
      ...(await resourceSnapshot()),
    })
  }

  async function deleteSelfRepository(run: number) {
    await page.getByRole("button", { name: "Overview" }).click()
    await page.getByRole("button", { name: "Delete browser index" }).click()
    await page
      .getByLabel("Type CodeGraph self repository to confirm")
      .fill("CodeGraph self repository")
    await page.getByRole("button", { name: "Delete browser data" }).click()
    await expect(
      page.getByRole("status").filter({
        hasText:
          "Deleted. CodeGraph self repository browser-owned data was deleted. Source folder files were not changed.",
      })
    ).toBeVisible()
    resources.push({
      point: `run-${run}-post-cleanup`,
      ...(await resourceSnapshot()),
    })
  }

  try {
    await page.goto("/")
    resources.push({ point: "baseline", ...(await resourceSnapshot()) })
    await indexSelfRepository(1)
    console.info("SPEC007_SELF_REPOSITORY_CHECKPOINT index-1-complete")

    const searchSamples: number[] = []
    const searchInput = page.getByRole("textbox", { name: "Search symbols" })
    const searchButton = page
      .locator("form")
      .getByRole("button", { name: "Search" })
    await searchInput.fill("openBrowserGraphStore")
    await searchButton.click()
    await expect(
      page.getByRole("cell", { name: "openBrowserGraphStore", exact: true })
    ).toBeVisible()
    for (let index = 0; index < READ_SAMPLE_COUNT; index += 1) {
      const query =
        index % 2 === 0 ? "openBrowserGraphStore" : "createWorkerRuntime"
      searchSamples.push(
        await measureUserObserved(
          page,
          async () => {
            await searchInput.fill(query)
            await searchButton.click()
          },
          async () => {
            await expect(
              page.getByRole("cell", { name: query, exact: true })
            ).toBeVisible()
          }
        )
      )
      if ((index + 1) % 5 === 0) {
        console.info(`SPEC007_SELF_REPOSITORY_CHECKPOINT search-${index + 1}`)
      }
    }

    await searchInput.fill("openBrowserGraphStore")
    await searchButton.click()
    await expect(
      page.getByRole("cell", { name: "openBrowserGraphStore", exact: true })
    ).toBeVisible()
    const targetRow = page.getByRole("row").filter({
      has: page.getByRole("cell", {
        name: "openBrowserGraphStore",
        exact: true,
      }),
    })
    await targetRow.getByRole("button", { name: "Open", exact: true }).click()
    const graphSamples: number[] = []
    await page.getByRole("button", { name: "Open graph" }).click()
    await expect(
      page.getByRole("img", { name: "Graph neighborhood canvas" })
    ).toBeVisible()
    await page
      .getByRole("button", { name: "Symbol", exact: true })
      .first()
      .click()
    for (let index = 0; index < READ_SAMPLE_COUNT; index += 1) {
      graphSamples.push(
        await measureUserObserved(
          page,
          () => page.getByRole("button", { name: "Open graph" }).click(),
          async () => {
            await expect(
              page.getByRole("img", { name: "Graph neighborhood canvas" })
            ).toBeVisible()
          }
        )
      )
      await page
        .getByRole("button", { name: "Symbol", exact: true })
        .first()
        .click()
      if ((index + 1) % 5 === 0) {
        console.info(`SPEC007_SELF_REPOSITORY_CHECKPOINT graph-${index + 1}`)
      }
    }

    const impactSamples: number[] = []
    await page.getByRole("button", { name: "Review impact" }).click()
    await expect(
      page.getByRole("heading", { name: "Impact radius" })
    ).toBeVisible()
    await page
      .getByRole("button", { name: "Symbol", exact: true })
      .first()
      .click()
    for (let index = 0; index < READ_SAMPLE_COUNT; index += 1) {
      impactSamples.push(
        await measureUserObserved(
          page,
          () => page.getByRole("button", { name: "Review impact" }).click(),
          async () => {
            await expect(
              page.getByRole("heading", { name: "Impact radius" })
            ).toBeVisible()
          }
        )
      )
      await page
        .getByRole("button", { name: "Symbol", exact: true })
        .first()
        .click()
      if ((index + 1) % 5 === 0) {
        console.info(`SPEC007_SELF_REPOSITORY_CHECKPOINT impact-${index + 1}`)
      }
    }

    const queryPlans = await captureQueryPlans(page)
    const readEvidence = {
      sampleCount: READ_SAMPLE_COUNT,
      warmupsPerOperation: 1,
      budgetMs: READ_P95_BUDGET_MS,
      samples: {
        search: searchSamples,
        graph: graphSamples,
        impact: impactSamples,
      },
      p95Ms: {
        search: p95(searchSamples),
        graph: p95(graphSamples),
        impact: p95(impactSamples),
      },
      queryPlans,
    }
    console.info(
      `SPEC007_SELF_REPOSITORY_READ_P95 ${JSON.stringify(readEvidence.p95Ms)}`
    )
    expect(readEvidence.p95Ms.search).toBeLessThanOrEqual(READ_P95_BUDGET_MS)
    expect(readEvidence.p95Ms.graph).toBeLessThanOrEqual(READ_P95_BUDGET_MS)
    expect(readEvidence.p95Ms.impact).toBeLessThanOrEqual(READ_P95_BUDGET_MS)
    expect(queryPlans.search?.join(" ")).toMatch(/fts|index/i)
    expect(queryPlans.graph?.join(" ")).toContain("MULTI-INDEX OR")
    expect(queryPlans.impact?.join(" ")).toContain("idx_edges_target_kind")

    await deleteSelfRepository(1)
    console.info("SPEC007_SELF_REPOSITORY_CHECKPOINT delete-1-complete")
    await indexSelfRepository(2)
    console.info("SPEC007_SELF_REPOSITORY_CHECKPOINT index-2-complete")
    await deleteSelfRepository(2)
    console.info("SPEC007_SELF_REPOSITORY_CHECKPOINT delete-2-complete")

    const browserVersion = browser.version()
    const browserMetrics = await page.evaluate(() => {
      const metrics = (
        window as typeof window & {
          spec007BenchmarkMetrics: BenchmarkSnapshot
        }
      ).spec007BenchmarkMetrics
      return {
        ...metrics,
        browserHardwareConcurrency: navigator.hardwareConcurrency,
      }
    })
    const evidence = {
      disclosure: {
        ...runtimeDisclosure(),
        browser: `Chromium ${browserVersion}`,
        playwright: test.info().config.version,
      },
      repository: {
        candidateFiles: sources.length,
        candidateBytes: sourceBytes,
        runs: indexDurationsMs.length,
        indexDurationsMs,
        counts: countEvidence,
        cacheState: "cold after explicit delete before each run",
        storageState: resources,
        embeddings: "disabled",
      },
      responsiveness: {
        maxMainThreadGapMs: browserMetrics.maxMainThreadGapMs,
        phaseMaxGapMs: browserMetrics.phaseMaxGapMs,
        phases: browserMetrics.phases,
        longTasksMs: browserMetrics.longTasksMs,
      },
      budgets: {
        workerPayloadBytes: WORKER_PAYLOAD_BUDGET_BYTES,
        sourceReadBatchBytes: WORKER_READ_BATCH_BUDGET_BYTES,
        fileBatchCount: WORKER_FILE_BATCH_BUDGET,
        observedWorkerPayloads: browserMetrics.workerPayloads,
      },
      reads: readEvidence,
      assets: {
        inventory: assetInventory,
        requestSequence: assetRequests,
      },
    }
    await testInfo.attach("spec007-self-repository-performance.json", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    })
    console.info(
      `SPEC007_SELF_REPOSITORY ${JSON.stringify({
        files: countEvidence[0]?.files,
        nodes: countEvidence[0]?.nodes,
        edges: countEvidence[0]?.edges,
        runs: indexDurationsMs.length,
        indexDurationsMs,
        maxMainThreadGapMs: browserMetrics.maxMainThreadGapMs,
        p95Ms: readEvidence.p95Ms,
      })}`
    )

    expect(indexDurationsMs).toHaveLength(2)
    expect(countEvidence[1]).toEqual(countEvidence[0])
    expect(browserMetrics.phases).toEqual(
      expect.arrayContaining([
        "read",
        "grammar-load",
        "parse",
        "store",
        "publish",
      ])
    )
    expect(browserMetrics.maxMainThreadGapMs).toBeLessThanOrEqual(250)
    expect(Math.max(0, ...browserMetrics.longTasksMs)).toBeLessThanOrEqual(250)
    expect(browserMetrics.workerPayloads.length).toBeGreaterThan(0)
    const sourceBatches = browserMetrics.workerPayloads.filter(
      (payload) => payload.kind === "source-batch"
    )
    expect(sourceBatches.length).toBeGreaterThan(1)
    for (const payload of browserMetrics.workerPayloads) {
      expect(payload.bytes).toBeLessThanOrEqual(WORKER_PAYLOAD_BUDGET_BYTES)
      expect(payload.files).toBeLessThanOrEqual(WORKER_FILE_BATCH_BUDGET)
    }
    for (const payload of sourceBatches) {
      expect(payload.bytes).toBeLessThanOrEqual(
        WORKER_READ_BATCH_BUDGET_BYTES
      )
    }
    expect(assetInventory).toHaveLength(10)
  } finally {
    if (testInfo.retry === 0) {
      await context.tracing.stop({ path: tracePath }).catch(() => undefined)
      if (fs.existsSync(tracePath)) {
        await testInfo.attach("spec007-self-repository-playwright-trace.zip", {
          path: tracePath,
          contentType: "application/zip",
        })
      }
    }
  }
})

test("keeps the complete local lifecycle keyboard operable at 320 CSS pixels with reduced motion", async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const tracePath = testInfo.outputPath("spec007-accessibility-trace.zip")
  if (testInfo.retry === 0) {
    await context.tracing.start({ screenshots: true, snapshots: true })
  }

  let releaseEmbedding: (() => void) | undefined
  const embeddingGate = new Promise<void>((resolve) => {
    releaseEmbedding = resolve
  })
  let endpointCalls = 0
  await page.route("https://embeddings.example/**", async (route) => {
    endpointCalls += 1
    const body = route.request().postDataJSON() as {
      input?: unknown[]
      model?: string
    }
    await embeddingGate
    await route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: body.model,
        data: (body.input ?? []).map((_, index) => ({
          index,
          embedding: [index + 0.25, index + 0.75],
        })),
      }),
    })
  })

  await page.addInitScript(
    ({ source }) => {
      const file = {
        kind: "file",
        name: "main.ts",
        async getFile() {
          const bytes = new TextEncoder().encode(source)
          return {
            size: bytes.byteLength,
            lastModified: 1,
            async arrayBuffer() {
              return bytes.slice().buffer
            },
          }
        },
      }
      const sourceDirectory = {
        kind: "directory",
        name: "src",
        async *entries() {
          yield ["main.ts", file] as const
        },
      }
      Object.assign(window, {
        showDirectoryPicker: async () => ({
          kind: "directory",
          name: "Keyboard project",
          async *entries() {
            yield ["src", sourceDirectory] as const
          },
        }),
      })
    },
    { source: mainSource }
  )

  try {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/")
    await expectNoHorizontalOverflow(page)

    await activateWithKeyboard(
      page,
      page.getByRole("button", { name: "Toggle Sidebar" })
    )
    const openFolder = page.getByRole("button", {
      name: "Open local folder",
    })
    await expect(openFolder).toBeVisible()
    await activateWithKeyboard(page, openFolder)
    const cancel = page.getByRole("button", {
      name: "Cancel local indexing",
    })
    await expect(cancel).toBeVisible()
    await activateWithKeyboard(page, cancel)
    const cancelledStatus = page.getByRole("status").filter({
      hasText: "Cancelled. Local indexing was cancelled.",
    })
    await expect(cancelledStatus).toBeVisible()
    await expect(cancelledStatus).toBeFocused()
    await expectNoHorizontalOverflow(page)

    await activateWithKeyboard(page, openFolder)
    await expect(
      page.getByText("Local keyword index complete.", { exact: true })
    ).toBeVisible({ timeout: 20_000 })
    await expectNoHorizontalOverflow(page)
    await page.keyboard.press("Escape")

    await expect(
      page.getByRole("heading", { name: "Repository overview" })
    ).toBeVisible()
    await expect(
      page.getByText("3 symbols and 2 edges", { exact: true })
    ).toBeVisible()
    const endpoint = page.getByLabel("Embedding endpoint")
    await endpoint.focus()
    await page.keyboard.type("https://embeddings.example/v1/embed")
    const model = page.getByLabel("Embedding model")
    await model.focus()
    await page.keyboard.type("keyboard-model")
    const credential = page.getByLabel("Page-session bearer key")
    await credential.focus()
    await page.keyboard.type("page-session-key")
    const consent = page.getByRole("checkbox", {
      name: /I consent to semantic indexing/,
    })
    await consent.focus()
    await page.keyboard.press("Space")
    const startSemantic = page.getByRole("button", {
      name: "Start semantic indexing",
    })
    await activateWithKeyboard(page, startSemantic)
    await expect.poll(() => endpointCalls).toBe(1)
    await activateWithKeyboard(
      page,
      page.getByRole("button", { name: "Toggle Sidebar" })
    )
    await expect(page.getByRole("progressbar")).toBeVisible()
    const progress = page.locator('[data-slot="progress-indicator"]')
    expect(
      await progress.evaluate(
        (element) => getComputedStyle(element).transitionDuration
      )
    ).toBe("0s")
    await expectNoHorizontalOverflow(page)
    await page.keyboard.press("Escape")

    releaseEmbedding?.()
    const semanticComplete = page.getByRole("status").filter({
      hasText: /Semantic indexing complete for 3 symbols/,
    })
    await expect(semanticComplete).toBeVisible({ timeout: 20_000 })
    await expect(semanticComplete).toBeFocused()

    const deleteIndex = page.getByRole("button", {
      name: "Delete browser index",
    })
    await activateWithKeyboard(page, deleteIndex)
    const confirmation = page.getByLabel("Type Keyboard project to confirm")
    await confirmation.focus()
    await page.keyboard.type("Keyboard project")
    await activateWithKeyboard(
      page,
      page.getByRole("button", { name: "Delete browser data" })
    )
    const overviewHeading = page.getByRole("heading", {
      name: "Repository overview",
    })
    await expect(overviewHeading).toBeFocused()
    await activateWithKeyboard(
      page,
      page.getByRole("button", { name: "Toggle Sidebar" })
    )
    await expect(
      page.getByRole("status").filter({
        hasText:
          "Deleted. Keyboard project browser-owned data was deleted. Source folder files were not changed.",
      })
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
  } finally {
    if (testInfo.retry === 0) {
      await context.tracing.stop({ path: tracePath })
      await testInfo.attach("spec007-accessibility-playwright-trace.zip", {
        path: tracePath,
        contentType: "application/zip",
      })
    }
  }
})

test("indexes, browses, and reloads a picked folder entirely in Chromium", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  await page.addInitScript(
    ({ source }) => {
      const activeSource = sessionStorage.getItem("spec007-source") ?? source
      Object.assign(window, { spec007Source: activeSource })
      const file = {
        kind: "file",
        name: "main.ts",
        async getFile() {
          const bytes = new TextEncoder().encode(
            (window as typeof window & { spec007Source: string }).spec007Source
          )
          return {
            size: bytes.byteLength,
            lastModified: 1,
            async arrayBuffer() {
              return bytes.slice().buffer
            },
          }
        },
      }
      const sourceDirectory = {
        kind: "directory",
        name: "src",
        async *entries() {
          yield ["main.ts", file] as const
        },
      }
      const root = {
        kind: "directory",
        name: "Browser fixture",
        async *entries() {
          yield ["src", sourceDirectory] as const
        },
      }
      Object.assign(window, {
        spec007PickerCalls: 0,
        showDirectoryPicker: async () => {
          ;(
            window as typeof window & { spec007PickerCalls: number }
          ).spec007PickerCalls += 1
          return root
        },
      })
    },
    { source: mainSource }
  )

  const forbiddenRequests: string[] = []
  let auditLocalRuntime = false
  page.on("request", (request) => {
    if (!auditLocalRuntime) return
    const url = request.url()
    if (
      url.includes("/api/") ||
      url.includes("/lsp") ||
      request.resourceType() === "websocket" ||
      !url.startsWith("http://127.0.0.1:")
    ) {
      forbiddenRequests.push(url)
    }
  })

  await page.goto("/")
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { spec007PickerCalls: number })
          .spec007PickerCalls
    )
  ).toBe(0)

  const startedAt = Date.now()
  auditLocalRuntime = true
  await page.getByRole("button", { name: "Open local folder" }).click()
  await page.getByRole("button", { name: "Cancel local indexing" }).click()
  await expect(
    page.getByRole("status").filter({
      hasText: "Cancelled. Local indexing was cancelled.",
    })
  ).toBeVisible()
  await page.getByRole("button", { name: "Open local folder" }).click()
  await expect(
    page.getByText("Local keyword index complete.", { exact: true })
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByText("3 symbols and 2 edges", { exact: true })
  ).toBeVisible()
  expect(Date.now() - startedAt).toBeLessThan(60_000)
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { spec007PickerCalls: number })
          .spec007PickerCalls
    )
  ).toBe(2)
  await page.getByRole("button", { name: "Search symbols" }).first().click()
  await page.getByRole("textbox", { name: "Search symbols" }).fill("greet")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(page.getByText("greet", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Open", exact: true }).click()
  await page.getByRole("button", { name: "Open source" }).click()
  await expect(page.getByLabel("Cached source for src/main.ts")).toContainText(
    "normalizeName"
  )

  const firstCounts = await page.locator("body").innerText()
  expect(firstCounts).toContain("greet")
  expect(firstCounts).toContain("normalizeName")
  expect(forbiddenRequests).toEqual([])

  const refreshedSource = `${mainSource}\nexport function farewell(name: string): string {\n  return \`Goodbye \${normalizeName(name)}\`;\n}\n`
  await page.evaluate((source) => {
    ;(window as typeof window & { spec007Source: string }).spec007Source =
      source
    sessionStorage.setItem("spec007-source", source)
  }, refreshedSource)
  await page.getByRole("button", { name: "Overview" }).click()
  await page.getByRole("button", { name: "Refresh browser index" }).click()
  await expect(
    page.getByText(
      "Local refresh complete: 0 added, 1 changed, 0 deleted, 0 unchanged, 0 skipped.",
      { exact: true }
    )
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByText("4 symbols and 3 edges", { exact: true })
  ).toBeVisible()

  auditLocalRuntime = false
  await page.reload()
  auditLocalRuntime = true
  await expect(
    page.getByText("Browser fixture", { exact: true }).first()
  ).toBeVisible()
  await expect(
    page.getByText("Local folder", { exact: true }).first()
  ).toBeVisible()
  await expect(
    page.getByText("4 symbols across 1 files.", { exact: true })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { spec007PickerCalls: number })
          .spec007PickerCalls
    )
  ).toBe(0)

  await page.getByRole("button", { name: "Search symbols" }).first().click()
  await page
    .getByRole("textbox", { name: "Search symbols" })
    .fill("normalizeName")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(page.getByText("normalizeName", { exact: true })).toBeVisible()
  await page.getByRole("textbox", { name: "Search symbols" }).fill("farewell")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(page.getByText("farewell", { exact: true })).toBeVisible()
  expect(forbiddenRequests).toEqual([])

  const searchSamples: number[] = []
  await page
    .getByRole("textbox", { name: "Search symbols" })
    .fill("normalizeName")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(
    page.getByRole("cell", { name: "normalizeName", exact: true })
  ).toBeVisible()
  for (let index = 0; index < READ_SAMPLE_COUNT; index += 1) {
    const query = index % 2 === 0 ? "greet" : "normalizeName"
    searchSamples.push(
      await measureUserObserved(
        page,
        async () => {
          await page
            .getByRole("textbox", { name: "Search symbols" })
            .fill(query)
          await page
            .locator("form")
            .getByRole("button", { name: "Search" })
            .click()
        },
        async () => {
          await expect(
            page.getByRole("cell", { name: query, exact: true })
          ).toBeVisible()
        }
      )
    )
  }

  const normalizeRow = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: "normalizeName", exact: true }),
  })
  await normalizeRow.getByRole("button", { name: "Open", exact: true }).click()
  await expect(page.getByRole("button", { name: "Open graph" })).toBeVisible()

  const graphSamples: number[] = []
  await page.getByRole("button", { name: "Open graph" }).click()
  await expect(
    page.getByRole("img", { name: "Graph neighborhood canvas" })
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Symbol", exact: true })
    .first()
    .click()
  await expect(page.getByRole("button", { name: "Open graph" })).toBeVisible()
  for (let index = 0; index < READ_SAMPLE_COUNT; index += 1) {
    graphSamples.push(
      await measureUserObserved(
        page,
        () => page.getByRole("button", { name: "Open graph" }).click(),
        async () => {
          await expect(
            page.getByRole("img", { name: "Graph neighborhood canvas" })
          ).toBeVisible()
        }
      )
    )
    await page
      .getByRole("button", { name: "Symbol", exact: true })
      .first()
      .click()
    await expect(page.getByRole("button", { name: "Open graph" })).toBeVisible()
  }

  const impactSamples: number[] = []
  await page.getByRole("button", { name: "Review impact" }).click()
  await expect(
    page.getByRole("heading", { name: "Impact radius" })
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Symbol", exact: true })
    .first()
    .click()
  await expect(
    page.getByRole("button", { name: "Review impact" })
  ).toBeVisible()
  for (let index = 0; index < READ_SAMPLE_COUNT; index += 1) {
    impactSamples.push(
      await measureUserObserved(
        page,
        () => page.getByRole("button", { name: "Review impact" }).click(),
        async () => {
          await expect(
            page.getByRole("heading", { name: "Impact radius" })
          ).toBeVisible()
        }
      )
    )
    await page
      .getByRole("button", { name: "Symbol", exact: true })
      .first()
      .click()
    await expect(
      page.getByRole("button", { name: "Review impact" })
    ).toBeVisible()
  }

  const queryPlans = await captureQueryPlans(page)
  const timingEvidence = {
    sampleCount: READ_SAMPLE_COUNT,
    warmupsPerOperation: 1,
    budgetMs: READ_P95_BUDGET_MS,
    samples: {
      search: searchSamples,
      graph: graphSamples,
      impact: impactSamples,
    },
    p95Ms: {
      search: p95(searchSamples),
      graph: p95(graphSamples),
      impact: p95(impactSamples),
    },
    queryPlans,
  }
  await testInfo.attach("spec007-local-read-latency.json", {
    body: JSON.stringify(timingEvidence, null, 2),
    contentType: "application/json",
  })
  console.info(
    `SPEC007_LOCAL_READ_LATENCY ${JSON.stringify({
      sampleCount: timingEvidence.sampleCount,
      warmupsPerOperation: timingEvidence.warmupsPerOperation,
      budgetMs: timingEvidence.budgetMs,
      p95Ms: timingEvidence.p95Ms,
    })}`
  )

  expect(searchSamples).toHaveLength(READ_SAMPLE_COUNT)
  expect(graphSamples).toHaveLength(READ_SAMPLE_COUNT)
  expect(impactSamples).toHaveLength(READ_SAMPLE_COUNT)
  expect(timingEvidence.p95Ms.search).toBeLessThanOrEqual(READ_P95_BUDGET_MS)
  expect(timingEvidence.p95Ms.graph).toBeLessThanOrEqual(READ_P95_BUDGET_MS)
  expect(timingEvidence.p95Ms.impact).toBeLessThanOrEqual(READ_P95_BUDGET_MS)
  expect(queryPlans.graph?.join(" ")).toContain("MULTI-INDEX OR")
  expect(queryPlans.impact?.join(" ")).toContain("idx_edges_target_kind")

  await page.getByRole("button", { name: "Overview" }).click()
  await page.getByRole("button", { name: "Delete browser index" }).click()
  await page
    .getByLabel("Type Browser fixture to confirm")
    .fill("Browser fixture")
  await page.getByRole("button", { name: "Delete browser data" }).click()
  await expect(
    page.getByRole("status").filter({
      hasText:
        "Deleted. Browser fixture browser-owned data was deleted. Source folder files were not changed.",
    })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as typeof window & { spec007Source: string }).spec007Source
    )
  ).toBe(refreshedSource)
  expect(forbiddenRequests).toEqual([])

  await page.setViewportSize({ width: 320, height: 800 })
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    )
    .toBe(true)
})
