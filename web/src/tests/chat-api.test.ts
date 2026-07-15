import { beforeEach, describe, expect, it, vi } from "vitest"

import { getChatStatus, redeemChatBundle, sendChatMessage } from "@/lib/api/chat"

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/chat/status")) {
        return Promise.resolve(
          new Response(JSON.stringify({ state: "enabled", message: "ready", providerConfigured: true, repo: "0123456789abcdef" }), {
            status: 200,
          }),
        )
      }
      if (url === "/api/chat/messages" && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ state: "answer", answer: "hello" }), { status: 200 }))
      }
      if (url.startsWith("/api/chat/bundles/")) {
        return Promise.resolve(new Response(JSON.stringify({ state: "pending_bundle", bundleHandle: "bundle-1" }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ error: { code: "not_found", message: "not found" } }), { status: 404 }))
    }),
  )
})

describe("chat API client", () => {
  it("reads chat status with repo scoping", async () => {
    const status = await getChatStatus("0123456789abcdef")

    expect(status.state).toBe("enabled")
    expect(fetch).toHaveBeenCalledWith("/api/chat/status?repo=0123456789abcdef", expect.any(Object))
  })

  it("posts messages and redeems bundle handles through same-origin paths", async () => {
    await expect(sendChatMessage({ message: "hello", repo: "0123456789abcdef" })).resolves.toMatchObject({ state: "answer" })
    await expect(redeemChatBundle("bundle-1")).resolves.toMatchObject({ state: "pending_bundle" })
  })
})
