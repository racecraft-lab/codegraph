import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CatalogListResult, ClusterSummary, FlowSummary } from "@/lib/api/types"

export function FlowSections({
  flows,
  clusters,
}: {
  flows?: CatalogListResult<FlowSummary>
  clusters?: CatalogListResult<ClusterSummary>
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Execution flows</CardTitle>
          <CardDescription>Trace-style entry points discovered for this repository.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Steps</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(flows?.items ?? []).slice(0, 8).map((flow) => (
                <TableRow key={flow.id}>
                  <TableCell className="font-medium">{flow.name}</TableCell>
                  <TableCell>{flow.entryKind}</TableCell>
                  <TableCell>{flow.stepCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Functional clusters</CardTitle>
          <CardDescription>Related files and directories grouped by catalog analysis.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(clusters?.items ?? []).slice(0, 16).map((cluster) => (
            <Badge key={cluster.id} variant="secondary">
              {cluster.displayLabel ?? cluster.canonicalLabel} ({cluster.memberCount})
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
