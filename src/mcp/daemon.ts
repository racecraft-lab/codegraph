/**
 * Shared MCP daemon — issue #411.
 *
 * One detached `codegraph serve --mcp` daemon process per project root,
 * accepting N concurrent MCP clients over a Unix-domain socket (or named pipe
 * on Windows). Each incoming connection gets its own {@link MCPSession}; all
 * sessions share a single {@link MCPEngine}, which means a single file watcher
 * (one inotify set), a single SQLite connection (one WAL writer), and a single
 * tree-sitter warm-up — paid once, amortized across every agent talking to the
 * project.
 *
 * Lifecycle (see also `./index.ts` and `./proxy.ts`):
 *   - The daemon is spawned **detached** (its own session/process group, stdio
 *     decoupled) by the first launcher that finds no daemon running. It is NOT
 *     a child of any MCP host, so closing one terminal / Ctrl-C'ing one session
 *     can't take it down and sever the others. That's why this process has no
 *     PPID watchdog: it deliberately outlives every individual client.
 *   - Every MCP host talks to the daemon through a thin `proxy` process (the
 *     thing the host actually spawned). The proxy keeps the #277 PPID watchdog,
 *     so a SIGKILL'd host still reaps its proxy promptly; the proxy's socket
 *     close then decrements the daemon's refcount.
 *   - When the last client disconnects the daemon lingers for
 *     `CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS` (default 300s) so back-to-back agent
 *     runs in the same project don't repay startup, then exits cleanly. This is
 *     what keeps a single-agent session from leaking a daemon forever (#277).
 *
 * What this file owns:
 *   - Listening on the daemon socket and spawning per-connection sessions.
 *   - The handshake "hello" line that lets a proxy verify it found a
 *     same-version daemon before piping any JSON-RPC through it.
 *   - The owner-only lock competing daemons arbitrate against — under the
 *     project on POSIX and the user profile on Windows — plus cleanup on exit.
 *   - Reference counting + idle timeout.
 *   - Graceful shutdown on SIGTERM/SIGINT and idle exit.
 *
 * What this file does NOT own:
 *   - The proxy side (`./proxy.ts`).
 *   - The decision of *whether* to run as daemon at all — that's `MCPServer`.
 *   - The MCP protocol state machine — that's `./session.ts`.
 */

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import {
  DAEMON_HANDSHAKE_PROTOCOL,
  createDaemonAuthNonce,
  createDaemonAuthSecret,
  createDaemonClientProof,
  createDaemonServerProof,
  daemonProofMatches,
  isValidDaemonAuthNonce,
  isValidDaemonAuthProof,
} from './daemon-auth';
import { MCPEngine } from './engine';
import { MCPSession } from './session';
import {
  ErrorCodes,
  MAX_SOCKET_EMERGENCY_OUTPUT_BYTES,
  SocketOutputBudget,
  SocketRequestBudget,
  SocketTransport,
} from './transport';
import {
  DaemonLockInfo,
  DAEMON_LOCK_RECORD_NAME,
  clearStaleDaemonLock,
  daemonLockDirectoryIsTrusted,
  encodeLockInfo,
  ensureDaemonLockDirectory,
  ensureDaemonSocketDirectory,
  getDaemonPidPath,
  getDaemonLockRecordPath,
  getDaemonSocketCandidates,
  getDaemonSocketPath,
  recoverDaemonLockDirectory,
  recoverDaemonLockQuarantines,
  readDaemonLockFile,
  readTrustedDaemonLock,
  removeOwnedDaemonSocket,
} from './daemon-paths';
import { CodeGraphPackageVersion } from './version';
import { registerDaemon, deregisterDaemon } from './daemon-registry';
import type { DaemonElectionGuard } from './daemon-election';
import {
  getProcessBirthId,
  isProcessAlive,
} from './daemon-process';
export { tryAcquireDaemonElectionGuard, type DaemonElectionGuard } from './daemon-election';
export { getProcessBirthId, isDaemonProcessAlive, isProcessAlive } from './daemon-process';
export { clearStaleDaemonLock } from './daemon-paths';

/** Default idle linger after the last client disconnects. */
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

/**
 * Hard ceiling on how long the daemon stays up with clients connected but no
 * inbound traffic. A backstop (#692): if a client's socket-close is never
 * delivered (a Windows named-pipe hazard) it stays counted forever and the
 * normal idle timer — which only arms at zero clients — never fires. A phantom
 * client sends no traffic, so bounding on inactivity reaps the daemon anyway.
 * Set generously so a real but momentarily-idle session isn't reaped mid-use.
 */
const DEFAULT_MAX_IDLE_MS = 1_800_000; // 30 min

/**
 * Windows-only shutdown backstop. On Windows, calling `process.exit()` while a
 * recursive `fs.watch` handle is still tearing down aborts the process with a
 * libuv `UV_HANDLE_CLOSING` assertion (`0xC0000409`) — reproducible whenever the
 * watched tree contains a nested repo (submodule / embedded clone), since that's
 * what keeps a watch active at shutdown. The fix is to let the event loop drain
 * so libuv finishes closing those handles, then exit naturally; this timer only
 * force-exits if some unexpected handle keeps the loop alive past the grace
 * window. Kept short so shutdown stays snappy in that fallback. See
 * `finalizeDaemonExit`.
 */
const DAEMON_SHUTDOWN_BACKSTOP_MS = 2_000;

/**
 * Finalize daemon shutdown. On POSIX, exit immediately — it's clean and fast.
 * On Windows, do NOT force an exit while watchers may still be closing (that
 * trips the libuv assertion above); instead mark success and let the loop drain
 * to a natural exit, with an UNREF'd backstop that force-exits only if a stray
 * handle would otherwise hang shutdown. Pure and platform-injected so both
 * branches are unit-testable off-Windows. Returns the backstop timer (Windows)
 * so callers/tests can clear it.
 */
export function finalizeDaemonExit(
  platform: NodeJS.Platform,
  exit: (code: number) => void,
): NodeJS.Timeout | null {
  if (platform === 'win32') {
    process.exitCode = 0;
    const backstop = setTimeout(() => exit(0), DAEMON_SHUTDOWN_BACKSTOP_MS);
    // Unref so it never keeps the loop alive: a natural drain (watchers closed,
    // nothing else pending) exits before it fires; it only fires when some other
    // handle is keeping the loop running, which is exactly when we need it.
    backstop.unref?.();
    return backstop;
  }
  exit(0);
  return null;
}

/** How often the daemon sweeps connected clients for a dead peer process (#692). */
const DEFAULT_CLIENT_SWEEP_MS = 30_000;

