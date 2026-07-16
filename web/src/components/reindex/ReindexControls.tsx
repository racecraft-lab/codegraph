import { RefreshCcwIcon, RotateCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export function ReindexControls({
  disabled,
  onSync,
  onFull,
}: {
  disabled?: boolean
  onSync: () => void
  onFull: () => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button disabled={disabled} onClick={onSync}>
        <RefreshCcwIcon data-icon="inline-start" />
        Sync changed files
      </Button>
      <Button variant="outline" disabled={disabled} onClick={onFull}>
        <RotateCwIcon data-icon="inline-start" />
        Full rebuild
      </Button>
    </div>
  )
}
