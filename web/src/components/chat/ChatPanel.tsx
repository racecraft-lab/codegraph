import * as React from "react"
import { RefreshCcwIcon, SendIcon } from "lucide-react"

import { useAppState } from "@/app/state"
import { ChatContextBoundary } from "@/components/chat/ChatContextBoundary"
import { StatePanel } from "@/components/layout/StatePanel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { errorState } from "@/lib/api/client"
import { getChatStatus, redeemChatBundle, sendChatMessage } from "@/lib/api/chat"
import type { ChatResponse, ChatStatus } from "@/lib/api/types"

const BUNDLE_REDEEM_ATTEMPTS = 30
const BUNDLE_REDEEM_DELAY_MS = 2_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function ChatPanel({ view = "repository" }: { view?: string }) {
  const { selectedRepo, selectedNode } = useAppState()
  const [status, setStatus] = React.useState<ChatStatus | null>(null)
  const [message, setMessage] = React.useState("")
  const [response, setResponse] = React.useState<ChatResponse | null>(null)
  const [error, setError] = React.useState<string | undefined>()
  const [submitting, setSubmitting] = React.useState(false)
  const [redeeming, setRedeeming] = React.useState(false)
  const requestRef = React.useRef(0)
  const activeRepoRef = React.useRef<string | undefined>(undefined)
  const submittingRef = React.useRef(false)
  const redeemingRequestRef = React.useRef<number | null>(null)
  const disabled = !status || status.state !== "enabled" || submitting

  React.useEffect(() => {
    activeRepoRef.current = selectedRepo?.id
  }, [selectedRepo?.id])

  const isCurrentRequest = React.useCallback((repoId: string | undefined, requestId: number) => {
    return requestRef.current === requestId && activeRepoRef.current === repoId
  }, [])

  const redeemBundle = React.useCallback(async (handle: string, repoId: string | undefined, requestId: number) => {
    if (redeemingRequestRef.current === requestId) return
    redeemingRequestRef.current = requestId
    setRedeeming(true)
    let currentHandle: string | undefined = handle
    try {
      for (let attempt = 0; currentHandle && attempt < BUNDLE_REDEEM_ATTEMPTS; attempt += 1) {
        if (attempt > 0) await delay(BUNDLE_REDEEM_DELAY_MS)
        if (!isCurrentRequest(repoId, requestId)) return
        try {
          const next = await redeemChatBundle(currentHandle, repoId)
          if (!isCurrentRequest(repoId, requestId)) return
          setResponse((current) => {
            const context = next.context ?? (current && current.bundleHandle === currentHandle ? current.context : undefined)
            return context ? { ...next, context } : next
          })
          setError(undefined)
          if (next.state !== "pending_bundle" || !next.bundleHandle) return
          currentHandle = next.bundleHandle
        } catch (caught) {
          if (isCurrentRequest(repoId, requestId)) setError(errorState(caught).message)
          return
        }
      }
    } finally {
      if (redeemingRequestRef.current === requestId) {
        redeemingRequestRef.current = null
        setRedeeming(false)
      }
    }
  }, [isCurrentRequest])

  React.useEffect(() => {
    let cancelled = false
    requestRef.current += 1
    setStatus(null)
    setResponse(null)
    setError(undefined)
    setSubmitting(false)
    setRedeeming(false)
    submittingRef.current = false
    redeemingRequestRef.current = null
    async function load() {
      try {
        const next = await getChatStatus(selectedRepo?.id)
        if (!cancelled) {
          setStatus(next)
          setError(undefined)
        }
      } catch (caught) {
        if (!cancelled) setError(errorState(caught).message)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [selectedRepo?.id, selectedNode?.id, view])

  React.useEffect(() => {
    return () => {
      requestRef.current += 1
    }
  }, [])

  async function submit() {
    if (!message.trim() || submittingRef.current) return
    const repoId = selectedRepo?.id
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    submittingRef.current = true
    setSubmitting(true)
    try {
      const initial = await sendChatMessage({
        repo: repoId,
        selectedNodeId: selectedNode?.id,
        view,
        message,
      })
      if (!isCurrentRequest(repoId, requestId)) return
      setResponse(initial)
      setError(undefined)
      if (initial.state === "pending_bundle" && initial.bundleHandle) {
        void redeemBundle(initial.bundleHandle, repoId, requestId)
      }
    } catch (caught) {
      if (isCurrentRequest(repoId, requestId)) setError(errorState(caught).message)
    } finally {
      if (requestRef.current === requestId) {
        submittingRef.current = false
        setSubmitting(false)
      }
    }
  }

  function retryBundle() {
    if (!response?.bundleHandle) return
    void redeemBundle(response.bundleHandle, selectedRepo?.id, requestRef.current)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Graph chat</CardTitle>
        <CardDescription>No provider secrets are exposed to the browser; messages go to the same-origin backend.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ChatContextBoundary view={view} />
        {error ? <StatePanel kind="error" title="Chat unavailable">{error}</StatePanel> : null}
        {status && status.state !== "enabled" ? (
          <StatePanel kind="degraded" title={`Chat ${status.state}`}>{status.message}</StatePanel>
        ) : null}
        <Textarea
          aria-label="Chat message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask about this repository, symbol, graph, or impact radius"
        />
        <Button disabled={disabled || !message.trim()} onClick={() => void submit()}>
          <SendIcon data-icon="inline-start" />
          Ask
        </Button>
        {response ? (
          <section className="rounded-lg border p-3" aria-live="polite">
            <h2 className="text-sm font-semibold">{response.state}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{response.answer ?? response.message ?? response.bundleHandle ?? "No answer content returned."}</p>
            {response.context ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Context: {response.context.symbols.length ? `${response.context.symbols.length} symbols` : response.context.insufficiencyReason ?? response.context.repo.name}
                {response.context.files.length ? ` across ${response.context.files.length} files` : ""}
                {response.context.truncated ? " (truncated)" : ""}
              </p>
            ) : null}
            {response.state === "pending_bundle" && response.bundleHandle ? (
              <Button className="mt-3" variant="outline" size="sm" disabled={redeeming} onClick={retryBundle}>
                <RefreshCcwIcon data-icon="inline-start" />
                Check bundle
              </Button>
            ) : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}
