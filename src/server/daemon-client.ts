/**
 * SPEC-005 daemon client — the serve process is a daemon *client* (FR-002).
 *
 * Attaches to (or spawns) the per-project daemon via the MCP proxy machinery
 * and forwards read queries over its socket, so the web API and MCP sessions
 * share one warm index. Non-default repos are attached lazily on first access
 * (Q2); `/api/repos` is sourced from the daemon registry (FR-009).
 *
 * Attach rides the exported `connectWithHello` (src/mcp/proxy.ts) — the hello
 * plus an `initialize` handshake — and every round-trip rides
 * `SocketTransport.request` (src/mcp/transport.ts). Reads use two JSON-RPC
 * methods over that socket: `tools/call` for the MCP tool surface, and the
 * additive read-only `codegraph/read` structured method (a human-ratified
 * amendment) for the typed graph reads the REST API returns. FR-021 still
 * holds — no *indexing* RPC is added; the daemon only ever serves reads. An
 * attach/spawn failure never crashes — it maps to the 503 `unavailable`
 * envelope carrying `Retry-After` (FR-015a edge case).
 *
 * @module server/daemon-client
 */

import { spawn, type StdioOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Socket } from 'net';
import { pathToFileURL } from 'node:url';
import { connectWithHello } from '../mcp/proxy';
import {
  getDaemonSocketCandidates,
  openDaemonLog,
  readTrustedDaemonLock,
  type DaemonLockInfo,
} from '../mcp/daemon-paths';
import { listDaemons } from '../mcp/daemon-registry';
import { SocketTransport } from '../mcp/transport';
import { CodeGraphPackageVersion } from '../mcp/version';
import { findNearestCodeGraphRoot } from '../directory';
import { HOST_PPID_ENV } from '../extraction/wasm-runtime-flags';
import { unavailable, DEFAULT_RETRY_AFTER_SECONDS, type ApiError } from './errors';
import type {
  LspDocumentContextRead,
  LspIncomingRead,
  LspNodeLocationRead,
  LspPositionContextRead,
  LspSourceSnapshotRead,
  LspWorkspaceSymbolsRead,
  ReadOp,
} from '../mcp/read-ops';
import type { ClusterListResult, FlowDetailRead, FlowListResult } from '../analysis';
import { reportDiagnostic } from './diagnostics';

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
  /**
   * Forward one STRUCTURED read op over the additive `codegraph/read` method
   * (SPEC-005 FR-002/004/008) and resolve its JSON result. The op discriminator
   * and its params ride the same socket as `tools/call`; the daemon runs the
   * library read against its warm index and returns structured data (no second
   * in-process index copy). Rejects if the daemon reports an error (unknown op).
   */
  read(
    op: ReadOp,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
    detachOnAbort?: boolean,
  ): Promise<unknown>;
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
  spawnDaemon?: (root: string, diagnostics: (code: DaemonAttachDiagnosticCode) => void) => void;
  /** Stable, redaction-safe reason codes for asynchronous daemon startup faults. */
  diagnostics?: (code: DaemonAttachDiagnosticCode) => void;
  /** Connect to a daemon socket (defaults to the exported `connectWithHello`). */
  connect?: (
    socketPath: string,
    signal?: AbortSignal,
    expectedIdentity?: DaemonLockInfo,
  ) => Promise<Socket | 'version-mismatch' | null>;
  /** Poll budget after a spawn while the daemon binds its socket. */
  connectMaxRetries?: number;
  connectRetryDelayMs?: number;
  /** Cancels an admission-scoped attach during server shutdown. */
  signal?: AbortSignal;
  /** Test seam; production always uses the fixed 15-second initialize budget. */
  initializeTimeoutMs?: number;
}

export type DaemonAttachDiagnosticCode = 'daemon_spawn_failed';

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

