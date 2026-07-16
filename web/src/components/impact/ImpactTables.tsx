import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { GraphResult } from "@/lib/api/types"

export function ImpactTables({ impact }: { impact: GraphResult }) {
  const files = [...new Set(impact.nodes.map((node) => node.file).filter((file): file is string => Boolean(file)))]

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Affected symbol</TableHead>
            <TableHead>Kind</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {impact.nodes.map((node) => (
            <TableRow key={node.id}>
              <TableCell className="font-medium">{node.name}</TableCell>
              <TableCell>{node.kind}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Affected file</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((file) => (
            <TableRow key={file}>
              <TableCell className="font-mono text-xs">{file}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
