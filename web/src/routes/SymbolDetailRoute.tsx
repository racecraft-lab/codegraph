import * as React from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { BotIcon, GitBranchIcon, RadiusIcon } from "lucide-react"

import { useAppState } from "@/app/state"
import { FlowSections, type CatalogPanelState } from "@/components/symbol/FlowSections"
import { RelationshipPanels, type RelationshipPanelState } from "@/components/symbol/RelationshipPanels"
import { RelationshipState } from "@/components/symbol/RelationshipStates"
import {
  SourcePane,
  fileUriForPath,
  relativePathFromFileUri,
} from "@/components/symbol/SourcePane"
import { StatePanel } from "@/components/layout/StatePanel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { listClusters, listFlows } from "@/lib/api/catalogs"
import { errorState } from "@/lib/api/client"
import { listCallees, listCallers } from "@/lib/api/relationships"
import { getSymbol } from "@/lib/api/symbols"
import type { ClusterSummary, CodeNode, FlowSummary } from "@/lib/api/types"
import { SOURCE_VIEWER_TRANSPORT_AVAILABLE } from "@/lib/lsp/availability"
import type { LspLocation, LspRange } from "@/lib/lsp/client"
import { isWindowsRepositoryRoot } from "@/lib/lsp/path"
import { mark, measure } from "@/lib/perf/marks"

const loadingRelationships: RelationshipPanelState = { status: "loading" }
const loadingCatalog: CatalogPanelState<FlowSummary> = { status: "loading" }
const loadingClusters: CatalogPanelState<ClusterSummary> = { status: "loading" }

