import { expect, test } from "@playwright/test"

test("reports live local-indexing capabilities without false parity claims", async ({
  page,
  browserName,
}) => {
  if (browserName === "chromium") {
    await page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: () => Promise.reject(new DOMException("Cancelled", "AbortError")),
      })
    })
  }
  await page.goto("/")

  const live = await page.evaluate(() => {
    const itemPrototype = globalThis.DataTransferItem?.prototype as
      | {
          getAsFileSystemHandle?: unknown
          webkitGetAsEntry?: unknown
        }
      | undefined
    return {
      secureContext: window.isSecureContext,
      folderPicker: typeof window.showDirectoryPicker === "function",
      directoryDrop:
        typeof itemPrototype?.getAsFileSystemHandle === "function" ||
        typeof itemPrototype?.webkitGetAsEntry === "function",
      opfs:
        typeof navigator.storage?.getDirectory === "function",
      webLocks: typeof navigator.locks?.request === "function",
      wasm: typeof WebAssembly?.compile === "function",
    }
  })

  const report = page.getByTestId("local-capability-report")
  await expect(report).toBeVisible()
  await report.locator("summary").click()
  await expect(page.getByTestId("capability-secure-context")).toHaveText(
    live.secureContext ? "available" : "missing",
  )
  await expect(page.getByTestId("capability-folder-picker")).toHaveText(
    live.folderPicker ? "available" : /missing|blocked-by-policy/,
  )
  await expect(page.getByTestId("capability-opfs")).toHaveText(
    live.opfs ? /available|quota-risk/ : "missing",
  )
  await expect(page.getByTestId("capability-web-locks")).toHaveText(
    live.webLocks ? "available" : "missing",
  )
  await expect(page.getByTestId("capability-wasm")).toHaveText(
    live.wasm ? /available|blocked-by-csp/ : "missing",
  )

  const tier = await page.getByTestId("capability-tier").textContent()
  if (browserName === "chromium") {
    expect(tier).toBe("full")
    await expect(page.getByRole("button", { name: "Open local folder" })).toBeEnabled()
  } else if (!live.folderPicker) {
    expect(tier).not.toBe("full")
    await expect(page.getByText(/Folder selection and reconnect are unavailable|Browser-local indexing is unavailable/)).toBeVisible()
    await expect(page.getByRole("button", { name: "Open local folder" })).toBeDisabled()
  }

  const snapshotImport = page.getByTestId("snapshot-import")
  if (tier === "full" || tier === "snapshot-only") {
    await expect(snapshotImport).toBeVisible()
  } else {
    await expect(snapshotImport).toHaveCount(0)
  }
  if (!live.directoryDrop) {
    await expect(page.getByText(/Directory snapshot import is unavailable|Directory drop exposes files/)).toBeVisible()
  }

  await expect(page.getByText(/^Reconnect$/)).toHaveCount(0)
  await expect(page.getByText(/^Refresh snapshot$/)).toHaveCount(0)

  await page.setViewportSize({ width: 320, height: 800 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})
