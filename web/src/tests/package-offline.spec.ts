import { expect, test } from "@playwright/test"

import { collectExternalRequests, installApiMocks } from "./playwright-fixtures"

test("packaged preview runs without CDN or external asset requests", async ({ baseURL, page }) => {
  const externalRequests = collectExternalRequests(page, baseURL ?? "http://127.0.0.1:4173")
  await installApiMocks(page)

  const response = await page.goto("/")

  expect(response?.ok()).toBe(true)
  await expect(page.getByRole("heading", { name: "Repository overview" })).toBeVisible()
  await expect(page.getByText("640 symbols and 915 edges")).toBeVisible()
  expect(externalRequests).toEqual([])
})
