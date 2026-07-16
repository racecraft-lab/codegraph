import { render, screen } from "@testing-library/react"
import { BrowserRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { GraphResult } from "@/lib/api/types"
import { renderApp } from "@/tests/test-utils"

const renderer = vi.hoisted(() => ({
  on: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock("@/lib/graph/cytoscape", () => ({
  createGraphRenderer: vi.fn(() => renderer),
}))

import { GraphCanvas } from "@/components/graph/GraphCanvas"
import { GraphSummary } from "@/components/graph/GraphSummary"
import { createGraphRenderer } from "@/lib/graph/cytoscape"
import { summarizeGraph } from "@/lib/graph/transform"

const graph: GraphResult = {
  nodes: [
    { id: "a", kind: "function", name: "a" },
    { id: "b", kind: "class", name: "b" },
  ],
  edges: [{ source: "a", target: "b", kind: "calls" }],
  truncated: false,
}

const repo = { id: "repo-1", root: "/repo", name: "repo", default: true }
const routeRoot = { id: "root", kind: "function", name: "routeRoot", file: "src/root.ts" }
const relatedNode = { id: "related", kind: "class", name: "relatedNode", file: "src/related.ts" }

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

function mockRouteFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const url = String(input)
      if (url === "/api/repos") return json([repo])
      if (url.startsWith("/api/status")) {
        return json({ version: "1.4.1", repo, index: { state: "ready", fileCount: 2, nodeCount: 2, edgeCount: 1 } })
      }
      if (url.startsWith("/api/graph/root")) {
        return json({ nodes: [relatedNode, routeRoot], edges: [{ source: "root", target: "related", kind: "calls" }], truncated: false })
      }
      if (url.startsWith("/api/impact/root")) {
        return json({ nodes: [relatedNode, routeRoot], edges: [{ source: "root", target: "related", kind: "calls" }], truncated: false })
      }
      return json({ error: { code: "not_found", message: "Not found." } }, 404)
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(createGraphRenderer).mockClear()
  renderer.on.mockClear()
  renderer.destroy.mockClear()
  window.history.pushState({}, "", "/")
})

describe("GraphCanvas", () => {
  it("initializes the renderer and exposes an accessible canvas region", () => {
    render(<GraphCanvas graph={graph} />)

    expect(screen.getByRole("img", { name: /graph neighborhood canvas/i })).toBeInTheDocument()
    expect(createGraphRenderer).toHaveBeenCalledWith(expect.any(HTMLDivElement), expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ id: "a" }) }),
    ]))
    expect(renderer.on).toHaveBeenCalledWith("tap", "node", expect.any(Function))
  })

  it("selects the graph route root when opened from a direct URL", async () => {
    window.history.pushState({}, "", "/graph/root")
    mockRouteFetch()

    renderApp()

    expect(await screen.findByText("function in src/root.ts")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /graph neighborhood canvas/i })).toBeInTheDocument()
  })

  it("selects the impact route root when opened from a direct URL", async () => {
    window.history.pushState({}, "", "/impact/root")
    mockRouteFetch()

    renderApp()

    expect(await screen.findByText("function in src/root.ts")).toBeInTheDocument()
    expect(screen.getByText("2 affected symbols and 1 graph edges.")).toBeInTheDocument()
  })

  it("mirrors every graph node and edge for keyboard access", () => {
    const largeGraph: GraphResult = {
      nodes: Array.from({ length: 26 }, (_, index) => ({ id: `n-${index}`, kind: "function", name: `node${index}` })),
      edges: [{ source: "n-0", target: "n-25", kind: "calls" }],
      truncated: false,
    }

    render(
      <BrowserRouter>
        <GraphSummary summary={summarizeGraph(largeGraph)} nodes={largeGraph.nodes} edges={largeGraph.edges} onFocusNode={vi.fn()} />
      </BrowserRouter>,
    )

    expect(screen.getAllByText("node25").length).toBeGreaterThan(0)
    expect(screen.getAllByText("node0").length).toBeGreaterThan(0)
    expect(screen.getByText("calls")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Focus source" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Focus target" })).toBeInTheDocument()
  })
})
