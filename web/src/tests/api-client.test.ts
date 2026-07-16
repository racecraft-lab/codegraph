import { afterEach, describe, expect, it, vi } from "vitest"

import { apiGet, errorState } from "@/lib/api/client"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("api client fallback errors", () => {
  it.each([
    [
      401,
      "unauthorized",
      "The local CodeGraph server requires authentication.",
    ],
    [
      503,
      "unavailable",
      "The local CodeGraph server is temporarily unavailable.",
    ],
  ])(
    "uses code-consistent fallback text for invalid HTTP %s responses",
    async (status, code, message) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("not json", {
          status,
          headers: { "Content-Type": "text/plain" },
        })
      )

      await expect(
        apiGet<unknown>("/api/status").catch(errorState)
      ).resolves.toEqual({
        code,
        message,
        status,
      })
    }
  )
})
