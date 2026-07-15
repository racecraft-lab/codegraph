/**
 * SPEC-011 - Functional Clusters: undirected weighted file-graph build (T032).
 *
 * Files are the vertices and each symbol inherits its file's cluster (FR-011).
 * Every cross-file `calls`/`imports` edge counts as weight 1; parallel evidence
 * between the same file pair SUMS into that pair's weight; self-loops (same-file
 * edges) are dropped (FR-012). The result is a deterministic, count-aggregated
 * undirected file-pair graph - the sole input to the deterministic Louvain pass
 * (T033). Read-only over the graph; it never mutates nodes/edges.
 */

import type { QueryBuilder } from '../../db/queries';

/** An undirected weighted file pair. `a < b` (byte order); weight >= 1. */
export interface FilePairEdge {
  a: string;
  b: string;
  weight: number;
}

/**
 * The undirected weighted file graph. `files` is every indexed file as a vertex
 * in stable path order (FR-011/013); `edges` is the count-aggregated undirected
 * pair list with self-loops dropped (FR-012).
 */
export interface FileGraph {
  files: string[];
  edges: FilePairEdge[];
}

/** Collision-free pair key (paths may contain any char except an unescapable one). */
function pairKey(a: string, b: string): string {
  return JSON.stringify([a, b]);
}

/**
 * Build the undirected weighted file graph from the indexed graph (FR-011/012).
 * Vertices are the indexed files (`getAllFiles`), sorted for a stable vertex
 * order. Directed per-file-pair reference weights are folded into undirected
 * pairs (both directions sum), same-file self-loops are dropped, and any pair
 * referencing a non-indexed file is skipped defensively.
 */
export function buildFileGraph(queries: QueryBuilder): FileGraph {
  const files = queries.getAllFiles().map((f) => f.path).sort();
  const vertices = new Set(files);

  const pairWeights = new Map<string, FilePairEdge>();
  for (const { sourceFile, targetFile, weight } of queries.getFilePairEdgeWeights()) {
    if (sourceFile === targetFile) continue; // self-loop dropped (FR-012)
    if (!vertices.has(sourceFile) || !vertices.has(targetFile)) continue; // only real vertices
    const [a, b] = sourceFile < targetFile ? [sourceFile, targetFile] : [targetFile, sourceFile];
    const key = pairKey(a, b);
    const existing = pairWeights.get(key);
    if (existing) existing.weight += weight; // parallel evidence sums (FR-012)
    else pairWeights.set(key, { a, b, weight });
  }

  const edges = [...pairWeights.values()].sort((x, y) =>
    x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0,
  );

  return { files, edges };
}
