import { apiGet, apiPost } from "./client"
import type { ChatRequest, ChatResponse, ChatStatus } from "./types"

export function getChatStatus(repoId?: string): Promise<ChatStatus> {
  const suffix = repoId ? `?repo=${encodeURIComponent(repoId)}` : ""
  return apiGet<ChatStatus>(`/api/chat/status${suffix}`)
}

export function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  return apiPost<ChatResponse>("/api/chat/messages", request)
}

export function redeemChatBundle(handle: string): Promise<ChatResponse> {
  return apiGet<ChatResponse>(`/api/chat/bundles/${encodeURIComponent(handle)}`)
}
