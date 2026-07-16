import { expect, test } from "@playwright/test"

import { collectExternalRequests, installApiMocks } from "./playwright-fixtures"

test("chat stays behind the same-origin backend boundary", async ({ baseURL, page }) => {
  const externalRequests = collectExternalRequests(page, baseURL ?? "http://127.0.0.1:4173")
  const chatRequests: string[] = []

  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith("/api/chat/")) chatRequests.push(`${request.method()} ${path}`)
  })

  await installApiMocks(page)
  await page.goto("/chat")
  await page.getByLabel("Chat message").fill("How is the web server wired?")
  await page.getByRole("button", { name: "Ask" }).click()

  await expect(page.getByText("startWebServer wires the local API routes")).toBeVisible()
  expect(chatRequests).toContain("GET /api/chat/status")
  expect(chatRequests).toContain("POST /api/chat/messages")
  expect(externalRequests).toEqual([])
})
