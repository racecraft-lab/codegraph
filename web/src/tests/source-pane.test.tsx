import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SourcePane, fileUriForPath, relativePathFromFileUri } from "@/components/symbol/SourcePane"
import { BrowserLspClient, BrowserLspError, type BrowserLspApi, type LspLocation, type SourceSnapshot } from "@/lib/lsp/client"
import { locationSearch, parseViewerLocation } from "@/routes/SymbolDetailRoute"
import { renderWithProviders } from "@/tests/test-utils"

const root = "/repo"
const alpha = location("src/alpha.ts", 0, 7)
const beta = location("src/beta.ts", 2, 3)

afterEach(() => {
  vi.useRealTimers()
})

describe("focused source pane", () => {
  it("loads verified source, keeps one source tab stop, and groups references", async () => {
    const client = fakeClient({
      text: "export alpha\nalpha()\n",
      languageId: "typescript",
      contentHash: "hash",
      snapshotToken: "snapshot",
    })

    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )

    const source = await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })
    expect(source.getAttribute("tabindex")).toBe("0")
    expect(source.getAttribute("aria-activedescendant")).toBe("codegraph-active-source-token")
    expect(source.textContent).toContain("export alpha")
    expect(screen.getByText("src/beta.ts (1)")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Open src/beta.ts line 3 column 4" })).toBeTruthy()
    expect(client.connect).toHaveBeenCalledOnce()
    expect(client.content).toHaveBeenCalledWith(alpha.uri)
  })

  it("falls back to one bounded plain-text node when interactive rendering exceeds its budget", async () => {
    const text = "identifier ".repeat(6_000)
    const client = fakeClient({
      text,
      languageId: "typescript",
      contentHash: "hash",
      snapshotToken: "snapshot",
    })

    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )

    const source = await screen.findByRole("textbox")
    expect(source.textContent).toBe(text)
    expect(source.querySelector("span, mark")).toBeNull()
    expect(source.getAttribute("aria-activedescendant")).toBeNull()
    expect(screen.getByText("Interactive token highlighting is disabled for this large source.")).toBeTruthy()
  })

  it("uses the active UTF-16 position for named hover and definition actions", async () => {
    vi.useFakeTimers()
    const navigate = vi.fn()
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    client.hover.mockResolvedValue({ contents: { kind: "markdown", value: "function alpha(): void" } })
    client.definition.mockResolvedValue(beta)

    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={navigate} onClose={vi.fn()} createClient={() => client} />,
    )
    await act(async () => { await Promise.resolve() })
    const source = screen.getByRole("textbox")
    fireEvent.keyDown(source, { key: "ArrowRight" })
    fireEvent.click(screen.getByRole("button", { name: "Show hover details" }))
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve() })
    expect(screen.getByLabelText("Hover details").textContent).toContain("function alpha")
    expect(client.hover).toHaveBeenCalledWith(alpha.uri, { line: 0, character: 8 })

    fireEvent.click(screen.getByRole("button", { name: "Go to definition" }))
    await act(async () => { await Promise.resolve() })
    expect(navigate).toHaveBeenCalledWith(beta)
  })

  it("does not reconnect after a typed failure until the user retries", async () => {
    const stale = fakeClient()
    stale.content.mockRejectedValue(new BrowserLspError("stale", -32801))
    const recovered = fakeClient({ text: "fresh\n", languageId: "typescript", contentHash: "new", snapshotToken: "new" })
    const factory = vi.fn()
      .mockReturnValueOnce(stale)
      .mockReturnValueOnce(recovered)

    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )

    expect((await screen.findByRole("alert")).textContent).toContain("Re-index, then retry")
    expect(factory).toHaveBeenCalledTimes(1)
    const retry = screen.getByRole("button", { name: "Retry source" })
    retry.focus()
    fireEvent.click(retry)
    const source = await screen.findByRole("textbox")
    expect(source.textContent).toContain("fresh")
    await waitFor(() => expect(document.activeElement).toBe(source))
    expect(stale.close).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("maps an unexpected live disconnect and closed source reasons to truthful states", async () => {
    let disconnect!: () => void
    const disconnected = fakeClient({ text: "alpha\n", languageId: "typescript", contentHash: "h", snapshotToken: "s" })
    disconnected.onDisconnect.mockImplementation((listener) => { disconnect = listener; return vi.fn() })
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => disconnected} />,
    )
    await screen.findByRole("textbox")
    act(() => disconnect())
    expect((await screen.findByRole("alert")).textContent).toContain("disconnected")
    view.unmount()

    const tooLarge = fakeClient()
    tooLarge.content.mockRejectedValue(new BrowserLspError("unavailable", -32803, "too_large"))
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => tooLarge} />,
    )
    expect((await screen.findByRole("alert")).textContent).toContain("too large")
  })

  it("discards a superseded content result after location generation changes", async () => {
    let resolveAlpha!: (snapshot: SourceSnapshot) => void
    const client = fakeClient()
    client.content
      .mockReturnValueOnce(new Promise((resolve) => { resolveAlpha = resolve }))
      .mockResolvedValueOnce({ text: "beta source\n", languageId: "typescript", contentHash: "b", snapshotToken: "b" })
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await waitFor(() => expect(client.content).toHaveBeenCalledWith(alpha.uri))

    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    expect((await screen.findByRole("textbox", { name: "Read-only source for src/beta.ts" })).textContent).toContain("beta source")
    resolveAlpha({ text: "stale alpha\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText("stale alpha")).toBeNull()
  })

  it("keeps canonical file URIs internal while round-tripping relative paths", () => {
    const uri = fileUriForPath("/repo with space", "src/a file.ts")
    expect(uri).toBe("file:///repo%20with%20space/src/a%20file.ts")
    expect(relativePathFromFileUri("/repo with space", uri)).toBe("src/a file.ts")
    expect(relativePathFromFileUri("/another", uri)).toBeNull()
  })
})

