/**
 * SPEC-011 - Functional Clusters: deterministic canonical label (T034, FR-018).
 *
 * A cluster's canonical label is derived from its dominant directory plus its
 * top name tokens. It is fully deterministic and order-independent (the same
 * member set yields the same label regardless of input order) and involves NO
 * LLM (FR-032). The presentation-only LLM `display_label` slot is left null by
 * the orchestrator (the optional advisory path is T056); this module owns only
 * the canonical label.
 */

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