/** How long the daemon waits for the required authenticated client hello. */
const CLIENT_HELLO_TIMEOUT_MS = 3_000;
const CLIENT_FIRST_MESSAGE_TIMEOUT_MS = 3_000;
const CONTROL_REQUEST_LINE_BYTES = 4_096;
const CONTROL_RESPONSE_DRAIN_TIMEOUT_MS = 1_000;

/** Combined ceiling for pending handshakes and active daemon sessions. */
export const MAX_DAEMON_CLIENT_CONNECTIONS = 128;

/** Aggregate daemon ceilings for authenticated request work across all peers. */
export const MAX_DAEMON_ACTIVE_REQUESTS = 64;
export const MAX_DAEMON_RETAINED_REQUEST_BYTES = 16 * 1024 * 1024;
export const MAX_DAEMON_RETAINED_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_DAEMON_OUTPUT_OVERLOAD_BYTES =
  MAX_DAEMON_CLIENT_CONNECTIONS * MAX_SOCKET_EMERGENCY_OUTPUT_BYTES;
const MAX_DAEMON_REQUEST_LINE_BYTES = 1024 * 1024;
const MAX_DAEMON_CLIENT_RETAINED_REQUEST_BYTES = 2 * 1024 * 1024;

/** Bytes/parse-window for an oversized hello line — bounded against a malicious peer. */
const MAX_HELLO_LINE_BYTES = 4096;

/**
 * Wire format for the one-shot hello line the daemon emits on every new
 * connection. Versioned with the package's own semver so a 0.9.x proxy never
 * pipes through a 0.10.x daemon (or vice-versa) — the proxy falls back to
 * direct mode on mismatch rather than risk subtle wire incompatibilities.
 */
export interface DaemonHello {
  codegraph: string; // package version (must match the proxy's own version)
  pid: number;       // daemon pid (informational; for `ps` debugging)
  socketPath: string; // echoed back so the proxy can log it
  protocol: typeof DAEMON_HANDSHAKE_PROTOCOL;
  instanceId: string; // matches the owner-only lock record for this daemon lifetime
  nonce: string;      // fresh challenge for this connection
  proof: string;      // HMAC proving possession of the lockfile-only secret
}

/**
 * Optional reverse-handshake line a proxy sends right after it verifies the
 * daemon hello, carrying its own pids so the daemon can reap the client if its
 * process dies WITHOUT the socket ever signalling close (the Windows named-pipe
 * hazard behind #692). Entirely optional and fail-safe: a connection that never
 * sends it (a legacy/direct client) just falls back to the socket-close
 * lifecycle. The `codegraph_client` marker is what tells it apart from the
 * client's first JSON-RPC message.
 */
export interface DaemonClientHello {
  codegraph_client: 1;
  pid: number;             // the proxy process's own pid
  hostPid: number | null;  // the MCP host pid (past any launcher shim), if known
  instanceId: string;
  nonce: string;
  proof: string;
}

export interface DaemonStartResult {
  /** Always-non-null for a successfully-started daemon. */
  socketPath: string;
  /** Lockfile contents as written. */
  lock: DaemonLockInfo;
}

/**
 * Run as the shared daemon for `projectRoot`. Resolves once the socket is
 * listening. The Daemon owns the socket, the engine, and the lockfile until
 * `stop()` is called or it exits on idle/signal.
 *
 * Race-safe: callers hold a kernel-backed election lease for this daemon's
 * lifetime and only construct it after `tryAcquireDaemonLock(projectRoot)`
 * returned `kind: 'acquired'`. The atomic lock publication remains the
 * authenticated rendezvous record; the lease excludes election and cleanup.
 */
export class Daemon {
  private server: net.Server | null = null;
  private clients = new Set<MCPSession>();
  /** Accepted sockets still waiting for the authenticated client hello. */
  private pendingClientSockets = new Set<net.Socket>();
  /** One extra authenticated first-message probe reserved for lifecycle control. */
  private pendingControlSocket: net.Socket | null = null;
  /** Authenticated control responses retained only until flush or a short deadline. */
  private controlSockets = new Map<net.Socket, NodeJS.Timeout>();
  /** Per-client peer pids from the authenticated client hello, for the liveness sweep. */
  private clientPeers = new Map<MCPSession, { pid: number | null; hostPid: number | null }>();
  private authenticatedShutdownScheduled = false;
  private authenticatedShutdownStarted = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private idleTimeoutMs: number;
  private maxIdleMs: number;
  private lastActivityAt = Date.now();
  private maxIdleTimer: NodeJS.Timeout | null = null;
  private clientSweepTimer: NodeJS.Timeout | null = null;
  private engine: MCPEngine;
  private stopping = false;
  private socketPath: string;
  private pidPath: string;
  private instanceId: string;
  private authSecret: string;
  private startedAt: number;
  private processBirthId: string | undefined;
  private electionProtocol: 1 | undefined;
  private electionGuard: DaemonElectionGuard | null;
  private requestBudget = new SocketRequestBudget(
    MAX_DAEMON_ACTIVE_REQUESTS,
    MAX_DAEMON_RETAINED_REQUEST_BYTES,
  );
  private outputBudget = new SocketOutputBudget(
    MAX_DAEMON_RETAINED_OUTPUT_BYTES,
    MAX_DAEMON_OUTPUT_OVERLOAD_BYTES,
  );

  constructor(
    private projectRoot: string,
    opts: {
      idleTimeoutMs?: number;
      maxIdleMs?: number;
      lockInfo?: DaemonLockInfo;
      electionGuard?: DaemonElectionGuard;
    } = {},
  ) {
    this.pidPath = getDaemonPidPath(projectRoot);
    this.idleTimeoutMs = opts.idleTimeoutMs ?? resolveIdleTimeoutMs();
    this.maxIdleMs = opts.maxIdleMs ?? resolveMaxIdleMs();
    this.instanceId = opts.lockInfo?.instanceId ?? randomUUID();
    this.authSecret = opts.lockInfo?.authSecret ?? createDaemonAuthSecret();
    this.socketPath = getDaemonSocketPath(projectRoot, this.instanceId);
    this.startedAt = opts.lockInfo?.startedAt ?? Date.now();
    this.processBirthId = opts.lockInfo?.processBirthId ?? getProcessBirthId(process.pid) ?? undefined;
    this.electionProtocol = opts.lockInfo?.electionProtocol ?? (opts.electionGuard ? 1 : undefined);
    this.electionGuard = opts.electionGuard ?? null;
    // Daemon mode serves many concurrent clients on one event loop, so off-load
    // read-tool dispatch to a worker pool — otherwise concurrent explores
    // serialize and starve the MCP transport (clients time out). Direct mode
    // (one stdio client) leaves the pool off; `CODEGRAPH_QUERY_POOL_SIZE=0`
    // disables it here too.
    this.engine = new MCPEngine({ queryPool: true });
    this.engine.setProjectPathHint(projectRoot);
  }

