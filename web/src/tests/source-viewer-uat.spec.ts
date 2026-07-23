import { expect, test } from "@playwright/test"

import { installApiMocks } from "./playwright-fixtures"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class ControlledWebSocket extends EventTarget {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3
      readyState = ControlledWebSocket.CONNECTING
      bufferedAmount = 0
      readonly url: string

      constructor(url: string) {
        super()
        this.url = url
        ;((window as unknown as { __sourceSockets?: ControlledWebSocket[] }).__sourceSockets ??= []).push(this)
        queueMicrotask(() => {
          this.readyState = ControlledWebSocket.OPEN
          this.dispatchEvent(new Event("open"))
        })
      }

      send(raw: string) {
        const request = JSON.parse(raw) as { id?: number; method: string; params?: { textDocument?: { uri?: string } } }
        if (request.id === undefined) {
          if (request.method === "exit") this.close(1000, "exit")
          return
        }
        let result: unknown = null
        let error: unknown
        const uri = request.params?.textDocument?.uri ?? ""
        const failure = (window as unknown as { __sourceFailure?: string }).__sourceFailure
        if (request.method === "initialize") result = { capabilities: { positionEncoding: "utf-16" } }
        if (request.method === "codegraph/textDocumentContent") {
          if (failure === "stale") error = { code: -32801, message: "Content modified" }
          else if (failure === "unavailable") error = { code: -32803, message: "Request failed", data: { reason: "unreadable" } }
          else result = {
            text: uri.endsWith("routes.ts") ? "export function handleApiRequest() {}\n" : "export async function startWebServer() {}\n",
            languageId: "typescript",
            contentHash: uri.endsWith("routes.ts") ? "routes" : "server",
            snapshotToken: uri.endsWith("routes.ts") ? "routes-1" : "server-1",
          }
        }
        if (request.method === "textDocument/references") result = [{
          uri: "file:///workspace/codegraph/src/server/routes.ts",
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 18 } },
        }]
        if (request.method === "textDocument/hover") result = {
          contents: { kind: "markdown", value: "function startWebServer(): Promise<void>" },
        }
        if (request.method === "textDocument/definition") result = {
          uri: "file:///workspace/codegraph/src/server/routes.ts",
          range: { start: { line: 0, character: 16 }, end: { line: 0, character: 32 } },
        }
        if (request.method === "workspace/symbol") result = [{
          name: "startWebServer",
          kind: 12,
          location: {
            uri: "file:///workspace/codegraph/src/server/index.ts",
            range: { start: { line: 0, character: 22 }, end: { line: 0, character: 36 } },
          },
          data: { codegraphNodeId: "node-a" },
        }]
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify({ jsonrpc: "2.0", id: request.id, ...(error ? { error } : { result }) }),
        })))
      }

      close(code = 1000, reason = "closed") {
        this.readyState = ControlledWebSocket.CLOSED
        this.dispatchEvent(new CloseEvent("close", { code, reason }))
      }
    }

    Object.defineProperty(window, "WebSocket", { value: ControlledWebSocket, writable: true })
  })
})

test("source viewer stays hidden until the WebSocket transport ships", async ({ page }) => {
  await installApiMocks(page)
  await page.goto("/symbol/node-a")

  await expect(page.getByText("export async function startWebServer(options: ServerOptions): Promise<void>", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Open source" })).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __sourceSockets?: unknown[] }).__sourceSockets?.length ?? 0)).toBe(0)
})
