import type { ReactNode } from "react"
import { AlertCircleIcon, LockIcon, PlugZapIcon, SearchXIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

type StatePanelKind = "loading" | "empty" | "degraded" | "unauthorized" | "error"

const ICONS = {
  loading: PlugZapIcon,
  empty: SearchXIcon,
  degraded: AlertCircleIcon,
  unauthorized: LockIcon,
  error: AlertCircleIcon,
}

export function StatePanel({
  kind,
  title,
  children,
}: {
  kind: StatePanelKind
  title: string
  children: ReactNode
}) {
  const Icon = ICONS[kind]
  if (kind === "loading") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border p-4" aria-busy="true">
        <div className="flex items-center gap-2">
          <Icon />
          <span className="text-sm font-medium">{title}</span>
        </div>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  }

  return (
    <Alert variant={kind === "error" || kind === "unauthorized" ? "destructive" : "default"}>
      <Icon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}
