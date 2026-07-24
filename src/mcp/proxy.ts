/**
 * MCP proxy mode — issue #411.
 *
 * The proxy is a near-transparent stdio↔socket pipe. Once it has verified
 * the daemon's hello line (same major.minor.patch as ours), it does no
 * protocol parsing of its own: every byte the MCP host writes to the proxy's
 * stdin goes straight to the daemon socket, and every byte the daemon emits
 * goes straight to the host's stdout. Server-initiated JSON-RPC requests
 * (e.g. `roots/list`) flow through the same pipe transparently.
 *
 * Lifecycle expectations:
 *   - The proxy exits when *either* stream closes (host stdin closed →
 *     daemon socket end, or daemon-side socket close → host stdout end).
 *   - Closing the socket on the proxy side is what tells the daemon to
 *     decrement its connected-clients refcount.
 *   - On a parent-process death we can't detect via stdin close (e.g. SIGKILL
 *     of the MCP host), the proxy's PPID watchdog catches it — same logic
 *     the direct-mode server uses; see issue #277.
 */

import * as fs from 'fs';
import * as net from 'net';
import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import { HOST_PPID_ENV } from '../extraction/wasm-runtime-flags';
import { DaemonClientHello, DaemonHello, MAX_HELLO_LINE_BYTES } from './daemon';
import {
  DAEMON_HANDSHAKE_PROTOCOL,
  createDaemonAuthNonce,
  createDaemonClientProof,
  createDaemonServerProof,
  daemonProofMatches,
  isValidDaemonAuthNonce,
  isValidDaemonAuthProof,
  isValidDaemonAuthSecret,
  normalizeDaemonHostPid,
} from './daemon-auth';
import { isValidDaemonInstanceId, type DaemonLockInfo } from './daemon-paths';
import { EARLY_PPID } from './early-ppid';
import { supervisionLostReason } from './ppid-watchdog';
import { armStartupHandshakeTimeout } from './startup-handshake';
import { treatStdinFailureAsShutdown } from './stdin-teardown';
import { CodeGraphPackageVersion, isShareableCodeGraphVersion } from './version';
import { SERVER_INFO, PROTOCOL_VERSION, initializeInstructions } from './session';
import { SERVER_INSTRUCTIONS } from './server-instructions';
import { getStaticTools } from './tools';
import { getTelemetry, ClientInfo } from '../telemetry';
import type { MCPEngine } from './engine';

/** Default poll cadence for the PPID watchdog (same as the direct server). */
const DEFAULT_PPID_POLL_MS = 5000;

/** Bounds for the local-handshake proxy before and after daemon attachment. */
export const MAX_PROXY_REQUEST_LINE_BYTES = 1024 * 1024;
export const MAX_PROXY_RESPONSE_LINE_BYTES = 8 * 1024 * 1024;
export const MAX_PROXY_BUFFERED_BYTES = 16 * 1024 * 1024;
export const MAX_PROXY_RETAINED_REQUEST_BYTES = 2 * 1024 * 1024;
export const MAX_PROXY_IN_FLIGHT_REQUESTS = 32;
const MAX_PROXY_FRAMES_PER_DRAIN = 4_096;
const PROXY_DRAIN_DEADLINE_MS = 5_000;

/**
 * Env var that opts INTO the "attached to shared daemon" log line. Off by
 * default: the line is benign INFO, but MCP hosts render any server stderr at
 * error level (and append an `undefined` data field), so on every session start
 * a healthy attach showed up as `[error] … undefined`. Set to `1` to surface it
 * when debugging daemon attach. (#618; approach from #640 by @mturac)
 */
const LOG_ATTACH_ENV = 'CODEGRAPH_MCP_LOG_ATTACH';

/**
 * Log a successful daemon attach — gated behind {@link LOG_ATTACH_ENV} so it is
 * silent by default (see #618). Exported for tests.
 */
export function logAttachedDaemon(socketPath: string, hello: DaemonHello): void {
  if (process.env[LOG_ATTACH_ENV] !== '1') return;
  process.stderr.write(
    `[CodeGraph MCP] Attached to shared daemon on ${socketPath} (pid ${hello.pid}, v${hello.codegraph}).\n`
  );
}

export interface ProxyResult {
  /**
   * `proxied` — successfully attached to a same-version daemon and piped
   * stdio. The proxy stays alive until either end closes.
   * `fallback-needed` — the daemon rejected us (version mismatch / unreachable
   * socket) and the caller should run the server in direct mode.
   */
  outcome: 'proxied' | 'fallback-needed';
  reason?: string;
}

/**
 * Attempt to connect to the daemon at `socketPath` and pipe stdio through it.
 *
 * Returns a promise that resolves when either:
 *   - the connection succeeded and one of stdin/socket has now closed
 *     (after which the process should exit), or
 *   - the connection failed early enough that the caller can still fall
 *     back to direct mode.
 *
 * The `expectedVersion` param defaults to the package's own version — daemon
 * and proxy MUST match exactly. Mismatch resolves with
 * `outcome: 'fallback-needed'` so the caller can transparently start its own
 * server. (We accept the cost of two concurrent servers in this case as the
 * price of never silently running a stale daemon against newer client code.)
 */
export async function runProxy(
  socketPath: string,
  expectedVersion: string = CodeGraphPackageVersion,
  expectedIdentity?: DaemonLockInfo,
): Promise<ProxyResult> {
  if (!isShareableCodeGraphVersion(expectedVersion)) {
    return { outcome: 'fallback-needed', reason: 'package version unavailable' };
  }
  if (!expectedIdentity) {
    return { outcome: 'fallback-needed', reason: 'daemon identity unavailable' };
  }
  // POSIX: refuse to connect to a stale socket file that points at no
  // listening process. `fs.existsSync` is a cheap pre-check; a real
  // ECONNREFUSED below catches the rare "exists but unbound" race.
  if (process.platform !== 'win32' && !fs.existsSync(socketPath)) {
    return { outcome: 'fallback-needed', reason: 'socket file missing' };
  }

  const socket = net.createConnection(socketPath);
  socket.setEncoding('utf8');

  const hello = await readHelloLine(socket).catch((err) => {
    socket.destroy();
    return new Error(String(err));
  });
  if (hello instanceof Error) {
    return { outcome: 'fallback-needed', reason: hello.message };
  }

  if (!helloMatches(socketPath, hello, expectedIdentity)) {
    socket.destroy();
    return { outcome: 'fallback-needed', reason: 'daemon identity mismatch' };
  }
  if (!isShareableCodeGraphVersion(hello.codegraph) || hello.codegraph !== expectedVersion) {
    process.stderr.write(
      `[CodeGraph MCP] Found a daemon on ${socketPath} but version (${hello.codegraph}) ` +
      `differs from ours (${expectedVersion}); falling back to direct mode.\n`
    );
    socket.destroy();
    return { outcome: 'fallback-needed', reason: 'version mismatch' };
  }

  logAttachedDaemon(socketPath, hello);

  sendClientHello(socket, undefined, expectedIdentity, hello.nonce);
  startPpidWatchdog(socket);
  const exitCode = await pipeUntilClose(socket);
  // Host disconnected (or the daemon went away). The proxy's only job is the
  // pipe; exit now so we don't linger — process.stdin's 'data' listener would
  // otherwise keep the event loop alive and leave a zombie launcher behind.
  process.exit(exitCode);
}

