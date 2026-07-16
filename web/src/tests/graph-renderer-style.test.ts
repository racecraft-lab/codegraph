import cytoscape from "cytoscape"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("cytoscape", () => ({
  default: vi.fn(() => ({ destroy: vi.fn(), on: vi.fn() })),
}))

import { createGraphRenderer, resolveGraphRendererColors } from "@/lib/graph/cytoscape"

afterEach(() => {
  vi.mocked(cytoscape).mockClear()
})

describe("graph renderer styles", () => {
  it("resolves graph colors from the active theme variables", () => {
    const container = document.createElement("div")
    container.style.setProperty("--primary", "rgb(240, 240, 240)")
    container.style.setProperty("--foreground", "rgb(250, 250, 250)")
    container.style.setProperty("--ring", "rgb(140, 140, 140)")
    container.style.setProperty("--destructive", "rgb(240, 90, 90)")

    expect(resolveGraphRendererColors(container)).toEqual({
      node: "rgb(240, 240, 240)",
      label: "rgb(250, 250, 250)",
      edge: "rgb(140, 140, 140)",
      selected: "rgb(240, 90, 90)",
    })
  })

  it("passes theme-derived colors into Cytoscape styles", () => {
    const container = document.createElement("div")
    container.style.setProperty("--primary", "rgb(240, 240, 240)")
    container.style.setProperty("--foreground", "rgb(250, 250, 250)")
    container.style.setProperty("--ring", "rgb(140, 140, 140)")
    container.style.setProperty("--destructive", "rgb(240, 90, 90)")

    createGraphRenderer(container, [])

    const config = vi.mocked(cytoscape).mock.calls[0]?.[0]
    expect(config?.style).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selector: "node",
        style: expect.objectContaining({
          "background-color": "rgb(240, 240, 240)",
          color: "rgb(250, 250, 250)",
        }),
      }),
      expect.objectContaining({
        selector: "edge",
        style: expect.objectContaining({
          "line-color": "rgb(140, 140, 140)",
          "target-arrow-color": "rgb(140, 140, 140)",
        }),
      }),
      expect.objectContaining({
        selector: ":selected",
        style: expect.objectContaining({
          "background-color": "rgb(240, 90, 90)",
        }),
      }),
    ]))
  })
})
