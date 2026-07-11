/**
 * Server auth & loopback-binding unit tests (SPEC-005).
 *
 * This file grows with the local HTTP server's auth/binding surface. For now it
 * pins the shared loopback predicate extracted into `src/utils.ts` (FR-012,
 * research D1): the same host classification that gates the embeddings cleartext
 * advisory now also decides the server's bind/auth policy, so it lives in one
 * place and is unit-pinned here against its exported contract.
 */
import { describe, it, expect } from 'vitest';
import { isLoopbackHost } from '../src/utils';

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