  /**
   * Bind the socket, kick off engine init, and register signal handlers. The
   * lockfile body was already written atomically by `tryAcquireDaemonLock`, so
   * there is nothing to write here. The promise resolves once the server is
   * listening — the daemon then sticks around until idle/shutdown.
   */
  async start(): Promise<DaemonStartResult> {
    const candidates = getDaemonSocketCandidates(this.projectRoot, this.instanceId);
    try {
      return await this.startOwned(candidates);
    } catch (err) {
      await this.cleanupFailedStart(candidates);
      throw err;
    }
  }

  private async startOwned(candidates: string[]): Promise<DaemonStartResult> {
    ensureDaemonLockDirectory(this.projectRoot);
    const ownedLock = readTrustedDaemonLock(this.projectRoot);
    if (
      !ownedLock ||
      ownedLock.pid !== process.pid ||
      ownedLock.instanceId !== this.instanceId ||
      ownedLock.authSecret !== this.authSecret
    ) {
      throw new Error('daemon lock ownership changed before socket bind');
    }
    // Walk the ordered socket candidates and bind the first that works. The
    // in-project path comes first; the deterministic tmpdir path is the fallback
    // for a filesystem that can't host an AF_UNIX node at all (ExFAT/FAT external
    // volumes, some network mounts, WSL2 DrvFs → ENOTSUP/EACCES; #997, #974). The
    // `listen` closure clears a stale owner-owned socket (left by a SIGKILL'd
    // previous daemon) before each attempt. Regular files, symlinks, and unsafe
    // project directories are preserved and make listen fail closed.
    const listen = (socketPath: string): Promise<net.Server> =>
      new Promise<net.Server>((resolve, reject) => {
        if (process.platform !== 'win32') {
          ensureDaemonSocketDirectory(this.projectRoot, socketPath);
          removeOwnedDaemonSocket(this.projectRoot, socketPath);
        }
        const server = net.createServer((socket) => this.handleConnection(socket));
        const onBindError = (error: Error): void => reject(error);
        server.once('error', onBindError);
        server.listen(socketPath, () => {
          server.removeListener('error', onBindError);
          if (process.platform !== 'win32') {
            try {
              fs.chmodSync(socketPath, 0o600);
              const stat = fs.lstatSync(socketPath);
              const uid = process.getuid?.();
              if (
                !stat.isSocket() ||
                stat.isSymbolicLink() ||
                (stat.mode & 0o077) !== 0 ||
                (uid !== undefined && stat.uid !== uid)
              ) throw new Error('daemon socket is not owner-only');
            } catch (err) {
              const finish = (): void => {
                removeOwnedDaemonSocket(this.projectRoot, socketPath);
                reject(err);
              };
              try { server.close(() => finish()); } catch { finish(); }
              return;
            }
          }
          server.on('error', () => {
            if (this.stopping) return;
            process.stderr.write('[CodeGraph daemon] Listener failed; shutting down safely.\n');
            void this.stop('listener error');
          });
          resolve(server);
        });
      });

    const bound = await bindFirstUsableSocket(candidates, listen, {
      onRelocate: (from, to, code) =>
        process.stderr.write(
          `[CodeGraph daemon] Socket ${from} unusable (${code}); relocating to ${to}.\n`
        ),
    });

    this.server = bound.server;
    // Adopt the path we ACTUALLY bound — it may be a tmpdir fallback past an
    // unusable in-project location. Everything downstream (lockfile, registry,
    // chmod, cleanup, status) keys off this real path, not the preferred guess.
    this.socketPath = bound.socketPath;

    const lock: DaemonLockInfo = {
      pid: process.pid,
      processBirthId: this.processBirthId,
      electionProtocol: this.electionProtocol,
      version: CodeGraphPackageVersion,
      socketPath: this.socketPath,
      startedAt: this.startedAt,
      instanceId: this.instanceId,
      authSecret: this.authSecret,
    };

    // `tryAcquireDaemonLock` wrote the pidfile with the PREFERRED path (candidate
    // 0) before we knew which one would bind. If we relocated, rewrite it so the
    // per-project record is honest. Atomic temp+rename; safe because we hold the
    // lock and we're alive — `clearStaleDaemonLock` pid-verifies, so no racing
    // candidate clears or clobbers a live daemon's lock.
    if (this.socketPath !== candidates[0]) {
      const tmpPid = `${this.pidPath}.${process.pid}.${randomUUID()}.relocate`;
      try {
        fs.writeFileSync(tmpPid, encodeLockInfo(lock), { mode: 0o600, flag: 'wx' });
        fs.renameSync(tmpPid, getDaemonLockRecordPath(this.pidPath));
      } finally {
        try { fs.unlinkSync(tmpPid); } catch { /* renamed or never created */ }
      }
    }

    // Start engine initialization only after every fallible ownership/bind step
    // has completed. The first session still awaits this same initialization,
    // while failed starters never open watchers or database handles.
    void this.engine.ensureInitialized(this.projectRoot);

    // Drop a discovery record so `codegraph list` / `stop --all` can find us.
    // Best-effort; a missing record only means list's liveness prune covers it.
    registerDaemon({
      root: this.projectRoot,
      pid: lock.pid,
      processBirthId: lock.processBirthId,
      electionProtocol: lock.electionProtocol,
      version: lock.version,
      socketPath: lock.socketPath,
      startedAt: lock.startedAt,
      instanceId: lock.instanceId,
    });

    process.stderr.write(
      `[CodeGraph daemon] Listening on ${this.socketPath} (pid ${process.pid}, v${CodeGraphPackageVersion}). Idle timeout ${this.idleTimeoutMs}ms.\n`
    );

    // No clients yet: arm the idle timer immediately so a daemon that nobody
    // ever connects to (e.g. spawned then abandoned because the launcher died)
    // doesn't pin resources forever.
    this.armIdleTimer();
    this.startLivenessTimers();

    process.on('SIGINT', () => this.stop('SIGINT'));
    process.on('SIGTERM', () => this.stop('SIGTERM'));

    return { socketPath: this.socketPath, lock };
  }

