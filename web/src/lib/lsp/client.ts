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
  snapshotToken?: string
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
  hover(uri: string, position: LspPosition, snapshotToken: string, signal?: AbortSignal): Promise<HoverResult | null>
  definition(uri: string, position: LspPosition, snapshotToken: string): Promise<LspLocation | null>
  references(uri: string, position: LspPosition, snapshotToken: string): Promise<LspLocation[]>
  symbolLocation(nodeId: string): Promise<LspLocation | null>
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
  cleanup(): void
}

const MAX_PENDING_REQUESTS = 8
const MAX_BUFFERED_BYTES = 1024 * 1024
const REQUEST_DEADLINE_MS = 5_000

export class BrowserLspClient implements BrowserLspApi {
  private socket: WebSocket | null = null
  private connecting: Promise<void> | null = null
  private cancelConnecting: ((error: BrowserLspError) => void) | null = null
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
    if (this.connecting) return this.connecting
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve()
    this.deliberatelyClosing = false
    let connectingSocket: WebSocket | null = null
    this.connecting = new Promise<void>((resolve, reject) => {
      const url = new URL("/lsp", window.location.href)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      url.searchParams.set("repo", this.repoId)
      const socket = this.socketFactory(url.href)
      connectingSocket = socket
      this.socket = socket
      let opened = false
      let settled = false
      let connectionTimer: ReturnType<typeof setTimeout> | null = null
      const rejectConnection = (error: BrowserLspError) => {
        if (settled) return
        settled = true
        if (connectionTimer) clearTimeout(connectionTimer)
        connectionTimer = null
        socket.removeEventListener("open", onOpen)
        socket.removeEventListener("error", onError)
        reject(error)
      }
      const onOpen = () => {
        if (this.socket !== socket) return
        opened = true
        settled = true
        if (connectionTimer) clearTimeout(connectionTimer)
        connectionTimer = null
        socket.removeEventListener("error", onError)
        resolve()
      }
      const onError = () => {
        if (this.socket !== socket || opened) return
        this.socket = null
        rejectConnection(new BrowserLspError("unavailable"))
      }
      this.cancelConnecting = (error) => rejectConnection(error)
      socket.addEventListener("open", onOpen, { once: true })
      socket.addEventListener("error", onError, { once: true })
      socket.addEventListener("message", (event) => {
        if (this.socket === socket) this.receive(event.data)
      })
      socket.addEventListener("close", () => {
        if (this.socket !== socket) return
        if (!opened) {
          this.socket = null
          rejectConnection(new BrowserLspError("unavailable"))
          return
        }
        this.disconnected(socket)
      })
      connectionTimer = setTimeout(() => {
        if (this.socket !== socket || opened) return
        rejectConnection(new BrowserLspError("timed-out", -32803, "timeout"))
        try { socket.close() } catch { /* the stalled connection is unusable */ }
      }, REQUEST_DEADLINE_MS)
    }).then(async () => {
      await this.request("initialize", {})
      if (!this.notify("initialized", {})) throw new BrowserLspError("unavailable")
    }).catch((error: unknown) => {
      const socket = connectingSocket
      if (socket && this.socket === socket) {
        this.socket = null
        this.rejectPending(new BrowserLspError("disconnected"))
        try {
          if (socket.readyState === WebSocket.OPEN) socket.close(1011, "initialization failed")
          else if (socket.readyState === WebSocket.CONNECTING) socket.close()
        } catch { /* the failed connection is already unusable */ }
      }
      throw error
    }).finally(() => {
      this.cancelConnecting = null
      this.connecting = null
    })
    return this.connecting
  }

  content(uri: string): Promise<SourceSnapshot> {
    return this.request("codegraph/textDocumentContent", { textDocument: { uri } })
  }

  hover(uri: string, position: LspPosition, snapshotToken: string, signal?: AbortSignal): Promise<HoverResult | null> {
    return this.request("textDocument/hover", { textDocument: { uri }, position, snapshotToken }, signal)
  }

  definition(uri: string, position: LspPosition, snapshotToken: string): Promise<LspLocation | null> {
    return this.request("textDocument/definition", { textDocument: { uri }, position, snapshotToken })
  }

  references(uri: string, position: LspPosition, snapshotToken: string): Promise<LspLocation[]> {
    return this.request("textDocument/references", {
      textDocument: { uri },
      position,
      snapshotToken,
      context: { includeDeclaration: true },
    })
  }

  async symbolLocation(nodeId: string): Promise<LspLocation | null> {
    const symbols = await this.request<unknown[]>("workspace/symbol", { query: "", nodeId })
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
    const connecting = this.connecting
    if (connecting) {
      const error = new BrowserLspError("disconnected")
      this.cancelConnecting?.(error)
      this.socket = null
      this.rejectPending(error)
      try { socket.close() } catch { /* the canceled connection is already unusable */ }
      await connecting.catch(() => undefined)
      return
    }
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

  private request<T>(method: string, params?: object, signal?: AbortSignal): Promise<T> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new BrowserLspError("disconnected"))
    }
    if (signal?.aborted) {
      return Promise.reject(new BrowserLspError("unavailable", -32800, "cancelled"))
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new BrowserLspError("unavailable", -32803, "busy"))
    }
    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })
    if (socket.bufferedAmount + utf8Bytes(payload) > MAX_BUFFERED_BYTES) {
      return Promise.reject(new BrowserLspError("unavailable", -32803, "backpressure"))
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return
        cleanup()
        reject(new BrowserLspError("timed-out", -32803, "timeout"))
      }, REQUEST_DEADLINE_MS)
      const onAbort = () => {
        if (!this.pending.delete(id)) return
        cleanup()
        this.notify("$/cancelRequest", { id })
        reject(new BrowserLspError("unavailable", -32800, "cancelled"))
      }
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
      }
      this.pending.set(id, { resolve, reject, timer, cleanup })
      signal?.addEventListener("abort", onAbort, { once: true })
      try {
        socket.send(payload)
      } catch {
        if (this.pending.delete(id)) cleanup()
        reject(new BrowserLspError("disconnected"))
      }
    })
  }

  private notify(method: string, params?: object): boolean {
    const socket = this.socket
    if (socket?.readyState !== WebSocket.OPEN) return false
    const payload = JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })
    if (socket.bufferedAmount + utf8Bytes(payload) > MAX_BUFFERED_BYTES) return false
    try {
      socket.send(payload)
      return true
    } catch {
      return false
    }
  }

  private receive(raw: unknown): void {
    if (typeof raw !== "string") return
    let message: unknown
    try { message = JSON.parse(raw) } catch { return }
    if (!isRecord(message) || typeof message.id !== "number") return
    const pending = this.pending.get(message.id)
    if (!pending) return
    pending.cleanup()
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

  private disconnected(socket: WebSocket): void {
    if (this.socket !== socket) return
    this.socket = null
    this.rejectPending(new BrowserLspError("disconnected"))
    if (!this.deliberatelyClosing) {
      for (const listener of this.disconnectListeners) listener()
    }
  }

  private rejectPending(error: BrowserLspError): void {
    for (const pending of this.pending.values()) {
      pending.cleanup()
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
    && typeof value.snapshotToken === "string" && value.snapshotToken.length > 0
}

function isPosition(value: unknown): value is LspPosition {
  return isRecord(value) && typeof value.line === "number" && Number.isSafeInteger(value.line) && value.line >= 0
    && typeof value.character === "number" && Number.isSafeInteger(value.character) && value.character >= 0
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
