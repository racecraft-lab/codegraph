/**
 * SPEC-005 request router — method+path matching and dispatch (FR-004a/FR-018/FR-015a).
 *
 * Matches a request `(method, rawPath)` against the registered route table,
 * extracting `:id`/`:repo` path params through a SINGLE decode chokepoint: the
 * raw path is split on literal `/` FIRST, then exactly one `decodeURIComponent`
 * is applied to each matched param segment — the whole path is never decoded
 * (FR-004a). Unknown `/api/*` paths and unsupported methods on a known path are
 * route misses → 404 `not_found` (`details.resource: "route"`); there is no 405
 * (FR-018). Every handler runs inside a top-level catch so an unanticipated
 * throw becomes the `internal` 500 envelope, never a raw crash (FR-015a).
 *
 * @module server/routes
 */

import { notFound, internalError, apiError, unauthorized, type ApiError } from './errors';
import { isValidBearer, type BindSecurity } from './auth';
import { JobConflictError, type JobMode, type JobRegistry } from './jobs';
import { streamJobToResponse, type SseResponse, type SseRequest } from './sse';
import {
  daemonUnavailable,
  listRepos,
  readStatusHealth,
  readNode,
  readSearch,
  readCallers,
  readCallees,
  readImpact,
  readNeighborhood,
  readFlows,
  readFlow,
  readClusters,
  type DaemonReadClient,
} from './daemon-client';

/** Decoded path params keyed by pattern name (`:id` → `params.id`). */
export type RouteParams = Record<string, string>;

/**
 * What a route handler returns, and what dispatch resolves to. `ApiError`
 * (from `./errors`) is assignable to this, so a handler may return an error
 * descriptor directly.
 */
export interface HandlerResult {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
  /**
   * SPEC-005 Slice-2 SSE (FR-023): the handler has taken over the raw response
   * and is streaming it directly (headers + frames already written). When set,
   * the dispatcher MUST NOT serialize `body` over the socket — doing so would
   * `writeHead` twice. Only the SSE events handler sets this.
   */
  hijacked?: boolean;
}

/**
 * Per-request context handed to a matched handler. `rawPath` is the raw,
 * undecoded path (query already stripped); `params` is filled by the matcher.
 */
export interface RouteContext {
  method: string;
  rawPath: string;
  params: RouteParams;
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  /**
   * The raw `node:http` response — present only for the SSE endpoint (FR-023),
   * which streams frames directly rather than returning a JSON body. Every other
   * handler ignores it and returns a normal {@link HandlerResult}.
   */
  res?: SseResponse;
  /** The raw request — the SSE handler subscribes to its `close` (client disconnect). */
  req?: SseRequest;
  /**
   * LOCAL server-side diagnostic sink (F1). A contained fault becomes the generic
   * `internal`/`unavailable` envelope on the wire (FR-015/015a) — which hides the
   * cause from the operator too. When set, the dispatch/handlers log the caught
   * exception (message + stack) here so an operator can diagnose it. Fed ONLY the
   * exception, never request headers, so it can never carry a token (FR-014a).
   * Silent unless `startWebServer` wires it (default `console.error` in CLI mode).
   */
  logDiagnostic?(message: string): void;
}

/** A registered route: an HTTP method, a path pattern, and its handler. */
export interface Route {
  method: string;
  /** e.g. `/api/node/:id` or `/api/reindex/:repo/events`. */
  pattern: string;
  handler: RouteHandler;
}

export type RouteHandler = (ctx: RouteContext) => HandlerResult | Promise<HandlerResult>;

/** Result of matching a request against the route table. */
export type MatchResult =
  | { matched: true; route: Route; params: RouteParams }
  | { matched: false };

/** Is this path inside the `/api` namespace (miss → 404, vs. static fallback)? */
export function isApiPath(rawPath: string): boolean {
  return rawPath === '/api' || rawPath.startsWith('/api/');
}

/**
 * Match `(method, rawPath)` against the route table.
 *
 * The raw path is split on literal `/` FIRST — the whole path is never decoded
 * (FR-004a) — so an encoded separator (`%2F`) stays inside one segment while an
 * unencoded `/` fragments into several. Each matched `:param` segment is then
 * decoded with EXACTLY ONE `decodeURIComponent` at this single call site; a
 * malformed encoding (which would throw) falls back to the raw segment so the
 * handler resolves it as an opaque key and returns 404 rather than crashing.
 * A method mismatch simply fails to match (no 405 — FR-018).
 */
