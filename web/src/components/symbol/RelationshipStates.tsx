import { StatePanel } from "@/components/layout/StatePanel"
import type { CatalogState } from "@/lib/api/types"

export function RelationshipState({ state }: { state: CatalogState | "truncated" }) {
  if (state === "available") return null
  if (state === "empty") return <StatePanel kind="empty" title="No relationships">No catalog entries were found for this repository.</StatePanel>
  if (state === "truncated") return <StatePanel kind="degraded" title="Results truncated">The backend returned a bounded result set. Narrow the selection for more detail.</StatePanel>
  return <StatePanel kind="degraded" title="Relationship data limited">Catalog state: {state}.</StatePanel>
}
