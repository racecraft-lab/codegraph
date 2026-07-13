/**
 * SPEC-010 Slice-2 apply safety ladder — Rung 5: re-sync discrimination + the
 * FR-018 touched-file-scoped post-check (FR-018 / FR-019).
 *
 * `discriminateSyncResult` separates a genuinely-ran re-sync from the zero-shape
 * no-op (`filesChecked === 0 && durationMs === 0`); `runPostCheck` then asserts
 * zero dangling old-name references across the touched files (dual assertion,
 * never repo-wide). Behavior pinned by the T033 real-SQLite tests.
 */

import type { QueryBuilder } from '../db/queries';
import type { SyncResult } from '../extraction';
import type { DanglingReference } from './types';

/** The two outcomes of apply's OWN re-sync call that FR-018 discriminates. */
export type SyncDiscrimination = 'lock-failure' | 'completed';

/**
 * FR-018 re-sync discrimination. Apply's own `CodeGraph.sync()` resolves to
 * exactly two outcomes: the file-lock-contention **zero-shape** (`filesChecked:0`
 * AND `durationMs:0`, produced only by `sync()`'s lock-acquire failure path —
 * `src/index.ts`) is an apply failure that MUST trigger rollback; ANY other
 * result — including a real empty re-sync (`filesChecked>0`, `filesModified:0`)
 * left by a watcher-driven `sync()` that raced ahead — MUST proceed to the
 * post-check.
 */
export function discriminateSyncResult(r: SyncResult): SyncDiscrimination {
  return r.filesChecked === 0 && r.durationMs === 0 ? 'lock-failure' : 'completed';
}

/** Inputs to the FR-018 touched-file-scoped post-check. */
export interface PostCheckInput {
  queries: QueryBuilder;
  /** The renamed symbol's original name. */
  oldName: string;
  /** The plan's touched files (relative to project root); the post-check scope. */
  touchedFiles: string[];
}

/** Post-check outcome: green, or a machine-actionable dangling-reference list. */
export type PostCheckResult =
  | { ok: true }
  | { ok: false; danglingReferences: DanglingReference[] };

/**
 * FR-018 dual assertion over the touched files, reading LIVE graph state (never
 * the `SyncResult`): (a) no unresolved reference still carries the old name, and
 * (b) no node named the old name remains. Any hit fails the post-check and is
 * surfaced as a {@link DanglingReference} (file + range + old-name occurrence,
 * FR-019). Never repo-wide.
 */
export function runPostCheck({ queries, oldName, touchedFiles }: PostCheckInput): PostCheckResult {
  const danglingReferences: DanglingReference[] = [];

  // (a) unresolved references still carrying the old name. Status-agnostic — a
  //     genuine dangle parks status='failed' after the resolution-complete sync,
  //     so this must NOT inherit the pending-only filter (T028).
  for (const ref of queries.getUnresolvedRefsByNameInFiles(oldName, touchedFiles)) {
    danglingReferences.push({
      // Non-null: the query filters `file_path IN (touchedFiles)`, and SQL
      // `NULL IN (...)` is never true, so every returned row has a file path.
      file: ref.filePath!,
      range: {
        start: { line: ref.line, column: ref.column },
        end: { line: ref.line, column: ref.column + oldName.length },
      },
      name: oldName,
    });
  }

  // (b) nodes still named the old name — a leftover declaration in a touched file.
  for (const node of queries.getNodesByNameInFiles(oldName, touchedFiles)) {
    danglingReferences.push({
      file: node.filePath,
      range: {
        start: { line: node.startLine, column: node.startColumn },
        end: { line: node.endLine, column: node.endColumn },
      },
      name: oldName,
    });
  }

  return danglingReferences.length === 0 ? { ok: true } : { ok: false, danglingReferences };
}
