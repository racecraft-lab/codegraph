import { Badge } from "@/components/ui/badge"
import type { GraphSummary as Summary } from "@/lib/graph/transform"

export function GraphSummary({ summary }: { summary: Summary }) {
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
    </aside>
  )
}
