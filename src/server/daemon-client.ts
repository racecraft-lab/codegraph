/**
 * SPEC-005 daemon client — the serve process is a daemon *client* (FR-002).
 *
 * Attaches to (or spawns) the per-project daemon via the MCP proxy machinery
 * and forwards read queries over its socket, so the web API and MCP sessions
 * share one warm index. Non-default repos are attached lazily on first access
 * (Q2); `/api/repos` is sourced from the daemon registry (FR-009).
 *
 * Reads are forwarded as MCP JSON-RPC over the daemon socket — NO new daemon
 * RPC is added (FR-021). Attach reuses the exported `connectWithHello`
 * (src/mcp/proxy.ts); the round-trip rides `SocketTransport.request`
 * (src/mcp/transport.ts): an `initialize` handshake then `tools/call`. An
 * attach/spawn failure never crashes — it maps to the 503 `unavailable`
 * envelope carrying `Retry-After` (FR-015a edge case).
 *
 * @module server/daemon-client
 */

import { spawn, type StdioOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Socket } from 'net';
import { connectWithHello } from '../mcp/proxy';
import { getDaemonSocketCandidates } from '../mcp/daemon-paths';
import { SocketTransport } from '../mcp/transport';
import { findNearestCodeGraphRoot, getCodeGraphDir } from '../directory';
import { HOST_PPID_ENV } from '../extraction/wasm-runtime-flags';
import { unavailable, DEFAULT_RETRY_AFTER_SECONDS, type ApiError } from './errors';

/**
 * The `/api/repos` wire shape (FR-010, data-model "Repo"). `id` is the 16-hex
 * SHA-256 prefix of the realpath'd root — the daemon registry's own record key.
 */
export interface Repo {
  id: string;
  root: string;
  name: string;
  /** Exactly one listed repo (the startup repo) is the default (FR-009). */
  default: boolean;
}

/**
 * A single MCP tool result forwarded back from the daemon — the JSON-RPC
 * `result` of a `tools/call`. Mirrors the daemon's `ToolResult` shape without
 * coupling the server module to the MCP internals at runtime.
 */
export interface DaemonToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * A live, attached daemon connection the web server forwards read queries
 * through. One per attached repo; held for the server's lifetime and closed on
 * shutdown (FR-026) — closing decrements the daemon's client refcount and never
 * kills a shared daemon.
 */
export interface DaemonReadClient {
  /** Forward one read `tools/call` and resolve its result (FR-002/008). */
  request(toolName: string, args?: Record<string, unknown>): Promise<DaemonToolResult>;
  /** End the socket, decrementing the daemon's client refcount (FR-026). */
  close(): void;
}

/** Injectable seams for {@link attachDaemonClient} (production defaults are real). */
export interface AttachOptions {
  /**
   * Spawn the per-project daemon for `root` when none is reachable. Defaults to
   * the detached-CLI spawn (mirrors the MCP proxy). Injected in tests because a
   * test runner's `process.argv[1]` is the runner, not the CodeGraph CLI.
   */
  spawnDaemon?: (root: string) => void;
  /** Connect to a daemon socket (defaults to the exported `connectWithHello`). */
  connect?: (socketPath: string) => Promise<Socket | 'version-mismatch' | null>;
  /** Poll budget after a spawn while the daemon binds its socket. */
  connectMaxRetries?: number;
  connectRetryDelayMs?: number;
}

/**
 * A transient daemon attach/spawn failure (FR-015a): the read pipeline maps it
 * to the 503 `unavailable` envelope with `Retry-After` and never crashes. Not a
 * client error — a downstream-dependency failure the client may retry.
 */
export class DaemonUnavailableError extends Error {
  readonly retryAfterSeconds?: number;
  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'DaemonUnavailableError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Mirror the MCP proxy's connect-poll budget (src/mcp/index.ts: 240 × 25ms ≈ 6s
// of headroom for a cold daemon to bind its socket after a spawn).
const DEFAULT_CONNECT_MAX_RETRIES = 240;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 25;

/** Timeouts for the two forwarded JSON-RPC phases (generous for a cold daemon). */
const INITIALIZE_TIMEOUT_MS = 15_000;
const TOOL_CALL_TIMEOUT_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Env var that marks a spawned process as the detached daemon itself (kept in
 * lockstep with `DAEMON_INTERNAL_ENV` in src/mcp/index.ts, which is module-private
 * there). Set so the spawned `serve --mcp` becomes the daemon rather than a
 * launcher that would spawn yet another.
 */
const DAEMON_INTERNAL_ENV = 'CODEGRAPH_DAEMON_INTERNAL';

/**
 * Production default: spawn the shared daemon as a fully detached background
 * process, mirroring `spawnDetachedDaemon` (src/mcp/index.ts). Re-invokes the
 * running CLI (`process.argv[1]`, valid when `serve --web` runs from the bundled
 * binary) with `serve --mcp --path <root>` and the internal-daemon marker; the
 * spawned process self-arbitrates the O_EXCL lock.
 */
function defaultSpawnDaemon(root: string): void {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    throw new DaemonUnavailableError('cannot resolve CLI script path to spawn the daemon');
  }
  let logFd: number | null = null;
  let stdio: StdioOptions = 'ignore';
  try {
    logFd = fs.openSync(path.join(getCodeGraphDir(root), 'daemon.log'), 'a');
    stdio = ['ignore', logFd, logFd];
  } catch {
    stdio = 'ignore';
  }
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, [DAEMON_INTERNAL_ENV]: '1' };
    delete env[HOST_PPID_ENV];
    const child = spawn(
      process.execPath,
      [...process.execArgv, scriptPath, 'serve', '--mcp', '--path', root],
      { detached: true, stdio, windowsHide: true, env },
    );
    child.unref();
  } finally {
    if (logFd !== null) {
      try { fs.closeSync(logFd); } catch { /* ignore */ }
    }
  }
}

