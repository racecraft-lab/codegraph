import { expect, test } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  DEFERRED_WEB_ASSET_IDS,
  REQUIRED_WEB_ASSETS,
  classifyWebAssetPath,
  validateWebAssetDirectory,
} from "../../../scripts/web-asset-manifest.mjs"

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
)
const TRUSTED_HOST_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ")

test("packages every required local-indexing asset from one fail-closed manifest", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(webRoot, "package.json"), "utf8")
  ) as {
    dependencies: Record<string, string>
  }
  const viteConfig = fs.readFileSync(
    path.join(webRoot, "vite.config.ts"),
    "utf8"
  )
  const rootPackageJson = JSON.parse(
    fs.readFileSync(path.join(webRoot, "../package.json"), "utf8")
  ) as { scripts: Record<string, string>; files: string[] }
  const workerPath = path.join(webRoot, "src/local-indexing/worker.ts")
  const workerSource = fs.existsSync(workerPath)
    ? fs.readFileSync(workerPath, "utf8")
    : ""

  expect(packageJson.dependencies["@sqlite.org/sqlite-wasm"]).toBe(
    "3.53.0-build1"
  )
  expect(viteConfig).toContain('assetsInclude: ["**/*.wasm"]')
  expect(viteConfig).toContain('exclude: ["@sqlite.org/sqlite-wasm"]')
  expect(viteConfig).toContain("WEB_BUILD_ENTRIES")
  expect(viteConfig).toContain("validateWebAssetDirectory")
  expect(rootPackageJson.scripts.build).toContain("copy-web-assets")
  expect(rootPackageJson.scripts["verify-web-assets"]).toBeDefined()
  expect(rootPackageJson.files).toContain("dist")
  expect(workerSource).toContain('from "@sqlite.org/sqlite-wasm"')
  expect(workerSource).not.toMatch(/https?:\/\//)

  const webInventory = validateWebAssetDirectory(path.join(webRoot, "dist"))
  const packageInventory = validateWebAssetDirectory(
    path.join(webRoot, "../dist/web")
  )
  expect(webInventory.map((entry) => entry.id)).toEqual(
    REQUIRED_WEB_ASSETS.map((entry) => entry.id)
  )
  expect(packageInventory.map((entry) => entry.id)).toEqual(
    REQUIRED_WEB_ASSETS.map((entry) => entry.id)
  )
  expect(webInventory.every((entry) => entry.bytes > 0)).toBe(true)
  expect(packageInventory.map(({ id, bytes }) => ({ id, bytes }))).toEqual(
    webInventory.map(({ id, bytes }) => ({ id, bytes }))
  )
})

test("runs packaged local indexing under the trusted-host CSP without cross-origin isolation", async ({
  context,
  page,
}, testInfo) => {
  const quickstart = fs.readFileSync(
    path.join(webRoot, "../specs/007-in-browser-indexing/quickstart.md"),
    "utf8"
  )
  expect(quickstart).toContain(`Content-Security-Policy: ${TRUSTED_HOST_CSP}`)
  expect(quickstart).toMatch(/does not\s+require COOP or COEP/)
  await context.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") {
      await route.continue()
      return
    }
    const response = await route.fetch()
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "content-security-policy": TRUSTED_HOST_CSP,
      },
    })
  })
  await page.addInitScript(() => {
    const sourceFile = (name: string, source: string) => ({
      kind: "file",
      name,
      async getFile() {
        const bytes = new TextEncoder().encode(source)
        return {
          size: bytes.byteLength,
          lastModified: 1,
          async arrayBuffer() {
            return bytes.slice().buffer
          },
        }
      },
    })
    Object.assign(window, {
      showDirectoryPicker: async () => ({
        kind: "directory",
        name: "Trusted host",
        async *entries() {
          yield [
            "trusted.ts",
            sourceFile(
              "trusted.ts",
              "export function trustedHost() { return true }\n"
            ),
          ] as const
          yield [
            "trusted.py",
            sourceFile(
              "trusted.py",
              "def trusted_python():\n    return True\n"
            ),
          ] as const
        },
      }),
    })
  })
  const cspViolations: string[] = []
  page.on("console", (message) => {
    if (/content security policy|violates.*directive/i.test(message.text())) {
      cspViolations.push(message.text())
    }
  })

  const response = await page.goto("/")
  expect(response?.headers()["content-security-policy"]).toBe(TRUSTED_HOST_CSP)
  expect(response?.headers()["cross-origin-opener-policy"]).toBeUndefined()
  expect(response?.headers()["cross-origin-embedder-policy"]).toBeUndefined()
  await page.getByRole("button", { name: "Open local folder" }).click()
  await expect(
    page.getByText("Local keyword index complete.", { exact: true })
  ).toBeVisible({ timeout: 20_000 })
  await page.getByRole("button", { name: "Search symbols" }).first().click()
  await page
    .getByRole("textbox", { name: "Search symbols" })
    .fill("trustedHost")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(
    page.getByRole("cell", { name: "trustedHost", exact: true })
  ).toBeVisible()
  await page
    .getByRole("textbox", { name: "Search symbols" })
    .fill("trusted_python")
  await page.locator("form").getByRole("button", { name: "Search" }).click()
  await expect(
    page.getByRole("cell", { name: "trusted_python", exact: true })
  ).toBeVisible()
  expect(cspViolations).toEqual([])

  await testInfo.attach("spec007-trusted-host-policy.json", {
    body: JSON.stringify(
      {
        contentSecurityPolicy: TRUSTED_HOST_CSP,
        crossOriginIsolationRequired: false,
        violations: cspViolations,
      },
      null,
      2
    ),
    contentType: "application/json",
  })
})

