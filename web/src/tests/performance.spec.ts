import { expect, test } from "@playwright/test"

import { installApiMocks } from "./playwright-fixtures"

test("search response-to-render evidence stays inside the local performance budget", async ({ page }) => {
  await installApiMocks(page)
  await page.goto("/search")

  await page.getByLabel("Search symbols").fill("startWebServer")
  await page.locator("form").getByRole("button", { name: "Search" }).click()

  await expect(page.getByText("startWebServer")).toBeVisible()
  const duration = await page.evaluate(() => performance.getEntriesByName("search-response-render").at(-1)?.duration ?? null)

  expect(duration).not.toBeNull()
  expect(duration ?? Number.POSITIVE_INFINITY).toBeLessThan(1_000)
  await expect(page.getByText(/Render evidence: \d+ ms\./)).toBeVisible()
})
