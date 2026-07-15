import type { CodeEdge, CodeNode, GraphResult } from "@/lib/api/types"

export interface GraphSummary {
  nodeCount: number
  edgeCount: number
  truncated: boolean
  kinds: Array<{ kind: string; count: number }>
}

export function summarizeGraph(graph: GraphResult): GraphSummary {
  const counts = new Map<string, number>()
  for (const node of graph.nodes) {
    counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1)
  }
  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    truncated: graph.truncated,
    kinds: [...counts.entries()].map(([kind, count]) => ({ kind, count })),
  }
}

export function toCytoscapeElements(graph: GraphResult) {
  return [
    ...graph.nodes.map((node: CodeNode) => ({
      data: { id: node.id, label: node.name, kind: node.kind },
    })),
    ...graph.edges.map((edge: CodeEdge, index) => ({
      data: {
        id: `${edge.source}->${edge.target}:${edge.kind}:${index}`,
        source: edge.source,
        target: edge.target,
        label: edge.kind,
      },
    })),
  ]
}