test("rejects every missing or corrupt required asset before packaging", ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium")
  const source = path.join(webRoot, "dist")
  const validInventory = validateWebAssetDirectory(source)
  expect(validInventory).toHaveLength(REQUIRED_WEB_ASSETS.length)

  for (const asset of validInventory) {
    const missingRoot = testInfo.outputPath(`missing-${asset.id}`)
    fs.cpSync(source, missingRoot, { recursive: true })
    fs.rmSync(path.join(missingRoot, asset.relativePath))
    expect(
      () => validateWebAssetDirectory(missingRoot),
      `${asset.id} missing`
    ).toThrow(new RegExp(asset.id))

    const corruptRoot = testInfo.outputPath(`corrupt-${asset.id}`)
    fs.cpSync(source, corruptRoot, { recursive: true })
    fs.writeFileSync(path.join(corruptRoot, asset.relativePath), "corrupt")
    expect(
      () => validateWebAssetDirectory(corruptRoot),
      `${asset.id} corrupt`
    ).toThrow(new RegExp(asset.id))
  }
})

test("defers database and parser assets until local indexing and language demand", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    localStorage.clear()
    const source = "export function packagedDemand() { return 1 }\n"
    const file = {
      kind: "file",
      name: "demand.ts",
      async getFile() {
        const bytes = new TextEncoder().encode(source)
        return {
          size: bytes.byteLength,
          lastModified: 1,
          async arrayBuffer() {
            return bytes.slice().buffer
          },
        }
      },
    }
    Object.assign(window, {
      showDirectoryPicker: async () => ({
        kind: "directory",
        name: "Packaged demand",
        async *entries() {
          yield ["demand.ts", file] as const
        },
      }),
    })
  })

  const requests: Array<{
    id: string
    path: string
    phase: "initial-route" | "local-index"
    sameOrigin: boolean
  }> = []
  let phase: "initial-route" | "local-index" = "initial-route"
  page.on("request", (request) => {
    const url = new URL(request.url())
    const id = classifyWebAssetPath(url.pathname)
    if (!id) return
    requests.push({
      id,
      path: url.pathname,
      phase,
      sameOrigin:
        url.origin === new URL(page.url() || "http://127.0.0.1").origin,
    })
  })

  await page.goto("/")
  await expect(
    page.getByRole("button", { name: "Open local folder" })
  ).toBeVisible()
  await page.waitForTimeout(250)
  expect(
    requests.filter(
      (request) =>
        request.phase === "initial-route" &&
        DEFERRED_WEB_ASSET_IDS.includes(request.id)
    )
  ).toEqual([])

  phase = "local-index"
  await page.getByRole("button", { name: "Open local folder" }).click()
  await expect(
    page.getByText("Local keyword index complete.", { exact: true })
  ).toBeVisible({ timeout: 20_000 })

  const deferredRequests = requests.filter((request) =>
    DEFERRED_WEB_ASSET_IDS.includes(request.id)
  )
  expect(deferredRequests.length).toBeGreaterThan(0)
  expect(
    deferredRequests.every((request) => request.phase === "local-index")
  ).toBe(true)
  expect(deferredRequests.every((request) => request.sameOrigin)).toBe(true)
  expect(deferredRequests.map((request) => request.id)).toEqual(
    expect.arrayContaining([
      "sqlite-wasm",
      "tree-sitter-runtime",
      "grammar-typescript",
    ])
  )
  expect(
    deferredRequests.some((request) => request.id === "grammar-javascript")
  ).toBe(false)
  expect(deferredRequests.some((request) => request.id === "grammar-tsx")).toBe(
    false
  )

  await testInfo.attach("spec007-packaged-request-order.json", {
    body: JSON.stringify(
      {
        deferredAssetIds: DEFERRED_WEB_ASSET_IDS,
        requests,
      },
      null,
      2
    ),
    contentType: "application/json",
  })
})
