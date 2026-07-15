import type { Page, Route } from "@playwright/test"

type StatusScenario =
  | "ready"
  | "stale"
  | "indexing"
  | "empty"
  | "unauthorized"
  | "unavailable"
  | "missing"

interface MockOptions {
  status?: StatusScenario
  chatState?: "enabled" | "dormant" | "misconfigured" | "disabled" | "rate_limited"
}

const repository = {
  id: "self",
  root: "/workspace/codegraph",
  name: "codegraph",
  default: true,
}

const primaryNode = {
  id: "node-a",
  kind: "function",
  name: "startWebServer",
  file: "src/server/index.ts",
  line: 292,
  signature: "export async function startWebServer(options: ServerOptions): Promise<void>",
}

const secondaryNode = {
  id: "node-b",
  kind: "function",
  name: "handleApiRequest",
  file: "src/server/routes.ts",
  line: 182,
  signature: "export async function handleApiRequest(routes, ctx, security)",
}

const graph = {
  nodes: [primaryNode, secondaryNode],
  edges: [{ source: primaryNode.id, target: secondaryNode.id, kind: "calls" }],
  truncated: false,
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  })
}

function statusBody(scenario: StatusScenario) {
  const base = {
    version: "1.4.1",
    repo: repository,
    hybridSearch: { available: true },
    lsp: { available: true },
  }

  if (scenario === "empty") {
    return { ...base, index: { state: "ready", fileCount: 0, nodeCount: 0, edgeCount: 0, lastIndexed: null } }
  }

  return {
    ...base,
    index: {
      state: scenario === "stale" ? "stale" : scenario === "indexing" ? "indexing" : "ready",
      fileCount: 128,
      nodeCount: 640,
      edgeCount: 915,
      lastIndexed: "2026-07-15T22:00:00Z",
    },
  }
}

export async function installApiMocks(page: Page, options: MockOptions = {}) {
  const status = options.status ?? "ready"
  const chatState = options.chatState ?? "enabled"

  await page.route("**/api/**", (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (path === "/api/repos") {
      return json(route, status === "missing" ? [] : [repository])
    }

    if (path === "/api/status") {
      if (status === "unauthorized") {
        return json(route, { error: { code: "unauthorized", message: "Token required." } }, 401)
      }
      if (status === "unavailable") {
        return json(route, { error: { code: "unavailable", message: "The local CodeGraph server is unreachable." } }, 503)
      }
      if (status === "missing") {
        return json(route, { error: { code: "not_found", message: "No repository is selected." } }, 404)
      }
      return json(route, statusBody(status))
    }

    if (path === "/api/search") {
      return json(route, { items: [primaryNode], total: 1, limit: 50, offset: 0, degraded: false })
    }

    if (path.startsWith("/api/node/")) {
      return json(route, primaryNode)
    }

    if (path.startsWith("/api/callers/")) {
      return json(route, { items: [secondaryNode], total: 1, limit: 50, offset: 0 })
    }

    if (path.startsWith("/api/callees/")) {
      return json(route, { items: [secondaryNode], total: 1, limit: 50, offset: 0 })
    }

    if (path === "/api/flows") {
      return json(route, {
        items: [{ id: "startup", name: "Startup flow", entryKind: "cli", stepCount: 2, truncated: false }],
        total: 1,
        limit: 50,
        offset: 0,
        sourceVersion: 1,
        state: "available",
      })
    }

    if (path.startsWith("/api/flows/")) {
      return json(route, {
        id: "startup",
        name: "Startup flow",
        entryKind: "cli",
        root: { nodeId: primaryNode.id, name: primaryNode.name, kind: primaryNode.kind },
        steps: [],
        truncated: false,
        truncation: { depth: false, width: false, totalSteps: false },
        sourceVersion: 1,
        state: "available",
      })
    }

    if (path === "/api/clusters") {
      return json(route, {
        items: [{ id: "server", canonicalLabel: "server", displayLabel: "Server", memberCount: 2, isSingleton: false }],
        total: 1,
        limit: 50,
        offset: 0,
        sourceVersion: 1,
        state: "available",
      })
    }

    if (path.startsWith("/api/graph/") || path.startsWith("/api/impact/")) {
      return json(route, graph)
    }

    if (path === "/api/chat/status") {
      return json(route, {
        state: chatState,
        message: chatState === "enabled" ? "Graph chat is ready." : `Graph chat is ${chatState}.`,
        providerConfigured: chatState === "enabled",
      })
    }

    if (path === "/api/chat/messages" && request.method() === "POST") {
      return json(route, {
        state: "answer",
        answer: "startWebServer wires the local API routes and serves the packaged web UI.",
        citations: [{ nodeId: primaryNode.id, file: primaryNode.file, line: primaryNode.line }],
      })
    }

    if (path.startsWith("/api/chat/bundles/")) {
      return json(route, { state: "fallback", message: "Bundle redeemed through local backend." })
    }

    if (path.startsWith("/api/reindex/") && request.method() === "POST") {
      return json(route, {
        id: "job-1",
        repo: repository.id,
        mode: url.searchParams.get("full") === "true" ? "full" : "sync",
        status: "running",
        startedAt: "2026-07-15T22:00:00Z",
      })
    }

    return json(route, { error: { code: "not_found", message: `No mock for ${path}.` } }, 404)
  })
}

export function collectExternalRequests(page: Page, baseURL: string) {
  const externalRequests: string[] = []
  const origin = new URL(baseURL).origin
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.origin !== origin) {
      externalRequests.push(request.url())
    }
  })
  return externalRequests
}
