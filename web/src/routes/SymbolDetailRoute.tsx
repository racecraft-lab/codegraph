import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { BotIcon, GitBranchIcon, RadiusIcon } from "lucide-react"

import { useAppState } from "@/app/state"
import { FlowSections, type CatalogPanelState } from "@/components/symbol/FlowSections"
import { RelationshipPanels, type RelationshipPanelState } from "@/components/symbol/RelationshipPanels"
import { RelationshipState } from "@/components/symbol/RelationshipStates"
import { StatePanel } from "@/components/layout/StatePanel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { listClusters, listFlows } from "@/lib/api/catalogs"
import { errorState } from "@/lib/api/client"
import { listCallees, listCallers } from "@/lib/api/relationships"
import { getSymbol } from "@/lib/api/symbols"
import type { ClusterSummary, CodeNode, FlowSummary } from "@/lib/api/types"
import { mark, measure } from "@/lib/perf/marks"

const loadingRelationships: RelationshipPanelState = { status: "loading" }
const loadingCatalog: CatalogPanelState<FlowSummary> = { status: "loading" }
const loadingClusters: CatalogPanelState<ClusterSummary> = { status: "loading" }

export function SymbolDetailRoute() {
  const { id = "" } = useParams()
  const nodeId = id
  const { selectedRepo, selectNode, clearNode } = useAppState()
  const [node, setNode] = React.useState<CodeNode | null>(null)
  const [callers, setCallers] = React.useState<RelationshipPanelState>(loadingRelationships)
  const [callees, setCallees] = React.useState<RelationshipPanelState>(loadingRelationships)
  const [flows, setFlows] = React.useState<CatalogPanelState<FlowSummary>>(loadingCatalog)
  const [clusters, setClusters] = React.useState<CatalogPanelState<ClusterSummary>>(loadingClusters)
  const [message, setMessage] = React.useState("Loading symbol context.")
  const [partialError, setPartialError] = React.useState<string | undefined>()
  const [durationMs, setDurationMs] = React.useState<number | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setNode(null)
    setCallers(loadingRelationships)
    setCallees(loadingRelationships)
    setFlows(loadingCatalog)
    setClusters(loadingClusters)
    setDurationMs(null)
    setPartialError(undefined)
    setMessage("Loading symbol context.")
    clearNode()
    async function load() {
      mark("symbol-request")
      try {
        const nextNode = await getSymbol(nodeId, selectedRepo?.id)
        if (cancelled) return
        mark("symbol-render")
        setDurationMs(measure("symbol-response-render", "symbol-request", "symbol-render"))
        setNode(nextNode)
        selectNode(nextNode)
        setMessage("Symbol context loaded.")
        const [nextCallers, nextCallees, nextFlows, nextClusters] = await Promise.allSettled([
          listCallers(nodeId, selectedRepo?.id),
          listCallees(nodeId, selectedRepo?.id),
          listFlows(selectedRepo?.id),
          listClusters(selectedRepo?.id),
        ])
        if (cancelled) return
        const partial = [nextCallers, nextCallees, nextFlows, nextClusters].some((result) => result.status === "rejected")
        setCallers(nextCallers.status === "fulfilled" ? { status: "success", result: nextCallers.value } : { status: "error", message: errorState(nextCallers.reason).message })
        setCallees(nextCallees.status === "fulfilled" ? { status: "success", result: nextCallees.value } : { status: "error", message: errorState(nextCallees.reason).message })
        setFlows(nextFlows.status === "fulfilled" ? { status: "success", result: nextFlows.value } : { status: "error", message: errorState(nextFlows.reason).message })
        setClusters(nextClusters.status === "fulfilled" ? { status: "success", result: nextClusters.value } : { status: "error", message: errorState(nextClusters.reason).message })
        if (partial) {
          setMessage("Symbol loaded with partial relationship context.")
          setPartialError("Some relationship or catalog context could not be loaded.")
        }
      } catch (error) {
        if (cancelled) return
        const nextError = errorState(error)
        setNode(null)
        setCallers(loadingRelationships)
        setCallees(loadingRelationships)
        setFlows(loadingCatalog)
        setClusters(loadingClusters)
        setDurationMs(null)
        setPartialError(undefined)
        setMessage(nextError.message)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [clearNode, nodeId, selectNode, selectedRepo?.id])

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
      {partialError ? (
        <StatePanel kind="degraded" title="Partial relationship context">
          {partialError}
        </StatePanel>
      ) : null}
      <RelationshipState state={flows.status === "success" ? flows.result.state : "available"} />
      <RelationshipPanels callers={callers} callees={callees} />
      <FlowSections flows={flows} clusters={clusters} />
    </div>
  )
}