/**
 * Overall wall-clock ceiling for the post-spawn attach poll (~6s, matching the
 * documented connect-poll budget). Bounds the retry loop by elapsed time as well
 * as attempt count so a daemon that never binds fails fast to a 503 instead of
 * stalling for minutes when individual connect attempts each wait seconds.
 */
const ATTACH_BUDGET_MS = 6000;

/** Timeouts for the two forwarded JSON-RPC phases (generous for a cold daemon). */
const INITIALIZE_TIMEOUT_MS = 15_000;
const TOOL_CALL_TIMEOUT_MS = 30_000;
const MAX_DETACHED_DAEMON_READS = 16;

type DetachedRequestWaiter = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort: () => void;
};

/**
 * Bound operations whose local caller may detach on cancellation. A detached
 * caller rejects promptly, but its lease remains held until the underlying
 * daemon round trip settles, preventing cancellation from multiplying work.
 */
export class DetachedRequestBudget {
  private active = 0;
  private closed = false;
  private readonly waiters: DetachedRequestWaiter[] = [];

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('invalid detached request limit');
  }

  async run<T>(start: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    if (signal?.aborted) {
      release();
      throw new Error('Request aborted');
    }
    let underlying: Promise<T>;
    try { underlying = Promise.resolve(start()); }
    catch (error) {
      release();
      throw error;
    }
    const tracked = underlying.finally(release);
    if (!signal) return tracked;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (complete: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        complete();
      };
      const onAbort = (): void => finish(() => reject(new Error('Request aborted')));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      tracked.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.reject(new Error('Detached request budget closed'));
    }
  }

  private acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.closed) return Promise.reject(new Error('Detached request budget closed'));
    if (signal?.aborted) return Promise.reject(new Error('Request aborted'));
    if (this.active < this.limit && this.waiters.length === 0) {
      this.active += 1;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise((resolve, reject) => {
      const waiter: DetachedRequestWaiter = {
        resolve,
        reject,
        signal,
        onAbort: () => undefined,
      };
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index < 0) return;
        this.waiters.splice(index, 1);
        signal?.removeEventListener('abort', waiter.onAbort);
        reject(new Error('Request aborted'));
      };
      this.waiters.push(waiter);
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      if (signal?.aborted) waiter.onAbort();
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.grantWaiters();
    };
  }

  private grantWaiters(): void {
    while (!this.closed && this.active < this.limit && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      if (waiter.signal?.aborted) {
        waiter.reject(new Error('Request aborted'));
        continue;
      }
      this.active += 1;
      waiter.resolve(this.makeRelease());
    }
  }
}

function attachAborted(): DaemonUnavailableError {
  return new DaemonUnavailableError('daemon attach aborted');
}

function attachDeadlineExceeded(): DaemonUnavailableError {
  return new DaemonUnavailableError('daemon attach deadline exceeded');
}

function throwIfAttachAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw attachAborted();
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  throwIfAttachAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(attachAborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function withAttachDeadline<T>(
  operation: Promise<T>,
  deadlineAt: number,
  signal?: AbortSignal,
  disposeLate?: (value: T) => void,
  abortAttempt?: () => void,
): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    abortAttempt?.();
    operation.then((value) => disposeLate?.(value), () => undefined);
    return Promise.reject(attachDeadlineExceeded());
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = (): void => finish(() => reject(attachAborted()));
    const timer = setTimeout(() => {
      abortAttempt?.();
      finish(() => reject(attachDeadlineExceeded()));
    }, remaining);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    operation.then(
      (value) => {
        if (settled) {
          disposeLate?.(value);
          return;
        }
        finish(() => resolve(value));
      },
      (error) => finish(() => reject(error)),
    );
  });
}

