import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StatePanel } from "@/components/layout/StatePanel"

describe("repository shell states", () => {
  it("renders unauthorized and unavailable state panels", () => {
    render(
      <div>
        <StatePanel kind="unauthorized" title="Token required">Provide the configured bearer token.</StatePanel>
        <StatePanel kind="error" title="Backend unreachable">Start codegraph serve --web.</StatePanel>
      </div>,
    )

    expect(screen.getByText("Token required")).toBeInTheDocument()
    expect(screen.getByText("Backend unreachable")).toBeInTheDocument()
  })
})
