import * as React from "react"
import { SendIcon } from "lucide-react"

import { useAppState } from "@/app/state"
import { ChatContextBoundary } from "@/components/chat/ChatContextBoundary"
import { StatePanel } from "@/components/layout/StatePanel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { errorState } from "@/lib/api/client"
import { getChatStatus, sendChatMessage } from "@/lib/api/chat"
import type { ChatResponse, ChatStatus } from "@/lib/api/types"

export function ChatPanel({ view = "repository" }: { view?: string }) {
  const { selectedRepo, selectedNode } = useAppState()
  const [status, setStatus] = React.useState<ChatStatus | null>(null)
  const [message, setMessage] = React.useState("")
  const [response, setResponse] = React.useState<ChatResponse | null>(null)
  const [error, setError] = React.useState<string | undefined>()
  const disabled = !status || status.state !== "enabled"

  React.useEffect(() => {
    let cancelled = false
    setStatus(null)
    setResponse(null)
    setError(undefined)
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

  async function submit() {
    if (!message.trim()) return
    try {
      const next = await sendChatMessage({
        repo: selectedRepo?.id,
        selectedNodeId: selectedNode?.id,
        view,
        message,
      })
      setResponse(next)
      setError(undefined)
    } catch (caught) {
      setError(errorState(caught).message)
    }
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
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}
