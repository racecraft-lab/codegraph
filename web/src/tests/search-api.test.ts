import { beforeEach, describe, expect, it, vi } from "vitest"

import { searchSymbols } from "@/lib/api/search"

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      expect(url).toContain("/api/search")
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [{ id: "function:abc", kind: "function", name: "searchSymbols" }],
            total: 1,
            limit: 50,
            offset: 0,
            degraded: false,
          }),
          { status: 200 },
        ),
      )
    }),
  )
})

describe("search API", () => {
  it("sends query, mode, paging, and repo params", async () => {
    const result = await searchSymbols({ query: "search", mode: "auto", limit: 50, repoId: "0123456789abcdef" })
    expect(result.items[0]?.name).toBe("searchSymbols")
    expect(fetch).toHaveBeenCalledWith(
      "/api/search?q=search&mode=auto&limit=50&repo=0123456789abcdef",
      expect.any(Object),
    )
  })
})
