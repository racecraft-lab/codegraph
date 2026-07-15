import { expect, test } from "@playwright/test"

import { installApiMocks } from "./playwright-fixtures"

test.use({ viewport: { width: 390, height: 844 } })

test("mobile layout avoids horizontal overflow and preserves primary navigation", async ({ page }) => {
  await installApiMocks(page)

  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Repository overview" })).toBeVisible()
  await expect(page.locator("header").getByRole("button", { name: "Search symbols" })).toBeVisible()

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(horizontalOverflow).toBeLessThanOrEqual(1)
})
