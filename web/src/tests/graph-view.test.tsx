import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { GraphResult } from "@/lib/api/types"

const renderer = vi.hoisted(() => ({
  on: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock("@/lib/graph/cytoscape", () => ({
  createGraphRenderer: vi.fn(() => renderer),
}))

import { GraphCanvas } from "@/components/graph/GraphCanvas"
import { createGraphRenderer } from "@/lib/graph/cytoscape"

const graph: GraphResult = {
  nodes: [
    { id: "a", kind: "function", name: "a" },
    { id: "b", kind: "class", name: "b" },
  ],
  edges: [{ source: "a", target: "b", kind: "calls" }],
  truncated: false,
}

describe("GraphCanvas", () => {
  it("initializes the renderer and exposes an accessible canvas region", () => {
    render(<GraphCanvas graph={graph} />)

    expect(screen.getByRole("img", { name: /graph neighborhood canvas/i })).toBeInTheDocument()
    expect(createGraphRenderer).toHaveBeenCalledWith(expect.any(HTMLDivElement), expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ id: "a" }) }),
    ]))
    expect(renderer.on).toHaveBeenCalledWith("tap", "node", expect.any(Function))
  })
})
