import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { flushSync } from "react-dom"

import { SourcePane, fileUriForPath, relativePathFromFileUri } from "@/components/symbol/SourcePane"
import { BrowserLspClient, BrowserLspError, type BrowserLspApi, type LspLocation, type SourceSnapshot } from "@/lib/lsp/client"
import {
  clearSourceSearch,
  locationSearch,
  parseViewerLocation,
  sourceSearchIsForRepo,
} from "@/routes/SymbolDetailRoute"
import { renderWithProviders } from "@/tests/test-utils"

const root = "/repo"
const alpha = location("src/alpha.ts", 0, 7)
const beta = location("src/beta.ts", 2, 3)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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
    expect(await screen.findByText("src/beta.ts (1)")).toBeTruthy()
    expect(screen.getByRole("heading", { level: 4, name: "src/beta.ts (1)" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Open src/beta.ts line 3 column 4" })).toBeTruthy()
    expect(client.connect).toHaveBeenCalledOnce()
    expect(client.content).toHaveBeenCalledWith(alpha.uri)
  })

  it("replaces a connected client when the repository changes", async () => {
    const repoA = fakeClient({
      text: "repo a alpha\n",
      languageId: "typescript",
      contentHash: "repo-a",
      snapshotToken: "repo-a",
    })
    const repoB = fakeClient({
      text: "repo b alpha\n",
      languageId: "typescript",
      contentHash: "repo-b",
      snapshotToken: "repo-b",
    })
    const factory = vi.fn((repoId: string) => repoId === "repo-a" ? repoA : repoB)
    const view = renderWithProviders(
      <SourcePane repoId="repo-a" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    expect((await screen.findByRole("textbox")).textContent).toContain("repo a alpha")

    view.rerender(
      <SourcePane repoId="repo-b" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )

    await waitFor(() => expect(screen.getByRole("textbox").textContent).toContain("repo b alpha"))
    expect(repoA.close).toHaveBeenCalledOnce()
    expect(repoB.connect).toHaveBeenCalledOnce()
  })

  it("replaces a retry-required client when the repository changes", async () => {
    const repoA = fakeClient()
    repoA.content.mockRejectedValue(new BrowserLspError("stale", -32801))
    const repoB = fakeClient({
      text: "repo b recovered\n",
      languageId: "typescript",
      contentHash: "repo-b",
      snapshotToken: "repo-b",
    })
    const factory = vi.fn((repoId: string) => repoId === "repo-a" ? repoA : repoB)
    const view = renderWithProviders(
      <SourcePane repoId="repo-a" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    expect((await screen.findByRole("alert")).textContent).toContain("Source changed")

    view.rerender(
      <SourcePane repoId="repo-b" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )

    expect((await screen.findByRole("textbox")).textContent).toContain("repo b recovered")
    expect(repoA.close).toHaveBeenCalledOnce()
    expect(repoB.connect).toHaveBeenCalledOnce()
  })

  it("uses the active UTF-16 position for named hover and definition actions", async () => {
    vi.useFakeTimers()
    const navigate = vi.fn()
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    client.hover.mockResolvedValue({ contents: { kind: "markdown", value: "function alpha(): void" } })
    const target = withSnapshot(beta, "beta-snapshot")
    client.definition.mockResolvedValue(target)

    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={navigate} onClose={vi.fn()} createClient={() => client} />,
    )
    await act(async () => { await Promise.resolve() })
    const source = screen.getByRole("textbox")
    fireEvent.keyDown(source, { key: "ArrowRight" })
    fireEvent.click(screen.getByRole("button", { name: "Show hover details" }))
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve() })
    expect(screen.getByLabelText("Hover details").textContent).toContain("function alpha")
    expect(client.hover).toHaveBeenCalledWith(
      alpha.uri,
      { line: 0, character: 8 },
      "snapshot",
      expect.any(AbortSignal),
    )

    client.content.mockResolvedValueOnce({
      text: "one\ntwo\n   beta\n",
      languageId: "typescript",
      contentHash: "beta-hash",
      snapshotToken: "beta-snapshot",
    })
    fireEvent.click(screen.getByRole("button", { name: "Go to definition" }))
    await act(async () => { await Promise.resolve() })
    expect(navigate).toHaveBeenCalledWith(target)
  })

  it("keeps punctuation-only symbols actionable at their exact LSP position", async () => {
    vi.useFakeTimers()
    const operator = location("src/operator.ml", 0, 5)
    operator.range.end.character = 8
    const navigate = vi.fn()
    const client = fakeClient({
      text: "let (>>=) value next = next value\n",
      languageId: "ocaml",
      contentHash: "operator-hash",
      snapshotToken: "operator-snapshot",
    })
    client.symbolLocation.mockResolvedValue(withSnapshot(operator, "operator-snapshot"))
    client.hover.mockResolvedValue({ contents: { kind: "markdown", value: "operator >>= hover" } })
    const target = withSnapshot(beta, "beta-snapshot")
    client.definition.mockResolvedValue(target)

    renderWithProviders(
      <SourcePane
        repoId="repo-1"
        root={root}
        location={operator}
        initialSymbol={{ id: "operator-id", name: ">>=" }}
        onNavigate={navigate}
        onClose={vi.fn()}
        createClient={() => client}
      />,
    )
    await act(async () => { await Promise.resolve() })

    const source = screen.getByRole("textbox")
    expect(source.querySelector("#codegraph-active-source-token")?.textContent).toBe(">>=")
    expect(client.references).toHaveBeenCalledWith(operator.uri, { line: 0, character: 5 }, "operator-snapshot")

    fireEvent.click(screen.getByRole("button", { name: "Show hover details" }))
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve() })
    expect(client.hover).toHaveBeenCalledWith(
      operator.uri,
      { line: 0, character: 5 },
      "operator-snapshot",
      expect.any(AbortSignal),
    )

    client.content.mockResolvedValueOnce({
      text: "one\ntwo\n   beta\n",
      languageId: "typescript",
      contentHash: "beta-hash",
      snapshotToken: "beta-snapshot",
    })
    fireEvent.click(screen.getByRole("button", { name: "Go to definition" }))
    await act(async () => { await Promise.resolve() })
    expect(navigate).toHaveBeenCalledWith(target)
  })

  it("binds references to the active token and ignores a late previous-token result", async () => {
    let resolveAlpha!: (locations: LspLocation[]) => void
    const initial = location("src/alpha.ts", 0, 0)
    const client = fakeClient({ text: "alpha beta\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    client.references
      .mockReturnValueOnce(new Promise((resolve) => { resolveAlpha = resolve }))
      .mockResolvedValueOnce([initial])

    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={initial} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    const source = await screen.findByRole("textbox")
    await waitFor(() => expect(client.references).toHaveBeenCalledWith(initial.uri, { line: 0, character: 0 }, "snapshot"))

    fireEvent.pointerEnter(source.querySelectorAll("span")[1]!)
    expect(client.references).toHaveBeenCalledOnce()
    resolveAlpha([beta])
    await waitFor(() => expect(client.references).toHaveBeenCalledWith(initial.uri, { line: 0, character: 6 }, "snapshot"))
    expect(await screen.findByText("src/alpha.ts (1)")).toBeTruthy()

    expect(screen.queryByText("src/beta.ts (1)")).toBeNull()
    expect(screen.getByText("src/alpha.ts (1)")).toBeTruthy()
  })

  it("serializes references and coalesces rapid token movement", async () => {
    let resolveFirst!: (locations: LspLocation[]) => void
    const initial = location("src/alpha.ts", 0, 0)
    const client = fakeClient({ text: "a b c d e f g h i j\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    client.references
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce([])
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={initial} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    const source = await screen.findByRole("textbox")
    await waitFor(() => expect(client.references).toHaveBeenCalledOnce())

    for (let index = 0; index < 9; index += 1) fireEvent.keyDown(source, { key: "ArrowRight" })

    expect(client.references).toHaveBeenCalledOnce()
    resolveFirst([])
    await waitFor(() => expect(client.references).toHaveBeenCalledTimes(2))
    expect(client.references).toHaveBeenLastCalledWith(initial.uri, { line: 0, character: 18 }, "snapshot")
    expect(screen.getByRole("textbox")).toBe(source)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it.each(["busy", "backpressure"])("keeps local %s pressure non-terminal", async (reason) => {
    const client = fakeClient({ text: "alpha\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    client.references.mockRejectedValue(new BrowserLspError("unavailable", -32803, reason))
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )

    const source = await screen.findByRole("textbox")
    await waitFor(() => expect(screen.getByText("References are unavailable.")).toBeTruthy())
    expect(screen.getByRole("textbox")).toBe(source)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("button", { name: "Retry source" })).toBeNull()
  })

  it("moves keyboard focus across blank lines to the next source token", async () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView })
    const client = fakeClient({
      text: "export alpha\n\nbeta()\n",
      languageId: "typescript",
      contentHash: "hash",
      snapshotToken: "snapshot",
    })
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )

    const source = await screen.findByRole("textbox")
    fireEvent.keyDown(source, { key: "ArrowDown" })

    expect(source.querySelector("#codegraph-active-source-token")?.textContent).toBe("beta")
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" }))
    if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView)
    else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it("moves across the maximum supported blank-line region", async () => {
    const client = fakeClient({
      text: `alpha\n${"\n".repeat(9_997)}omega\n`,
      languageId: "typescript",
      contentHash: "hash",
      snapshotToken: "snapshot",
    })
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )

    const source = await screen.findByRole("textbox")
    fireEvent.keyDown(source, { key: "ArrowDown" })

    expect(source.querySelector("#codegraph-active-source-token")?.textContent).toBe("omega")
  })

  it("requests hover on source focus and never references a missing active token", async () => {
    vi.useFakeTimers()
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await act(async () => { await Promise.resolve() })
    const source = screen.getByRole("textbox")

    fireEvent.focus(source)
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve() })
    expect(client.hover).toHaveBeenCalledWith(
      alpha.uri,
      alpha.range.start,
      "snapshot",
      expect.any(AbortSignal),
    )

    fireEvent.keyDown(source, { key: "ArrowRight" })
    fireEvent.keyDown(source, { key: "ArrowRight" })
    fireEvent.keyDown(source, { key: "ArrowRight" })
    fireEvent.keyDown(source, { key: "ArrowRight" })
    fireEvent.keyDown(source, { key: "ArrowRight" })
    fireEvent.keyDown(source, { key: "ArrowRight" })
    expect(source.getAttribute("aria-activedescendant")).toBe("codegraph-active-source-token")
    expect(source.querySelector("#codegraph-active-source-token")).not.toBeNull()
  })

  it("cancels superseded hover requests, keeps only the latest position, and Escape invalidates pending work", async () => {
    vi.useFakeTimers()
    let firstSignal: AbortSignal | undefined
    const client = fakeClient({ text: "alpha beta\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    client.hover
      .mockImplementationOnce((_uri, _position, _snapshotToken, signal) => new Promise((_resolve, reject) => {
        firstSignal = signal
        signal?.addEventListener(
          "abort",
          () => reject(new BrowserLspError("unavailable", -32800, "cancelled")),
          { once: true },
        )
      }))
      .mockResolvedValue({ contents: { kind: "markdown", value: "latest" } })
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await act(async () => { await Promise.resolve() })
    const source = screen.getByRole("textbox")
    fireEvent.click(screen.getByRole("button", { name: "Show hover details" }))
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve() })
    expect(client.hover).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(source, { key: "ArrowRight" })
    expect(firstSignal?.aborted).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Show hover details" }))
    fireEvent.keyDown(source, { key: "ArrowRight" })
    fireEvent.click(screen.getByRole("button", { name: "Show hover details" }))
    expect(client.hover).toHaveBeenCalledTimes(1)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve(); await Promise.resolve() })
    expect(client.hover).toHaveBeenCalledTimes(2)
    expect(client.hover).toHaveBeenLastCalledWith(
      alpha.uri,
      { line: 0, character: 9 },
      "snapshot",
      expect.any(AbortSignal),
    )

    fireEvent.click(screen.getByRole("button", { name: "Show hover details" }))
    fireEvent.keyDown(source, { key: "Escape" })
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve() })
    expect(client.hover).toHaveBeenCalledTimes(2)
    expect(screen.queryByLabelText("Hover details")).toBeNull()
  })

  it("keeps a fallback line non-actionable when exact symbol lookup misses", async () => {
    const canonicalize = vi.fn()
    const fallback = location("src/alpha.ts", 0, 0)
    const client = fakeClient({ text: "  function alpha() {}\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    let disconnect = () => undefined
    client.onDisconnect.mockImplementation((listener) => {
      disconnect = listener
      return vi.fn()
    })
    const createClient = () => client
    let setCurrentLocation!: React.Dispatch<React.SetStateAction<LspLocation>>
    function SameLocationCanonicalization() {
      const [current, setCurrent] = React.useState(fallback)
      setCurrentLocation = setCurrent
      const [seed, setSeed] = React.useState<{ id: string; name: string } | undefined>({ id: "alpha-id", name: "alpha" })
      const handleCanonicalize = React.useCallback((next: LspLocation) => {
        canonicalize(next)
        setSeed(undefined)
        setCurrent({
          uri: next.uri,
          range: {
            start: { ...next.range.start },
            end: { ...next.range.end },
          },
        })
      }, [])
      return (
        <SourcePane
          repoId="repo-1"
          root={root}
          location={current}
          initialSymbol={seed}
          onCanonicalize={handleCanonicalize}
          onNavigate={vi.fn()}
          onClose={vi.fn()}
          createClient={createClient}
        />
      )
    }
    renderWithProviders(
      <SameLocationCanonicalization />,
    )
    const source = await screen.findByRole("textbox")
    expect(client.symbolLocation).toHaveBeenCalledWith("alpha-id")
    expect(canonicalize).toHaveBeenCalledWith(fallback)
    expect(canonicalize).toHaveBeenCalledOnce()
    expect(client.content).toHaveBeenCalledOnce()
    expect(source.querySelector("#codegraph-active-source-token")).toBeNull()
    expect(client.references).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Show hover details" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Go to definition" })).toBeDisabled()

    const token = source.querySelector("span")
    expect(token).not.toBeNull()
    fireEvent.pointerEnter(token!)
    fireEvent.keyDown(source, { key: "ArrowRight" })
    fireEvent.doubleClick(token!)
    await act(async () => { await Promise.resolve() })

    expect(source.querySelector("#codegraph-active-source-token")).toBeNull()
    expect(client.hover).not.toHaveBeenCalled()
    expect(client.references).not.toHaveBeenCalled()
    expect(client.definition).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Show hover details" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Go to definition" })).toBeDisabled()

    act(() => disconnect())
    fireEvent.click(screen.getByRole("button", { name: "Retry source" }))
    await screen.findByRole("textbox")
    expect(client.symbolLocation).toHaveBeenCalledTimes(2)
    expect(screen.getByRole("button", { name: "Retry source" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Show hover details" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Go to definition" })).toBeDisabled()

    act(() => setCurrentLocation(beta))
    await waitFor(() => expect(client.content).toHaveBeenCalledWith(beta.uri))
    await screen.findByRole("textbox")
    act(() => setCurrentLocation(fallback))
    await waitFor(() => expect(client.content).toHaveBeenLastCalledWith(fallback.uri))
    await screen.findByRole("textbox")
    expect(screen.getByRole("button", { name: "Show hover details" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Go to definition" })).toBeDisabled()
  })

  it("uses the exact server location for punctuation-only symbols", async () => {
    const fallback = location("src/operator.ml", 0, 0)
    const exact = withSnapshot(location("src/operator.ml", 0, 5), "operator-snapshot")
    exact.range.end.character = 8
    const canonicalize = vi.fn()
    const client = fakeClient({
      text: "let (>>=) value next = next value\n",
      languageId: "ocaml",
      contentHash: "operator-hash",
      snapshotToken: "operator-snapshot",
    })
    client.symbolLocation.mockResolvedValue(exact)
    function LocalPunctuationCanonicalization() {
      const [current, setCurrent] = React.useState(fallback)
      const [seed, setSeed] = React.useState<{ id: string; name: string } | undefined>({ id: "operator-id", name: ">>=" })
      const handleCanonicalize = React.useCallback((next: LspLocation) => {
        canonicalize(next)
        setSeed(undefined)
        setCurrent(next)
      }, [])
      return (
        <SourcePane
          repoId="repo-1"
          root={root}
          location={current}
          initialSymbol={seed}
          onCanonicalize={handleCanonicalize}
          onNavigate={vi.fn()}
          onClose={vi.fn()}
          createClient={() => client}
        />
      )
    }

    renderWithProviders(<LocalPunctuationCanonicalization />)

    await screen.findByRole("textbox", { name: "Read-only source for src/operator.ml" })
    expect(client.symbolLocation).toHaveBeenCalledWith("operator-id")
    expect(canonicalize).toHaveBeenLastCalledWith(exact)
    await waitFor(() => expect(client.references).toHaveBeenCalledWith(exact.uri, exact.range.start, exact.snapshotToken))
  })

  it("refreshes a stale canonical snapshot when retrying after re-indexing", async () => {
    const stale = fakeClient({
      text: "stale alpha\n",
      languageId: "typescript",
      contentHash: "content-b",
      snapshotToken: "snapshot-b",
    })
    stale.symbolLocation.mockResolvedValue(withSnapshot(alpha, "snapshot-a"))
    const recovered = fakeClient({
      text: "reindexed alpha\n",
      languageId: "typescript",
      contentHash: "content-b",
      snapshotToken: "snapshot-b",
    })
    recovered.symbolLocation.mockResolvedValue(withSnapshot(alpha, "snapshot-b"))
    const factory = vi.fn().mockReturnValueOnce(stale).mockReturnValueOnce(recovered)

    renderWithProviders(
      <SourcePane
        repoId="repo-1"
        root={root}
        location={alpha}
        initialSymbol={{ id: "alpha-id", name: "alpha" }}
        onCanonicalize={vi.fn()}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        createClient={factory}
      />,
    )

    expect((await screen.findByRole("alert")).textContent).toContain("Source changed")
    expect(stale.symbolLocation).toHaveBeenCalledWith("alpha-id")

    fireEvent.click(screen.getByRole("button", { name: "Retry source" }))

    expect((await screen.findByRole("textbox")).textContent).toContain("reindexed alpha")
    expect(recovered.symbolLocation).toHaveBeenCalledWith("alpha-id")
  })

  it("retries a temporarily missing canonical symbol from the loaded fallback", async () => {
    const missing = fakeClient({
      text: "export function alpha() {}\n",
      languageId: "typescript",
      contentHash: "fallback-content",
      snapshotToken: "fallback-snapshot",
    })
    missing.symbolLocation.mockResolvedValue(null)
    const recovered = fakeClient({
      text: "export function alpha() {}\n",
      languageId: "typescript",
      contentHash: "recovered-content",
      snapshotToken: "recovered-snapshot",
    })
    recovered.symbolLocation.mockResolvedValue(withSnapshot(alpha, "recovered-snapshot"))
    const factory = vi.fn().mockReturnValueOnce(missing).mockReturnValueOnce(recovered)

    renderWithProviders(
      <SourcePane
        repoId="repo-1"
        root={root}
        location={alpha}
        initialSymbol={{ id: "alpha-id", name: "alpha" }}
        onCanonicalize={vi.fn()}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        createClient={factory}
      />,
    )

    await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })
    expect(screen.getByRole("button", { name: "Show hover details" })).toBeDisabled()
    const retry = screen.getByRole("button", { name: "Retry source" })

    fireEvent.click(retry)

    await waitFor(() => expect(recovered.symbolLocation).toHaveBeenCalledWith("alpha-id"))
    await waitFor(() => expect(screen.getByRole("button", { name: "Show hover details" })).toBeEnabled())
    expect(screen.queryByRole("button", { name: "Retry source" })).toBeNull()
  })

  it("keeps an ambiguous fallback line non-actionable", async () => {
    const fallback = location("src/alpha.ts", 0, 0)
    const canonicalize = vi.fn()
    const client = fakeClient({
      text: "const alpha = () => alpha\n",
      languageId: "typescript",
      contentHash: "ambiguous-hash",
      snapshotToken: "ambiguous-snapshot",
    })

    renderWithProviders(
      <SourcePane
        repoId="repo-1"
        root={root}
        location={fallback}
        initialSymbol={{ id: "alpha-id", name: "alpha" }}
        onCanonicalize={canonicalize}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        createClient={() => client}
      />,
    )

    await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })
    expect(canonicalize).toHaveBeenCalledOnce()
    expect(canonicalize).toHaveBeenCalledWith(fallback)
    expect(screen.getByRole("button", { name: "Show hover details" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Go to definition" })).toBeDisabled()
    expect(client.references).not.toHaveBeenCalled()
  })

  it("disables token actions when the selected source line has no token", async () => {
    const client = fakeClient({ text: "   \n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={location("src/alpha.ts", 0, 0)} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )

    await screen.findByRole("textbox")
    expect(screen.getByRole("button", { name: "Show hover details" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Go to definition" })).toBeDisabled()
    expect(screen.getByRole("status").textContent).toContain("No source token")
    expect(client.references).not.toHaveBeenCalled()
  })

  it("does not announce pointer hover results through the live region", async () => {
    vi.useFakeTimers()
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    client.hover.mockResolvedValue({ contents: { kind: "markdown", value: "function alpha(): void" } })
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await act(async () => { await Promise.resolve() })
    const source = screen.getByRole("textbox")
    const token = source.querySelector("#codegraph-active-source-token")
    expect(token).not.toBeNull()

    fireEvent.pointerEnter(token as Element)
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve() })

    expect(screen.getByLabelText("Hover details").textContent).toContain("function alpha")
    expect(screen.queryByText("Hover details are available.")).toBeNull()
    expect(screen.getByText("Verified indexed source is ready.")).toBeTruthy()
  })

  it("does not rerender source for repeated movement within one token", async () => {
    vi.useFakeTimers()
    const commits = vi.fn()
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    renderWithProviders(
      <React.Profiler id="source-pane" onRender={commits}>
        <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />
      </React.Profiler>,
    )
    await act(async () => { await Promise.resolve() })
    const source = screen.getByRole("textbox")
    const token = source.querySelector("#codegraph-active-source-token")
    expect(token).not.toBeNull()

    fireEvent.pointerEnter(token as Element)
    const commitsAfterEntry = commits.mock.calls.length
    for (let index = 0; index < 20; index += 1) fireEvent.pointerMove(token as Element)

    expect(commits).toHaveBeenCalledTimes(commitsAfterEntry)
  })

  it("does not retokenize a near-limit source document during active movement", async () => {
    const matchAll = vi.spyOn(String.prototype, "matchAll")
    const split = vi.spyOn(String.prototype, "split")
    const client = fakeClient({
      text: ["alphaIdentifier", ...Array(9_998).fill("value")].join("\n"),
      languageId: "typescript",
      contentHash: "hash",
      snapshotToken: "snapshot",
    })
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    const source = await screen.findByRole("textbox")
    matchAll.mockClear()
    split.mockClear()

    for (let index = 0; index < 5; index += 1) fireEvent.keyDown(source, { key: "ArrowRight" })

    expect(matchAll.mock.calls.length).toBeLessThan(100)
    expect(split).not.toHaveBeenCalled()
  })

  it("cancels queued and in-flight named hover with Escape", async () => {
    vi.useFakeTimers()
    let resolveHover!: (value: Awaited<ReturnType<BrowserLspApi["hover"]>>) => void
    let hoverSignal: AbortSignal | undefined
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    client.hover.mockImplementation((_uri, _position, _snapshotToken, signal) => {
      hoverSignal = signal
      return new Promise((resolve) => { resolveHover = resolve })
    })
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await act(async () => { await Promise.resolve() })
    const button = screen.getByRole("button", { name: "Show hover details" })

    fireEvent.click(button)
    fireEvent.keyDown(button, { key: "Escape" })
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve() })
    expect(client.hover).not.toHaveBeenCalled()

    fireEvent.click(button)
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve() })
    expect(client.hover).toHaveBeenCalledOnce()
    fireEvent.keyDown(button, { key: "Escape" })
    expect(hoverSignal?.aborted).toBe(true)
    await act(async () => { resolveHover({ contents: { kind: "markdown", value: "late" } }); await Promise.resolve() })
    expect(screen.queryByLabelText("Hover details")).toBeNull()
  })

  it("keeps same-location definition and reference navigation out of history and restores source focus", async () => {
    const navigate = vi.fn()
    const client = fakeClient({ text: "export alpha\nalpha()\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    client.definition.mockResolvedValue(alpha)
    client.references.mockResolvedValue([alpha])
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={navigate} onClose={vi.fn()} createClient={() => client} />,
    )
    const source = await screen.findByRole("textbox")
    const alphaTokens = [...source.querySelectorAll("span")].filter((token) => token.textContent === "alpha")
    expect(alphaTokens).toHaveLength(2)
    await act(async () => { fireEvent.pointerEnter(alphaTokens[1]!); await Promise.resolve() })
    await waitFor(() => expect(client.references).toHaveBeenLastCalledWith(
      alpha.uri,
      { line: 1, character: 0 },
      "snapshot",
    ))

    const definition = screen.getByRole("button", { name: "Go to definition" })
    definition.focus()
    fireEvent.click(definition)
    await act(async () => { await Promise.resolve() })
    expect(navigate).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(source)
    expect(source.querySelector("#codegraph-active-source-token")).toBe(alphaTokens[0])
    await waitFor(() => expect(client.references).toHaveBeenLastCalledWith(
      alpha.uri,
      { line: 0, character: 7 },
      "snapshot",
    ))

    await act(async () => { fireEvent.pointerEnter(alphaTokens[1]!); await Promise.resolve() })
    const reference = await screen.findByRole("button", { name: "Open src/alpha.ts line 1 column 8" })
    reference.focus()
    fireEvent.click(reference)
    expect(navigate).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(source)
    await waitFor(() => expect(source.querySelector("#codegraph-active-source-token")).toBe(alphaTokens[0]))
  })

  it("rebinds hover after same-location definition navigation changes the active token", async () => {
    const client = fakeClient({ text: "export alpha\nalpha()\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    client.definition.mockResolvedValue(alpha)
    client.hover.mockImplementation(async (_uri, position) => ({
      contents: { kind: "markdown", value: `hover ${position.line}:${position.character}` },
    }))
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )

    const source = await screen.findByRole("textbox")
    const alphaTokens = [...source.querySelectorAll("span")].filter((token) => token.textContent === "alpha")
    fireEvent.pointerEnter(alphaTokens[1]!)
    source.focus()
    expect((await screen.findByLabelText("Hover details")).textContent).toContain("hover 1:0")

    fireEvent.keyDown(source, { key: "Enter" })

    await waitFor(() => expect(source.querySelector("#codegraph-active-source-token")).toBe(alphaTokens[0]))
    await waitFor(() => expect(screen.getByLabelText("Hover details").textContent).toContain("hover 0:7"))
    expect(screen.getByLabelText("Hover details").textContent).not.toContain("hover 1:0")
  })

  it("dismisses named hover details with Escape while the button retains focus", async () => {
    vi.useFakeTimers()
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    client.hover.mockResolvedValue({ contents: { kind: "markdown", value: "function alpha(): void" } })
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await act(async () => { await Promise.resolve() })
    const button = screen.getByRole("button", { name: "Show hover details" })
    button.focus()
    fireEvent.click(button)
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve() })
    expect(screen.getByLabelText("Hover details")).toBeTruthy()

    fireEvent.keyDown(button, { key: "Escape" })

    expect(screen.queryByLabelText("Hover details")).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it("renders truthful visible states for empty and browser-limited source", async () => {
    const empty = fakeClient({ text: "", languageId: "typescript", contentHash: "empty", snapshotToken: "empty" })
    const emptyView = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => empty} />,
    )
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("source file is empty"))
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.queryByText(/No source token/)).toBeNull()
    emptyView.unmount()

    const limited = fakeClient({ text: "token ".repeat(20_001), languageId: "typescript", contentHash: "dense", snapshotToken: "dense" })
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => limited} />,
    )
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("too large to render safely"))
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(limited.references).not.toHaveBeenCalled()
  })

  it("focuses the newly loaded source after explicit definition navigation", async () => {
    const client = fakeClient()
    client.content
      .mockResolvedValueOnce({ text: "export alpha\n", languageId: "typescript", contentHash: "alpha-hash", snapshotToken: "alpha-snapshot" })
      .mockResolvedValueOnce({ text: "one\ntwo\n   beta\n", languageId: "typescript", contentHash: "beta-hash", snapshotToken: "beta-snapshot" })
    client.definition.mockResolvedValue(withSnapshot(beta, "beta-snapshot"))
    function Harness() {
      const [current, setCurrent] = React.useState(alpha)
      return <SourcePane repoId="repo-1" root={root} location={current} onNavigate={setCurrent} onClose={vi.fn()} createClient={() => client} />
    }
    renderWithProviders(<Harness />)
    const source = await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })
    fireEvent.click(screen.getByRole("button", { name: "Go to definition" }))
    const nextSource = await screen.findByRole("textbox", { name: "Read-only source for src/beta.ts" })
    await waitFor(() => expect(document.activeElement).toBe(nextSource))
    await waitFor(() => expect(client.hover).toHaveBeenLastCalledWith(
      beta.uri,
      beta.range.start,
      "beta-snapshot",
      expect.any(AbortSignal),
    ))
    expect(source.getAttribute("aria-label")).toBe("Read-only source for src/alpha.ts")
  })

  it("rejects a navigation range when the target snapshot changed before load", async () => {
    const client = fakeClient()
    client.content
      .mockResolvedValueOnce({ text: "export alpha\n", languageId: "typescript", contentHash: "alpha-hash", snapshotToken: "alpha-snapshot" })
      .mockResolvedValueOnce({ text: "shifted beta\n", languageId: "typescript", contentHash: "beta-new-hash", snapshotToken: "beta-new" })
    client.definition.mockResolvedValue(withSnapshot(beta, "beta-old"))
    const navigate = vi.fn()
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={navigate} onClose={vi.fn()} createClient={() => client} />,
    )
    const source = await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })

    fireEvent.click(screen.getByRole("button", { name: "Go to definition" }))

    expect(await screen.findByText("Source changed before navigation. Try the request again.")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "Read-only source for src/alpha.ts" })).toBe(source)
    expect(screen.queryByText("shifted beta")).toBeNull()
  })

  it("preserves the current source when destination content reports stale", async () => {
    const client = fakeClient()
    client.content
      .mockResolvedValueOnce({ text: "export alpha\n", languageId: "typescript", contentHash: "alpha-hash", snapshotToken: "alpha-snapshot" })
      .mockRejectedValueOnce(new BrowserLspError("stale", -32801))
    client.definition.mockResolvedValue(withSnapshot(beta, "beta-snapshot"))
    const navigate = vi.fn()
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={navigate} onClose={vi.fn()} createClient={() => client} />,
    )
    const source = await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })

    fireEvent.click(screen.getByRole("button", { name: "Go to definition" }))

    expect(await screen.findByText("Source changed before navigation. Try the request again.")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "Read-only source for src/alpha.ts" })).toBe(source)
    expect(screen.queryByRole("button", { name: "Retry source" })).toBeNull()
  })

  it("lets the latest reference navigation win while target content reads are serialized", async () => {
    let resolveBeta!: (snapshot: SourceSnapshot) => void
    const gamma = location("src/gamma.ts", 4, 1)
    const betaTarget = withSnapshot(beta, "beta-snapshot")
    const gammaTarget = withSnapshot(gamma, "gamma-snapshot")
    const client = fakeClient()
    client.content
      .mockResolvedValueOnce({ text: "export alpha\n", languageId: "typescript", contentHash: "alpha-hash", snapshotToken: "alpha-snapshot" })
      .mockReturnValueOnce(new Promise((resolve) => { resolveBeta = resolve }))
      .mockResolvedValueOnce({ text: "gamma source\n", languageId: "typescript", contentHash: "gamma-hash", snapshotToken: "gamma-snapshot" })
    client.references.mockResolvedValue([betaTarget, gammaTarget])
    const navigate = vi.fn()
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={navigate} onClose={vi.fn()} createClient={() => client} />,
    )
    await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })
    const betaReference = await screen.findByRole("button", { name: "Open src/beta.ts line 3 column 4" })
    const gammaReference = await screen.findByRole("button", { name: "Open src/gamma.ts line 5 column 2" })

    fireEvent.click(betaReference)
    await waitFor(() => expect(client.content).toHaveBeenLastCalledWith(beta.uri))
    fireEvent.click(gammaReference)
    await act(async () => {
      resolveBeta({ text: "beta source\n", languageId: "typescript", contentHash: "beta-hash", snapshotToken: "beta-snapshot" })
      await Promise.resolve()
    })

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(gammaTarget))
    expect(navigate).not.toHaveBeenCalledWith(betaTarget)
    expect(client.content).toHaveBeenLastCalledWith(gamma.uri)
  })

  it("restores focused source after passive history navigation", async () => {
    const client = fakeClient()
    client.content
      .mockResolvedValueOnce({ text: "export alpha\n", languageId: "typescript", contentHash: "alpha-hash", snapshotToken: "alpha-snapshot" })
      .mockResolvedValueOnce({ text: "export beta\n", languageId: "typescript", contentHash: "beta-hash", snapshotToken: "beta-snapshot" })
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    const source = await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })
    act(() => source.focus())

    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )

    const restored = await screen.findByRole("textbox", { name: "Read-only source for src/beta.ts" })
    await waitFor(() => expect(document.activeElement).toBe(restored))
  })

  it("moves focused source to terminal status after passive history navigation", async () => {
    const client = fakeClient()
    client.content
      .mockResolvedValueOnce({ text: "export alpha\n", languageId: "typescript", contentHash: "alpha-hash", snapshotToken: "alpha-snapshot" })
      .mockResolvedValueOnce({ text: "", languageId: "typescript", contentHash: "empty", snapshotToken: "empty" })
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    const source = await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })
    act(() => source.focus())

    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("source file is empty"))
    const status = screen.getByRole("status")
    await waitFor(() => expect(document.activeElement).toBe(status))
  })

  it("does not move outside focus after passive history navigation", async () => {
    const client = fakeClient()
    client.content
      .mockResolvedValueOnce({ text: "export alpha\n", languageId: "typescript", contentHash: "alpha-hash", snapshotToken: "alpha-snapshot" })
      .mockResolvedValueOnce({ text: "export beta\n", languageId: "typescript", contentHash: "beta-hash", snapshotToken: "beta-snapshot" })
    const renderAt = (current: LspLocation) => (
      <>
        <button type="button">Outside source</button>
        <SourcePane repoId="repo-1" root={root} location={current} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />
      </>
    )
    const view = renderWithProviders(renderAt(alpha))
    const source = await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })
    const outside = screen.getByRole("button", { name: "Outside source" })
    act(() => source.focus())
    act(() => outside.focus())

    view.rerender(renderAt(beta))

    await screen.findByRole("textbox", { name: "Read-only source for src/beta.ts" })
    expect(document.activeElement).toBe(outside)
  })

  it.each([
    {
      label: "empty",
      result: { text: "", languageId: "typescript", contentHash: "empty", snapshotToken: "empty" },
      message: "source file is empty",
      role: "status",
    },
    {
      label: "render-limited",
      result: { text: "token ".repeat(20_001), languageId: "typescript", contentHash: "dense", snapshotToken: "dense" },
      message: "too large to render safely",
      role: "status",
    },
  ])("focuses the status when definition navigation reaches $label source", async ({ result, message, role }) => {
    const client = fakeClient()
    client.content.mockResolvedValueOnce({ text: "export alpha\n", languageId: "typescript", contentHash: "alpha-hash", snapshotToken: "alpha-snapshot" })
    if (result instanceof BrowserLspError) client.content.mockRejectedValueOnce(result)
    else client.content.mockResolvedValueOnce(result)
    client.definition.mockResolvedValue(
      withSnapshot(beta, result instanceof BrowserLspError ? "pending" : result.snapshotToken),
    )
    function Harness() {
      const [current, setCurrent] = React.useState(alpha)
      return <SourcePane repoId="repo-1" root={root} location={current} onNavigate={setCurrent} onClose={vi.fn()} createClient={() => client} />
    }
    renderWithProviders(<Harness />)
    await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })

    fireEvent.click(screen.getByRole("button", { name: "Go to definition" }))

    await waitFor(() => expect(screen.getByRole(role).textContent).toMatch(new RegExp(message, "i")))
    const status = screen.getByRole(role)
    expect(screen.queryByRole("textbox")).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(status))
  })

  it("preserves the current source when destination content times out", async () => {
    const client = fakeClient()
    client.content
      .mockResolvedValueOnce({ text: "export alpha\n", languageId: "typescript", contentHash: "alpha-hash", snapshotToken: "alpha-snapshot" })
      .mockRejectedValueOnce(new BrowserLspError("timed-out", -32803, "timeout"))
    client.definition.mockResolvedValue(withSnapshot(beta, "pending"))
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    const source = await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })

    fireEvent.click(screen.getByRole("button", { name: "Go to definition" }))

    expect(await screen.findByText("Source navigation is unavailable.")).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "Read-only source for src/alpha.ts" })).toBe(source)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it.each(["definition", "reference"] as const)(
    "focuses the disconnected status when %s navigation disconnects during loading",
    async (interaction) => {
      let disconnect!: () => void
      const client = fakeClient()
      client.content
        .mockResolvedValueOnce({ text: "export alpha\n", languageId: "typescript", contentHash: "alpha-hash", snapshotToken: "alpha-snapshot" })
        .mockReturnValueOnce(new Promise(() => undefined))
      client.definition.mockResolvedValue(withSnapshot(beta, "pending-beta-snapshot"))
      client.onDisconnect.mockImplementation((listener) => { disconnect = listener; return vi.fn() })
      function Harness() {
        const [current, setCurrent] = React.useState(alpha)
        return <SourcePane repoId="repo-1" root={root} location={current} onNavigate={setCurrent} onClose={vi.fn()} createClient={() => client} />
      }
      renderWithProviders(<Harness />)
      const source = await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })

      if (interaction === "definition") {
        source.focus()
        fireEvent.keyDown(source, { key: "Enter" })
      } else {
        const reference = await screen.findByRole("button", { name: "Open src/beta.ts line 3 column 4" })
        reference.focus()
        fireEvent.click(reference)
      }
      await waitFor(() => expect(client.content).toHaveBeenLastCalledWith(beta.uri))
      act(() => disconnect())

      const status = await screen.findByRole("alert")
      expect(status.textContent).toContain("disconnected")
      await waitFor(() => expect(document.activeElement).toBe(status))
    },
  )

  it("keeps focus on Retry source when a retry disconnects during loading", async () => {
    let disconnect!: () => void
    let rejectContent!: (reason: unknown) => void
    const stale = fakeClient()
    stale.content.mockRejectedValue(new BrowserLspError("stale", -32801))
    const disconnected = fakeClient()
    disconnected.content.mockReturnValue(new Promise((_, reject) => { rejectContent = reject }))
    disconnected.onDisconnect.mockImplementation((listener) => { disconnect = listener; return vi.fn() })
    const factory = vi.fn().mockReturnValueOnce(stale).mockReturnValueOnce(disconnected)
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )

    await screen.findByRole("alert")
    const retry = screen.getByRole("button", { name: "Retry source" })
    retry.focus()
    fireEvent.click(retry)
    await waitFor(() => expect(disconnected.content).toHaveBeenCalledWith(alpha.uri))
    act(() => {
      disconnect()
      rejectContent(new BrowserLspError("disconnected", -32803))
    })

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("disconnected"))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry source" })))
  })

  it("does not reconnect after a typed failure until the user retries", async () => {
    const stale = fakeClient()
    stale.content.mockRejectedValue(new BrowserLspError("stale", -32801))
    const recovered = fakeClient({ text: "fresh\n", languageId: "typescript", contentHash: "new", snapshotToken: "new" })
    const factory = vi.fn()
      .mockReturnValueOnce(stale)
      .mockReturnValueOnce(recovered)

    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )

    expect((await screen.findByRole("alert")).textContent).toContain("Re-index, then retry")
    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    expect((await screen.findByRole("alert")).textContent).toContain("Retry source to load this location")
    expect(factory).toHaveBeenCalledTimes(1)
    expect(stale.connect).toHaveBeenCalledOnce()
    const retry = screen.getByRole("button", { name: "Retry source" })
    retry.focus()
    fireEvent.click(retry)
    const source = await screen.findByRole("textbox", { name: "Read-only source for src/beta.ts" })
    expect(source.textContent).toContain("fresh")
    await waitFor(() => expect(document.activeElement).toBe(source))
    expect(stale.close).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledTimes(2)
    expect(recovered.content).toHaveBeenCalledWith(beta.uri)
  })

  it("does not carry a failed location reason across passive history navigation", async () => {
    const current = fakeClient()
    current.content
      .mockResolvedValueOnce({ text: "alpha source\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
      .mockRejectedValueOnce(new BrowserLspError("unavailable", -32803, "not_found"))
    const recovered = fakeClient({ text: "restored alpha\n", languageId: "typescript", contentHash: "restored", snapshotToken: "restored" })
    const factory = vi.fn().mockReturnValueOnce(current).mockReturnValueOnce(recovered)
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })

    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    expect((await screen.findByRole("alert")).textContent).toContain("not found")
    expect(current.content).toHaveBeenLastCalledWith(beta.uri)

    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    const blocked = await screen.findByRole("alert")
    expect(blocked.textContent).toContain("Retry source to load this location")
    expect(blocked.textContent).not.toContain("not found")
    expect(current.content).toHaveBeenCalledTimes(2)
    expect(factory).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole("button", { name: "Retry source" }))
    expect((await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })).textContent).toContain("restored alpha")
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("preserves a typed failure when its transport then disconnects", async () => {
    let disconnect!: () => void
    const timedOut = fakeClient()
    timedOut.content.mockRejectedValue(new BrowserLspError("timed-out", -32803, "timeout"))
    timedOut.onDisconnect.mockImplementation((listener) => { disconnect = listener; return vi.fn() })
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => timedOut} />,
    )

    expect((await screen.findByRole("alert")).textContent).toContain("timed out")
    act(() => disconnect())

    expect(screen.getByRole("alert").textContent).toContain("timed out")
  })

  it("keeps focus on Retry source when a retry also fails", async () => {
    const stale = fakeClient()
    stale.content.mockRejectedValue(new BrowserLspError("stale", -32801))
    const timedOut = fakeClient()
    timedOut.content.mockRejectedValue(new BrowserLspError("timed-out", -32803, "timeout"))
    const factory = vi.fn().mockReturnValueOnce(stale).mockReturnValueOnce(timedOut)
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )

    await screen.findByRole("alert")
    const retry = screen.getByRole("button", { name: "Retry source" })
    retry.focus()
    fireEvent.click(retry)

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("timed out"))
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry source" }))
  })

  it("clears passive focus intent before a failed Retry", async () => {
    const stale = fakeClient()
    stale.content.mockRejectedValue(new BrowserLspError("stale", -32801))
    const timedOut = fakeClient()
    timedOut.content.mockRejectedValue(new BrowserLspError("timed-out", -32803, "timeout"))
    const factory = vi.fn().mockReturnValueOnce(stale).mockReturnValueOnce(timedOut)
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    const staleStatus = await screen.findByRole("alert")
    act(() => staleStatus.focus())

    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    expect(screen.getByRole("alert").textContent).toContain("Retry source to load this location")
    const retry = screen.getByRole("button", { name: "Retry source" })
    retry.focus()
    fireEvent.click(retry)

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("timed out"))
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry source" }))
  })

  it.each([
    {
      label: "empty",
      snapshot: { text: "", languageId: "typescript", contentHash: "empty", snapshotToken: "empty" },
      message: "source file is empty",
    },
    {
      label: "render-limited",
      snapshot: { text: "token ".repeat(20_001), languageId: "typescript", contentHash: "dense", snapshotToken: "dense" },
      message: "too large to render safely",
    },
  ])("focuses the status after Retry loads $label source", async ({ snapshot, message }) => {
    const stale = fakeClient()
    stale.content.mockRejectedValue(new BrowserLspError("stale", -32801))
    const recovered = fakeClient(snapshot)
    const factory = vi.fn().mockReturnValueOnce(stale).mockReturnValueOnce(recovered)
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )

    await screen.findByRole("alert")
    const retry = screen.getByRole("button", { name: "Retry source" })
    retry.focus()
    fireEvent.click(retry)

    const status = await screen.findByRole("status")
    expect(status.textContent).toContain(message)
    await waitFor(() => expect(document.activeElement).toBe(status))
  })

  it.each(["references", "hover", "definition"] as const)(
    "marks the source stale when %s detects changed content",
    async (interaction) => {
      if (interaction === "hover") vi.useFakeTimers()
      const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
      const stale = new BrowserLspError("stale", -32801)
      if (interaction === "references") client.references.mockRejectedValue(stale)
      else if (interaction === "hover") client.hover.mockRejectedValue(stale)
      else client.definition.mockRejectedValue(stale)

      renderWithProviders(
        <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
      )

      if (interaction === "references") {
        await screen.findByRole("alert")
      } else {
        await act(async () => { await Promise.resolve() })
        const action = screen.getByRole("button", {
          name: interaction === "hover" ? "Show hover details" : "Go to definition",
        })
        action.focus()
        fireEvent.click(action)
        await act(async () => {
          if (interaction === "hover") vi.advanceTimersByTime(150)
          await Promise.resolve()
          await Promise.resolve()
        })
      }

      const status = screen.getByRole("alert")
      expect(status.textContent).toContain("Re-index, then retry")
      expect(screen.queryByRole("textbox")).toBeNull()
      expect(screen.getByRole("button", { name: "Retry source" })).toBeEnabled()
      if (interaction !== "references") expect(document.activeElement).toBe(status)
    },
  )

  it("moves focus from source to status when a focused interaction becomes stale", async () => {
    vi.useFakeTimers()
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
    client.hover.mockRejectedValue(new BrowserLspError("stale", -32801))
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await act(async () => { await Promise.resolve() })

    const source = screen.getByRole("textbox")
    act(() => source.focus())
    await act(async () => {
      vi.advanceTimersByTime(150)
      await Promise.resolve()
      await Promise.resolve()
    })

    const status = screen.getByRole("alert")
    expect(status.textContent).toContain("Re-index, then retry")
    expect(document.activeElement).toBe(status)
  })

  it.each(["Show hover details", "Go to definition"])(
    "moves focus from %s to status on disconnect",
    async (actionName) => {
      let disconnect!: () => void
      const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "hash", snapshotToken: "snapshot" })
      client.onDisconnect.mockImplementation((listener) => { disconnect = listener; return vi.fn() })
      renderWithProviders(
        <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
      )
      await screen.findByRole("textbox")
      const action = screen.getByRole("button", { name: actionName })
      action.focus()

      act(() => disconnect())

      const status = screen.getByRole("alert")
      expect(status.textContent).toContain("disconnected")
      expect(document.activeElement).toBe(status)
    },
  )

  it("requires Retry after an interaction times out before passive navigation", async () => {
    vi.useFakeTimers()
    const timedOut = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
    timedOut.hover.mockRejectedValue(new BrowserLspError("timed-out", -32803, "timeout"))
    const recovered = fakeClient({ text: "beta source\n", languageId: "typescript", contentHash: "b", snapshotToken: "b" })
    const factory = vi.fn().mockReturnValueOnce(timedOut).mockReturnValueOnce(recovered)
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    await act(async () => { await Promise.resolve() })

    fireEvent.click(screen.getByRole("button", { name: "Show hover details" }))
    await act(async () => {
      vi.advanceTimersByTime(150)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByRole("alert").textContent).toContain("timed out")

    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    expect(screen.getByRole("alert").textContent).toContain("Retry source to load this location")
    expect(factory).toHaveBeenCalledOnce()
    expect(timedOut.connect).toHaveBeenCalledOnce()
    expect(timedOut.content).not.toHaveBeenCalledWith(beta.uri)

    fireEvent.click(screen.getByRole("button", { name: "Retry source" }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByRole("textbox", { name: "Read-only source for src/beta.ts" }).textContent).toContain("beta source")
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("does not let a superseded retry install a client for the previous location", async () => {
    let resolveClose!: () => void
    const stale = fakeClient()
    stale.content.mockRejectedValue(new BrowserLspError("stale", -32801))
    stale.close.mockReturnValue(new Promise<void>((resolve) => { resolveClose = resolve }))
    const recovered = fakeClient({ text: "beta source\n", languageId: "typescript", contentHash: "b", snapshotToken: "b" })
    const factory = vi.fn().mockReturnValueOnce(stale).mockReturnValueOnce(recovered)
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    expect((await screen.findByRole("alert")).textContent).toContain("Re-index, then retry")

    fireEvent.click(screen.getByRole("button", { name: "Retry source" }))
    await waitFor(() => expect(stale.close).toHaveBeenCalledOnce())
    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )

    expect((await screen.findByRole("textbox", { name: "Read-only source for src/beta.ts" })).textContent).toContain("beta source")
    await act(async () => { resolveClose(); await Promise.resolve() })
    expect(factory).toHaveBeenCalledTimes(2)
    expect(recovered.content).toHaveBeenCalledWith(beta.uri)
  })

  it("maps an unexpected live disconnect and closed source reasons to truthful states", async () => {
    let disconnect!: () => void
    const disconnected = fakeClient({ text: "alpha\n", languageId: "typescript", contentHash: "h", snapshotToken: "s" })
    disconnected.hover.mockResolvedValue({ contents: { kind: "markdown", value: "stale hover" } })
    disconnected.onDisconnect.mockImplementation((listener) => { disconnect = listener; return vi.fn() })
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => disconnected} />,
    )
    await screen.findByRole("textbox")
    await screen.findByText("References")
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole("button", { name: "Show hover details" }))
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve() })
    expect(screen.getByLabelText("Hover details").textContent).toContain("stale hover")
    act(() => screen.getByRole("button", { name: "Open src/beta.ts line 3 column 4" }).focus())
    act(() => disconnect())
    const disconnectedStatus = screen.getByRole("alert")
    expect(disconnectedStatus.textContent).toContain("disconnected")
    expect(document.activeElement).toBe(disconnectedStatus)
    expect(screen.queryByLabelText("Hover details")).toBeNull()
    expect(screen.queryByText("References")).toBeNull()
    view.unmount()
    vi.useRealTimers()

    const tooLarge = fakeClient()
    tooLarge.content.mockRejectedValue(new BrowserLspError("unavailable", -32803, "too_large"))
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => tooLarge} />,
    )
    expect((await screen.findByRole("alert")).textContent).toContain("too large")
  })

  it("requires Retry when the active client disconnects during a location commit", async () => {
    let disconnect!: () => void
    let setCurrent!: React.Dispatch<React.SetStateAction<LspLocation>>
    const client = fakeClient({ text: "alpha source\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
    client.onDisconnect.mockImplementation((listener) => { disconnect = listener; return vi.fn() })
    function Harness() {
      const [current, updateCurrent] = React.useState(alpha)
      setCurrent = updateCurrent
      return <SourcePane repoId="repo-1" root={root} location={current} onNavigate={updateCurrent} onClose={vi.fn()} createClient={() => client} />
    }
    renderWithProviders(<Harness />)
    await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })
    const initialDisconnect = disconnect

    act(() => {
      flushSync(() => setCurrent(beta))
      initialDisconnect()
    })

    expect((await screen.findByRole("alert")).textContent).toContain("disconnected")
    expect(screen.getByRole("button", { name: "Retry source" })).toBeEnabled()
  })

  it("keeps async failures bound to the committed location during a suspended transition", async () => {
    let disconnect!: () => void
    let startSuspendedTransition!: () => void
    const never = new Promise<void>(() => undefined)
    const client = fakeClient({ text: "alpha source\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
    client.onDisconnect.mockImplementation((listener) => { disconnect = listener; return vi.fn() })
    function Suspend({ active }: { active: boolean }) {
      if (active) throw never
      return null
    }
    function Harness() {
      const [current, setCurrent] = React.useState(alpha)
      const [suspended, setSuspended] = React.useState(false)
      startSuspendedTransition = () => React.startTransition(() => {
        setCurrent(beta)
        setSuspended(true)
      })
      return (
        <React.Suspense fallback={<p>Suspended source transition</p>}>
          <SourcePane repoId="repo-1" root={root} location={current} onNavigate={setCurrent} onClose={vi.fn()} createClient={() => client} />
          <Suspend active={suspended} />
        </React.Suspense>
      )
    }
    renderWithProviders(<Harness />)
    await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })
    const committedDisconnect = disconnect

    act(() => startSuspendedTransition())
    expect(screen.getByRole("textbox", { name: "Read-only source for src/alpha.ts" })).toBeTruthy()
    act(() => committedDisconnect())

    const status = await screen.findByRole("alert")
    expect(status.textContent).toContain("disconnected")
    expect(status.textContent).not.toContain("Retry source to load this location")
  })

  it("requires explicit Retry after disconnect even when source history changes", async () => {
    let disconnect!: () => void
    const disconnected = fakeClient({ text: "alpha source\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
    disconnected.onDisconnect.mockImplementation((listener) => { disconnect = listener; return vi.fn() })
    const recovered = fakeClient({ text: "beta source\n", languageId: "typescript", contentHash: "b", snapshotToken: "b" })
    const factory = vi.fn().mockReturnValueOnce(disconnected).mockReturnValueOnce(recovered)
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })

    act(() => disconnect())
    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={factory} />,
    )
    expect((await screen.findByRole("alert")).textContent).toContain("Retry source to load this location")
    expect(factory).toHaveBeenCalledOnce()
    expect(disconnected.connect).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole("button", { name: "Retry source" }))
    expect((await screen.findByRole("textbox", { name: "Read-only source for src/beta.ts" })).textContent).toContain("beta source")
    expect(factory).toHaveBeenCalledTimes(2)
    expect(recovered.connect).toHaveBeenCalledOnce()
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
    expect(screen.queryByRole("textbox", { name: "Read-only source for src/beta.ts" })).toBeNull()
    resolveAlpha({ text: "stale alpha\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
    expect((await screen.findByRole("textbox", { name: "Read-only source for src/beta.ts" })).textContent).toContain("beta source")
    expect(screen.queryByText("stale alpha")).toBeNull()
  })

  it("serializes content and coalesces rapid passive locations", async () => {
    let resolveFirst!: (snapshot: SourceSnapshot) => void
    const client = fakeClient()
    client.content
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementation(async (uri) => ({ text: `${uri}\n`, languageId: "typescript", contentHash: uri, snapshotToken: uri }))
    const createClient = () => client
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={createClient} />,
    )
    await waitFor(() => expect(client.content).toHaveBeenCalledOnce())
    const locations = Array.from({ length: 9 }, (_, index) => location(`src/history-${index}.ts`, 0, 0))

    for (const current of locations) {
      view.rerender(
        <SourcePane repoId="repo-1" root={root} location={current} onNavigate={vi.fn()} onClose={vi.fn()} createClient={createClient} />,
      )
    }

    expect(client.content).toHaveBeenCalledOnce()
    resolveFirst({ text: "stale alpha\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
    const latest = locations.at(-1)!
    const source = await screen.findByRole("textbox", { name: "Read-only source for src/history-8.ts" })
    expect(source.textContent).toContain(latest.uri)
    expect(client.content).toHaveBeenCalledTimes(2)
    expect(client.content).toHaveBeenLastCalledWith(latest.uri)
  })

  it.each(["busy", "backpressure"])("retries latest content after transient %s pressure", async (reason) => {
    const client = fakeClient()
    client.content
      .mockRejectedValueOnce(new BrowserLspError("unavailable", -32803, reason))
      .mockResolvedValueOnce({ text: "recovered source\n", languageId: "typescript", contentHash: "recovered", snapshotToken: "recovered" })
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )

    expect((await screen.findByRole("textbox")).textContent).toContain("recovered source")
    expect(client.content).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("button", { name: "Retry source" })).toBeNull()
  })

  it.each(["busy", "backpressure"])("turns sustained %s pressure into a timed-out manual retry", async (reason) => {
    vi.useFakeTimers()
    const client = fakeClient()
    client.content.mockRejectedValue(new BrowserLspError("unavailable", -32803, reason))
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(client.content).toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    expect(screen.getByRole("alert").textContent).toContain("timed out")
    expect(screen.getByRole("button", { name: "Retry source" })).toBeTruthy()
  })

  it("does not canonicalize a symbol request that settles after unmount", async () => {
    let resolveSymbol!: (location: LspLocation | null) => void
    const canonicalize = vi.fn()
    const client = fakeClient()
    client.symbolLocation.mockReturnValue(new Promise((resolve) => { resolveSymbol = resolve }))
    const view = renderWithProviders(
      <SourcePane
        repoId="repo-1"
        root={root}
        location={alpha}
        initialSymbol={{ id: "alpha-id", name: "alpha" }}
        onCanonicalize={canonicalize}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        createClient={() => client}
      />,
    )
    await waitFor(() => expect(client.symbolLocation).toHaveBeenCalledWith("alpha-id"))

    view.unmount()
    resolveSymbol(alpha)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(canonicalize).not.toHaveBeenCalled()
    expect(client.content).not.toHaveBeenCalled()
  })

  it("clears a pending symbol seed when history restores another location", async () => {
    let resolveSymbol!: (location: LspLocation | null) => void
    const canonicalize = vi.fn()
    const client = fakeClient({ text: "restored beta\n", languageId: "typescript", contentHash: "b", snapshotToken: "b" })
    client.symbolLocation.mockReturnValue(new Promise((resolve) => { resolveSymbol = resolve }))
    const view = renderWithProviders(
      <SourcePane
        repoId="repo-1"
        root={root}
        location={alpha}
        initialSymbol={{ id: "alpha-id", name: "alpha" }}
        onCanonicalize={canonicalize}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        createClient={() => client}
      />,
    )
    await waitFor(() => expect(client.symbolLocation).toHaveBeenCalledOnce())

    view.rerender(
      <SourcePane
        repoId="repo-1"
        root={root}
        location={beta}
        onCanonicalize={canonicalize}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        createClient={() => client}
      />,
    )

    expect((await screen.findByRole("textbox", { name: "Read-only source for src/beta.ts" })).textContent).toContain("restored beta")
    expect(client.symbolLocation).toHaveBeenCalledOnce()
    resolveSymbol(alpha)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(canonicalize).not.toHaveBeenCalled()
  })

  it("never relabels a previous snapshot as a newly selected file", async () => {
    let resolveBeta!: (snapshot: SourceSnapshot) => void
    const client = fakeClient()
    client.content
      .mockResolvedValueOnce({ text: "alpha source\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
      .mockReturnValueOnce(new Promise((resolve) => { resolveBeta = resolve }))
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })

    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )

    expect(screen.queryByRole("textbox", { name: "Read-only source for src/beta.ts" })).toBeNull()
    expect(screen.queryByText(/alpha source/)).toBeNull()
    resolveBeta({ text: "beta source\n", languageId: "typescript", contentHash: "b", snapshotToken: "b" })
    expect((await screen.findByRole("textbox", { name: "Read-only source for src/beta.ts" })).textContent).toContain("beta source")
  })

  it("discards a references failure from the previous location", async () => {
    let rejectReferences!: (error: Error) => void
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
    client.references
      .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectReferences = reject }))
      .mockResolvedValueOnce([])
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await screen.findByRole("textbox", { name: "Read-only source for src/alpha.ts" })

    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await screen.findByRole("textbox", { name: "Read-only source for src/beta.ts" })
    await act(async () => {
      rejectReferences(new BrowserLspError("stale", -32801))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByRole("textbox", { name: "Read-only source for src/beta.ts" })).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("discards a hover failure from the previous location", async () => {
    vi.useFakeTimers()
    let rejectHover!: (error: Error) => void
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
    client.hover.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectHover = reject }))
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole("button", { name: "Show hover details" }))
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve() })
    expect(client.hover).toHaveBeenCalledOnce()

    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    rejectHover(new BrowserLspError("timed-out", -32803, "timeout"))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(screen.getByRole("textbox", { name: "Read-only source for src/beta.ts" })).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("discards a superseded definition rejection after location generation changes", async () => {
    let rejectAlpha!: (error: Error) => void
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
    client.definition.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectAlpha = reject }))
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await screen.findByRole("textbox")
    fireEvent.click(screen.getByRole("button", { name: "Go to definition" }))

    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={vi.fn()} onClose={vi.fn()} createClient={() => client} />,
    )
    await screen.findByRole("textbox", { name: "Read-only source for src/beta.ts" })
    rejectAlpha(new Error("superseded"))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText("Definition is unavailable.")).toBeNull()
  })

  it("ignores a definition that settles after an immediate location change", async () => {
    let resolveDefinition!: (location: LspLocation | null) => void
    const navigate = vi.fn()
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
    client.definition.mockReturnValue(new Promise((resolve) => { resolveDefinition = resolve }))
    const view = renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={navigate} onClose={vi.fn()} createClient={() => client} />,
    )
    await screen.findByRole("textbox")
    fireEvent.click(screen.getByRole("button", { name: "Go to definition" }))

    view.rerender(
      <SourcePane repoId="repo-1" root={root} location={beta} onNavigate={navigate} onClose={vi.fn()} createClient={() => client} />,
    )
    resolveDefinition(location("src/late.ts", 0, 0))
    await act(async () => { await Promise.resolve() })

    expect(navigate).not.toHaveBeenCalled()
  })

  it("invalidates definition work on disconnect and serializes duplicate activation", async () => {
    let disconnect!: () => void
    let resolveDefinition!: (location: LspLocation | null) => void
    const navigate = vi.fn()
    const client = fakeClient({ text: "export alpha\n", languageId: "typescript", contentHash: "a", snapshotToken: "a" })
    client.onDisconnect.mockImplementation((listener) => { disconnect = listener; return vi.fn() })
    client.definition.mockReturnValue(new Promise((resolve) => { resolveDefinition = resolve }))
    renderWithProviders(
      <SourcePane repoId="repo-1" root={root} location={alpha} onNavigate={navigate} onClose={vi.fn()} createClient={() => client} />,
    )
    await screen.findByRole("textbox")
    const button = screen.getByRole("button", { name: "Go to definition" })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(client.definition).toHaveBeenCalledOnce()

    act(() => disconnect())
    resolveDefinition(beta)
    await act(async () => { await Promise.resolve() })

    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("disconnected")
  })

  it("keeps canonical POSIX, Windows drive-root, and UNC file URIs internal while round-tripping relative paths", () => {
    const uri = fileUriForPath("/repo with space", "src/a file.ts")
    expect(uri).toBe("file:///repo%20with%20space/src/a%20file.ts")
    expect(relativePathFromFileUri("/repo with space", uri)).toBe("src/a file.ts")
    expect(relativePathFromFileUri("/another", uri)).toBeNull()
    expect(relativePathFromFileUri("/repo", "file://evil/repo/src/a.ts")).toBeNull()
    expect(relativePathFromFileUri("/repo", "file://user:password@evil/repo/src/a.ts")).toBeNull()
    expect(relativePathFromFileUri("/repo", "file:///repo/src/a.ts?version=old")).toBeNull()
    expect(relativePathFromFileUri("/repo", "file:///repo/src/a.ts#symbol")).toBeNull()
    expect(relativePathFromFileUri("/repo", "file:///repo/a%2F..%2Fsecret.ts")).toBeNull()
    expect(relativePathFromFileUri("/repo", "file:///repo/src/%00secret.ts")).toBeNull()

    const posixBackslashUri = fileUriForPath("/repo\\root", "src/a\\b.ts")
    expect(posixBackslashUri).toBe("file:///repo%5Croot/src/a%5Cb.ts")
    expect(relativePathFromFileUri("/repo\\root", posixBackslashUri)).toBe("src/a\\b.ts")

    const driveUri = fileUriForPath("C:\\", "src\\a file.ts")
    expect(driveUri).toBe("file:///C:/src/a%20file.ts")
    expect(relativePathFromFileUri("C:\\", driveUri)).toBe("src/a file.ts")
    expect(relativePathFromFileUri("C:\\repo", "file://evil/C:/repo/src/a.ts")).toBeNull()
    expect(relativePathFromFileUri("C:\\repo", "file:///C:/repo/src%5C..%5Csecret.ts")).toBeNull()

    const uncUri = fileUriForPath("\\\\server\\share", "src\\a.ts")
    expect(uncUri).toBe("file://server/share/src/a.ts")
    expect(relativePathFromFileUri("\\\\server\\share", uncUri)).toBe("src/a.ts")
    expect(relativePathFromFileUri("\\\\server\\share", "file://evil/share/src/a.ts")).toBeNull()

    const localhostUncUri = fileUriForPath("\\\\localhost\\share", "src\\a.ts")
    expect(localhostUncUri).toBe("file://localhost/share/src/a.ts")
    expect(relativePathFromFileUri("\\\\localhost\\share", localhostUncUri)).toBe("src/a.ts")
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

    const hover = client.hover(alpha.uri, alpha.range.start, "s")
    const hoverRequest = JSON.parse(socket.sent[3] ?? "{}")
    expect(hoverRequest.params).toMatchObject({ snapshotToken: "s" })
    socket.respond(3, null)
    await expect(hover).resolves.toBeNull()

    const definition = client.definition(alpha.uri, alpha.range.start, "s")
    const definitionRequest = JSON.parse(socket.sent[4] ?? "{}")
    expect(definitionRequest.params).toMatchObject({ snapshotToken: "s" })
    socket.respond(4, alpha)
    await expect(definition).resolves.toEqual(alpha)

    const references = client.references(alpha.uri, alpha.range.start, "s")
    const referencesRequest = JSON.parse(socket.sent[5] ?? "{}")
    expect(referencesRequest.params).toMatchObject({ snapshotToken: "s" })
    socket.respond(5, [alpha])
    await expect(references).resolves.toEqual([alpha])

    const symbolLocation = client.symbolLocation("alpha-id")
    const symbolRequest = JSON.parse(socket.sent[6] ?? "{}")
    expect(symbolRequest).toMatchObject({ method: "workspace/symbol", params: { query: "", nodeId: "alpha-id" } })
    const exactAlpha = withSnapshot(alpha, "s")
    socket.respond(symbolRequest.id, [{ name: "alpha", location: exactAlpha, data: { codegraphNodeId: "alpha-id" } }])
    await expect(symbolLocation).resolves.toEqual(exactAlpha)
    expect(factory).toHaveBeenCalledOnce()
  })

  it("sends $/cancelRequest and settles an aborted hover without closing the socket", async () => {
    const socket = new TestWebSocket()
    const client = new BrowserLspClient("repo-1", () => socket as unknown as WebSocket)
    const connecting = client.connect()
    socket.open()
    await waitFor(() => expect(socket.sent).toHaveLength(1))
    socket.respond(0, { capabilities: {} })
    await connecting

    const controller = new AbortController()
    const hover = client.hover(alpha.uri, alpha.range.start, "s", controller.signal)
    const hoverRequest = JSON.parse(socket.sent[2] ?? "{}")
    const outcome = expect(hover).rejects.toMatchObject({ code: -32800, reason: "cancelled" })
    controller.abort()
    await outcome

    expect(JSON.parse(socket.sent[3] ?? "{}")).toEqual({
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { id: hoverRequest.id },
    })
    expect(socket.readyState).toBe(WebSocket.OPEN)
    socket.respond(hoverRequest.id, null)
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

  it("times out a stalled WebSocket connection after five seconds and retries cleanly", async () => {
    vi.useFakeTimers()
    const first = new TestWebSocket()
    const second = new TestWebSocket()
    const factory = vi.fn()
      .mockReturnValueOnce(first as unknown as WebSocket)
      .mockReturnValueOnce(second as unknown as WebSocket)
    const client = new BrowserLspClient("repo-1", factory)
    const disconnected = vi.fn()
    client.onDisconnect(disconnected)

    const initial = client.connect()
    const initialOutcome = expect(initial).rejects.toMatchObject({ state: "timed-out", reason: "timeout" })
    await act(async () => { vi.advanceTimersByTime(5_000); await Promise.resolve() })
    await initialOutcome
    expect(first.readyState).toBe(WebSocket.CLOSED)
    expect(disconnected).not.toHaveBeenCalled()

    const retried = client.connect()
    second.open()
    await act(async () => { await Promise.resolve() })
    second.respond(0, { capabilities: {} })
    await expect(retried).resolves.toBeUndefined()
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("rejects a close-only connection attempt and ignores late events from the old socket", async () => {
    const first = new TestWebSocket()
    const second = new TestWebSocket()
    const factory = vi.fn()
      .mockReturnValueOnce(first as unknown as WebSocket)
      .mockReturnValueOnce(second as unknown as WebSocket)
    const client = new BrowserLspClient("repo-1", factory)

    const initial = client.connect()
    first.close()
    await expect(initial).rejects.toMatchObject({ state: "unavailable" })

    const retried = client.connect()
    second.open()
    await waitFor(() => expect(second.sent).toHaveLength(1))
    second.respond(0, { capabilities: {} })
    await retried
    first.close()

    const content = client.content(alpha.uri)
    const request = JSON.parse(second.sent[2] ?? "{}")
    second.respond(request.id, { text: "alpha", languageId: "typescript", contentHash: "h", snapshotToken: "s" })
    await expect(content).resolves.toMatchObject({ text: "alpha" })
  })

  it("closes a socket whose initialization fails and retries with a new session", async () => {
    const first = new TestWebSocket()
    const second = new TestWebSocket()
    const factory = vi.fn()
      .mockReturnValueOnce(first as unknown as WebSocket)
      .mockReturnValueOnce(second as unknown as WebSocket)
    const client = new BrowserLspClient("repo-1", factory)

    const initial = client.connect()
    first.open()
    await waitFor(() => expect(first.sent).toHaveLength(1))
    first.respondError(0, { code: -32803, message: "Request failed", data: { reason: "timeout" } })
    await expect(initial).rejects.toMatchObject({ state: "timed-out" })
    expect(first.readyState).toBe(WebSocket.CLOSED)

    const retried = client.connect()
    second.open()
    await waitFor(() => expect(second.sent).toHaveLength(1))
    second.respond(0, { capabilities: {} })
    await expect(retried).resolves.toBeUndefined()
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("cancels an asynchronous connecting socket and reconnects cleanly", async () => {
    const first = new AsyncCloseWebSocket()
    const second = new TestWebSocket()
    const factory = vi.fn()
      .mockReturnValueOnce(first as unknown as WebSocket)
      .mockReturnValueOnce(second as unknown as WebSocket)
    const client = new BrowserLspClient("repo-1", factory)

    const initial = client.connect()
    const initialOutcome = expect(initial).rejects.toMatchObject({ state: "disconnected" })
    await client.close()
    await initialOutcome

    const reconnected = client.connect()
    second.open()
    await waitFor(() => expect(second.sent).toHaveLength(1))
    second.respond(0, { capabilities: {} })
    await expect(reconnected).resolves.toBeUndefined()
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("bounds pending requests and rejects buffered output before sending", async () => {
    const socket = new TestWebSocket()
    const client = new BrowserLspClient("repo-1", () => socket as unknown as WebSocket)
    const connecting = client.connect()
    socket.open()
    await waitFor(() => expect(socket.sent).toHaveLength(1))
    socket.respond(0, { capabilities: {} })
    await connecting

    const pending = Array.from({ length: 8 }, () => client.content(alpha.uri))
    await expect(client.content(alpha.uri)).rejects.toMatchObject({ state: "unavailable", reason: "busy" })
    expect(socket.sent).toHaveLength(10)

    socket.bufferedAmount = 2 * 1024 * 1024
    await expect(client.content(alpha.uri)).rejects.toMatchObject({ state: "unavailable", reason: "busy" })
    socket.bufferedAmount = 0
    await client.close()
    await Promise.allSettled(pending)

    const buffered = new TestWebSocket()
    const bufferedClient = new BrowserLspClient("repo-1", () => buffered as unknown as WebSocket)
    const bufferedConnecting = bufferedClient.connect()
    buffered.open()
    await waitFor(() => expect(buffered.sent).toHaveLength(1))
    buffered.respond(0, { capabilities: {} })
    await bufferedConnecting
    buffered.bufferedAmount = 2 * 1024 * 1024
    await expect(bufferedClient.content(alpha.uri)).rejects.toMatchObject({ state: "unavailable", reason: "backpressure" })
    expect(buffered.sent).toHaveLength(2)
    await bufferedClient.close()
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
    for (const source of ["../secret.ts", "/absolute.ts", "file:///repo/a.ts", "src//a.ts", "src/./a.ts"]) {
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

  it("round-trips literal POSIX backslashes while rejecting Windows separator traversal", () => {
    const posixRoot = "/repo\\root"
    const posixLocation = {
      uri: fileUriForPath(posixRoot, "src/a\\b.ts"),
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } },
    }
    const query = locationSearch(new URLSearchParams(), "repo-1", posixRoot, posixLocation)
    expect(query.get("source")).toBe("src/a\\b.ts")
    expect(parseViewerLocation(query, "repo-1", posixRoot)).toEqual(posixLocation)

    const windowsTraversal = new URLSearchParams("repo=repo-1&source=src%5C..%5Csecret.ts&sl=1&sc=2&el=1&ec=3")
    expect(parseViewerLocation(windowsTraversal, "repo-1", "C:\\repo")).toBeNull()
  })

  it("closes source history when the selected repository changes", () => {
    const query = new URLSearchParams("keep=1&repo=repo-1&source=src/a.ts&sl=1&sc=2&el=1&ec=3")
    expect(sourceSearchIsForRepo(query, "repo-1")).toBe(true)
    expect(sourceSearchIsForRepo(query, "repo-2")).toBe(false)

    const cleared = clearSourceSearch(query)
    expect(cleared.toString()).toBe("keep=1")
  })
})

function location(path: string, line: number, character: number): LspLocation {
  return {
    uri: fileUriForPath(root, path),
    range: { start: { line, character }, end: { line, character: character + 1 } },
  }
}

function withSnapshot(location: LspLocation, snapshotToken: string): LspLocation {
  return {
    uri: location.uri,
    range: {
      start: { ...location.range.start },
      end: { ...location.range.end },
    },
    snapshotToken,
  }
}

function fakeClient(snapshot?: SourceSnapshot) {
  const client = {
    connect: vi.fn<BrowserLspApi["connect"]>().mockResolvedValue(undefined),
    content: vi.fn<BrowserLspApi["content"]>(),
    hover: vi.fn<BrowserLspApi["hover"]>().mockResolvedValue(null),
    definition: vi.fn<BrowserLspApi["definition"]>().mockResolvedValue(null),
    references: vi.fn<BrowserLspApi["references"]>().mockResolvedValue([withSnapshot(beta, "beta-snapshot")]),
    symbolLocation: vi.fn<BrowserLspApi["symbolLocation"]>().mockResolvedValue(null),
    onDisconnect: vi.fn<BrowserLspApi["onDisconnect"]>().mockReturnValue(vi.fn()),
    close: vi.fn<BrowserLspApi["close"]>().mockResolvedValue(undefined),
  }
  if (snapshot) client.content.mockResolvedValue(snapshot)
  return client
}

class TestWebSocket extends EventTarget {
  readyState = WebSocket.CONNECTING
  bufferedAmount = 0
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

  respondError(index: number, error: unknown) {
    const request = JSON.parse(this.sent[index] ?? "{}")
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ jsonrpc: "2.0", id: request.id, error }) }))
  }
}

class AsyncCloseWebSocket extends TestWebSocket {
  override close() {
    this.readyState = WebSocket.CLOSING
    queueMicrotask(() => {
      this.readyState = WebSocket.CLOSED
      this.dispatchEvent(new Event("close"))
    })
  }
}
