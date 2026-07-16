import { StatePanel } from "@/components/layout/StatePanel"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CatalogListResult, ClusterSummary, FlowSummary } from "@/lib/api/types"

export type CatalogPanelState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; result: CatalogListResult<T> }

function isEmptyCatalogState(state: CatalogListResult<unknown>["state"]) {
  return state === "available" || state === "empty"
}

function catalogStateMessage(state: CatalogListResult<unknown>["state"]) {
  return state === "stale" ? "Catalog data may be stale." : `Catalog state: ${state}.`
}

function FlowRows({ state }: { state: CatalogPanelState<FlowSummary> }) {
  if (state.status === "loading") {
    return <StatePanel kind="loading" title="Loading execution flows">Loading catalog rows.</StatePanel>
  }
  if (state.status === "error") {
    return <StatePanel kind="degraded" title="Execution flows unavailable">{state.message}</StatePanel>
  }
  if (!isEmptyCatalogState(state.result.state)) {
    return <StatePanel kind="degraded" title="Execution flows limited">{catalogStateMessage(state.result.state)}</StatePanel>
  }
  if (state.result.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No execution flows returned.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Steps</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {state.result.items.slice(0, 8).map((flow) => (
          <TableRow key={flow.id}>
            <TableCell className="font-medium">{flow.name}</TableCell>
            <TableCell>{flow.entryKind}</TableCell>
            <TableCell>{flow.stepCount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ClusterBadges({ state }: { state: CatalogPanelState<ClusterSummary> }) {
  if (state.status === "loading") {
    return <StatePanel kind="loading" title="Loading functional clusters">Loading catalog rows.</StatePanel>
  }
  if (state.status === "error") {
    return <StatePanel kind="degraded" title="Functional clusters unavailable">{state.message}</StatePanel>
  }
  if (!isEmptyCatalogState(state.result.state)) {
    return <StatePanel kind="degraded" title="Functional clusters limited">{catalogStateMessage(state.result.state)}</StatePanel>
  }
  if (state.result.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No functional clusters returned.</p>
  }

  return state.result.items.slice(0, 16).map((cluster) => (
    <Badge key={cluster.id} variant="secondary">
      {cluster.displayLabel ?? cluster.canonicalLabel} ({cluster.memberCount})
    </Badge>
  ))
}

export function FlowSections({
  flows,
  clusters,
}: {
  flows: CatalogPanelState<FlowSummary>
  clusters: CatalogPanelState<ClusterSummary>
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Execution flows</CardTitle>
          <CardDescription>Trace-style entry points discovered for this repository.</CardDescription>
        </CardHeader>
        <CardContent>
          <FlowRows state={flows} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Functional clusters</CardTitle>
          <CardDescription>Related files and directories grouped by catalog analysis.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <ClusterBadges state={clusters} />
        </CardContent>
      </Card>
    </div>
  )
}
