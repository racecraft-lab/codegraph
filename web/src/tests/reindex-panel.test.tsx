import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReindexProgress } from "@/components/reindex/ReindexProgress"
import { renderApp } from "@/tests/test-utils"

class TestEventSource extends EventTarget {
  static instances: TestEventSource[] = []
  readonly url: string

  constructor(url: string) {
    super()
    this.url = url
    TestEventSource.instances.push(this)
  }

  close() {}
}

afterEach(() => {
  vi.restoreAllMocks()
  TestEventSource.instances = []
  window.history.pushState({}, "", "/")
})

describe("reindex panel", () => {
  it("renders running progress and disconnect state", () => {
    render(
      <ReindexProgress
        job={{ id: "job-1", repo: "0123456789abcdef", mode: "sync", status: "running", startedAt: new Date().toISOString() }}
        progress={{ phase: "extract", current: 1, total: 4 }}
      />,
    )

    expect(screen.getByText("running")).toBeInTheDocument()
    expect(screen.getByText("extract")).toBeInTheDocument()
  })

  it("recovers a terminal snapshot after the event stream disconnects", async () => {
    Object.defineProperty(globalThis, "EventSource", {
      value: TestEventSource,
      writable: true,
    })
    window.history.pushState({}, "", "/reindex")

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === "/api/repos") {
        return Response.json([{ id: "repo-1", root: "/repo", name: "repo", default: true }])
      }
      if (url.startsWith("/api/status")) {
        return Response.json({
          version: "1.4.1",
          repo: { id: "repo-1", root: "/repo", name: "repo" },
          index: { state: "ready", fileCount: 1, nodeCount: 2, edgeCount: 3 },
        })
      }
      if (url === "/api/reindex/repo-1" && init?.method === "POST") {
        return Response.json({
          id: "job-1",
          repo: "repo-1",
          mode: "sync",
          status: "running",
          startedAt: "2026-07-15T22:57:53.440Z",
        }, { status: 202 })
      }
      if (url === "/api/reindex/repo-1") {
        return Response.json({
          id: "job-1",
          repo: "repo-1",
          mode: "sync",
          status: "done",
          startedAt: "2026-07-15T22:57:53.440Z",
          finishedAt: "2026-07-15T22:57:54.267Z",
          result: { filesChecked: 1, filesAdded: 0, filesModified: 0, filesRemoved: 0, nodesUpdated: 0, durationMs: 149 },
        })
      }
      return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })
    })

    renderApp()

    await userEvent.click(await screen.findByRole("button", { name: "Sync changed files" }))
    await waitFor(() => expect(TestEventSource.instances).toHaveLength(1))

    TestEventSource.instances[0]?.dispatchEvent(new Event("error"))

    await screen.findByText("done")
    expect(screen.getByText("Checked 1 files; 0 changed; updated 0 nodes.")).toBeInTheDocument()
    expect(screen.queryByText("Disconnected")).not.toBeInTheDocument()
  })
})
