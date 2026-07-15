import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FlowSections } from "@/components/symbol/FlowSections"

describe("relationship panels", () => {
  it("renders flow and cluster summaries", () => {
    render(
      <FlowSections
        flows={{
          items: [{ id: "flow:a", name: "GET /api/status", entryKind: "route", stepCount: 2, truncated: false }],
          total: 1,
          limit: 100,
          offset: 0,
          sourceVersion: 1,
          state: "available",
        }}
        clusters={{
          items: [{ id: "cluster:a", canonicalLabel: "server", displayLabel: null, memberCount: 2, isSingleton: false }],
          total: 1,
          limit: 100,
          offset: 0,
          sourceVersion: 1,
          state: "available",
        }}
      />,
    )

    expect(screen.getByText("GET /api/status")).toBeInTheDocument()
    expect(screen.getByText("server (2)")).toBeInTheDocument()
  })
})
