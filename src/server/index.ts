/**
 * SPEC-005 local HTTP server bootstrap (FR-001/FR-012/FR-026).
 *
 * Stands up the `node:http` server: bind + port handling (`--port`/`--host`/
 * `--port 0`, `EADDRINUSE`), the `'request'` and reserved `'upgrade'`
 * (SPEC-009) attach points, ordered shutdown with a bounded grace period, and
 * daemon-client tracking. Dormant unless `codegraph serve --web` is invoked
 * (FR-001) — `startWebServer` is library-callable so tests and the CLI share
 * one bind/serve/stop path.
 *
 * @module server/index
 *
 * Read routes (`buildReadRoutes`) and re-index job routes (`buildJobRoutes`) are
 * both registered, the static mount is active, and SPEC-009 owns the bounded
 * `/lsp` WebSocket upgrade lifecycle through server shutdown.
 */

import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import {
  handleApiRequest,
  buildReadRoutes,
  buildJobRoutes,
  type RouteContext,
  type HandlerResult,
  type ReadApiDeps,
  type RepoInfo,
} from './routes';
import { buildChatRoutes } from './chat';
import { internalError, apiError } from './errors';
import { resolveBindSecurity, isAllowedHostHeader } from './auth';
import { serveStatic } from './static';
import { attachDaemonClient, repoIdForRoot, type DaemonReadClient } from './daemon-client';
import { JobRegistry, defaultRearmWatcher, type JobDeps } from './jobs';
import { attachLspWebSocket } from './lsp-websocket';
import { CodeGraphPackageVersion } from '../mcp/version';
import { listDaemons } from '../mcp/daemon-registry';
import { findNearestCodeGraphRoot } from '../directory';
import { isLoopbackHost } from '../utils';

/** Options for starting the web server. */
export interface WebServerOptions {
  /** Bind host; defaults to `127.0.0.1` (FR-012). */
  host?: string;
  /** Bind port; defaults to `11235`. `0` = OS-assigned ephemeral (FR-026). */
  port?: number;
  /** The startup (default) project root; defaults to cwd. */
  projectPath?: string;
  /** `CODEGRAPH_SERVER_TOKEN`, or null when unset (FR-013/FR-014). */
  token?: string | null;
  /**
   * Static web-root the mount serves from (FR-017). Defaults to the shipped
   * `dist/web/` (absent for all of SPEC-005's life). Injectable so tests can
   * point it at a synthetic build.
   */
  webRoot?: string;
  /**
   * Spawn seam for the read-forwarding daemon attach (passed to
   * {@link attachDaemonClient}). Production default spawns the bundled CLI; tests
   * inject a `dist/bin/codegraph.js` spawn (a runner's `argv[1]` is the runner).
   */
  spawnDaemon?: (root: string) => void;
  /**
   * Optional LOCAL request-log sink (FR-014a). When set, the dispatch seam emits
   * a single redacted line per request — method + path + status ONLY, never the
   * headers object, the `Authorization` header, or the token in any form. Left
   * unset (silent) by default; injectable so tests can assert the no-leak
   * property. The sink MUST stay local (no external egress, Constitution VII).
   */
  logger?: (message: string) => void;
  /**
   * LOCAL server-side diagnostic sink (F1). Distinct from `logger` (the FR-014a
   * request line): this receives the CAUGHT EXCEPTION (message + stack) at a
   * contained-fault site — a handler throw, a re-index job failure, or a daemon
   * attach failure — whose wire response is the generic `internal`/`unavailable`
   * envelope (FR-015a) that hides the cause from the operator. It NEVER receives
   * request headers, so it can never carry a token/Authorization (FR-014a).
   * Silent by default in library/embedded use; `runWebServerCli` wires it to
   * `console.error` so a CLI operator sees faults on stderr. Tests inject a
   * capturing sink to assert the cause is logged AND the token never leaks.
   */
  diagnostics?: (message: string) => void;
  /**
   * SPEC-005 Slice-2 test seam (FR-020..FR-023): override the reindex job
   * subsystem's injectable dependencies (index runner, lock probe, watcher
   * re-arm sender, retry-window timing). Production leaves this unset — the real
   * defaults open a `CodeGraph`, probe the on-disk lock, and send the re-arm
   * control message over the daemon socket. Mirrors the `spawnDaemon` seam.
   */
  jobDeps?: Partial<JobDeps>;
}

