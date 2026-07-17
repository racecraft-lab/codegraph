export interface LspPosition {
  line: number
  character: number
}

export interface LspRange {
  start: LspPosition
  end: LspPosition
}

export interface LspLocation {
  uri: string
  range: LspRange
}

export interface SourceSnapshot {
  text: string
  languageId: string
  contentHash: string
  snapshotToken: string
}

export interface HoverResult {
  contents: { kind: "markdown"; value: string }
}

export interface BrowserLspApi {
  connect(): Promise<void>
  content(uri: string): Promise<SourceSnapshot>
  hover(uri: string, position: LspPosition): Promise<HoverResult | null>
  definition(uri: string, position: LspPosition): Promise<LspLocation | null>
  references(uri: string, position: LspPosition): Promise<LspLocation[]>
  symbolLocation(nodeId: string, name: string): Promise<LspLocation | null>
  onDisconnect(listener: () => void): () => void
  close(): Promise<void>
}

export class BrowserLspError extends Error {
  readonly state: "stale" | "timed-out" | "unavailable" | "disconnected"
  readonly code?: number
  readonly reason?: string

  constructor(
    state: "stale" | "timed-out" | "unavailable" | "disconnected",
    code?: number,
    reason?: string,
  ) {
    super(state)
    this.state = state
    this.code = code
    this.reason = reason
  }
}

type PendingRequest = {
  resolve(value: unknown): void
  reject(error: BrowserLspError): void
  timer: ReturnType<typeof setTimeout>
}

export class BrowserLspClient implements BrowserLspApi {
  private socket: WebSocket | null = null
  private connecting: Promise<void> | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private deliberatelyClosing = false
  private readonly disconnectListeners = new Set<() => void>()
  private readonly repoId: string
  private readonly socketFactory: (url: string) => WebSocket

  constructor(
    repoId: string,
    socketFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {
    this.repoId = repoId
    this.socketFactory = socketFactory
  }

  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve()
    if (this.connecting) return this.connecting
    this.deliberatelyClosing = false
    this.connecting = new Promise<void>((resolve, reject) => {
      const url = new URL("/lsp", window.location.href)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      url.searchParams.set("repo", this.repoId)
      const socket = this.socketFactory(url.href)
      this.socket = socket
      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener("error", () => reject(new BrowserLspError("unavailable")), { once: true })
      socket.addEventListener("message", (event) => this.receive(event.data))
      socket.addEventListener("close", () => this.disconnected())
    }).then(async () => {
      await this.request("initialize", {})
      this.notify("initialized", {})
    }).finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  content(uri: string): Promise<SourceSnapshot> {
    return this.request("codegraph/textDocumentContent", { textDocument: { uri } })
  }

  hover(uri: string, position: LspPosition): Promise<HoverResult | null> {
    return this.request("textDocument/hover", { textDocument: { uri }, position })
  }

  definition(uri: string, position: LspPosition): Promise<LspLocation | null> {
    return this.request("textDocument/definition", { textDocument: { uri }, position })
  }

  references(uri: string, position: LspPosition): Promise<LspLocation[]> {
    return this.request("textDocument/references", {
      textDocument: { uri },
      position,
      context: { includeDeclaration: true },
    })
  }

  async symbolLocation(nodeId: string, name: string): Promise<LspLocation | null> {
    const symbols = await this.request<unknown[]>("workspace/symbol", { query: name })
    for (const symbol of symbols) {
      if (!isRecord(symbol) || !isRecord(symbol.data) || symbol.data.codegraphNodeId !== nodeId) continue
      if (isLocation(symbol.location)) return symbol.location
    }
    return null
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  async close(): Promise<void> {
    this.deliberatelyClosing = true
    const socket = this.socket
    if (!socket) return
    if (socket.readyState === WebSocket.OPEN) {
      try { await this.request("shutdown") } catch { /* teardown is best-effort */ }
      this.notify("exit")
      socket.close(1000, "client shutdown")
    } else if (socket.readyState === WebSocket.CONNECTING) {
      socket.close()
    }
    this.socket = null
    this.rejectPending(new BrowserLspError("disconnected"))
  }

  private request<T>(method: string, params?: object): Promise<T> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new BrowserLspError("disconnected"))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BrowserLspError("timed-out", -32803, "timeout"))
      }, 5_000)
      this.pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }))
    })
  }

  private notify(method: string, params?: object): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }))
  }

  private receive(raw: unknown): void {
    if (typeof raw !== "string") return
    let message: unknown
    try { message = JSON.parse(raw) } catch { return }
    if (!isRecord(message) || typeof message.id !== "number") return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (isRecord(message.error)) {
      const code = typeof message.error.code === "number" ? message.error.code : undefined
      const data = isRecord(message.error.data) ? message.error.data : undefined
      const reason = typeof data?.reason === "string" ? data.reason : undefined
      const state = code === -32801 ? "stale" : reason === "timeout" ? "timed-out" : "unavailable"
      pending.reject(new BrowserLspError(state, code, reason))
      return
    }
    pending.resolve(message.result)
  }

  private disconnected(): void {
    this.socket = null
    this.rejectPending(new BrowserLspError("disconnected"))
    if (!this.deliberatelyClosing) {
      for (const listener of this.disconnectListeners) listener()
    }
  }

  private rejectPending(error: BrowserLspError): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isLocation(value: unknown): value is LspLocation {
  if (!isRecord(value) || typeof value.uri !== "string" || !isRecord(value.range)) return false
  const { start, end } = value.range
  return isPosition(start) && isPosition(end)
}

function isPosition(value: unknown): value is LspPosition {
  return isRecord(value) && typeof value.line === "number" && Number.isSafeInteger(value.line) && value.line >= 0
    && typeof value.character === "number" && Number.isSafeInteger(value.character) && value.character >= 0
}
