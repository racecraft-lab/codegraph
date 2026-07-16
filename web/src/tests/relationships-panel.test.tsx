import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FlowSections } from "@/components/symbol/FlowSections"

describe("relationship panels", () => {
  it("renders flow and cluster summaries", () => {
    render(
        <FlowSections
          flows={{
          status: "success",
          result: {
            items: [{ id: "flow:a", name: "GET /api/status", entryKind: "route", stepCount: 2, truncated: false }],
            total: 1,
            limit: 100,
            offset: 0,
            sourceVersion: 1,
            state: "available",
          },
        }}
        clusters={{
          status: "success",
          result: {
            items: [{ id: "cluster:a", canonicalLabel: "server", displayLabel: null, memberCount: 2, isSingleton: false }],
            total: 1,
            limit: 100,
            offset: 0,
            sourceVersion: 1,
            state: "available",
          },
        }}
      />,
    )

    expect(screen.getByText("GET /api/status")).toBeInTheDocument()
    expect(screen.getByText("server (2)")).toBeInTheDocument()
  })

  it("distinguishes loading, failed, and successful empty catalog sections", () => {
    const { rerender } = render(<FlowSections flows={{ status: "loading" }} clusters={{ status: "loading" }} />)

    expect(screen.getByText("Loading execution flows")).toBeInTheDocument()
    expect(screen.getByText("Loading functional clusters")).toBeInTheDocument()

    rerender(
      <FlowSections
        flows={{ status: "error", message: "Flows unavailable." }}
        clusters={{
          status: "success",
          result: { items: [], total: 0, limit: 100, offset: 0, sourceVersion: 1, state: "empty" },
        }}
      />,
    )

    expect(screen.getByText("Flows unavailable.")).toBeInTheDocument()
    expect(screen.getByText("No functional clusters returned.")).toBeInTheDocument()
  })

  it("renders degraded flow and cluster catalog states independently", () => {
    render(
      <FlowSections
        flows={{
          status: "success",
          result: { items: [], total: 0, limit: 100, offset: 0, sourceVersion: 0, state: "unavailable" },
        }}
        clusters={{
          status: "success",
          result: { items: [], total: 0, limit: 100, offset: 0, sourceVersion: 0, state: "disabled" },
        }}
      />,
    )

    expect(screen.getByText("Execution flows limited")).toBeInTheDocument()
    expect(screen.getByText("Catalog state: unavailable.")).toBeInTheDocument()
    expect(screen.getByText("Functional clusters limited")).toBeInTheDocument()
    expect(screen.getByText("Catalog state: disabled.")).toBeInTheDocument()
  })
})
