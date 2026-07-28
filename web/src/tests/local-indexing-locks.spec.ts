import { expect, test, type Page } from "@playwright/test"
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

async function spawnWorker(page: Page, url: string) {
  await page.evaluate((workerUrl) => {
    const worker = new Worker(workerUrl, { type: "module" })
    ;(window as typeof window & { spec007LockWorker?: Worker })
      .spec007LockWorker = worker
  }, url)
}

async function terminateWorker(page: Page) {
  await page.evaluate(() => {
    const owner = window as typeof window & {
      spec007LockWorker?: Worker
    }
    owner.spec007LockWorker?.terminate()
    owner.spec007LockWorker = undefined
  })
}

async function request<T>(
  page: Page,
  kind: "acquire" | "close",
  repositoryId?: string,
) {
  return page.evaluate(
    ({ requestKind, repoId }) =>
      new Promise<T>((resolve, reject) => {
        const worker = (
          window as typeof window & { spec007LockWorker?: Worker }
        ).spec007LockWorker
        if (!worker) {
          reject(new Error("Lock test worker is unavailable."))
          return
        }
        const requestId = crypto.randomUUID()
        const timeout = window.setTimeout(
          () => reject(new Error(`Timed out: ${requestKind}`)),
          10_000,
        )
        const onMessage = (event: MessageEvent) => {
          const message = event.data as {
            requestId?: string
            type?: string
            result?: T
            error?: { code?: string; message?: string }
          }
          if (message.requestId !== requestId) return
          window.clearTimeout(timeout)
          worker.removeEventListener("message", onMessage)
          if (message.type === "failure") {
            reject(
              new Error(`${message.error?.code}: ${message.error?.message}`),
            )
          } else {
            resolve(message.result as T)
          }
        }
        worker.addEventListener("message", onMessage)
        worker.postMessage({
          protocolVersion: 1,
          requestId,
          ...(repoId ? { repositoryId: repoId } : {}),
          kind: requestKind,
        })
      }),
    { requestKind: kind, repoId: repositoryId },
  )
}

test("holds one repository owner until storage closes, then allows retry", async ({
  context,
  page,
}) => {
  const workerFile = listFiles(path.join(webRoot, "dist")).find((file) =>
    /local-indexing-worker[^/]*\.js$/.test(file),
  )
  expect(workerFile, "built local-indexing worker").toBeDefined()
  const workerUrl = `/${path
    .relative(path.join(webRoot, "dist"), workerFile!)
    .replaceAll(path.sep, "/")}`
  const secondPage = await context.newPage()
  await Promise.all([page.goto("/"), secondPage.goto("/")])
  await Promise.all([
    spawnWorker(page, workerUrl),
    spawnWorker(secondPage, workerUrl),
  ])

  await expect(
    request(page, "acquire", "repo_lock"),
  ).resolves.toMatchObject({ repositoryId: "repo_lock", acquired: true })
  await expect(
    request(secondPage, "acquire", "repo_lock"),
  ).rejects.toThrow(/repository_busy/)

  await expect(request<{ paused: boolean }>(page, "close")).resolves.toEqual({
    paused: true,
  })
  await expect(
    request(secondPage, "acquire", "repo_lock"),
  ).resolves.toMatchObject({ repositoryId: "repo_lock", acquired: true })
  await expect(
    request<{ paused: boolean }>(secondPage, "close"),
  ).resolves.toEqual({ paused: true })
})

test("recovers repository ownership after the owning worker terminates", async ({
  context,
  page,
}) => {
  const workerFile = listFiles(path.join(webRoot, "dist")).find((file) =>
    /local-indexing-worker[^/]*\.js$/.test(file),
  )
  expect(workerFile, "built local-indexing worker").toBeDefined()
  const workerUrl = `/${path
    .relative(path.join(webRoot, "dist"), workerFile!)
    .replaceAll(path.sep, "/")}`
  const secondPage = await context.newPage()
  await Promise.all([page.goto("/"), secondPage.goto("/")])
  await spawnWorker(page, workerUrl)

  await expect(
    request(page, "acquire", "repo_crash"),
  ).resolves.toMatchObject({ repositoryId: "repo_crash", acquired: true })
  await terminateWorker(page)
  await spawnWorker(secondPage, workerUrl)
  await expect(
    request(secondPage, "acquire", "repo_crash"),
  ).resolves.toMatchObject({ repositoryId: "repo_crash", acquired: true })
  await expect(
    request<{ paused: boolean }>(secondPage, "close"),
  ).resolves.toEqual({ paused: true })
})