describe("native browser LSP client", () => {
  it("binds the repository, initializes once, and settles JSON-RPC responses", async () => {
    const socket = new TestWebSocket()
    const factory = vi.fn(() => socket as unknown as WebSocket)
    const client = new BrowserLspClient("repo-1", factory)
    const connecting = client.connect()
    socket.open()
    await waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(factory.mock.calls[0]?.[0]).toContain("/lsp?repo=repo-1")
    socket.respond(0, { capabilities: {} })
    await connecting
    expect(JSON.parse(socket.sent[1] ?? "{}")).toMatchObject({ method: "initialized" })

    const content = client.content(alpha.uri)
    const request = JSON.parse(socket.sent[2] ?? "{}")
    socket.respond(request.id, { text: "alpha", languageId: "typescript", contentHash: "h", snapshotToken: "s" })
    await expect(content).resolves.toMatchObject({ text: "alpha", snapshotToken: "s" })

    const symbolLocation = client.symbolLocation("alpha-id", "alpha")
    const symbolRequest = JSON.parse(socket.sent[3] ?? "{}")
    socket.respond(symbolRequest.id, [{ name: "alpha", location: alpha, data: { codegraphNodeId: "alpha-id" } }])
    await expect(symbolLocation).resolves.toEqual(alpha)
    expect(factory).toHaveBeenCalledOnce()
  })

  it("settles accepted requests after five seconds without reconnecting", async () => {
    vi.useFakeTimers()
    const socket = new TestWebSocket()
    const factory = vi.fn(() => socket as unknown as WebSocket)
    const client = new BrowserLspClient("repo-1", factory)
    const connecting = client.connect()
    socket.open()
    await act(async () => { await Promise.resolve() })
    socket.respond(0, { capabilities: {} })
    await connecting

    const content = client.content(alpha.uri)
    const outcome = expect(content).rejects.toMatchObject({ state: "timed-out", reason: "timeout" })
    await act(async () => { vi.advanceTimersByTime(5_000); await Promise.resolve() })
    await outcome
    expect(factory).toHaveBeenCalledOnce()
  })
})

describe("source history state", () => {
  it("round-trips only repository-relative paths and complete ordered ranges", () => {
    const query = locationSearch(new URLSearchParams("keep=1"), "repo-1", root, beta)
    expect(query.toString()).toContain("repo=repo-1")
    expect(query.get("source")).toBe("src/beta.ts")
    expect(query.toString()).not.toContain("file%3A")
    expect(query.get("keep")).toBe("1")
    expect(parseViewerLocation(query, "repo-1", root)).toEqual(beta)
  })

  it("rejects repository mismatch, traversal, absolute paths, malformed positions, and reversed ranges", () => {
    const base = new URLSearchParams("repo=repo-1&source=src/a.ts&sl=1&sc=2&el=1&ec=3")
    expect(parseViewerLocation(base, "repo-2", root)).toBeNull()
    for (const source of ["../secret.ts", "/absolute.ts", "file:///repo/a.ts", "src//a.ts"]) {
      const query = new URLSearchParams(base)
      query.set("source", source)
      expect(parseViewerLocation(query, "repo-1", root)).toBeNull()
    }
    const malformed = new URLSearchParams(base)
    malformed.set("sc", "-1")
    expect(parseViewerLocation(malformed, "repo-1", root)).toBeNull()
    const reversed = new URLSearchParams(base)
    reversed.set("el", "0")
    expect(parseViewerLocation(reversed, "repo-1", root)).toBeNull()
  })
})

function location(path: string, line: number, character: number): LspLocation {
  return {
    uri: fileUriForPath(root, path),
    range: { start: { line, character }, end: { line, character: character + 1 } },
  }
}

function fakeClient(snapshot?: SourceSnapshot) {
  const client = {
    connect: vi.fn<BrowserLspApi["connect"]>().mockResolvedValue(undefined),
    content: vi.fn<BrowserLspApi["content"]>(),
    hover: vi.fn<BrowserLspApi["hover"]>().mockResolvedValue(null),
    definition: vi.fn<BrowserLspApi["definition"]>().mockResolvedValue(null),
    references: vi.fn<BrowserLspApi["references"]>().mockResolvedValue([beta]),
    symbolLocation: vi.fn<BrowserLspApi["symbolLocation"]>().mockResolvedValue(null),
    onDisconnect: vi.fn<BrowserLspApi["onDisconnect"]>().mockReturnValue(vi.fn()),
    close: vi.fn<BrowserLspApi["close"]>().mockResolvedValue(undefined),
  }
  if (snapshot) client.content.mockResolvedValue(snapshot)
  return client
}

class TestWebSocket extends EventTarget {
  readyState = WebSocket.CONNECTING
  sent: string[] = []

  open() {
    this.readyState = WebSocket.OPEN
    this.dispatchEvent(new Event("open"))
  }

  send(value: string) {
    this.sent.push(value)
  }

  close() {
    this.readyState = WebSocket.CLOSED
    this.dispatchEvent(new Event("close"))
  }

  respond(index: number, result: unknown) {
    const request = JSON.parse(this.sent[index] ?? "{}")
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) }))
  }
}
