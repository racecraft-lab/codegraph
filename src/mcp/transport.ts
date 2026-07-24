/**
 * MCP JSON-RPC Transports
 *
 * Two flavors share the same wire format (newline-delimited JSON-RPC 2.0):
 *
 * - `StdioTransport` — original transport; reads/writes the process's
 *   stdin/stdout. Used by direct-mode MCP servers.
 * - `SocketTransport` — wraps a single `net.Socket`. Used by the shared-daemon
 *   architecture (see {@link ./daemon}) to multiplex multiple MCP clients onto
 *   one CodeGraph instance via per-connection sessions.
 *
 * Both implement {@link JsonRpcTransport} so the session-level protocol logic
 * (initialize / tools/list / tools/call, plus server-initiated `roots/list`)
 * is identical regardless of where the bytes come from.
 */

import * as readline from 'readline';
import type { Socket } from 'net';

/**
 * JSON-RPC 2.0 Request
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

/**
 * JSON-RPC 2.0 Response
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

/**
 * JSON-RPC 2.0 Error
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * JSON-RPC 2.0 Notification (no id, no response expected)
 */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

// Standard JSON-RPC error codes
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

export type MessageHandler = (
  message: JsonRpcRequest | JsonRpcNotification,
  signal?: AbortSignal,
) => Promise<void>;
export type SocketDiagnosticSink = (
  code: 'socket_failure' | 'socket_input_overflow' | 'socket_output_overflow' | 'socket_output_timeout'
) => void;

// Shared-daemon JSON-RPC is newline-delimited. Seven-MiB trusted LSP read
// responses must fit, while both an unterminated input and queued output stay
// bounded per client connection. Daemon-side transports override the input
// limits because client requests are small while responses may legitimately be
// much larger.
const MAX_SOCKET_LINE_BYTES = 8 * 1024 * 1024;
const MAX_SOCKET_RETAINED_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_SOCKET_BUFFERED_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_SOCKET_IN_FLIGHT_MESSAGES = 32;
const MAX_SOCKET_BUFFERED_MESSAGES = 4_096;
export const MAX_SOCKET_EMERGENCY_OUTPUT_BYTES = 4 * 1024;
const SOCKET_DRAIN_DEADLINE_MS = 5_000;

export interface SocketTransportOptions {
  maxInputLineBytes?: number;
  maxRetainedInputBytes?: number;
  maxActiveMessages?: number;
  requestBudget?: SocketRequestBudget;
  outputBudget?: SocketOutputBudget;
  /**
   * Optionally inspect the first complete (or probe-limit-exceeding) input
   * buffer before ordinary shared-budget accounting. Returning true consumes
   * it. Daemon mode uses this only after mutual authentication for shutdown.
   */
  handleFirstMessage?: (buffered: Buffer) => boolean;
  firstMessageProbeBytes?: number;
}

/**
 * Shared accounting for bytes retained by socket input and handlers currently
 * executing against those messages. A daemon injects one budget into every
 * client transport so many authenticated peers cannot multiply the per-socket
 * ceilings into unbounded aggregate work.
 */
export class SocketRequestBudget {
  private retainedBytes = 0;
  private activeMessages = 0;
  private readonly waiterQueue: Array<(release: () => void) => void> = [];
  private readonly queuedWaiters = new Set<(release: () => void) => void>();
  private readonly pendingGrants = new Map<(release: () => void) => void, () => void>();

  constructor(
    private readonly maxActiveMessages: number,
    private readonly maxRetainedBytes: number,
  ) {}

