/**
 * SPEC-011 - Functional Clusters: compact DETERMINISTIC pure-TS Louvain (T033).
 *
 * Exactly ONE community-detection algorithm (no fallback / label-prop, FR-013);
 * NO random seed anywhere; pure TypeScript with no new native dependency
 * (Constitution VII / FR-033). Determinism (FR-013, SC-004) comes from:
 *   - a stable vertex order (the file graph's `files` are already path-sorted);
 *   - a deterministic tie-break in the local-moving phase: candidate target
 *     communities are visited in ascending community-id order and a move is
 *     taken only on a STRICTLY greater gain, so the lowest-ordered community
 *     wins any tie;
 *   - canonical final labels (a community is labeled by the ascending order in
 *     which its lowest-indexed member first appears).
 *
 * Membership is therefore byte-identical across repeat runs and across
 * independently-built identical graphs.
 *
 * The two pass boundaries (each level's local-moving entry) are exposed via
 * `hooks.onPassBoundary` so a cooperative yielder can attach later (T050, Group
 * D). No yielder is wired here.
 */

import type { FileGraph } from './file-graph';

/** Optional cooperative-yield seam at Louvain pass boundaries (wired in T050). */
export interface LouvainHooks {
  onPassBoundary?: () => void;
}

/**
 * Safety bound on local-moving passes per level. Local moving converges because
 * every accepted move strictly increases modularity (bounded above); the cap is
 * a deterministic guard against floating-point oscillation, generous enough that
 * real graphs never reach it.
 */
const MAX_LOCAL_PASSES = 100;

/** A weighted graph level: symmetric adjacency (no self entries) + self-loops. */
interface Level {
  n: number;
  adj: Array<Map<number, number>>;
  selfLoop: number[];
  /** Weighted degree per vertex (incident edge weights; self-loop counts twice). */
  deg: number[];
}

/**
 * Deterministic Louvain community detection over the undirected weighted file
 * graph. Returns a community label per `graph.files[i]`, canonically numbered
 * from 0 by first appearance (FR-011/013).
 */
export function louvain(graph: FileGraph, hooks?: LouvainHooks): number[] {
  const n = graph.files.length;
  if (n === 0) return [];

  const fileIndex = new Map<string, number>();
  graph.files.forEach((f, i) => fileIndex.set(f, i));

  // Build the level-0 graph. m2 = 2*m (total weighted degree), invariant across
  // aggregation levels.
  const level0 = emptyLevel(n);
  let m2 = 0;
  for (const e of graph.edges) {
    const u = fileIndex.get(e.a);
    const v = fileIndex.get(e.b);
    if (u === undefined || v === undefined || u === v) continue;
    level0.adj[u]!.set(v, (level0.adj[u]!.get(v) ?? 0) + e.weight);
    level0.adj[v]!.set(u, (level0.adj[v]!.get(u) ?? 0) + e.weight);
    m2 += 2 * e.weight;
  }
  recomputeDegrees(level0);

  // No edges: every file is its own community (all singletons).
  if (m2 === 0) return canonicalize(identity(n));

  // origToLevel[i] = the current-level super-vertex representing original file i.
  const origToLevel = identity(n);
  let level = level0;

  for (;;) {
    hooks?.onPassBoundary?.();
    const { comm, numComms, moved } = localMoving(level, m2);
    // Fold the level's assignment into the global membership.
    for (let i = 0; i < n; i++) origToLevel[i] = comm[origToLevel[i]!]!;
    if (!moved || numComms === level.n) break;
    level = aggregate(level, comm, numComms);
  }

  return canonicalize(origToLevel);
}