/**
 * Connect to a daemon at `socketPath` and verify its hello (exact version match).
 * Returns the live socket (hello already consumed) or null if unreachable / stale
 * / version-mismatched. Unlike {@link runProxy} it does NOT pipe — the caller
 * owns the socket. Used by the local-handshake proxy's background connect.
 * Long-running direct clients may override `hostPid` when their launcher is
 * not part of the connection's lifetime.
 */
export async function connectWithHello(
  socketPath: string,
  expectedVersion: string = CodeGraphPackageVersion,
  clientHello: { hostPid?: number | null; signal?: AbortSignal; expectedIdentity?: DaemonLockInfo } = {},
): Promise<net.Socket | 'version-mismatch' | null> {
  if (!isShareableCodeGraphVersion(expectedVersion)) return 'version-mismatch';
  if (!clientHello.expectedIdentity) return null;
  if (clientHello.signal?.aborted) return null;
  if (process.platform !== 'win32' && !fs.existsSync(socketPath)) return null;
  const socket = net.createConnection(socketPath);
  socket.setEncoding('utf8');
  const onAbort = (): void => { socket.destroy(); };
  clientHello.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    // Keep an 'error' listener attached for the socket's ENTIRE life. readHelloLine
    // attaches its own and then REMOVES it on success (its cleanup()), which left a
    // window — from here until the caller attaches its onDaemonLost handler — where
    // a socket 'error' had NO listener. In Node an unhandled socket 'error' is
    // re-thrown as an uncaughtException, which the global fatal handler turns into
    // process.exit(1); to an MCP client that surfaces as a bare "Transport closed"
    // (#974). The window is rarely hit on a healthy FS but is common on flaky
    // AF_UNIX-over-DrvFs (WSL2 /mnt drives). A no-op guard makes the error
    // recoverable: the follow-up 'close' drives the caller's normal fallback.
    socket.on('error', () => { /* absorbed — see #974; 'close' drives the fallback */ });
    const hello = await readHelloLine(socket).catch(() => null);
    if (!hello) {
      socket.destroy();
      return null; // no daemon yet — caller should keep polling
    }
    if (!helloMatches(socketPath, hello, clientHello.expectedIdentity)) {
      socket.destroy();
      return null;
    }
    if (!isShareableCodeGraphVersion(hello.codegraph) || hello.codegraph !== expectedVersion) {
      // A daemon IS up but it's the wrong version — definitive, not a "not yet".
      // Don't poll; the caller serves in-process so we never run stale-vs-new.
      process.stderr.write(
        `[CodeGraph MCP] Found a daemon on ${socketPath} but version (${hello.codegraph}) ` +
        `differs from ours (${expectedVersion}); serving this session in-process.\n`
      );
      socket.destroy();
      return 'version-mismatch';
    }
    if (clientHello.signal?.aborted) {
      socket.destroy();
      return null;
    }
    logAttachedDaemon(socketPath, hello);
    sendClientHello(socket, clientHello.hostPid, clientHello.expectedIdentity, hello.nonce);
    return socket;
  } finally {
    clientHello.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Tell the daemon our pids right after we verify its hello, so its liveness
 * sweep can reap this client if our process dies without the socket ever
 * signalling close (the Windows named-pipe hazard behind #692). It carries the
 * client's HMAC proof and is sent before application bytes, so it is always the
 * daemon's first line from us. A write failure closes the unauthenticated
 * connection through the normal socket-loss path. By default `hostPid` mirrors
 * the PPID watchdog: the threaded host pid if set, else our own parent (the
 * host, on a no-relaunch bundle). Direct long-running clients may explicitly
 * omit it with `null`.
 */
function sendClientHello(
  socket: net.Socket,
  hostPid: number | null | undefined,
  identity: DaemonLockInfo,
  serverNonce: string,
): void {
  const candidateHostPid = hostPid === undefined
    ? parseHostPpid(process.env[HOST_PPID_ENV]) ?? EARLY_PPID
    : hostPid;
  const resolvedHostPid = normalizeDaemonHostPid(candidateHostPid);
  const nonce = createDaemonAuthNonce();
  const clientHello: DaemonClientHello = {
    codegraph_client: 1,
    pid: process.pid,
    hostPid: resolvedHostPid,
    instanceId: identity.instanceId!,
    nonce,
    proof: createDaemonClientProof(identity.authSecret!, {
      pid: process.pid,
      hostPid: resolvedHostPid,
      instanceId: identity.instanceId!,
      serverNonce,
      nonce,
    }),
  };
  try { socket.write(JSON.stringify(clientHello) + '\n'); } catch { /* best-effort */ }
}

/** Verify the hello against both the selected socket and the lock trust anchor. */
function helloMatches(
  socketPath: string,
  hello: DaemonHello,
  expected?: DaemonLockInfo,
): boolean {
  if (hello.protocol !== DAEMON_HANDSHAKE_PROTOCOL || hello.socketPath !== socketPath) return false;
  if (!Number.isSafeInteger(hello.pid) || hello.pid <= 1) return false;
  if (!isValidDaemonInstanceId(hello.instanceId)) return false;
  if (!isValidDaemonAuthNonce(hello.nonce) || !isValidDaemonAuthProof(hello.proof)) return false;
  if (!expected || !isValidDaemonAuthSecret(expected.authSecret)) return false;
  const proof = createDaemonServerProof(expected.authSecret, {
    codegraph: hello.codegraph,
    pid: hello.pid,
    socketPath: hello.socketPath,
    instanceId: hello.instanceId,
    nonce: hello.nonce,
  });
  return daemonProofMatches(hello.proof, proof) &&
    hello.pid === expected.pid &&
    hello.socketPath === expected.socketPath &&
    hello.instanceId === expected.instanceId;
}

type JsonRpc = Record<string, unknown>;

/** Dependencies the local-handshake proxy needs, injected by MCPServer (which
 *  owns the daemon-spawn machinery and the engine factory). */
export interface LocalHandshakeDeps {
  /** Probe → spawn → retry → hello-verify; resolves a connected daemon socket,
   *  or null when the daemon path is genuinely unavailable (→ in-process fallback). */
  getDaemonSocket(signal: AbortSignal): Promise<net.Socket | null>;
  /** Lazily create an in-process engine — used ONLY if the daemon never comes up,
   *  preserving the "a broken daemon never wedges a session" guarantee. */
  makeEngine(): MCPEngine;
  /** Project root for the fallback engine's lazy init. */
  root: string;
  /** Test seams. Production always uses the process stdio streams and exit. */
  input?: Readable;
  output?: Writable;
  diagnostics?: Writable;
  exit?: (code: number) => void;
  installLifecycleGuards?: boolean;
}

/**
 * Local-handshake proxy (the cold-start fix).
 *
 * Answers `initialize` + `tools/list` from STATIC constants the instant the
 * client asks — tools register in ~process-startup time instead of waiting
 * ~600ms for the daemon to spawn+bind, which is what produced the "No such tool
 * available" race that made headless agents flail into grep/Read. Tool CALLS are
 * forwarded to the shared daemon (connected on the first forwarded message);
 * the daemon's
 * response to the forwarded `initialize` is suppressed (the client already got
 * the local one). If the daemon never comes up (version mismatch / spawn fail),
 * a lazily-created in-process engine serves the calls — so the handshake speedup
 * never costs the old fall-back-to-direct robustness.
 */
export async function runLocalHandshakeProxy(deps: LocalHandshakeDeps): Promise<void> {
  const input = deps.input ?? process.stdin;
  const output = deps.output ?? process.stdout;
  const diagnostics = deps.diagnostics ?? process.stderr;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const installLifecycleGuards = deps.installLifecycleGuards ?? true;
  let daemonStatus: 'connecting' | 'ready' | 'failed' = 'connecting';
  let daemonSocket: net.Socket | null = null;
  // The client may legally reuse its initialize id after that response. Forward
  // initialize under a proxy-owned nonce so suppressing the daemon's duplicate
  // response can never swallow a later client request with the same id.
  const daemonInitId = `codegraph-proxy-initialize:${randomUUID()}`;
  // Telemetry attribution for the in-process fallback only — calls routed to
  // the daemon are counted by the daemon's own session (which receives the
  // forwarded initialize, clientInfo included), never double-counted here.
  let telemetryClient: ClientInfo | undefined;
  const pending: string[] = [];
  let pendingBytes = 0;
  let pendingSaturated = false;
  let engine: MCPEngine | null = null;
  let engineReady: Promise<void> | null = null;
  let shuttingDown = false;
  let inputPaused = false;
  let drainingInput = false;
  let stdinBuf = '';
  let stdinBufBytes = 0;
  let daemonOutputBlocked = false;
  let daemonDrainTimer: ReturnType<typeof setTimeout> | null = null;
  let clientOutputBlocked = false;
  let clientDrainTimer: ReturnType<typeof setTimeout> | null = null;
  const clientOutputQueue: Array<{ payload: string; bytes: number }> = [];
  let queuedClientOutputBytes = 0;
  let localActiveRequests = 0;
  let localActiveRequestBytes = 0;
  let drainDaemonInput = (): void => { /* no daemon attached yet */ };
  let discardDaemonInput = (): void => { /* no daemon attached yet */ };
  let disarmStartupTimeout = (): void => { /* not armed yet */ };
  let daemonConnectionRequested = false;
  let daemonConnectionController: AbortController | null = null;
  let resolveDaemonConnectionRequest!: () => void;
  const daemonConnectionRequest = new Promise<void>((resolve) => {
    resolveDaemonConnectionRequest = resolve;
  });
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
  // Requests forwarded to the daemon and not yet answered, keyed by JSON-RPC id.
  // If the daemon dies mid-session (#662 — e.g. an MCP host SIGTERM's it when a
  // new session starts), these would otherwise hang forever; we re-serve them
  // in-process so the host always gets a reply.
  const inflight = new Map<unknown, { line: string; bytes: number }>();
  let inflightBytes = 0;
  const trackInflight = (line: string): boolean => {
    try {
      const m = JSON.parse(line) as JsonRpc;
      if (m && m.id !== undefined && typeof m.method === 'string' && m.method !== 'initialize') {
        const bytes = Buffer.byteLength(line, 'utf8') + 1;
        if (
          inflight.has(m.id) ||
          inflight.size >= MAX_PROXY_IN_FLIGHT_REQUESTS ||
          inflightBytes + pendingBytes + localActiveRequestBytes + bytes > MAX_PROXY_RETAINED_REQUEST_BYTES
        ) {
          writeOverload(m.id);
          return false;
        }
        inflight.set(m.id, { line, bytes });
        inflightBytes += bytes;
      }
    } catch { /* unparseable — nothing we could re-serve anyway */ }
    return true;
  };

  function writeDiagnostic(message: string): void {
    try { diagnostics.write(message); } catch { /* diagnostics are best-effort */ }
  }

  function clearDaemonDrainDeadline(): void {
    if (daemonDrainTimer) clearTimeout(daemonDrainTimer);
    daemonDrainTimer = null;
  }

  function clearClientDrainDeadline(): void {
    if (clientDrainTimer) clearTimeout(clientDrainTimer);
    clientDrainTimer = null;
  }

  function shutdown(exitCode = 0): void {
    if (shuttingDown) return; shuttingDown = true;
    daemonConnectionController?.abort();
    daemonConnectionController = null;
    disarmStartupTimeout();
    input.removeListener('data', onInputData);
    clearDaemonDrainDeadline();
    clearClientDrainDeadline();
    output.removeListener('drain', onClientDrain);
    output.removeListener('error', onOutputError);
    output.removeListener('close', onOutputClose);
    diagnostics.removeListener('error', onDiagnosticsError);
    // A pending write may surface one final asynchronous stream error after
    // active teardown. Keep that event contained while the process exits.
    output.on('error', onDiagnosticsError);
    diagnostics.on('error', onDiagnosticsError);
    daemonSocket?.removeListener('drain', onDaemonDrain);
    discardDaemonInput();
    try { daemonSocket?.destroy(); } catch { /* ignore */ }
    try { engine?.stop(); } catch { /* ignore */ }
    resolveFinished();
    exit(exitCode);
  }

  function failProxy(code: 'input_overflow' | 'output_overflow' | 'output_timeout' | 'output_error'): void {
    writeDiagnostic(`[CodeGraph MCP] Local proxy ${code.replaceAll('_', ' ')}; shutting down.\n`);
    shutdown(1);
  }

  function onOutputError(): void {
    if (!shuttingDown) failProxy('output_error');
  }

  function onOutputClose(): void {
    if (!shuttingDown) failProxy('output_error');
  }

  function onDiagnosticsError(): void {
    // Diagnostics are best-effort and must never terminate the proxy.
  }

  function writeOutputPayload(payload: string): void {
    if (shuttingDown) return;
    try {
      if (output.write(payload)) return;
      clientOutputBlocked = true;
      output.once('drain', onClientDrain);
      clearClientDrainDeadline();
      clientDrainTimer = setTimeout(() => failProxy('output_timeout'), PROXY_DRAIN_DEADLINE_MS);
      clientDrainTimer.unref?.();
      updateInputFlow();
    } catch {
      failProxy('output_error');
    }
  }

  function writeClient(obj: JsonRpc | string): void {
    if (shuttingDown) return;
    let payload = (typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n';
    let bytes = Buffer.byteLength(payload, 'utf8');
    if (
      bytes > MAX_PROXY_RESPONSE_LINE_BYTES &&
      typeof obj !== 'string' &&
      Object.prototype.hasOwnProperty.call(obj, 'id') &&
      ('result' in obj || 'error' in obj)
    ) {
      payload = JSON.stringify({
        jsonrpc: '2.0',
        id: obj.id,
        error: { code: -32603, message: 'Response exceeds transport limit' },
      }) + '\n';
      bytes = Buffer.byteLength(payload, 'utf8');
    }
    const writableBytes = Number.isSafeInteger(output.writableLength) ? output.writableLength : 0;
    if (
      bytes > MAX_PROXY_RESPONSE_LINE_BYTES ||
      writableBytes + queuedClientOutputBytes + bytes > MAX_PROXY_BUFFERED_BYTES
    ) {
      failProxy('output_overflow');
      return;
    }
    if (clientOutputBlocked || clientOutputQueue.length > 0) {
      clientOutputQueue.push({ payload, bytes });
      queuedClientOutputBytes += bytes;
      return;
    }
    writeOutputPayload(payload);
  }

  function writeOverload(id: unknown): void {
    writeClient({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: 'CodeGraph proxy overloaded', data: { reason: 'overloaded' } },
    });
  }

  function onClientDrain(): void {
    if (shuttingDown) return;
    clientOutputBlocked = false;
    clearClientDrainDeadline();
    while (!clientOutputBlocked && clientOutputQueue.length > 0) {
      const next = clientOutputQueue.shift()!;
      queuedClientOutputBytes = Math.max(0, queuedClientOutputBytes - next.bytes);
      writeOutputPayload(next.payload);
    }
    if (!clientOutputBlocked) drainDaemonInput();
    if (!clientOutputBlocked) drainStdinBuffer();
    updateInputFlow();
  }

  function ensureEngine(): Promise<void> {
    if (!engine) engine = deps.makeEngine();
    if (!engineReady) engineReady = engine.ensureInitialized(deps.root).catch(() => { /* degraded */ });
    return engineReady;
  }

  // Daemon-unavailable fallback: serve a client message in-process.
  async function handleLocally(line: string): Promise<void> {
    let msg: JsonRpc; try { msg = JSON.parse(line) as JsonRpc; } catch { return; }
    // A client response to a daemon-initiated request is not itself a request.
    // Once the daemon is gone there is no recipient, so consume it silently.
    if (
      msg.jsonrpc === '2.0' &&
      typeof msg.method !== 'string' &&
      Object.prototype.hasOwnProperty.call(msg, 'id') &&
      ('result' in msg || 'error' in msg)
    ) return;
    const id = msg.id;
    if (msg.method === 'tools/call' && id !== undefined) {
      try {
        await ensureEngine();
        const params = (msg.params || {}) as { name: string; arguments?: Record<string, unknown> };
        const result = await engine!.getToolHandler().execute(params.name, params.arguments || {});
        writeClient({ jsonrpc: '2.0', id, result });
        getTelemetry().recordUsage('mcp_tool', params.name, !result.isError, telemetryClient);
      } catch (err) {
        writeClient({ jsonrpc: '2.0', id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } });
      }
    } else if (msg.method === 'ping' && id !== undefined) {
      writeClient({ jsonrpc: '2.0', id, result: {} });
    } else if (id !== undefined && msg.method !== 'initialize') {
      // A request we can't serve in-process (and the daemon is gone) — answer
      // with an error rather than let the host hang on a reply that won't come.
      writeClient({ jsonrpc: '2.0', id, error: { code: -32603, message: 'CodeGraph daemon unavailable' } });
    }
    // initialize already answered locally; notifications (initialized) need no reply.
  }

  function dispatchLocally(line: string): void {
    let id: unknown;
    const bytes = Buffer.byteLength(line, 'utf8') + 1;
    try {
      const msg = JSON.parse(line) as JsonRpc;
      if (typeof msg.method === 'string' && msg.id !== undefined && msg.method !== 'initialize') id = msg.id;
    } catch { /* malformed input has no bounded local work */ }
    if (
      id !== undefined &&
      (localActiveRequests >= MAX_PROXY_IN_FLIGHT_REQUESTS ||
        inflightBytes + pendingBytes + localActiveRequestBytes + bytes > MAX_PROXY_RETAINED_REQUEST_BYTES)
    ) {
      writeOverload(id);
      return;
    }
    if (id !== undefined) {
      localActiveRequests += 1;
      localActiveRequestBytes += bytes;
    }
    void handleLocally(line).finally(() => {
      if (id !== undefined) {
        localActiveRequests = Math.max(0, localActiveRequests - 1);
        localActiveRequestBytes = Math.max(0, localActiveRequestBytes - bytes);
      }
      drainStdinBuffer();
      updateInputFlow();
    });
  }

  function onDaemonDrain(): void {
    if (shuttingDown || daemonStatus !== 'ready') return;
    daemonOutputBlocked = false;
    clearDaemonDrainDeadline();
    flushPendingToDaemon();
    drainStdinBuffer();
    updateInputFlow();
  }

  function writeDaemon(line: string): void {
    if (!daemonSocket || daemonStatus !== 'ready' || shuttingDown) return;
    const payload = line.endsWith('\n') ? line : line + '\n';
    const bytes = Buffer.byteLength(payload, 'utf8');
    const writableBytes = Number.isSafeInteger(daemonSocket.writableLength)
      ? daemonSocket.writableLength
      : 0;
    if (bytes > MAX_PROXY_REQUEST_LINE_BYTES || writableBytes + bytes > MAX_PROXY_BUFFERED_BYTES) {
      onDaemonLost();
      return;
    }
    try {
      if (daemonSocket.write(payload)) return;
      daemonOutputBlocked = true;
      daemonSocket.once('drain', onDaemonDrain);
      clearDaemonDrainDeadline();
      daemonDrainTimer = setTimeout(onDaemonLost, PROXY_DRAIN_DEADLINE_MS);
      daemonDrainTimer.unref?.();
      updateInputFlow();
    } catch {
      onDaemonLost();
    }
  }

  function enqueuePending(line: string): void {
    const bytes = Buffer.byteLength(line, 'utf8') + 1;
    if (
      pending.length >= MAX_PROXY_IN_FLIGHT_REQUESTS ||
      inflightBytes + pendingBytes + localActiveRequestBytes + bytes > MAX_PROXY_RETAINED_REQUEST_BYTES
    ) {
      pendingSaturated = true;
      try {
        const msg = JSON.parse(line) as JsonRpc;
        if (msg.id !== undefined && typeof msg.method === 'string' && msg.method !== 'initialize') {
          writeOverload(msg.id);
        }
      } catch { /* malformed input is dropped when the bounded queue is full */ }
      return;
    }
    pending.push(line);
    pendingBytes += bytes;
  }

  function routeToDaemon(line: string): void {
    if (!daemonConnectionRequested) {
      daemonConnectionRequested = true;
      resolveDaemonConnectionRequest();
    }
    if (daemonStatus === 'ready' && daemonSocket) {
      if (!trackInflight(line)) return;
      if (process.env.CODEGRAPH_MCP_DEBUG) writeDiagnostic(`[mcp-debug] proxy->daemon ${line.slice(0, 80)}\n`);
      writeDaemon(line);
    } else if (daemonStatus === 'failed') {
      dispatchLocally(line);
    } else {
      if (process.env.CODEGRAPH_MCP_DEBUG) writeDiagnostic(`[mcp-debug] proxy-buffer(${daemonStatus}) ${line.slice(0, 80)}\n`);
      enqueuePending(line);
    }
  }

  function flushPendingToDaemon(): void {
    pendingSaturated = false;
    while (!shuttingDown && daemonStatus === 'ready' && !daemonOutputBlocked && pending.length > 0) {
      const line = pending.shift()!;
      pendingBytes = Math.max(0, pendingBytes - Buffer.byteLength(line, 'utf8') - 1);
      routeToDaemon(line);
    }
  }

  function onDaemonLost(): void {
    if (shuttingDown || daemonStatus !== 'ready') return;
    const orphaned = [...inflight.values()].map((entry) => entry.line).concat(pending);
    const orphanedCount = inflight.size;
    detachDaemon();
    writeDiagnostic(
      `[CodeGraph MCP] Shared daemon connection lost; serving this session in-process (degraded), re-serving ${orphanedCount} in-flight request(s).\n`
    );
    for (const line of orphaned) dispatchLocally(line);
    drainStdinBuffer();
    updateInputFlow();
  }

  function onDaemonProtocolFailure(): void {
    if (shuttingDown || daemonStatus !== 'ready') return;
    const unknownIds = [...inflight.keys()];
    const unsent = [...pending];
    detachDaemon();
    writeDiagnostic(
      `[CodeGraph MCP] Shared daemon connection lost after its response exceeded transport limits; serving this session in-process (degraded), failing ${unknownIds.length} in-flight request(s).\n`
    );
    for (const id of unknownIds) {
      writeClient({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'Response exceeds transport limit' },
      });
    }
    for (const line of unsent) dispatchLocally(line);
    drainStdinBuffer();
    updateInputFlow();
  }

  function detachDaemon(): void {
    daemonStatus = 'failed';
    daemonOutputBlocked = false;
    clearDaemonDrainDeadline();
    daemonSocket?.removeListener('drain', onDaemonDrain);
    daemonSocket?.removeListener('close', onDaemonLost);
    daemonSocket?.removeListener('error', onDaemonLost);
    discardDaemonInput();
    try { daemonSocket?.destroy(); } catch { /* ignore */ }
    daemonSocket = null;
    inflight.clear();
    inflightBytes = 0;
    pending.length = 0;
    pendingBytes = 0;
    pendingSaturated = false;
  }

  function updateInputFlow(): void {
    const pendingFull = daemonStatus === 'connecting' && (
      pendingSaturated ||
      pending.length >= MAX_PROXY_IN_FLIGHT_REQUESTS ||
      pendingBytes >= MAX_PROXY_RETAINED_REQUEST_BYTES
    );
    const shouldPause = shuttingDown || daemonOutputBlocked || clientOutputBlocked || pendingFull;
    if (shouldPause && !inputPaused) {
      inputPaused = true;
      input.pause();
    } else if (!shouldPause && inputPaused) {
      inputPaused = false;
      input.resume();
    }
    if (daemonSocket && daemonStatus === 'ready') {
      if (clientOutputBlocked) daemonSocket.pause();
      else daemonSocket.resume();
    }
  }

  function canConsumeInput(): boolean {
    return !shuttingDown && !daemonOutputBlocked && !clientOutputBlocked && !(
      daemonStatus === 'connecting' && (
        pendingSaturated ||
        pending.length >= MAX_PROXY_IN_FLIGHT_REQUESTS ||
        pendingBytes >= MAX_PROXY_RETAINED_REQUEST_BYTES
      )
    );
  }

  function processClientLine(line: string): void {
    let msg: JsonRpc; try { msg = JSON.parse(line) as JsonRpc; } catch { routeToDaemon(line); return; }
    const isRequest = Object.prototype.hasOwnProperty.call(msg, 'id');
    if (msg.method === 'initialize') {
      const initParams = (msg.params ?? {}) as { clientInfo?: { name?: unknown; version?: unknown } };
      if (initParams.clientInfo) {
        telemetryClient = {
          name: typeof initParams.clientInfo.name === 'string' ? initParams.clientInfo.name : undefined,
          version: typeof initParams.clientInfo.version === 'string' ? initParams.clientInfo.version : undefined,
        };
      }
      if (isRequest) {
        writeClient({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: initializeInstructions(SERVER_INSTRUCTIONS) } });
        routeToDaemon(JSON.stringify({ ...msg, id: daemonInitId }));
      } else {
        routeToDaemon(line);
      }
    } else if (msg.method === 'tools/list') {
      if (isRequest) writeClient({ jsonrpc: '2.0', id: msg.id, result: { tools: getStaticTools() } });
    } else if (msg.method === 'resources/list') {
      if (isRequest) writeClient({ jsonrpc: '2.0', id: msg.id, result: { resources: [] } });
    } else if (msg.method === 'resources/templates/list') {
      if (isRequest) writeClient({ jsonrpc: '2.0', id: msg.id, result: { resourceTemplates: [] } });
    } else if (msg.method === 'prompts/list') {
      if (isRequest) writeClient({ jsonrpc: '2.0', id: msg.id, result: { prompts: [] } });
    } else {
      routeToDaemon(line);
    }
  }

  function drainStdinBuffer(): void {
    if (drainingInput) return;
    drainingInput = true;
    try {
      if (stdinBufBytes > MAX_PROXY_RETAINED_REQUEST_BYTES) {
        failProxy('input_overflow');
        return;
      }
      let framedLines = 0;
      while (canConsumeInput()) {
        const idx = stdinBuf.indexOf('\n');
        if (idx === -1) {
          if (stdinBufBytes > MAX_PROXY_REQUEST_LINE_BYTES) failProxy('input_overflow');
          break;
        }
        if (++framedLines > MAX_PROXY_FRAMES_PER_DRAIN) {
          failProxy('input_overflow');
          break;
        }
        const consumed = stdinBuf.slice(0, idx + 1);
        const consumedBytes = Buffer.byteLength(consumed, 'utf8');
        if (consumedBytes > MAX_PROXY_REQUEST_LINE_BYTES) {
          failProxy('input_overflow');
          break;
        }
        const line = consumed.slice(0, -1).trim();
        stdinBuf = stdinBuf.slice(idx + 1);
        stdinBufBytes = Math.max(0, stdinBufBytes - consumedBytes);
        if (line) processClientLine(line);
      }
      if (stdinBufBytes > MAX_PROXY_RETAINED_REQUEST_BYTES) failProxy('input_overflow');
    } finally {
      drainingInput = false;
      updateInputFlow();
    }
  }

  // ---- client (stdin) ----
  output.on('error', onOutputError);
  output.on('close', onOutputClose);
  diagnostics.on('error', onDiagnosticsError);
  input.setEncoding('utf8');
  const onInputData = (chunk: string): void => {
    stdinBuf += chunk;
    stdinBufBytes += Buffer.byteLength(chunk, 'utf8');
    drainStdinBuffer();
  };
  input.on('data', onInputData);
  // Shut down when stdin ends/closes — and also on a stdin `'error'`, which a
  // socket-backed stdin (the VS Code stdio shape) can emit on client death
  // instead of a clean close; destroying the stream stops a hung fd from
  // busy-spinning the event loop (#799).
  treatStdinFailureAsShutdown(shutdown, input);
  if (installLifecycleGuards) startPpidWatchdogNoSocket(shutdown);
  // Backstop for a launch abandoned before any of the above can see it: killed
  // launcher + held-open pipes + reparent that beat the EARLY_PPID capture
  // (#1185). A server that never receives a single byte isn't serving anyone.
  // Armed after the stdin 'data' consumer above so no bytes are emitted while
  // only the backstop's listener exists.
  disarmStartupTimeout = armStartupHandshakeTimeout(() => {
    writeDiagnostic(
      '[CodeGraph MCP] No MCP traffic since startup; assuming an abandoned launch and shutting down (#1185). ' +
      'Tune with CODEGRAPH_STARTUP_HANDSHAKE_TIMEOUT_MS (0 disables).\n'
    );
    shutdown();
  }, input, installLifecycleGuards ? undefined : 0);

  // ---- daemon connection (on first daemon-bound application input) ----
  // Do not authenticate an idle socket while the host has not sent anything
  // that needs the daemon. The daemon intentionally bounds the first
  // application-message wait; attaching here only after a line is retained
  // prevents a slow MCP host from exhausting that deadline and degrading to a
  // second in-process engine.
  const connectionNeeded = await Promise.race([
    daemonConnectionRequest.then(() => true),
    finished.then(() => false),
  ]);
  if (!connectionNeeded || shuttingDown) return;
  let socket: net.Socket | null = null;
  const connectionController = new AbortController();
  daemonConnectionController = connectionController;
  try {
    const connection = deps.getDaemonSocket(connectionController.signal);
    // Promise.race does not cancel the losing branch. Dispose a late result
    // even when an injected/custom connector ignores the abort signal.
    void connection.then((lateSocket) => {
      if (shuttingDown) {
        try { lateSocket?.destroy(); } catch { /* already closed */ }
      }
    }, () => { /* handled by the awaited race below */ });
    socket = await Promise.race([
      connection,
      finished.then(() => null),
    ]);
  } catch { socket = null; }
  finally {
    if (daemonConnectionController === connectionController) {
      daemonConnectionController = null;
    }
  }

  if (shuttingDown) {
    try { socket?.destroy(); } catch { /* ignore */ }
    return;
  }

  // `!socket.destroyed`: the connect-window error guard above can absorb an
  // 'error' that already destroyed the socket before we got here (#974) — treat
  // a dead socket as "no daemon" so we cleanly fall back to the in-process engine.
  if (socket && !socket.destroyed && !shuttingDown) {
    daemonSocket = socket;
    daemonStatus = 'ready';
    let sockBuf = '';
    let sockBufBytes = 0;
    socket.setEncoding('utf8');
    drainDaemonInput = (): void => {
      if (daemonStatus !== 'ready') return;
      if (sockBufBytes > MAX_PROXY_BUFFERED_BYTES) {
        onDaemonProtocolFailure();
        return;
      }
      let idx: number;
      let framedLines = 0;
      while (!clientOutputBlocked && (idx = sockBuf.indexOf('\n')) !== -1) {
        if (++framedLines > MAX_PROXY_FRAMES_PER_DRAIN) {
          onDaemonProtocolFailure();
          return;
        }
        const consumed = sockBuf.slice(0, idx + 1);
        const consumedBytes = Buffer.byteLength(consumed, 'utf8');
        const line = consumed.slice(0, -1);
        sockBuf = sockBuf.slice(idx + 1);
        sockBufBytes = Math.max(0, sockBufBytes - consumedBytes);
        if (!line.trim()) continue;
        let resp: JsonRpc | null = null;
        try { resp = JSON.parse(line) as JsonRpc; } catch { /* not JSON — relay verbatim */ }
        if (process.env.CODEGRAPH_MCP_DEBUG) writeDiagnostic(`[mcp-debug] daemon->proxy ${line.slice(0, 80)}\n`);
        if (consumedBytes > MAX_PROXY_RESPONSE_LINE_BYTES) {
          if (!resp || resp.id === undefined || (!('result' in resp) && !('error' in resp))) {
            return onDaemonProtocolFailure();
          }
          const retained = inflight.get(resp.id);
          if (retained) inflightBytes = Math.max(0, inflightBytes - retained.bytes);
          inflight.delete(resp.id);
          if (resp.id === daemonInitId) continue;
          writeClient({
            jsonrpc: '2.0',
            id: resp.id,
            error: { code: -32603, message: 'Response exceeds transport limit' },
          });
          continue;
        }
        if (resp && resp.id !== undefined && ('result' in resp || 'error' in resp)) {
          const retained = inflight.get(resp.id);
          if (retained) inflightBytes = Math.max(0, inflightBytes - retained.bytes);
          inflight.delete(resp.id); // answered — no longer in flight
          // Suppress the daemon's reply to the initialize we forwarded to prime it
          // (the client already got the local handshake response).
          if (resp.id === daemonInitId) continue;
        }
        writeClient(line);
      }
      if (sockBufBytes > MAX_PROXY_BUFFERED_BYTES) {
        onDaemonProtocolFailure();
      }
      drainStdinBuffer();
      updateInputFlow();
    };
    const onDaemonData = (chunk: string): void => {
      sockBuf += chunk;
      sockBufBytes += Buffer.byteLength(chunk, 'utf8');
      drainDaemonInput();
    };
    discardDaemonInput = (): void => {
      socket.removeListener('data', onDaemonData);
      sockBuf = '';
      sockBufBytes = 0;
      drainDaemonInput = (): void => { /* daemon detached */ };
      discardDaemonInput = (): void => { /* already discarded */ };
    };
    socket.on('data', onDaemonData);
    // The daemon going away does NOT end the session (#662). An MCP host can
    // SIGTERM the shared daemon when another session starts; if we exited here,
    // this host would silently lose CodeGraph and any in-flight request would
    // hang. Instead, fall back to the in-process engine for the rest of the
    // session and re-serve whatever the dead daemon never answered.
    socket.on('close', onDaemonLost);
    socket.on('error', onDaemonLost);
    flushPendingToDaemon();
    drainStdinBuffer();
    updateInputFlow();
  } else if (!shuttingDown) {
    daemonStatus = 'failed';
    writeDiagnostic('[CodeGraph MCP] Shared daemon unavailable; serving this session in-process (degraded).\n');
    const buffered = pending.splice(0);
    pendingBytes = 0;
    pendingSaturated = false;
    for (const line of buffered) dispatchLocally(line);
    drainStdinBuffer();
    updateInputFlow();
  }

  await finished;
}

