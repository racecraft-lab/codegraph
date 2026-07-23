import { expect, test } from "@playwright/test"

const serverUrl = process.env.CODEGRAPH_PACKAGED_UAT_URL
const nodeId = process.env.CODEGRAPH_PACKAGED_UAT_NODE_ID
const symbolName = process.env.CODEGRAPH_PACKAGED_UAT_SYMBOL

test("packaged server hides source intelligence until the transport ships", async ({ page }) => {
  test.skip(!serverUrl || !nodeId || !symbolName, "requires a packaged indexed-repository fixture")
  const sockets: Array<{ waitForEvent(event: "close"): Promise<unknown> }> = []
  page.on("websocket", (socket) => sockets.push(socket))

  await page.goto(`${serverUrl}/symbol/${encodeURIComponent(nodeId!)}`)
  await expect(page.getByText(symbolName!, { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Open source" })).toHaveCount(0)
  expect(sockets).toHaveLength(0)
})
