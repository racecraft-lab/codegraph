import { GlobalSearch } from "@/components/search/GlobalSearch"

export function SearchRoute() {
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="px-4">
        <h1 className="text-2xl font-semibold">Search symbols</h1>
        <p className="text-sm text-muted-foreground">Search the selected repository and open symbol detail, graph, or impact views.</p>
      </div>
      <GlobalSearch />
    </div>
  )
}
