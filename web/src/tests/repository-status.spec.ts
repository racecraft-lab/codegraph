import { expect, test } from "@playwright/test"

import { installApiMocks } from "./playwright-fixtures"

const statusCases = [
  { scenario: "ready", label: "Ready", message: "640 symbols across 128 files." },
  { scenario: "stale", label: "Stale", message: "640 symbols across 128 files." },
  { scenario: "indexing", label: "Indexing", message: "640 symbols across 128 files." },
  { scenario: "empty", label: "No index", message: "0 symbols across 0 files." },
  { scenario: "unauthorized", label: "Token required", message: "Token required." },
  { scenario: "unavailable", label: "Unavailable", message: "The local CodeGraph server is unreachable." },
  { scenario: "missing", label: "No repository", message: "No repository is selected." },
] as const

test.describe("repository status UAT", () => {
  for (const statusCase of statusCases) {
    test(`shows ${statusCase.scenario} repository state`, async ({ page }) => {
      await installApiMocks(page, { status: statusCase.scenario })

      await page.goto("/")

      await expect(page.getByRole("heading", { name: "Repository overview" })).toBeVisible()
      await expect(page.getByText(statusCase.label).first()).toBeVisible()
      await expect(page.getByText(statusCase.message).first()).toBeVisible()
    })
  }
})
