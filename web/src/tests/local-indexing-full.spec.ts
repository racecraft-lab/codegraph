import { expect, test } from "@playwright/test"

const mainSource = [
  "export function normalizeName(value: string): string {",
  "  return value.trim().toLowerCase();",
  "}",
  "",
  "export function greet(name: string): string {",
  "  return `Hello ${normalizeName(name)}`;",
  "}",
  "",
].join("\n")

test("indexes, browses, and reloads a picked folder entirely in Chromium", async ({
  page,
}) => {
  await page.addInitScript(({ source }) => {
    const bytes = new TextEncoder().encode(source)
    const file = {
      kind: "file",
      name: "main.ts",
      async getFile() {
        return {
          size: bytes.byteLength,
          lastModified: 1,
          async arrayBuffer() {
            return bytes.slice().buffer
          },
        }
      },
    }
    const sourceDirectory = {
      kind: "directory",
      name: "src",
      async *entries() {
        yield ["main.ts", file] as const
      },
    }
    const root = {
      kind: "directory",
      name: "Browser fixture",
      async *entries() {
        yield ["src", sourceDirectory] as const
      },
    }
    Object.assign(window, {
      spec007PickerCalls: 0,
      showDirectoryPicker: async () => {
        ;(window as typeof window & { spec007PickerCalls: number })
          .spec007PickerCalls += 1
        return root
      },
    })
  }, { source: mainSource })

  const forbiddenRequests: string[] = []
  let auditLocalRuntime = false
  page.on("request", (request) => {
    if (!auditLocalRuntime) return
    const url = request.url()
    if (
      url.includes("/api/") ||
      url.includes("/lsp") ||
      request.resourceType() === "websocket" ||
      !url.startsWith("http://127.0.0.1:")
    ) {
      forbiddenRequests.push(url)
    }
  })

  await page.goto("/")
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { spec007PickerCalls: number })
          .spec007PickerCalls,
    ),
  ).toBe(0)

  const startedAt = Date.now()
  auditLocalRuntime = true
  await page.getByRole("button", { name: "Open local folder" }).click()
  await page.getByRole("button", { name: "Cancel local indexing" }).click()
  await expect(
    page.getByRole("status").filter({
      hasText: "Cancelled. Local indexing was cancelled.",
    }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Open local folder" }).click()
  await expect(
    page.getByText("Local keyword index complete.", { exact: true }),
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByText("3 symbols and 2 edges", { exact: true }),
  ).toBeVisible()
  expect(Date.now() - startedAt).toBeLessThan(60_000)
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { spec007PickerCalls: number })
          .spec007PickerCalls,
    ),
  ).toBe(2)
  await page.getByRole("button", { name: "Search symbols" }).first().click()
  await page.getByRole("textbox", { name: "Search symbols" }).fill("greet")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(page.getByText("greet", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Open", exact: true }).click()
  await page.getByRole("button", { name: "Open source" }).click()
  await expect(
    page.getByLabel("Cached source for src/main.ts"),
  ).toContainText("normalizeName")

  const firstCounts = await page.locator("body").innerText()
  expect(firstCounts).toContain("greet")
  expect(firstCounts).toContain("normalizeName")
  expect(forbiddenRequests).toEqual([])

  auditLocalRuntime = false
  await page.reload()
  auditLocalRuntime = true
  await expect(page.getByText("Browser fixture", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Local folder", { exact: true }).first()).toBeVisible()
  await expect(
    page.getByText("3 symbols across 1 files.", { exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { spec007PickerCalls: number })
          .spec007PickerCalls,
    ),
  ).toBe(0)

  await page.getByRole("button", { name: "Search symbols" }).first().click()
  await page.getByRole("textbox", { name: "Search symbols" }).fill("normalizeName")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(page.getByText("normalizeName", { exact: true })).toBeVisible()
  expect(forbiddenRequests).toEqual([])
})