export function matchRoute(routes: readonly Route[], method: string, rawPath: string): MatchResult {
  const rawSegments = rawPath.split('/');

  for (const route of routes) {
    if (route.method !== method) continue;

    const patternSegments = route.pattern.split('/');
    if (patternSegments.length !== rawSegments.length) continue;

    const params: RouteParams = {};
    let matched = true;

    for (let i = 0; i < patternSegments.length; i++) {
      const patternSeg = patternSegments[i];
      const rawSeg = rawSegments[i];
      if (patternSeg === undefined || rawSeg === undefined) {
        matched = false;
        break;
      }

      if (patternSeg.startsWith(':')) {
        // The SINGLE decode site (FR-004a) — exactly one decodeURIComponent.
        let value: string;
        try {
          value = decodeURIComponent(rawSeg);
        } catch {
          // Malformed percent-encoding: keep the raw segment so the handler
          // treats it as an unknown opaque key (→ 404), never a crash.
          value = rawSeg;
        }
        params[patternSeg.slice(1)] = value;
      } else if (patternSeg !== rawSeg) {
        matched = false;
        break;
      }
    }

    if (matched) return { matched: true, route, params };
  }

  return { matched: false };
}

/** Collapse a possibly-multivalued header to its first value. */
function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Dispatch an `/api/*` request: match → run the handler inside a top-level
 * catch (FR-015a); miss → 404 `not_found` route (FR-018). Returns `null` for a
 * non-`/api` path so the caller can fall through to the static mount — the
 * public shell + `/` placeholder sit OUTSIDE the auth boundary (FR-014/FR-017a).
 *
 * On a token-bound (non-loopback) bind, `security.requireToken` is set and EVERY
 * `/api/*` request — matched or not, including the future SSE endpoint — must
 * carry a valid Bearer before routing (FR-014). Rejection is the generic,
 * identical 401 (`unauthorized()`), so an unauthenticated probe can neither
 * enumerate routes nor learn anything about the token. A loopback bind leaves
 * `requireToken` false, so this is a no-op there (SC-002).
 *
 * The whole match-and-run body is wrapped so any unanticipated throw — sync or
 * an awaited async rejection — becomes the generic `internal` 500 envelope,
 * which leaks no exception text, path, or stack (FR-015a).
 */
export async function handleApiRequest(
  routes: readonly Route[],
  ctx: RouteContext,
  security?: BindSecurity
): Promise<HandlerResult | null> {
  if (!isApiPath(ctx.rawPath)) return null;

  if (security?.requireToken &&
      !isValidBearer(headerValue(ctx.headers.authorization), security.token ?? '')) {
    return unauthorized();
  }

  try {
    const match = matchRoute(routes, ctx.method, ctx.rawPath);
    if (!match.matched) return notFound('route');
    ctx.params = match.params;
    return await match.route.handler(ctx);
  } catch (err) {
    // FR-015a: the client gets the generic 500 envelope (no fault detail). Log the
    // underlying exception LOCALLY so the operator can diagnose it (F1); the sink
    // only receives the exception, never the request headers/token.
    safeDiagnostic(ctx.logDiagnostic, diagnosticLine('request handler', err));
    return internalError();
  }
}

/**
 * Format a caught exception for the LOCAL diagnostic sink (F1): message + stack
 * only. Never touches request headers, so it can never carry a token (FR-014a) —
 * the counterpart to the whitelisted wire envelope (FR-015a).
 */
function diagnosticLine(where: string, err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  return `[codegraph:web] ${where}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`;
}

/** Invoke a diagnostic sink defensively — a throwing sink must never change the wire outcome. */
function safeDiagnostic(sink: ((message: string) => void) | undefined, message: string): void {
  try { sink?.(message); } catch { /* a diagnostic sink must never affect the response */ }
}

// ===========================================================================
// SPEC-005 Slice-1 read handlers (T014–T018) — GET status/search/node/callers/
// callees/impact/graph. Each forwards to the per-repo daemon via the typed
// `codegraph/read` wrappers (daemon-client.ts) and maps the result to the wire
// shape (openapi.yaml). Paging clamps over-cap `limit`/`depth` (never errors)
// but 400s a malformed/negative value (FR-006/007/015a); an unknown node id →
// 404 `resource: node`, an unknown/malformed `?repo` → 404 `resource: repo`
// (FR-004a/010a/011); a daemon attach failure → 503 `unavailable` (FR-015a).
// ===========================================================================