export function SymbolDetailRoute() {
  const { id = "" } = useParams()
  const nodeId = id
  const [searchParams, setSearchParams] = useSearchParams()
  const { selectedRepo, selectNode, clearNode } = useAppState()
  const [node, setNode] = React.useState<CodeNode | null>(null)
  const [callers, setCallers] = React.useState<RelationshipPanelState>(loadingRelationships)
  const [callees, setCallees] = React.useState<RelationshipPanelState>(loadingRelationships)
  const [flows, setFlows] = React.useState<CatalogPanelState<FlowSummary>>(loadingCatalog)
  const [clusters, setClusters] = React.useState<CatalogPanelState<ClusterSummary>>(loadingClusters)
  const [message, setMessage] = React.useState("Loading symbol context.")
  const [partialError, setPartialError] = React.useState<string | undefined>()
  const [durationMs, setDurationMs] = React.useState<number | null>(null)
  const [openSourceIntent, setOpenSourceIntent] = React.useState<{ targetKey: string; reached: boolean } | null>(null)
  const openSourceRef = React.useRef<HTMLButtonElement>(null)
  const sourceOpen = SOURCE_VIEWER_TRANSPORT_AVAILABLE
    && selectedRepo !== undefined
    && sourceSearchIsForRepo(searchParams, selectedRepo.id)

  React.useEffect(() => {
    let cancelled = false
    setNode(null)
    setCallers(loadingRelationships)
    setCallees(loadingRelationships)
    setFlows(loadingCatalog)
    setClusters(loadingClusters)
    setDurationMs(null)
    setPartialError(undefined)
    setMessage("Loading symbol context.")
    clearNode()
    async function load() {
      mark("symbol-request")
      try {
        const nextNode = await getSymbol(nodeId, selectedRepo?.id)
        if (cancelled) return
        mark("symbol-render")
        setDurationMs(measure("symbol-response-render", "symbol-request", "symbol-render"))
        setNode(nextNode)
        selectNode(nextNode)
        setMessage("Symbol context loaded.")
        const [nextCallers, nextCallees, nextFlows, nextClusters] = await Promise.allSettled([
          listCallers(nodeId, selectedRepo?.id),
          listCallees(nodeId, selectedRepo?.id),
          listFlows(selectedRepo?.id),
          listClusters(selectedRepo?.id),
        ])
        if (cancelled) return
        const partial = [nextCallers, nextCallees, nextFlows, nextClusters].some((result) => result.status === "rejected")
        setCallers(nextCallers.status === "fulfilled" ? { status: "success", result: nextCallers.value } : { status: "error", message: errorState(nextCallers.reason).message })
        setCallees(nextCallees.status === "fulfilled" ? { status: "success", result: nextCallees.value } : { status: "error", message: errorState(nextCallees.reason).message })
        setFlows(nextFlows.status === "fulfilled" ? { status: "success", result: nextFlows.value } : { status: "error", message: errorState(nextFlows.reason).message })
        setClusters(nextClusters.status === "fulfilled" ? { status: "success", result: nextClusters.value } : { status: "error", message: errorState(nextClusters.reason).message })
        if (partial) {
          setMessage("Symbol loaded with partial relationship context.")
          setPartialError("Some relationship or catalog context could not be loaded.")
        }
      } catch (error) {
        if (cancelled) return
        const nextError = errorState(error)
        setNode(null)
        setCallers(loadingRelationships)
        setCallees(loadingRelationships)
        setFlows(loadingCatalog)
        setClusters(loadingClusters)
        setDurationMs(null)
        setPartialError(undefined)
        setMessage(nextError.message)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [clearNode, nodeId, selectNode, selectedRepo?.id])

  const fallbackLocation = React.useMemo(() => {
    if (!node?.file || !selectedRepo) return null
    const line = Math.max(0, (node.line ?? 1) - 1)
    return {
      uri: fileUriForPath(selectedRepo.root, node.file),
      range: { start: { line, character: 0 }, end: { line, character: 1 } },
    } satisfies LspLocation
  }, [node, selectedRepo])

  const restoredLocation = React.useMemo(
    () => selectedRepo ? parseViewerLocation(searchParams, selectedRepo.id, selectedRepo.root) : null,
    [searchParams, selectedRepo],
  )
  const sourceLocation = restoredLocation ?? fallbackLocation
  const restoredLocationKey = restoredLocation ? sourceLocationKey(restoredLocation) : null
  const openedFromButton = openSourceIntent?.targetKey === restoredLocationKey

  React.useEffect(() => {
    if (restoredLocationKey === null) return
    setOpenSourceIntent((current) => {
      if (!current) return null
      if (current.targetKey === restoredLocationKey) return current.reached ? current : { ...current, reached: true }
      return current.reached ? null : current
    })
  }, [restoredLocationKey])

  React.useEffect(() => {
    if (!selectedRepo || !searchParams.has("source") || sourceSearchIsForRepo(searchParams, selectedRepo.id)) return
    setOpenSourceIntent(null)
    setSearchParams((current) => clearSourceSearch(current), { replace: true })
  }, [searchParams, selectedRepo, setSearchParams])

  const navigateSource = React.useCallback((location: LspLocation) => {
    if (!selectedRepo || !relativePathFromFileUri(selectedRepo.root, location.uri)) return
    setOpenSourceIntent(null)
    setSearchParams((current) => locationSearch(current, selectedRepo.id, selectedRepo.root, location))
  }, [selectedRepo, setSearchParams])

  const canonicalizeSource = React.useCallback((location: LspLocation) => {
    if (!selectedRepo || !relativePathFromFileUri(selectedRepo.root, location.uri)) return
    setOpenSourceIntent(null)
    setSearchParams((current) => locationSearch(current, selectedRepo.id, selectedRepo.root, location), { replace: true })
  }, [selectedRepo, setSearchParams])

  React.useEffect(() => {
    if (!sourceOpen || restoredLocation || !fallbackLocation || !selectedRepo) return
    setSearchParams(
      (current) => locationSearch(current, selectedRepo.id, selectedRepo.root, fallbackLocation),
      { replace: true },
    )
  }, [fallbackLocation, restoredLocation, selectedRepo, setSearchParams, sourceOpen])

  const closeSource = React.useCallback(() => {
    openSourceRef.current?.focus()
    setOpenSourceIntent(null)
    setSearchParams((current) => clearSourceSearch(current), { replace: true })
  }, [setSearchParams])

  if (!node) {
    return (
      <div className="p-4">
        <StatePanel kind={message === "Loading symbol context." ? "loading" : "error"} title="Symbol detail">
          {message}
        </StatePanel>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{node.name}</CardTitle>
          <CardDescription>
            {node.kind}
            {node.file ? ` in ${node.file}` : ""}
            {durationMs !== null ? ` | rendered in ${Math.round(durationMs)} ms` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" nativeButton={false} render={<Link to={`/graph/${encodeURIComponent(node.id)}`} />}>
              <GitBranchIcon data-icon="inline-start" />
              Open graph
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link to={`/impact/${encodeURIComponent(node.id)}`} />}>
              <RadiusIcon data-icon="inline-start" />
              Review impact
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link to="/chat" />}>
              <BotIcon data-icon="inline-start" />
              Ask with context
            </Button>
            {SOURCE_VIEWER_TRANSPORT_AVAILABLE && fallbackLocation ? (
              <Button
                ref={openSourceRef}
                variant="outline"
                onClick={() => {
                  if (!selectedRepo) return
                  setOpenSourceIntent({ targetKey: sourceLocationKey(fallbackLocation), reached: false })
                  setSearchParams(
                    (current) => locationSearch(current, selectedRepo.id, selectedRepo.root, fallbackLocation),
                  )
                }}
              >
                Open source
              </Button>
            ) : null}
          </div>
          <Separator />
          <pre className="max-h-56 overflow-auto rounded-lg bg-muted p-3 text-xs">
            {node.signature ?? node.doc ?? "No signature or source context is available for this symbol."}
          </pre>
        </CardContent>
      </Card>
      {SOURCE_VIEWER_TRANSPORT_AVAILABLE && sourceOpen && sourceLocation && selectedRepo ? (
        <SourcePane
          key={`${selectedRepo.id}:${node.id}`}
          repoId={selectedRepo.id}
          root={selectedRepo.root}
          location={sourceLocation}
          initialSymbol={openedFromButton || !restoredLocation ? { id: node.id, name: node.name } : undefined}
          onCanonicalize={canonicalizeSource}
          onNavigate={navigateSource}
          onClose={closeSource}
        />
      ) : null}
      {partialError ? (
        <StatePanel kind="degraded" title="Partial relationship context">
          {partialError}
        </StatePanel>
      ) : null}
      <RelationshipState state={flows.status === "success" ? flows.result.state : "available"} />
      <RelationshipPanels callers={callers} callees={callees} />
      <FlowSections flows={flows} clusters={clusters} />
    </div>
  )
}

export function parseViewerLocation(params: URLSearchParams, repoId: string, root: string): LspLocation | null {
  const source = params.get("source")
  if (!source || params.get("repo") !== repoId || !isSafeRelativePath(root, source)) return null
  const values = ["sl", "sc", "el", "ec"].map((key) => parsePosition(params.get(key)))
  if (values.some((value) => value === null)) return null
  const [sl, sc, el, ec] = values as [number, number, number, number]
  if (el < sl || (el === sl && ec < sc)) return null
  return {
    uri: fileUriForPath(root, source),
    range: { start: { line: sl, character: sc }, end: { line: el, character: ec } },
  }
}

export function locationSearch(
  current: URLSearchParams,
  repoId: string,
  root: string,
  location: LspLocation,
): URLSearchParams {
  const source = relativePathFromFileUri(root, location.uri)
  if (!source || !isSafeRelativePath(root, source)) return new URLSearchParams(current)
  const next = new URLSearchParams(current)
  next.set("repo", repoId)
  next.set("source", source)
  setRange(next, location.range)
  return next
}

export function sourceSearchIsForRepo(params: URLSearchParams, repoId: string): boolean {
  return params.has("source") && params.get("repo") === repoId
}

export function clearSourceSearch(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const key of ["repo", "source", "sl", "sc", "el", "ec"]) next.delete(key)
  return next
}

function setRange(params: URLSearchParams, range: LspRange): void {
  params.set("sl", String(range.start.line))
  params.set("sc", String(range.start.character))
  params.set("el", String(range.end.line))
  params.set("ec", String(range.end.character))
}

function parsePosition(value: string | null): number | null {
  return value !== null && /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null
}

function sourceLocationKey(location: LspLocation): string {
  const { start, end } = location.range
  return `${location.uri}:${start.line}:${start.character}:${end.line}:${end.character}`
}

function isSafeRelativePath(root: string, value: string): boolean {
  const normalized = isWindowsRepositoryRoot(root) ? value.replaceAll("\\", "/") : value
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.startsWith("file:")) return false
  return !normalized.split("/").some((segment) => segment === "." || segment === ".." || segment === "")
}
