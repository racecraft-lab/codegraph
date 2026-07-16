import { defineConfig } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"

const port = Number(process.env.CODEGRAPH_WEB_E2E_PORT ?? 4173)
const baseURL = `http://127.0.0.1:${port}`
const nodePath = process.env.npm_node_execpath ?? process.execPath
const npmCli = process.env.npm_execpath ?? path.resolve(path.dirname(nodePath), "../lib/node_modules/npm/bin/npm-cli.js")
const npmCommand = fs.existsSync(npmCli) ? `${JSON.stringify(nodePath)} ${JSON.stringify(npmCli)}` : "npm"

export default defineConfig({
  testDir: "./src/tests",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `${npmCommand} run build && ${npmCommand} run preview -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