/** One level's local-moving phase. Returns a dense community id per vertex. */
function localMoving(level: Level, m2: number): { comm: number[]; numComms: number; moved: boolean } {
  const { n, adj, deg } = level;
  const node2com = identity(n);
  const tot = deg.slice(); // sum of degrees per community; each node starts alone

  let moved = false;
  let improved = true;
  let passes = 0;
  while (improved && passes < MAX_LOCAL_PASSES) {
    improved = false;
    passes++;
    for (let i = 0; i < n; i++) {
      const ci = node2com[i]!;
      const ki = deg[i]!;
      const degcTot = ki / m2;

      // Weight from i to each neighboring community (self-loop excluded).
      const neigh = new Map<number, number>();
      for (const [j, w] of adj[i]!) {
        if (j === i) continue;
        const cj = node2com[j]!;
        neigh.set(cj, (neigh.get(cj) ?? 0) + w);
      }

      // Remove i from its community, then evaluate candidate communities.
      const removeCost = -(neigh.get(ci) ?? 0) + (tot[ci]! - ki) * degcTot;
      tot[ci] = tot[ci]! - ki;

      // Default: stay in ci (gain 0). A candidate must STRICTLY beat 0, and
      // candidates are visited in ascending community id, so the lowest-ordered
      // community wins any tie (deterministic tie-break, FR-013).
      let bestCom = ci;
      let bestGain = 0;
      for (const com of [...neigh.keys()].sort((a, b) => a - b)) {
        const gain = removeCost + neigh.get(com)! - tot[com]! * degcTot;
        if (gain > bestGain) {
          bestGain = gain;
          bestCom = com;
        }
      }

      tot[bestCom] = tot[bestCom]! + ki;
      node2com[i] = bestCom;
      if (bestCom !== ci) {
        improved = true;
        moved = true;
      }
    }
  }

  // Renumber communities to dense 0..k-1 in ascending original-id order (stable).
  const unique = [...new Set(node2com)].sort((a, b) => a - b);
  const remap = new Map<number, number>();
  unique.forEach((c, idx) => remap.set(c, idx));
  return { comm: node2com.map((c) => remap.get(c)!), numComms: unique.length, moved };
}

/** Build the aggregated graph: one super-vertex per community. */
function aggregate(level: Level, comm: number[], numComms: number): Level {
  const next = emptyLevel(numComms);
  for (let u = 0; u < level.n; u++) {
    const cu = comm[u]!;
    next.selfLoop[cu] = next.selfLoop[cu]! + level.selfLoop[u]!; // carry internal weight
    for (const [v, w] of level.adj[u]!) {
      if (v < u) continue; // count each undirected pair once
      const cv = comm[v]!;
      if (cu === cv) {
        next.selfLoop[cu] = next.selfLoop[cu]! + w; // now-internal edge (once)
      } else {
        next.adj[cu]!.set(cv, (next.adj[cu]!.get(cv) ?? 0) + w);
        next.adj[cv]!.set(cu, (next.adj[cv]!.get(cu) ?? 0) + w);
      }
    }
  }
  recomputeDegrees(next);
  return next;
}

function emptyLevel(n: number): Level {
  return {
    n,
    adj: Array.from({ length: n }, () => new Map<number, number>()),
    selfLoop: new Array(n).fill(0),
    deg: new Array(n).fill(0),
  };
}

/** deg[i] = 2*selfLoop[i] + sum of incident (non-self) edge weights. */
function recomputeDegrees(level: Level): void {
  for (let i = 0; i < level.n; i++) {
    let d = 2 * level.selfLoop[i]!;
    for (const w of level.adj[i]!.values()) d += w;
    level.deg[i] = d;
  }
}

function identity(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Relabel communities 0..k-1 by the ascending index of their first member. */
function canonicalize(labels: number[]): number[] {
  const firstSeen = new Map<number, number>();
  labels.forEach((l, i) => {
    if (!firstSeen.has(l)) firstSeen.set(l, i);
  });
  const order = [...firstSeen.entries()].sort((a, b) => a[1] - b[1]).map(([l]) => l);
  const remap = new Map<number, number>();
  order.forEach((l, idx) => remap.set(l, idx));
  return labels.map((l) => remap.get(l)!);
}