/** PPID watchdog for the local-handshake proxy — same #277 logic as
 *  {@link startPpidWatchdog} but with no socket to close (the caller's shutdown
 *  handles teardown). */
function startPpidWatchdogNoSocket(onDeath: () => void): void {
  const pollMs = parsePollMs(process.env.CODEGRAPH_PPID_POLL_MS);
  if (pollMs <= 0) return;
  // Baseline from the CLI entry's earliest capture, not process.ppid here —
  // a launcher killed during our first ~100ms would otherwise leave the
  // baseline at 1 and blind the divergence check forever (#1185).
  const originalPpid = EARLY_PPID;
  const hostPpid = parseHostPpid(process.env[HOST_PPID_ENV]);
  const timer = setInterval(() => {
    const reason = supervisionLostReason({
      originalPpid,
      currentPpid: process.ppid,
      hostPpid,
      isAlive: isProcessAliveLocal,
    });
    if (reason) {
      process.stderr.write(`[CodeGraph MCP] Parent process exited (${reason}); shutting down.\n`);
      onDeath();
    }
  }, pollMs);
  timer.unref?.();
}

/**
 * Read one CRLF/LF-terminated JSON line from the socket, parse it as the
 * daemon hello, and return it. Bounded to {@link MAX_HELLO_LINE_BYTES} so a
 * malicious or broken peer can't OOM us. Times out at 3s — a healthy daemon
 * sends hello immediately on accept.
 */
