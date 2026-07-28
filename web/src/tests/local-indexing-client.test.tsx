import { describe, expect, it, vi } from "vitest"
import { createRemoteRepositoryClient, RepositoryClientError } from "../lib/repository-client"
import { LocalRepositoryClient } from "../local-indexing/client"

class TestWorker extends EventTarget {
  readonly postMessage = vi.fn()
  readonly terminate = vi.fn()

  respond(message: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: message }))
  }
}

describe("shared repository client boundary", () => {
  it("bridges existing REST behavior through the shared response shapes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: "server", root: "/repo", name: "Repo", default: true }]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ id: "node-1", kind: "function", name: "main" }],
            total: 1,
            limit: 20,
            offset: 0,
            degraded: false,
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal("fetch", fetchMock)
    const client = createRemoteRepositoryClient()

    await expect(client.listRepositories()).resolves.toEqual([
      { id: "server", root: "/repo", name: "Repo", default: true },
    ])
    await expect(client.search("server", { query: "main", limit: 20 })).resolves.toMatchObject({
      total: 1,
      degraded: false,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/repos",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    )
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/search?q=main&limit=20&repo=server")
    await expect(client.getSource("server", "node-1")).rejects.toMatchObject({
      code: "capability_unavailable",
    })
  })

  it("correlates local worker requests and ignores stale progress and results", async () => {
    const worker = new TestWorker()
    const client = new LocalRepositoryClient(worker, {
      createId: vi.fn().mockReturnValueOnce("request-active"),
    })
    const pending = client.search("local-1", { query: "main", limit: 10 })

    expect(worker.postMessage).toHaveBeenCalledWith({
      protocolVersion: 1,
      requestId: "request-active",
      repositoryId: "local-1",
      kind: "query",
      payload: {
        query: "search",
        request: { query: "main", limit: 10 },
      },
    })
    worker.respond({
      protocolVersion: 1,
      requestId: "request-stale",
      type: "result",
      terminal: "complete",
      result: { items: [{ id: "wrong" }], total: 1 },
    })
    worker.respond({
      protocolVersion: 1,
      requestId: "request-active",
      operationId: "old-operation",
      type: "progress",
      phase: "parse",
      completed: 9,
      total: 10,
    })

    let settled = false
    void pending.finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    const result = {
      items: [{ id: "node-1", kind: "function", name: "main" }],
      total: 1,
      limit: 10,
      offset: 0,
      degraded: false,
    }
    worker.respond({
      protocolVersion: 1,
      requestId: "request-active",
      type: "result",
      terminal: "complete",
      result,
    })
    await expect(pending).resolves.toEqual(result)
  })

  it("normalizes local failures and exposes the complete shared method surface", async () => {
    const worker = new TestWorker()
    const client = new LocalRepositoryClient(worker, {
      createId: () => "request-error",
    })

    const expectedMethods = [
      "listRepositories",
      "getRepositoryStatus",
      "getOverview",
      "search",
      "getNode",
      "getSource",
      "getCallers",
      "getCallees",
      "getGraph",
      "getImpact",
      "refresh",
      "cancel",
      "deleteRepository",
    ] as const
    for (const method of expectedMethods) expect(client[method]).toEqual(expect.any(Function))

    const pending = client.getNode("local-1", "missing")
    worker.respond({
      protocolVersion: 1,
      requestId: "request-error",
      type: "failure",
      terminal: "failed",
      error: {
        code: "capability_unavailable",
        message: "This local query is not available.",
        retryable: false,
        phase: "query",
      },
    })
    await expect(pending).rejects.toEqual(
      expect.objectContaining({
        name: "RepositoryClientError",
        code: "capability_unavailable",
        message: "This local query is not available.",
        retryable: false,
      }),
    )
    await expect(
      Promise.reject(new RepositoryClientError("quota_exceeded", "Storage full.", false)),
    ).rejects.toMatchObject({ code: "quota_exceeded" })

    client.close()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})