  reserveBytes(bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0) return false;
    if (this.retainedBytes + bytes > this.maxRetainedBytes) return false;
    this.retainedBytes += bytes;
    return true;
  }

  releaseBytes(bytes: number): void {
    this.retainedBytes = Math.max(0, this.retainedBytes - bytes);
  }

  startMessage(onGranted: (release: () => void) => void): (() => void) | null {
    if (this.queuedWaiters.has(onGranted) || this.pendingGrants.has(onGranted)) {
      return null;
    }
    if (this.activeMessages < this.maxActiveMessages && this.queuedWaiters.size === 0) {
      return this.allocateLease();
    }
    this.waiterQueue.push(onGranted);
    this.queuedWaiters.add(onGranted);
    this.grantWaiters();
    return null;
  }

  cancelWait(onGranted: (release: () => void) => void): void {
    if (this.queuedWaiters.delete(onGranted)) {
      const index = this.waiterQueue.indexOf(onGranted);
      if (index >= 0) this.waiterQueue.splice(index, 1);
    }
    const grant = this.pendingGrants.get(onGranted);
    if (!grant) return;
    this.pendingGrants.delete(onGranted);
    grant();
  }

  isSaturated(additionalBytes = 0): boolean {
    if (!Number.isSafeInteger(additionalBytes) || additionalBytes < 0) return true;
    return this.activeMessages >= this.maxActiveMessages
      || this.retainedBytes + additionalBytes > this.maxRetainedBytes;
  }

  snapshot(): { activeMessages: number; retainedBytes: number } {
    return { activeMessages: this.activeMessages, retainedBytes: this.retainedBytes };
  }

  private allocateLease(): () => void {
    this.activeMessages += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeMessages = Math.max(0, this.activeMessages - 1);
      this.grantWaiters();
    };
  }

  private grantWaiters(): void {
    while (this.activeMessages < this.maxActiveMessages && this.queuedWaiters.size > 0) {
      let onGranted: ((release: () => void) => void) | undefined;
      while (this.waiterQueue.length > 0 && !onGranted) {
        const candidate = this.waiterQueue.shift()!;
        if (!this.queuedWaiters.delete(candidate)) continue;
        onGranted = candidate;
      }
      if (!onGranted) return;
      const grant = this.allocateLease();
      this.pendingGrants.set(onGranted, grant);
      queueMicrotask(() => {
        if (this.pendingGrants.get(onGranted!) !== grant) return;
        this.pendingGrants.delete(onGranted!);
        try {
          onGranted!(grant);
        } catch {
          grant();
        }
      });
    }
  }
}

/**
 * Shared accounting for serialized response bytes retained by socket write
 * queues. A daemon injects one budget into every client transport so a wave of
 * individually-valid large responses cannot multiply the per-socket ceiling
 * into unbounded aggregate memory.
 */
export class SocketOutputBudget {
  private retainedBytes = 0;

  constructor(
    private readonly maxRetainedBytes: number,
    private readonly emergencyRetainedBytes = 0,
  ) {}

  reserveBytes(bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0) return false;
    const normalLimit = Math.max(0, this.maxRetainedBytes - this.emergencyRetainedBytes);
    if (this.retainedBytes + bytes > normalLimit) return false;
    this.retainedBytes += bytes;
    return true;
  }

  reserveEmergencyBytes(bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0) return false;
    if (this.retainedBytes + bytes > this.maxRetainedBytes) return false;
    this.retainedBytes += bytes;
    return true;
  }

  releaseBytes(bytes: number): void {
    this.retainedBytes = Math.max(0, this.retainedBytes - bytes);
  }

  snapshot(): { retainedBytes: number } {
    return { retainedBytes: this.retainedBytes };
  }
}

/**
 * Generic JSON-RPC transport interface — common surface for stdio and socket
 * carriers. Anything below the session layer (initialize, tool dispatch, etc.)
 * talks to this, not to a concrete transport class.
 */
export interface JsonRpcTransport {
  start(handler: MessageHandler): void;
  stop(): void;
  send(response: JsonRpcResponse): void;
  notify(method: string, params?: unknown): void;
  request(method: string, params?: unknown, timeoutMs?: number, signal?: AbortSignal): Promise<unknown>;
  sendResult(id: string | number, result: unknown): void;
  /** Resolve after the response write flushes; socket transports provide this. */
  sendResultAndWait?(
    id: string | number,
    result: unknown,
    options?: { preserveOnOverload?: boolean },
  ): Promise<void>;
  sendError(id: string | number | null, code: number, message: string, data?: unknown): void;
}

/**
 * Shared implementation of newline-delimited JSON-RPC 2.0 over any
 * `Readable`/`Writable` stream pair. Stdio and socket transports both wrap
 * this — the only difference between them is which streams get plugged in
 * and how a "close" propagates back to the owning code.
 */
abstract class LineBasedJsonRpcTransport implements JsonRpcTransport {
  protected messageHandler: MessageHandler | null = null;
  // Outstanding server-initiated requests (e.g. roots/list), keyed by the id
  // we sent. Responses from the client are matched back here.
  protected pending = new Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  protected nextRequestId = 1;
  protected stopped = false;

  abstract start(handler: MessageHandler): void;
  protected abstract write(line: string): void;
  protected abstract idPrefix(): string;
  abstract stop(): void;

