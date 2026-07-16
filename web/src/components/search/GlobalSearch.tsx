import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { SearchIcon } from "lucide-react"

import { useAppState } from "@/app/state"
import { StatePanel } from "@/components/layout/StatePanel"
import { Toolbar } from "@/components/layout/Toolbar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { errorState } from "@/lib/api/client"
import { searchSymbols } from "@/lib/api/search"
import type { CodeNode, SearchResult } from "@/lib/api/types"
import { mark, measure } from "@/lib/perf/marks"

export function GlobalSearch() {
  const { selectedRepo, selectNode } = useAppState()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = React.useState(searchParams.get("q") ?? "")
  const [result, setResult] = React.useState<SearchResult | null>(null)
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">("idle")
  const [message, setMessage] = React.useState("Enter a query to search symbols.")
  const [durationMs, setDurationMs] = React.useState<number | null>(null)
  const requestId = React.useRef(0)
  const selectedRepoId = selectedRepo?.id
  const urlQuery = searchParams.get("q") ?? ""

  const runSearch = React.useCallback(async (nextQuery: string) => {
    const currentRequest = ++requestId.current
    const trimmedQuery = nextQuery.trim()
    if (!trimmedQuery) {
      setResult(null)
      setMessage("Enter a query to search symbols.")
      return
    }
    setStatus("loading")
    mark("search-request")
    try {
      const next = await searchSymbols({ query: trimmedQuery, repoId: selectedRepoId, mode: "auto", limit: 50 })
      if (currentRequest !== requestId.current) return
      mark("search-render")
      setDurationMs(measure("search-response-render", "search-request", "search-render"))
      setResult(next)
      setStatus("idle")
      setMessage(next.total === 0 ? "No symbols matched the query." : `${next.total.toLocaleString()} symbols matched.`)
    } catch (error) {
      if (currentRequest !== requestId.current) return
      const nextError = errorState(error)
      setResult(null)
      setStatus("error")
      setMessage(nextError.message)
    }
  }, [selectedRepoId])

  React.useEffect(() => {
    setQuery(urlQuery)
    if (urlQuery) {
      void runSearch(urlQuery)
    } else {
      requestId.current += 1
      setResult(null)
      setStatus("idle")
      setMessage("Enter a query to search symbols.")
      setDurationMs(null)
    }
  }, [runSearch, urlQuery])

  function openNode(node: CodeNode) {
    selectNode(node)
    navigate(`/symbol/${encodeURIComponent(node.id)}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!query.trim()) {
              setSearchParams({})
            } else if (query.trim() === urlQuery.trim()) {
              void runSearch(query)
            } else {
              setSearchParams({ q: query })
            }
          }}
        >
          <Input
            aria-label="Search symbols"
            className="min-w-0 flex-1"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search symbols, files, routes, or functions"
          />
          <Button type="submit" disabled={status === "loading"}>
            <SearchIcon data-icon="inline-start" />
            Search
          </Button>
        </form>
      </Toolbar>
      <div aria-live="polite" className="px-4 text-sm text-muted-foreground">
        {message}
        {durationMs !== null ? ` Render evidence: ${Math.round(durationMs)} ms.` : ""}
      </div>
      {status === "loading" ? <StatePanel kind="loading" title="Searching">Waiting for the local API response.</StatePanel> : null}
      {status === "error" ? <StatePanel kind="error" title="Search unavailable">{message}</StatePanel> : null}
      {result?.degraded ? (
        <div className="px-4">
          <StatePanel kind="degraded" title="Search degraded">
            {result.degradationReason ?? "Semantic search fell back to keyword results."}
          </StatePanel>
        </div>
      ) : null}
      {result && result.items.length > 0 ? (
        <div className="px-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="w-28">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((node) => (
                <TableRow key={node.id}>
                  <TableCell className="font-medium">{node.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{node.kind}</Badge>
                  </TableCell>
                  <TableCell className="max-w-md truncate">{node.file ?? "Unknown file"}</TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => openNode(node)}>
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  )
}
