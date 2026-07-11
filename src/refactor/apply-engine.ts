/**
 * SPEC-010 Slice-2 apply safety ladder — the engine (FR-014 → FR-020 / FR-019a).
 *
 * Composes the Rung seams in the CONTRACTUAL runtime order (data-model.md
 * "ApplyOutcome — state transitions"); each gate either advances or exits to one
 * of the four terminal {@link ApplyOutcome}s, so every apply resolves to exactly
 * one state (SC-002):
 *
 *   recompute plan (FR-014)      {@link planRename} — the LIVE index, no persisted artifact
 *     → confidence gate (FR-015) any below-`exact` edit + no includeHeuristic → refused:heuristic-gated
 *     → jail / scope (FR-017)    {@link checkPlanJail} → refused:out-of-root | scope-ignored
 *     → snapshot (FR-018/FR-020) {@link takeSnapshots} — in-memory bytes, before any write
 *     → span re-verify (FR-016)  {@link reverifySpans} → refused:stale-span (ZERO writes)
 *     → atomic write (FR-020)    {@link writeEdits}; an LSP-set overlap re-derives via graph ONCE (FR-003a)
 *     → re-sync (FR-018)         the injected `sync`; the lock-failure zero-shape → rollback
 *     → post-check (FR-018)      {@link runPostCheck}; a dangle → rollback
 *     → applied                  post-check green (exit 0)
 *
 * Rollback (FR-019): restore every touched file byte-identically from its
 * snapshot, re-sync, and report the dangles → `rolled-back`; a restore that itself
 * fails (FR-019a) → `rollback-failed` carrying the recovery dump — the SOLE
 * error-shaped terminal on this surface (FR-023), never re-syncing a workspace
 * left in an unknown partial state.
 *
 * Dependency-injected exactly like {@link planRename} (the graph handle, project
 * root, resolved LSP config) plus the resolution-complete re-sync as an injected
 * `sync` fn, so `CodeGraph.applyRename` (T041) stays a thin wrapper. No global
 * state; every edit path is resolved against `projectRoot`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { QueryBuilder } from '../db/queries';
import { SyncResult } from '../extraction';
import { EffectiveLspConfig } from '../lsp';
import { checkPlanJail } from './jail';
import { planRename } from './plan-engine';
import { discriminateSyncResult, runPostCheck } from './post-check';
import { reverifySpans, restoreSnapshots, takeSnapshots, writeEdits } from './snapshot';
import {
  ApplyResult,
  DanglingReference,
  RecoveryInfo,
  Refusal,
  RenameEdit,
  TargetSelector,
} from './types';

export interface ApplyRenameOptions {
  /** The graph the recompute + post-check read (same handle {@link planRename} takes). */
  queries: QueryBuilder;
  /** Absolute workspace root; every edit path resolves against it. */
  projectRoot: string;
  /** The user's target identity (FR-006). */
  selector: TargetSelector;
  /** The requested new name. */
  newName: string;
  /** Resolved SPEC-008 LSP config; gates the LSP path in the recompute (FR-003a). */
  lspConfig: EffectiveLspConfig;
  /** Env override for the LSP probe + spawned server (defaults to planRename's). */
  env?: Record<string, string | undefined>;
  /** FR-015: allow below-`exact` edits through the confidence gate. */
  includeHeuristic?: boolean;
  /**
   * The resolution-complete re-sync (FR-018) — `CodeGraph.sync` bound to the live
   * instance, injected so the engine stays testable and T041 stays thin. Called
   * once after the write and once more after a rollback restore (FR-019).
   */
  sync: () => Promise<SyncResult>;
}

/**
 * Run the FR-014→FR-020 apply ladder for `selector` → `newName`, resolving to one
 * {@link ApplyResult} terminal. Recomputes the plan from the live index — no
 * dry-run artifact is trusted (FR-014).
 */
export async function applyRename(options: ApplyRenameOptions): Promise<ApplyResult> {
  return runLadder(options, false);
}

/**
 * The ladder body. `reDerived` is set on the single graph-forced restart after an
 * LSP-set overlap (FR-003a): it disables the LSP path so the recompute takes the
 * graph, and blocks a second restart.
 */
