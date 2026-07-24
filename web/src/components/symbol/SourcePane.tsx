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
import { isWindowsRepositoryRoot } from "@/lib/lsp/path"

type ViewerState = "connecting" | "loading" | "ready" | "empty" | "render-limited" | "stale" | "unavailable" | "timed-out" | "disconnected" | "retry-required"
type ConnectionPermission = "initial" | "connected" | "retry-required" | "retrying"
type FailureState = "stale" | "unavailable" | "timed-out" | "disconnected"

const MAX_RENDERED_SOURCE_BYTES = 512 * 1024
const MAX_RENDERED_SOURCE_LINES = 10_000
const MAX_RENDERED_SOURCE_TOKENS = 20_000
const LOCAL_PRESSURE_RETRY_MS = 50
const CONTENT_OPERATION_DEADLINE_MS = 5_000
const SOURCE_TOKEN_PATTERN = /[\p{L}_$][\p{L}\p{N}_$]*|[!#%&*+\-./:<=>?@^|~]+|[^\s]/gu

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
  const currentLocationKey = locationKey(location)
  const keyedLocation = React.useMemo<LspLocation>(() => ({
    uri: location.uri,
    range: {
      start: { line: location.range.start.line, character: location.range.start.character },
      end: { line: location.range.end.line, character: location.range.end.character },
    },
    ...(location.snapshotToken ? { snapshotToken: location.snapshotToken } : {}),
  }), [location.range.end.character, location.range.end.line, location.range.start.character, location.range.start.line, location.snapshotToken, location.uri])
  const clientRef = React.useRef<BrowserLspApi | null>(null)
  const clientRepoIdRef = React.useRef<string | null>(null)
  const clientEpochRef = React.useRef(0)
  const connectionPermissionRef = React.useRef<ConnectionPermission>("initial")
  const locationKeyRef = React.useRef(currentLocationKey)
  const definitionRequestRef = React.useRef(0)
  const definitionInFlightRef = React.useRef(false)
  const navigationRequestRef = React.useRef(0)
  const referencesRequestRef = React.useRef(0)
  const referencesQueueRef = React.useRef<Promise<void>>(Promise.resolve())
  const contentQueueRef = React.useRef<Promise<void>>(Promise.resolve())
  const navigationSnapshotRef = React.useRef<{ key: string; snapshotToken: string } | null>(null)
  const preloadedSourceRef = React.useRef<{ key: string; snapshot: SourceSnapshot } | null>(null)
  const initialSymbolRef = React.useRef(initialSymbol)
  const canonicalRetryRef = React.useRef<{ key: string; symbol: { id: string; name: string } } | null>(null)
  const unverifiedFallbackKeysRef = React.useRef(new Set<string>())
  const generationRef = React.useRef(0)
  const hoverGenerationRef = React.useRef(0)
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverInFlightRef = React.useRef(false)
  const hoverAbortRef = React.useRef<AbortController | null>(null)
  const queuedHoverRef = React.useRef<{ uri: string; position: LspPosition; tokenKey: string; snapshotToken: string; locationKey: string; generation: number; hoverGeneration: number; announce: boolean } | null>(null)
  const flushHoverRef = React.useRef<() => void>(() => undefined)
  const hoverAfterMoveRef = React.useRef<LspPosition | null>(null)
  const disconnectCleanupRef = React.useRef<(() => void) | null>(null)
  const focusAfterLoadRef = React.useRef<"source" | "status" | null>(null)
  const scrollActiveAfterMoveRef = React.useRef(false)
  const sourceContentRef = React.useRef<HTMLDivElement>(null)
  const sourceRef = React.useRef<HTMLPreElement>(null)
  const statusRef = React.useRef<HTMLDivElement>(null)
  const hoverActionRef = React.useRef<HTMLButtonElement>(null)
  const definitionActionRef = React.useRef<HTMLButtonElement>(null)
  const previousLocationKeyRef = React.useRef(currentLocationKey)
  const mountedRef = React.useRef(false)
  const activeTokenRef = React.useRef<HTMLElement>(null)
  const tokenElementsRef = React.useRef(new Map<string, HTMLElement>())
  const [state, setState] = React.useState<ViewerState>("connecting")
  const [loadedSource, setLoadedSource] = React.useState<{ key: string; generation: number; snapshot: SourceSnapshot; model: SourceModel; actionable: boolean } | null>(null)
  const [active, setActive] = React.useState<LspPosition>(location.range.start)
  const [hover, setHover] = React.useState<{ tokenKey: string; result: HoverResult } | null>(null)
  const [referenceResult, setReferenceResult] = React.useState<{ tokenKey: string; locations: LspLocation[] } | null>(null)
  const [failure, setFailure] = React.useState<{ key: string; state: FailureState; reason?: string } | null>(null)
  const [interactionStatus, setInteractionStatus] = React.useState("")
  const [definitionInFlight, setDefinitionInFlight] = React.useState(false)
  const [retryingKey, setRetryingKey] = React.useState<string | null>(null)
  const [canonicalRetryKey, setCanonicalRetryKey] = React.useState<string | null>(null)
  const [sourceContentFocused, setSourceContentFocused] = React.useState(false)
  const [connectionPermission, setConnectionPermission] = React.useState<ConnectionPermission>("initial")
  const snapshot = loadedSource?.key === currentLocationKey ? loadedSource.snapshot : null
  const sourceModel = loadedSource?.key === currentLocationKey ? loadedSource.model : null
  const sourceActionsEnabled = loadedSource?.key === currentLocationKey && loadedSource.actionable
  const loadedGeneration = loadedSource?.key === currentLocationKey ? loadedSource.generation : 0
  const retrying = retryingKey === currentLocationKey
  const activeToken = sourceActionsEnabled && sourceModel ? tokenAt(sourceModel, active) : null
  const activeTokenKey = activeToken ? sourceTokenKey(active.line, activeToken.start) : null
  const updateConnectionPermission = React.useCallback((next: ConnectionPermission) => {
    connectionPermissionRef.current = next
    setConnectionPermission(next)
  }, [])
  const updateCanonicalRetry = React.useCallback((next: { key: string; symbol: { id: string; name: string } } | null) => {
    canonicalRetryRef.current = next
    setCanonicalRetryKey(next?.key ?? null)
  }, [])

  const registerSourceToken = React.useCallback((key: string, element: HTMLElement | null) => {
    if (element) tokenElementsRef.current.set(key, element)
    else tokenElementsRef.current.delete(key)
  }, [])

  const invalidateDefinition = React.useCallback(() => {
    definitionRequestRef.current += 1
    definitionInFlightRef.current = false
    setDefinitionInFlight(false)
  }, [])

  const abortHoverRequest = React.useCallback(() => {
    hoverAbortRef.current?.abort()
    hoverAbortRef.current = null
  }, [])

  const resetInteractions = React.useCallback(() => {
    hoverGenerationRef.current += 1
    abortHoverRequest()
    queuedHoverRef.current = null
    hoverAfterMoveRef.current = null
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
    referencesRequestRef.current += 1
    setHover(null)
    setReferenceResult(null)
    setInteractionStatus("")
  }, [abortHoverRequest])

  const focusStatusIfViewerInteractionFocused = React.useCallback(() => {
    const activeElement = document.activeElement
    if (sourceContentRef.current?.contains(activeElement)
      || hoverActionRef.current === activeElement
      || definitionActionRef.current === activeElement) {
      focusAfterLoadRef.current = "status"
    }
  }, [])

  const focusStatusAfterTerminalLoad = React.useCallback((focusAfterRetry = false) => {
    if (focusAfterRetry || focusAfterLoadRef.current === "source") focusAfterLoadRef.current = "status"
  }, [])

  React.useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  React.useEffect(() => {
    initialSymbolRef.current = initialSymbol
  }, [initialSymbol, repoId])

  React.useLayoutEffect(() => {
    if (previousLocationKeyRef.current === currentLocationKey) return
    previousLocationKeyRef.current = currentLocationKey
    if (sourceContentFocused && focusAfterLoadRef.current === null) focusAfterLoadRef.current = "source"
  }, [currentLocationKey, sourceContentFocused])

  React.useLayoutEffect(() => {
    locationKeyRef.current = currentLocationKey
    return () => {
      generationRef.current += 1
    }
  }, [currentLocationKey])

  const handleInteractionError = React.useCallback((error: unknown, requestedLocationKey: string): boolean => {
    if (requestedLocationKey !== locationKeyRef.current) return true
    if (!(error instanceof BrowserLspError)) return false
    if (isLocalPressureError(error)) return false
    generationRef.current += 1
    updateConnectionPermission("retry-required")
    invalidateDefinition()
    resetInteractions()
    focusStatusIfViewerInteractionFocused()
    setFailure({ key: requestedLocationKey, state: error.state, reason: error.reason })
    setLoadedSource(null)
    setState(error.state)
    return true
  }, [focusStatusIfViewerInteractionFocused, invalidateDefinition, resetInteractions, updateConnectionPermission])

  const queueContentRead = React.useCallback((
    client: BrowserLspApi,
    uri: string,
    isCurrent: () => boolean,
  ): Promise<SourceSnapshot | null> => {
    const deadlineAt = Date.now() + CONTENT_OPERATION_DEADLINE_MS
    const contentTask = contentQueueRef.current.then(async (): Promise<SourceSnapshot | null> => {
      while (isCurrent()) {
        try {
          return await contentBeforeDeadline(client, uri, deadlineAt)
        } catch (error) {
          if (!isLocalPressureError(error)) throw error
          const remaining = deadlineAt - Date.now()
          if (remaining <= 0) throw new BrowserLspError("timed-out", -32803, "timeout")
          await new Promise((resolve) => setTimeout(resolve, Math.min(LOCAL_PRESSURE_RETRY_MS, remaining)))
        }
      }
      return null
    })
    contentQueueRef.current = contentTask.then(() => undefined, () => undefined)
    return contentTask
  }, [])

  const load = React.useCallback(async (freshConnection: boolean) => {
    const generation = ++generationRef.current
    const requestedLocationKey = currentLocationKey
    const isCurrentLoad = () => (
      generation === generationRef.current && requestedLocationKey === locationKeyRef.current
    )
    invalidateDefinition()
    resetInteractions()
    setLoadedSource(null)
    setActive(keyedLocation.range.start)
    if (canonicalRetryRef.current && canonicalRetryRef.current.key !== requestedLocationKey) {
      updateCanonicalRetry(null)
    }
    const repositoryChanged = clientRepoIdRef.current !== null && clientRepoIdRef.current !== repoId
    if (repositoryChanged) {
      updateCanonicalRetry(null)
      unverifiedFallbackKeysRef.current.clear()
      navigationSnapshotRef.current = null
      preloadedSourceRef.current = null
      updateConnectionPermission("initial")
    }
    if (freshConnection) updateConnectionPermission("retrying")
    else if (!repositoryChanged && connectionPermissionRef.current === "retry-required") {
      focusAfterLoadRef.current = null
      return
    }
    setFailure(null)
    const replaceConnection = freshConnection || repositoryChanged
    if (replaceConnection && clientRef.current) {
      const previous = clientRef.current
      disconnectCleanupRef.current?.()
      disconnectCleanupRef.current = null
      clientEpochRef.current += 1
      clientRef.current = null
      clientRepoIdRef.current = null
      await previous.close()
      if (!isCurrentLoad()) return
    }
    const client = replaceConnection || !clientRef.current ? factory(repoId) : clientRef.current
    if (clientRef.current !== client) clientEpochRef.current += 1
    clientRef.current = client
    clientRepoIdRef.current = repoId
    const registeredClientEpoch = clientEpochRef.current
    disconnectCleanupRef.current?.()
    disconnectCleanupRef.current = client.onDisconnect(() => {
      if (clientRef.current !== client || clientEpochRef.current !== registeredClientEpoch) return
      generationRef.current += 1
      const disconnectedLocationKey = locationKeyRef.current
      const preserveTypedFailure = connectionPermissionRef.current === "retry-required"
      updateConnectionPermission("retry-required")
      clientEpochRef.current += 1
      invalidateDefinition()
      resetInteractions()
      focusStatusIfViewerInteractionFocused()
      focusStatusAfterTerminalLoad()
      setLoadedSource(null)
      if (!preserveTypedFailure) {
        setFailure({ key: disconnectedLocationKey, state: "disconnected" })
        setState("disconnected")
      }
    })
    try {
      setState("connecting")
      await client.connect()
      if (!isCurrentLoad()) return
      updateConnectionPermission("connected")
      const pendingCanonical = canonicalRetryRef.current
      const seedSymbol = initialSymbolRef.current
        ?? (pendingCanonical?.key === requestedLocationKey ? pendingCanonical.symbol : undefined)
      let exactInitialLocation = !unverifiedFallbackKeysRef.current.has(requestedLocationKey)
      let canonicalVerified = false
      if (seedSymbol) {
        const canonical = await client.symbolLocation(seedSymbol.id)
        if (!isCurrentLoad()) return
        if (canonical && !canonical.snapshotToken) throw new BrowserLspError("unavailable")
        onCanonicalize?.(canonical ?? keyedLocation)
        initialSymbolRef.current = undefined
        if (canonical) {
          const canonicalKey = locationKey(canonical)
          updateCanonicalRetry({ key: canonicalKey, symbol: seedSymbol })
          canonicalVerified = true
          exactInitialLocation = true
          unverifiedFallbackKeysRef.current.delete(requestedLocationKey)
          unverifiedFallbackKeysRef.current.delete(canonicalKey)
          navigationSnapshotRef.current = {
            key: canonicalKey,
            snapshotToken: canonical.snapshotToken!,
          }
        }
        if (canonical && locationKey(canonical) !== currentLocationKey) {
          return
        }
        if (!canonical) {
          updateCanonicalRetry({ key: requestedLocationKey, symbol: seedSymbol })
          exactInitialLocation = false
          unverifiedFallbackKeysRef.current.add(requestedLocationKey)
        }
      }
      setState("loading")
      const preloaded = preloadedSourceRef.current?.key === requestedLocationKey
        ? preloadedSourceRef.current
        : null
      if (preloaded) preloadedSourceRef.current = null
      const content = preloaded?.snapshot
        ?? await queueContentRead(client, keyedLocation.uri, isCurrentLoad)
      if (!isCurrentLoad()) return
      if (!content) return
      const navigationSnapshot = navigationSnapshotRef.current
      const expectedSnapshotToken = navigationSnapshot?.key === requestedLocationKey
        ? navigationSnapshot.snapshotToken
        : keyedLocation.snapshotToken
      if (expectedSnapshotToken && content.snapshotToken !== expectedSnapshotToken) {
        throw new BrowserLspError("stale", -32801)
      }
      if (navigationSnapshot?.key === requestedLocationKey) navigationSnapshotRef.current = null
      if (canonicalVerified && canonicalRetryRef.current?.key === requestedLocationKey) {
        updateCanonicalRetry(null)
      }
      if (!sourceIsRenderable(content.text)) {
        focusStatusAfterTerminalLoad(freshConnection)
        setLoadedSource(null)
        setState("render-limited")
        return
      }
      const model = createSourceModel(content.text)
      const initialPosition = exactInitialLocation
        ? initialTokenSelection(model, keyedLocation.range.start)
        : inactivePositionOnLine(model, keyedLocation.range.start.line)
      setActive(initialPosition ?? keyedLocation.range.start)
      setLoadedSource({ key: requestedLocationKey, generation, snapshot: content, model, actionable: exactInitialLocation })
      setState(content.text.length === 0 ? "empty" : "ready")
      if (content.text.length === 0) focusStatusAfterTerminalLoad(freshConnection)
      else if (freshConnection) focusAfterLoadRef.current = "source"
    } catch (error) {
      if (!isCurrentLoad()) return
      updateConnectionPermission("retry-required")
      focusStatusAfterTerminalLoad()
      setLoadedSource(null)
      if (error instanceof BrowserLspError) {
        setFailure({ key: requestedLocationKey, state: error.state, reason: error.reason })
        setState(error.state)
      } else {
        setFailure({ key: requestedLocationKey, state: "unavailable" })
        setState("unavailable")
      }
    }
  }, [currentLocationKey, factory, focusStatusAfterTerminalLoad, focusStatusIfViewerInteractionFocused, invalidateDefinition, keyedLocation, onCanonicalize, queueContentRead, repoId, resetInteractions, updateCanonicalRetry, updateConnectionPermission])

  React.useEffect(() => {
    void load(false)
    return () => {
      generationRef.current += 1
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
      queuedHoverRef.current = null
      hoverGenerationRef.current += 1
      abortHoverRequest()
    }
  }, [abortHoverRequest, load])

  React.useEffect(() => () => {
    clientEpochRef.current += 1
    definitionRequestRef.current += 1
    definitionInFlightRef.current = false
    disconnectCleanupRef.current?.()
    disconnectCleanupRef.current = null
    void clientRef.current?.close()
    clientRef.current = null
    clientRepoIdRef.current = null
    canonicalRetryRef.current = null
  }, [])

  React.useEffect(() => {
    const focusTarget = focusAfterLoadRef.current
    if (!focusTarget) return
    const target = focusTarget === "source" ? sourceRef.current : statusRef.current
    if (!target) return
    focusAfterLoadRef.current = null
    target.focus()
  }, [loadedGeneration, snapshot, state])

  React.useLayoutEffect(() => {
    const previous = activeTokenRef.current
    previous?.removeAttribute("id")
    previous?.removeAttribute("data-active")
    const next = activeTokenKey ? tokenElementsRef.current.get(activeTokenKey) ?? null : null
    if (next) {
      next.id = "codegraph-active-source-token"
      next.dataset.active = "true"
    }
    activeTokenRef.current = next
  }, [activeTokenKey, sourceModel])

  React.useEffect(() => {
    if (!snapshot || !scrollActiveAfterMoveRef.current) return
    scrollActiveAfterMoveRef.current = false
    activeTokenRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [active, snapshot])

  const flushHover = React.useCallback(() => {
    if (hoverInFlightRef.current || hoverTimerRef.current || !queuedHoverRef.current || !clientRef.current || !snapshot) return
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      const pending = queuedHoverRef.current
      queuedHoverRef.current = null
      if (!pending || pending.generation !== generationRef.current || pending.hoverGeneration !== hoverGenerationRef.current) {
        flushHoverRef.current()
        return
      }
      const client = clientRef.current
      if (!client) return
      const controller = new AbortController()
      hoverAbortRef.current = controller
      hoverInFlightRef.current = true
      void client.hover(pending.uri, pending.position, pending.snapshotToken, controller.signal).then((result) => {
        if (pending.generation !== generationRef.current
          || pending.hoverGeneration !== hoverGenerationRef.current
          || pending.locationKey !== locationKeyRef.current) return
        setHover(result ? { tokenKey: pending.tokenKey, result } : null)
        if (pending.announce) setInteractionStatus(result ? "Hover details are available." : "No hover details are available at the active token.")
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (pending.generation === generationRef.current
          && pending.hoverGeneration === hoverGenerationRef.current) {
          if (!handleInteractionError(error, pending.locationKey)) {
            setHover(null)
            if (pending.announce) setInteractionStatus("Hover details are unavailable.")
          }
        }
      }).finally(() => {
        if (hoverAbortRef.current === controller) hoverAbortRef.current = null
        hoverInFlightRef.current = false
        flushHoverRef.current()
      })
    }, 150)
  }, [handleInteractionError, snapshot])

  React.useEffect(() => {
    flushHoverRef.current = flushHover
    flushHover()
  }, [flushHover])

  const cancelHover = React.useCallback(() => {
    hoverGenerationRef.current += 1
    abortHoverRequest()
    queuedHoverRef.current = null
    hoverAfterMoveRef.current = null
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
    setHover(null)
  }, [abortHoverRequest])

  const requestHover = React.useCallback((position: LspPosition, announce = true) => {
    if (!sourceActionsEnabled || !clientRef.current || !snapshot || !sourceModel) return
    const token = tokenAt(sourceModel, position)
    if (!token) return
    abortHoverRequest()
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
    queuedHoverRef.current = {
      uri: location.uri,
      position,
      tokenKey: sourceTokenKey(position.line, token.start),
      snapshotToken: snapshot.snapshotToken,
      locationKey: locationKeyRef.current,
      generation: generationRef.current,
      hoverGeneration: ++hoverGenerationRef.current,
      announce,
    }
    setHover(null)
    flushHoverRef.current()
  }, [abortHoverRequest, location.uri, snapshot, sourceActionsEnabled, sourceModel])

  React.useEffect(() => {
    const pending = hoverAfterMoveRef.current
    if (!pending || !samePosition(active, pending)) return
    hoverAfterMoveRef.current = null
    if (document.activeElement === sourceRef.current) requestHover(pending)
  }, [active, requestHover])

  React.useEffect(() => {
    const client = clientRef.current
    if (!client || !snapshot || !sourceModel || !activeToken || !activeTokenKey) return
    const request = ++referencesRequestRef.current
    const generation = generationRef.current
    const clientEpoch = clientEpochRef.current
    const requestedLocationKey = locationKeyRef.current
    const position = { line: active.line, character: activeToken.start }
    setReferenceResult(null)
    const queued = referencesQueueRef.current.then(async () => {
      if (request !== referencesRequestRef.current
        || generation !== generationRef.current
        || clientEpoch !== clientEpochRef.current
        || requestedLocationKey !== locationKeyRef.current) return
      try {
        const locations = await client.references(location.uri, position, snapshot.snapshotToken)
        if (request !== referencesRequestRef.current
          || generation !== generationRef.current
          || clientEpoch !== clientEpochRef.current
          || requestedLocationKey !== locationKeyRef.current) return
        setReferenceResult({ tokenKey: activeTokenKey, locations })
      } catch (error) {
        if (request !== referencesRequestRef.current
          || generation !== generationRef.current
          || clientEpoch !== clientEpochRef.current
          || requestedLocationKey !== locationKeyRef.current) return
        if (!handleInteractionError(error, requestedLocationKey)) setInteractionStatus("References are unavailable.")
      }
    })
    referencesQueueRef.current = queued
    return () => {
      if (request === referencesRequestRef.current) referencesRequestRef.current += 1
    }
  }, [active.line, activeToken, activeTokenKey, handleInteractionError, location.uri, snapshot, sourceModel])

  const navigateToLocation = React.useCallback(async (target: LspLocation): Promise<void> => {
    const navigationRequest = ++navigationRequestRef.current
    if (locationKey(target) === locationKeyRef.current) {
      if (target.snapshotToken && snapshot && target.snapshotToken !== snapshot.snapshotToken) {
        setInteractionStatus("Source changed before navigation. Try the request again.")
        return
      }
      if (sourceModel) {
        if (target.snapshotToken) {
          unverifiedFallbackKeysRef.current.delete(locationKey(target))
          setLoadedSource((current) => current?.key === locationKeyRef.current
            ? { ...current, actionable: true }
            : current)
        }
        const nextActive = initialTokenSelection(sourceModel, target.range.start) ?? target.range.start
        cancelHover()
        hoverAfterMoveRef.current = tokenAt(sourceModel, nextActive) ? nextActive : null
        scrollActiveAfterMoveRef.current = true
        setActive(nextActive)
      }
      focusAfterLoadRef.current = null
      sourceRef.current?.focus()
      return
    }
    if (!target.snapshotToken) {
      setInteractionStatus("An exact source snapshot is unavailable for navigation.")
      return
    }
    const client = clientRef.current
    if (!client) return
    const generation = generationRef.current
    const clientEpoch = clientEpochRef.current
    const requestedLocationKey = locationKeyRef.current
    const targetKey = locationKey(target)
    focusAfterLoadRef.current = "source"
    const isCurrentNavigation = () => (
      generation === generationRef.current
      && clientEpoch === clientEpochRef.current
      && navigationRequest === navigationRequestRef.current
      && requestedLocationKey === locationKeyRef.current
      && client === clientRef.current
    )
    try {
      const targetSnapshot = await queueContentRead(client, target.uri, isCurrentNavigation)
      if (!targetSnapshot || !isCurrentNavigation()) return
      if (targetSnapshot.snapshotToken !== target.snapshotToken) {
        focusAfterLoadRef.current = null
        setInteractionStatus("Source changed before navigation. Try the request again.")
        return
      }
      unverifiedFallbackKeysRef.current.delete(targetKey)
      preloadedSourceRef.current = { key: targetKey, snapshot: targetSnapshot }
    } catch (error) {
      if (!isCurrentNavigation()) return
      focusAfterLoadRef.current = null
      sourceRef.current?.focus()
      setInteractionStatus(error instanceof BrowserLspError && error.state === "stale"
        ? "Source changed before navigation. Try the request again."
        : "Source navigation is unavailable.")
      return
    }
    navigationSnapshotRef.current = {
      key: targetKey,
      snapshotToken: target.snapshotToken,
    }
    onNavigate(target)
  }, [cancelHover, onNavigate, queueContentRead, snapshot, sourceModel])

  const goToDefinition = React.useCallback(async (position: LspPosition) => {
    const client = clientRef.current
    if (!sourceActionsEnabled || !client || !snapshot || !sourceModel || !tokenAt(sourceModel, position) || definitionInFlightRef.current) return
    const generation = generationRef.current
    const clientEpoch = clientEpochRef.current
    const requestedLocationKey = locationKeyRef.current
    const request = ++definitionRequestRef.current
    definitionInFlightRef.current = true
    setDefinitionInFlight(true)
    try {
      const target = await client.definition(location.uri, position, snapshot.snapshotToken)
      if (request !== definitionRequestRef.current
        || generation !== generationRef.current
        || clientEpoch !== clientEpochRef.current
        || requestedLocationKey !== locationKeyRef.current) return
      if (target) {
        setInteractionStatus("Definition found.")
        await navigateToLocation(target)
      } else setInteractionStatus("No exact definition is available at the active token.")
    } catch (error) {
      if (request !== definitionRequestRef.current
        || generation !== generationRef.current
        || clientEpoch !== clientEpochRef.current
        || requestedLocationKey !== locationKeyRef.current) return
      if (!handleInteractionError(error, requestedLocationKey)) setInteractionStatus("Definition is unavailable.")
    } finally {
      if (request === definitionRequestRef.current) {
        definitionInFlightRef.current = false
        setDefinitionInFlight(false)
      }
    }
  }, [handleInteractionError, location.uri, navigateToLocation, snapshot, sourceActionsEnabled, sourceModel])

  const activate = React.useCallback((position: LspPosition, showHover = false) => {
    if (!sourceActionsEnabled) return
    setActive((current) => samePosition(current, position) ? current : position)
    if (showHover) requestHover(position, false)
    else {
      cancelHover()
      setInteractionStatus("")
    }
  }, [cancelHover, requestHover, sourceActionsEnabled])

  const activateDefinition = React.useCallback((position: LspPosition) => {
    void goToDefinition(position)
  }, [goToDefinition])

  const onSourceKeyDown = (event: React.KeyboardEvent<HTMLPreElement>) => {
    if (!sourceModel) return
    if (event.key === "Escape") {
      cancelHover()
      return
    }
    if (!sourceActionsEnabled) return
    if (event.key === "Enter") {
      event.preventDefault()
      void goToDefinition(active)
      return
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault()
      const delta = event.key === "ArrowLeft" ? -1 : 1
      scrollActiveAfterMoveRef.current = true
      activate(moveHorizontal(sourceModel, active, delta))
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault()
      const delta = event.key === "ArrowUp" ? -1 : 1
      scrollActiveAfterMoveRef.current = true
      activate(moveVertical(sourceModel, active, delta))
    }
  }

  const retry = React.useCallback(async () => {
    if (retrying) return
    const requestedLocationKey = currentLocationKey
    setRetryingKey(requestedLocationKey)
    try {
      await load(true)
    } finally {
      if (mountedRef.current) {
        setRetryingKey((current) => current === requestedLocationKey ? null : current)
      }
    }
  }, [currentLocationKey, load, retrying])

  const groupedReferences = React.useMemo(() => groupReferences(
    root,
    snapshot && referenceResult?.tokenKey === activeTokenKey ? referenceResult.locations : [],
  ), [activeTokenKey, referenceResult, root, snapshot])
  const path = relativePathFromFileUri(root, location.uri) ?? "Indexed source"
  const currentFailure = failure?.key === currentLocationKey ? failure : null
  const effectiveState: ViewerState = currentFailure
    ? currentFailure.state
    : connectionPermission === "retry-required" && failure
      ? "retry-required"
      : state
  const renderedState = loadedSource && !snapshot ? "loading" : effectiveState
  const canonicalRetryPending = canonicalRetryKey === currentLocationKey
  const message = stateMessage(renderedState, currentFailure?.reason)
  const visibleHover = snapshot && hover?.tokenKey === activeTokenKey ? hover.result : null

  return (
    <Card onKeyDown={(event) => {
      const hoverPending = Boolean(queuedHoverRef.current || hoverTimerRef.current || hoverInFlightRef.current)
      if (event.key !== "Escape" || (!visibleHover && !hoverPending)) return
      event.stopPropagation()
      cancelHover()
    }}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Source</CardTitle>
            <CardDescription>{path}</CardDescription>
          </div>
          <Button variant="outline" onClick={onClose}>Close source</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button ref={hoverActionRef} variant="outline" onClick={() => requestHover(active)} disabled={!activeToken}>Show hover details</Button>
          <Button ref={definitionActionRef} aria-busy={definitionInFlight} variant="outline" onClick={() => void goToDefinition(active)} disabled={!activeToken || definitionInFlight}>Go to definition</Button>
          {retrying || canonicalRetryPending || isRetryable(renderedState) ? <Button aria-busy={retrying} disabled={retrying} onClick={() => void retry()}>Retry source</Button> : null}
        </div>
      </CardHeader>
      <CardContent
        ref={sourceContentRef}
        className="flex min-w-0 flex-col gap-3"
        onFocusCapture={() => setSourceContentFocused(true)}
        onBlurCapture={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
            setSourceContentFocused(false)
          }
        }}
      >
        <p className="sr-only" aria-live="polite">{interactionStatus || message}</p>
        {snapshot && snapshot.text.length > 0 ? (
          <pre
            ref={sourceRef}
            role="textbox"
            aria-label={`Read-only source for ${path}`}
            aria-readonly="true"
            aria-activedescendant={activeToken ? "codegraph-active-source-token" : undefined}
            aria-describedby={visibleHover ? "codegraph-source-hover" : undefined}
            tabIndex={0}
            onFocus={() => !hoverAfterMoveRef.current && activeToken && requestHover(active)}
            onKeyDown={onSourceKeyDown}
            className="max-h-[32rem] min-w-0 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:scroll-auto"
          >
            <SourceText
              model={sourceModel!}
              registerToken={registerSourceToken}
              onActivate={activate}
              onActivateDefinition={activateDefinition}
            />
          </pre>
        ) : (
          <div ref={statusRef} role={isRetryable(renderedState) ? "alert" : "status"} tabIndex={-1} className="rounded-lg border p-3 text-sm">{message}</div>
        )}
        {snapshot && snapshot.text.length > 0 && !activeToken ? <p role="status" className="text-sm text-muted-foreground">No source token is available on this line.</p> : null}
        {visibleHover ? (
          <div id="codegraph-source-hover" aria-label="Hover details" className="rounded-lg border bg-popover p-3 text-sm" onKeyDown={(event) => event.key === "Escape" && cancelHover()}>
            {visibleHover.contents.value}
          </div>
        ) : null}
        {groupedReferences.length > 0 ? (
          <section aria-label="References" className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">References</h3>
            {groupedReferences.map((group) => (
              <div key={group.path}>
                <h4 className="text-xs font-normal text-muted-foreground">{group.path} ({group.locations.length})</h4>
                <div className="flex flex-wrap gap-1">
                  {group.locations.map((reference) => (
                    <Button
                      key={locationKey(reference)}
                      variant="ghost"
                      size="sm"
                      aria-label={`Open ${group.path} line ${reference.range.start.line + 1} column ${reference.range.start.character + 1}`}
                      onClick={() => void navigateToLocation(reference)}
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
  const normalizedRoot = normalizeRootPath(root)
  const normalizedRelative = normalizeSeparatorsForRoot(root, relativePath)
  if (/^[A-Za-z]:\//.test(normalizedRoot)) {
    const drive = normalizedRoot.slice(0, 2)
    const rootTail = normalizedRoot.slice(3)
    const combined = rootTail ? `${rootTail}/${normalizedRelative}` : normalizedRelative
    return `file:///${drive}/${encodeFileUriPath(combined)}`
  }
  if (normalizedRoot.startsWith("//")) {
    const uncPath = normalizedRoot.slice(2)
    const separator = uncPath.indexOf("/")
    const host = separator === -1 ? uncPath : uncPath.slice(0, separator)
    const rootTail = separator === -1 ? "" : uncPath.slice(separator + 1)
    const combined = rootTail ? `${rootTail}/${normalizedRelative}` : normalizedRelative
    return `file://${host}/${encodeFileUriPath(combined)}`
  }
  const rootTail = normalizedRoot.replace(/^\/+/, "")
  const combined = rootTail ? `${rootTail}/${normalizedRelative}` : normalizedRelative
  return `file:///${encodeFileUriPath(combined)}`
}

function encodeFileUriPath(value: string): string {
  return value.replace(/[^/]+/g, (segment) => encodeURIComponent(segment))
}

export function relativePathFromFileUri(root: string, uri: string): string | null {
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== "file:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null
    const normalizedRoot = normalizeRootPath(root)
    const windowsRoot = /^[A-Za-z]:\//.test(normalizedRoot) || normalizedRoot.startsWith("//")
    if (/%2f/i.test(parsed.pathname) || (windowsRoot && /%5c/i.test(parsed.pathname))) return null
    const decoded = normalizeSeparatorsForRoot(root, decodeURIComponent(parsed.pathname))
    const expectedUncHost = normalizedRoot.startsWith("//") ? normalizedRoot.slice(2).split("/")[0] ?? "" : ""
    const parsedUncHost = decodeURIComponent(parsed.hostname)
    if (expectedUncHost) {
      const hostMatches = parsedUncHost
        ? parsedUncHost.toLowerCase() === expectedUncHost.toLowerCase()
        : expectedUncHost.toLowerCase() === "localhost"
      if (!hostMatches) return null
    } else if (parsedUncHost) {
      return null
    }
    const path = /^[A-Za-z]:\//.test(normalizedRoot) && /^\/[A-Za-z]:\//.test(decoded)
      ? decoded.slice(1)
      : normalizedRoot.startsWith("//")
        ? `//${expectedUncHost}${decoded}`
        : decoded
    const caseInsensitive = /^[A-Za-z]:\//.test(normalizedRoot) || normalizedRoot.startsWith("//")
    const comparablePath = caseInsensitive ? path.toLowerCase() : path
    const comparableRoot = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot
    if (comparablePath === comparableRoot) return null
    const prefix = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`
    const comparablePrefix = caseInsensitive ? prefix.toLowerCase() : prefix
    if (!comparablePath.startsWith(comparablePrefix)) return null
    const relative = path.slice(prefix.length)
    const normalizedRelative = normalizeSeparatorsForRoot(root, relative)
    if (normalizedRelative.includes("\0") || /(?:^|\/)(?:\.{1,2})(?:\/|$)/.test(normalizedRelative)) return null
    const canonicalHref = new URL(fileUriForPath(root, relative)).href
    const hrefMatches = caseInsensitive
      ? canonicalHref.toLowerCase() === parsed.href.toLowerCase()
      : canonicalHref === parsed.href
    return hrefMatches ? relative : null
  } catch {
    return null
  }
}

const SourceText = React.memo(function SourceText({
  model,
  registerToken,
  onActivate,
  onActivateDefinition,
}: {
  model: SourceModel
  registerToken(key: string, element: HTMLElement | null): void
  onActivate(position: LspPosition, showHover?: boolean): void
  onActivateDefinition(position: LspPosition): void
}) {
  return model.lines.map((line, lineIndex) => (
    <SourceLine
      key={lineIndex}
      parts={line.parts}
      lineIndex={lineIndex}
      trailingNewline={lineIndex < model.lines.length - 1}
      registerToken={registerToken}
      onActivate={onActivate}
      onActivateDefinition={onActivateDefinition}
    />
  ))
})

interface SourceToken { text: string; start: number; end: number; kind: "identifier" | "punctuation" }
type SourcePart = string | SourceToken
interface SourceLineModel { text: string; parts: SourcePart[]; tokens: SourceToken[] }
interface SourceModel { lines: SourceLineModel[] }

const SourceLine = React.memo(function SourceLine({
  parts,
  lineIndex,
  trailingNewline,
  registerToken,
  onActivate,
  onActivateDefinition,
}: {
  parts: SourcePart[]
  lineIndex: number
  trailingNewline: boolean
  registerToken(key: string, element: HTMLElement | null): void
  onActivate(position: LspPosition, showHover?: boolean): void
  onActivateDefinition(position: LspPosition): void
}) {
  return (
    <>
      {parts.map((part, partIndex) => {
        if (typeof part === "string") return <React.Fragment key={partIndex}>{part}</React.Fragment>
        const position = { line: lineIndex, character: part.start }
        const token = (
          <span
            key={partIndex}
            ref={(element) => registerToken(sourceTokenKey(lineIndex, part.start), element)}
            className="data-[active=true]:bg-yellow-200 data-[active=true]:text-black dark:data-[active=true]:bg-yellow-500/60"
            onPointerEnter={() => onActivate(position, true)}
            onDoubleClick={() => { onActivate(position); onActivateDefinition(position) }}
          >
            {part.text}
          </span>
        )
        return token
      })}
      {trailingNewline ? "\n" : null}
    </>
  )
})

function tokenizeLine(line: string): SourcePart[] {
  const parts: SourcePart[] = []
  const tokens = line.matchAll(SOURCE_TOKEN_PATTERN)
  let offset = 0
  for (const token of tokens) {
    const start = token.index
    if (start > offset) parts.push(line.slice(offset, start))
    const text = token[0]
    parts.push({
      text,
      start,
      end: start + text.length,
      kind: /^[\p{L}_$]/u.test(text) ? "identifier" : "punctuation",
    })
    offset = start + text.length
  }
  if (offset < line.length || parts.length === 0) parts.push(line.slice(offset))
  return parts
}

function createSourceModel(text: string): SourceModel {
  return {
    lines: sourceLines(text).map((line) => {
      const parts = tokenizeLine(line)
      return {
        text: line,
        parts,
        tokens: parts.filter((part): part is SourceToken => typeof part !== "string"),
      }
    }),
  }
}

function sourceIsRenderable(text: string): boolean {
  if (new TextEncoder().encode(text).byteLength > MAX_RENDERED_SOURCE_BYTES) return false
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n" && text[index] !== "\r") continue
    if (text[index] === "\r" && text[index + 1] === "\n") index += 1
    if (++lines > MAX_RENDERED_SOURCE_LINES) return false
  }
  let tokens = 0
  for (const token of text.matchAll(SOURCE_TOKEN_PATTERN)) {
    if (token[0].length > 0 && ++tokens > MAX_RENDERED_SOURCE_TOKENS) return false
  }
  return true
}

function sourceLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/)
}

function tokenAt(model: SourceModel, position: LspPosition): SourceToken | null {
  return model.lines[position.line]?.tokens.find((token) => (
    position.character >= token.start && position.character < token.end
  )) ?? null
}

function initialTokenSelection(
  model: SourceModel,
  position: LspPosition,
): LspPosition | null {
  const line = model.lines[position.line]
  if (line === undefined) return null
  if (tokenAt(model, position)) return position
  return positionOnLine(model.lines, position, position.line)
}

function inactivePositionOnLine(model: SourceModel, lineIndex: number): LspPosition | null {
  const line = model.lines[lineIndex]
  return line ? { line: lineIndex, character: line.text.length } : null
}

function moveHorizontal(model: SourceModel, position: LspPosition, delta: -1 | 1): LspPosition {
  const line = model.lines[position.line]
  if (!line) return position
  const character = clamp(position.character + delta, 0, line.text.length)
  if (tokenAt(model, { line: position.line, character })) return { line: position.line, character }
  const tokens = line.tokens
  const next = delta > 0
    ? tokens.find((token) => token.start >= character)
    : [...tokens].reverse().find((token) => token.end - 1 <= character)
  return next ? { line: position.line, character: delta > 0 ? next.start : next.end - 1 } : position
}

function positionOnLine(
  lines: readonly SourceLineModel[],
  position: LspPosition,
  lineIndex: number,
  preferredKind?: SourceToken["kind"],
): LspPosition | null {
  const line = lines[lineIndex]
  if (line === undefined) return null
  const preferredTokens = preferredKind ? line.tokens.filter((token) => token.kind === preferredKind) : []
  const tokens = preferredTokens.length > 0 ? preferredTokens : line.tokens
  if (tokens.length === 0) return null
  const character = clamp(position.character, 0, line.text.length)
  const containing = tokens.find((token) => character >= token.start && character < token.end)
  if (containing) return { line: lineIndex, character }
  const nearest = tokens.reduce((best, token) => (
    Math.abs(token.start - character) < Math.abs(best.start - character) ? token : best
  ))
  return { line: lineIndex, character: nearest.start }
}

function moveVertical(model: SourceModel, position: LspPosition, delta: -1 | 1): LspPosition {
  const preferredKind = tokenAt(model, position)?.kind
  for (let line = position.line + delta; line >= 0 && line < model.lines.length; line += delta) {
    const next = positionOnLine(model.lines, position, line, preferredKind)
    if (next) return next
  }
  return position
}

function sourceTokenKey(line: number, start: number): string {
  return `${line}:${start}`
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

function contentBeforeDeadline(
  client: BrowserLspApi,
  uri: string,
  deadlineAt: number,
): Promise<SourceSnapshot> {
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) return Promise.reject(new BrowserLspError("timed-out", -32803, "timeout"))
  return new Promise<SourceSnapshot>((resolve, reject) => {
    let settled = false
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      operation()
    }
    const timer = setTimeout(() => {
      finish(() => reject(new BrowserLspError("timed-out", -32803, "timeout")))
    }, remaining)
    void client.content(uri).then(
      (snapshot) => finish(() => resolve(snapshot)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

function isLocalPressureError(error: unknown): boolean {
  return error instanceof BrowserLspError
    && error.state === "unavailable"
    && (error.reason === "busy" || error.reason === "backpressure")
}

function stateMessage(state: ViewerState, reason?: string): string {
  switch (state) {
    case "connecting": return "Connecting to source intelligence."
    case "loading": return "Loading verified indexed source."
    case "ready": return "Verified indexed source is ready."
    case "empty": return "The verified indexed source file is empty."
    case "render-limited": return "The verified indexed source is too large to render safely in the browser."
    case "stale": return "Source changed since it was indexed. Re-index, then retry."
    case "timed-out": return "Source intelligence timed out. Retry when ready."
    case "disconnected": return "Source intelligence disconnected. Retry to reconnect."
    case "retry-required": return "Retry source to load this location."
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
  return state === "stale" || state === "timed-out" || state === "unavailable" || state === "disconnected" || state === "retry-required"
}

function locationKey(location: LspLocation): string {
  return `${location.uri}:${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`
}

function samePosition(left: LspPosition, right: LspPosition): boolean {
  return left.line === right.line && left.character === right.character
}

function normalizeRootPath(root: string): string {
  const normalized = normalizeSeparatorsForRoot(root, root)
  if (/^[A-Za-z]:\/+$/u.test(normalized)) return `${normalized.slice(0, 2)}/`
  if (normalized === "/") return normalized
  return normalized.replace(/\/+$/u, "")
}

function normalizeSeparatorsForRoot(root: string, value: string): string {
  return isWindowsRepositoryRoot(root) ? value.replaceAll("\\", "/") : value
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
