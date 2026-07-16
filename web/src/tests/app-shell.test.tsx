import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { renderApp } from "./test-utils"

const repo = {
  id: "0123456789abcdef",
  root: "/tmp/codegraph",
  name: "codegraph",
  default: true,
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1024 })
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.startsWith("/api/repos")) {
        return Promise.resolve(new Response(JSON.stringify([repo]), { status: 200 }))
      }
      if (url.startsWith("/api/status")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: "0.0.0",
              repo,
              index: { state: "ready", fileCount: 10, nodeCount: 25, edgeCount: 40, lastIndexed: null },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response(JSON.stringify({ error: { code: "not_found", message: "not found" } }), { status: 404 }))
    }),
  )
})

describe("App shell", () => {
  it("renders repository navigation and status taxonomy", async () => {
    renderApp()

    expect(screen.getByText("CodeGraph")).toBeInTheDocument()
    expect(screen.getByText("Repository overview")).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText("Ready")).toBeInTheDocument()
    })
  })

  it("closes the mobile sidebar after navigation", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 })
    renderApp()

    await userEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByText("Search"))

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
  })
})
