import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { GlobalSearch } from "@/components/search/GlobalSearch"
import { GraphRoute } from "@/routes/GraphRoute"
import { ImpactRoute } from "@/routes/ImpactRoute"
import { SymbolDetailRoute } from "@/routes/SymbolDetailRoute"

const repositoryClient = {
  listRepositories: vi.fn(),
  getRepositoryStatus: vi.fn(),
  getOverview: vi.fn(),
  search: vi.fn(),
  getNode: vi.fn(),
  getSource: vi.fn(),
  getCallers: vi.fn(),
  getCallees: vi.fn(),
  getGraph: vi.fn(),
  getImpact: vi.fn(),
  refresh: vi.fn(),
  cancel: vi.fn(),
  deleteRepository: vi.fn(),
}

const clearNode = vi.fn()
const selectNode = vi.fn()

vi.mock("@/app/state", () => ({
  useAppState: () => ({
    selectedRepo: {
      id: "local-1",
      root: "local://opaque-repository",
      name: "Browser project",
      default: false,
      runtime: "local",
      sourceKind: "picked-folder",
    },
    repositoryClient,
    clearNode,
    selectNode,
  }),
}))

vi.mock("@/components/graph/GraphCanvas", () => ({
  GraphCanvas: () => <div>Local graph canvas</div>,
}))

const routeNode = {
  id: "node-local",
  kind: "function",
  name: "localMain",
  file: "src/local.ts",
  line: 1,
}
const emptyList = { items: [], total: 0, limit: 100, offset: 0 }
const graphResult = {
  nodes: [routeNode],
  edges: [],
  truncated: false,
}

function renderRoute(path: string, element: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path.split("?")[0]?.replace("node-local", ":id")} element={element} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("daemon fetch forbidden"))))
  vi.stubGlobal(
    "WebSocket",
    vi.fn(() => {
      throw new Error("/lsp WebSocket forbidden")
    }),
  )
  repositoryClient.search.mockResolvedValue({
    ...emptyList,
    items: [routeNode],
    total: 1,
    degraded: false,
  })
  repositoryClient.getNode.mockResolvedValue(routeNode)
  repositoryClient.getCallers.mockResolvedValue(emptyList)
  repositoryClient.getCallees.mockResolvedValue(emptyList)
  repositoryClient.getGraph.mockResolvedValue(graphResult)
  repositoryClient.getImpact.mockResolvedValue(graphResult)
  repositoryClient.getSource.mockResolvedValue({
    text: `<script>globalThis.__sourceExecuted = true</script>
<img src="https://source.example/should-not-load" onerror="globalThis.__sourceExecuted = true">
javascript:alert("still text")`,
    languageId: "typescript",
    contentHash: "safe-hash",
    snapshotToken: "generation-1",
  })
  Reflect.deleteProperty(globalThis, "__sourceExecuted")
})

describe("browser-local repository routes", () => {
  it("runs keyword search through the selected local client without daemon traffic", async () => {
    render(
      <MemoryRouter initialEntries={["/search?q=localMain"]}>
        <GlobalSearch />
      </MemoryRouter>,
    )

    expect(await screen.findByText("localMain")).toBeInTheDocument()
    expect(repositoryClient.search).toHaveBeenCalledWith("local-1", {
      query: "localMain",
      mode: "keyword",
      limit: 50,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("renders cached malicious-looking source as inert text and never opens LSP", async () => {
    renderRoute("/symbol/node-local", <SymbolDetailRoute />)

    fireEvent.click(await screen.findByRole("button", { name: "Open source" }))

    expect(await screen.findByText(/globalThis.__sourceExecuted = true/)).toBeInTheDocument()
    expect(repositoryClient.getNode).toHaveBeenCalledWith("local-1", "node-local")
    expect(repositoryClient.getSource).toHaveBeenCalledWith("local-1", "node-local")
    expect(repositoryClient.getCallers).toHaveBeenCalledWith("local-1", "node-local")
    expect(repositoryClient.getCallees).toHaveBeenCalledWith("local-1", "node-local")
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(Reflect.get(globalThis, "__sourceExecuted")).toBeUndefined()
    expect(WebSocket).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(
      screen.getAllByText(
        /LSP source intelligence is available only for server repositories/i,
      ),
    ).not.toHaveLength(0)
  })

  it("keeps graph and impact enabled through the selected local client", async () => {
    const graph = renderRoute("/graph/node-local", <GraphRoute />)
    expect(await screen.findByText("Local graph canvas")).toBeInTheDocument()
    expect(repositoryClient.getGraph).toHaveBeenCalledWith("local-1", "node-local", {
      depth: 1,
    })
    graph.unmount()

    renderRoute("/impact/node-local", <ImpactRoute />)
    await waitFor(() =>
      expect(repositoryClient.getImpact).toHaveBeenCalledWith("local-1", "node-local"),
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(WebSocket).not.toHaveBeenCalled()
  })
})