/**
 * Canonicalize `inputPath` to the nearest `.codegraph/` root the daemon keys on
 * (realpath, matching `resolveDaemonRoot` in src/mcp/index.ts), or null when no
 * index is reachable — the never-indexed / bogus-path case (→ 503).
 */
function resolveIndexedRoot(inputPath: string): string | null {
  let candidate = inputPath;
  try { candidate = fs.realpathSync(inputPath); } catch { /* nonexistent — try as-is */ }
  const root = findNearestCodeGraphRoot(candidate);
  if (!root) return null;
  try { return fs.realpathSync(root); } catch { return root; }
}

/** Walk the ordered socket candidates once; first live daemon wins. */
async function connectAnyCandidate(
  candidates: readonly string[],
  connect: NonNullable<AttachOptions['connect']>,
): Promise<Socket | 'version-mismatch' | null> {
  for (const candidate of candidates) {
    const s = await connect(candidate);
    if (s === 'version-mismatch') return s; // definitive — a wrong-version daemon is up
    if (s) return s;
  }
  return null;
}

/**
 * Build a read client over an attached socket: run the MCP `initialize`
 * handshake (answering a server-initiated `roots/list` with the root), then hand
 * back `request`/`close`.
 */
async function makeReadClient(socket: Socket, root: string): Promise<DaemonReadClient> {
  const transport = new SocketTransport(socket, 'cg-web');
  const rootUri = `file://${root}`;
  transport.start(async (msg) => {
    // The daemon session may ask us for workspace roots; answer with the root so
    // it never waits out its 5s roots/list timeout. Everything else is ignored.
    const m = msg as { method?: string; id?: string | number };
    if (m.method === 'roots/list' && m.id !== undefined) {
      transport.sendResult(m.id, { roots: [{ uri: rootUri, name: path.basename(root) }] });
    }
  });

  await transport.request(
    'initialize',
    {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'codegraph-web', version: '0.0.0' },
      rootUri,
    },
    INITIALIZE_TIMEOUT_MS,
  );

  return {
    async request(toolName, args) {
      const result = await transport.request(
        'tools/call',
        { name: toolName, arguments: args ?? {} },
        TOOL_CALL_TIMEOUT_MS,
      );
      return result as DaemonToolResult;
    },
    close() {
      transport.stop();
    },
  };
}

/**
 * Attach to (or spawn) the daemon serving `root` and return a read client
 * (FR-002). Throws {@link DaemonUnavailableError} when no daemon can be reached
 * or spawned — including a bogus / never-indexed path (never a crash, FR-015a).
 */
export async function attachDaemonClient(
  root: string,
  opts: AttachOptions = {},
): Promise<DaemonReadClient> {
  const indexedRoot = resolveIndexedRoot(root);
  if (!indexedRoot) {
    // No `.codegraph/` reachable — there is nothing to attach to and spawning a
    // daemon for an un-indexable root would loop. Transient from the client's
    // view (they may index it), so a 503, never a crash.
    throw new DaemonUnavailableError(`no indexed project at ${root}`);
  }

  const connect = opts.connect ?? connectWithHello;
  const spawnDaemon = opts.spawnDaemon ?? defaultSpawnDaemon;
  const maxRetries = opts.connectMaxRetries ?? DEFAULT_CONNECT_MAX_RETRIES;
  const retryDelayMs = opts.connectRetryDelayMs ?? DEFAULT_CONNECT_RETRY_DELAY_MS;
  const candidates = getDaemonSocketCandidates(indexedRoot);

  // Fast path: a daemon may already be listening.
  const probe = await connectAnyCandidate(candidates, connect);
  if (probe === 'version-mismatch') {
    // A wrong-version daemon holds the socket; spawning can't help. Transient —
    // the user can restart the daemon — so surface it as an attach failure.
    throw new DaemonUnavailableError('daemon version mismatch');
  }
  if (probe) return makeReadClient(probe, indexedRoot);

  // None reachable — spawn one (detached) and poll for its bind.
  spawnDaemon(indexedRoot);
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await sleep(retryDelayMs);
    const s = await connectAnyCandidate(candidates, connect);
    if (s === 'version-mismatch') throw new DaemonUnavailableError('daemon version mismatch');
    if (s) return makeReadClient(s, indexedRoot);
  }

  throw new DaemonUnavailableError(`daemon for ${indexedRoot} never bound its socket`);
}

/**
 * Map a daemon attach/spawn failure to the 503 `unavailable` envelope carrying
 * `Retry-After` (FR-002/015a). Any non-daemon error still yields the generic
 * transient 503 so a read never leaks a fault or crashes.
 */
export function daemonUnavailable(err?: unknown): ApiError {
  const retryAfter =
    err instanceof DaemonUnavailableError && err.retryAfterSeconds !== undefined
      ? err.retryAfterSeconds
      : DEFAULT_RETRY_AFTER_SECONDS;
  return unavailable(retryAfter);
}

/**
 * List the indexed projects known to the daemon registry, with the startup
 * repo marked default (FR-009). Implemented in a later Slice-1 task.
 */
export async function listRepos(): Promise<Repo[]> {
  throw new Error('not implemented: listRepos');
}
