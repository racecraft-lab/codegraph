export type AsyncStatus = "idle" | "loading" | "success" | "error"

export type RepositoryState =
  | "ready"
  | "stale"
  | "indexing"
  | "unavailable"
  | "unauthorized"
  | "empty"
  | "unindexed"
  | "missing"

export interface ErrorEnvelope {
  error: {
    code:
      | "invalid_request"
      | "unauthorized"
      | "not_found"
      | "conflict"
      | "unavailable"
      | "internal"
    message: string
    details?: Record<string, unknown>
  }
}

export interface Repository {
  id: string
  root: string
  name: string
  default: boolean
}

export interface RepositoryStatus {
  version: string
  repo: Pick<Repository, "id" | "root" | "name">
  index: {
    state: string
    fileCount: number
    nodeCount: number
    edgeCount: number
    lastIndexed?: string | null
  }
  hybridSearch?: {
    available?: boolean
    reason?: string
  }
  lsp?: {
    available?: boolean
  }
}

export interface CodeNode {
  id: string
  kind: string
  name: string
  file?: string
  line?: number
  signature?: string
  doc?: string
}

export interface CodeEdge {
  source: string
  target: string
  kind: string
  provenance?: "static" | "heuristic" | string
}

export interface ListResult<T = CodeNode> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface SearchResult extends ListResult<CodeNode> {
  degraded: boolean
  degradationReason?: string
}

export interface GraphResult {
  nodes: CodeNode[]
  edges: CodeEdge[]
  truncated: boolean
}

export interface FlowSummary {
  id: string
  name: string
  entryKind: "route" | "cli" | "event" | "export"
  stepCount: number
  truncated: boolean
}

export interface FlowStep {
  nodeId: string
  name: string
  kind: string
  depth: number
  parentNodeId: string | null
  edgeKind: "calls" | "references" | null
  provenance: "static" | "lsp" | "heuristic" | null
}

export interface FlowDetail {
  id: string
  name: string
  entryKind: FlowSummary["entryKind"]
  root: { nodeId: string; name: string; kind: string }
  steps: FlowStep[]
  truncated: boolean
  truncation: { depth: boolean; width: boolean; totalSteps: boolean }
  sourceVersion: number
  state: CatalogState
}

export interface ClusterSummary {
  id: string
  canonicalLabel: string
  displayLabel: string | null
  memberCount: number
  isSingleton: boolean
}

export type CatalogState =
  | "available"
  | "stale"
  | "empty"
  | "unavailable"
  | "disabled"
  | "not_indexed"

export interface CatalogListResult<T> extends ListResult<T> {
  sourceVersion: number
  state: CatalogState
}

export interface ReindexJob {
  id: string
  repo: string
  mode: "sync" | "full"
  status: "running" | "done" | "error"
  startedAt: string
  finishedAt?: string
  reason?: "aborted" | "lock_unavailable" | "index_failed"
  result?: Record<string, unknown>
}

export interface ReindexProgressEvent {
  phase?: string
  current?: number
  total?: number
  currentFile?: string
}

export type ChatAvailability =
  | "enabled"
  | "dormant"
  | "misconfigured"
  | "disabled"
  | "rate_limited"

export interface ChatStatus {
  state: ChatAvailability
  message: string
  providerConfigured: boolean
  repo: string
}

export interface ChatRequest {
  repo?: string
  message: string
  selectedNodeId?: string
  view?: string
}

export interface ChatResponse {
  state:
    | "answer"
    | "fallback"
    | "pending_bundle"
    | "dormant"
    | "misconfigured"
    | "rate_limited"
    | "error"
  answer?: string
  bundleHandle?: string
  message?: string
  context?: {
    repo: { id: string; name: string }
    view: string
    selectedNodeId?: string
    symbols: Array<{ id: string; name: string; kind: string; file?: string; line?: number }>
    files: string[]
    truncated: boolean
    insufficiencyReason?: string
  }
  citations?: Array<{ nodeId?: string; file?: string; line?: number }>
}
