/**
 * SPEC-011 - Functional Clusters: stable cluster identity (T041, FR-015/016/017/017a).
 *
 * A cluster's stable id is an OPAQUE token minted on first appearance and
 * transferred across re-index by membership overlap (R6). It is NEVER a rowid or
 * positional index (those churn on the DELETE+INSERT catalog swap).
 *
 *   - Mint (FR-017a): a deterministic content hash of the sorted member file
 *     paths, so an unchanged group mints byte-identical ids across runs/clones.
 *   - Transfer (FR-015/016/017): greedy one-to-one match against the prior
 *     catalog — a new cluster inherits a prior id when their membership Jaccard is
 *     >= 0.5; a prior cluster that splits transfers its id to only the single
 *     best-matching descendant (others mint); ties break deterministically on a
 *     stable ordering, so the same assignment is produced on every run.
 *
 * Pure: prior membership is READ from the last committed catalog by the caller
 * (a pre-swap read, T042) and passed in — this module never touches the DB.
 */

import { createHash } from 'crypto';

/** A prior catalog cluster: its stable id + its (sorted) member file paths. */
export interface PriorCluster {
  id: string;
  members: string[];
}

/** A freshly computed cluster awaiting identity: its sorted member file paths. */
export interface CandidateCluster {
  members: string[];
}

/** The Jaccard transfer threshold (Q11: 0.5 = majority-of-union midpoint). */
const JACCARD_TRANSFER_THRESHOLD = 0.5;

/**
 * Mint a deterministic content-hash cluster id over sorted member paths
 * (FR-017a). Position-independent and byte-identical across runs/clones; NEVER a
 * rowid or positional index.
 */
export function mintClusterId(sortedMembers: string[]): string {
  return 'cluster:' + createHash('sha256').update(sortedMembers.join('\n')).digest('hex').slice(0, 16);
}

/** Membership overlap: |A ∩ B| / |A ∪ B| (0 for two empty sets). */
function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Assign a stable id to each new cluster (FR-015/016/017/017a). New clusters
 * greedily inherit a prior id on Jaccard >= 0.5, one-to-one (each prior id
 * transferred at most once, each new cluster receiving at most one), preferring
 * the highest-overlap pairing; ties break on the new cluster's member key then
 * the prior id, so the assignment is deterministic. Any new cluster with no
 * qualifying prior mints a content-hash id. A first run (empty `priorClusters`)
 * mints all-new. Returns the ids aligned to `newClusters`.
 */
export function assignClusterIdentity(
  newClusters: ReadonlyArray<CandidateCluster>,
  priorClusters: ReadonlyArray<PriorCluster>,
): string[] {
  const priorSets = priorClusters.map((p) => new Set(p.members));

  // All (new, prior) pairs that clear the transfer threshold.
  const candidates: Array<{ ni: number; pi: number; jaccard: number; nKey: string }> = [];
  for (let ni = 0; ni < newClusters.length; ni++) {
    const nSet = new Set(newClusters[ni]!.members);
    const nKey = newClusters[ni]!.members.join('\n');
    for (let pi = 0; pi < priorClusters.length; pi++) {
      const j = jaccard(nSet, priorSets[pi]!);
      if (j >= JACCARD_TRANSFER_THRESHOLD) candidates.push({ ni, pi, jaccard: j, nKey });
    }
  }

  // Highest overlap first; deterministic tie-break on the new member key, then
  // the prior id (so the SAME winner is chosen on every run).
  candidates.sort((a, b) => {
    if (b.jaccard !== a.jaccard) return b.jaccard - a.jaccard;
    if (a.nKey !== b.nKey) return a.nKey < b.nKey ? -1 : 1;
    const pa = priorClusters[a.pi]!.id;
    const pb = priorClusters[b.pi]!.id;
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });

  const assigned: (string | null)[] = new Array(newClusters.length).fill(null);
  const usedPrior = new Set<number>();
  for (const c of candidates) {
    if (assigned[c.ni] !== null || usedPrior.has(c.pi)) continue; // one-to-one
    assigned[c.ni] = priorClusters[c.pi]!.id;
    usedPrior.add(c.pi);
  }

  return newClusters.map((nc, ni) => assigned[ni] ?? mintClusterId(nc.members));
}
