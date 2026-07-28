import { expect, test } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function listFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name)
    return entry.isDirectory() ? listFiles(file) : [file]
  })
}

test("packages the pinned SQLite worker and WASM as same-origin production assets", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(webRoot, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  const viteConfig = fs.readFileSync(path.join(webRoot, "vite.config.ts"), "utf8")
  const workerPath = path.join(webRoot, "src/local-indexing/worker.ts")
  const workerSource = fs.existsSync(workerPath) ? fs.readFileSync(workerPath, "utf8") : ""
  const productionFiles = listFiles(path.join(webRoot, "dist"))

  expect(packageJson.dependencies["@sqlite.org/sqlite-wasm"]).toBe("3.53.0-build1")
  expect(viteConfig).toContain('assetsInclude: ["**/*.wasm"]')
  expect(viteConfig).toContain('exclude: ["@sqlite.org/sqlite-wasm"]')
  expect(viteConfig).toContain('"local-indexing-worker"')
  expect(workerSource).toContain('from "@sqlite.org/sqlite-wasm"')
  expect(workerSource).not.toMatch(/https?:\/\//)

  const worker = productionFiles.find((file) => /local-indexing-worker[^/]*\.js$/.test(file))
  const sqliteWasm = productionFiles.find((file) => /sqlite3[^/]*\.wasm$/.test(file))

  expect(worker, "production local-indexing worker asset").toBeDefined()
  expect(sqliteWasm, "production SQLite WASM asset").toBeDefined()
  expect(fs.statSync(worker!).size).toBeGreaterThan(0)
  expect(fs.statSync(sqliteWasm!).size).toBeGreaterThan(0)
})
