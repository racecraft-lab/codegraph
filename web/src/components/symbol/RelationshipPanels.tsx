import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CodeNode, ListResult } from "@/lib/api/types"

function NodeRows({ result }: { result?: ListResult<CodeNode> }) {
  if (!result || result.items.length === 0) {
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
        {result.items.map((node) => (
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
  callers?: ListResult<CodeNode>
  callees?: ListResult<CodeNode>
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Callers</CardTitle>
          <CardDescription>Symbols that call or reference this symbol.</CardDescription>
        </CardHeader>
        <CardContent>
          <NodeRows result={callers} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Callees</CardTitle>
          <CardDescription>Symbols this symbol calls or references.</CardDescription>
        </CardHeader>
        <CardContent>
          <NodeRows result={callees} />
        </CardContent>
      </Card>
    </div>
  )
}
