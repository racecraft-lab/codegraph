/**
 * SPEC-005 static mount + route fallback (FR-017/FR-017a/FR-017b/FR-018).
 *
 * Serves assets from `dist/web/` when present (absent for all of SPEC-005's
 * life), confining every resolved path within the web root via the repo's
 * `validatePathWithinRoot` chokepoint (FR-017b). While the web dir is absent,
 * `/` and every extensionless browser route return a byte-identical, data-free
 * placeholder page (FR-017/FR-017a); `/api/*` and missing asset-extension paths
 * never fall back (FR-018).
 *
 * @module server/static
 *
 * NOTE (skeleton, T001): exported surface only; behaviour lands in a later
 * Slice-1 task.
 */

/** A static/placeholder response descriptor. */
export interface StaticResult {
  status: number;
  headers?: Record<string, string>;
  body: string | Buffer;
}

/**
 * Resolve a non-`/api` request against the static mount and fallback rules
 * (FR-017/FR-017b/FR-018). Implemented in a later Slice-1 task.
 */
export function serveStatic(_rawPath: string, _webRoot: string): StaticResult {
  throw new Error('not implemented: serveStatic');
}

/**
 * The data-free placeholder page pointing at `/api/status` (FR-017/FR-017a).
 * Implemented in a later Slice-1 task.
 */
export function placeholderPage(): string {
  throw new Error('not implemented: placeholderPage');
}
