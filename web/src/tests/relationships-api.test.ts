import { beforeEach, describe, expect, it, vi } from "vitest"

import { listCallees, listCallers } from "@/lib/api/relationships"

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ items: [{ id: "function:a", kind: "function", name: "a" }], total: 1, limit: 100, offset: 0 }), {
          status: 200,
        }),
      ),
    ),
  )
})

describe("relationship API", () => {
  it("loads callers and callees", async () => {
    await expect(listCallers("function:root")).resolves.toMatchObject({ total: 1 })
    await expect(listCallees("function:root")).resolves.toMatchObject({ total: 1 })
  })
})
