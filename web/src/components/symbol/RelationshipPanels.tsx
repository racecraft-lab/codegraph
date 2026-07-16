import { Link } from "react-router-dom"

import { StatePanel } from "@/components/layout/StatePanel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CodeNode, ListResult } from "@/lib/api/types"

export type RelationshipPanelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; result: ListResult<CodeNode> }

function NodeRows({ state, label }: { state: RelationshipPanelState; label: string }) {
  if (state.status === "loading") {
    return <StatePanel kind="loading" title={`Loading ${label}`}>Loading relationship rows.</StatePanel>
  }

  if (state.status === "error") {
    return <StatePanel kind="degraded" title={`${label} unavailable`}>{state.message}</StatePanel>
  }

  if (state.result.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No relationship rows returned.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>File</TableHead>
          <TableHead className="w-24">Open</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {state.result.items.map((node) => (
          <TableRow key={node.id}>
            <TableCell className="font-medium">{node.name}</TableCell>
            <TableCell>{node.kind}</TableCell>
            <TableCell className="max-w-md truncate">{node.file ?? "Unknown file"}</TableCell>
            <TableCell>
              <Button variant="outline" size="sm" nativeButton={false} render={<Link to={`/symbol/${encodeURIComponent(node.id)}`} />}>
                Open
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function RelationshipPanels({
  callers,
  callees,
}: {
  callers: RelationshipPanelState
  callees: RelationshipPanelState
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Callers</CardTitle>
          <CardDescription>Symbols that call or reference this symbol.</CardDescription>
        </CardHeader>
        <CardContent>
          <NodeRows state={callers} label="callers" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Callees</CardTitle>
          <CardDescription>Symbols this symbol calls or references.</CardDescription>
        </CardHeader>
        <CardContent>
          <NodeRows state={callees} label="callees" />
        </CardContent>
      </Card>
    </div>
  )
}
