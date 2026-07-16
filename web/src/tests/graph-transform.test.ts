import { describe, expect, it } from "vitest"

import { summarizeGraph, toCytoscapeElements } from "@/lib/graph/transform"

const graph = {
  nodes: [
    { id: "a", kind: "function", name: "a" },
    { id: "b", kind: "class", name: "b" },
  ],
  edges: [{ source: "a", target: "b", kind: "calls" }],
  truncated: false,
}

describe("graph transform", () => {
  it("creates renderer elements and accessible summary data", () => {
    expect(toCytoscapeElements(graph)).toHaveLength(3)
    expect(summarizeGraph(graph)).toMatchObject({ nodeCount: 2, edgeCount: 1 })
  })
})
