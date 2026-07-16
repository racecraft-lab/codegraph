import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { GraphSummary as Summary } from "@/lib/graph/transform"
import type { CodeEdge, CodeNode } from "@/lib/api/types"

export function GraphSummary({
  summary,
  nodes,
  edges,
  onFocusNode,
}: {
  summary: Summary
  nodes: CodeNode[]
  edges: CodeEdge[]
  onFocusNode: (nodeId: string) => void
}) {
  const nodeNames = new Map(nodes.map((node) => [node.id, node.name]))

  return (
    <aside className="flex flex-col gap-3 border-l p-4">
      <h2 className="text-sm font-semibold">Graph summary</h2>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Nodes</dt>
          <dd className="font-medium">{summary.nodeCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Edges</dt>
          <dd className="font-medium">{summary.edgeCount.toLocaleString()}</dd>
        </div>
      </dl>
      {summary.truncated ? <Badge variant="secondary">Truncated</Badge> : null}
      <div className="flex flex-wrap gap-2">
        {summary.kinds.map((kind) => (
          <Badge key={kind.kind} variant="outline">
            {kind.kind}: {kind.count}
          </Badge>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Nodes</h3>
        <div className="flex max-h-72 flex-col gap-2 overflow-auto">
          {nodes.map((node) => (
            <div key={node.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{node.name}</div>
                <div className="truncate text-xs text-muted-foreground">{node.kind}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="outline" size="sm" onClick={() => onFocusNode(node.id)}>
                  Focus
                </Button>
                <Button variant="ghost" size="sm" nativeButton={false} render={<Link to={`/symbol/${encodeURIComponent(node.id)}`} />}>
                  Symbol
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Edges</h3>
        <div className="flex max-h-72 flex-col gap-2 overflow-auto">
          {edges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No graph edges returned.</p>
          ) : edges.map((edge, index) => (
            <div key={`${edge.source}->${edge.target}:${edge.kind}:${index}`} className="flex flex-col gap-2 rounded-md border p-2">
              <div className="min-w-0 text-sm">
                <span className="font-medium">{nodeNames.get(edge.source) ?? edge.source}</span>
                <span className="text-muted-foreground"> {edge.kind} </span>
                <span className="font-medium">{nodeNames.get(edge.target) ?? edge.target}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button variant="outline" size="sm" onClick={() => onFocusNode(edge.source)}>
                  Focus source
                </Button>
                <Button variant="outline" size="sm" onClick={() => onFocusNode(edge.target)}>
                  Focus target
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
