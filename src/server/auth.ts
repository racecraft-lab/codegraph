/**
 * SPEC-005 network binding + token auth (FR-012/FR-013/FR-014/FR-014a).
 *
 * Composes the shared loopback predicate into (1) the fail-closed bind gate
 * (non-loopback host + no `CODEGRAPH_SERVER_TOKEN` → refuse startup), (2) the
 * Host-header allowlist (DNS-rebinding defense, even on loopback), and (3) the
 * constant-time Bearer check on every `/api/*` request. The token is never
 * logged or echoed (FR-014a).
 *
 * @module server/auth
 *
 * NOTE (skeleton, T001): exported surface only; behaviour lands in a later
 * Slice-1 task (with the shared `isLoopbackHost` extraction, research D1).
 */

/** Resolved bind security posture for a `(host, token)` pair. */
export interface BindSecurity {
  /** Whether the bound host is loopback (no auth required there, FR-012). */
  loopback: boolean;
  /** Whether a Bearer token is required on `/api/*` (non-loopback, FR-014). */
  requireToken: boolean;
  /** The configured token, or null when none is set. */
  token: string | null;
}

/**
 * Fail-closed bind gate (FR-013): a non-loopback host with no token refuses
 * startup. Implemented in a later Slice-1 task.
 */
export function resolveBindSecurity(_host: string, _token: string | null): BindSecurity {
  throw new Error('not implemented: resolveBindSecurity');
}

/**
 * Host-header allowlist (FR-012): `localhost`, `127.0.0.1`, `[::1]`, and the
 * bound host, each with the bound port. Implemented in a later Slice-1 task.
 */
export function isAllowedHostHeader(
  _hostHeader: string | undefined,
  _boundHost: string,
  _boundPort: number
): boolean {
  throw new Error('not implemented: isAllowedHostHeader');
}

/**
 * Constant-time Bearer check (FR-014): digest-first `crypto.timingSafeEqual`.
 * Implemented in a later Slice-1 task.
 */
export function isValidBearer(_authorizationHeader: string | undefined, _token: string): boolean {
  throw new Error('not implemented: isValidBearer');
}
