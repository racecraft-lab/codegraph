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
import { normalizePath } from '../utils';
import { checkPlanJail } from './jail';
import { planRename } from './plan-engine';
import { discriminateSyncResult, runPostCheck } from './post-check';
import { reverifySpans, restoreSnapshots, takeSnapshots, writeEdits } from './snapshot';
import type { ReverifyResult } from './snapshot';
import {
  ApplyResult,
  DanglingReference,
  RecoveryInfo,
  Refusal,
  RenameEdit,
  TargetSelector,
  WriteFailure,
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
  // taken BEFORE any write so a rollback restores byte-identically. A file that is
  // UNREADABLE here (e.g. deleted between the recompute above and this point —
  // Copilot review finding) gets the SAME zero-write refusal Rung 3b already
  // gives an unreadable file below: nothing has been written yet, so there is
  // nothing to roll back. takeSnapshots has no injected read seam (unlike
  // reverifySpans below), so the failing file is recovered from the thrown
  // error's own `.path` instead.
  let snapshots: Map<string, Buffer>;
  try {
    snapshots = takeSnapshots(projectRoot, files);
  } catch (error) {
    return unreadableFileRefusal(unreadableFileFromError(error, projectRoot, files));
  }

  // Rung 3b — apply-time span re-verify against the LIVE bytes (FR-016). A file
  // that drifted in the recompute→write window refuses `stale-span` with the
  // drifted files named and ZERO writes. Read-only, so a file that is
  // UNREADABLE here (e.g. deleted between the recompute above and this point
  // — D5 review finding, BLOCKER) is treated the SAME as a drifted span:
  // nothing has been written yet, so the correct terminal is the identical
  // zero-write refusal, never an uncaught throw — there is nothing to roll back.
  let reverify: ReverifyResult;
  let unreadableFile: string | undefined;
  try {
    reverify = reverifySpans({
      edits,
      readFile: (file) => {
        try {
          return fs.readFileSync(path.resolve(projectRoot, file), 'utf8');
        } catch (error) {
          unreadableFile = file;
          throw error;
        }
      },
    });
  } catch {
    return unreadableFileRefusal(unreadableFile);
  }
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
  // internal error rather than a silent double-write. A mid-loop write/rename
  // malfunction (EACCES/ENOSPC/…, D5 review finding, BLOCKER) may have already
  // mutated earlier files in the plan — route the WHOLE plan through the SAME
  // rollback the post-check-failure branch uses, carrying the cause.
  const write = writeEdits({ projectRoot, editsByFile: groupByFile(edits) });
  if ('overlap' in write) {
    if (plan.source === 'lsp' && !reDerived) return runLadder(options, true);
    throw new Error(
      `codegraph rename: overlapping edit ranges in the graph-derived plan for ${write.file} — ` +
        `graph-path occurrences are disjoint by construction (FR-005); this is an internal error.`,
    );
  }
  if ('writeError' in write) {
    // B4 (rp-review): roll back ONLY the files actually written before the
    // failure — restoring the full snapshot map would clobber any concurrent
    // external modification to a not-yet-written file. `touchedFiles` is likewise
    // just the written set.
    const writtenSnapshots = new Map(write.writtenFiles.map((f) => [f, snapshots.get(f)!]));
    return rollback(options, writtenSnapshots, write.writtenFiles, [], { file: write.file, message: write.message });
  }
  const touchedFiles = write.writtenFiles;

  // Rungs 5/5b run AFTER the write, so a THROW from either (the injected re-sync
  // or the post-check probes) must not escape with renamed files left on disk —
  // the taxonomy's worst un-modeled state (B1 review finding, BLOCKER). Restore
  // every touched file byte-identically first: if the restore fully succeeds,
  // RETHROW the original error (the workspace is clean, so the CLI's exit-1
  // internal-error path is honest); if the restore itself fails, return the
  // `rollback-failed` recovery terminal instead (never leave the workspace in an
  // unknown partial state, nor claim `applied`).
  try {
    // Rung 5 — resolution-complete re-sync (FR-018). The lock-failure zero-shape
    // (`filesChecked:0`, `durationMs:0`) is an apply failure → unconditional
    // rollback; any other result proceeds to the post-check.
    const syncResult = await sync();
    if (discriminateSyncResult(syncResult) === 'lock-failure') {
      return await rollback(options, snapshots, touchedFiles, []);
    }

    // Rung 5b — touched-file-scoped post-check (FR-018). A dangling old-name ref or
    // a leftover old-name node → unconditional rollback (FR-019).
    const postCheck = runPostCheck({ queries, oldName, touchedFiles });
    if (!postCheck.ok) {
      return await rollback(options, snapshots, touchedFiles, postCheck.danglingReferences);
    }

    // Terminal — post-check green (FR-018). Snapshots are dropped (held only to here).
    return { outcome: 'applied', touchedFiles, postCheckPassed: true };
  } catch (error) {
    return restoreOrRethrow(options, snapshots, touchedFiles, error);
  }
}

/** A pre-write, success-shaped refusal terminal — zero writes (FR-023). */
function refused(refusal: Refusal): ApplyResult {
  return { outcome: 'refused', touchedFiles: [], postCheckPassed: false, refusal };
}

/**
 * A pre-write refusal for a touched file that could not be read — Rung 3
 * (takeSnapshots) and Rung 3b (reverifySpans) both route an unreadable
 * touched file here: it is treated identically to a drifted span (FR-016),
 * since nothing has been written yet and there is nothing to roll back
 * (Copilot review finding, Rung 3; D5 review finding, Rung 3b).
 */