function readHelloLine(socket: net.Socket): Promise<DaemonHello> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      clearTimeout(timer);
    };
    const onData = (chunk: string | Buffer) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const idx = buffer.indexOf('\n');
      if (idx === -1) {
        if (buffer.length > MAX_HELLO_LINE_BYTES) {
          cleanup();
          reject(new Error('daemon hello line exceeded size limit'));
        }
        return;
      }
      const line = buffer.slice(0, idx);
      // Re-emit anything past the newline so the pipe-stage sees it.
      const tail = buffer.slice(idx + 1);
      cleanup();
      if (tail.length > 0) {
        // Push back via unshift — Node's net.Socket supports it on readable streams.
        socket.unshift(tail);
      }
      try {
        const parsed = JSON.parse(line) as DaemonHello;
        if (
          typeof parsed.codegraph !== 'string' ||
          typeof parsed.pid !== 'number' ||
          typeof parsed.socketPath !== 'string' ||
          parsed.protocol !== DAEMON_HANDSHAKE_PROTOCOL ||
          !isValidDaemonInstanceId(parsed.instanceId) ||
          !isValidDaemonAuthNonce(parsed.nonce) ||
          !isValidDaemonAuthProof(parsed.proof)
        ) {
          reject(new Error('daemon hello missing required fields'));
          return;
        }
        resolve(parsed);
      } catch (err) {
        reject(new Error(`daemon hello not JSON: ${err instanceof Error ? err.message : String(err)}`));
      }
    };
    const onError = (err: Error) => { cleanup(); reject(err); };
    const onClose = () => { cleanup(); reject(new Error('daemon closed connection before hello')); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for daemon hello'));
    }, 3000);
    timer.unref?.();
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

