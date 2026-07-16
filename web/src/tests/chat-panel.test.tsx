import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

  it("redeems pending agent bundles with the selected repository", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        const url = String(input)
        requests.push({ url, init })
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
                state: "enabled",
                message: "Agent bundle mode is configured.",
                providerConfigured: true,
                repo: repo.id,
              }),
              { status: 200 },
            ),
          )
        }
        if (url === "/api/chat/messages" && init?.method === "POST") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                state: "pending_bundle",
                bundleHandle: "bundle-1",
                message: "Agent bundle emitted and pending completion.",
                context: {
                  repo: { id: repo.id, name: repo.name },
                  view: "repository",
                  symbols: [{ id: "symbol-1", name: "computeTotal", kind: "function", file: "src/calculator.ts" }],
                  files: ["src/calculator.ts"],
                  truncated: false,
                },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/api/chat/bundles/bundle-1?repo=${repo.id}`) {
          return Promise.resolve(new Response(JSON.stringify({ state: "answer", answer: "Resolved answer." }), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify({ error: { code: "not_found", message: "not found" } }), { status: 404 }))
      }),
    )

    render(
      <BrowserRouter>
        <AppStateProvider>
          <ChatPanel />
        </AppStateProvider>
      </BrowserRouter>,
    )

    await userEvent.type(screen.getByLabelText("Chat message"), "Summarize this repo")
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask" })).not.toBeDisabled())
    await userEvent.click(screen.getByRole("button", { name: "Ask" }))

    await screen.findByText("Resolved answer.")
    expect(screen.getByText("Context: 1 symbols across 1 files")).toBeInTheDocument()
    const messageRequest = requests.find((request) => request.url === "/api/chat/messages")
    expect(JSON.parse(String(messageRequest?.init?.body)).repo).toBe(repo.id)
    expect(requests.some((request) => request.url === `/api/chat/bundles/bundle-1?repo=${repo.id}`)).toBe(true)
  })

  it("guards against duplicate concurrent submits", async () => {
    let messageRequests = 0
    let resolveMessage: ((response: Response) => void) | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        const url = String(input)
        if (url.startsWith("/api/repos")) return Promise.resolve(new Response(JSON.stringify([repo]), { status: 200 }))
        if (url.startsWith("/api/status")) {
          return Promise.resolve(new Response(JSON.stringify({ version: "0.0.0", repo, index: { state: "ready", fileCount: 1, nodeCount: 2, edgeCount: 3 } }), { status: 200 }))
        }
        if (url.startsWith("/api/chat/status")) {
          return Promise.resolve(new Response(JSON.stringify({ state: "enabled", message: "Chat enabled.", providerConfigured: true, repo: repo.id }), { status: 200 }))
        }
        if (url === "/api/chat/messages" && init?.method === "POST") {
          messageRequests += 1
          return new Promise<Response>((resolve) => {
            resolveMessage = resolve
          })
        }
        return Promise.resolve(new Response(JSON.stringify({ error: { code: "not_found", message: "not found" } }), { status: 404 }))
      }),
    )

    render(
      <BrowserRouter>
        <AppStateProvider>
          <ChatPanel />
        </AppStateProvider>
      </BrowserRouter>,
    )

    await userEvent.type(screen.getByLabelText("Chat message"), "Summarize this repo")
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask" })).not.toBeDisabled())
    await userEvent.dblClick(screen.getByRole("button", { name: "Ask" }))

    expect(messageRequests).toBe(1)
    resolveMessage?.(new Response(JSON.stringify({ state: "answer", answer: "Done." }), { status: 200 }))
    await screen.findByText("Done.")
  })

  it("keeps one bundle redemption loop active per request", async () => {
    let bundleRequests = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        const url = String(input)
        if (url.startsWith("/api/repos")) return Promise.resolve(new Response(JSON.stringify([repo]), { status: 200 }))
        if (url.startsWith("/api/status")) {
          return Promise.resolve(new Response(JSON.stringify({ version: "0.0.0", repo, index: { state: "ready", fileCount: 1, nodeCount: 2, edgeCount: 3 } }), { status: 200 }))
        }
        if (url.startsWith("/api/chat/status")) {
          return Promise.resolve(new Response(JSON.stringify({ state: "enabled", message: "Chat enabled.", providerConfigured: true, repo: repo.id }), { status: 200 }))
        }
        if (url === "/api/chat/messages" && init?.method === "POST") {
          return Promise.resolve(new Response(JSON.stringify({ state: "pending_bundle", bundleHandle: "bundle-1", message: "Pending." }), { status: 200 }))
        }
        if (url === `/api/chat/bundles/bundle-1?repo=${repo.id}`) {
          bundleRequests += 1
          return new Promise<Response>(() => undefined)
        }
        return Promise.resolve(new Response(JSON.stringify({ error: { code: "not_found", message: "not found" } }), { status: 404 }))
      }),
    )

    render(
      <BrowserRouter>
        <AppStateProvider>
          <ChatPanel />
        </AppStateProvider>
      </BrowserRouter>,
    )

    await userEvent.type(screen.getByLabelText("Chat message"), "Summarize this repo")
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask" })).not.toBeDisabled())
    await userEvent.click(screen.getByRole("button", { name: "Ask" }))

    const checkBundle = await screen.findByRole("button", { name: "Check bundle" })
    expect(checkBundle).toBeDisabled()
    await userEvent.click(checkBundle)
    await userEvent.click(checkBundle)
    expect(bundleRequests).toBe(1)
  })
})
