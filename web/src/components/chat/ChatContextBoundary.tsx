import { Badge } from "@/components/ui/badge"
import { useAppState } from "@/app/state"

export function ChatContextBoundary({ view }: { view: string }) {
  const { selectedRepo, selectedNode } = useAppState()

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <Badge variant="secondary">{selectedRepo?.name ?? "No repository"}</Badge>
      <Badge variant="outline">{view}</Badge>
      {selectedNode ? <Badge variant="outline">{selectedNode.name}</Badge> : null}
    </div>
  )
}
