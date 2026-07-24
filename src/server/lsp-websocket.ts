import type * as http from 'node:http';
import type * as net from 'node:net';
import { WebSocket, WebSocketServer, type RawData, type ServerOptions } from 'ws';
import { isAllowedHostHeader, isValidBearer, type BindSecurity } from './auth';
import type { DaemonReadClient } from './daemon-client';
import type { RepoInfo } from './routes';
import {
  LspDaemonUnavailableError,
  LspFacade,
  createDaemonLspReader,
  type LspValidatedSourceBudget,
} from '../lsp/facade';
import {
  LSP_ERROR_CODE,
  LSP_LIFECYCLE_STATE,
  LSP_METHOD,
  formatLspDiagnostic,
  makeJsonRpcError,
  parseJsonRpcEnvelope,
  type JsonRpcId,
  type JsonRpcMessage,
  type LspLifecycleState,
} from '../lsp/protocol';
import { reportDiagnostic } from './diagnostics';

const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_IN_FLIGHT = 16;
const MAX_SESSIONS = 64;
const REQUEST_DEADLINE_MS = 5_000;
const ADMISSION_DEADLINE_MS = 5_000;
const CLOSE_DEADLINE_MS = 5_000;
const OUTBOUND_HIGH_WATER = 2 * 1024 * 1024;
const MAX_OUTBOUND_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_LIFECYCLE_IN_FLIGHT = 2;
const MAX_OUTBOUND_QUEUE = MAX_IN_FLIGHT + MAX_LIFECYCLE_IN_FLIGHT;
const PING_INTERVAL_MS = 30_000;
const REJECT_CLOSE_DEADLINE_MS = 1_000;
const MAX_SESSION_VALIDATED_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_SERVER_VALIDATED_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_SERVER_IN_FLIGHT_REQUESTS = 4;
const MAX_SERVER_QUEUED_REQUESTS = 32;
const MAX_SERVER_OUTBOUND_BUFFER_BYTES = 32 * 1024 * 1024;
const DAEMON_READ_METHODS: ReadonlySet<string> = new Set([
  LSP_METHOD.Definition,
  LSP_METHOD.References,
  LSP_METHOD.Hover,
  LSP_METHOD.DocumentSymbol,
  LSP_METHOD.WorkspaceSymbol,
  LSP_METHOD.TextDocumentContent,
]);

export interface LspWebSocketDeps {
  server: http.Server;
  host: string;
  port: number;
  security: BindSecurity;
  resolveRepo(repoId: string | undefined): RepoInfo | null;
  getClient(repo: RepoInfo, signal: AbortSignal): Promise<DaemonReadClient>;
  releaseClient(repo: RepoInfo, client: DaemonReadClient): void;
  diagnostics?: (message: string) => void;
  /** Test seam; production uses the fixed five-second daemon admission budget. */
  admissionDeadlineMs?: number;
  /** Test seam; production uses the fixed five-second request budget. */
  requestDeadlineMs?: number;
}

export interface LspWebSocketAdapter {
  close(deadlineAt?: number): Promise<void>;
  readonly sessionCount: number;
}