function attachAttemptSignal(
  parent?: AbortSignal,
): { signal: AbortSignal; abort: () => void; dispose: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  return {
    signal: controller.signal,
    abort,
    dispose: () => {
      parent?.removeEventListener('abort', abort);
    },
  };
}

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
function defaultSpawnDaemon(
  root: string,
  diagnostics: (code: DaemonAttachDiagnosticCode) => void,
): void {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    throw new DaemonUnavailableError('cannot resolve CLI script path to spawn the daemon');
  }
  let logFd: number | null = null;
  let stdio: StdioOptions = 'ignore';
  try {
    // Use the same trusted descriptor path as the MCP launcher: POSIX rejects
    // project-controlled links, while Windows keeps the log under the current
    // user's validated private daemon-lock directory.
    logFd = openDaemonLog(root);
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
    // A spawn failure (e.g. ENOENT/EACCES on execPath) surfaces as an async
    // 'error' event; with no listener Node re-throws it as an uncaughtException.
    // Absorb it (surfacing it to the operator via stderr, F1's diagnostic
    // channel in CLI mode) so the attach simply degrades to the poll-timeout 503
    // (FR-015a) instead of crashing the serve process.
    child.on('error', () => diagnostics('daemon_spawn_failed'));
    child.unref();
  } finally {
    if (logFd !== null) {
      try { fs.closeSync(logFd); } catch { /* ignore */ }
    }
  }
}

