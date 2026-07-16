import { beforeEach, describe, expect, it, vi } from "vitest"

import { listClusters, listFlows } from "@/lib/api/catalogs"

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const item = url.startsWith("/api/flows")
        ? { id: "flow:a", name: "GET /api/status", entryKind: "route", stepCount: 2, truncated: false }
        : { id: "cluster:a", canonicalLabel: "server", displayLabel: null, memberCount: 2, isSingleton: false }
      return Promise.resolve(new Response(JSON.stringify({ items: [item], total: 1, limit: 100, offset: 0, sourceVersion: 1, state: "available" }), { status: 200 }))
    }),
  )
})

describe("catalog API", () => {
  it("loads flow and cluster catalogs", async () => {
    await expect(listFlows()).resolves.toMatchObject({ state: "available" })
    await expect(listClusters()).resolves.toMatchObject({ total: 1 })
  })
})
