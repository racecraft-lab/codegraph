import { beforeEach, describe, expect, it, vi } from "vitest"

import { getSymbol } from "@/lib/api/symbols"

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      expect(url).toBe("/api/node/file%3Asrc%2Findex.ts?repo=0123456789abcdef")
      return Promise.resolve(new Response(JSON.stringify({ id: "file:src/index.ts", kind: "file", name: "index.ts" }), { status: 200 }))
    }),
  )
})

describe("symbol API", () => {
  it("percent-encodes opaque node ids", async () => {
    await expect(getSymbol("file:src/index.ts", "0123456789abcdef")).resolves.toMatchObject({ kind: "file" })
  })
})