/** Injectable endpoints and a test-only deadline override for the plain proxy. */
export interface ProxyPipeOptions {
  input?: Readable;
  output?: Writable;
  diagnostics?: Writable;
  /** Test seam; production uses the fixed five-second drain deadline. */
  drainDeadlineMs?: number;
}

/**
 * Transparently forwards stdin ↔ daemon bytes with bounded destination
 * buffers. Backpressured sources pause until drain, and terminal events wait
 * for accepted writes to flush within the fixed deadline before returning an
 * exit code to the launcher.
 */
export function pipeUntilClose(socket: net.Socket, options: ProxyPipeOptions = {}): Promise<number> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const diagnostics = options.diagnostics ?? process.stderr;
  const configuredDeadline = options.drainDeadlineMs;
  const drainDeadlineMs = typeof configuredDeadline === 'number'
    && Number.isFinite(configuredDeadline)
    && configuredDeadline > 0
    ? configuredDeadline
    : PROXY_DRAIN_DEADLINE_MS;

  return new Promise((resolve) => {
    let settled = false;
    let terminalSource: 'input' | 'socket' | null = null;
    let terminalCode: 0 | 1 = 0;
    let socketReadableEnded = false;
    let socketClosed = false;
    let socketWritableFinished = false;
    let socketOutputBlocked = false;
    let clientOutputBlocked = false;
    let pendingSocketWrites = 0;
    let pendingClientWrites = 0;
    let socketDrainTimer: ReturnType<typeof setTimeout> | null = null;
    let clientDrainTimer: ReturnType<typeof setTimeout> | null = null;
    let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

    const writeDiagnostic = (message: string): void => {
      try { diagnostics.write(message); } catch { /* best-effort */ }
    };
    const clearSocketDrainDeadline = (): void => {
      if (socketDrainTimer) clearTimeout(socketDrainTimer);
      socketDrainTimer = null;
    };
    const clearClientDrainDeadline = (): void => {
      if (clientDrainTimer) clearTimeout(clientDrainTimer);
      clientDrainTimer = null;
    };
    const clearShutdownDeadline = (): void => {
      if (shutdownTimer) clearTimeout(shutdownTimer);
      shutdownTimer = null;
    };
    const cleanup = (): void => {
      clearSocketDrainDeadline();
      clearClientDrainDeadline();
      clearShutdownDeadline();
      input.removeListener('data', onInputData);
      input.removeListener('end', onInputEnd);
      input.removeListener('close', onInputClose);
      input.removeListener('error', onInputError);
      socket.removeListener('data', onSocketData);
      socket.removeListener('drain', onSocketDrain);
      socket.removeListener('finish', onSocketFinish);
      socket.removeListener('end', onSocketEnd);
      socket.removeListener('close', onSocketClose);
      socket.removeListener('error', onSocketError);
      output.removeListener('drain', onClientDrain);
      output.removeListener('close', onOutputClose);
      output.removeListener('error', onOutputError);
    };
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.on('error', () => { /* contain a late socket error during process exit */ });
      try { input.destroy(); } catch { /* ignore */ }
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(code);
    };
    const fail = (reason: 'buffer_overflow' | 'drain_timeout' | 'stream_failure'): void => {
      writeDiagnostic(`[CodeGraph MCP] proxy_${reason}\n`);
      finish(1);
    };
    const maybeFinish = (): void => {
      if (!terminalSource || settled) return;
      if (terminalSource === 'socket' && terminalCode === 1) {
        if (pendingClientWrites === 0 && !clientOutputBlocked) finish(1);
        return;
      }
      const writesFlushed = pendingSocketWrites === 0
        && pendingClientWrites === 0
        && !socketOutputBlocked
        && !clientOutputBlocked;
      const socketOutputFinished = socketWritableFinished || socketClosed;
      const socketInputFinished = socketReadableEnded || socketClosed;
      if (writesFlushed
        && socketOutputFinished
        && (terminalSource === 'socket' || socketInputFinished)) {
        finish(terminalCode);
      }
    };
    const armShutdownDeadline = (): void => {
      if (shutdownTimer || settled) return;
      shutdownTimer = setTimeout(() => {
        const clientWritesFlushed = pendingClientWrites === 0 && !clientOutputBlocked;
        if (terminalSource === 'socket' && terminalCode === 1 && clientWritesFlushed) {
          finish(1);
          return;
        }
        const outboundFlushed = pendingSocketWrites === 0
          && pendingClientWrites === 0
          && !socketOutputBlocked
          && !clientOutputBlocked
          && (socketWritableFinished || socketClosed);
        if (terminalSource === 'input' && outboundFlushed) finish(terminalCode);
        else fail('drain_timeout');
      }, drainDeadlineMs);
      shutdownTimer.unref?.();
    };
    const beginInputShutdown = (code: 0 | 1 = 0): void => {
      if (settled) return;
      if (code === 1) terminalCode = 1;
      if (terminalSource === null) terminalSource = 'input';
      input.removeListener('data', onInputData);
      try { input.pause(); } catch { /* ignore */ }
      armShutdownDeadline();
      try { socket.end(); } catch {
        beginSocketFailure('[CodeGraph MCP] proxy_stream_failure\n');
        return;
      }
      maybeFinish();
    };
    const beginSocketShutdown = (code: 0 | 1 = 0): void => {
      if (settled) return;
      socketReadableEnded = true;
      if (code === 1) {
        terminalCode = 1;
        terminalSource = 'socket';
      } else if (terminalSource === null) {
        terminalSource = 'socket';
      }
      input.removeListener('data', onInputData);
      try { input.pause(); } catch { /* ignore */ }
      armShutdownDeadline();
      try {
        if (terminalCode === 1) socket.destroy();
        else socket.end();
      } catch {
        if (terminalCode === 1) maybeFinish();
        else fail('stream_failure');
        return;
      }
      maybeFinish();
    };
    const beginSocketFailure = (diagnostic: string): void => {
      if (terminalCode !== 1) writeDiagnostic(diagnostic);
      beginSocketShutdown(1);
    };
    const chunkBytes = (chunk: string | Buffer): number => Buffer.isBuffer(chunk)
      ? chunk.length
      : Buffer.byteLength(chunk, 'utf8');
    function onInputData(value: string | Buffer): void {
      if (settled || terminalSource) return;
      const chunk = Buffer.isBuffer(value) || typeof value === 'string' ? value : Buffer.from(value);
      const bytes = chunkBytes(chunk);
      const writableBytes = Number.isSafeInteger(socket.writableLength) ? socket.writableLength : 0;
      if (bytes > MAX_PROXY_BUFFERED_BYTES || writableBytes + bytes > MAX_PROXY_BUFFERED_BYTES) {
        fail('buffer_overflow');
        return;
      }
      pendingSocketWrites += 1;
      try {
        const accepted = socket.write(chunk, (error?: Error | null) => {
          pendingSocketWrites = Math.max(0, pendingSocketWrites - 1);
          if (error) beginSocketFailure('[CodeGraph MCP] proxy_stream_failure\n');
          else maybeFinish();
        });
        if (!accepted) {
          socketOutputBlocked = true;
          input.pause();
          socket.once('drain', onSocketDrain);
          clearSocketDrainDeadline();
          socketDrainTimer = setTimeout(() => fail('drain_timeout'), drainDeadlineMs);
          socketDrainTimer.unref?.();
        }
      } catch {
        pendingSocketWrites = Math.max(0, pendingSocketWrites - 1);
        beginSocketFailure('[CodeGraph MCP] proxy_stream_failure\n');
      }
    }
    function onSocketDrain(): void {
      if (settled) return;
      socketOutputBlocked = false;
      clearSocketDrainDeadline();
      if (!terminalSource) input.resume();
      maybeFinish();
    }
    function onSocketData(value: string | Buffer): void {
      if (settled) return;
      const chunk = Buffer.isBuffer(value) || typeof value === 'string' ? value : Buffer.from(value);
      const bytes = chunkBytes(chunk);
      const writableBytes = Number.isSafeInteger(output.writableLength) ? output.writableLength : 0;
      if (bytes > MAX_PROXY_BUFFERED_BYTES || writableBytes + bytes > MAX_PROXY_BUFFERED_BYTES) {
        fail('buffer_overflow');
        return;
      }
      pendingClientWrites += 1;
      try {
        const accepted = output.write(chunk, (error?: Error | null) => {
          pendingClientWrites = Math.max(0, pendingClientWrites - 1);
          if (error) fail('stream_failure');
          else maybeFinish();
        });
        if (!accepted) {
          clientOutputBlocked = true;
          socket.pause();
          output.once('drain', onClientDrain);
          clearClientDrainDeadline();
          clientDrainTimer = setTimeout(() => fail('drain_timeout'), drainDeadlineMs);
          clientDrainTimer.unref?.();
        }
      } catch {
        pendingClientWrites = Math.max(0, pendingClientWrites - 1);
        fail('stream_failure');
      }
    }
    function onClientDrain(): void {
      if (settled) return;
      clientOutputBlocked = false;
      clearClientDrainDeadline();
      if (terminalSource !== 'socket') socket.resume();
      maybeFinish();
    }
    function onInputEnd(): void { beginInputShutdown(); }
    function onInputClose(): void { beginInputShutdown(); }
    function onInputError(): void {
      if (terminalCode !== 1) writeDiagnostic('[CodeGraph MCP] proxy_stream_failure\n');
      beginInputShutdown(1);
    }
    function onSocketFinish(): void {
      socketWritableFinished = true;
      maybeFinish();
    }
    function onSocketEnd(): void { beginSocketShutdown(); }
    function onSocketClose(hadError: boolean): void {
      socketClosed = true;
      if (hadError) beginSocketFailure('[CodeGraph MCP] proxy_stream_failure\n');
      else beginSocketShutdown(terminalCode);
    }
    function onSocketError(err: Error): void {
      beginSocketFailure(process.env.CODEGRAPH_MCP_DEBUG
        ? `[mcp-debug] proxy socket error: ${err.message}\n`
        : '[CodeGraph MCP] daemon_socket_failure\n');
    }
    function onOutputClose(): void { fail('stream_failure'); }
    function onOutputError(): void { fail('stream_failure'); }
    function onDiagnosticsError(): void { /* diagnostics are best-effort */ }

    input.on('data', onInputData);
    input.on('end', onInputEnd);
    input.on('close', onInputClose);
    input.on('error', onInputError);
    socket.on('data', onSocketData);
    socket.on('finish', onSocketFinish);
    socket.on('end', onSocketEnd);
    socket.on('close', onSocketClose);
    socket.on('error', onSocketError);
    output.on('close', onOutputClose);
    output.on('error', onOutputError);
    diagnostics.on('error', onDiagnosticsError);
  });
}