  /** Release every resource acquired before start() reached its ownership handoff. */
  private async cleanupFailedStart(candidates: string[]): Promise<void> {
    this.stopping = true;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.maxIdleTimer) {
      clearInterval(this.maxIdleTimer);
      this.maxIdleTimer = null;
    }
    if (this.clientSweepTimer) {
      clearInterval(this.clientSweepTimer);
      this.clientSweepTimer = null;
    }
    this.closePendingClientSockets();
    for (const session of [...this.clients]) {
      try { session.stop(); } catch { /* best-effort */ }
    }
    this.clients.clear();
    this.clientPeers.clear();
    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise<void>((resolve) => {
        try { server.close(() => resolve()); } catch { resolve(); }
      });
    }
    try { this.engine.stop(); } catch { /* keep releasing ownership */ }
    try { deregisterDaemon(this.projectRoot, process.pid, this.instanceId); } catch { /* best-effort */ }
    if (process.platform !== 'win32') {
      for (const candidate of candidates) {
        try { removeOwnedDaemonSocket(this.projectRoot, candidate); } catch { /* best-effort */ }
      }
    }
    this.cleanupLockfile();
    const election = this.electionGuard;
    this.electionGuard = null;
    if (election) {
      try { await election.release(); } catch { /* connection close is best-effort */ }
    }
  }

  /** Currently-connected client count. Exposed for tests / status output. */
  getClientCount(): number {
    return this.clients.size;
  }

  /** The socket path the daemon is (or will be) listening on. */
  getSocketPath(): string {
    return this.socketPath;
  }

  /** Graceful shutdown: close all sessions, the engine, and clean up the lock. */
  async stop(reason: string = 'stop'): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.maxIdleTimer) {
      clearInterval(this.maxIdleTimer);
      this.maxIdleTimer = null;
    }
    if (this.clientSweepTimer) {
      clearInterval(this.clientSweepTimer);
      this.clientSweepTimer = null;
    }
    process.stderr.write(`[CodeGraph daemon] Shutting down (${reason}; clients=${this.clients.size}).\n`);
    this.closePendingClientSockets();
    for (const session of [...this.clients]) {
      try { session.stop(); } catch { /* best-effort */ }
    }
    this.clients.clear();
    this.clientPeers.clear();
    let cleanupFailed = false;
    const noteCleanupFailure = (): void => {
      if (cleanupFailed) return;
      cleanupFailed = true;
      try {
        process.stderr.write('[CodeGraph daemon] Shutdown cleanup encountered an internal failure.\n');
      } catch { /* continue releasing ownership */ }
    };
    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise<void>((resolve) => {
        try {
          server.close((error) => {
            if (error) noteCleanupFailure();
            resolve();
          });
        } catch {
          noteCleanupFailure();
          resolve();
        }
      });
    }
    try { this.engine.stop(); } catch { noteCleanupFailure(); }
    // Keep the authoritative lock until all discoverable artifacts are gone.
    // A replacement daemon cannot acquire the lock and bind while this process
    // is still removing its registry record or socket candidates.
    try { deregisterDaemon(this.projectRoot, process.pid, this.instanceId); } catch { noteCleanupFailure(); }
    if (process.platform !== 'win32') {
      for (const candidate of getDaemonSocketCandidates(this.projectRoot, this.instanceId)) {
        try { removeOwnedDaemonSocket(this.projectRoot, candidate); } catch { noteCleanupFailure(); }
      }
    }
    this.cleanupLockfile();
    const election = this.electionGuard;
    this.electionGuard = null;
    if (election) {
      try { await election.release(); } catch { noteCleanupFailure(); }
    }
    // POSIX exits here; Windows drains first (engine.stop() above began closing
    // the file watcher, and exiting mid-teardown aborts the process). See
    // finalizeDaemonExit / DAEMON_SHUTDOWN_BACKSTOP_MS.
    finalizeDaemonExit(process.platform, (code) => process.exit(code));
  }

  private handleConnection(socket: net.Socket): void {
    if (this.stopping || this.authenticatedShutdownScheduled || socket.destroyed) {
      socket.destroy();
      return;
    }
    const connectionLimitReached = this.pendingClientSockets.size
      + this.clients.size
      + this.controlSockets.size >= MAX_DAEMON_CLIENT_CONNECTIONS;
    const controlCandidate = connectionLimitReached
      || this.requestBudget.isSaturated(CONTROL_REQUEST_LINE_BYTES);
    if (controlCandidate) {
      if (this.pendingControlSocket || this.controlSockets.size > 0) {
        socket.destroy();
        return;
      }
      this.pendingControlSocket = socket;
    } else {
      this.pendingClientSockets.add(socket);
    }
    const releasePendingSocket = (): void => {
      if (controlCandidate) {
        if (this.pendingControlSocket === socket) this.pendingControlSocket = null;
      } else {
        this.pendingClientSockets.delete(socket);
      }
    };
    // Hello first so the proxy can verify versions before piping any
    // application bytes. The proxy reads exactly one line, then forwards.
    const nonce = createDaemonAuthNonce();
    const helloFields = {
      codegraph: CodeGraphPackageVersion,
      pid: process.pid,
      socketPath: this.socketPath,
      instanceId: this.instanceId,
    };
    const hello: DaemonHello = {
      ...helloFields,
      protocol: DAEMON_HANDSHAKE_PROTOCOL,
      nonce,
      proof: createDaemonServerProof(this.authSecret, { ...helloFields, nonce }),
    };
    try {
      socket.write(JSON.stringify(hello) + '\n');
    } catch {
      releasePendingSocket();
      socket.destroy();
      return;
    }

    // Require mutual proof before creating any MCP session. The pipe name and
    // public instance id are locators; only the protected lock carries the key.
    void (async () => {
      const peers = await readClientHello(socket, {
        instanceId: this.instanceId,
        authSecret: this.authSecret,
        serverNonce: nonce,
      });
      if (!peers || this.stopping || socket.destroyed) throw new Error('client authentication failed');
      if (controlCandidate) {
        const firstMessage = await readFirstAuthenticatedMessage(socket);
        if (!firstMessage || this.stopping || socket.destroyed) throw new Error('missing first client message');
        if (this.handleAuthenticatedControl(socket, firstMessage)) {
          releasePendingSocket();
          return;
        }
        if (connectionLimitReached) {
          throw new Error('reserved control connection received ordinary traffic');
        }
        // Request saturation, unlike the connection cap, is transient. The
        // first-message probe must not consume ordinary authenticated traffic
        // when that peer is promoted to the normal queued transport path.
        try { socket.unshift(firstMessage); }
        catch { throw new Error('failed to restore ordinary client input'); }
      }
      releasePendingSocket();
      const transport = new SocketTransport(socket, 'cg-sock', undefined, {
        maxInputLineBytes: MAX_DAEMON_REQUEST_LINE_BYTES,
        maxRetainedInputBytes: MAX_DAEMON_CLIENT_RETAINED_REQUEST_BYTES,
        requestBudget: this.requestBudget,
        outputBudget: this.outputBudget,
        // Capacity can saturate after accept/authentication. Inspect the first
        // application message before ordinary aggregate accounting so a fresh
        // authenticated shutdown connection still reaches lifecycle control.
        firstMessageProbeBytes: CONTROL_REQUEST_LINE_BYTES,
        handleFirstMessage: (buffered) => this.handleAuthenticatedControl(socket, buffered),
      });
      const session = new MCPSession(transport, this.engine, {
        explicitProjectPath: this.projectRoot,
        shutdown: {
          reserve: () => this.scheduleAuthenticatedShutdown(),
          begin: () => this.beginAuthenticatedShutdown(),
        },
      });
      transport.onClose(() => this.dropClient(session));
      this.clients.add(session);
      this.clientPeers.set(session, peers);
      this.disarmIdleTimer();
      session.start();
      // Observe inbound bytes purely to feed the inactivity backstop — a second
      // 'data' listener that reads nothing, added AFTER the transport's so the
      // unshifted client-hello tail reaches the transport intact.
      socket.on('data', () => { this.lastActivityAt = Date.now(); });
    })().catch(() => {
      releasePendingSocket();
      try { socket.destroy(); } catch { /* best-effort */ }
    });
  }

  private handleAuthenticatedControl(socket: net.Socket, buffered: Buffer): boolean {
    const newline = buffered.indexOf(0x0a);
    if (newline < 0 || newline > CONTROL_REQUEST_LINE_BYTES) return false;
    let message: Record<string, unknown>;
    try { message = JSON.parse(buffered.subarray(0, newline).toString('utf8')) as Record<string, unknown>; }
    catch { return false; }
    if (message.jsonrpc !== '2.0' || message.method !== 'codegraph/shutdown') return false;
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    const id = message.id === null || typeof message.id === 'string' || typeof message.id === 'number'
      ? message.id
      : null;
    // Authentication already established the authority to stop this exact
    // daemon. Only an absent JSON-RPC id denotes a notification; an explicit
    // null id still receives a response. Neither form controls the sensitive
    // shutdown action.
    const accepted = this.scheduleAuthenticatedShutdown();
    const response = !hasId
      ? null
      : accepted
        ? { jsonrpc: '2.0', id, result: { stopping: true } }
        : {
          jsonrpc: '2.0',
          id,
          error: {
            code: ErrorCodes.InvalidParams,
            message: 'daemon is already stopping',
          },
        };
    let finished = false;
    const finishAcceptedShutdown = accepted
      ? (): void => {
        if (finished) return;
        finished = true;
        this.beginAuthenticatedShutdown();
      }
      : undefined;
    this.trackControlSocket(socket, finishAcceptedShutdown);
    try {
      const onFlushed = (): void => {
        finishAcceptedShutdown?.();
        try { socket.destroy(); } catch { /* already closed */ }
      };
      if (response === null) socket.end(onFlushed);
      else socket.end(`${JSON.stringify(response)}\n`, onFlushed);
    } catch {
      finishAcceptedShutdown?.();
      socket.destroy();
    }
    return true;
  }

  private trackControlSocket(socket: net.Socket, onFinished?: () => void): void {
    const cleanup = (): void => {
      const timer = this.controlSockets.get(socket);
      if (timer) clearTimeout(timer);
      this.controlSockets.delete(socket);
      socket.removeListener('error', onError);
      onFinished?.();
    };
    const onError = (): void => {
      try { socket.destroy(); } catch { cleanup(); }
    };
    socket.once('close', cleanup);
    socket.once('error', onError);
    const timer = setTimeout(() => {
      onFinished?.();
      try { socket.destroy(); } catch { cleanup(); }
    }, CONTROL_RESPONSE_DRAIN_TIMEOUT_MS);
    timer.unref?.();
    this.controlSockets.set(socket, timer);
  }

  private scheduleAuthenticatedShutdown(): boolean {
    if (
      this.stopping ||
      this.authenticatedShutdownScheduled ||
      this.authenticatedShutdownStarted
    ) return false;
    this.authenticatedShutdownScheduled = true;
    return true;
  }

  private beginAuthenticatedShutdown(): void {
    if (
      !this.authenticatedShutdownScheduled ||
      this.authenticatedShutdownStarted ||
      this.stopping
    ) return;
    this.authenticatedShutdownStarted = true;
    void this.stop('authenticated control request');
  }

  private closePendingClientSockets(): void {
    for (const socket of this.pendingClientSockets) {
      try { socket.destroy(); } catch { /* best-effort */ }
    }
    this.pendingClientSockets.clear();
    if (this.pendingControlSocket) {
      try { this.pendingControlSocket.destroy(); } catch { /* best-effort */ }
      this.pendingControlSocket = null;
    }
    for (const [socket, timer] of [...this.controlSockets]) {
      clearTimeout(timer);
      this.controlSockets.delete(socket);
      try { socket.destroy(); } catch { /* best-effort */ }
    }
  }

  private dropClient(session: MCPSession): void {
    if (!this.clients.delete(session)) return;
    this.clientPeers.delete(session);
    if (this.clients.size === 0) this.armIdleTimer();
  }

  private armIdleTimer(): void {
    if (this.idleTimer || this.stopping) return;
    if (this.idleTimeoutMs <= 0) return; // 0 = never idle-exit
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      // Last-second sanity check: if a connection landed between the timer
      // firing and now, don't exit. (setImmediate-ordering is the only way
      // this races; cheap to defend against.)
      if (
        this.clients.size > 0
        || this.pendingClientSockets.size > 0
        || this.pendingControlSocket
        || this.controlSockets.size > 0
      ) {
        this.armIdleTimer();
        return;
      }
      void this.stop('idle timeout');
    }, this.idleTimeoutMs);
    // Don't keep the event loop alive just for this — the net.Server keeps the
    // loop alive while listening, so the timer still fires; once we stop() the
    // loop should drain naturally.
    this.idleTimer.unref?.();
  }

  private disarmIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /**
   * Defense-in-depth against a daemon that outlives its clients (#692), for the
   * cases the refcount + idle timer miss because a socket close never arrives:
   *   - **Inactivity backstop:** after `maxIdleMs` with no inbound traffic, reap
   *     the daemon — but ONLY if no connected client can be proven alive (see
   *     {@link backstopShouldExit}). This is the sole phantom class the sweep
   *     below can't catch: a client whose client-hello never arrived, so we have
   *     no pid to check.
   *   - **Liveness sweep:** drop any client whose peer process has died (per the
   *     client-hello pids), which re-arms the idle timer once the last real
   *     client is gone. Catches a dead peer within one sweep instead of waiting
   *     out the whole backstop.
   * Both timers are unref'd — the listening server keeps the loop alive, and
   * neither should hold it open on its own.
   */
  private startLivenessTimers(): void {
    if (this.maxIdleMs > 0) {
      const tick = Math.min(this.maxIdleMs, 60_000);
      this.maxIdleTimer = setInterval(() => {
        if (this.backstopShouldExit(isProcessAlive)) void this.stop('inactivity backstop');
      }, tick);
      this.maxIdleTimer.unref?.();
    }
    const sweepMs = resolveClientSweepMs();
    if (sweepMs > 0) {
      this.clientSweepTimer = setInterval(() => this.reapDeadClients(isProcessAlive), sweepMs);
      this.clientSweepTimer.unref?.();
    }
  }

  /**
   * Decide whether the inactivity backstop should reap the daemon right now.
   * Public + `isAlive`-injected for deterministic tests; the timer calls it each
   * tick with the real liveness probe.
   *
   * The backstop exists ONLY to catch a **phantom** client (#692) — one counted
   * but actually gone, whose socket-close was never delivered. It must never
   * reap a **live-but-quiet** session (connected, alive peer, just not querying):
   * doing so silently severed the shared daemon and degraded that session — and
   * any others sharing it — to an in-process engine. `lastActivityAt` only tracks
   * inbound query bytes, and MCP has no keepalive, so a genuinely-live session
   * trips the raw inactivity window after ~30 min of not being queried.
   *
   * So: once the inactivity window elapses, drop provably-dead peers (the same
   * check the periodic sweep runs), then reap the daemon only when NOT ONE
   * remaining client can be proven alive — i.e. every client left is an
   * unknown-pid connection the sweep can't verify. A single provably-alive
   * client keeps the daemon up. Has the sweep's side effect (drops dead peers).
   */
  backstopShouldExit(isAlive: (pid: number) => boolean): boolean {
    if (this.stopping || this.clients.size === 0) return false; // idle timer owns the no-client case
    if (Date.now() - this.lastActivityAt < this.maxIdleMs) return false; // still within the window
    this.reapDeadClients(isAlive);
    if (this.clients.size === 0) return false; // sweep cleared them — idle timer takes over
    const anyProvablyAlive = [...this.clients].some((session) => {
      const peers = this.clientPeers.get(session);
      return peers != null && peers.pid !== null && !peerIsDead(peers, isAlive);
    });
    return !anyProvablyAlive;
  }

  /**
   * Drop every connected client whose peer process is gone. Returns the count
   * reaped. `isAlive` is injected for testing. Clients with unknown pids (no
   * client-hello) are skipped — they rely on the socket-close path.
   */
  reapDeadClients(isAlive: (pid: number) => boolean): number {
    if (this.clients.size === 0) return 0;
    let reaped = 0;
    for (const session of [...this.clients]) {
      const peers = this.clientPeers.get(session);
      if (!peers || !peerIsDead(peers, isAlive)) continue;
      process.stderr.write(
        `[CodeGraph daemon] Reaping client with dead peer (pid ${peers.pid}); clients=${this.clients.size - 1}.\n`
      );
      try { session.stop(); } catch { /* best-effort */ }
      this.dropClient(session);
      reaped++;
    }
    return reaped;
  }

  private cleanupLockfile(): void {
    try {
      if (!daemonLockDirectoryIsTrusted(this.projectRoot)) return;
      if (fs.existsSync(this.pidPath)) {
        // Only remove if it still belongs to us — another daemon may have
        // already taken over while we were shutting down (extremely rare).
        const read = readDaemonLockFile(this.pidPath);
        const info = read.state === 'ok' ? read.info : null;
        if (
          info &&
          info.pid === process.pid &&
          info.instanceId === this.instanceId &&
          info.authSecret === this.authSecret
        ) {
          clearStaleDaemonLock(this.pidPath, {
            pid: info.pid,
            processBirthId: info.processBirthId,
          }, true);
        }
      }
    } catch { /* best-effort; we're exiting anyway */ }
  }
}

