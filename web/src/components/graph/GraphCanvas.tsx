import * as React from "react"
import type { Core } from "cytoscape"

import { createGraphRenderer } from "@/lib/graph/cytoscape"
import { toCytoscapeElements } from "@/lib/graph/transform"
import type { GraphResult } from "@/lib/api/types"

export const GraphCanvas = React.forwardRef<
  Core | null,
  {
    graph: GraphResult
    onSelectNode?: (id: string) => void
  }
>(function GraphCanvas({ graph, onSelectNode }, forwardedRef) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!containerRef.current) return undefined
    const renderer = createGraphRenderer(containerRef.current, toCytoscapeElements(graph))
    renderer.on("tap", "node", (event) => onSelectNode?.(event.target.id()))

    if (typeof forwardedRef === "function") {
      forwardedRef(renderer)
    } else if (forwardedRef) {
      forwardedRef.current = renderer
    }

    return () => {
      renderer.destroy()
      if (typeof forwardedRef !== "function" && forwardedRef) {
        forwardedRef.current = null
      }
    }
  }, [forwardedRef, graph, onSelectNode])

  return (
    <div className="min-h-[520px] flex-1 overflow-hidden rounded-lg border bg-card">
      <div ref={containerRef} className="size-full min-h-[520px]" role="img" aria-label="Graph neighborhood canvas" />
    </div>
  )
})
