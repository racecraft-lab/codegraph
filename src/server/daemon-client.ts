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
import { getDaemonSocketCandidates } from '../mcp/daemon-paths';
import { listDaemons } from '../mcp/daemon-registry';
import { SocketTransport } from '../mcp/transport';
import { findNearestCodeGraphRoot, getCodeGraphDir } from '../directory';
import { HOST_PPID_ENV } from '../extraction/wasm-runtime-flags';
import { unavailable, DEFAULT_RETRY_AFTER_SECONDS, type ApiError } from './errors';
import type {
  LspFileContextRead,
  LspIncomingRead,
  ReadOp,
} from '../mcp/read-ops';
import type { Node } from '../types';
import type { ClusterListResult, FlowDetailRead, FlowListResult } from '../analysis';

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
  read(op: ReadOp, params?: Record<string, unknown>): Promise<unknown>;
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
    // Owner-only mode + refuse-symlink open: `root` can point anywhere the
    // registry knows (e.g. a repo under the OS temp dir), where a pre-planted
    // daemon.log symlink or a group-readable log would leak daemon output
    // (CodeQL js/insecure-temporary-file). O_NOFOLLOW is absent on Windows —
    // there the owner-only mode alone applies.
    logFd = fs.openSync(
      path.join(getCodeGraphDir(root), 'daemon.log'),
      fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    );
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
    child.on('error', (err) => {
      try { process.stderr.write(`[codegraph:web] daemon spawn failed: ${err.message}\n`); } catch { /* ignore */ }
    });
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
  const rootUri = pathToFileURL(root).href;
  transport.start(async (msg) => {
    // The daemon session may ask us for workspace roots; answer with the root so
    // it never waits out its 5s roots/list timeout. Everything else is ignored.
    const m = msg as { method?: string; id?: string | number };
    if (m.method === 'roots/list' && m.id !== undefined) {
      transport.sendResult(m.id, { roots: [{ uri: rootUri, name: path.basename(root) }] });
    }
  });

  try {
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
    async read(op, params) {
      return transport.request(
        'codegraph/read',
        { op, params: params ?? {} },
        TOOL_CALL_TIMEOUT_MS,
      );
    },
    close() {
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

/** Exact indexed source, nodes, and located semantic occurrences for one file. */
export async function readLspFileContext(
  client: DaemonReadClient,
  filePath: string,
): Promise<LspFileContextRead> {
  return (await client.read('lspFileContext', { filePath })) as LspFileContextRead;
}

/** Exact located incoming occurrences for one stable graph target. */
export async function readLspIncoming(
  client: DaemonReadClient,
  nodeId: string,
): Promise<LspIncomingRead> {
  return (await client.read('lspIncoming', { id: nodeId })) as LspIncomingRead;
}

/** Deterministically ranked graph symbols; the facade owns final ordering/cap. */
export async function readLspWorkspaceSymbols(
  client: DaemonReadClient,
  query: string,
): Promise<Node[]> {
  return (await client.read('lspWorkspaceSymbols', { query })) as Node[];
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

  // None reachable — spawn one (detached) and poll for its bind, bounded by BOTH
  // the attempt count and an overall wall-clock deadline (FR-015a): a daemon that
  // never binds fails fast to a 503 instead of stalling for minutes.
  spawnDaemon(indexedRoot);
  const attachStart = Date.now();
  for (
    let attempt = 0;
    attempt < maxRetries && Date.now() - attachStart < ATTACH_BUDGET_MS;
    attempt++
  ) {
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
