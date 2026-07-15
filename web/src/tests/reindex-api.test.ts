import { beforeEach, describe, expect, it, vi } from "vitest"

import { getLatestReindexJob, startReindex } from "@/lib/api/reindex"

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "job-1", repo: "0123456789abcdef", mode: "sync", status: "running", startedAt: new Date().toISOString() }), {
          status: 200,
        }),
      ),
    ),
  )
})

describe("reindex API", () => {
  it("starts and reads re-analysis jobs", async () => {
    await expect(startReindex("0123456789abcdef")).resolves.toMatchObject({ status: "running" })
    await expect(getLatestReindexJob("0123456789abcdef")).resolves.toMatchObject({ id: "job-1" })
  })
})
