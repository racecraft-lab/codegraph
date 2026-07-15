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
  const decodedId = decodeURIComponent(id)
  const navigate = useNavigate()
  const { selectedRepo } = useAppState()
  const [depth, setDepth] = React.useState(1)
  const [graph, setGraph] = React.useState<GraphResult | null>(null)
  const [error, setError] = React.useState<string | undefined>()
  const rendererRef = React.useRef<Core | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const next = await getGraph(decodedId, selectedRepo?.id, depth)
        if (!cancelled) {
          setGraph(next)
          setError(undefined)
        }
      } catch (caught) {
        if (!cancelled) {
          setGraph(null)
          setError(errorState(caught).message)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [decodedId, depth, selectedRepo?.id])

  if (!graph) {
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
        onDepthChange={setDepth}
        onFit={() => rendererRef.current?.fit(undefined, 24)}
        onZoomIn={() => rendererRef.current?.zoom(rendererRef.current.zoom() * 1.2)}
        onZoomOut={() => rendererRef.current?.zoom(rendererRef.current.zoom() / 1.2)}
        onReset={() => rendererRef.current?.layout({ name: "breadthfirst", directed: true, padding: 24 }).run()}
      />
      <div className="grid min-h-0 flex-1 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <GraphState truncated={graph.truncated} error={error} />
          <GraphCanvas ref={rendererRef} graph={graph} onSelectNode={(nodeId) => navigate(`/symbol/${encodeURIComponent(nodeId)}`)} />
        </div>
        <GraphSummary summary={summarizeGraph(graph)} />
      </div>
    </div>
  )
}
