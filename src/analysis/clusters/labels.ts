/**
 * SPEC-011 - Functional Clusters: deterministic canonical label (T034, FR-018)
 * + the dormant-safe LLM display-label advisory (T056, FR-019).
 *
 * A cluster's canonical label is derived from its dominant directory plus its
 * top name tokens. It is fully deterministic and order-independent (the same
 * member set yields the same label regardless of input order) and involves NO
 * LLM (FR-032). The presentation-only `display_label` is an OPTIONAL advisory
 * layered on top of that canonical label via {@link resolveDisplayLabel} — fully
 * dormant unless a label capability is configured (there is none in this build).
 */

import { logWarn } from '../../errors';

/** Filename tokens that carry no functional signal. */
const STOPWORDS = new Set(['index', 'test', 'spec']);

/** Directory of a path (POSIX), or '' for a root-level file. */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Basename of a path (POSIX). */
function baseOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** Depth of a directory in path segments ('' = 0). */
function segCount(dir: string): number {
  return dir === '' ? 0 : dir.split('/').length;
}

/**
 * Tokenize a basename: drop the extension, split on camelCase and non-alphanumeric
 * boundaries, lowercase, and drop short/numeric/stopword tokens.
 */
function tokenize(base: string): string[] {
  const dot = base.lastIndexOf('.');
  const noExt = dot > 0 ? base.slice(0, dot) : base;
  const spaced = noExt
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !STOPWORDS.has(w));
}

/**
 * Compute a cluster's deterministic canonical label from its member file paths
 * (FR-018). The dominant directory is the most frequent directory (ties break by
 * fewest segments, then lexicographically); the top two name tokens are ranked by
 * frequency then lexicographically.
 */
export function canonicalLabel(files: string[]): string {
  const dirCounts = new Map<string, number>();
  const tokenCounts = new Map<string, number>();
  for (const f of files) {
    const d = dirOf(f);
    dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
    for (const t of tokenize(baseOf(f))) tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
  }

  const dominant = [...dirCounts.entries()].sort((x, y) => {
    if (y[1] !== x[1]) return y[1] - x[1]; // frequency desc
    const sx = segCount(x[0]);
    const sy = segCount(y[0]);
    if (sx !== sy) return sx - sy; // fewer segments first
    return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0; // lexicographic
  })[0]?.[0] ?? '';

  const base = dominant === '' ? '(root)' : dominant;

  const tokens = [...tokenCounts.entries()]
    .sort((x, y) => {
      if (y[1] !== x[1]) return y[1] - x[1]; // frequency desc
      return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0; // token asc
    })
    .slice(0, 2)
    .map(([t]) => t);

  return tokens.length > 0 ? `${base}: ${tokens.join(', ')}` : base;
}

// ── T056 — optional LLM display-label advisory (FR-019, dormant-safe) ──────────

/**
 * The OPTIONAL LLM label capability seam (FR-019). Given a cluster's deterministic
 * canonical label and its member file paths, a capability may advise a friendlier
 * presentation-only display label (or null if it declines). This is the ONLY hook
 * the advisory calls — there is NO LLM client in this module: that capability is
 * the separate SPEC-018 LLM-access layer, out of scope here, and is not present
 * in this build. Absent an injected capability the advisory is fully dormant.
 */
export type ClusterLabelCapability = (
  canonicalLabel: string,
  members: string[],
) => Promise<string | null>;

/**
 * Resolve a cluster's optional, presentation-only display label (FR-019),
 * modeled on the embedding pass's advisory discipline (`maybeRunEmbeddingPass`
 * in `src/index.ts`):
 *
 *   - DORMANT by default — with no capability configured (the case in this build:
 *     SPEC-018 is absent and no `CODEGRAPH_LLM_*` endpoint is wired) it returns
 *     null and makes ZERO model calls (SC-011). Byte-identical to the LLM-absent
 *     case.
 *   - ADVISORY — a failed or timed-out capability call is SWALLOWED: the cluster
 *     keeps its deterministic canonical label, the display slot stays null, and
 *     the failure NEVER fails analysis, marks the catalog stale/unavailable, or
 *     alters membership / identity / the canonical label (Constitution V). The
 *     display label is purely presentation-only.
 *   - REDACTION-SAFE — any surfaced diagnostic carries ONLY the error's class
 *     name, never the endpoint URL or an API key/credential (total redaction,
 *     mirroring the embedding pass — the error's message/cause is never logged).
 *
 * `capability` is an injection seam for SPEC-018; the SPEC-011 orchestrator wires
 * none, so this is a null-returning no-op on the real analysis path today.
 */
export async function resolveDisplayLabel(
  canonicalLabel: string,
  members: string[],
  capability?: ClusterLabelCapability,
): Promise<string | null> {
  if (!capability) return null; // dormant: no LLM label capability configured
  try {
    return await capability(canonicalLabel, members);
  } catch (err) {
    // Advisory — swallow every failure/timeout; surface ONLY the error's class
    // name (never its message/cause), keeping endpoint/key redaction total.
    logWarn(
      `Cluster display-label advisory skipped after a ${err instanceof Error ? err.name : 'error'} ` +
        '— the cluster keeps its canonical label and analysis is unaffected.',
    );
    return null;
  }
}
