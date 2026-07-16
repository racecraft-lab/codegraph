import { StatePanel } from "@/components/layout/StatePanel"

export function ImpactState({ truncated, error }: { truncated?: boolean; error?: string }) {
  if (error) return <StatePanel kind="error" title="Impact unavailable">{error}</StatePanel>
  if (truncated) return <StatePanel kind="degraded" title="Impact truncated">Traversal limits were reached. Treat the result as incomplete.</StatePanel>
  return null
}
