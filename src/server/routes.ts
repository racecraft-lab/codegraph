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

import { notFound, internalError, apiError, type ApiError } from './errors';
import {
  daemonUnavailable,
  readStatusHealth,
  readNode,
  readSearch,
  readCallers,
  readCallees,
  readImpact,
  readNeighborhood,
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

/**
 * Dispatch an `/api/*` request: match → run the handler inside a top-level
 * catch (FR-015a); miss → 404 `not_found` route (FR-018). Returns `null` for a
 * non-`/api` path so the caller can fall through to the static mount.
 *
 * The whole match-and-run body is wrapped so any unanticipated throw — sync or
 * an awaited async rejection — becomes the generic `internal` 500 envelope,
 * which leaks no exception text, path, or stack (FR-015a).
 */
export async function handleApiRequest(
  routes: readonly Route[],
  ctx: RouteContext
): Promise<HandlerResult | null> {
  if (!isApiPath(ctx.rawPath)) return null;

  try {
    const match = matchRoute(routes, ctx.method, ctx.rawPath);
    if (!match.matched) return notFound('route');
    ctx.params = match.params;
    return await match.route.handler(ctx);
  } catch {
    return internalError();
  }
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
    return daemonUnavailable(err);
  }
  return fn(client);
}

/** GET /api/status (T014, FR-005/016) — not repo-scoped; reports the default repo. */
function statusHandler(deps: ReadApiDeps): RouteHandler {
  return async (): Promise<HandlerResult> => {
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
      return daemonUnavailable(err);
    }
    const health = await readStatusHealth(client);
    return { status: 200, body: { version: deps.version, repo, ...health } };
  };
}

/** GET /api/search (T015, FR-006/006a). */
function searchHandler(deps: ReadApiDeps): RouteHandler {
  return (ctx) =>
    withClient(deps, ctx, async (client) => {
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
      const result = await readSearch(client, {
        query: q,
        limit: paging.limit,
        offset: paging.offset,
        mode: rawMode ?? 'auto', // default to auto ONLY when omitted (FR-006a)
      });
      return { status: 200, body: result };
    });
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
  return (ctx) =>
    withClient(deps, ctx, async (client) => {
      const paging = parsePaging(ctx.query);
      if ('status' in paging) return paging;
      const fetch = which === 'callers' ? readCallers : readCallees;
      const result = await fetch(client, ctx.params.id ?? '', paging.limit, paging.offset);
      if (!result) return notFound('node');
      return { status: 200, body: result };
    });
}

/** GET /api/impact|graph/:id (T018, FR-004/007) — shared subgraph, divergent depth. */
function subgraphHandler(deps: ReadApiDeps, which: 'impact' | 'graph'): RouteHandler {
  return (ctx) =>
    withClient(deps, ctx, async (client) => {
      // Impact's own natural default is 3; graph-neighborhood's is 1 (FR-004/007).
      const depth = parseDepth(ctx.query, which === 'impact' ? 3 : 1);
      if (typeof depth !== 'number') return depth;
      const fetch = which === 'impact' ? readImpact : readNeighborhood;
      const result = await fetch(client, ctx.params.id ?? '', depth);
      if (!result) return notFound('node');
      return { status: 200, body: result };
    });
}

/**
 * Build the Slice-1 read route table (T014–T018). Registered by `startWebServer`
 * so the handlers close over the daemon-client pool and repo resolver.
 */
export function buildReadRoutes(deps: ReadApiDeps): Route[] {
  return [
    { method: 'GET', pattern: '/api/status', handler: statusHandler(deps) },
    { method: 'GET', pattern: '/api/search', handler: searchHandler(deps) },
    { method: 'GET', pattern: '/api/node/:id', handler: nodeHandler(deps) },
    { method: 'GET', pattern: '/api/callers/:id', handler: relationHandler(deps, 'callers') },
    { method: 'GET', pattern: '/api/callees/:id', handler: relationHandler(deps, 'callees') },
    { method: 'GET', pattern: '/api/impact/:id', handler: subgraphHandler(deps, 'impact') },
    { method: 'GET', pattern: '/api/graph/:id', handler: subgraphHandler(deps, 'graph') },
  ];
}