  /**
   * Send a server-initiated request to the client and await its response.
   *
   * MCP is bidirectional: the server can ask the client questions too. We use
   * this for `roots/list` — the spec-blessed way to learn the workspace root
   * when the client didn't pass one in `initialize` (see issue #196). Rejects
   * on timeout so callers can fall back rather than hang forever.
   */
  request(method: string, params?: unknown, timeoutMs = 5000, signal?: AbortSignal): Promise<unknown> {
    // A stopped transport can never deliver a response — reject at once rather than
    // register a pending request that only rejects when its timeout elapses. This
    // lets a caller that calls stop() to abort an in-flight round-trip (e.g. the
    // web server's shutdown-aborted watcher re-arm) fail fast instead of holding a
    // dead socket for the full timeout.
    if (this.stopped) return Promise.reject(new Error('Transport stopped'));
    if (signal?.aborted) return Promise.reject(new Error('Request aborted'));
    const id = `${this.idPrefix()}-${this.nextRequestId++}`;
    return new Promise<unknown>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) this.onPendingRequestsChanged();
        cleanup();
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${method}" response`));
      }, timeoutMs);
      const onAbort = (): void => {
        if (!this.pending.delete(id)) return;
        this.onPendingRequestsChanged();
        cleanup();
        reject(new Error('Request aborted'));
      };
      // Don't let a pending request keep the process alive on shutdown.
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => { cleanup(); resolve(value); },
        reject: (error) => { cleanup(); reject(error); },
      });
      this.onPendingRequestsChanged();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      if (this.pending.has(id)) this.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  send(response: JsonRpcResponse): void {
    this.write(JSON.stringify(response));
  }

  notify(method: string, params?: unknown): void {
    const notification: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    this.write(JSON.stringify(notification));
  }

  sendResult(id: string | number, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result });
  }

  sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
    this.send({ jsonrpc: '2.0', id, error: { code, message, data } });
  }

  /**
   * Fail any in-flight server-initiated requests so their awaiters don't hang.
   * Called from `stop()` in subclasses.
   */
  protected rejectPending(reason: string): void {
    if (this.pending.size === 0) return;
    const pending = [...this.pending.values()];
    this.pending.clear();
    this.onPendingRequestsChanged();
    for (const { reject } of pending) {
      reject(new Error(reason));
    }
  }

  protected hasPendingRequests(): boolean {
    return this.pending.size > 0;
  }

  protected onPendingRequestsChanged(): void {
    // Socket transports override this to keep control responses flowing while
    // ordinary request handlers are saturated.
  }

  protected parseResponseLine(line: string): Record<string, unknown> | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    return this.isResponse(parsed) ? parsed as Record<string, unknown> : null;
  }

  /**
   * Handle an incoming line of JSON. Both transports feed lines here.
   */
  protected async handleLine(line: string, signal?: AbortSignal): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.sendError(null, ErrorCodes.ParseError, 'Parse error: invalid JSON');
      return;
    }

    // Response to a server-initiated request (has id + result/error, no method).
    // Route it to the awaiting requester instead of the message handler — these
    // used to be dropped as "Invalid Request" because they carry no method.
    if (this.isResponse(parsed)) {
      this.tryHandlePendingResponse(parsed);
      return;
    }

    // Validate basic JSON-RPC structure
    if (!this.isValidMessage(parsed)) {
      this.sendError(null, ErrorCodes.InvalidRequest, 'Invalid Request: not a valid JSON-RPC 2.0 message');
      return;
    }

    if (this.messageHandler) {
      try {
        if (process.env.CODEGRAPH_MCP_DEBUG) {
          const m = parsed as { method?: string; id?: unknown };
          process.stderr.write(`[mcp-debug] recv method=${m.method} id=${String(m.id)}\n`);
        }
        await this.messageHandler(parsed as JsonRpcRequest | JsonRpcNotification, signal);
        if (process.env.CODEGRAPH_MCP_DEBUG) {
          const m = parsed as { method?: string; id?: unknown };
          process.stderr.write(`[mcp-debug] handled method=${m.method} id=${String(m.id)}\n`);
        }
      } catch (err) {
        const message = parsed as JsonRpcRequest;
        if ('id' in message) {
          this.sendError(
            message.id,
            ErrorCodes.InternalError,
            `Internal error: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }

  /**
   * Resolve (or reject) the pending server-initiated request matching this
   * response's id. Unknown ids are ignored — the client may echo something we
   * never sent, or a request may have already timed out.
   */
  protected tryHandlePendingResponse(msg: unknown): boolean {
    if (!this.isResponse(msg)) return false;
    const response = msg as Record<string, unknown>;
    const id = response.id as string | number;
    const pending = this.pending.get(id);
    if (!pending) return false;
    this.pending.delete(id);
    this.onPendingRequestsChanged();
    if ('error' in response && response.error) {
      const err = response.error as { message?: string };
      pending.reject(new Error(err.message || 'Request failed'));
    } else {
      pending.resolve(response.result);
    }
    return true;
  }

  private isResponse(msg: unknown): boolean {
    if (typeof msg !== 'object' || msg === null) return false;
    const response = msg as Record<string, unknown>;
    return response.jsonrpc === '2.0'
      && typeof response.method !== 'string'
      && 'id' in response
      && ('result' in response || 'error' in response);
  }

  /**
   * Check if message is a valid JSON-RPC 2.0 message
   */
  private isValidMessage(msg: unknown): boolean {
    if (typeof msg !== 'object' || msg === null) return false;
    const obj = msg as Record<string, unknown>;
    if (obj.jsonrpc !== '2.0') return false;
    if (typeof obj.method !== 'string') return false;
    return true;
  }
}

export interface StdioTransportOptions {
  /**
   * If true, the transport calls `process.exit(0)` when stdin closes. Set to
   * `false` in shared-daemon mode where the stdio "session" is just *one* of
   * many clients — losing it shouldn't drag the daemon down. The default
   * (true) matches the original single-process behavior callers rely on.
   */
  exitOnClose?: boolean;
  /**
   * Optional callback fired when the stdin stream closes. The daemon uses
   * this to decrement its connected-clients refcount.
   */
  onClose?: () => void;
}

/**
 * Stdio Transport for MCP
 *
 * Reads JSON-RPC messages from stdin and writes responses to stdout. Used by
 * the direct (single-process) MCP server path, where the MCP host launches
 * one server per session and talks to it over the child's stdio. Also used by
 * shared-daemon mode for the launcher's session (with `exitOnClose: false`)
 * so the daemon outlives its launcher.
 */
export class StdioTransport extends LineBasedJsonRpcTransport {
  private rl: readline.Interface | null = null;
  private opts: Required<StdioTransportOptions>;

  constructor(opts: StdioTransportOptions = {}) {
    super();
    this.opts = {
      exitOnClose: opts.exitOnClose ?? true,
      onClose: opts.onClose ?? (() => { /* no-op */ }),
    };
  }

  start(handler: MessageHandler): void {
    this.messageHandler = handler;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on('line', async (line) => {
      await this.handleLine(line);
    });

    // readline 'close' fires on a clean stdin EOF. But a socket-backed stdin
    // (the VS Code stdio shape) can fail with an 'error' (ECONNRESET/hangup)
    // that readline doesn't surface as 'close' — unhandled, it escalated to
    // the global uncaughtException handler (which keeps running), orphaning
    // the server and, on Linux, busy-spinning a POLLHUP fd at 100% CPU. Treat
    // 'error' as terminal too, and destroy stdin so the fd leaves epoll (#799).
    let closed = false;
    const onStreamEnd = (): void => {
      if (closed) return;
      closed = true;
      try { process.stdin.destroy(); } catch { /* already gone */ }
      this.opts.onClose();
      if (this.opts.exitOnClose) {
        process.exit(0);
      }
    };
    this.rl.on('close', onStreamEnd);
    process.stdin.on('error', onStreamEnd);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.rejectPending('Transport stopped');
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  protected write(line: string): void {
    process.stdout.write(line + '\n');
  }

  protected idPrefix(): string {
    return 'cg-srv';
  }
}

/**
 * Socket Transport for MCP daemon sessions.
 *
 * Wraps a single `net.Socket` (Unix domain socket on POSIX, named pipe on
 * Windows). One instance per connected MCP client. Unlike {@link StdioTransport},
 * `stop()` and stream-close *don't* call `process.exit` — a daemon-side session
 * ending must not bring down the whole daemon.
 */
export class SocketTransport extends LineBasedJsonRpcTransport {
  private buffer = '';
  private readonly inboundQueue: SocketInputItem[] = [];
  private bufferedInputBytes = 0;
  private activeInputBytes = 0;
  private activeHandlers = 0;
  private budgetBlocked = false;
  private rescanningPendingResponses = false;
  private inputPaused = false;
  private outputBlocked = false;
  private outputDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSocketWrites = 0;
  private readonly outboundQueue: SocketOutputItem[] = [];
  private readonly inFlightOutput = new Set<SocketOutputItem>();
  private queuedOutboundBytes = 0;
  private retainedOutboundBytes = 0;
  private readonly activeMessageWork = new Set<{
    controller: AbortController;
    release: () => void;
  }>();
  private closeHandlers: Array<() => void> = [];
  private readonly maxInputLineBytes: number;
  private readonly maxRetainedInputBytes: number;
  private readonly maxActiveMessages: number;
  private readonly requestBudget: SocketRequestBudget;
  private readonly outputBudget: SocketOutputBudget;
  private readonly handleFirstMessage: ((buffered: Buffer) => boolean) | null;
  private readonly firstMessageProbeBytes: number;
  private firstMessageBuffer = '';
  private firstMessageProbed = false;
  private firstMessageHandled = false;
  private emergencyOutboundBytes = 0;

  constructor(
    private socket: Socket,
    private prefix: string = 'cg-sock',
    private diagnostics: SocketDiagnosticSink = (code) => {
      process.stderr.write(`[CodeGraph daemon] ${code}\n`);
    },
    options: SocketTransportOptions = {},
  ) {
    super();
    this.maxInputLineBytes = options.maxInputLineBytes ?? MAX_SOCKET_LINE_BYTES;
    this.maxRetainedInputBytes = options.maxRetainedInputBytes ?? MAX_SOCKET_RETAINED_INPUT_BYTES;
    this.maxActiveMessages = options.maxActiveMessages ?? MAX_SOCKET_IN_FLIGHT_MESSAGES;
    this.requestBudget = options.requestBudget ?? new SocketRequestBudget(
      this.maxActiveMessages,
      this.maxRetainedInputBytes,
    );
    this.outputBudget = options.outputBudget ?? new SocketOutputBudget(
      MAX_SOCKET_BUFFERED_OUTPUT_BYTES,
    );
    this.handleFirstMessage = options.handleFirstMessage ?? null;
    this.firstMessageProbeBytes = options.firstMessageProbeBytes ?? 0;
  }

  /**
   * Register a callback fired exactly once when the socket closes (from either
   * side). Used by the daemon to decrement its connected-clients refcount.
   */
  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  start(handler: MessageHandler): void {
    this.messageHandler = handler;

    this.socket.setEncoding('utf8');
    if (process.env.CODEGRAPH_MCP_DEBUG) {
      process.stderr.write(`[mcp-debug] transport attached flowing=${String(this.socket.readableFlowing)} buffered=${this.socket.readableLength}\n`);
    }
    this.socket.on('data', (chunk: string) => {
      if (this.stopped || this.firstMessageHandled) return;
      if (process.env.CODEGRAPH_MCP_DEBUG) process.stderr.write(`[mcp-debug] transport data ${chunk.length}b\n`);
      let input = chunk;
      if (this.handleFirstMessage && !this.firstMessageProbed) {
        const candidate = this.firstMessageBuffer + chunk;
        const candidateBytes = Buffer.byteLength(candidate, 'utf8');
        if (candidateBytes > this.maxRetainedInputBytes) {
          return this.failSocket('socket_input_overflow');
        }
        const newline = candidate.indexOf('\n');
        if (newline < 0 && candidateBytes <= this.firstMessageProbeBytes) {
          this.firstMessageBuffer = candidate;
          return;
        }
        this.firstMessageProbed = true;
        this.firstMessageBuffer = '';
        try {
          if (this.handleFirstMessage(Buffer.from(candidate, 'utf8'))) {
            this.firstMessageHandled = true;
            return;
          }
        } catch {
          return this.failSocket('socket_failure');
        }
        input = candidate;
      }
      const chunkBytes = Buffer.byteLength(input, 'utf8');
      if (
        this.bufferedInputBytes + this.activeInputBytes + chunkBytes > this.maxRetainedInputBytes ||
        !this.requestBudget.reserveBytes(chunkBytes)
      ) {
        return this.failSocket('socket_input_overflow');
      }
      this.buffer += input;
      this.bufferedInputBytes += chunkBytes;
      this.drainInput();
    });

    this.socket.on('close', () => this.handleSocketClose());
    this.socket.on('error', (err) => {
      // Don't crash the daemon over a broken pipe; just shut this connection.
      if (process.env.CODEGRAPH_MCP_DEBUG) {
        process.stderr.write(`[mcp-debug] transport socket error: ${err.message}\n`);
      } else {
        try { this.diagnostics('socket_failure'); } catch { /* diagnostics are best-effort */ }
      }
      this.handleSocketClose();
    });
    // connectWithHello() can hand off a socket whose close event was absorbed
    // by its connection-window guard before this transport attached listeners.
    // Finalize immediately instead of leaving initialization to time out.
    if (this.socket.destroyed) {
      this.handleSocketClose();
      return;
    }
    // The daemon's hello reader hands the socket over PAUSED (so the unshifted
    // tail can't be emitted to zero listeners and lost — the #662 wedge).
    // Attaching 'data' does not resume an explicitly-paused stream; do it here.
    // Harmless when the socket was never paused.
    this.socket.resume();
  }

  stop(): void {
    if (this.stopped) return;
    this.finalize('Transport stopped');
    if (!this.socket.destroyed) {
      this.socket.end();
      this.socket.destroy();
    }
  }

  /**
   * Write a one-shot line directly to the socket (no JSON-RPC framing applied
   * by this class — caller produces the line). The daemon uses this for the
   * hello/handshake line that precedes the JSON-RPC stream.
   */
  writeRaw(line: string): void {
    void this.enqueueOutput(line.endsWith('\n') ? line : line + '\n').catch(() => undefined);
  }

  protected write(line: string): void {
    void this.enqueueOutput(line + '\n').catch(() => undefined);
  }

  override send(response: JsonRpcResponse): void {
    void this.enqueueOutput(
      this.serializeResponse(response),
      this.serializeOutputOverload(response.id),
    ).catch(() => undefined);
  }

  override sendResult(id: string | number, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result });
  }

  sendResultAndWait(
    id: string | number,
    result: unknown,
    options: { preserveOnOverload?: boolean } = {},
  ): Promise<void> {
    const payload = this.serializeResponse({ jsonrpc: '2.0', id, result });
    return this.enqueueOutput(
      payload,
      options.preserveOnOverload ? payload : this.serializeOutputOverload(id),
    );
  }

  protected idPrefix(): string {
    return this.prefix;
  }

  protected onPendingRequestsChanged(): void {
    if (!this.rescanningPendingResponses) {
      this.rescanningPendingResponses = true;
      try {
        this.consumeQueuedPendingResponses();
      } finally {
        this.rescanningPendingResponses = false;
      }
    }
    this.updateInputFlow();
  }

  private handleSocketClose(): void {
    this.finalize('Socket closed');
  }

  private finalize(reason: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.requestBudget.cancelWait(this.onBudgetGranted);
    this.rejectPending(reason);
    this.firstMessageBuffer = '';
    for (const work of [...this.activeMessageWork]) {
      work.controller.abort();
    }
    this.clearBuffers(reason);
    this.socket.removeListener('drain', this.onDrain);
    for (const h of this.closeHandlers) {
      try { h(); } catch { /* never let a close-handler take the daemon down */ }
    }
    this.closeHandlers = [];
  }

  private drainInput(): void {
    this.frameInput();
    while (
      !this.stopped
      && this.activeHandlers < this.maxActiveMessages
      && this.inboundQueue.length > 0
    ) {
      const releaseMessage = this.requestBudget.startMessage(this.onBudgetGranted);
      if (!releaseMessage) {
        this.budgetBlocked = true;
        break;
      }
      this.budgetBlocked = false;
      this.dispatchInput(this.inboundQueue.shift()!, releaseMessage);
    }
    if (!this.stopped && Buffer.byteLength(this.buffer, 'utf8') > this.maxInputLineBytes) {
      this.failSocket('socket_input_overflow');
      return;
    }
    this.updateInputFlow();
  }

  private frameInput(): void {
    let framedLines = 0;
    while (!this.stopped) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) break;
      if (++framedLines > MAX_SOCKET_BUFFERED_MESSAGES) {
        this.failSocket('socket_input_overflow');
        return;
      }
      const consumed = this.buffer.slice(0, newline + 1);
      const line = consumed.slice(0, -1);
      const consumedBytes = Buffer.byteLength(consumed, 'utf8');
      if (consumedBytes > this.maxInputLineBytes) {
        this.failSocket('socket_input_overflow');
        return;
      }
      this.buffer = this.buffer.slice(newline + 1);
      const response = this.parseResponseLine(line);
      if (!line.trim() || (response !== null && this.tryHandlePendingResponse(response))) {
        this.bufferedInputBytes = Math.max(0, this.bufferedInputBytes - consumedBytes);
        this.requestBudget.releaseBytes(consumedBytes);
        continue;
      }
      if (this.inboundQueue.length >= MAX_SOCKET_BUFFERED_MESSAGES) {
        this.failSocket('socket_input_overflow');
        return;
      }
      this.inboundQueue.push({ line, bytes: consumedBytes, response });
    }
  }

  private consumeQueuedPendingResponses(): void {
    for (let index = 0; index < this.inboundQueue.length;) {
      const item = this.inboundQueue[index]!;
      if (item.response === null || !this.tryHandlePendingResponse(item.response)) {
        index += 1;
        continue;
      }
      this.inboundQueue.splice(index, 1);
      this.bufferedInputBytes = Math.max(0, this.bufferedInputBytes - item.bytes);
      this.requestBudget.releaseBytes(item.bytes);
    }
    if (this.inboundQueue.length === 0 && this.budgetBlocked) {
      this.requestBudget.cancelWait(this.onBudgetGranted);
      this.budgetBlocked = false;
    }
  }

  private dispatchInput(item: SocketInputItem, releaseMessage: () => void): void {
    this.bufferedInputBytes = Math.max(0, this.bufferedInputBytes - item.bytes);
    this.activeInputBytes += item.bytes;
    this.activeHandlers += 1;
    const controller = new AbortController();
    let released = false;
    const work = {
      controller,
      release: (): void => {
        if (released) return;
        released = true;
        this.activeMessageWork.delete(work);
        this.activeHandlers = Math.max(0, this.activeHandlers - 1);
        this.activeInputBytes = Math.max(0, this.activeInputBytes - item.bytes);
        this.requestBudget.releaseBytes(item.bytes);
        releaseMessage();
        this.drainInput();
      },
    };
    this.activeMessageWork.add(work);
    void this.handleLine(item.line, controller.signal).finally(() => {
      work.release();
    });
  }

  private enqueueOutput(payload: string, overloadPayload?: string): Promise<void> {
    if (this.stopped || this.socket.destroyed) return Promise.reject(new Error('Socket closed'));
    let retainedPayload = payload;
    let bytes = Buffer.byteLength(retainedPayload, 'utf8');
    const writableBytes = Number.isSafeInteger(this.socket.writableLength)
      ? this.socket.writableLength
      : 0;
    if (bytes > MAX_SOCKET_LINE_BYTES
      || Math.max(writableBytes + this.queuedOutboundBytes, this.retainedOutboundBytes) + bytes
        > MAX_SOCKET_BUFFERED_OUTPUT_BYTES) {
      this.failSocket('socket_output_overflow');
      return Promise.reject(new Error('Socket output overflow'));
    }
    let emergency = false;
    if (!this.outputBudget.reserveBytes(bytes)) {
      retainedPayload = overloadPayload ?? '';
      bytes = Buffer.byteLength(retainedPayload, 'utf8');
      if (
        !retainedPayload
        || bytes > MAX_SOCKET_LINE_BYTES
        || this.emergencyOutboundBytes + bytes > MAX_SOCKET_EMERGENCY_OUTPUT_BYTES
        || Math.max(writableBytes + this.queuedOutboundBytes, this.retainedOutboundBytes) + bytes
          > MAX_SOCKET_BUFFERED_OUTPUT_BYTES
        || !this.outputBudget.reserveEmergencyBytes(bytes)
      ) {
        this.failSocket('socket_output_overflow');
        return Promise.reject(new Error('Socket output overflow'));
      }
      emergency = true;
      this.emergencyOutboundBytes += bytes;
    }
    return new Promise<void>((resolve, reject) => {
      const item: SocketOutputItem = {
        payload: retainedPayload,
        bytes,
        emergency,
        released: false,
        resolve,
        reject,
      };
      this.retainedOutboundBytes += bytes;
      if (this.outputBlocked || this.outboundQueue.length > 0) {
        this.outboundQueue.push(item);
        this.queuedOutboundBytes += bytes;
        this.updateInputFlow();
        return;
      }
      this.writePayload(item);
    });
  }

  private serializeResponse(response: JsonRpcResponse): string {
    const payload = `${JSON.stringify(response)}\n`;
    if (Buffer.byteLength(payload, 'utf8') <= MAX_SOCKET_LINE_BYTES) return payload;
    return `${JSON.stringify({
      jsonrpc: '2.0',
      id: response.id,
      error: { code: ErrorCodes.InternalError, message: 'Response exceeds transport limit' },
    })}\n`;
  }

  private serializeOutputOverload(id: string | number | null): string {
    return `${JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: 'CodeGraph daemon output capacity exhausted',
        data: { reason: 'overloaded' },
      },
    })}\n`;
  }

  private writePayload(item: SocketOutputItem): void {
    try {
      this.inFlightOutput.add(item);
      this.pendingSocketWrites += 1;
      this.ensureOutputDeadline();
      if (this.socket.write(item.payload, (error) => this.onSocketWriteSettled(item, error))) {
        return;
      }
      this.outputBlocked = true;
      this.ensureOutputDeadline();
      this.socket.once('drain', this.onDrain);
      this.updateInputFlow();
    } catch {
      this.failSocket('socket_failure');
    }
  }

  private readonly onDrain = (): void => {
    if (this.stopped) return;
    this.outputBlocked = false;
    while (!this.outputBlocked && this.outboundQueue.length > 0) {
      const next = this.outboundQueue.shift()!;
      this.queuedOutboundBytes = Math.max(0, this.queuedOutboundBytes - next.bytes);
      this.writePayload(next);
    }
    this.updateOutputDeadlineAfterProgress();
    this.updateInputFlow();
  };

  private onSocketWriteSettled(item: SocketOutputItem, error?: Error | null): void {
    if (error) {
      this.failSocket('socket_failure');
      return;
    }
    this.releaseOutput(item);
    if (this.stopped) return;
    this.pendingSocketWrites = Math.max(0, this.pendingSocketWrites - 1);
    this.updateOutputDeadlineAfterProgress();
  }

  private releaseOutput(item: SocketOutputItem): void {
    if (item.released) return;
    item.released = true;
    this.inFlightOutput.delete(item);
    this.retainedOutboundBytes = Math.max(0, this.retainedOutboundBytes - item.bytes);
    if (item.emergency) {
      this.emergencyOutboundBytes = Math.max(0, this.emergencyOutboundBytes - item.bytes);
    }
    this.outputBudget.releaseBytes(item.bytes);
    item.resolve();
  }

  private ensureOutputDeadline(): void {
    if (this.outputDeadlineTimer) return;
    this.outputDeadlineTimer = setTimeout(() => {
      this.outputDeadlineTimer = null;
      this.failSocket('socket_output_timeout');
    }, SOCKET_DRAIN_DEADLINE_MS);
    this.outputDeadlineTimer.unref?.();
  }

  private updateOutputDeadlineAfterProgress(): void {
    if (this.outputDeadlineTimer) clearTimeout(this.outputDeadlineTimer);
    this.outputDeadlineTimer = null;
    if (this.pendingSocketWrites > 0 || this.outputBlocked || this.outboundQueue.length > 0) {
      this.ensureOutputDeadline();
    }
  }

  private updateInputFlow(): void {
    if (this.stopped || this.socket.destroyed) return;
    const shouldPause = this.outputBlocked
      || this.outboundQueue.length > 0
      || ((this.budgetBlocked || this.activeHandlers >= this.maxActiveMessages)
        && !this.hasPendingRequests());
    if (shouldPause && !this.inputPaused) {
      this.inputPaused = true;
      this.socket.pause();
    } else if (!shouldPause && this.inputPaused) {
      this.inputPaused = false;
      this.socket.resume();
    }
  }

  private failSocket(code: Parameters<SocketDiagnosticSink>[0]): void {
    if (this.stopped) return;
    try { this.diagnostics(code); } catch { /* diagnostics are best-effort */ }
    try { this.socket.destroy(); } catch { /* already unusable */ }
    this.handleSocketClose();
  }

  private clearBuffers(reason: string): void {
    if (this.outputDeadlineTimer) clearTimeout(this.outputDeadlineTimer);
    this.outputDeadlineTimer = null;
    this.buffer = '';
    this.inboundQueue.length = 0;
    this.requestBudget.releaseBytes(this.bufferedInputBytes);
    this.bufferedInputBytes = 0;
    for (const item of this.outboundQueue) this.rejectOutput(item, reason);
    for (const item of [...this.inFlightOutput]) this.rejectOutput(item, reason);
    this.outboundQueue.length = 0;
    this.queuedOutboundBytes = 0;
    this.pendingSocketWrites = 0;
    this.outputBlocked = false;
  }

  private rejectOutput(item: SocketOutputItem, reason: string): void {
    if (item.released) return;
    item.released = true;
    this.inFlightOutput.delete(item);
    this.retainedOutboundBytes = Math.max(0, this.retainedOutboundBytes - item.bytes);
    if (item.emergency) {
      this.emergencyOutboundBytes = Math.max(0, this.emergencyOutboundBytes - item.bytes);
    }
    this.outputBudget.releaseBytes(item.bytes);
    item.reject(new Error(reason));
  }

  private readonly onBudgetGranted = (releaseMessage: () => void): void => {
    if (this.stopped) {
      releaseMessage();
      return;
    }
    this.budgetBlocked = false;
    this.frameInput();
    if (this.stopped || this.activeHandlers >= this.maxActiveMessages || this.inboundQueue.length === 0) {
      releaseMessage();
      this.drainInput();
      return;
    }
    this.dispatchInput(this.inboundQueue.shift()!, releaseMessage);
    this.drainInput();
  };
}

interface SocketInputItem {
  line: string;
  bytes: number;
  response: Record<string, unknown> | null;
}

interface SocketOutputItem {
  payload: string;
  bytes: number;
  emergency: boolean;
  released: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
}
