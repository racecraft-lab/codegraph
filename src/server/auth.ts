/**
 * SPEC-005 network binding + token auth (FR-012/FR-013/FR-014/FR-014a).
 *
 * Composes the shared loopback predicate into (1) the fail-closed bind gate
 * (non-loopback host + no `CODEGRAPH_SERVER_TOKEN` → refuse startup), (2) the
 * Host-header allowlist (DNS-rebinding defense, even on loopback), and (3) the
 * constant-time Bearer check on every `/api/*` request. The token is never
 * logged or echoed (FR-014a).
 *
 * The security posture is deliberately asymmetric: loopback binds need no auth
 * (the Bearer gate is a no-op there even when a token is configured), and a
 * non-loopback bind is fail-closed. So `requireToken` is a property of the BIND,
 * not of the env var alone (spec Assumptions; FR-014 "when a token is configured
 * for a non-loopback bind").
 *
 * @module server/auth
 */

import * as crypto from 'crypto';
import { isLoopbackHost } from '../utils';

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
 * Fail-closed bind gate (FR-012/FR-013). Resolves the bind posture for a
 * `(host, token)` pair, and THROWS when a non-loopback host is asked to bind
 * with no usable token — startup is refused so an unauthenticated code index is
 * never exposed on the network (`0.0.0.0`/`::` are non-loopback wildcards, not
 * loopback). The thrown error names the reason and MUST NOT be swallowed by the
 * bootstrap before `listen`, so nothing binds.
 *
 * On a loopback bind `requireToken` is always false — the Bearer gate is a no-op
 * there even when a token happens to be configured (FR-012, SC-002).
 */
export function resolveBindSecurity(host: string, token: string | null): BindSecurity {
  const loopback = isLoopbackHost(host);
  // An empty string is not a usable credential — treat it as unset (fail-closed).
  const hasToken = token !== null && token !== '';

  if (!loopback && !hasToken) {
    throw new Error(
      `Refusing to start the CodeGraph web server: binding to non-loopback host ` +
        `"${host}" requires CODEGRAPH_SERVER_TOKEN to be set (fail-closed, FR-013).`,
    );
  }

  return {
    loopback,
    requireToken: !loopback && hasToken,
    token: hasToken ? token : null,
  };
}

/**
 * Host-header allowlist (FR-012): a request's `Host` must name one of
 * `{localhost, 127.0.0.1, [::1], bound host}` AND carry the bound port. This is
 * the DNS-rebinding defense Vite/webpack-dev-server adopted — it applies to
 * EVERY request, even on a loopback bind and even for the static shell that sits
 * outside the auth boundary. Host comparison is case-insensitive and IPv6
 * brackets are normalized away; an absent Host, a missing/mismatched port, or a
 * bare (portless) IPv6 host is rejected.
 */
export function isAllowedHostHeader(
  hostHeader: string | undefined,
  boundHost: string,
  boundPort: number,
): boolean {
  if (!hostHeader) return false;
  const parsed = parseHostHeader(hostHeader);
  if (parsed === null) return false;
  if (parsed.port !== boundPort) return false;
  const allowed = new Set(['localhost', '127.0.0.1', '::1', normalizeHost(boundHost)]);
  return allowed.has(normalizeHost(parsed.host));
}

/** Lowercase a host and strip IPv6 brackets (`[::1]` → `::1`). */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^\[|\]$/g, '');
}

/**
 * Split a `Host` header into `{host, port}`, honoring IPv6 brackets
 * (`[::1]:port`). Returns null when there is no explicit port, when a bracketless
 * value carries multiple colons (a bare IPv6 with no port — ambiguous), or when
 * the port is not a valid 1–65535 integer.
 */
function parseHostHeader(raw: string): { host: string; port: number } | null {
  const s = raw.trim();
  let host: string;
  let portStr: string;

  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end === -1) return null;
    host = s.slice(0, end + 1); // keep brackets; normalizeHost strips them
    const rest = s.slice(end + 1);
    if (!rest.startsWith(':')) return null; // bracketed host with no port
    portStr = rest.slice(1);
  } else {
    const idx = s.lastIndexOf(':');
    if (idx === -1) return null; // no port
    if (s.indexOf(':') !== idx) return null; // bare IPv6 (multiple colons), no brackets
    host = s.slice(0, idx);
    portStr = s.slice(idx + 1);
  }

  if (!/^\d+$/.test(portStr)) return null;
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

/**
 * Constant-time Bearer check (FR-014). Parses `Authorization: Bearer <token>`
 * (the auth-scheme is case-insensitive per RFC 7235), rejects an empty or
 * missing presented token BEFORE any comparison, then compares the SHA-256
 * digests of the presented and configured tokens (both UTF-8) with
 * `crypto.timingSafeEqual`. Digest-first guarantees equal 32-byte inputs (so
 * `timingSafeEqual` never throws on a length mismatch) and hides token length.
 * Both primitives are `node:crypto` — zero new dependency (FR-003).
 */
export function isValidBearer(authorizationHeader: string | undefined, token: string): boolean {
  if (!authorizationHeader || !token) return false;
  const match = /^Bearer[ ]+(.+)$/i.exec(authorizationHeader);
  if (!match) return false;
  const presented = match[1];
  if (!presented) return false; // empty presented token → reject before compare

  const a = crypto.createHash('sha256').update(presented, 'utf8').digest();
  const b = crypto.createHash('sha256').update(token, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}
