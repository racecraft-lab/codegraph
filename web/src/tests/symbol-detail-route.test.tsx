import { fireEvent, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SymbolDetailRoute } from "@/routes/SymbolDetailRoute"
import { renderWithProviders } from "@/tests/test-utils"

const mocks = vi.hoisted(() => ({
  clearNode: vi.fn(),
  selectNode: vi.fn(),
  getSymbol: vi.fn(),
  listCallers: vi.fn(),
  listCallees: vi.fn(),
  listFlows: vi.fn(),
  listClusters: vi.fn(),
}))

vi.mock("@/app/state", () => ({
  useAppState: () => ({
    selectedRepo: { id: "repo-1", root: "/repo", name: "repo", default: true },
    clearNode: mocks.clearNode,
    selectNode: mocks.selectNode,
  }),
}))

vi.mock("@/lib/lsp/availability", () => ({
  SOURCE_VIEWER_TRANSPORT_AVAILABLE: true,
}))

vi.mock("@/components/symbol/SourcePane", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/symbol/SourcePane")>()
  return {
    ...actual,
    SourcePane: () => <div>Source pane</div>,
  }
})

vi.mock("@/lib/api/symbols", () => ({
  getSymbol: mocks.getSymbol,
}))

vi.mock("@/lib/api/relationships", () => ({
  listCallers: mocks.listCallers,
  listCallees: mocks.listCallees,
}))

vi.mock("@/lib/api/catalogs", () => ({
  listFlows: mocks.listFlows,
  listClusters: mocks.listClusters,
}))

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Current search">{location.search}</output>
}

describe("SymbolDetailRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSymbol.mockResolvedValue({
      id: "node-a",
      kind: "function",
      name: "startWebServer",
      file: "src/server/index.ts",
      line: 7,
    })
    const emptyList = { items: [], total: 0, limit: 100, offset: 0 }
    mocks.listCallers.mockResolvedValue(emptyList)
    mocks.listCallees.mockResolvedValue(emptyList)
    mocks.listFlows.mockResolvedValue({ ...emptyList, sourceVersion: 1, state: "available" })
    mocks.listClusters.mockResolvedValue({ ...emptyList, sourceVersion: 1, state: "available" })
  })

  it("persists the initial open-source location in URL search parameters", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={["/symbol/node-a?keep=1"]}>
        <Routes>
          <Route
            path="/symbol/:id"
            element={(
              <>
                <SymbolDetailRoute />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole("button", { name: "Open source" }))

    expect(await screen.findByText("Source pane")).toBeTruthy()
    const params = new URLSearchParams(screen.getByRole("status", { name: "Current search" }).textContent ?? "")
    expect(Object.fromEntries(params)).toEqual({
      keep: "1",
      repo: "repo-1",
      source: "src/server/index.ts",
      sl: "6",
      sc: "0",
      el: "6",
      ec: "1",
    })
  })
})
