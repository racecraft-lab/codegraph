import { beforeEach, describe, expect, it, vi } from "vitest"

import { getImpact } from "@/lib/api/impact"

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      expect(url).toBe("/api/impact/function%3Aroot?depth=3")
      return Promise.resolve(new Response(JSON.stringify({ nodes: [], edges: [], truncated: false }), { status: 200 }))
    }),
  )
})

describe("impact API", () => {
  it("loads impact radius with default depth", async () => {
    await expect(getImpact("function:root")).resolves.toMatchObject({ truncated: false })
  })
})
