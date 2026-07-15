import * as React from "react"
import { useParams } from "react-router-dom"

import { useAppState } from "@/app/state"
import { ImpactState } from "@/components/impact/ImpactState"
import { ImpactTables } from "@/components/impact/ImpactTables"
import { StatePanel } from "@/components/layout/StatePanel"
import { errorState } from "@/lib/api/client"
import { getImpact } from "@/lib/api/impact"
import type { GraphResult } from "@/lib/api/types"

export function ImpactRoute() {
  const { id = "" } = useParams()
  const decodedId = decodeURIComponent(id)
  const { selectedRepo } = useAppState()
  const [impact, setImpact] = React.useState<GraphResult | null>(null)
  const [error, setError] = React.useState<string | undefined>()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const next = await getImpact(decodedId, selectedRepo?.id)
        if (!cancelled) {
          setImpact(next)
          setError(undefined)
        }
      } catch (caught) {
        if (!cancelled) {
          setImpact(null)
          setError(errorState(caught).message)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [decodedId, selectedRepo?.id])

  if (!impact) {
    return (
      <div className="p-4">
        <StatePanel kind={error ? "error" : "loading"} title="Impact radius">
          {error ?? "Loading impact radius."}
        </StatePanel>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <section>
        <h1 className="text-2xl font-semibold">Impact radius</h1>
        <p className="text-sm text-muted-foreground">
          {impact.nodes.length.toLocaleString()} affected symbols and {impact.edges.length.toLocaleString()} graph edges.
        </p>
      </section>
      <ImpactState truncated={impact.truncated} error={error} />
      <ImpactTables impact={impact} />
    </div>
  )
}
