/**
 * Server auth & loopback-binding unit tests (SPEC-005, User Story 4).
 *
 * This file pins the local HTTP server's safe-by-default binding and token-auth
 * surface (FR-012/FR-013/FR-014/FR-014a). The security model is deliberately
 * asymmetric and is the crux of every test here:
 *
 *   - Loopback (`127.0.0.0/8`, `::1`, `localhost`) is the default and needs NO
 *     auth — the Bearer gate is a no-op there EVEN when a token is configured
 *     (spec Assumptions "no authentication is required even if CODEGRAPH_SERVER_
 *     TOKEN happens to be set"; FR-014 "when a token is configured for a
 *     non-loopback bind"). So `requireToken` is a property of the BIND, not of
 *     the env var alone.
 *   - A non-loopback bind is fail-closed: it refuses startup unless a token is
 *     set (FR-013), then enforces that token as a Bearer on every `/api/*`
 *     request (FR-014).
 *
 * Because binding a real non-loopback interface in CI would expose the network,
 * the non-loopback rules are proven by driving the DECISION LOGIC directly
 * (`resolveBindSecurity`, `isValidBearer`, and the Bearer scope folded into
 * `handleApiRequest`); the live HTTP listener is exercised only for
 * loopback-reachable behavior (the Host-header allowlist 400, the no-credential
 * loopback path, and — safely, because it refuses BEFORE `listen` — the
 * fail-closed startup refusal).
 */
import { afterEach, describe, it, expect } from 'vitest';
import * as net from 'net';
import { isLoopbackHost } from '../src/utils';
import {
  resolveBindSecurity,
  isAllowedHostHeader,
  isValidBearer,
  type BindSecurity,
} from '../src/server/auth';
import {
  handleApiRequest,
  type Route,
  type RouteContext,
} from '../src/server/routes';
import { startWebServer, type WebServerHandle } from '../src/server/index';

