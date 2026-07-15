import { Link } from "react-router-dom"
import { FileCodeIcon, GitBranchIcon, RadiusIcon, XIcon } from "lucide-react"

import { useAppState } from "@/app/state"
import { Button } from "@/components/ui/button"

export function SelectedContextBar() {
  const { selectedNode, clearNode } = useAppState()

  if (!selectedNode) {
    return (
      <div className="flex min-h-12 items-center border-b px-4 text-sm text-muted-foreground">
        Select a symbol from search to unlock graph, impact, and chat context.
      </div>
    )
  }

  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b px-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{selectedNode.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {selectedNode.kind}
          {selectedNode.file ? ` in ${selectedNode.file}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to={`/symbol/${encodeURIComponent(selectedNode.id)}`} />}>
          <FileCodeIcon data-icon="inline-start" />
          Symbol
        </Button>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to={`/graph/${encodeURIComponent(selectedNode.id)}`} />}>
          <GitBranchIcon data-icon="inline-start" />
          Graph
        </Button>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to={`/impact/${encodeURIComponent(selectedNode.id)}`} />}>
          <RadiusIcon data-icon="inline-start" />
          Impact
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Clear selected symbol" onClick={clearNode}>
          <XIcon />
        </Button>
      </div>
    </div>
  )
}