export function attachLspWebSocket(deps: LspWebSocketDeps): LspWebSocketAdapter {
  const options: ServerOptions & { closeTimeout: number } = {
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
    perMessageDeflate: false,
    clientTracking: false,
    closeTimeout: CLOSE_DEADLINE_MS,
  };
  const wss = new WebSocketServer(options);
  const sessions = new Set<LspWebSocketSession>();
  const pendingUpgrades = new Map<object, () => void>();
  const pendingAdmissions = new Set<{
    controller: AbortController;
    settled: Promise<void>;
  }>();
  const serverSourceBudget = new SourceByteBudget(MAX_SERVER_VALIDATED_SOURCE_BYTES);
  const serverRequestGate = new RequestAdmissionGate(
    MAX_SERVER_IN_FLIGHT_REQUESTS,
    MAX_SERVER_QUEUED_REQUESTS,
  );
  const serverOutboundBudget = new SourceByteBudget(MAX_SERVER_OUTBOUND_BUFFER_BYTES);
  const admissionDeadlineMs = typeof deps.admissionDeadlineMs === 'number'
    && Number.isFinite(deps.admissionDeadlineMs)
    && deps.admissionDeadlineMs > 0
    ? deps.admissionDeadlineMs
    : ADMISSION_DEADLINE_MS;
  const requestDeadlineMs = typeof deps.requestDeadlineMs === 'number'
    && Number.isFinite(deps.requestDeadlineMs)
    && deps.requestDeadlineMs > 0
    ? deps.requestDeadlineMs
    : REQUEST_DEADLINE_MS;
  let accepting = true;
  let closing: Promise<void> | null = null;

  const reject = (socket: net.Socket, status: 400 | 401 | 404 | 503): void => {
    const reason = status === 400 ? 'Bad Request'
      : status === 401 ? 'Unauthorized'
        : status === 404 ? 'Not Found'
          : 'Service Unavailable';
    const destroy = (): void => {
      clearTimeout(deadline);
      if (!socket.destroyed) socket.destroy();
    };
    const deadline = setTimeout(destroy, REJECT_CLOSE_DEADLINE_MS);
    deadline.unref?.();
    socket.once('close', () => clearTimeout(deadline));
    try {
      socket.end(
        `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        destroy,
      );
    } catch { destroy(); }
  };

  const releaseClient = (repo: RepoInfo, client: DaemonReadClient): void => {
    try { deps.releaseClient(repo, client); } catch { /* lease release is best-effort */ }
  };

  const onUpgrade = (request: http.IncomingMessage, socket: net.Socket, head: Buffer): void => {
    let releaseAcquired: (() => void) | null = null;
    void (async () => {
      if (!accepting || !validHandshake(request)) return reject(socket, 400);
      if (!hasExactLspPath(request.url)) return reject(socket, 400);
      const url = requestUrl(request);
      if (!url) return reject(socket, 400);
      const requestHost = firstHeader(request.headers.host);
      if (!requestHost || !isAllowedHostHeader(requestHost, deps.host, deps.port)) return reject(socket, 400);
      if (!validOrigin(request, requestHost)) return reject(socket, 400);
      if (!validUpgradeAuthorization(request, deps.security)) return reject(socket, 401);
      const repoValues = url.searchParams.getAll('repo');
      if ([...url.searchParams.keys()].some((key) => key !== 'repo')
        || repoValues.length !== 1
        || !/^[0-9a-f]{16}$/.test(repoValues[0]!)) return reject(socket, 404);
      const repo = deps.resolveRepo(repoValues[0]);
      if (!repo) return reject(socket, 404);
      if (sessions.size + pendingAdmissions.size >= MAX_SESSIONS) return reject(socket, 503);

      const controller = new AbortController();
      let settleAdmission: () => void = () => undefined;
      const admission = {
        controller,
        settled: new Promise<void>((resolve) => { settleAdmission = resolve; }),
      };
      pendingAdmissions.add(admission);
      const cancelAdmission = (): void => controller.abort();
      socket.once('close', cancelAdmission);
      socket.once('error', cancelAdmission);
      let rejectAdmission!: (error: Error) => void;
      const cancelled = new Promise<never>((_resolve, reject) => { rejectAdmission = reject; });
      const onAdmissionAbort = (): void => rejectAdmission(new Error('admission aborted'));
      controller.signal.addEventListener('abort', onAdmissionAbort, { once: true });
      let admissionTimedOut = false;
      const deadline = setTimeout(() => {
        admissionTimedOut = true;
        controller.abort();
      }, admissionDeadlineMs);
      deadline.unref?.();
      let clientClaimed = false;
      let admissionClosed = false;
      const acquisition = Promise.resolve().then(() => deps.getClient(repo, controller.signal));
      void acquisition.then((lateClient) => {
        if (admissionClosed && !clientClaimed) releaseClient(repo, lateClient);
      }, () => undefined);
      let client: DaemonReadClient;
      try {
        client = await Promise.race([acquisition, cancelled]);
        clientClaimed = true;
      }
      catch {
        if (admissionTimedOut || !controller.signal.aborted) {
          reportDiagnostic(deps.diagnostics, formatLspDiagnostic('daemon_unavailable'));
        }
        return reject(socket, 503);
      } finally {
        admissionClosed = true;
        clearTimeout(deadline);
        controller.signal.removeEventListener('abort', onAdmissionAbort);
        pendingAdmissions.delete(admission);
        settleAdmission();
      }
      let released = false;
      const releaseLease = (): void => {
        if (released) return;
        released = true;
        releaseAcquired = null;
        releaseClient(repo, client);
      };
      releaseAcquired = releaseLease;
      if (!accepting || controller.signal.aborted) {
        releaseLease();
        return reject(socket, 503);
      }
      if (socket.destroyed) {
        releaseLease();
        return;
      }
      const releasePending = (): void => {
        pendingUpgrades.delete(socket);
        socket.off('close', releasePending);
        releaseLease();
      };
      pendingUpgrades.set(socket, releasePending);
      socket.once('close', releasePending);
      try {
        wss.handleUpgrade(request, socket, head, (webSocket) => {
          socket.off('close', cancelAdmission);
          socket.off('error', cancelAdmission);
          pendingUpgrades.delete(socket);
          socket.off('close', releasePending);
          const session = new LspWebSocketSession(
            webSocket,
            repo,
            client,
            combinedSourceBudget(
              new SourceByteBudget(MAX_SESSION_VALIDATED_SOURCE_BYTES),
              serverSourceBudget,
            ),
            serverRequestGate,
            serverOutboundBudget,
            requestDeadlineMs,
            deps.diagnostics,
            () => {
              releaseClient(repo, client);
              sessions.delete(session);
            },
          );
          sessions.add(session);
          session.start();
          released = true;
          releaseAcquired = null;
        });
      } catch {
        releasePending();
        reject(socket, 400);
      }
    })().catch(() => {
      releaseAcquired?.();
      reject(socket, 503);
    });
  };

  wss.on('wsClientError', (_error, socket) => {
    reportDiagnostic(deps.diagnostics, formatLspDiagnostic('invalid_frame'));
    pendingUpgrades.get(socket)?.();
    try { socket.destroy(); } catch { /* already gone */ }
  });
  deps.server.on('upgrade', onUpgrade);

  return {
    get sessionCount(): number { return sessions.size; },
    close(deadlineAt = Date.now() + CLOSE_DEADLINE_MS): Promise<void> {
      if (closing) return closing;
      accepting = false;
      deps.server.removeListener('upgrade', onUpgrade);
      const admissions = [...pendingAdmissions];
      for (const admission of admissions) admission.controller.abort();
      closing = Promise.all([
        Promise.all([...sessions].map((session) => session.close(1001, 'server shutdown', deadlineAt, true))),
        settleBeforeDeadline(admissions.map((admission) => admission.settled), deadlineAt),
      ])
        .then(() => new Promise<void>((resolve) => wss.close(() => resolve())))
        .catch(() => undefined);
      return closing;
    },
  };
}

function settleBeforeDeadline(promises: Promise<void>[], deadlineAt: number): Promise<void> {
  if (promises.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, deadlineAt - Date.now()));
    timer.unref?.();
    void Promise.allSettled(promises).then(finish);
  });
}

class LspWebSocketSession {
  private readonly facade: LspFacade;
  private admissionLifecycleState: LspLifecycleState = LSP_LIFECYCLE_STATE.Created;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly pendingSettlements = new Set<() => void>();
  private readonly requestControllers = new Map<string, Set<{
    controller: AbortController;
    cancel: () => void;
  }>>();
  private readonly lifecycleInFlight = new Set<string>();
  private inFlight = 0;
  private activeWork = 0;
  private clientReleased = false;
  private closed = false;
  private alive = true;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closePromise: Promise<void> | null = null;
  private forcedClosePromise: Promise<void> | null = null;
  private drainStartedAt: number | null = null;
  private readonly outboundQueue: Array<{ payload: string; bytes: number; release: () => void }> = [];
  private readonly pendingOutboundReleases = new Set<() => void>();
  private queuedOutboundBytes = 0;
  private pendingInbound: { data: Buffer; isBinary: boolean } | null = null;
  private resolveFullyReleased: () => void = () => undefined;
  private readonly fullyReleased = new Promise<void>((resolve) => {
    this.resolveFullyReleased = resolve;
  });

  constructor(
    private readonly socket: WebSocket,
    repo: RepoInfo,
    client: DaemonReadClient,
    sourceBudget: LspValidatedSourceBudget,
    private readonly requestGate: RequestAdmissionGate,
    private readonly outboundBudget: LspValidatedSourceBudget,
    private readonly requestDeadlineMs: number,
    diagnostics: ((message: string) => void) | undefined,
    private readonly onClosed: () => void,
  ) {
    this.facade = new LspFacade(createDaemonLspReader(
      repo.root,
      client,
      () => reportDiagnostic(diagnostics, formatLspDiagnostic('daemon_unavailable')),
    ), sourceBudget);
  }

  start(): void {
    this.socket.on('message', this.onMessage);
    this.socket.on('pong', this.onPong);
    this.socket.once('close', this.onSocketClosed);
    this.socket.once('error', this.onSocketError);
    this.pingTimer = setInterval(() => {
      if (!this.alive) return void this.terminate();
      this.alive = false;
      try { this.socket.ping(); } catch { this.terminate(); }
    }, PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  close(
    code = 1000,
    reason = 'session closed',
    deadlineAt = Date.now() + CLOSE_DEADLINE_MS,
    stopWaitingAtDeadline = false,
  ): Promise<void> {
    if (this.closePromise) {
      return stopWaitingAtDeadline ? this.closeByDeadline(deadlineAt) : this.closePromise;
    }
    const socketClosed = new Promise<void>((resolve) => {
      if (this.socket.readyState === WebSocket.CLOSED) {
        this.finish();
        resolve();
        return;
      }
      this.socket.once('close', resolve);
      try { this.socket.close(code, reason); }
      catch { this.terminate(); resolve(); }
    });
    let deadline: ReturnType<typeof setTimeout> | null = null;
    deadline = setTimeout(() => this.terminate(), Math.max(0, deadlineAt - Date.now()));
    deadline.unref?.();
    const fullyClosed = Promise.all([socketClosed, this.fullyReleased]).then(() => undefined);
    this.closePromise = fullyClosed.finally(() => {
      if (deadline) clearTimeout(deadline);
      deadline = null;
    });
    return stopWaitingAtDeadline ? this.closeByDeadline(deadlineAt) : this.closePromise;
  }

  private closeByDeadline(deadlineAt: number): Promise<void> {
    if (this.forcedClosePromise) return this.forcedClosePromise;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const deadlineClose = new Promise<void>((resolve) => {
      deadline = setTimeout(() => {
        this.terminate();
        // Adapter shutdown may stop waiting at its deadline, but admitted work
        // still owns the daemon client until dispatchRequest() settles it.
        resolve();
      }, Math.max(0, deadlineAt - Date.now()));
      deadline.unref?.();
    });
    this.forcedClosePromise = Promise.race([this.closePromise!, deadlineClose]).finally(() => {
      if (deadline) clearTimeout(deadline);
      deadline = null;
    });
    return this.forcedClosePromise;
  }

  private readonly onMessage = (data: RawData, isBinary: boolean): void => {
    if (this.closed || this.closePromise) return;
    if (isBinary) return void this.close(1003, 'text messages required');
    const copied = Buffer.isBuffer(data)
      ? Buffer.from(data)
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data);
    if (this.socket.bufferedAmount >= OUTBOUND_HIGH_WATER || this.outboundQueue.length > 0) {
      if (this.pendingInbound) return void this.close(1008, 'backpressure abuse');
      this.pendingInbound = { data: copied, isBinary };
      this.startDrain();
      return;
    }
    this.handleMessage(copied, isBinary);
  };

  private handleMessage(data: Buffer, isBinary: boolean): void {
    if (this.closed || this.closePromise) return;
    if (isBinary) return void this.close(1003, 'text messages required');
    let value: unknown;
    try { value = JSON.parse(data.toString('utf8')); }
    catch { return void this.send(makeJsonRpcError(null, LSP_ERROR_CODE.ParseError)); }
    const envelope = parseJsonRpcEnvelope(value);
    if (!envelope.ok) return void this.send({ jsonrpc: '2.0', id: envelope.id, error: envelope.error });
    if ('id' in envelope.message) {
      const lifecycleMethod = lifecycleRequestMethod(envelope.message);
      if (lifecycleMethod ? this.lifecycleInFlight.has(lifecycleMethod) : this.inFlight >= MAX_IN_FLIGHT) {
        return void this.send(makeJsonRpcError(envelope.message.id, LSP_ERROR_CODE.RequestFailed, 'overloaded'));
      }
      const admittedLifecycleState = this.admissionLifecycleState;
      this.admissionLifecycleState = this.facade.admissionLifecycleStateAfter(
        admittedLifecycleState,
        envelope.message,
      );
      if (lifecycleMethod) this.lifecycleInFlight.add(lifecycleMethod);
      else this.inFlight += 1;
      void this.dispatchRequest(
        envelope.message.id,
        envelope.message,
        admittedLifecycleState,
        lifecycleMethod,
      );
      return;
    }
    const cancellationId = cancelRequestId(envelope.message);
    if (cancellationId !== undefined) {
      this.cancelRequests(cancellationId);
      return;
    }
    if (envelope.message.method !== LSP_METHOD.Initialized
      && envelope.message.method !== LSP_METHOD.Exit) return;
    const admittedLifecycleState = this.admissionLifecycleState;
    this.admissionLifecycleState = this.facade.admissionLifecycleStateAfter(
      admittedLifecycleState,
      envelope.message,
    );
    void this.facade.handle(envelope.message, undefined, admittedLifecycleState).then(() => {
      if (this.facade.requestedExitCode !== null) void this.close(1000, 'lsp exit');
    }).catch(() => void this.close(1011, 'session failure'));
  }

  private async dispatchRequest(
    id: JsonRpcId,
    message: JsonRpcMessage,
    admittedLifecycleState: LspLifecycleState,
    lifecycleMethod: string | null,
  ): Promise<void> {
    let responseSettled = false;
    let workReleased = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    let trackedRequest: { controller: AbortController; cancel: () => void } | null = null;
    const settleResponse = (): boolean => {
      if (responseSettled) return false;
      responseSettled = true;
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(timer);
        timer = null;
      }
      return true;
    };
    const releaseWork = (): void => {
      if (workReleased) return;
      workReleased = true;
      this.pendingSettlements.delete(cancel);
      if (trackedRequest) this.unregisterRequestController(id, trackedRequest);
      if (lifecycleMethod) this.lifecycleInFlight.delete(lifecycleMethod);
      else this.inFlight = Math.max(0, this.inFlight - 1);
    };
    const cancel = (): void => {
      controller.abort();
      settleResponse();
    };
    const cancelFromClient = (): void => {
      if (!settleResponse()) return;
      controller.abort();
      this.send(makeJsonRpcError(id, LSP_ERROR_CODE.RequestCancelled));
    };
    trackedRequest = { controller, cancel: cancelFromClient };
    this.registerRequestController(id, trackedRequest);
    this.pendingSettlements.add(cancel);
    timer = setTimeout(() => {
      if (!settleResponse()) return;
      controller.abort();
      this.send(makeJsonRpcError(id, LSP_ERROR_CODE.RequestFailed, 'timeout'));
      void this.close(1011, 'request timeout');
    }, this.requestDeadlineMs);
    timer.unref?.();
    this.timers.add(timer);
    let releaseAdmission: (() => void) | null = null;
    let workStarted = false;
    try {
      if (admittedLifecycleState === LSP_LIFECYCLE_STATE.Initialized
        && DAEMON_READ_METHODS.has(message.method)) {
        releaseAdmission = await this.requestGate.acquire(controller.signal);
        if (responseSettled) return;
        workStarted = true;
        this.activeWork += 1;
      }
      // The five-second timer may settle the browser response, but this await
      // intentionally remains attached to the original bounded daemon round
      // trip. Admission and the dedicated daemon-client lease are released only
      // after that work responds, fails, or reaches its transport timeout.
      const response = await this.facade.handle(
        message,
        controller.signal,
        admittedLifecycleState,
      );
      if (!settleResponse()) return;
      if (response) this.send(response, id);
    } catch (error) {
      const wasPending = settleResponse();
      if (error instanceof RequestAdmissionError) {
        if (wasPending) this.send(makeJsonRpcError(id, LSP_ERROR_CODE.RequestFailed, 'overloaded'));
        return;
      }
      if (error instanceof LspDaemonUnavailableError) {
        void this.close(1011, 'daemon unavailable');
        return;
      }
      if (!wasPending) return;
      this.send(makeJsonRpcError(id, LSP_ERROR_CODE.RequestFailed));
    } finally {
      releaseAdmission?.();
      if (workStarted) {
        this.activeWork = Math.max(0, this.activeWork - 1);
        this.releaseClientIfIdle();
      }
      releaseWork();
    }
  }

  private registerRequestController(
    id: JsonRpcId,
    request: { controller: AbortController; cancel: () => void },
  ): void {
    const key = requestKey(id);
    let requests = this.requestControllers.get(key);
    if (!requests) {
      requests = new Set();
      this.requestControllers.set(key, requests);
    }
    requests.add(request);
  }

  private unregisterRequestController(
    id: JsonRpcId,
    request: { controller: AbortController; cancel: () => void },
  ): void {
    const key = requestKey(id);
    const requests = this.requestControllers.get(key);
    if (!requests) return;
    requests.delete(request);
    if (requests.size === 0) this.requestControllers.delete(key);
  }

  private cancelRequests(id: JsonRpcId): void {
    const requests = this.requestControllers.get(requestKey(id));
    if (!requests) return;
    for (const request of [...requests]) request.cancel();
  }

  private send(value: unknown, oversizedResponseId?: JsonRpcId): void {
    if (this.closed || this.closePromise || this.socket.readyState !== WebSocket.OPEN) return;
    let payload = JSON.stringify(value);
    let payloadBytes = Buffer.byteLength(payload, 'utf8');
    if (payloadBytes > MAX_OUTBOUND_BUFFER_BYTES && oversizedResponseId !== undefined) {
      payload = JSON.stringify(makeJsonRpcError(
        oversizedResponseId,
        LSP_ERROR_CODE.RequestFailed,
        'too_large',
      ));
      payloadBytes = Buffer.byteLength(payload, 'utf8');
    }
    if (payloadBytes > MAX_OUTBOUND_BUFFER_BYTES
      || this.socket.bufferedAmount + this.queuedOutboundBytes + payloadBytes > MAX_OUTBOUND_BUFFER_BYTES) {
      return void this.close(1013, 'backpressure');
    }
    const release = this.reserveOutbound(payloadBytes);
    if (!release) return void this.close(1013, 'backpressure');
    if (this.socket.bufferedAmount >= OUTBOUND_HIGH_WATER || this.outboundQueue.length > 0) {
      if (this.outboundQueue.length >= MAX_OUTBOUND_QUEUE) {
        release();
        return void this.close(1013, 'backpressure');
      }
      this.outboundQueue.push({ payload, bytes: payloadBytes, release });
      this.queuedOutboundBytes += payloadBytes;
      this.startDrain();
      return;
    }
    this.sendPayload(payload, release);
  }

  private sendPayload(payload: string, release: () => void): void {
    try {
      this.socket.send(payload, (error) => {
        release();
        if (error) void this.close(1011, 'send failure');
      });
      if (this.socket.bufferedAmount >= OUTBOUND_HIGH_WATER) this.startDrain();
    } catch {
      release();
      void this.close(1011, 'send failure');
    }
  }

  private startDrain(): void {
    if (this.drainStartedAt !== null) return;
    this.drainStartedAt = Date.now();
    const poll = (): void => {
      if (this.closed) return;
      if (this.socket.bufferedAmount < OUTBOUND_HIGH_WATER) {
        while (this.outboundQueue.length > 0 && this.socket.bufferedAmount < OUTBOUND_HIGH_WATER) {
          const queued = this.outboundQueue.shift()!;
          this.queuedOutboundBytes = Math.max(0, this.queuedOutboundBytes - queued.bytes);
          this.sendPayload(queued.payload, queued.release);
        }
        if (this.outboundQueue.length === 0 && this.socket.bufferedAmount < OUTBOUND_HIGH_WATER) {
          const pending = this.pendingInbound;
          this.pendingInbound = null;
          this.drainStartedAt = null;
          if (pending) this.handleMessage(pending.data, pending.isBinary);
          return;
        }
      }
      if (Date.now() - this.drainStartedAt! >= REQUEST_DEADLINE_MS) {
        return void this.close(1013, 'backpressure');
      }
      const timer = setTimeout(() => { this.timers.delete(timer); poll(); }, 25);
      timer.unref?.();
      this.timers.add(timer);
    };
    poll();
  }

  private readonly onPong = (): void => { this.alive = true; };
  private readonly onSocketError = (): void => { this.finish(); };
  private readonly onSocketClosed = (): void => { this.finish(); };

  private terminate(): void {
    try { this.socket.terminate(); } catch { /* already gone */ }
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.drainStartedAt = null;
    this.outboundQueue.length = 0;
    this.queuedOutboundBytes = 0;
    for (const release of [...this.pendingOutboundReleases]) release();
    this.pendingOutboundReleases.clear();
    this.pendingInbound = null;
    for (const settle of [...this.pendingSettlements]) settle();
    this.pendingSettlements.clear();
    this.requestControllers.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.socket.removeListener('message', this.onMessage);
    this.socket.removeListener('pong', this.onPong);
    this.socket.removeListener('error', this.onSocketError);
    this.releaseClientIfIdle();
  }

  private releaseClientIfIdle(): void {
    if (!this.closed || this.activeWork > 0 || this.clientReleased) return;
    this.releaseClientNow();
  }

  private releaseClientNow(): void {
    if (this.clientReleased) return;
    this.clientReleased = true;
    try { this.onClosed(); }
    finally { this.resolveFullyReleased(); }
  }

  private reserveOutbound(bytes: number): (() => void) | null {
    const releaseBudget = this.outboundBudget.reserve(bytes);
    if (!releaseBudget) return null;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.pendingOutboundReleases.delete(release);
      releaseBudget();
    };
    this.pendingOutboundReleases.add(release);
    return release;
  }
}

function requestKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}

function cancelRequestId(message: JsonRpcMessage): JsonRpcId | undefined {
  if ('id' in message || message.method !== LSP_METHOD.CancelRequest) return undefined;
  const params = message.params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return undefined;
  const id = (params as Record<string, unknown>).id;
  if (typeof id === 'string') return id;
  return typeof id === 'number' && Number.isFinite(id) ? id : undefined;
}

function lifecycleRequestMethod(message: JsonRpcMessage): string | null {
  if (!('id' in message)) return null;
  return message.method === LSP_METHOD.Initialize || message.method === LSP_METHOD.Shutdown
    ? message.method
    : null;
}

class RequestAdmissionError extends Error {}

class RequestAdmissionGate {
  private active = 0;
  private readonly pending: Array<{
    signal: AbortSignal;
    onAbort: () => void;
    resolve: (release: () => void) => void;
    reject: (error: RequestAdmissionError) => void;
  }> = [];

  constructor(
    private readonly limit: number,
    private readonly queueLimit: number,
  ) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new RequestAdmissionError('request cancelled'));
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.releaseForSlot());
    }
    if (this.pending.length >= this.queueLimit) {
      return Promise.reject(new RequestAdmissionError('request queue full'));
    }
    return new Promise<() => void>((resolve, reject) => {
      const entry = {
        signal,
        onAbort: () => {
          const index = this.pending.indexOf(entry);
          if (index !== -1) this.pending.splice(index, 1);
          reject(new RequestAdmissionError('request cancelled'));
        },
        resolve,
        reject,
      };
      signal.addEventListener('abort', entry.onAbort, { once: true });
      this.pending.push(entry);
    });
  }

  private releaseForSlot(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      while (this.pending.length > 0) {
        const next = this.pending.shift()!;
        next.signal.removeEventListener('abort', next.onAbort);
        if (next.signal.aborted) continue;
        next.resolve(this.releaseForSlot());
        return;
      }
      this.active = Math.max(0, this.active - 1);
    };
  }
}

class SourceByteBudget implements LspValidatedSourceBudget {
  private used = 0;

  constructor(private readonly limit: number) {}

  reserve(bytes: number): (() => void) | null {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.used + bytes > this.limit) return null;
    this.used += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.used = Math.max(0, this.used - bytes);
    };
  }
}

function combinedSourceBudget(...budgets: LspValidatedSourceBudget[]): LspValidatedSourceBudget {
  return {
    reserve(bytes) {
      const releases: Array<() => void> = [];
      for (const budget of budgets) {
        const release = budget.reserve(bytes);
        if (!release) {
          for (const rollback of releases.reverse()) rollback();
          return null;
        }
        releases.push(release);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const release of releases.reverse()) release();
      };
    },
  };
}

function validHandshake(request: http.IncomingMessage): boolean {
  if (request.method !== 'GET') return false;
  const upgrade = firstHeader(request.headers.upgrade)?.toLowerCase();
  const connection = firstHeader(request.headers.connection)?.toLowerCase().split(',').map((value) => value.trim());
  const version = firstHeader(request.headers['sec-websocket-version']);
  const key = firstHeader(request.headers['sec-websocket-key']);
  return upgrade === 'websocket' && connection?.includes('upgrade') === true && version === '13'
    && typeof key === 'string' && /^[A-Za-z0-9+/]{22}==$/.test(key)
    && hasNoSubprotocolHeader(request);
}

function hasNoSubprotocolHeader(request: http.IncomingMessage): boolean {
  return request.headers['sec-websocket-protocol'] === undefined
    && !request.rawHeaders.some((value, index) => index % 2 === 0
      && value.toLowerCase() === 'sec-websocket-protocol');
}

function validUpgradeAuthorization(request: http.IncomingMessage, security: BindSecurity): boolean {
  // `startWebServer` rejects every non-loopback packaged-UI bind before listen,
  // so production browsers only reach the no-token loopback branch. Keep this
  // direct-adapter gate for authenticated scripted clients and any future
  // browser-session design without weakening the current fail-closed seam.
  if (!security.requireToken) return true;
  if (!security.token) return false;
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'authorization') {
      values.push(request.rawHeaders[index + 1] ?? '');
    }
  }
  return values.length === 1 && isValidBearer(values[0], security.token);
}

function requestUrl(request: http.IncomingMessage): URL | null {
  try { return new URL(request.url ?? '/', 'http://codegraph.invalid'); }
  catch { return null; }
}

function hasExactLspPath(requestTarget: string | undefined): boolean {
  if (!requestTarget) return false;
  const query = requestTarget.indexOf('?');
  const rawPath = query === -1 ? requestTarget : requestTarget.slice(0, query);
  return rawPath === '/lsp';
}

function validOrigin(request: http.IncomingMessage, requestHost: string): boolean {
  const rawOrigins = request.rawHeaders.filter((_value, index) => index % 2 === 0 && request.rawHeaders[index]?.toLowerCase() === 'origin');
  const origin = firstHeader(request.headers.origin);
  if (rawOrigins.length === 0 && origin === undefined) return true;
  if (rawOrigins.length !== 1 || !origin || origin.includes(',')) return false;
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
    const expected = new URL(`${parsed.protocol}//${requestHost}`);
    return parsed.protocol === expected.protocol && parsed.hostname === expected.hostname && effectivePort(parsed) === effectivePort(expected);
  } catch { return false; }
}

function effectivePort(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80');
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
