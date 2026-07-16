import { apiGet, apiPost } from "./client"
import { apiPath, repoQuery } from "./routes"
import type { ChatRequest, ChatResponse, ChatStatus } from "./types"

export function getChatStatus(repoId?: string): Promise<ChatStatus> {
  return apiGet<ChatStatus>(apiPath("/api/chat/status", repoQuery(repoId)))
}

export function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  return apiPost<ChatResponse>("/api/chat/messages", request)
}

export function redeemChatBundle(handle: string, repoId?: string): Promise<ChatResponse> {
  return apiGet<ChatResponse>(apiPath(`/api/chat/bundles/${encodeURIComponent(handle)}`, repoQuery(repoId)))
}
