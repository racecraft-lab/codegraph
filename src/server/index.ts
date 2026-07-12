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
 * Read routes are an empty table until later Slice-1 tasks register the read
 * handlers; the static mount composes in as its task lands. The `'upgrade'`
 * attach point is exposed but wired to nothing (reserved for SPEC-009).
 */

import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  handleApiRequest,
  buildReadRoutes,
  type RouteContext,
  type HandlerResult,
  type ReadApiDeps,
  type RepoInfo,
} from './routes';
import { internalError, apiError } from './errors';
import { resolveBindSecurity, isAllowedHostHeader } from './auth';
import { serveStatic } from './static';
import { attachDaemonClient, type DaemonReadClient } from './daemon-client';
import { CodeGraphPackageVersion } from '../mcp/version';
import { listDaemons } from '../mcp/daemon-registry';
import { findNearestCodeGraphRoot } from '../directory';

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
  close(): Promise<void>;
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

/**
 * 16-hex repo id — the SHA-256 prefix of the resolved root, identical to the
 * daemon registry's own record key by construction (FR-010).
 */
function repoIdForRoot(root: string): string {
  return crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
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
export async function startWebServer(options: WebServerOptions = {}): Promise<WebServerHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  const webRoot = options.webRoot ?? DEFAULT_WEB_ROOT;

  // FR-012/FR-013 fail-closed bind gate — resolved BEFORE any `listen`. A
  // non-loopback host with no token throws here, so startup is refused and
  // nothing binds. On loopback `requireToken` is false (Bearer no-op, SC-002).
  const security = resolveBindSecurity(host, options.token ?? null);

  // Daemon clients attached while serving reads (lazily, FR-010) — closed on
  // shutdown to decrement each daemon's refcount, never killed (FR-026).
  const daemonClients = new Set<DaemonReadClient>();
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
      options.spawnDaemon ? { spawnDaemon: options.spawnDaemon } : {},
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
  const readDeps: ReadApiDeps = {
    version: CodeGraphPackageVersion,
    defaultRepo,
    resolveRepo,
    getClient,
    isRepoIndexed: (root) => findNearestCodeGraphRoot(root) !== null,
  };
  const routes = buildReadRoutes(readDeps);

  const server = http.createServer((req, res) => {
    void handleHttp(req, res);
  });

  server.on('connection', (socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });

  // Reserved for SPEC-009 (LSP over WebSocket) — exposed but wired to nothing.
  // Destroy the socket so an upgrade request never hangs or gets a 101.
  server.on('upgrade', (_req, socket) => {
    socket.destroy();
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
      };

      // FR-014 Bearer scope: on a token-bound bind, handleApiRequest 401s every
      // `/api/*` request lacking a valid Bearer BEFORE routing; a no-op on loopback.
      const apiResult = await handleApiRequest(routes, ctx, security);
      if (apiResult) {
        status = apiResult.status;
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
        // reversible form. A client can place it in the path verbatim, singly OR
        // MULTIPLY percent-encoded, so check the raw path AND every decoding level
        // (bounded, to avoid an infinite loop on malformed input); a match at any
        // level collapses the whole path to a fixed marker. Decoding here is only
        // for the redaction check — nothing is served from it, so (unlike the
        // static mount) it may safely decode to a fixed point.
        let safePath = rawPath;
        if (security.token) {
          let probe = rawPath;
          for (let i = 0; i < 6; i++) {
            if (probe.includes(security.token)) { safePath = '/<redacted>'; break; }
            let next: string;
            try { next = decodeURIComponent(probe); } catch { break; } // malformed % — stop
            if (next === probe) break; // fully decoded / stable
            probe = next;
          }
        }
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

  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      // (1) stop accepting new connections + (3) release the bound port. Destroy
      // lingering (idle keep-alive) sockets so the port frees within the grace
      // window; the callback fires once the server has drained.
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (!settled) { settled = true; resolve(); }
        };
        server.close(() => finish());
        for (const socket of connections) {
          try { socket.destroy(); } catch { /* already gone */ }
        }
        connections.clear();
        const backstop = setTimeout(finish, SHUTDOWN_GRACE_MS);
        backstop.unref?.();
      });
      // (4) close every daemon client socket — decrement the daemon's refcount,
      // NEVER kill it; a shared daemon may still serve other MCP sessions.
      for (const client of daemonClients) {
        try { client.close(); } catch { /* best-effort */ }
      }
      daemonClients.clear();
    })();
    return closing;
  };

  return {
    host,
    port: boundPort,
    trackDaemonClient(client: DaemonReadClient): void {
      daemonClients.add(client);
    },
    close,
  };
}

/** Serialize a handler/error result as the JSON envelope (FR-015). */
function writeResult(res: http.ServerResponse, r: HandlerResult): void {
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
    const backstop = setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS);
    backstop.unref?.();
    void handle.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