/** A running web server: the actually-bound address and a clean shutdown. */
export interface WebServerHandle {
  host: string;
  /** The actually-bound port (resolved when `--port 0` was requested). */
  port: number;
  /**
   * Register a daemon client attached while serving a read so ordered shutdown
   * closes it — decrementing the daemon's client refcount, never killing a
   * shared daemon (FR-026). Read handlers call this on lazy attach.
   */
  trackDaemonClient(client: DaemonReadClient): void;
  /** Ordered shutdown: stop accepting, close daemon clients, release the port (FR-026). */
  close(deadlineAt?: number): Promise<void>;
}

/**
 * A web-server bind failure (e.g. `EADDRINUSE`). Carries the offending port so
 * the CLI can print a clear message and exit non-zero (FR-026).
 */
export class WebServerError extends Error {
  readonly code?: string;
  readonly port?: number;
  constructor(message: string, opts: { code?: string; port?: number } = {}) {
    super(message);
    this.name = 'WebServerError';
    this.code = opts.code;
    this.port = opts.port;
  }
}

/** Default bind (FR-012): loopback, IANA User-range port clear of the dev cluster. */
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 11235;

/**
 * Shipped static web-root — `dist/web/` relative to this compiled module
 * (`dist/server/index.js`). Absent for all of SPEC-005's life; the mount returns
 * the placeholder until SPEC-006 ships assets.
 */
const DEFAULT_WEB_ROOT = path.join(__dirname, '..', 'web');

/** Bounded grace before shutdown force-releases the port (FR-026, ~5s). */
const SHUTDOWN_GRACE_MS = 5_000;

/** Realpath a root (matching the daemon socket key); fall back to `resolve`. */
function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Map a `listen` error to a clear, actionable {@link WebServerError} (FR-026). */
function mapListenError(err: NodeJS.ErrnoException, host: string, port: number): Error {
  if (err.code === 'EADDRINUSE') {
    return new WebServerError(
      `Cannot start the CodeGraph web server: port ${port} on ${host} is already in use. ` +
        `Choose a free port with --port <n>, or --port 0 for an OS-assigned one.`,
      { code: 'EADDRINUSE', port },
    );
  }
  if (err.code === 'EACCES') {
    return new WebServerError(
      `Cannot start the CodeGraph web server: permission denied binding port ${port} on ${host}. ` +
        `Choose a port ≥ 1024 with --port <n>, or --port 0 for an OS-assigned one.`,
      { code: 'EACCES', port },
    );
  }
  return err;
}

/**
 * Bind and start the local HTTP server (FR-001/FR-026). Resolves once the port
 * is bound; rejects (with no half-open listener) on a bind failure.
 */
/**
 * Decode every percent-escape run we CAN, leaving a malformed run (e.g. `%ZZ`, a
 * truncated `%A`) literal. Unlike `decodeURIComponent`, never throws — so one bad
 * escape can't abort a token-redaction scan and let an encoded token through
 * (FR-014a).
 */