/**
 * PPID watchdog mirroring the one in `MCPServer.start` — kills the proxy if
 * the MCP host (or its proxy of a host, see HOST_PPID_ENV) goes away without
 * closing stdin. Issue #277 documents why we can't rely on stdin EOF on
 * Linux: the parent may be SIGKILL'd and reparenting doesn't close pipes.
 *
 * The proxy's "kill" is just a socket close + process.exit — no SQLite or
 * watchers to clean up, so this is cheap.
 */
function startPpidWatchdog(socket: net.Socket): void {
  const pollMs = parsePollMs(process.env.CODEGRAPH_PPID_POLL_MS);
  if (pollMs <= 0) return;
  // Baseline from the CLI entry's earliest capture, not process.ppid here —
  // a launcher killed during our first ~100ms would otherwise leave the
  // baseline at 1 and blind the divergence check forever (#1185).
  const originalPpid = EARLY_PPID;
  const hostPpid = parseHostPpid(process.env[HOST_PPID_ENV]);
  const timer = setInterval(() => {
    const reason = supervisionLostReason({
      originalPpid,
      currentPpid: process.ppid,
      hostPpid,
      isAlive: isProcessAliveLocal,
    });
    if (reason) {
      process.stderr.write(`[CodeGraph MCP] Parent process exited (${reason}); shutting down.\n`);
      try { socket.destroy(); } catch { /* ignore */ }
      process.exit(0);
    }
  }, pollMs);
  timer.unref?.();
}

function parsePollMs(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PPID_POLL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_PPID_POLL_MS;
  if (parsed < 0) return DEFAULT_PPID_POLL_MS;
  return Math.floor(parsed);
}

function parseHostPpid(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 1) return null;
  return parsed;
}

function isProcessAliveLocal(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EPERM') return true;
    return false;
  }
}
