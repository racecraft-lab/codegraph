import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { BotIcon, GitBranchIcon, RadiusIcon } from "lucide-react"

import { useAppState } from "@/app/state"
import { FlowSections } from "@/components/symbol/FlowSections"
import { RelationshipPanels } from "@/components/symbol/RelationshipPanels"
import { RelationshipState } from "@/components/symbol/RelationshipStates"
import { StatePanel } from "@/components/layout/StatePanel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { getFlow, listClusters, listFlows } from "@/lib/api/catalogs"
import { errorState } from "@/lib/api/client"
import { listCallees, listCallers } from "@/lib/api/relationships"
import { getSymbol } from "@/lib/api/symbols"
import type { CatalogListResult, ClusterSummary, CodeNode, FlowSummary, ListResult } from "@/lib/api/types"
import { mark, measure } from "@/lib/perf/marks"

export function SymbolDetailRoute() {
  const { id = "" } = useParams()
  const decodedId = decodeURIComponent(id)
  const { selectedRepo, selectNode } = useAppState()
  const [node, setNode] = React.useState<CodeNode | null>(null)
  const [callers, setCallers] = React.useState<ListResult<CodeNode> | undefined>()
  const [callees, setCallees] = React.useState<ListResult<CodeNode> | undefined>()
  const [flows, setFlows] = React.useState<CatalogListResult<FlowSummary> | undefined>()
  const [clusters, setClusters] = React.useState<CatalogListResult<ClusterSummary> | undefined>()
  const [message, setMessage] = React.useState("Loading symbol context.")
  const [durationMs, setDurationMs] = React.useState<number | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      mark("symbol-request")
      try {
        const [nextNode, nextCallers, nextCallees, nextFlows, nextClusters] = await Promise.all([
          getSymbol(decodedId, selectedRepo?.id),
          listCallers(decodedId, selectedRepo?.id),
          listCallees(decodedId, selectedRepo?.id),
          listFlows(selectedRepo?.id),
          listClusters(selectedRepo?.id),
        ])
        if (cancelled) return
        mark("symbol-render")
        setDurationMs(measure("symbol-response-render", "symbol-request", "symbol-render"))
        setNode(nextNode)
        selectNode(nextNode)
        setCallers(nextCallers)
        setCallees(nextCallees)
        setFlows(nextFlows)
        setClusters(nextClusters)
        setMessage("Symbol context loaded.")
        if (nextFlows.items[0]) {
          void getFlow(nextFlows.items[0].id, selectedRepo?.id).catch(() => undefined)
        }
      } catch (error) {
        if (cancelled) return
        const nextError = errorState(error)
        setMessage(nextError.message)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [decodedId, selectNode, selectedRepo?.id])

  if (!node) {
    return (
      <div className="p-4">
        <StatePanel kind={message === "Loading symbol context." ? "loading" : "error"} title="Symbol detail">
          {message}
        </StatePanel>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{node.name}</CardTitle>
          <CardDescription>
            {node.kind}
            {node.file ? ` in ${node.file}` : ""}
            {durationMs !== null ? ` | rendered in ${Math.round(durationMs)} ms` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" nativeButton={false} render={<Link to={`/graph/${encodeURIComponent(node.id)}`} />}>
              <GitBranchIcon data-icon="inline-start" />
              Open graph
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link to={`/impact/${encodeURIComponent(node.id)}`} />}>
              <RadiusIcon data-icon="inline-start" />
              Review impact
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link to="/chat" />}>
              <BotIcon data-icon="inline-start" />
              Ask with context
            </Button>
          </div>
          <Separator />
          <pre className="max-h-56 overflow-auto rounded-lg bg-muted p-3 text-xs">
            {node.signature ?? node.doc ?? "No signature or source context is available for this symbol."}
          </pre>
        </CardContent>
      </Card>
      <RelationshipState state={flows?.state ?? "available"} />
      <RelationshipPanels callers={callers} callees={callees} />
      <FlowSections flows={flows} clusters={clusters} />
    </div>
  )
}