function tolerantDecode(s: string): string {
  return s.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * Whether `s` contains `token` at ANY decoding level — verbatim, or after up to a
 * few bounded rounds of percent-decoding (tolerant of a malformed escape). Empty
 * `token` → never (redaction is a no-op when no token is configured). Used to keep
 * the configured token out of the request log in any reversible form (FR-014a).
 */
function containsToken(s: string, token: string | null | undefined): boolean {
  if (!token) return false;
  let probe = s;
  for (let i = 0; i < 6; i++) {
    if (probe.includes(token)) return true;
    let next: string;
    try {
      next = decodeURIComponent(probe);
    } catch {
      next = tolerantDecode(probe); // one bad escape must not stop the scan
    }
    if (next === probe) break; // fully decoded / stable
    probe = next;
  }
  return false;
}

export async function startWebServer(options: WebServerOptions = {}): Promise<WebServerHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  const webRoot = options.webRoot ?? DEFAULT_WEB_ROOT;

  // SPEC-006 serves a packaged browser UI whose fetch/EventSource calls cannot
  // carry a Bearer session token yet, so refuse every non-loopback bind before
  // token resolution. This keeps startup guidance actionable: bind loopback for
  // the browser UI until a browser-compatible API/SSE session mechanism exists.
  if (!isLoopbackHost(host)) {
    throw new WebServerError(
      `Refusing to start the packaged CodeGraph web UI on non-loopback host ${host}: ` +
        `the browser UI is loopback-only until a browser-compatible API/SSE session mechanism exists. ` +
        `Bind 127.0.0.1 for the UI.`,
    );
  }

  // FR-012/FR-013 fail-closed bind gate — resolved BEFORE any `listen`. On
  // loopback `requireToken` is false (Bearer no-op, SC-002).
  const security = resolveBindSecurity(host, options.token ?? null);

  // Daemon clients attached while serving reads (lazily, FR-010) — closed on
  // shutdown to decrement each daemon's refcount, never killed (FR-026).
  const daemonClients = new Set<DaemonReadClient>();
  const pendingClientAttaches = new Set<Promise<DaemonReadClient>>();
  const serverLifetime = new AbortController();
  // Live connections, tracked so shutdown can release the port promptly instead
  // of waiting out idle keep-alive sockets.
  const connections = new Set<net.Socket>();
  // Shutdown sentinel, set synchronously by close(). Declared before getClient so
  // a daemon attach still in flight when shutdown begins (its `.then` below) can
  // see the server is closing and drop the late client instead of leaking it past
  // the drain that already emptied `daemonClients`.
  let closing: Promise<void> | null = null;

  // Read-forwarding wiring (FR-002/010): the startup (default) repo, a per-repo
  // daemon-client pool (attach lazily on first access, reuse for the server's
  // lifetime, close on shutdown), and the `?repo` resolver. Ids hash the same
  // canonical root the daemon registry keys on, so an API id equals a registry
  // key by construction.
  // Canonicalize the startup repo to the nearest indexed root so the API repo id
  // equals the daemon registry's key (a start from a nested dir under an indexed
  // root must resolve to that ancestor). No index above the start → keep the raw
  // path (the un-indexed-startup case, FR-005).
  const startupPath = safeRealpath(options.projectPath ?? process.cwd());
  const nearestIndexed = findNearestCodeGraphRoot(startupPath);
  const startupRoot = nearestIndexed ? safeRealpath(nearestIndexed) : startupPath;
  const defaultRepo: RepoInfo = {
    id: repoIdForRoot(startupRoot),
    root: startupRoot,
    name: path.basename(startupRoot),
  };
  const clientPool = new Map<string, Promise<DaemonReadClient>>();
  const getClient = (repo: RepoInfo): Promise<DaemonReadClient> => {
    const cached = clientPool.get(repo.id);
    if (cached) return cached;
    const attach = attachDaemonClient(
      repo.root,
      {
        ...(options.spawnDaemon ? { spawnDaemon: options.spawnDaemon } : {}),
        signal: serverLifetime.signal,
      },
    ).then((client) => {
      // Shutdown may have drained daemonClients while this attach was resolving —
      // close the late client rather than leaking it back into a closed server.
      if (closing) { try { client.close(); } catch { /* best-effort */ } return client; }
      daemonClients.add(client);
      return client;
    });
    // A failed attach must not pin a rejected promise in the pool — evict so a
    // later request retries (the daemon may bind on a subsequent call, FR-015a).
    attach.catch(() => clientPool.delete(repo.id));
    void attach.then(
      () => pendingClientAttaches.delete(attach),
      () => pendingClientAttaches.delete(attach),
    );
    pendingClientAttaches.add(attach);
    clientPool.set(repo.id, attach);
    return attach;
  };
  const resolveRepo = (repoId: string | undefined): RepoInfo | null => {
    if (repoId === undefined || repoId === '') return defaultRepo;
    if (!/^[0-9a-f]{16}$/.test(repoId)) return null; // malformed → 404 repo (FR-011)
    if (repoId === defaultRepo.id) return defaultRepo;
    for (const rec of listDaemons({ prune: true })) {
      if (repoIdForRoot(rec.root) === repoId) {
        return { id: repoId, root: rec.root, name: path.basename(rec.root) };
      }
    }
    return null; // unregistered → 404 repo
  };
  // Drop a repo's pooled client after a mid-session socket death (the daemon
  // exited/restarted). getClient only evicts on a FAILED attach; a client that
  // dies AFTER a successful attach stays cached and every later read reuses the
  // dead socket. withClient (and statusHandler) call this on a read failure so the
  // next request re-attaches (FR-002/015a). Identity-scoped: only evict if the pool
  // STILL resolves to THIS dead client — a concurrent failure may have already
  // evicted it and a newer request attached a healthy replacement, which must not be
  // closed. Best-effort close + drop from the shutdown set.
  const evictClient = (repo: RepoInfo, client: DaemonReadClient): void => {
    const cached = clientPool.get(repo.id);
    if (!cached) return;
    cached.then(
      (pooled) => {
        if (pooled !== client) return; // superseded by a healthy replacement — leave it
        if (clientPool.get(repo.id) !== cached) return; // already evicted by a racing failure
        clientPool.delete(repo.id);
        daemonClients.delete(client);
        try { client.close(); } catch { /* best-effort */ }
      },
      () => { /* a rejected attach already evicted itself via getClient's .catch */ },
    );
  };
  const readDeps: ReadApiDeps = {
    version: CodeGraphPackageVersion,
    defaultRepo,
    resolveRepo,
    getClient,
    evictClient,
    isRepoIndexed: (root) => findNearestCodeGraphRoot(root) !== null,
  };

  // WebSocket sessions lease independent daemon transports. The daemon engine
  // remains shared and warm, but a failed or disconnected browser session can
  // close only its own socket instead of evicting the HTTP pool or another LSP
  // session's in-flight reads.
  const getLspClient = async (repo: RepoInfo, signal: AbortSignal): Promise<DaemonReadClient> => {
    const client = await attachDaemonClient(
      repo.root,
      {
        ...(options.spawnDaemon ? { spawnDaemon: options.spawnDaemon } : {}),
        signal,
      },
    );
    if (closing) {
      try { client.close(); } catch { /* best-effort */ }
      return client;
    }
    daemonClients.add(client);
    return client;
  };
  const releaseLspClient = (_repo: RepoInfo, client: DaemonReadClient): void => {
    if (!daemonClients.delete(client)) return;
    try { client.close(); } catch { /* best-effort */ }
  };

  // Slice-2 reindex jobs (FR-020..FR-024): an in-memory latest-job-per-repo
  // registry. Jobs run IN this serve process (FR-021); the watcher re-arm
  // (FR-021a) defaults to the socket control-message sender. Tests inject
  // `options.jobDeps` (index runner / lock probe / re-arm spy / retry timing).
  const jobRegistry = new JobRegistry({
    rearmWatcher: defaultRearmWatcher,
    logDiagnostic: options.diagnostics, // F1: a contained job failure is logged locally
    ...(options.jobDeps ?? {}),
  });

  // Read routes and job routes are built by SEPARATE builders: the read-slice
  // OpenAPI contract walk asserts a bijection over `buildReadRoutes` (and that
  // the document omits the reindex surface), so the job routes must not join it.
  const routes = [
    ...buildReadRoutes(readDeps),
    ...buildJobRoutes({
      resolveRepo,
      isRepoIndexed: (root) => findNearestCodeGraphRoot(root) !== null,
      registry: jobRegistry,
    }),
    ...buildChatRoutes({
      defaultRepo,
      resolveRepo,
      getClient,
      evictClient,
    }),
  ];

  const server = http.createServer((req, res) => {
    void handleHttp(req, res);
  });

  server.on('connection', (socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });

  async function handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const rawUrl = req.url ?? '/';
    const qIdx = rawUrl.indexOf('?');
    const rawPath = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
    let status = 500;
    try {
      // FR-012 DNS-rebinding defense: validate the `Host` header on EVERY request
      // — even on this loopback bind, and even for the static shell that sits
      // outside the auth boundary. A non-allowlisted Host → 400 `invalid_request`
      // naming the header (the closed vocabulary adds no 403).
      if (!isAllowedHostHeader(firstHeader(req.headers.host), host, boundPort)) {
        const denied = apiError('invalid_request', {
          message: 'Invalid Host header',
          details: { header: 'Host' },
        });
        status = denied.status;
        writeResult(res, denied);
        return;
      }

      const query = new URLSearchParams(qIdx === -1 ? '' : rawUrl.slice(qIdx + 1));
      const ctx: RouteContext = {
        method,
        rawPath,
        params: {},
        query,
        headers: req.headers as Record<string, string | string[] | undefined>,
        // The raw req/res are handed through for the SSE endpoint (FR-023), which
        // streams frames directly. Every other handler ignores them.
        req,
        res,
        // F1: contained-fault sites log the caught exception here (never headers).
        logDiagnostic: options.diagnostics,
      };

      // FR-014 Bearer scope: on a token-bound bind, handleApiRequest 401s every
      // `/api/*` request lacking a valid Bearer BEFORE routing; a no-op on loopback.
      const apiResult = await handleApiRequest(routes, ctx, security);
      if (apiResult) {
        status = apiResult.status;
        // The SSE handler already took over the response (headers + frames
        // written); serializing a JSON body here would `writeHead` twice.
        if (apiResult.hijacked) return;
        writeResult(res, apiResult);
        return;
      }

      // Non-`/api` → static mount (FR-017/018). serveStatic confines the resolved
      // path within `webRoot` and returns the placeholder/fallback (its own task).
      const staticResult = serveStatic(rawPath, webRoot);
      status = staticResult.status;
      res.writeHead(staticResult.status, staticResult.headers ?? {});
      res.end(staticResult.body);
    } catch {
      // FR-015a top-level catch: any unanticipated throw becomes the generic 500
      // envelope, never a raw crash, leaked stack, or hung socket.
      status = 500;
      writeResult(res, internalError());
    } finally {
      // FR-014a: a LOCAL, redacted request line — method + path + status ONLY.
      // NEVER the headers object, the `Authorization` header, or the token in any
      // form — including the rare case where a client puts the configured token
      // in the request PATH (e.g. `/api/<token>`): redact it before logging.
      try {
        // FR-014a is absolute: the token must never appear in a log in ANY
        // reversible form. A client can place it in the request PATH verbatim,
        // singly OR MULTIPLY percent-encoded — and a single malformed escape
        // (e.g. `%ZZ`) must not abort the scan and let an encoded token through.
        // `containsToken` checks every decoding level (bounded, tolerant of a bad
        // escape); a match collapses the path to a fixed marker. Decoding here is
        // only for the check — nothing is served from it. (The method needs no
        // redaction: node:http's strict parser rejects any nonstandard method with
        // HPE_INVALID_METHOD before the handler runs, so `method` is always a
        // validated standard verb and can never carry the token.)
        const safePath = containsToken(rawPath, security.token) ? '/<redacted>' : rawPath;
        options.logger?.(`${method} ${safePath} -> ${status}`);
      } catch { /* a log sink must never take down the server */ }
    }
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening);
      // A failed `listen` never bound — there is no half-open listener to close.
      reject(mapListenError(err, host, requestedPort));
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(requestedPort, host);
  });

  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr !== null ? addr.port : requestedPort;
  const lspWebSocket = attachLspWebSocket({
    server,
    host,
    port: boundPort,
    security,
    resolveRepo,
    getClient: getLspClient,
    releaseClient: releaseLspClient,
    diagnostics: options.diagnostics,
  });

  const close = (deadlineAt = Date.now() + SHUTDOWN_GRACE_MS): Promise<void> => {
    if (closing) return closing;
    const shutdownDeadline = Math.max(Date.now(), deadlineAt);
    closing = (async () => {
      // FR-026 ordered shutdown. Establish one deadline, then begin every cleanup
      // lane together so an unresponsive WebSocket cannot consume the HTTP, job,
      // or daemon cleanup budget before those lanes even start.
      const remaining = (): number => Math.max(0, shutdownDeadline - Date.now());
      // Cancel pooled HTTP admissions before they can continue polling or spawn
      // a daemon after shutdown has begun.
      serverLifetime.abort();

      // (1) stop accepting new connections and capture the
      // REAL `server.close()` callback — it fires only once EVERY connection has
      // closed, so awaiting it (step 3) guarantees the listening socket is fully
      // released before close() resolves (no rebind race). The grace backstop does
      // NOT resolve the wait; it only DESTROYS any lingering socket so that callback
      // can complete against an idle keep-alive that would otherwise hold the
      // listener past the deadline.
      let serverClosed!: () => void;
      const serverClosePromise = new Promise<void>((r) => { serverClosed = r; });
      server.close(() => serverClosed());
      const backstop = setTimeout(() => {
        for (const socket of connections) { try { socket.destroy(); } catch { /* gone */ } }
      }, remaining());
      backstop.unref?.();

      const lspClosePromise = lspWebSocket.close(shutdownDeadline);
      const jobAbortPromise = Promise.race([
        jobRegistry.abortAll(shutdownDeadline),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, remaining());
          timer.unref?.();
        }),
      ]);
      const attachAbortPromise = Promise.race([
        Promise.allSettled([...pendingClientAttaches]).then(() => undefined),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, remaining());
          timer.unref?.();
        }),
      ]);

      // Closing daemon transports is synchronous and immediately unblocks any
      // read that outlived its HTTP or LSP peer. Session release is identity-safe,
      // so clearing here cannot double-close a leased transport.
      for (const client of daemonClients) {
        try { client.close(); } catch { /* best-effort */ }
      }
      daemonClients.clear();

      // (2) abort any in-flight reindex job via its AbortSignal: the job records a
      // terminal `aborted` outcome, emits the terminal SSE event to every
      // subscriber, releases the index lock (indexAll's finally), and fires the
      // watcher re-arm (FR-023/026). Bounded by the grace window so a job that
      // will not settle can never defer shutdown past the deadline.
      await Promise.allSettled([lspClosePromise, jobAbortPromise, attachAbortPromise]);
      // (3) release the bound port. GRACEFULLY end each socket first (`end()`
      // flushes the write buffer before FIN) so the terminal SSE frame written in
      // step 2 is delivered rather than dropped by an abrupt `destroy()`; then
      // await the REAL server close — it resolves only once every connection has
      // closed (stragglers destroyed by the grace backstop), so close() never
      // resolves while the listening socket is still open (no rebind race).
      for (const socket of connections) {
        try { socket.end(); } catch { /* already gone */ }
      }
      await serverClosePromise;
      clearTimeout(backstop);
      for (const socket of connections) {
        try { socket.destroy(); } catch { /* already gone */ }
      }
      connections.clear();
    })();
    return closing;
  };

  return {
    host,
    port: boundPort,
    trackDaemonClient(client: DaemonReadClient): void {
      if (closing) {
        try { client.close(); } catch { /* best-effort */ }
        return;
      }
      daemonClients.add(client);
    },
    close,
  };
}

