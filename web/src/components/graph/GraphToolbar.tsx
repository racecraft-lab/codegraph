import { Maximize2Icon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react"

import { Toolbar } from "@/components/layout/Toolbar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export function GraphToolbar({
  depth,
  filter,
  onDepthChange,
  onFilterChange,
  onFit,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  depth: number
  filter: string
  onDepthChange: (depth: number) => void
  onFilterChange: (filter: string) => void
  onFit: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}) {
  return (
    <Toolbar>
      <ToggleGroup value={[String(depth)]} onValueChange={(value) => value[0] && onDepthChange(Number(value[0]))}>
        {[1, 2, 3].map((nextDepth) => (
          <ToggleGroupItem key={nextDepth} value={String(nextDepth)} aria-label={`Depth ${nextDepth}`}>
            {nextDepth}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Input
        className="h-8 w-56"
        aria-label="Filter graph nodes"
        value={filter}
        onChange={(event) => onFilterChange(event.target.value)}
        placeholder="Filter nodes"
      />
      <Button variant="outline" size="icon-sm" aria-label="Zoom in" onClick={onZoomIn}>
        <PlusIcon />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label="Zoom out" onClick={onZoomOut}>
        <MinusIcon />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label="Fit graph" onClick={onFit}>
        <Maximize2Icon />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label="Reset graph" onClick={onReset}>
        <RotateCcwIcon />
      </Button>
    </Toolbar>
  )
}