/** A repo the read API can serve (data-model "Repo", minus the `default` flag). */
export interface RepoInfo {
  id: string;
  root: string;
  name: string;
}

/** Collaborators the read handlers need, wired by `startWebServer` (index.ts). */
export interface ReadApiDeps {
  /** Server/API version reported by `/api/status` (FR-016 — no URL prefix). */
  version: string;
  /** The startup (default) repo, used by `/api/status` and by an omitted `?repo`. */
  defaultRepo: RepoInfo;
  /**
   * Resolve `?repo=` to a repo: `undefined`/absent → the default repo; a
   * registered 16-hex id → that repo; malformed or unregistered → `null` (→ 404
   * `resource: repo`, FR-010a/011).
   */
  resolveRepo(repoId: string | undefined): RepoInfo | null;
  /** Lazily attach (cached) a daemon read client; throws → 503 (FR-002/015a). */
  getClient(repo: RepoInfo): Promise<DaemonReadClient>;
  /**
   * Drop a repo's pooled client after ITS socket died mid-session, so the next
   * request re-attaches instead of reusing the dead client forever. Identity-scoped:
   * the exact failed `client` is passed so a concurrent failure that already replaced
   * it with a healthy client does not get that replacement evicted (FR-002/015a).
   */
  evictClient(repo: RepoInfo, client: DaemonReadClient): void;
  /** Whether `root` has a reachable `.codegraph/` (un-indexed status, FR-005). */
  isRepoIndexed(root: string): boolean;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_DEPTH = 3;
const SEARCH_MODES = new Set(['keyword', 'semantic', 'hybrid', 'auto']);

function invalidParam(param: string): ApiError {
  return apiError('invalid_request', { message: `Invalid ${param}`, details: { param } });
}

/**
 * Parse a bounded integer query param. Absent/empty → `def`; a non-integer or a
 * value below `min` (negative) → 400; a value above `max` **clamps** to `max`
 * (over-cap clamps, not errors — FR-006/007/015a).
 */
function parseBoundedInt(
  raw: string | null,
  def: number,
  min: number,
  max: number,
  param: string,
): number | ApiError {
  if (raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) return invalidParam(param);
  return n > max ? max : n;
}

/** `limit` (default 100 / clamp 500) + `offset` (≥ 0); malformed/negative → 400. */
function parsePaging(q: URLSearchParams): { limit: number; offset: number } | ApiError {
  const limit = parseBoundedInt(q.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT, 'limit');
  if (typeof limit !== 'number') return limit;
  const offset = parseBoundedInt(q.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
  if (typeof offset !== 'number') return offset;
  return { limit, offset };
}

/**
 * Coerce a SPEC-011 catalog numeric query param (FR-028/029/030): a finite value is
 * floored then clamped to [min,max]; missing/empty/non-numeric → `def`. Floor +
 * clamp, **never a 4xx** — the catalog paging/`minSize` params degrade to the
 * default instead of erroring, unlike the SPEC-005 `parseBoundedInt` (which 400s).
 * Mirrors the daemon read-ops boundary coercion so the REST and `codegraph/read`
 * surfaces agree (cross-surface parity, FR-028a).
 */
function coerceCatalogInt(raw: string | null, def: number, min: number, max: number): number {
  if (raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * SPEC-011 catalog paging (FR-030): `limit` (default 100, clamp 1–500) + `offset`
 * (default 0, ≥ 0), coerced — a malformed/negative page param floors + clamps to a
 * valid value, never a 4xx (unlike SPEC-005 `parsePaging`). The catalog surfaces are
 * success-shaped: a bad page param degrades to the default, it does not fail the
 * request. This shares the MCP tool's coercion *semantics* (`coerceCatalogInt`+
 * `clamp`: floor + clamp, missing/non-numeric → default, never error); the bound
 * VALUES stay per-surface (MCP default 20 / cap 100, REST default 100 / cap 500).
 */
function parseCatalogPaging(q: URLSearchParams): { limit: number; offset: number } {
  return {
    limit: coerceCatalogInt(q.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: coerceCatalogInt(q.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

/**
 * The SPEC-011 `minSize` cluster filter (FR-029): default 1, values < 1 clamp to 1,
 * coerced never a 4xx — the same catalog coercion as the paging params.
 */
function parseMinSize(q: URLSearchParams): number {
  return coerceCatalogInt(q.get('minSize'), 1, 1, Number.MAX_SAFE_INTEGER);
}

/** `depth` with a per-endpoint default, clamped to max 3; malformed/negative → 400. */
function parseDepth(q: URLSearchParams, def: number): number | ApiError {
  return parseBoundedInt(q.get('depth'), def, 1, MAX_DEPTH, 'depth');
}

/**
 * Resolve `?repo` → attach its daemon client → run `fn`. A malformed/unregistered
 * repo → 404 `resource: repo`; a daemon attach failure → 503 `unavailable`.
 */
async function withClient(
  deps: ReadApiDeps,
  ctx: RouteContext,
  fn: (client: DaemonReadClient) => Promise<HandlerResult>,
): Promise<HandlerResult> {
  const repo = deps.resolveRepo(ctx.query.get('repo') ?? undefined);
  if (!repo) return notFound('repo');
  let client: DaemonReadClient;
  try {
    client = await deps.getClient(repo);
  } catch (err) {
    // The client sees a generic transient 503 (FR-015a); log WHY locally so the
    // operator can tell a version-mismatch / never-bound / spawn failure apart
    // (the DaemonUnavailableError message distinguishes them) (F1).
    safeDiagnostic(ctx.logDiagnostic, diagnosticLine('daemon attach failed', err));
    return daemonUnavailable(err);
  }
  try {
    return await fn(client);
  } catch (err) {
    // The attach succeeded but the pooled socket died mid-session (the daemon
    // exited or was restarted): the read rejects HERE, not at getClient. A
    // recoverable query condition (not-found, empty) is a returned HandlerResult,
    // never a throw — so a throw means the daemon round-trip itself failed. Evict
    // the dead client so the next request re-attaches, and surface a transient 503
    // rather than a 500 that would recur forever against the same dead client
    // (FR-002/015a).
    deps.evictClient(repo, client);
    return daemonUnavailable(err);
  }
}

/** GET /api/status (T014, FR-005/016) — not repo-scoped; reports the default repo. */
function statusHandler(deps: ReadApiDeps): RouteHandler {
  return async (ctx): Promise<HandlerResult> => {
    const repo = deps.defaultRepo;
    let client: DaemonReadClient;
    try {
      client = await deps.getClient(repo);
    } catch (err) {
      // A missing startup index MUST NOT refuse startup or 503 — report the
      // un-indexed state through `index.state` so a client detects it (FR-005/016).
      if (!deps.isRepoIndexed(repo.root)) {
        return {
          status: 200,
          body: {
            version: deps.version,
            repo,
            index: { state: 'unindexed', fileCount: 0, nodeCount: 0, edgeCount: 0, lastIndexed: null },
            hybridSearch: { available: false, reason: 'not indexed' },
            lsp: { available: false },
          },
        };
      }
      // Indexed but the daemon could not be attached → transient 503; log why (F1).
      safeDiagnostic(ctx.logDiagnostic, diagnosticLine('daemon attach failed (status)', err));
      return daemonUnavailable(err);
    }
    try {
      const health = await readStatusHealth(client);
      return { status: 200, body: { version: deps.version, repo, ...health } };
    } catch (err) {
      // Attach succeeded but the daemon died mid-session, so the health read rejects
      // HERE (statusHandler has its own attach path — it does not go through
      // withClient). Evict the dead client so the next status re-attaches, and return
      // a transient 503 rather than a 500 that recurs against the same dead client
      // (FR-002/015a). The repo is indexed (attach succeeded), so this is NOT the
      // un-indexed 200 path above.
      deps.evictClient(repo, client);
      return daemonUnavailable(err);
    }
  };
}

/**
 * GET /api/repos (T027, FR-009/010) — the indexed projects from the daemon
 * registry, startup repo `default:true`. NOT repo-scoped: a stray `?repo` is
 * ignored (returns the full list), never 400 — the shipped contract documents
 * no `repo` param and no 400 here, and rejecting would emit an undocumented
 * status (FR-010a/025).
 */
function reposHandler(deps: ReadApiDeps): RouteHandler {
  return () => ({ status: 200, body: listRepos(deps.defaultRepo) });
}

/** GET /api/search (T015, FR-006/006a). */
function searchHandler(deps: ReadApiDeps): RouteHandler {
  return (ctx) => {
    // Validate params BEFORE acquiring the daemon client so a malformed request
    // 400s without a (failure-prone) attach — never a 503 for an absent/invalid q.
    const q = ctx.query.get('q');
    if (!q) {
      return apiError('invalid_request', {
        message: 'Missing required query parameter: q',
        details: { param: 'q' },
      });
    }
    // Supplied-but-invalid mode → 400 (diverges from MCP/CLI coercion, FR-006a).
    const rawMode = ctx.query.get('mode');
    if (rawMode !== null && !SEARCH_MODES.has(rawMode)) return invalidParam('mode');
    const paging = parsePaging(ctx.query);
    if ('status' in paging) return paging;
    return withClient(deps, ctx, async (client) => {
      const result = await readSearch(client, {
        query: q,
        limit: paging.limit,
        offset: paging.offset,
        mode: rawMode ?? 'auto', // default to auto ONLY when omitted (FR-006a)
      });
      return { status: 200, body: result };
    });
  };
}

/** GET /api/node/:id (T017, FR-004/004a) — own fields only, bounded. */
function nodeHandler(deps: ReadApiDeps): RouteHandler {
  return (ctx) =>
    withClient(deps, ctx, async (client) => {
      const node = await readNode(client, ctx.params.id ?? '');
      if (!node) return notFound('node');
      return { status: 200, body: node };
    });
}

/** GET /api/callers|callees/:id (T016, FR-004/006). */
function relationHandler(deps: ReadApiDeps, which: 'callers' | 'callees'): RouteHandler {
  return (ctx) => {
    // Paging validated before the daemon attach (a malformed limit/offset 400s
    // without a client acquisition, never a 503).
    const paging = parsePaging(ctx.query);
    if ('status' in paging) return paging;
    return withClient(deps, ctx, async (client) => {
      const fetch = which === 'callers' ? readCallers : readCallees;
      const result = await fetch(client, ctx.params.id ?? '', paging.limit, paging.offset);
      if (!result) return notFound('node');
      return { status: 200, body: result };
    });
  };
}

/**
 * GET /api/flows (SPEC-011 T025, FR-028/030) — the paged execution-flow catalog.
 * A thin daemon-forwarding handler (the serve process holds no DB connection);
 * the same catalog-store read runs in the daemon (FR-021a). Limit (default 100 /
 * max 500) / Offset are COERCED (floor + clamp, never a 4xx — FR-030), matching
 * the MCP tool, not the SPEC-005 `parsePaging` 400.
 */
function flowsListHandler(deps: ReadApiDeps): RouteHandler {
  return (ctx) => {
    const paging = parseCatalogPaging(ctx.query);
    return withClient(deps, ctx, async (client) => {
      const result = await readFlows(client, paging.limit, paging.offset);
      return { status: 200, body: result };
    });
  };
}

/**
 * GET /api/flows/:id (SPEC-011 T025, FR-028/030) — one flow's bounded graph. An
 * unknown flow id returns a success-shaped 200 (NOT 404) to keep this surface's
 * condition-handling identical to the MCP contract (the intentional divergence).
 */
function flowDetailHandler(deps: ReadApiDeps): RouteHandler {
  return (ctx) =>
    withClient(deps, ctx, async (client) => {
      const r = await readFlow(client, ctx.params.id ?? '');
      if (r.found) return { status: 200, body: r.flow };
      const live = r.state === 'available' || r.state === 'stale' || r.state === 'empty';
      const message = live ? 'unknown flow id' : `flows catalog ${r.state}`;
      return { status: 200, body: { found: false, state: r.state, message } };
    });
}

/**
 * GET /api/clusters (SPEC-011 T037, FR-028/029) — the paged functional-cluster
 * catalog. A thin daemon-forwarding handler (the serve process holds no DB
 * connection); the same catalog-store read runs in the daemon (FR-021a). Limit
 * (default 100 / max 500) / Offset and the `minSize` filter (default 1, `<1`→1)
 * are all COERCED (floor + clamp, never a 4xx — FR-030), matching the MCP tool.
 */
function clustersListHandler(deps: ReadApiDeps): RouteHandler {
  return (ctx) => {
    const paging = parseCatalogPaging(ctx.query);
    const minSize = parseMinSize(ctx.query);
    return withClient(deps, ctx, async (client) => {
      const result = await readClusters(client, minSize, paging.limit, paging.offset);
      return { status: 200, body: result };
    });
  };
}

/** GET /api/impact|graph/:id (T018, FR-004/007) — shared subgraph, divergent depth. */
function subgraphHandler(deps: ReadApiDeps, which: 'impact' | 'graph'): RouteHandler {
  return (ctx) => {
    // Depth validated before the daemon attach (a malformed/negative depth 400s
    // without a client acquisition, never a 503). Impact's own natural default is
    // 3; graph-neighborhood's is 1 (FR-004/007).
    const depth = parseDepth(ctx.query, which === 'impact' ? 3 : 1);
    if (typeof depth !== 'number') return depth;
    return withClient(deps, ctx, async (client) => {
      const fetch = which === 'impact' ? readImpact : readNeighborhood;
      const result = await fetch(client, ctx.params.id ?? '', depth);
      if (!result) return notFound('node');
      return { status: 200, body: result };
    });
  };
}

/**
 * Build the Slice-1 read route table (T014–T018). Registered by `startWebServer`
 * so the handlers close over the daemon-client pool and repo resolver.
 */
export function buildReadRoutes(deps: ReadApiDeps): Route[] {
  return [
    { method: 'GET', pattern: '/api/status', handler: statusHandler(deps) },
    { method: 'GET', pattern: '/api/repos', handler: reposHandler(deps) },
    { method: 'GET', pattern: '/api/search', handler: searchHandler(deps) },
    { method: 'GET', pattern: '/api/node/:id', handler: nodeHandler(deps) },
    { method: 'GET', pattern: '/api/callers/:id', handler: relationHandler(deps, 'callers') },
    { method: 'GET', pattern: '/api/callees/:id', handler: relationHandler(deps, 'callees') },
    { method: 'GET', pattern: '/api/impact/:id', handler: subgraphHandler(deps, 'impact') },
    { method: 'GET', pattern: '/api/graph/:id', handler: subgraphHandler(deps, 'graph') },
    { method: 'GET', pattern: '/api/flows', handler: flowsListHandler(deps) },
    { method: 'GET', pattern: '/api/flows/:id', handler: flowDetailHandler(deps) },
    { method: 'GET', pattern: '/api/clusters', handler: clustersListHandler(deps) },
  ];
}

// ===========================================================================
// SPEC-005 Slice-2 job routes (T038) — POST/GET /api/reindex/:repo and the SSE
// stream GET /api/reindex/:repo/events. Kept in a SEPARATE builder from
// buildReadRoutes so the OpenAPI contract walk's per-builder bijection stays
// green: buildReadRoutes maps to the 8 read paths, buildJobRoutes to the 2
// reindex path templates. The shipped openapi.yaml now documents BOTH surfaces
// (the contract walk asserts read + jobs).
//
// The `:repo` is a PATH param resolved against the daemon registry (FR-020);
// an unregistered repo, or a registered repo with no job on record, → 404
// `resource: repo` (FR-024, deliberately indistinguishable). A duplicate active
// job → 409 `conflict` (FR-022). Lock contention is NOT here — it is a terminal
// job `error`/`lock_unavailable` (FR-021a), and the POST still returns 202.
// ===========================================================================

/** Collaborators the job routes need, wired by `startWebServer` (index.ts). */
export interface JobApiDeps {
  /**
   * Resolve the `:repo` PATH segment to a registered repo, or `null` when it is
   * malformed / unregistered (→ 404 `resource: repo`, FR-020/011). Same resolver
   * the read handlers use for `?repo`.
   */
  resolveRepo(repoId: string | undefined): RepoInfo | null;
  /**
   * Whether `root` already has an index (`.codegraph/`). A re-index job RECOVERS an
   * existing index; it never initializes a new project (FR-020, Constitution VII
   * dormancy). `resolveRepo` returns the startup repo even when its directory has no
   * index, so the POST path must gate on this to 404 rather than start a doomed job.
   */
  isRepoIndexed(root: string): boolean;
  /** The in-memory latest-job-per-repo registry (jobs.ts). */
  registry: JobRegistry;
}

/** POST /api/reindex/:repo (T038, FR-020/021a/022) — URL-only; 202 + descriptor. */
function reindexPostHandler(deps: JobApiDeps): RouteHandler {
  return (ctx) => {
    // An EMPTY path segment (`/api/reindex/`) matches `:repo` = '' but is a MISSING
    // required id, not the default repo — reject before resolveRepo (which treats
    // '' as the default `?repo`). 404 `resource: repo` (FR-020/024).
    if (!ctx.params.repo) return notFound('repo');
    const repo = deps.resolveRepo(ctx.params.repo);
    if (!repo) return notFound('repo');
    // resolveRepo returns the startup repo for its own id even when that directory
    // has NO index — but re-index recovers an existing index, it never initializes a
    // new project (FR-020, Constitution VII). An un-indexed target is 404 `repo` here,
    // not a 202 that spawns a job doomed to terminal `index_failed`.
    if (!deps.isRepoIndexed(repo.root)) return notFound('repo');
    // URL-only: mode from `?full=true`; NO request body is read (FR-020, Edge Cases).
    const mode: JobMode = ctx.query.get('full') === 'true' ? 'full' : 'sync';
    try {
      const descriptor = deps.registry.start({ id: repo.id, root: repo.root }, mode);
      return { status: 202, body: descriptor };
    } catch (err) {
      // A duplicate active job in THIS server's registry → 409 (FR-022). Every
      // other throw propagates to the router's top-level catch → 500 (FR-015a).
      if (err instanceof JobConflictError) return apiError('conflict');
      throw err;
    }
  };
}

/** GET /api/reindex/:repo (T038, FR-024) — latest job state; no job → 404 repo. */
function reindexGetHandler(deps: JobApiDeps): RouteHandler {
  return (ctx) => {
    // An EMPTY path segment is a missing required id, not the default repo (FR-024).
    if (!ctx.params.repo) return notFound('repo');
    const repo = deps.resolveRepo(ctx.params.repo);
    if (!repo) return notFound('repo');
    const latest = deps.registry.latest(repo.id);
    // Registered-but-no-job is deliberately indistinguishable from unregistered
    // (FR-024): both are 404 `resource: repo`, no separate "job" discriminator.
    if (!latest) return notFound('repo');
    return { status: 200, body: latest };
  };
}

/** GET /api/reindex/:repo/events (T038, FR-023) — the SSE stream (hijacks `res`). */
function reindexEventsHandler(deps: JobApiDeps): RouteHandler {
  return (ctx) => {
    // An EMPTY path segment (`/api/reindex//events`) is a missing required id, not
    // the default repo — reject before resolveRepo (FR-024).
    if (!ctx.params.repo) return notFound('repo');
    const repo = deps.resolveRepo(ctx.params.repo);
    if (!repo) return notFound('repo');
    const job = deps.registry.get(repo.id);
    if (!job) return notFound('repo'); // no job on record → 404 repo (FR-024)
    if (!ctx.res) return internalError(); // defensive — SSE requires the raw response
    // Hand the raw response to the SSE writer; it owns the socket from here
    // (headers + snapshot + progress + terminal + heartbeat). `hijacked` tells
    // the dispatcher NOT to serialize a JSON body over the same response.
    try {
      streamJobToResponse(ctx.res as SseResponse, ctx.req as SseRequest | undefined, job);
    } catch (err) {
      safeDiagnostic(ctx.logDiagnostic, diagnosticLine('SSE stream failed', err));
      // If headers never went out (e.g. `writeHead` ITSELF threw), the response is
      // still pristine — return the normal JSON 500 envelope. Only once ownership
      // actually transferred (headers sent) must we end + hijack instead, because a
      // second writeHead would throw ERR_HTTP_HEADERS_SENT → uncaught rejection (F3).
      if (!(ctx.res as { headersSent?: boolean }).headersSent) return internalError();
      try { (ctx.res as SseResponse).end(); } catch { /* already ended / gone */ }
      return { status: 200, body: undefined, hijacked: true };
    }
    return { status: 200, body: undefined, hijacked: true };
  };
}

/**
 * Build the Slice-2 job route table (T038). Registered by `startWebServer`
 * alongside — but separate from — the read routes, so the read-slice contract
 * walk's bijection over `buildReadRoutes` is unaffected.
 */
export function buildJobRoutes(deps: JobApiDeps): Route[] {
  return [
    { method: 'POST', pattern: '/api/reindex/:repo', handler: reindexPostHandler(deps) },
    { method: 'GET', pattern: '/api/reindex/:repo', handler: reindexGetHandler(deps) },
    { method: 'GET', pattern: '/api/reindex/:repo/events', handler: reindexEventsHandler(deps) },
  ];
}