async function runLadder(options: ApplyRenameOptions, reDerived: boolean): Promise<ApplyResult> {
  const { queries, projectRoot, selector, newName, env, includeHeuristic, sync } = options;

  // Rung 0 — recompute the plan from the LIVE index (FR-014). A restart after an
  // LSP-set overlap forces the graph path by disabling LSP for this recompute.
  const lspConfig = reDerived ? { ...options.lspConfig, enabled: false } : options.lspConfig;
  const plan = await planRename({ queries, projectRoot, selector, newName, lspConfig, env });

  // A recompute-time refusal (target-not-found / ambiguous / invalid-argument /
  // unsupported-kind / excluded-kind / not-indexed) is a pre-write refusal.
  if (plan.refusal) return refused(plan.refusal);
  const edits = plan.edits ?? [];
  if (!plan.target || edits.length === 0) {
    return refused({
      reason: 'target-not-found',
      message: `No renameable symbol matches "${selector.name}".`,
    });
  }
  const oldName = plan.target.name;

  // Rung 1 — confidence gate (FR-015): any below-`exact` edit blocks apply unless
  // includeHeuristic is set; the refusal lists the gated edits, ZERO writes.
  if (!includeHeuristic) {
    const gatedEdits = edits.filter((e) => e.confidence !== 'exact');
    if (gatedEdits.length > 0) {
      return refused({
        reason: 'heuristic-gated',
        message:
          `Refusing to apply: ${gatedEdits.length} edit${gatedEdits.length === 1 ? ' is' : 's are'} ` +
          `below \`exact\` confidence. Re-run with --include-heuristic to apply them, or narrow the rename.`,
        gatedEdits,
      });
    }
  }

  // Rung 2 — path jail + index-scope guard (FR-017). Whole-plan, refuse-before-read.
  const files = [...new Set(edits.map((e) => e.file))];
  const jail = checkPlanJail({ projectRoot, files });
  if (jail) return refused(jail);

  // Rung 3 — pre-write in-memory byte snapshots of every touched file (FR-018/FR-020),
  // taken BEFORE any write so a rollback restores byte-identically.
  const snapshots = takeSnapshots(projectRoot, files);

  // Rung 3b — apply-time span re-verify against the LIVE bytes (FR-016). A file
  // that drifted in the recompute→write window refuses `stale-span` with the
  // drifted files named and ZERO writes.
  const reverify = reverifySpans({
    edits,
    readFile: (file) => fs.readFileSync(path.resolve(projectRoot, file), 'utf8'),
  });
  if (!reverify.ok) {
    return refused({
      reason: 'stale-span',
      message:
        `Refusing to apply: the live bytes of ${reverify.driftedFiles.join(', ')} no longer match ` +
        `the planned span (the index is stale). Run \`codegraph sync\` and retry.`,
      files: reverify.driftedFiles,
    });
  }

  // Rung 4 — atomic write (FR-020). A genuine partial overlap can only originate
  // from a misbehaving LSP workspace edit: re-derive via the graph path and
  // restart the ladder ONCE (FR-003a). A graph-set overlap is impossible by FR-005
  // (span-verified occurrences are disjoint) — a malfunction, surfaced as an
  // internal error rather than a silent double-write.
  const write = writeEdits({ projectRoot, editsByFile: groupByFile(edits) });
  if ('overlap' in write) {
    if (plan.source === 'lsp' && !reDerived) return runLadder(options, true);
    throw new Error(
      `codegraph rename: overlapping edit ranges in the graph-derived plan for ${write.file} — ` +
        `graph-path occurrences are disjoint by construction (FR-005); this is an internal error.`,
    );
  }
  const touchedFiles = write.writtenFiles;

  // Rung 5 — resolution-complete re-sync (FR-018). The lock-failure zero-shape
  // (`filesChecked:0`, `durationMs:0`) is an apply failure → unconditional
  // rollback; any other result proceeds to the post-check.
  const syncResult = await sync();
  if (discriminateSyncResult(syncResult) === 'lock-failure') {
    return rollback(options, snapshots, touchedFiles, []);
  }

  // Rung 5b — touched-file-scoped post-check (FR-018). A dangling old-name ref or a
  // leftover old-name node → unconditional rollback (FR-019).
  const postCheck = runPostCheck({ queries, oldName, touchedFiles });
  if (!postCheck.ok) {
    return rollback(options, snapshots, touchedFiles, postCheck.danglingReferences);
  }

  // Terminal — post-check green (FR-018). Snapshots are dropped (held only to here).
  return { outcome: 'applied', touchedFiles, postCheckPassed: true };
}

/** A pre-write, success-shaped refusal terminal — zero writes (FR-023). */
function refused(refusal: Refusal): ApplyResult {
  return { outcome: 'refused', touchedFiles: [], postCheckPassed: false, refusal };
}

/**
 * Unconditional rollback (FR-019 / FR-019a). Restore every touched file
 * byte-identically from its snapshot; a fully-restored workspace re-syncs and
 * returns `rolled-back` with the dangles that forced it, while a restore that
 * itself failed returns the sole error-shaped terminal `rollback-failed` carrying
 * the {@link RecoveryInfo} dump — never re-syncing a workspace left in an unknown
 * state.
 */
async function rollback(
  options: ApplyRenameOptions,
  snapshots: Map<string, Buffer>,
  touchedFiles: string[],
  danglingReferences: DanglingReference[],
): Promise<ApplyResult> {
  const restore = restoreSnapshots({ projectRoot: options.projectRoot, snapshots });
  if (restore.unrestoredFiles.length > 0) {
    const recovery: RecoveryInfo = {
      restoredFiles: restore.restoredFiles,
      unrestoredFiles: restore.unrestoredFiles,
      recoveryDir: restore.recoveryDir!,
    };
    return { outcome: 'rollback-failed', touchedFiles, postCheckPassed: false, recovery };
  }
  // FR-019: re-sync the restored workspace so the graph matches the pre-apply bytes.
  await options.sync();
  return { outcome: 'rolled-back', touchedFiles, postCheckPassed: false, danglingReferences };
}

/** Group a plan's edits by their file, preserving the deterministic plan order. */
function groupByFile(edits: RenameEdit[]): Map<string, RenameEdit[]> {
  const byFile = new Map<string, RenameEdit[]>();
  for (const edit of edits) {
    const list = byFile.get(edit.file);
    if (list) list.push(edit);
    else byFile.set(edit.file, [edit]);
  }
  return byFile;
}
