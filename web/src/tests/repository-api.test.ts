import { beforeEach, describe, expect, it, vi } from "vitest"

import { classifyRepositoryStatus, getRepositoryStatus, listRepositories } from "@/lib/api/repositories"

const repo = { id: "0123456789abcdef", root: "/tmp/codegraph", name: "codegraph", default: true }

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/repos") return Promise.resolve(new Response(JSON.stringify([repo]), { status: 200 }))
      if (url === "/api/status") {
        return Promise.resolve(
          new Response(JSON.stringify({ version: "0.0.0", repo, index: { state: "ready", fileCount: 1, nodeCount: 2, edgeCount: 3 } }), {
            status: 200,
          }),
        )
      }
      return Promise.resolve(new Response("{}", { status: 404 }))
    }),
  )
})

describe("repository API", () => {
  it("loads repositories and classifies status", async () => {
    await expect(listRepositories()).resolves.toEqual([repo])
    const status = await getRepositoryStatus()
    expect(classifyRepositoryStatus(status)).toBe("ready")
    expect(classifyRepositoryStatus(undefined, "unauthorized")).toBe("unauthorized")
  })
})
