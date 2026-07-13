/**
 * FR-004 confidence tier — the pure, deterministic
 * `(resolvedBy, provenance) → 'exact' | 'heuristic'` classifier (SPEC-010).
 *
 * No I/O. The tier is **necessary but not sufficient**: every candidate edit
 * must also pass live-byte span verification (`verifySpan`, FR-005 / FR-016),
 * which drops a byte-mismatched edit regardless of tier. This function returns
 * `null` for edges that are **never a rename-edit candidate at any tier** — a
 * `file-path` edge (targets a `file` node, an excluded kind — FR-011) and a
 * `provenance='heuristic'` synthesized edge (its `(line,col)` is a dispatch /
 * wiring site, not a name occurrence — FR-013).
 *
 * Authoritative table: data-model.md "Confidence Tier — FR-004 decision table".
 */

import { EdgeProvenance } from '../types';
import { ConfidenceTier } from './types';

/**
 * The fixed exclusion that splits the shared `instance-method` label (FR-004):
 * a `metadata.confidence` at or above this bound is the declaration-recovered
 * branch (the receiver type came from a real declaration and `Type::method`
 * was confirmed to exist) → `exact`; below it is the capitalization-guess /
 * word-overlap branch → `heuristic`. A **fixed** constant, deliberately not a
 * runtime-configurable threshold.
 */
const INSTANCE_METHOD_EXACT_MIN_CONFIDENCE = 0.85;

/**
 * The fields the FR-004 decision reads from a resolver edge: its `resolvedBy`
 * strategy (from `edges.metadata` — a plain string, so an unrecognized value
 * default-denies to `heuristic`), its `provenance` (`edges.provenance`; NULL
 * for base resolved edges), and `confidence` (`metadata.confidence`, consulted
 * ONLY for the `instance-method` branch split).
 */
export interface EdgeConfidenceInput {
  resolvedBy?: string;
  provenance?: EdgeProvenance | null;
  confidence?: number;
}

/**
 * Classify one resolver edge into its FR-004 tier, or `null` when it is never a
 * rename-edit candidate. See data-model.md for the authoritative table.
 */
export function classifyEdgeConfidence(input: EdgeConfidenceInput): ConfidenceTier | null {
  const { resolvedBy, provenance, confidence } = input;

  // Never a candidate at any tier ---------------------------------------------
  // `file-path` targets a `file` node — an excluded rename kind (FR-011).
  if (resolvedBy === 'file-path') return null;
  // A synthesized edge's stored position is a dispatch site, never a name
  // occurrence — counted only in the leftover-mention FYI (FR-013).
  if (provenance === 'heuristic') return null;

  // exact ---------------------------------------------------------------------
  // An LSP-verified graph edge is compiler-accurate (SPEC-008), whatever
  // strategy first proposed it.
  if (provenance === 'lsp') return 'exact';
  switch (resolvedBy) {
    case 'import': // scoped file/name lookup; refuses rather than guesses
    case 'qualified-name': // scoped qualified lookup; refuses on ambiguity
    case 'function-ref': // exact function/method name, no fuzzy fallback
      return 'exact';
    case 'instance-method':
      // Declaration-recovered branch vs capitalization-guess / word-overlap.
      return (confidence ?? 0) >= INSTANCE_METHOD_EXACT_MIN_CONFIDENCE ? 'exact' : 'heuristic';
    // heuristic ---------------------------------------------------------------
    // `exact-match` / `fuzzy` (last-resort strategies that still emit on a best
    // guess), `framework` (framework resolutions in full, incl. the 1.0
    // self-loop sentinel), and any unenumerated resolvedBy / absent provenance
    // (default-deny) all land here.
    default:
      return 'heuristic';
  }
}
