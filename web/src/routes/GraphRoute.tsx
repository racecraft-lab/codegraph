import * as React from "react"
import type { Core } from "cytoscape"
import { useNavigate, useParams } from "react-router-dom"

import { useAppState } from "@/app/state"
import { GraphCanvas } from "@/components/graph/GraphCanvas"
import { GraphState } from "@/components/graph/GraphState"
import { GraphSummary } from "@/components/graph/GraphSummary"
import { GraphToolbar } from "@/components/graph/GraphToolbar"
import { StatePanel } from "@/components/layout/StatePanel"
import { errorState } from "@/lib/api/client"
import { getGraph } from "@/lib/api/graph"
import type { GraphResult } from "@/lib/api/types"
import { summarizeGraph } from "@/lib/graph/transform"

export function GraphRoute() {
  const { id = "" } = useParams()
  const nodeId = id
  const navigate = useNavigate()
  const { selectedRepo, selectNode, clearNode } = useAppState()
  const [depth, setDepth] = React.useState(1)
  const [filter, setFilter] = React.useState("")
  const [graph, setGraph] = React.useState<GraphResult | null>(null)
  const [error, setError] = React.useState<string | undefined>()
  const rendererRef = React.useRef<Core | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setGraph(null)
    setError(undefined)
    clearNode()
    async function load() {
      try {
        const next = await getGraph(nodeId, selectedRepo?.id, depth)
        if (!cancelled) {
          setGraph(next)
          setError(undefined)
          const routeNode = next.nodes.find((node) => node.id === nodeId)
          if (routeNode) {
            selectNode(routeNode)
          } else {
            clearNode()
          }
        }
      } catch (caught) {
        if (!cancelled) {
          setGraph(null)
          setError(errorState(caught).message)
          clearNode()
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [clearNode, depth, nodeId, selectNode, selectedRepo?.id])

  const filteredGraph = React.useMemo(() => {
    if (!graph || !filter.trim()) return graph
    const query = filter.trim().toLowerCase()
    const nodes = graph.nodes.filter((node) =>
      [node.name, node.kind, node.file ?? ""].some((value) => value.toLowerCase().includes(query)),
    )
    const nodeIds = new Set(nodes.map((node) => node.id))
    return {
      ...graph,
      nodes,
      edges: graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    }
  }, [filter, graph])

  const focusNode = React.useCallback((nextNodeId: string) => {
    const target = graph?.nodes.find((node) => node.id === nextNodeId)
    if (target) selectNode(target)
    navigate(`/graph/${encodeURIComponent(nextNodeId)}`)
  }, [graph, navigate, selectNode])

  if (!graph || !filteredGraph) {
    return (
      <div className="p-4">
        <StatePanel kind={error ? "error" : "loading"} title="Graph neighborhood">
          {error ?? "Loading graph neighborhood."}
        </StatePanel>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      <GraphToolbar
        depth={depth}
        filter={filter}
        onDepthChange={setDepth}
        onFilterChange={setFilter}
        onFit={() => rendererRef.current?.fit(undefined, 24)}
        onZoomIn={() => rendererRef.current?.zoom(rendererRef.current.zoom() * 1.2)}
        onZoomOut={() => rendererRef.current?.zoom(rendererRef.current.zoom() / 1.2)}
        onReset={() => rendererRef.current?.layout({ name: "breadthfirst", directed: true, padding: 24 }).run()}
      />
      <div className="grid min-h-0 flex-1 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <GraphState truncated={filteredGraph.truncated} error={error} />
          <GraphCanvas ref={rendererRef} graph={filteredGraph} onSelectNode={focusNode} />
        </div>
        <GraphSummary summary={summarizeGraph(filteredGraph)} nodes={filteredGraph.nodes} edges={filteredGraph.edges} onFocusNode={focusNode} />
      </div>
    </div>
  )
}
