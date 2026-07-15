import { expect, test } from "@playwright/test"
import axeCore from "axe-core"

import { installApiMocks } from "./playwright-fixtures"

const { source: axeSource } = axeCore

interface AxeViolation {
  id: string
  impact: string | null
  nodes: Array<{ target: string[] }>
}

test("core graph browser views satisfy automated WCAG checks", async ({ page }) => {
  await installApiMocks(page)
  await page.goto("/graph/node-a")
  await expect(page.getByRole("img", { name: "Graph neighborhood canvas" })).toBeVisible()
  await page.addScriptTag({ content: axeSource })

  const result = await page.evaluate(async () => {
    const axe = (window as unknown as Window & {
      axe: {
        run: (context: Document, options: unknown) => Promise<{ violations: AxeViolation[] }>
      }
    }).axe
    return axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa"],
      },
    })
  })

  expect(result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }))).toEqual([])
})
