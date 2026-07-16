import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ImpactTables } from "@/components/impact/ImpactTables"

describe("impact route tables", () => {
  it("renders affected symbols and files", () => {
    render(
      <ImpactTables
        impact={{
          nodes: [{ id: "a", kind: "function", name: "parseConfig", file: "src/config.ts" }],
          edges: [],
          truncated: false,
        }}
      />,
    )

    expect(screen.getByText("parseConfig")).toBeInTheDocument()
    expect(screen.getByText("src/config.ts")).toBeInTheDocument()
  })
})