function defaultDaemonDiagnostics(code: DaemonAttachDiagnosticCode): void {
  try { process.stderr.write(`[codegraph:daemon] ${code}\n`); } catch { /* ignore */ }
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

/** Try the currently trusted or injected targets once; first live daemon wins. */
async function connectAnyCandidate(
  targets: () => ReadonlyArray<{ socketPath: string; expectedIdentity?: DaemonLockInfo }>,
  connect: NonNullable<AttachOptions['connect']>,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<Socket | 'version-mismatch' | null> {
  for (const target of targets()) {
    throwIfAttachAborted(signal);
    if (Date.now() >= deadlineAt) throw attachDeadlineExceeded();
    const attempt = attachAttemptSignal(signal);
    let s: Socket | 'version-mismatch' | null;
    try {
      s = await withAttachDeadline(
        connect(target.socketPath, attempt.signal, target.expectedIdentity),
        deadlineAt,
        signal,
        (late) => {
          if (late && late !== 'version-mismatch') {
            try { late.destroy(); } catch { /* best-effort */ }
          }
        },
        attempt.abort,
      );
    } finally {
      attempt.dispose();
    }
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
async function makeReadClient(
  socket: Socket,
  root: string,
  initializeTimeoutMs: number,
  signal?: AbortSignal,
): Promise<DaemonReadClient> {
  const transport = new SocketTransport(socket, 'cg-web');
  const detachedReads = new DetachedRequestBudget(MAX_DETACHED_DAEMON_READS);
  const rootUri = pathToFileURL(root).href;
  const initializeBudgetMs = Math.max(1, initializeTimeoutMs);
  const initializeDeadline = Date.now() + initializeBudgetMs;
  transport.start(async (msg) => {
    // The daemon session may ask us for workspace roots; answer with the root so
    // it never waits out its 5s roots/list timeout. Everything else is ignored.
    const m = msg as { method?: string; id?: string | number };
    if (m.method === 'roots/list' && m.id !== undefined) {
      transport.sendResult(m.id, { roots: [{ uri: rootUri, name: path.basename(root) }] });
    }
  });

  try {
    await withAttachDeadline(
      transport.request(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'codegraph-web', version: '0.0.0' },
          rootUri,
        },
        initializeBudgetMs,
      ),
      initializeDeadline,
      signal,
    );
    throwIfAttachAborted(signal);
  } catch (err) {
    // A rejected/timed-out handshake would otherwise leak the socket + its data
    // listener (the transport was started above). Close it before propagating so
    // the failed attach doesn't leak a socket per attempt (mirrors the
    // try/finally in jobs.ts defaultRearmWatcher).
    transport.stop();
    throw err;
  }

  return {
    async request(toolName, args) {
      const result = await transport.request(
        'tools/call',
        { name: toolName, arguments: args ?? {} },
        TOOL_CALL_TIMEOUT_MS,
      );
      return result as DaemonToolResult;
    },
    async read(op, params, signal, detachOnAbort = false) {
      if (signal?.aborted) throw new Error('Request aborted');
      // Once written, retain the round trip until the daemon responds or this
      // transport's bounded timeout fires. Rejecting only the local promise on
      // abort would make the caller release global work accounting while the
      // daemon operation could still be running. The stdio LSP transport has no
      // shared admission accounting and opts into detachment so cancellation
      // can unblock its serialized message stream; WebSocket reads retain the
      // default until their dedicated lease is safely released.
      const request = () => transport.request(
        'codegraph/read',
        { op, params: params ?? {} },
        TOOL_CALL_TIMEOUT_MS,
      );
      return detachOnAbort ? detachedReads.run(request, signal) : request();
    },
    close() {
      detachedReads.close();
      transport.stop();
    },
  };
}

// ---------------------------------------------------------------------------
// SPEC-005 read-query wrappers (T013) — typed methods over `codegraph/read`
// that map the daemon's structured library results to the wire `Node`/`Edge`
// shapes (openapi.yaml / data-model "Read query result"). A `null`/`null`-node
// return signals "node not found" for the caller to turn into 404 (FR-004a).
// ---------------------------------------------------------------------------

/** Wire `Node` (openapi) — the node's OWN fields only, trimmed from library Node. */
export interface WireNode {
  id: string;
  kind: string;
  name: string;
  file?: string;
  line?: number;
  signature?: string;
  doc?: string;
}

/** Wire `Edge` (openapi) — source/target/kind plus optional provenance. */
export interface WireEdge {
  source: string;
  target: string;
  kind: string;
  provenance?: string;
}

/** Offset-paged list result (`search`/`callers`/`callees`), FR-006. */
export interface WireListResult {
  items: WireNode[];
  total: number;
  limit: number;
  offset: number;
}

/** `search` result — a list plus SPEC-003 degradation signalling (FR-006a). */
export interface WireSearchResult extends WireListResult {
  degraded: boolean;
  degradationReason?: string;
}

/** Subgraph result (`impact`/`graph`), FR-007. */
export interface WireGraphResult {
  nodes: WireNode[];
  edges: WireEdge[];
  truncated: boolean;
}

/** Index-health portion of `GET /api/status` served by the daemon (FR-005). */
export interface WireStatusHealth {
  index: { state: string; fileCount: number; nodeCount: number; edgeCount: number; lastIndexed: string | null };
  hybridSearch: { available: boolean; reason?: string | null };
  lsp: { available: boolean };
}

/** Search parameters after server-side validation/clamping (FR-006/006a). */
export interface SearchParams {
  query: string;
  limit: number;
  offset: number;
  mode: string;
}

/** The library node/edge fields the daemon forwards (a subset of src/types). */
interface LibNode {
  id: string;
  kind: string;
  name: string;
  filePath?: string;
  startLine?: number;
  signature?: string;
  docstring?: string;
}
interface LibEdge {
  source: string;
  target: string;
  kind: string;
  provenance?: string;
}

function mapNode(n: LibNode): WireNode {
  const out: WireNode = { id: n.id, kind: n.kind, name: n.name };
  if (n.filePath) out.file = n.filePath;
  if (typeof n.startLine === 'number') out.line = n.startLine;
  if (n.signature) out.signature = n.signature;
  if (n.docstring) out.doc = n.docstring;
  return out;
}

function mapEdge(e: LibEdge): WireEdge {
  const out: WireEdge = { source: e.source, target: e.target, kind: e.kind };
  // Collapse the library provenance (tree-sitter/scip/lsp/heuristic) to the
  // 2-value wire enum (static|heuristic, openapi): 'heuristic' for a synthesized
  // edge, 'static' for every statically-extracted one.
  if (e.provenance) out.provenance = e.provenance === 'heuristic' ? 'heuristic' : 'static';
  return out;
}

/** Index health for `GET /api/status` (the daemon-served portion, FR-005). */
export async function readStatusHealth(client: DaemonReadClient): Promise<WireStatusHealth> {
  return (await client.read('status', {})) as WireStatusHealth;
}

/** A node's own fields by opaque id, or `null` when unknown (→ 404, FR-004/004a). */
export async function readNode(client: DaemonReadClient, id: string): Promise<WireNode | null> {
  const r = (await client.read('node', { id })) as { node: LibNode | null };
  return r.node ? mapNode(r.node) : null;
}

/** Paged symbol search with degradation signalling (FR-006/006a). */
export async function readSearch(client: DaemonReadClient, p: SearchParams): Promise<WireSearchResult> {
  const r = (await client.read('search', {
    query: p.query,
    limit: p.limit,
    offset: p.offset,
    mode: p.mode,
  })) as { items: LibNode[]; total: number; degraded: boolean; degradationReason: string | null };
  const out: WireSearchResult = {
    items: r.items.map(mapNode),
    total: r.total,
    limit: p.limit,
    offset: p.offset,
    degraded: r.degraded === true,
  };
  if (r.degraded && r.degradationReason) out.degradationReason = r.degradationReason;
  return out;
}

async function readRelation(
  client: DaemonReadClient,
  op: 'callers' | 'callees',
  id: string,
  limit: number,
  offset: number,
): Promise<WireListResult | null> {
  const r = (await client.read(op, { id, limit, offset })) as {
    found: boolean;
    items?: LibNode[];
    total?: number;
  };
  if (!r.found) return null;
  return { items: (r.items ?? []).map(mapNode), total: r.total ?? 0, limit, offset };
}

/** Paged callers of a node, or `null` when the node is unknown (→ 404). */
export function readCallers(
  client: DaemonReadClient,
  id: string,
  limit: number,
  offset: number,
): Promise<WireListResult | null> {
  return readRelation(client, 'callers', id, limit, offset);
}

/** Paged callees of a node, or `null` when the node is unknown (→ 404). */
export function readCallees(
  client: DaemonReadClient,
  id: string,
  limit: number,
  offset: number,
): Promise<WireListResult | null> {
  return readRelation(client, 'callees', id, limit, offset);
}

async function readSubgraph(
  client: DaemonReadClient,
  op: 'impact' | 'neighborhood',
  id: string,
  depth: number,
): Promise<WireGraphResult | null> {
  const r = (await client.read(op, { id, depth })) as {
    found: boolean;
    nodes?: LibNode[];
    edges?: LibEdge[];
    truncated?: boolean;
  };
  if (!r.found) return null;
  return {
    nodes: (r.nodes ?? []).map(mapNode),
    edges: (r.edges ?? []).map(mapEdge),
    truncated: r.truncated === true,
  };
}

/** Impact-radius subgraph of a node, or `null` when unknown (→ 404, FR-004/007). */
export function readImpact(
  client: DaemonReadClient,
  id: string,
  depth: number,
): Promise<WireGraphResult | null> {
  return readSubgraph(client, 'impact', id, depth);
}

/** Graph-neighborhood subgraph of a node, or `null` when unknown (→ 404, FR-007). */
export function readNeighborhood(
  client: DaemonReadClient,
  id: string,
  depth: number,
): Promise<WireGraphResult | null> {
  return readSubgraph(client, 'neighborhood', id, depth);
}

// ---------------------------------------------------------------------------
// SPEC-011 catalog reads (T025) — the daemon runs the SAME `src/analysis` read
// facade the MCP tools use, so the wire shapes are already the shared catalog
// types (FR-028a). No mapping here — the daemon returns the wire shape directly.
// ---------------------------------------------------------------------------

/** The paged execution-flow catalog with its read-time state (FR-027/030). */
export async function readFlows(
  client: DaemonReadClient,
  limit: number,
  offset: number,
): Promise<FlowListResult> {
  return (await client.read('listFlows', { limit, offset })) as FlowListResult;
}

/** One flow's detail (found) or a stateful miss — success-shaped either way (FR-030). */
export async function readFlow(client: DaemonReadClient, id: string): Promise<FlowDetailRead> {
  return (await client.read('getFlow', { id })) as FlowDetailRead;
}

/** The paged functional-cluster catalog with its read-time state (FR-027/029/030). */
export async function readClusters(
  client: DaemonReadClient,
  minSize: number,
  limit: number,
  offset: number,
): Promise<ClusterListResult> {
  return (await client.read('listClusters', { minSize, limit, offset })) as ClusterListResult;
}

/** Exact indexed source with no graph payload. */
export async function readLspSourceSnapshot(
  client: DaemonReadClient,
  filePath: string,
  signal?: AbortSignal,
  detachOnAbort = false,
): Promise<LspSourceSnapshotRead> {
  return (await client.read('lspSourceSnapshot', { filePath }, signal, detachOnAbort)) as LspSourceSnapshotRead;
}

/** Exact indexed source plus bounded node and occurrence candidates at one line. */
export async function readLspPositionContext(
  client: DaemonReadClient,
  filePath: string,
  line: number,
  signal?: AbortSignal,
  detachOnAbort = false,
): Promise<LspPositionContextRead> {
  return (await client.read('lspPositionContext', { filePath, line }, signal, detachOnAbort)) as LspPositionContextRead;
}

/** Exact indexed source plus bounded nodes and containment for document symbols. */
export async function readLspDocumentContext(
  client: DaemonReadClient,
  filePath: string,
  signal?: AbortSignal,
  detachOnAbort = false,
): Promise<LspDocumentContextRead> {
  return (await client.read('lspDocumentContext', { filePath }, signal, detachOnAbort)) as LspDocumentContextRead;
}

/** Exact located incoming occurrences for one stable graph target. */
export async function readLspIncoming(
  client: DaemonReadClient,
  nodeId: string,
  filePath: string,
  snapshotToken: string,
  signal?: AbortSignal,
  detachOnAbort = false,
): Promise<LspIncomingRead> {
  return (await client.read('lspIncoming', {
    id: nodeId,
    filePath,
    snapshotToken,
  }, signal, detachOnAbort)) as LspIncomingRead;
}

/** Exact indexed node and snapshot identity for deterministic source location. */
export async function readLspNodeLocation(
  client: DaemonReadClient,
  nodeId: string,
  signal?: AbortSignal,
  detachOnAbort = false,
): Promise<LspNodeLocationRead> {
  return (await client.read('lspNodeLocation', { id: nodeId }, signal, detachOnAbort)) as LspNodeLocationRead;
}

/** Deterministically ranked and daemon-capped graph symbols. */
export async function readLspWorkspaceSymbols(
  client: DaemonReadClient,
  query: string,
  signal?: AbortSignal,
  detachOnAbort = false,
): Promise<LspWorkspaceSymbolsRead> {
  return (await client.read('lspWorkspaceSymbols', { query }, signal, detachOnAbort)) as LspWorkspaceSymbolsRead;
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

  // The serve process owns this connection directly. Its launcher/parent may
  // exit while the server remains healthy, so only advertise our durable pid.
  const connect = opts.connect ?? ((
    socketPath: string,
    attachSignal?: AbortSignal,
    expectedIdentity?: DaemonLockInfo,
  ) =>
    connectWithHello(socketPath, CodeGraphPackageVersion, {
      hostPid: null,
      signal: attachSignal,
      expectedIdentity,
    }));
  const diagnosticSink = opts.diagnostics ?? defaultDaemonDiagnostics;
  const diagnostics = (code: DaemonAttachDiagnosticCode): void => reportDiagnostic(diagnosticSink, code);
  const spawnDaemon = opts.spawnDaemon ?? defaultSpawnDaemon;
  const maxRetries = opts.connectMaxRetries ?? DEFAULT_CONNECT_MAX_RETRIES;
  const retryDelayMs = opts.connectRetryDelayMs ?? DEFAULT_CONNECT_RETRY_DELAY_MS;
  const initializeTimeoutMs = opts.initializeTimeoutMs ?? INITIALIZE_TIMEOUT_MS;
  const signal = opts.signal;
  const candidates = getDaemonSocketCandidates(indexedRoot);
  const targets = opts.connect
    ? () => candidates.map((socketPath) => ({ socketPath }))
    : () => {
        const expectedIdentity = readTrustedDaemonLock(indexedRoot);
        return expectedIdentity
          ? [{ socketPath: expectedIdentity.socketPath, expectedIdentity }]
          : [];
      };
  const attachDeadline = Date.now() + ATTACH_BUDGET_MS;
  throwIfAttachAborted(signal);

  // Fast path: a daemon may already be listening.
  const probe = await connectAnyCandidate(targets, connect, attachDeadline, signal);
  if (probe === 'version-mismatch') {
    // A wrong-version daemon holds the socket; spawning can't help. Transient —
    // the user can restart the daemon — so surface it as an attach failure.
    throw new DaemonUnavailableError('daemon version mismatch');
  }
  if (probe) return makeReadClient(probe, indexedRoot, initializeTimeoutMs, signal);
  if (Date.now() >= attachDeadline) throw attachDeadlineExceeded();

  // None reachable — spawn one (detached) and poll for its bind, bounded by BOTH
  // the attempt count and an overall wall-clock deadline (FR-015a): a daemon that
  // never binds fails fast to a 503 instead of stalling for minutes.
  throwIfAttachAborted(signal);
  spawnDaemon(indexedRoot, diagnostics);
  for (
    let attempt = 0;
    attempt < maxRetries && Date.now() < attachDeadline;
    attempt++
  ) {
    await abortableDelay(Math.min(retryDelayMs, Math.max(0, attachDeadline - Date.now())), signal);
    const s = await connectAnyCandidate(targets, connect, attachDeadline, signal);
    if (s === 'version-mismatch') throw new DaemonUnavailableError('daemon version mismatch');
    if (s) return makeReadClient(s, indexedRoot, initializeTimeoutMs, signal);
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
 * 16-hex repo id — the SHA-256 prefix of the resolved root, identical to the
 * daemon registry's own record key (`recordPath`, src/mcp/daemon-registry.ts) by
 * construction, so an API id equals a registry key without a second hashing
 * scheme (FR-010). Exported as the SINGLE source of this hashing so src/server/
 * index.ts imports it rather than keeping a byte-for-byte twin (whose equality
 * FR-010 relies on).
 */
export function repoIdForRoot(root: string): string {
  return crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
}

/**
 * List the indexed projects for `GET /api/repos` (FR-009/010): the startup
 * (default) repo ALWAYS first and marked `default:true`, then every OTHER live,
 * registered daemon from the global registry marked `default:false`. Deduped by
 * id so the default repo is never listed twice (its own daemon is typically
 * registered too), leaving exactly one `default:true` by construction.
 *
 * Only live daemons appear — `listDaemons` prunes dead-pid records, so a
 * freshly-indexed project with no running daemon is invisible until it is served
 * (the same liveness gate that decides whether a `?repo` id resolves, FR-010a).
 * Synchronous: the registry is read off disk, with no daemon round-trip.
 */
export function listRepos(defaultRepo: { id: string; root: string; name: string }): Repo[] {
  const repos: Repo[] = [
    { id: defaultRepo.id, root: defaultRepo.root, name: defaultRepo.name, default: true },
  ];
  const seen = new Set<string>([defaultRepo.id]);
  for (const rec of listDaemons({ prune: true })) {
    const id = repoIdForRoot(rec.root);
    if (seen.has(id)) continue;
    seen.add(id);
    repos.push({ id, root: rec.root, name: path.basename(rec.root), default: false });
  }
  return repos;
}
