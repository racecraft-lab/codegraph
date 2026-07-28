import { expect, test, type Page } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const READ_SAMPLE_COUNT = 20
const READ_P95_BUDGET_MS = 150
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

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

async function measureUserObserved(
  page: Page,
  action: () => Promise<void>,
  rendered: () => Promise<void>,
) {
  const startedAt = await page.evaluate(() => performance.now())
  await action()
  await rendered()
  return page.evaluate((start) => performance.now() - start, startedAt)
}

async function captureQueryPlans(page: Page) {
  const workerFile = listFiles(path.join(webRoot, "dist")).find((file) =>
    /local-indexing-worker[^/]*\.js$/.test(file),
  )
  if (!workerFile) throw new Error("Built local-indexing worker is unavailable.")
  const workerUrl = `/${path
    .relative(path.join(webRoot, "dist"), workerFile)
    .replaceAll(path.sep, "/")}`
  return page.evaluate(
    async ({ url, poolName }) => {
      const worker = new Worker(url, { type: "module" })
      const request = <T>(kind: string, payload: unknown = {}) =>
        new Promise<T>((resolve, reject) => {
          const requestId = crypto.randomUUID()
          const timeout = window.setTimeout(
            () => reject(new Error(`Timed out: ${kind}`)),
            10_000,
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
            else reject(new Error(`${message.error?.code}: ${message.error?.message}`))
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
    },
  )
}

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

test("indexes, browses, and reloads a picked folder entirely in Chromium", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  await page.addInitScript(({ source }) => {
    const activeSource = sessionStorage.getItem("spec007-source") ?? source
    Object.assign(window, { spec007Source: activeSource })
    const file = {
      kind: "file",
      name: "main.ts",
      async getFile() {
        const bytes = new TextEncoder().encode(
          (window as typeof window & { spec007Source: string })
            .spec007Source,
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
        ;(window as typeof window & { spec007PickerCalls: number })
          .spec007PickerCalls += 1
        return root
      },
    })
  }, { source: mainSource })

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
          .spec007PickerCalls,
    ),
  ).toBe(0)

  const startedAt = Date.now()
  auditLocalRuntime = true
  await page.getByRole("button", { name: "Open local folder" }).click()
  await page.getByRole("button", { name: "Cancel local indexing" }).click()
  await expect(
    page.getByRole("status").filter({
      hasText: "Cancelled. Local indexing was cancelled.",
    }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Open local folder" }).click()
  await expect(
    page.getByText("Local keyword index complete.", { exact: true }),
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByText("3 symbols and 2 edges", { exact: true }),
  ).toBeVisible()
  expect(Date.now() - startedAt).toBeLessThan(60_000)
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { spec007PickerCalls: number })
          .spec007PickerCalls,
    ),
  ).toBe(2)
  await page.getByRole("button", { name: "Search symbols" }).first().click()
  await page.getByRole("textbox", { name: "Search symbols" }).fill("greet")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(page.getByText("greet", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Open", exact: true }).click()
  await page.getByRole("button", { name: "Open source" }).click()
  await expect(
    page.getByLabel("Cached source for src/main.ts"),
  ).toContainText("normalizeName")

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
      { exact: true },
    ),
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByText("4 symbols and 3 edges", { exact: true }),
  ).toBeVisible()

  auditLocalRuntime = false
  await page.reload()
  auditLocalRuntime = true
  await expect(page.getByText("Browser fixture", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Local folder", { exact: true }).first()).toBeVisible()
  await expect(
    page.getByText("4 symbols across 1 files.", { exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { spec007PickerCalls: number })
          .spec007PickerCalls,
    ),
  ).toBe(0)

  await page.getByRole("button", { name: "Search symbols" }).first().click()
  await page.getByRole("textbox", { name: "Search symbols" }).fill("normalizeName")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(page.getByText("normalizeName", { exact: true })).toBeVisible()
  await page.getByRole("textbox", { name: "Search symbols" }).fill("farewell")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(page.getByText("farewell", { exact: true })).toBeVisible()
  expect(forbiddenRequests).toEqual([])

  const searchSamples: number[] = []
  await page.getByRole("textbox", { name: "Search symbols" }).fill("normalizeName")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(page.getByRole("cell", { name: "normalizeName", exact: true })).toBeVisible()
  for (let index = 0; index < READ_SAMPLE_COUNT; index += 1) {
    const query = index % 2 === 0 ? "greet" : "normalizeName"
    searchSamples.push(
      await measureUserObserved(
        page,
        async () => {
          await page.getByRole("textbox", { name: "Search symbols" }).fill(query)
          await page.locator("form").getByRole("button", { name: "Search" }).click()
        },
        async () => {
          await expect(page.getByRole("cell", { name: query, exact: true })).toBeVisible()
        },
      ),
    )
  }

  const normalizeRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "normalizeName", exact: true }) })
  await normalizeRow.getByRole("button", { name: "Open", exact: true }).click()
  await expect(page.getByRole("button", { name: "Open graph" })).toBeVisible()

  const graphSamples: number[] = []
  await page.getByRole("button", { name: "Open graph" }).click()
  await expect(page.getByRole("img", { name: "Graph neighborhood canvas" })).toBeVisible()
  await page.getByRole("button", { name: "Symbol", exact: true }).first().click()
  await expect(page.getByRole("button", { name: "Open graph" })).toBeVisible()
  for (let index = 0; index < READ_SAMPLE_COUNT; index += 1) {
    graphSamples.push(
      await measureUserObserved(
        page,
        () => page.getByRole("button", { name: "Open graph" }).click(),
        async () => {
          await expect(page.getByRole("img", { name: "Graph neighborhood canvas" })).toBeVisible()
        },
      ),
    )
    await page.getByRole("button", { name: "Symbol", exact: true }).first().click()
    await expect(page.getByRole("button", { name: "Open graph" })).toBeVisible()
  }

  const impactSamples: number[] = []
  await page.getByRole("button", { name: "Review impact" }).click()
  await expect(page.getByRole("heading", { name: "Impact radius" })).toBeVisible()
  await page.getByRole("button", { name: "Symbol", exact: true }).first().click()
  await expect(page.getByRole("button", { name: "Review impact" })).toBeVisible()
  for (let index = 0; index < READ_SAMPLE_COUNT; index += 1) {
    impactSamples.push(
      await measureUserObserved(
        page,
        () => page.getByRole("button", { name: "Review impact" }).click(),
        async () => {
          await expect(page.getByRole("heading", { name: "Impact radius" })).toBeVisible()
        },
      ),
    )
    await page.getByRole("button", { name: "Symbol", exact: true }).first().click()
    await expect(page.getByRole("button", { name: "Review impact" })).toBeVisible()
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
    })}`,
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
    }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { spec007Source: string }).spec007Source,
    ),
  ).toBe(refreshedSource)
  expect(forbiddenRequests).toEqual([])

  await page.setViewportSize({ width: 320, height: 800 })
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true)
})