describe('isLoopbackHost (FR-012 shared loopback predicate)', () => {
  it.each(['localhost', '::1', '[::1]', '127.0.0.1', '127.9.9.9'])(
    'treats %s as loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    }
  );

  it.each(['0.0.0.0', '::', '192.168.1.1', 'example.com'])(
    'treats %s as non-loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// T022 — fail-closed bind gate (FR-012/FR-013), decision logic
// ---------------------------------------------------------------------------

describe('resolveBindSecurity — bind posture + fail-closed gate (T022, FR-012/013)', () => {
  // A loopback bind never requires a token; a configured token is carried but the
  // Bearer gate stays OFF (`requireToken:false`) — no auth on loopback (SC-002).
  // A non-loopback bind WITH a token turns the gate ON. A non-loopback bind with
  // NO usable token is refused (throws) so nothing ever binds (FR-013).
  it.each<[string, string | null, BindSecurity]>([
    ['127.0.0.1', null, { loopback: true, requireToken: false, token: null }],
    ['127.0.0.1', 'secret', { loopback: true, requireToken: false, token: 'secret' }],
    ['127.9.9.9', 'secret', { loopback: true, requireToken: false, token: 'secret' }],
    ['localhost', null, { loopback: true, requireToken: false, token: null }],
    ['::1', 'secret', { loopback: true, requireToken: false, token: 'secret' }],
    ['0.0.0.0', 'secret', { loopback: false, requireToken: true, token: 'secret' }],
    ['192.168.1.5', 'secret', { loopback: false, requireToken: true, token: 'secret' }],
  ])('resolveBindSecurity(%s, %s) resolves the expected posture', (host, token, expected) => {
    expect(resolveBindSecurity(host, token)).toEqual(expected);
  });

  it.each<[string, string | null]>([
    ['0.0.0.0', null],
    ['::', null],
    ['192.168.1.5', null],
    ['0.0.0.0', ''], // an empty token is not a usable credential → still fail-closed
  ])('resolveBindSecurity(%s, %s) refuses startup (fail-closed, FR-013)', (host, token) => {
    // The message must name the reason (a specific fail-closed error), so the
    // throwing stub's generic "not implemented" does NOT satisfy this at RED.
    expect(() => resolveBindSecurity(host, token)).toThrow(/CODEGRAPH_SERVER_TOKEN|loopback/i);
  });
});

// ---------------------------------------------------------------------------
// T024 — constant-time Bearer check (FR-014), decision logic
// ---------------------------------------------------------------------------

describe('isValidBearer — constant-time Bearer match (T024, FR-014)', () => {
  const TOKEN = 's3cret-token';
  it.each<[string | undefined, boolean]>([
    [`Bearer ${TOKEN}`, true],
    [`bearer ${TOKEN}`, true], // auth-scheme is case-insensitive (RFC 7235)
    [`Bearer  ${TOKEN}`, true], // tolerant of extra SP between scheme and token
    ['Bearer wrong-token-x', false], // wrong value, SAME length class
    ['Bearer x', false], // wrong value, DIFFERENT length — digest-first, never throws
    [undefined, false], // no header
    ['', false], // empty header
    ['Bearer ', false], // empty presented token → rejected before compare
    ['Bearer', false], // scheme only, no token
    [TOKEN, false], // bare token, no Bearer scheme
    [`Basic ${TOKEN}`, false], // wrong scheme
  ])('isValidBearer(%s) → %s', (header, expected) => {
    expect(isValidBearer(header, TOKEN)).toBe(expected);
  });

  it('an empty configured token can never be matched (defensive)', () => {
    expect(isValidBearer('Bearer ', '')).toBe(false);
    expect(isValidBearer('Bearer anything', '')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T023 — Host-header allowlist (FR-012), decision logic
// ---------------------------------------------------------------------------

describe('isAllowedHostHeader — DNS-rebinding allowlist (T023, FR-012)', () => {
  // Allowlist = {localhost, 127.0.0.1, [::1], bound host} × the bound port.
  it.each<[string | undefined, string, number, boolean]>([
    ['127.0.0.1:8080', '127.0.0.1', 8080, true],
    ['localhost:8080', '127.0.0.1', 8080, true],
    ['[::1]:8080', '127.0.0.1', 8080, true],
    ['LOCALHOST:8080', '127.0.0.1', 8080, true], // hostnames are case-insensitive
    ['127.0.0.1:8080', '0.0.0.0', 8080, true], // 127.0.0.1 always allowed
    ['192.168.1.5:8080', '192.168.1.5', 8080, true], // the bound host itself
    ['evil.example:8080', '127.0.0.1', 8080, false], // rebinding host → reject
    ['127.0.0.1:9999', '127.0.0.1', 8080, false], // wrong port → reject
    ['127.0.0.1', '127.0.0.1', 8080, false], // no port → not the bound port
    [undefined, '127.0.0.1', 8080, false], // absent Host header → reject
  ])('isAllowedHostHeader(%s, boundHost=%s, boundPort=%s) → %s', (header, boundHost, boundPort, expected) => {
    expect(isAllowedHostHeader(header, boundHost, boundPort)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// T024 — Bearer scope folded into the /api dispatch (FR-014), no network
// ---------------------------------------------------------------------------

describe('handleApiRequest Bearer scope (T024, FR-014)', () => {
  const probeRoutes: Route[] = [
    { method: 'GET', pattern: '/api/probe', handler: () => ({ status: 200, body: { probe: true } }) },
  ];
  const reqCtx = (
    method: string,
    rawPath: string,
    headers: Record<string, string | string[] | undefined> = {},
  ): RouteContext => ({ method, rawPath, params: {}, query: new URLSearchParams(''), headers });

  const tokenBound: BindSecurity = { loopback: false, requireToken: true, token: 'tok' };
  const loopbackTokenSet: BindSecurity = { loopback: true, requireToken: false, token: 'tok' };

  it('a token-bound bind rejects a MISSING Bearer with a generic 401', async () => {
    const r = await handleApiRequest(probeRoutes, reqCtx('GET', '/api/probe'), tokenBound);
    expect(r?.status).toBe(401);
    // Generic + detail-free (enumeration prevention) — the errors.ts unauthorized() body.
    expect(r?.body).toEqual({ error: { code: 'unauthorized', message: 'Unauthorized.' } });
  });

  it('a token-bound bind rejects a WRONG Bearer identically to a missing one', async () => {
    const missing = await handleApiRequest(probeRoutes, reqCtx('GET', '/api/probe'), tokenBound);
    const wrong = await handleApiRequest(
      probeRoutes,
      reqCtx('GET', '/api/probe', { authorization: 'Bearer not-the-token' }),
      tokenBound,
    );
    expect(wrong?.status).toBe(401);
    expect(wrong?.body).toEqual(missing?.body); // byte-identical → no enumeration signal
  });

  it('a token-bound bind runs the route for a VALID Bearer (→ 200)', async () => {
    const ok = await handleApiRequest(
      probeRoutes,
      reqCtx('GET', '/api/probe', { authorization: 'Bearer tok' }),
      tokenBound,
    );
    expect(ok?.status).toBe(200);
    expect(ok?.body).toEqual({ probe: true }); // proves the guard let the handler run
  });

  it('a token-bound bind 401s even an UNMATCHED /api path before routing', async () => {
    // The token scope is every /api/* request, matched or not — an unauthenticated
    // probe must not be able to tell a real route from a 404.
    const r = await handleApiRequest(probeRoutes, reqCtx('GET', '/api/does-not-exist'), tokenBound);
    expect(r?.status).toBe(401);
  });

  it('a loopback bind is a Bearer NO-OP even with a token configured (SC-002)', async () => {
    const r = await handleApiRequest(probeRoutes, reqCtx('GET', '/api/probe'), loopbackTokenSet);
    expect(r?.status).toBe(200);
    expect(r?.body).toEqual({ probe: true });
  });

  it('no security context → no auth gate (backward-compatible default)', async () => {
    const r = await handleApiRequest(probeRoutes, reqCtx('GET', '/api/probe'));
    expect(r?.status).toBe(200);
  });

  it('the static mount + placeholder sit OUTSIDE the auth boundary (non-/api → null)', async () => {
    // Even on a token-bound bind, a non-/api path is never 401'd here — it returns
    // null so the caller serves the public shell without a token (FR-014/FR-017a).
    const shell = await handleApiRequest(probeRoutes, reqCtx('GET', '/'), tokenBound);
    const asset = await handleApiRequest(probeRoutes, reqCtx('GET', '/index.html'), tokenBound);
    expect(shell).toBeNull();
    expect(asset).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HTTP wiring over a LOOPBACK bind (FR-012/013/014a) — no network exposure
// ---------------------------------------------------------------------------

/** Decode an HTTP/1.1 chunked-transfer body (the server chunks small JSON envelopes). */
function dechunk(raw: string): string {
  let out = '';
  let rest = raw;
  for (;;) {
    const nl = rest.indexOf('\r\n');
    if (nl === -1) break;
    const size = parseInt(rest.slice(0, nl).trim(), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    const start = nl + 2;
    out += rest.slice(start, start + size);
    rest = rest.slice(start + size + 2); // skip the chunk data + its trailing CRLF
  }
  return out;
}

/** Send a raw HTTP/1.1 request with arbitrary headers (fetch forbids setting Host). */
function rawRequest(
  port: number,
  method: string,
  rawPath: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string; json: unknown }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      const lines = [`${method} ${rawPath} HTTP/1.1`];
      for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
      lines.push('Connection: close', '', '');
      sock.write(lines.join('\r\n'));
    });
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (d) => { buf += d; });
    sock.on('error', reject);
    sock.on('close', () => {
      const sep = buf.indexOf('\r\n\r\n');
      const head = sep === -1 ? buf : buf.slice(0, sep);
      let body = sep === -1 ? '' : buf.slice(sep + 4);
      if (/transfer-encoding:\s*chunked/i.test(head)) body = dechunk(body);
      const m = /^HTTP\/1\.\d\s+(\d{3})/.exec(head.split('\r\n')[0] ?? '');
      let json: unknown;
      try { json = body ? JSON.parse(body) : undefined; } catch { /* not JSON */ }
      resolve({ status: m ? Number(m[1]) : 0, body, json });
    });
    const timer = setTimeout(() => { try { sock.destroy(); } catch { /* gone */ } reject(new Error('rawRequest timeout')); }, 5000);
    timer.unref?.();
  });
}

describe('SPEC-005 auth/binding HTTP wiring (loopback, FR-012/013/014a)', () => {
  const handles: WebServerHandle[] = [];

  afterEach(async () => {
    for (const h of handles.splice(0)) {
      try { await h.close(); } catch { /* already closed */ }
    }
  });

  async function start(opts: Parameters<typeof startWebServer>[0] = {}): Promise<WebServerHandle> {
    const h = await startWebServer({ port: 0, ...opts });
    handles.push(h);
    return h;
  }

  it('loopback default serves /api/* with NO credentials (SC-002)', async () => {
    // A route miss (404) — reached BEFORE any daemon attach — proves the request
    // was not auth-blocked: a token-bound bind would 401 this before routing.
    const h = await start();
    const res = await fetch(`http://127.0.0.1:${h.port}/api/nope`);
    expect(res.status).toBe(404);
  });

  it('a non-allowlisted Host is rejected 400 invalid_request naming the header (FR-012)', async () => {
    const h = await start();
    const { status, json } = await rawRequest(h.port, 'GET', '/api/nope', { Host: 'evil.example' });
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: { code: 'invalid_request', details: { header: 'Host' } } });
  });

  it('the Host allowlist guards EVERY request, including the static shell outside the auth boundary', async () => {
    const h = await start();
    const { status } = await rawRequest(h.port, 'GET', '/', { Host: 'evil.example' });
    expect(status).toBe(400); // not the 200 placeholder — Host is validated first
  });

  it('an allowlisted Host passes through to normal routing (positive control)', async () => {
    const h = await start();
    const { status } = await rawRequest(h.port, 'GET', '/api/nope', { Host: `127.0.0.1:${h.port}` });
    expect(status).toBe(404); // route miss, NOT a Host 400
  });

  it('refuses startup on a non-loopback bind with no token — nothing binds (FR-013/SC-002)', async () => {
    // The gate throws BEFORE listen, so at GREEN nothing ever binds a non-loopback
    // interface. If (at RED) it were to bind, close the leaked handle immediately.
    const bound: WebServerHandle[] = [];
    const err = await startWebServer({ host: '0.0.0.0', token: null, port: 0 }).then(
      (h) => { bound.push(h); return null; },
      (e) => e as Error,
    );
    for (const h of bound) { try { await h.close(); } catch { /* ignore */ } }
    expect(err).toBeInstanceOf(Error); // startup was refused (rejected)
    expect((err as Error | null)?.message ?? '').toMatch(/CODEGRAPH_SERVER_TOKEN|loopback/i);
  });

  it('the request-log seam never serializes the token or Authorization header (FR-014a)', async () => {
    const lines: string[] = [];
    const secret = 'S3CRET_never_log_a1b2c3d4';
    const h = await start({ logger: (m: string) => lines.push(m) });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/nope`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(res.status).toBe(404);
    const joined = lines.join('\n');
    expect(joined).toContain('/api/nope'); // a redacted request line WAS logged
    expect(joined).not.toContain(secret); // the token never appears, in any form
    expect(joined.toLowerCase()).not.toContain('authorization');
    expect(joined.toLowerCase()).not.toContain('bearer');
  });
});
