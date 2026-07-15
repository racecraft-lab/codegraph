import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-10 flex-wrap items-center gap-2 border-b bg-background px-3 py-2", className)}>
      {children}
    </div>
  )
}