/** Serialize a handler/error result as the JSON envelope (FR-015). */
function writeResult(res: http.ServerResponse, r: HandlerResult): void {
  // A response whose headers already went out (e.g. a hijacked SSE stream that
  // then threw, so the dispatcher fell back to an error result) must NOT be
  // written again — a second writeHead throws ERR_HTTP_HEADERS_SENT, which the
  // top-level catch would then re-throw into an unhandled rejection (F3). Abort
  // the socket instead; the client sees a truncated stream, never a crash.
  if (res.headersSent) {
    try { res.destroy(); } catch { /* already gone */ }
    return;
  }
  res.writeHead(r.status, { 'Content-Type': 'application/json', ...(r.headers ?? {}) });
  res.end(JSON.stringify(r.body));
}

/** Collapse a possibly-multivalued header to its first value. */
function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Options for the `serve --web` CLI runner. */
export interface RunWebServerCliOptions {
  projectPath?: string;
  host?: string;
  /** Raw `--port` value (parsed + validated here). */
  port?: string | number;
}

/**
 * The `serve --web` CLI entry (FR-026): validate the port, bind via
 * {@link startWebServer}, print the actual bound port, and run until an ordered
 * SIGINT/SIGTERM shutdown with a bounded ~5s force-exit backstop. Kept here (not
 * in `src/bin/codegraph.ts`) so the upstream CLI diff stays a thin option +
 * branch (fork discipline).
 */