/**
 * Result of `tryAcquireDaemonLock`. Either we got the lock (caller becomes
 * the daemon), or it already existed (caller should connect to the existing
 * daemon as a proxy, or — if the holder is dead — clear it and retry).
 */
export type AcquireResult =
  | { kind: 'acquired'; pidPath: string; info: DaemonLockInfo }
  | { kind: 'taken'; existing: DaemonLockInfo | null; pidPath: string };

/**
 * Acquire the daemon lock. The normal hard-link path publishes its full record
 * atomically; the no-hard-link fallback publishes the same complete record
 * inside an exclusively created directory. Returns either an `acquired` result
 * (the caller is the daemon-elect and may construct a {@link Daemon}) or a
 * `taken` result.
 *
 * must-fix 1 (issue #411 review): the lockfile must appear in ONE atomic step,
 * already complete — never empty, even momentarily. The first attempt at this
 * (`O_EXCL` create then a separate `writeSync`) left a microsecond window where
 * the file existed but was empty; under concurrent daemon startup a third
 * candidate could read that empty file, decode it as `null`, and `unlink` the
 * winner's lock → two daemons (two watchers, two writers). The window was
 * normally too small to hit, but the file watcher's extra startup time made
 * concurrent daemons overlap enough to reproduce it reliably.
 *
 * The fix writes the complete record to a private temp file, then hard-links it
 * into place: `link()` is atomic AND exclusive (EEXIST if the target exists), so
 * the pidfile becomes visible in one step already containing a full record.
 * Whoever links first wins; everyone else gets EEXIST and reads a complete file.
 * There is no empty-file window at all.
 *
 * Filesystems without hard links (#997): ExFAT/FAT external volumes and some
 * network mounts can't `link()` at all. There we claim the canonical path with
 * an exclusive owner-only directory and atomically move the complete temp record
 * inside it. A crash can leave only an empty directory, which a later SQLite
 * election-lease holder can remove safely; legacy file publishers cannot replace
 * that directory or create a second daemon.
 */
