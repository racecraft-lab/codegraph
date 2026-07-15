import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { BrowserRouter } from "react-router-dom"

import { RelationshipPanels } from "@/components/symbol/RelationshipPanels"

describe("search and symbol UI", () => {
  it("renders symbol rows with open actions", () => {
    render(
      <BrowserRouter>
        <RelationshipPanels
          callers={{ items: [{ id: "function:caller", kind: "function", name: "caller" }], total: 1, limit: 100, offset: 0 }}
          callees={{ items: [{ id: "function:callee", kind: "function", name: "callee" }], total: 1, limit: 100, offset: 0 }}
        />
      </BrowserRouter>,
    )

    expect(screen.getByText("caller")).toBeInTheDocument()
    expect(screen.getByText("callee")).toBeInTheDocument()
  })
})