export async function runWebServerCli(options: RunWebServerCliOptions): Promise<void> {
  let port: number | undefined;
  if (options.port !== undefined && options.port !== '') {
    port = Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new WebServerError(
        `Invalid --port "${options.port}": expected an integer between 0 and 65535.`,
        { code: 'EINVAL', port: Number.isFinite(port) ? port : undefined },
      );
    }
  }

  // FR-013/FR-014: the token is read from the environment here (keeping the
  // upstream CLI diff a thin option + branch, fork discipline) and passed to the
  // fail-closed bind gate. Unset → null → a loopback bind still serves, a
  // non-loopback bind is refused.
  const handle = await startWebServer({
    projectPath: options.projectPath,
    host: options.host,
    port,
    token: process.env.CODEGRAPH_SERVER_TOKEN ?? null,
    // F1: surface contained-fault causes on stderr for the operator (the wire
    // response stays the generic FR-015a envelope). Never carries the token.
    diagnostics: (message) => console.error(message),
  });
  // Print the ACTUAL bound port (resolved when --port 0 was requested, FR-026);
  // stderr keeps stdout clean, mirroring the serve command's other output.
  const displayHost = handle.host.includes(':') ? `[${handle.host}]` : handle.host;
  console.error(`CodeGraph web server listening on http://${displayHost}:${handle.port}`);
  console.error('Press Ctrl+C to stop.');

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadlineAt = Date.now() + SHUTDOWN_GRACE_MS;
    void handle.close(deadlineAt).finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
