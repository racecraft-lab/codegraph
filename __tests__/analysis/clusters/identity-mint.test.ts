/**
 * SPEC-011 T040 [US3] — content-hash cluster-id mint (FR-017a).
 *
 * A minted cluster id is an opaque DETERMINISTIC content hash of the sorted
 * member file paths — identical across runs/clones, changing only when the member
 * set changes — and is NEVER a rowid or positional index (which would churn on
 * the DELETE+INSERT swap).
 */
import { describe, it, expect } from 'vitest';
import { mintClusterId } from '../../../src/analysis/clusters/identity';

describe('mintClusterId (FR-017a)', () => {
  it('is a deterministic content hash of the member set (identical across runs/clones)', () => {
    const members = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const first = mintClusterId(members);
    const second = mintClusterId([...members]);
    expect(first).toBe(second);
    expect(first).toMatch(/^cluster:[0-9a-f]{16}$/);
  });

  it('changes when the member set changes', () => {
    const base = mintClusterId(['src/a.ts', 'src/b.ts']);
    expect(mintClusterId(['src/a.ts', 'src/b.ts', 'src/c.ts'])).not.toBe(base);
    expect(mintClusterId(['src/a.ts', 'src/x.ts'])).not.toBe(base);
  });

  it('depends only on content, never on a positional index or rowid', () => {
    // Same membership always mints the same opaque token, regardless of any
    // sibling clusters or position in the catalog.
    expect(mintClusterId(['m/one.ts', 'm/two.ts'])).toBe(mintClusterId(['m/one.ts', 'm/two.ts']));
    // The id is an opaque hash token, NOT a bare integer index.
    expect(mintClusterId(['m/one.ts'])).not.toMatch(/^\d+$/);
    expect(mintClusterId(['m/one.ts'])).not.toBe('0');
  });
});
