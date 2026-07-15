/**
 * SPEC-011 T052 [US5] — LLM display-label dormancy (FR-019/032, SC-011).
 *
 * The optional LLM display label (FR-019) is produced by the separate SPEC-018
 * LLM-access capability, which is NOT present in this build: there is no LLM
 * client here and this repo configures no `CODEGRAPH_LLM_*` endpoint. So the
 * advisory is fully DORMANT — catalog analysis makes ZERO model calls, every
 * `display_label` is null, and output is byte-identical to the LLM-absent case.
 *
 * The advisory STRUCTURE is exercised at the function boundary (there is no
 * client to call, so dormancy is structural): `resolveDisplayLabel` with no
 * capability returns null; with a capability it awaits it, and a failed/timed-out
 * call is SWALLOWED (returns null, never throws, keeps the canonical label) with
 * the surfaced diagnostic carrying ONLY the error's class name — never the
 * endpoint URL or an API key/credential (mirroring the embedding pass).
 *
 * Real files + real SQLite temp dirs (no mocking); the capability seam is
 * injected in-process, and production wires none.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runClusterAnalysis } from '../../../src/analysis';
import { resolveDisplayLabel, type ClusterLabelCapability } from '../../../src/analysis/clusters/labels';
import { defaultLogger, setLogger, type Logger } from '../../../src/errors';
import { cleanupSeeds, edge, file, freshSeed, node, type SeedHandle } from '../flows/helpers';

afterEach(() => {
  cleanupSeeds();
  setLogger(defaultLogger);
});

/** Two cross-linked files (one cluster) + an isolated singleton — real clusters. */
function seed(h: SeedHandle): void {
  for (const p of ['src/user/a.ts', 'src/user/b.ts', 'src/solo.ts']) file(h, p, 'x');
  node(h, { id: 'a', name: 'a', kind: 'function', filePath: 'src/user/a.ts' });
  node(h, { id: 'b', name: 'b', kind: 'function', filePath: 'src/user/b.ts' });
  node(h, { id: 's', name: 's', kind: 'function', filePath: 'src/solo.ts' });
  edge(h, 'a', 'b', 'calls');
}

function analyzedClusters(h: SeedHandle): Array<{ id: string; canonical_label: string; display_label: string | null }> {
  return h.db
    .prepare('SELECT id, canonical_label, display_label FROM clusters ORDER BY id')
    .all() as Array<{ id: string; canonical_label: string; display_label: string | null }>;
}

describe('LLM display-label dormancy (T052, FR-019/032, SC-011)', () => {
  it('cluster analysis writes an all-null display_label column with no LLM configured', async () => {
    const h = freshSeed();
    seed(h);
    h.queries.advanceGraphWriteVersion();
    await runClusterAnalysis(h.graph, h.db);

    const rows = analyzedClusters(h);
    expect(rows.length).toBeGreaterThan(0);
    // Structure is present (deterministic canonical labels) and every display slot is null.
    expect(rows.every((r) => r.canonical_label.length > 0)).toBe(true);
    expect(rows.every((r) => r.display_label === null)).toBe(true);
  });

  it('produces byte-identical cluster output across repeat runs (display labels all null)', async () => {
    const h1 = freshSeed();
    seed(h1);
    h1.queries.advanceGraphWriteVersion();
    await runClusterAnalysis(h1.graph, h1.db);

    const h2 = freshSeed();
    seed(h2);
    h2.queries.advanceGraphWriteVersion();
    await runClusterAnalysis(h2.graph, h2.db);

    expect(analyzedClusters(h1)).toEqual(analyzedClusters(h2));
    expect(analyzedClusters(h1).every((r) => r.display_label === null)).toBe(true);
  });

  it('resolveDisplayLabel is a dormant no-op with no capability (zero model calls)', async () => {
    // Production case: nothing is wired, so there is nothing to call — returns null.
    await expect(resolveDisplayLabel('src/user: user', ['src/user/a.ts', 'src/user/b.ts'])).resolves.toBeNull();
  });

  it('an injected capability CAN produce a label — proving the null is dormancy, not a hardcode', async () => {
    const cap: ClusterLabelCapability = async () => 'User Service';
    await expect(resolveDisplayLabel('src/user: user', ['src/user/a.ts'], cap)).resolves.toBe('User Service');
  });

  it('swallows a failed/timed-out capability call and redacts the endpoint + credential', async () => {
    const warns: string[] = [];
    const capturing: Logger = {
      debug() {},
      error() {},
      warn(message, context) {
        warns.push(`${message} ${context ? JSON.stringify(context) : ''}`);
      },
    };
    setLogger(capturing);

    const SECRET = 'sk-live-DEADBEEF01234567';
    const ENDPOINT = 'https://llm.internal.example/v1/chat/completions';
    const failing: ClusterLabelCapability = async () => {
      throw new Error(`connect ECONNREFUSED ${ENDPOINT} (api-key ${SECRET})`);
    };

    // Advisory: the failure is swallowed — resolves to null and never throws.
    await expect(resolveDisplayLabel('svc: user', ['x.ts'], failing)).resolves.toBeNull();

    // A diagnostic was surfaced, but it carries ONLY the error's class name — the
    // endpoint URL, host, and API key never leak (total redaction).
    const surfaced = warns.join('\n');
    expect(surfaced).toContain('Error'); // the error class/name
    expect(surfaced).not.toContain(SECRET);
    expect(surfaced).not.toContain(ENDPOINT);
    expect(surfaced).not.toContain('llm.internal.example');
    expect(surfaced).not.toContain('ECONNREFUSED');
  });

  it('a timeout-style rejection (AbortError) is swallowed the same way', async () => {
    const warns: string[] = [];
    setLogger({ debug() {}, error() {}, warn(m) { warns.push(m); } });
    const timedOut: ClusterLabelCapability = async () => {
      const e = new Error('label request exceeded 5000ms');
      e.name = 'AbortError';
      throw e;
    };
    await expect(resolveDisplayLabel('svc', ['x.ts'], timedOut)).resolves.toBeNull();
    expect(warns.join('\n')).toContain('AbortError');
    expect(warns.join('\n')).not.toContain('5000ms');
  });
});