export function tryAcquireDaemonLock(
  projectRoot: string,
  leaseProvesStale = false,
): AcquireResult {
  ensureDaemonLockDirectory(projectRoot);
  const pidPath = getDaemonPidPath(projectRoot);
  // Make sure the .codegraph/ directory exists — the daemon may be the first
  // thing to touch it on a fresh-clone-but-already-initialized checkout.
  fs.mkdirSync(path.dirname(pidPath), { recursive: true });
  if (!recoverDaemonLockDirectory(pidPath, leaseProvesStale)) {
    return { kind: 'taken', existing: null, pidPath };
  }
  if (!recoverDaemonLockQuarantines(pidPath, leaseProvesStale)) {
    return { kind: 'taken', existing: null, pidPath };
  }

  const instanceId = randomUUID();
  const info: DaemonLockInfo = {
    pid: process.pid,
    processBirthId: getProcessBirthId(process.pid) ?? undefined,
    electionProtocol: 1,
    version: CodeGraphPackageVersion,
    socketPath: getDaemonSocketPath(projectRoot, instanceId),
    startedAt: Date.now(),
    instanceId,
    authSecret: createDaemonAuthSecret(),
  };

  // Temp name is pid-scoped so racing candidates never collide on it.
  const tmp = `${pidPath}.${process.pid}.${randomUUID()}.tmp`;
  let acquired = false;
  try {
    fs.writeFileSync(tmp, encodeLockInfo(info), { mode: 0o600, flag: 'wx' });
    try {
      fs.linkSync(tmp, pidPath); // atomic + exclusive (race-free; see must-fix 1)
      acquired = true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        // Lost the race — another candidate already holds it. Fall through to read.
      } else {
        // link() failed for a non-conflict reason — nearly always "this filesystem
        // has no hard links" (ExFAT/FAT external volumes, some network mounts),
        // which surfaces as a DIFFERENT errno on every OS: ENOTSUP on macOS, EPERM
        // on Linux, EISDIR on Windows (#997). Enumerating them is whack-a-mole and
        // unnecessary: the `tmp` write above already proved this directory is
        // writable, so an exclusive canonical directory is a safe substitute. If
        // that fails too, the genuine error propagates. EEXIST means taken.
        acquired = acquireLockViaDirectoryFallback(pidPath, tmp);
      }
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* temp already gone */ }
  }

  if (acquired) return { kind: 'acquired', pidPath, info };

  // Taken. The regular-file hard-link path always exposes a complete record.
  // Directory fallback publication is also atomic; waitForCompleteDaemonLock
  // remains for legacy regular-file fallback generations already on disk.
  let existing: DaemonLockInfo | null = null;
  const read = readDaemonLockFile(pidPath);
  if (read.state === 'ok') existing = read.info;
  return { kind: 'taken', existing, pidPath };
}

