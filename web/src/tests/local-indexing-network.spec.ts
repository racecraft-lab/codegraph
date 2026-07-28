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

test("keeps local browsing offline until explicit semantic consent", async ({
  page,
  context,
  baseURL,
}) => {
  const workerFile = listFiles(path.join(webRoot, "dist")).find((file) =>
    /local-indexing-worker[^/]*\.js$/.test(file),
  )
  expect(workerFile, "built local-indexing worker").toBeDefined()
  const workerUrl = `/${path
    .relative(path.join(webRoot, "dist"), workerFile!)
    .replaceAll(path.sep, "/")}`
  const endpoint = "https://embeddings.example/v1/embed"
  const sessionCredential = "session-credential-sentinel"
  const endpointRequests: Array<{
    url: string
    method: string
    authorization: string | undefined
    inputCount: number
  }> = []

  await context.route(`${endpoint}*`, async (route) => {
    const request = route.request()
    const body = request.postDataJSON() as {
      model?: string
      input?: unknown[]
    }
    endpointRequests.push({
      url: request.url(),
      method: request.method(),
      authorization: request.headers().authorization,
      inputCount: body.input?.length ?? 0,
    })
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        model: body.model,
        data: (body.input ?? []).map((_, index) => ({
          index,
          embedding: [0.25, 0.75],
        })),
      }),
    })
  })

  await page.addInitScript(() => {
    const source = "export function greet() { return 'hello' }"
    const file = {
      kind: "file",
      name: "main.ts",
      async getFile() {
        return {
          size: source.length,
          lastModified: 1,
          async arrayBuffer() {
            return new TextEncoder().encode(source).buffer
          },
        }
      },
    }
    const directory = {
      kind: "directory",
      name: "Network audit",
      async *entries() {
        yield ["main.ts", file] as const
      },
    }
    Object.assign(window, {
      showDirectoryPicker: async () => directory,
    })
  })

  await page.addInitScript(() => {
    const attempts: Array<{ channel: string; target: string }> = []
    Object.assign(window, { spec007NetworkAttempts: attempts })
    const nativeFetch = window.fetch
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      attempts.push({
        channel: "fetch",
        target:
          input instanceof Request
            ? input.url
            : String(input),
      })
      return nativeFetch(input, init)
    }) as typeof window.fetch
    const nativeOpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async = true,
      username?: string | null,
      password?: string | null,
    ) {
      attempts.push({ channel: "xhr", target: String(url) })
      return nativeOpen.call(
        this,
        method,
        url,
        async,
        username ?? null,
        password ?? null,
      )
    }
    const NativeWebSocket = window.WebSocket
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, argumentsList) {
        attempts.push({
          channel: "websocket",
          target: String(argumentsList[0]),
        })
        return Reflect.construct(target, argumentsList)
      },
    })
    const nativeBeacon = navigator.sendBeacon?.bind(navigator)
    if (nativeBeacon) {
      navigator.sendBeacon = (url, data) => {
        attempts.push({ channel: "beacon", target: String(url) })
        return nativeBeacon(url, data)
      }
    }
  })

  const audit: Array<{
    phase: "no-consent" | "offline" | "consent"
    origin: string
    path: string
    resourceType: string
  }> = []
  let phase: "no-consent" | "offline" | "consent" = "no-consent"
  let auditEnabled = false
  page.on("request", (request) => {
    if (!auditEnabled) return
    const url = new URL(request.url())
    audit.push({
      phase,
      origin: url.origin,
      path: url.pathname,
      resourceType: request.resourceType(),
    })
  })

  await page.goto("/")
  await page.waitForLoadState("networkidle")
  await page.evaluate(() => {
    ;(
      window as typeof window & {
        spec007NetworkAttempts: unknown[]
      }
    ).spec007NetworkAttempts.length = 0
  })
  auditEnabled = true
  await page.getByRole("button", { name: "Open local folder" }).click()
  await expect(
    page.getByText("Local keyword index complete.", { exact: true }),
  ).toBeVisible({ timeout: 20_000 })
  await page.getByRole("button", { name: "Search symbols" }).first().click()
  await page.getByRole("textbox", { name: "Search symbols" }).fill("greet")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await page.getByRole("button", { name: "Open", exact: true }).click()
  await page.getByRole("button", { name: "Open source" }).click()
  await expect(page.getByLabel("Cached source for main.ts")).toContainText(
    "function greet",
  )

  const appOrigin = new URL(baseURL!).origin
  const noConsent = audit.filter((entry) => entry.phase === "no-consent")
  expect(
    noConsent.filter(
      (entry) =>
        entry.origin !== appOrigin ||
        !(
          entry.path === "/" ||
          /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css|wasm|woff2)$/.test(
            entry.path,
          )
        ),
    ),
  ).toEqual([])
  expect(noConsent.some((entry) => entry.path.includes("/api/"))).toBe(false)
  expect(noConsent.some((entry) => entry.path.includes("/lsp"))).toBe(false)
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            spec007NetworkAttempts: Array<{
              channel: string
              target: string
            }>
          }
        ).spec007NetworkAttempts,
    ),
  ).toEqual([])
  expect(endpointRequests).toEqual([])

  phase = "offline"
  await context.setOffline(true)
  const offlineAuditStart = audit.length
  await page.getByRole("button", { name: "Search symbols" }).first().click()
  await page.getByRole("textbox", { name: "Search symbols" }).fill("greet")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(
    page.getByRole("cell", { name: "greet", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Open", exact: true }).click()
  await page.getByRole("button", { name: "Open graph" }).click()
  await expect(
    page.getByRole("img", { name: "Graph neighborhood canvas" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Symbol", exact: true }).first().click()
  await page.getByRole("button", { name: "Review impact" }).click()
  await expect(
    page.getByRole("heading", { name: "Impact radius" }),
  ).toBeVisible()
  expect(audit.slice(offlineAuditStart)).toEqual([])
  await context.setOffline(false)

  phase = "consent"
  const semanticResult = await page.evaluate(
    async ({
      url,
      endpoint,
      credential,
    }) => {
      const worker = new Worker(url, { type: "module" })
      const terminal = (
        operationId: string,
        consentGrantedAt?: string,
      ) =>
        new Promise<{
          type: string
          terminal?: string
          result?: unknown
          error?: { code?: string; message?: string }
        }>((resolve, reject) => {
          const requestId = crypto.randomUUID()
          const timeout = window.setTimeout(
            () => reject(new Error("Timed out: embed")),
            10_000,
          )
          const onMessage = (event: MessageEvent) => {
            const message = event.data as {
              requestId?: string
              terminal?: string
              type: string
              result?: unknown
              error?: { code?: string; message?: string }
            }
            if (
              message.requestId !== requestId ||
              message.terminal === undefined
            )
              return
            window.clearTimeout(timeout)
            worker.removeEventListener("message", onMessage)
            resolve(message)
          }
          worker.addEventListener("message", onMessage)
          worker.postMessage({
            protocolVersion: 1,
            requestId,
            operationId,
            repositoryId: "repo_semantic_network",
            kind: "embed",
            payload: {
              endpointUrl: endpoint,
              model: "model-safe",
              dimensions: 2,
              graphGeneration: 1,
              credential,
              ...(consentGrantedAt ? { consentGrantedAt } : {}),
            },
          })
        })
      const storageRequest = (
        kind: string,
        payload: unknown,
      ) =>
        new Promise<void>((resolve, reject) => {
          const requestId = crypto.randomUUID()
          const onMessage = (event: MessageEvent) => {
            const message = event.data as {
              requestId?: string
              ok?: boolean
              error?: { message?: string }
            }
            if (message.requestId !== requestId) return
            worker.removeEventListener("message", onMessage)
            if (message.ok) resolve()
            else reject(new Error(message.error?.message))
          }
          worker.addEventListener("message", onMessage)
          worker.postMessage({ requestId, kind, payload })
        })
      await storageRequest("storage-open", {
        poolName: `semantic_${crypto.randomUUID().replaceAll("-", "_")}`,
        clearOnInit: true,
      })
      await storageRequest("storage-publish", {
        generation: {
          repositoryId: "repo_semantic_network",
          manifestFingerprint: "manifest-semantic",
          manifest: [],
          counts: { files: 1, nodes: 1, edges: 0, warnings: 0 },
          warnings: [],
          sources: [
            {
              path: "src/semantic.ts",
              contentHash: "hash-semantic",
              language: "typescript",
              size: 20,
              text: "export const semantic = true",
            },
          ],
          nodes: [
            {
              id: "node-semantic",
              kind: "variable",
              name: "semantic",
              qualifiedName: "src/semantic.ts::semantic",
              filePath: "src/semantic.ts",
              language: "typescript",
              startLine: 1,
              endLine: 1,
              startColumn: 0,
              endColumn: 20,
              isExported: true,
              updatedAt: 1,
            },
          ],
          edges: [],
        },
      })
      const withoutConsent = await terminal("embed-without-consent")
      const withConsent = await terminal(
        "embed-with-consent",
        new Date().toISOString(),
      )
      worker.terminate()
      return { withoutConsent, withConsent }
    },
    {
      url: workerUrl,
      endpoint,
      credential: sessionCredential,
    },
  )

  expect(semanticResult.withoutConsent).toMatchObject({
    type: "failure",
    terminal: "failed",
    error: { code: "consent_required" },
  })
  expect(semanticResult.withConsent).toMatchObject({
    type: "result",
    terminal: "complete",
    result: { embedded: 1 },
  })
  expect(endpointRequests).toEqual([
    {
      url: endpoint,
      method: "POST",
      authorization: `Bearer ${sessionCredential}`,
      inputCount: 1,
    },
  ])
  const consentExternal = audit.filter(
    (entry) => entry.phase === "consent" && entry.origin !== appOrigin,
  )
  expect(consentExternal).toEqual([
    {
      phase: "consent",
      origin: "https://embeddings.example",
      path: "/v1/embed",
      resourceType: "fetch",
    },
  ])
  expect(JSON.stringify(audit)).not.toContain(sessionCredential)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    sessionCredential,
  )
  expect(page.url()).not.toContain(sessionCredential)
  expect(await page.locator("body").innerText()).not.toContain(
    sessionCredential,
  )
})
