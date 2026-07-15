import { Link } from "react-router-dom"
import { BotIcon, RefreshCcwIcon, SearchIcon } from "lucide-react"

import { useAppState } from "@/app/state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const ACTIONS = [
  { to: "/search", label: "Search symbols", icon: SearchIcon },
  { to: "/reindex", label: "Re-analyze", icon: RefreshCcwIcon },
  { to: "/chat", label: "Ask with context", icon: BotIcon },
]

export function RepositoryOverview() {
  const { selectedRepo, repositoryStatus, repositoryState } = useAppState()

  return (
    <div className="flex flex-col gap-4 p-4">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Repository overview</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {selectedRepo ? selectedRepo.root : "Connect to a local CodeGraph repository to inspect symbols and graph context."}
        </p>
      </section>
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Index</CardTitle>
            <CardDescription>{repositoryState}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {repositoryStatus
              ? `${repositoryStatus.index.nodeCount.toLocaleString()} symbols and ${repositoryStatus.index.edgeCount.toLocaleString()} edges`
              : "Status is not available yet."}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Search</CardTitle>
            <CardDescription>Open symbols and source context.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button nativeButton={false} render={<Link to="/search" />}>
              <SearchIcon data-icon="inline-start" />
              Start search
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Graph</CardTitle>
            <CardDescription>Explore neighborhoods after selecting a symbol.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {ACTIONS.map((action) => (
              <Button key={action.to} variant="outline" size="sm" nativeButton={false} render={<Link to={action.to} />}>
                <action.icon data-icon="inline-start" />
                {action.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