/**
 * Claim the canonical pid path as an owner-only directory, then atomically move
 * the already-complete temporary record inside it. This hard-link-free fallback
 * avoids exposing a partial regular file and makes failed publication
 * recoverable without any pathname compare-delete race. Returns false when
 * another regular-file or directory generation already owns the canonical path.
 * Exported for testing.
 */
export function acquireLockViaDirectoryFallback(
  pidPath: string,
  completedRecordPath: string,
): boolean {
  try {
    fs.mkdirSync(pidPath, { mode: 0o700 });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
  fs.renameSync(completedRecordPath, path.join(pidPath, DAEMON_LOCK_RECORD_NAME));
  return true;
}

/**
 * Give a legacy exclusive-open lock winner a bounded opportunity to finish
 * writing its record. Current hard-link-free publishers use the atomic directory
 * representation, but older installed versions may have left this regular-file
 * generation on disk.
 */
export async function waitForCompleteDaemonLock(
  pidPath: string,
  timeoutMs = 250,
  pollMs = 10,
): Promise<DaemonLockInfo | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    const read = readDaemonLockFile(pidPath);
    if (read.state === 'ok') return read.info;
    if (read.state === 'missing') return null;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
  }
}

/**
 * The one `listen()` error we must NOT relocate past. EADDRINUSE means the path
 * is genuinely occupied — a racing daemon that legitimately owns it, or a
 * leftover node we couldn't clear (the #974 planted-dir case) — so relocating
 * would abandon a path another daemon owns; the caller instead releases its lock
 * and falls back to direct mode. EVERY OTHER bind error just means "this path
 * didn't work," almost always a filesystem that can't host an AF_UNIX node at all
 * (ExFAT/FAT, network mounts, WSL2 DrvFs), which reports a DIFFERENT errno per OS
 * (ENOTSUP macOS, EPERM Linux; #997). Enumerating the "unsupported" codes is
 * whack-a-mole, so we relocate on anything-but-conflict instead — robust and
 * self-correcting: if the deterministic tmpdir fallback ALSO fails, that error
 * propagates from the last candidate. (ENAMETOOLONG never reaches here — the
 * candidate list already routes over-long paths straight to tmpdir.)
 */
const SOCKET_BIND_CONFLICT_CODE = 'EADDRINUSE';

/**
 * Bind the first usable socket from an ordered candidate list, relocating past
 * any path that fails to bind for a non-conflict reason (see {@link
 * SOCKET_BIND_CONFLICT_CODE}). The injected `listen` does the real
 * `net.Server.listen` (and stale-socket clear); abstracted so the relocation
 * policy is unit-testable without a real unsupported filesystem. Returns the
 * server plus the path actually bound. An EADDRINUSE, or any error on the LAST
 * candidate, propagates — the caller releases the lockfile and falls back to
 * direct mode (#974). Exported for testing.
 */
export async function bindFirstUsableSocket(
  candidates: string[],
  listen: (socketPath: string) => Promise<net.Server>,
  opts: { onRelocate?: (from: string, to: string, code: string) => void } = {},
): Promise<{ server: net.Server; socketPath: string }> {
  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const socketPath = candidates[i]!; // i < length, so always defined
    const isLast = i === candidates.length - 1;
    try {
      const server = await listen(socketPath);
      return { server, socketPath };
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (!isLast && code !== SOCKET_BIND_CONFLICT_CODE) {
        opts.onRelocate?.(socketPath, candidates[i + 1]!, code ?? ''); // !isLast ⇒ i+1 in range
        continue;
      }
      throw err;
    }
  }
  // Only reachable with an empty candidate list — a programmer error.
  throw lastErr ?? new Error('no socket candidates to bind');
}

function resolveIdleTimeoutMs(): number {
  const raw = process.env.CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_IDLE_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_IDLE_TIMEOUT_MS;
  return Math.floor(parsed);
}

function resolveMaxIdleMs(): number {
  const raw = process.env.CODEGRAPH_DAEMON_MAX_IDLE_MS;
  if (raw === undefined || raw === '') return DEFAULT_MAX_IDLE_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_IDLE_MS;
  return Math.floor(parsed); // 0 disables the backstop
}

