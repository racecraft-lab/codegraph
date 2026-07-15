import { StatePanel } from "@/components/layout/StatePanel"

export function GraphState({ truncated, error }: { truncated?: boolean; error?: string }) {
  if (error) return <StatePanel kind="error" title="Graph unavailable">{error}</StatePanel>
  if (truncated) return <StatePanel kind="degraded" title="Graph truncated">The graph was bounded by the backend node cap.</StatePanel>
  return null
}
