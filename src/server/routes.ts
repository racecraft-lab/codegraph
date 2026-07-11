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

import { notFound, internalError } from './errors';

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
