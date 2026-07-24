import * as React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  BrowserLspClient,
  BrowserLspError,
  type BrowserLspApi,
  type HoverResult,
  type LspLocation,
  type LspPosition,
  type SourceSnapshot,
} from "@/lib/lsp/client"

type ViewerState = "connecting" | "loading" | "ready" | "empty" | "stale" | "unavailable" | "timed-out" | "disconnected"

const MAX_INTERACTIVE_SOURCE_NODES = 10_000
const SOURCE_IDENTIFIER_PATTERN = /[\p{L}_$][\p{L}\p{N}_$]*/gu

interface SourcePaneProps {
  repoId: string
  root: string
  location: LspLocation
  initialSymbol?: { id: string; name: string }
  onCanonicalize?(location: LspLocation): void
  onNavigate(location: LspLocation): void
  onClose(): void
  createClient?: (repoId: string) => BrowserLspApi
}

export function SourcePane({ repoId, root, location, initialSymbol, onCanonicalize, onNavigate, onClose, createClient }: SourcePaneProps) {
  const factory = React.useMemo(() => createClient ?? ((id: string) => new BrowserLspClient(id)), [createClient])
  const clientRef = React.useRef<BrowserLspApi | null>(null)
  const generationRef = React.useRef(0)
  const hoverGenerationRef = React.useRef(0)
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const disconnectCleanupRef = React.useRef<(() => void) | null>(null)
  const focusAfterLoadRef = React.useRef(false)
  const sourceRef = React.useRef<HTMLPreElement>(null)
  const [state, setState] = React.useState<ViewerState>("connecting")
  const [snapshot, setSnapshot] = React.useState<SourceSnapshot | null>(null)
  const [active, setActive] = React.useState<LspPosition>(location.range.start)
  const [hover, setHover] = React.useState<HoverResult | null>(null)
  const [references, setReferences] = React.useState<LspLocation[]>([])
  const [failureReason, setFailureReason] = React.useState<string | undefined>()
  const [interactionStatus, setInteractionStatus] = React.useState("")

  const load = React.useCallback(async (freshConnection: boolean) => {
    const generation = ++generationRef.current
    hoverGenerationRef.current += 1
    setHover(null)
    setReferences([])
    setSnapshot(null)
    setFailureReason(undefined)
    setInteractionStatus("")
    setActive(location.range.start)
    if (freshConnection && clientRef.current) {
      disconnectCleanupRef.current?.()
      disconnectCleanupRef.current = null
      await clientRef.current.close()
    }
    const client = freshConnection || !clientRef.current ? factory(repoId) : clientRef.current
    clientRef.current = client
    disconnectCleanupRef.current?.()
    disconnectCleanupRef.current = client.onDisconnect(() => {
      if (generation !== generationRef.current) return
      setFailureReason(undefined)
      setSnapshot(null)
      setState("disconnected")
    })
    try {
      setState("connecting")
      await client.connect()
      if (generation !== generationRef.current) return
      if (initialSymbol) {
        const canonical = await client.symbolLocation(initialSymbol.id, initialSymbol.name)
        if (generation !== generationRef.current) return
        if (canonical && locationKey(canonical) !== locationKey(location)) {
          onCanonicalize?.(canonical)
          return
        }
      }
      setState("loading")
      const content = await client.content(location.uri)
      if (generation !== generationRef.current) return
      setSnapshot(content)
      setState(content.text.length === 0 ? "empty" : "ready")
      focusAfterLoadRef.current = freshConnection
      try {
        const nextReferences = await client.references(location.uri, location.range.start)
        if (generation === generationRef.current) setReferences(nextReferences)
      } catch { /* source remains usable when optional references are unavailable */ }
    } catch (error) {
      if (generation !== generationRef.current) return
      setSnapshot(null)
      if (error instanceof BrowserLspError) {
        setFailureReason(error.reason)
        setState(error.state)
      } else setState("unavailable")
    }
  }, [factory, initialSymbol, location, onCanonicalize, repoId])

  React.useEffect(() => {
    void load(false)
    return () => {
      generationRef.current += 1
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [load])

  React.useEffect(() => () => {
    disconnectCleanupRef.current?.()
    disconnectCleanupRef.current = null
    void clientRef.current?.close()
    clientRef.current = null
  }, [])

  React.useEffect(() => {
    if (!snapshot || !focusAfterLoadRef.current) return
    focusAfterLoadRef.current = false
    sourceRef.current?.focus()
  }, [snapshot])

  const requestHover = React.useCallback((position: LspPosition = active) => {
    if (!clientRef.current || !snapshot) return
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    const generation = generationRef.current
    const hoverGeneration = ++hoverGenerationRef.current
    setHover(null)
    hoverTimerRef.current = setTimeout(() => {
      void clientRef.current?.hover(location.uri, position).then((result) => {
        if (generation !== generationRef.current || hoverGeneration !== hoverGenerationRef.current) return
        setHover(result)
        setInteractionStatus(result ? "Hover details are available." : "No hover details are available at the active token.")
      }).catch(() => {
        if (generation === generationRef.current && hoverGeneration === hoverGenerationRef.current) {
          setHover(null)
          setInteractionStatus("Hover details are unavailable.")
        }
      })
    }, 150)
  }, [active, location.uri, snapshot])

  const goToDefinition = React.useCallback(async (position: LspPosition = active) => {
    if (!clientRef.current || !snapshot) return
    const generation = generationRef.current
    try {
      const target = await clientRef.current.definition(location.uri, position)
      if (generation !== generationRef.current) return
      if (target) {
        setInteractionStatus("Definition found.")
        onNavigate(target)
      } else setInteractionStatus("No exact definition is available at the active token.")
    } catch { setInteractionStatus("Definition is unavailable.") }
  }, [active, location.uri, onNavigate, snapshot])

  const activate = React.useCallback((position: LspPosition, showHover = false) => {
    setActive(position)
    if (showHover) requestHover(position)
    else {
      hoverGenerationRef.current += 1
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      setHover(null)
      setInteractionStatus("")
    }
  }, [requestHover])

  const onSourceKeyDown = (event: React.KeyboardEvent<HTMLPreElement>) => {
    if (!snapshot) return
    if (event.key === "Escape") {
      setHover(null)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      void goToDefinition(active)
      return
    }
    const lines = sourceLines(snapshot.text)
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault()
      const delta = event.key === "ArrowLeft" ? -1 : 1
      activate({ ...active, character: clamp(active.character + delta, 0, lines[active.line]?.length ?? 0) })
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault()
      const delta = event.key === "ArrowUp" ? -1 : 1
      const line = clamp(active.line + delta, 0, Math.max(0, lines.length - 1))
      activate({ line, character: clamp(active.character, 0, lines[line]?.length ?? 0) })
    }
  }

  const groupedReferences = React.useMemo(() => groupReferences(root, references), [references, root])
  const interactiveSource = React.useMemo(
    () => snapshot !== null && canRenderSourceInteractively(snapshot.text),
    [snapshot],
  )
  const path = relativePathFromFileUri(root, location.uri) ?? "Indexed source"
  const message = stateMessage(state, failureReason)

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Source</CardTitle>
            <CardDescription>{path}</CardDescription>
          </div>
          <Button variant="outline" onClick={onClose}>Close source</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => requestHover(active)} disabled={!snapshot}>Show hover details</Button>
          <Button variant="outline" onClick={() => void goToDefinition(active)} disabled={!snapshot}>Go to definition</Button>
          {isRetryable(state) ? <Button onClick={() => void load(true)}>Retry source</Button> : null}
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <p className="sr-only" aria-live="polite">{interactionStatus || message}</p>
        {snapshot ? (
          <>
            {!interactiveSource && snapshot.text.length > 0 ? (
              <p className="text-xs text-muted-foreground">Interactive token highlighting is disabled for this large source.</p>
            ) : null}
            <pre
              ref={sourceRef}
              role="textbox"
              aria-label={`Read-only source for ${path}`}
              aria-readonly="true"
              aria-activedescendant={interactiveSource && snapshot.text.length > 0 ? "codegraph-active-source-token" : undefined}
              aria-describedby={hover ? "codegraph-source-hover" : undefined}
              tabIndex={0}
              onKeyDown={onSourceKeyDown}
              className="max-h-[32rem] min-w-0 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:scroll-auto"
            >
              {interactiveSource
                ? renderSource(snapshot.text, active, activate, (position) => void goToDefinition(position))
                : snapshot.text}
            </pre>
          </>
        ) : (
          <div role={isRetryable(state) ? "alert" : "status"} className="rounded-lg border p-3 text-sm">{message}</div>
        )}
        {hover ? (
          <div id="codegraph-source-hover" aria-label="Hover details" className="rounded-lg border bg-popover p-3 text-sm" onKeyDown={(event) => event.key === "Escape" && setHover(null)}>
            {hover.contents.value}
          </div>
        ) : null}
        {groupedReferences.length > 0 ? (
          <section aria-label="References" className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">References</h3>
            {groupedReferences.map((group) => (
              <div key={group.path}>
                <p className="text-xs text-muted-foreground">{group.path} ({group.locations.length})</p>
                <div className="flex flex-wrap gap-1">
                  {group.locations.map((reference) => (
                    <Button
                      key={locationKey(reference)}
                      variant="ghost"
                      size="sm"
                      aria-label={`Open ${group.path} line ${reference.range.start.line + 1} column ${reference.range.start.character + 1}`}
                      onClick={() => {
                        onNavigate(reference)
                        queueMicrotask(() => sourceRef.current?.focus())
                      }}
                    >
                      {reference.range.start.line + 1}:{reference.range.start.character + 1}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function fileUriForPath(root: string, relativePath: string): string {
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/$/, "")
  const encodedRoot = normalizedRoot.split("/").map(encodeURIComponent).join("/")
  const normalizedRelative = relativePath.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/")
  const prefix = /^[A-Za-z]:\//.test(normalizedRoot) ? "/" : ""
  return `file://${prefix}${encodedRoot}/${normalizedRelative}`
}

export function relativePathFromFileUri(root: string, uri: string): string | null {
  try {
    const decoded = decodeURIComponent(new URL(uri).pathname).replaceAll("\\", "/")
    const normalizedRoot = root.replaceAll("\\", "/").replace(/\/$/, "")
    const path = /^[A-Za-z]:\//.test(normalizedRoot) && decoded.startsWith("/") ? decoded.slice(1) : decoded
    if (path === normalizedRoot) return null
    return path.startsWith(`${normalizedRoot}/`) ? path.slice(normalizedRoot.length + 1) : null
  } catch {
    return null
  }
}

function renderSource(
  text: string,
  active: LspPosition,
  activate: (position: LspPosition, showHover?: boolean) => void,
  activateDefinition: (position: LspPosition) => void,
): React.ReactNode {
  const lines = sourceLines(text)
  return lines.map((line, lineIndex) => (
    <React.Fragment key={lineIndex}>
      {tokenizeLine(line).map((part, partIndex) => {
        if (typeof part === "string") return <React.Fragment key={partIndex}>{part}</React.Fragment>
        const position = { line: lineIndex, character: part.start }
        const token = (
          <span
            key={partIndex}
            onPointerEnter={() => activate(position, true)}
            onDoubleClick={() => { activate(position); activateDefinition(position) }}
          >
            {part.text}
          </span>
        )
        return lineIndex === active.line && active.character >= part.start && active.character < part.end
          ? <mark id="codegraph-active-source-token" key={partIndex}>{token}</mark>
          : token
      })}
      {lineIndex < lines.length - 1 ? "\n" : null}
    </React.Fragment>
  ))
}

function tokenizeLine(line: string): Array<string | { text: string; start: number; end: number }> {
  const parts: Array<string | { text: string; start: number; end: number }> = []
  const tokens = line.matchAll(SOURCE_IDENTIFIER_PATTERN)
  let offset = 0
  for (const token of tokens) {
    const start = token.index
    if (start > offset) parts.push(line.slice(offset, start))
    const text = token[0]
    parts.push({ text, start, end: start + text.length })
    offset = start + text.length
  }
  if (offset < line.length || parts.length === 0) parts.push(line.slice(offset))
  return parts
}

function canRenderSourceInteractively(text: string): boolean {
  let lineCount = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\r") {
      if (text[index + 1] === "\n") index += 1
      lineCount += 1
    } else if (text[index] === "\n") lineCount += 1
    if (lineCount * 2 + 1 > MAX_INTERACTIVE_SOURCE_NODES) return false
  }

  let estimatedNodes = lineCount * 2 + 1
  for (const _token of text.matchAll(SOURCE_IDENTIFIER_PATTERN)) {
    estimatedNodes += 2
    if (estimatedNodes > MAX_INTERACTIVE_SOURCE_NODES) return false
  }
  return true
}

function sourceLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/)
}

function groupReferences(root: string, locations: LspLocation[]) {
  const groups = new Map<string, LspLocation[]>()
  for (const location of locations) {
    const path = relativePathFromFileUri(root, location.uri)
    if (!path) continue
    const entries = groups.get(path) ?? []
    entries.push(location)
    groups.set(path, entries)
  }
  return [...groups].map(([path, entries]) => ({ path, locations: entries }))
}

function stateMessage(state: ViewerState, reason?: string): string {
  switch (state) {
    case "connecting": return "Connecting to source intelligence."
    case "loading": return "Loading verified indexed source."
    case "ready": return "Verified indexed source is ready."
    case "empty": return "The verified indexed source file is empty."
    case "stale": return "Source changed since it was indexed. Re-index, then retry."
    case "timed-out": return "Source intelligence timed out. Retry when ready."
    case "disconnected": return "Source intelligence disconnected. Retry to reconnect."
    default: return unavailableMessage(reason)
  }
}

function unavailableMessage(reason?: string): string {
  switch (reason) {
    case "not_found": return "The indexed source file was not found. The symbol details remain usable."
    case "outside_repository": return "The source path is outside this repository. The symbol details remain usable."
    case "unindexed": return "The source file is not indexed. The symbol details remain usable."
    case "not_regular": return "The indexed source is not a regular file. The symbol details remain usable."
    case "too_large": return "The indexed source is too large to display. The symbol details remain usable."
    case "unreadable": return "The indexed source cannot be read. The symbol details remain usable."
    default: return "Source intelligence is unavailable. The symbol details remain usable."
  }
}

function isRetryable(state: ViewerState): boolean {
  return state === "stale" || state === "timed-out" || state === "unavailable" || state === "disconnected"
}

function locationKey(location: LspLocation): string {
  return `${location.uri}:${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