function resolveClientSweepMs(): number {
  const raw = process.env.CODEGRAPH_DAEMON_CLIENT_SWEEP_MS;
  if (raw === undefined || raw === '') return DEFAULT_CLIENT_SWEEP_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CLIENT_SWEEP_MS;
  return Math.floor(parsed); // 0 disables the sweep
}

/**
 * Parse and authenticate one client-hello line. No JSON-RPC session is created
 * until the client proves possession of the lockfile-only secret.
 */
export function parseClientHelloLine(
  line: string,
  expected: { instanceId: string; authSecret: string; serverNonce: string },
): { pid: number | null; hostPid: number | null } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o.codegraph_client !== 1 || typeof o.pid !== 'number') return null;
  const validPid = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 1;
  if (!validPid(o.pid)) return null;
  if (o.hostPid !== null && o.hostPid !== undefined && !validPid(o.hostPid)) return null;
  if (o.instanceId !== expected.instanceId || !isValidDaemonAuthNonce(o.nonce)) return null;
  if (!isValidDaemonAuthProof(o.proof)) return null;
  const hostPid = validPid(o.hostPid) ? o.hostPid : null;
  const proof = createDaemonClientProof(expected.authSecret, {
    pid: o.pid,
    hostPid,
    instanceId: expected.instanceId,
    serverNonce: expected.serverNonce,
    nonce: o.nonce,
  });
  if (!daemonProofMatches(o.proof, proof)) return null;
  return { pid: o.pid, hostPid };
}

/**
 * A client's peer is dead when its proxy process is gone, or when its known
 * host process is gone. Unknown pid (no client-hello) is never "dead" on this
 * basis — those clients rely on the socket-close path. Exported for testing.
 */
export function peerIsDead(
  peers: { pid: number | null; hostPid: number | null },
  isAlive: (pid: number) => boolean,
): boolean {
  if (peers.pid === null) return false;
  if (!isAlive(peers.pid)) return true;
  if (peers.hostPid !== null && !isAlive(peers.hostPid)) return true;
  return false;
}

/**
 * Read the required authenticated client-hello line a proxy sends after the
 * daemon hello. Always resolves rather than rejecting because every accepted
 * socket funnels through here, but null means the caller must destroy it.
 */
function readClientHello(
  socket: net.Socket,
  expected: { instanceId: string; authSecret: string; serverNonce: string },
): Promise<{ pid: number | null; hostPid: number | null } | null> {
  return new Promise((resolve) => {
    let chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (
      peers: { pid: number | null; hostPid: number | null } | null,
      putBack?: Buffer,
    ) => {
      if (settled) return;
      settled = true;
      // PAUSE before detaching: removing the last 'data' listener does NOT
      // stop a flowing stream, so bytes arriving (or unshifted) in the gap
      // between this handler and the session transport attaching were emitted
      // to zero listeners and silently DISCARDED — and the listener swap left
      // the socket's flow state wedged, never delivering to the new listener.
      // A proxy whose client-hello arrived glued to the initialize hit this
      // ~1-in-5 under load: the daemon answered nothing for the whole session
      // (the #662 test flake, and real dead sessions behind it). Paused, the
      // unshifted tail and any new bytes buffer; SocketTransport.start()
      // resumes explicitly.
      try { socket.pause(); } catch { /* stream already gone */ }
      socket.removeListener('data', onData);
      socket.removeListener('error', onEnd);
      socket.removeListener('close', onEnd);
      clearTimeout(timer);
      if (process.env.CODEGRAPH_MCP_DEBUG) {
        process.stderr.write(`[mcp-debug] clientHello finish pid=${String(peers?.pid ?? null)} putBack=${putBack ? putBack.length : 0} flowing=${String(socket.readableFlowing)}\n`);
      }
      if (putBack && putBack.length > 0 && !socket.destroyed) {
        try { socket.unshift(putBack); } catch { /* stream already gone */ }
      }
      resolve(peers);
    };
    const onData = (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      chunks.push(buf);
      total += buf.length;
      const all = chunks.length === 1 ? buf : Buffer.concat(chunks, total);
      const nl = all.indexOf(0x0a); // '\n'
      if (nl === -1) {
        if (total > MAX_HELLO_LINE_BYTES) finish(null);
        else chunks = [all];
        return;
      }
      if (nl > MAX_HELLO_LINE_BYTES) {
        finish(null);
        return;
      }
      const peers = parseClientHelloLine(all.subarray(0, nl).toString('utf8'), expected);
      if (peers) {
        const tail = all.subarray(nl + 1);
        finish(peers, tail.length > 0 ? tail : undefined);
      } else {
        finish(null);
      }
    };
    const onEnd = () => finish(null);
    const timer = setTimeout(() => finish(null), CLIENT_HELLO_TIMEOUT_MS);
    timer.unref?.();
    socket.on('data', onData);
    socket.on('error', onEnd);
    socket.on('close', onEnd);
  });
}

/**
 * Read only enough authenticated application input to identify the dedicated
 * shutdown request. Ordinary input is returned byte-for-byte for SocketTransport.
 */
function readFirstAuthenticatedMessage(socket: net.Socket): Promise<Buffer | null> {
  if (socket.destroyed) return Promise.resolve(null);
  return new Promise((resolve) => {
    let buffered: Buffer = Buffer.alloc(0);
    let settled = false;
    const finish = (result: Buffer | null): void => {
      if (settled) return;
      settled = true;
      try { socket.pause(); } catch { /* stream already gone */ }
      socket.removeListener('data', onData);
      socket.removeListener('error', onEnd);
      socket.removeListener('close', onEnd);
      clearTimeout(timer);
      resolve(result);
    };
    const onData = (chunk: Buffer | string): void => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      buffered = buffered.length === 0 ? bytes : Buffer.concat([buffered, bytes]);
      if (buffered.length > MAX_DAEMON_CLIENT_RETAINED_REQUEST_BYTES) {
        finish(null);
        return;
      }
      const newline = buffered.indexOf(0x0a);
      if (newline > MAX_DAEMON_REQUEST_LINE_BYTES) {
        finish(null);
        return;
      }
      if (newline >= 0 || buffered.length > CONTROL_REQUEST_LINE_BYTES) finish(buffered);
    };
    const onEnd = (): void => finish(null);
    const timer = setTimeout(() => finish(null), CLIENT_FIRST_MESSAGE_TIMEOUT_MS);
    timer.unref?.();
    socket.on('data', onData);
    socket.on('error', onEnd);
    socket.on('close', onEnd);
    try { socket.resume(); } catch { finish(null); }
  });
}

/** Exported for test stubs that need to bound the hello-line read. */
export { MAX_HELLO_LINE_BYTES };