function unreadableFileRefusal(file: string | undefined): ApplyResult {
  return refused({
    reason: 'stale-span',
    message:
      `Refusing to apply: the live bytes of ${file} could not be read ` +
      `(it may have been deleted since the plan was made). Run \`codegraph sync\` and retry.`,
    files: file ? [file] : [],
  });
}

/**
 * Recover the workspace-relative file name from a thrown fs read error's
 * `.path` (a standard Node `ErrnoException` field, set by every `fs.read*`
 * throw) — takeSnapshots itself throws whatever `fs.readFileSync` throws,
 * with no injected seam to capture which file failed, so the caller derives
 * it from the error instead. `normalizePath` matches the same win32
 * forward-slash convention `path.relative`'s other callers already apply
 * (D5-win review finding).
 */
function unreadableFileFromError(error: unknown, projectRoot: string, files: string[]): string | undefined {
  const raw = error && typeof error === 'object' && 'path' in error ? (error as { path?: unknown }).path : undefined;
  if (typeof raw !== 'string') return files[0];
  return normalizePath(path.relative(projectRoot, raw));
}

/**
 * Unconditional rollback (FR-019 / FR-019a). Restore every touched file
 * byte-identically from its snapshot; a fully-restored workspace re-syncs and
 * returns `rolled-back` with the dangles that forced it, while a restore that
 * itself failed returns the sole error-shaped terminal `rollback-failed` carrying
 * the {@link RecoveryInfo} dump — never re-syncing a workspace left in an unknown
 * state. `writeFailure` is orthogonal to which of those two outcomes this
 * resolves to — it names a Rung-4 write malfunction as the CAUSE of the
 * rollback (D5 review finding), present on EITHER outcome depending on
 * whether the restore that follows it also succeeds.
 */
async function rollback(
  options: ApplyRenameOptions,
  snapshots: Map<string, Buffer>,
  touchedFiles: string[],
  danglingReferences: DanglingReference[],
  writeFailure?: WriteFailure,
): Promise<ApplyResult> {
  const restore = restoreSnapshots({ projectRoot: options.projectRoot, snapshots });
  if (restore.unrestoredFiles.length > 0) {
    // B5 (rp-review): `recoveryDir` is absent when the dump itself also failed.
    const recovery: RecoveryInfo = {
      restoredFiles: restore.restoredFiles,
      unrestoredFiles: restore.unrestoredFiles,
      ...(restore.recoveryDir !== undefined && { recoveryDir: restore.recoveryDir }),
    };
    return { outcome: 'rollback-failed', touchedFiles, postCheckPassed: false, recovery, ...(writeFailure && { writeFailure }) };
  }
  // FR-019: re-sync the restored workspace so the graph matches the pre-apply
  // bytes. B2 (rp-review): this re-sync can ITSELF fail (throw, or return the
  // lock-failure zero-shape) AFTER the bytes were already restored — the
  // rollback still succeeded (`rolled-back`), but the index no longer matches, so
  // flag `resyncFailed` (the human table then instructs `codegraph sync`). Never
  // let this post-restore failure escape as an uncaught throw.
  let resyncFailed = false;
  try {
    if (discriminateSyncResult(await options.sync()) === 'lock-failure') resyncFailed = true;
  } catch {
    resyncFailed = true;
  }
  return {
    outcome: 'rolled-back',
    touchedFiles,
    postCheckPassed: false,
    danglingReferences,
    ...(writeFailure && { writeFailure }),
    ...(resyncFailed && { resyncFailed }),
  };
}

/**
 * B1 (rp-review) — a post-write THROW (from the injected re-sync or the
 * post-check) landed here. Restore every touched file byte-identically from its
 * snapshot; if the restore fully succeeds, RETHROW the original error so the
 * caller sees an honest exit-1 internal error over a clean workspace; if the
 * restore ITSELF fails, return the `rollback-failed` recovery terminal instead —
 * never re-sync a workspace left in an unknown partial state, nor leak the throw
 * over renamed-but-not-restored files. Distinct from {@link rollback}: a throw is
 * not a modeled `rolled-back` dangle outcome, so there is no dangle list.
 */
async function restoreOrRethrow(
  options: ApplyRenameOptions,
  snapshots: Map<string, Buffer>,
  touchedFiles: string[],
  error: unknown,
): Promise<ApplyResult> {
  const restore = restoreSnapshots({ projectRoot: options.projectRoot, snapshots });
  if (restore.unrestoredFiles.length > 0) {
    const recovery: RecoveryInfo = {
      restoredFiles: restore.restoredFiles,
      unrestoredFiles: restore.unrestoredFiles,
      ...(restore.recoveryDir !== undefined && { recoveryDir: restore.recoveryDir }),
    };
    return { outcome: 'rollback-failed', touchedFiles, postCheckPassed: false, recovery };
  }
  // R15 (round-2 review): the throw can land AFTER the Rung-5 re-sync already
  // SUCCEEDED (e.g. the post-check threw), so the index reflects the RENAMED
  // files while the bytes above were just restored to the OLD name — graph and
  // workspace disagree. Re-sync the restored bytes so the index matches again
  // BEFORE rethrowing. Guarded: a re-sync failure here (a throw, or the
  // lock-failure zero-shape — the result is deliberately ignored) must NEVER mask
  // the original error, which is the surface the caller acts on; `codegraph sync`
  // / the daemon watcher self-heals a still-stale index.
  try {
    await options.sync();
  } catch {
    // swallowed — the original `error` below is what the caller must see
  }
  throw error; // workspace restored byte-identically — the exit-1 path is honest
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
