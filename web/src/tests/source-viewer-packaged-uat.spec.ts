import { expect, test } from "@playwright/test"

const serverUrl = process.env.CODEGRAPH_PACKAGED_UAT_URL
const nodeId = process.env.CODEGRAPH_PACKAGED_UAT_NODE_ID
const symbolName = process.env.CODEGRAPH_PACKAGED_UAT_SYMBOL
const sourcePath = process.env.CODEGRAPH_PACKAGED_UAT_SOURCE

test("packaged server provides real source intelligence and history", async ({ page }) => {
  test.skip(!serverUrl || !nodeId || !symbolName || !sourcePath, "requires a packaged indexed-repository fixture")
  const sockets: Array<{ waitForEvent(event: "close"): Promise<unknown> }> = []
  page.on("websocket", (socket) => sockets.push(socket))

  await page.goto(`${serverUrl}/symbol/${encodeURIComponent(nodeId!)}`)
  await expect(page.getByText(symbolName!, { exact: true }).first()).toBeVisible()
  expect(sockets).toHaveLength(0)

  await page.getByRole("button", { name: "Open source" }).click()
  const source = page.getByRole("textbox", { name: `Read-only source for ${sourcePath}` })
  await expect(source).toContainText(symbolName!)
  await expect(source.locator("mark")).toHaveText(symbolName!)
  expect(sockets).toHaveLength(1)

  await page.getByRole("button", { name: "Show hover details" }).click()
  await expect(page.getByLabel("Hover details")).toContainText(symbolName!)

  const references = page.getByRole("region", { name: "References" }).getByRole("button")
  expect(await references.count()).toBeGreaterThan(1)
  await references.last().click()
  const callUrl = page.url()
  await page.getByRole("button", { name: "Go to definition" }).click()
  await expect(page).not.toHaveURL(callUrl)
  const declarationUrl = page.url()

  await page.goBack()
  await expect(page).toHaveURL(callUrl)
  await page.goForward()
  await expect(page).toHaveURL(declarationUrl)

  const firstClosed = sockets[0]!.waitForEvent("close")
  await page.getByRole("button", { name: "Close source" }).click()
  await firstClosed
  await page.getByRole("button", { name: "Open source" }).click()
  await expect(page.getByRole("textbox", { name: `Read-only source for ${sourcePath}` })).toBeVisible()
  expect(sockets).toHaveLength(2)
})
