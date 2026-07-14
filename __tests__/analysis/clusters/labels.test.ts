/**
 * SPEC-011 T030 [US2] — deterministic canonical cluster label (FR-018).
 *
 * The label is derived from the cluster's dominant directory + name tokens, and
 * is order-independent (same member set → same label regardless of input order).
 */
import { describe, it, expect } from 'vitest';
import { canonicalLabel } from '../../../src/analysis/clusters/labels';

describe('canonicalLabel (FR-018)', () => {
  it('combines the dominant directory with the top name tokens', () => {
    expect(canonicalLabel(['src/db/queries.ts', 'src/db/schema.ts', 'src/db/sqlite-adapter.ts'])).toBe(
      'src/db: adapter, queries',
    );
  });

  it('labels root-level files with an explicit (root) marker', () => {
    expect(canonicalLabel(['main.ts', 'server.ts'])).toBe('(root): main, server');
  });

  it('is order-independent (a shuffled member set yields the same label)', () => {
    const a = canonicalLabel(['src/db/queries.ts', 'src/db/schema.ts', 'src/db/sqlite-adapter.ts']);
    const b = canonicalLabel(['src/db/sqlite-adapter.ts', 'src/db/queries.ts', 'src/db/schema.ts']);
    expect(b).toBe(a);
  });

  it('picks the most frequent directory and ranks tokens by frequency', () => {
    // 'pkg/core' (2 files) beats 'pkg/util' (1); 'users' (freq 2) leads 'controller' (1).
    expect(
      canonicalLabel(['src/api/index.ts', 'src/api/users.ts', 'src/api/users-controller.ts']),
    ).toBe('src/api: users, controller');
  });

  it('breaks a directory-frequency tie by shortest then lexicographic path', () => {
    expect(canonicalLabel(['beta/two.ts', 'alpha/one.ts'])).toBe('alpha: one, two');
  });

  it('splits camelCase basenames into separate tokens', () => {
    expect(canonicalLabel(['lib/fooBar.ts'])).toBe('lib: bar, foo');
  });
});
