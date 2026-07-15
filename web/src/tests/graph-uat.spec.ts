import { expect, test } from "@playwright/test"

import { installApiMocks } from "./playwright-fixtures"

test("graph route renders a nonblank canvas surface with keyboard-reachable controls", async ({ page }) => {
  await installApiMocks(page)

  await page.goto("/graph/node-a")

  const canvasRegion = page.getByRole("img", { name: "Graph neighborhood canvas" })
  await expect(canvasRegion).toBeVisible()
  await expect(page.getByRole("heading", { name: "Graph summary" })).toBeVisible()
  await expect(page.getByText("function: 2")).toBeVisible()

  const canvasCount = await canvasRegion.locator("canvas").count()
  expect(canvasCount).toBeGreaterThan(0)
  await expect
    .poll(async () => canvasRegion.locator("canvas").evaluateAll((canvases) => {
      let painted = 0
      for (const canvas of canvases) {
        const element = canvas as HTMLCanvasElement
        const context = element.getContext("2d")
        if (!context || element.width === 0 || element.height === 0) continue
        const sample = context.getImageData(0, 0, element.width, element.height).data
        for (let index = 3; index < sample.length; index += 4) {
          if (sample[index] !== 0) painted += 1
          if (painted > 32) return painted
        }
      }
      return painted
    }))
    .toBeGreaterThan(32)

  const graphControlNames = ["Depth 1", "Depth 2", "Depth 3", "Zoom in", "Zoom out", "Fit graph", "Reset graph"]
  let focusedControl = ""
  for (let count = 0; count < 20 && !graphControlNames.includes(focusedControl); count += 1) {
    await page.keyboard.press("Tab")
    focusedControl = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "")
  }
  expect(graphControlNames).toContain(focusedControl)
  await page.getByRole("button", { name: "Depth 2" }).click()
  await page.getByRole("button", { name: "Zoom in" }).click()
  await page.getByRole("button", { name: "Fit graph" }).click()
  await expect(canvasRegion).toBeVisible()
})
