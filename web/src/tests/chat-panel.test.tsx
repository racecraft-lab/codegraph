import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BrowserRouter } from "react-router-dom"

import { AppStateProvider } from "@/app/state"
import { ChatPanel } from "@/components/chat/ChatPanel"

const repo = {
  id: "0123456789abcdef",
  root: "/tmp/codegraph",
  name: "codegraph",
  default: true,
}

beforeEach(() => {
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
              index: { state: "ready", fileCount: 1, nodeCount: 2, edgeCount: 3, lastIndexed: null },
            }),
            { status: 200 },
          ),
        )
      }
      if (url.startsWith("/api/chat/status")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              state: "dormant",
              message: "No LLM provider is configured.",
              providerConfigured: false,
              repo: repo.id,
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response(JSON.stringify({ error: { code: "not_found", message: "not found" } }), { status: 404 }))
    }),
  )
})

describe("ChatPanel", () => {
  it("renders dormant state without exposing provider configuration", async () => {
    render(
      <BrowserRouter>
        <AppStateProvider>
          <ChatPanel />
        </AppStateProvider>
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText("Chat dormant")).toBeInTheDocument()
    })
    expect(screen.getByText("No LLM provider is configured.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled()
  })
})
