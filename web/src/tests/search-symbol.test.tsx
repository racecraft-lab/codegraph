import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { BrowserRouter } from "react-router-dom"

import { RelationshipPanels } from "@/components/symbol/RelationshipPanels"

describe("search and symbol UI", () => {
  it("renders symbol rows with open actions", () => {
    render(
      <BrowserRouter>
        <RelationshipPanels
          callers={{ status: "success", result: { items: [{ id: "function:caller", kind: "function", name: "caller" }], total: 1, limit: 100, offset: 0 } }}
          callees={{ status: "success", result: { items: [{ id: "function:callee", kind: "function", name: "callee" }], total: 1, limit: 100, offset: 0 } }}
        />
      </BrowserRouter>,
    )

    expect(screen.getByText("caller")).toBeInTheDocument()
    expect(screen.getByText("callee")).toBeInTheDocument()
  })

  it("distinguishes loading, failed, and successful empty relationships", () => {
    const { rerender } = render(
      <BrowserRouter>
        <RelationshipPanels callers={{ status: "loading" }} callees={{ status: "loading" }} />
      </BrowserRouter>,
    )

    expect(screen.getByText("Loading callers")).toBeInTheDocument()

    rerender(
      <BrowserRouter>
        <RelationshipPanels callers={{ status: "error", message: "Callers unavailable." }} callees={{ status: "success", result: { items: [], total: 0, limit: 100, offset: 0 } }} />
      </BrowserRouter>,
    )

    expect(screen.getByText("Callers unavailable.")).toBeInTheDocument()
    expect(screen.getByText("No relationship rows returned.")).toBeInTheDocument()
  })
})
