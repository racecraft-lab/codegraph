/**
 * Rungs 3 & 4 of the apply safety ladder (SPEC-010) — the write-integrity core.
 *
 * Owns four seams the apply engine composes (data-model ApplyOutcome pipeline):
 * - {@link takeSnapshots} — an in-memory raw-byte copy of every touched file,
 *   taken BEFORE any write, so a rollback restores byte-identically (FR-018).
 * - {@link reverifySpans} — apply-time re-verification of each planned edit
 *   against the LIVE file bytes; a file that drifted in the plan→apply window is
 *   reported so the engine refuses `stale-span` with zero writes (FR-016).
 * - {@link writeEdits} — per-file temp-sibling → atomic-rename writer that
 *   preserves every byte outside the verified spans (line endings, trailing
 *   newline, BOM, encoding), applies a file's edits descending / right-to-left,
 *   de-duplicates identical ranges, and refuses the whole plan on a genuine
 *   overlap without writing anything (FR-020; the engine then degrades to the
 *   graph path per FR-003a).
 * - {@link restoreSnapshots} — byte-identical rollback; a restore that fails is
 *   reported and its snapshot dumped to a per-incident recovery dir (FR-019a).
 *
 * Encoding: edits index the file's text as a UTF-16 JS string (the SPEC-008
 * position pin — a string's `.length`/`.slice` are already UTF-16-code-unit
 * based, matching `edges.line/col`), but byte preservation is done at the byte
 * level — read a Buffer, detect/strip a BOM, decode utf8, splice the verified
 * spans on the WHOLE string (never a line-split/rejoin that could normalize
 * `\r\n`↔`\n` or drop a final newline), re-encode utf8, re-attach the BOM.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'node:crypto';
import { verifySpan } from './span-verify';
import type { RenameEdit } from './types';

/**
 * The temp-sibling suffix for the atomic write. Deliberately a NON-SOURCE
 * extension so `isSourceFile` (`src/extraction/grammars.ts`) rejects it and the
 * file watcher never re-indexes the half-written temp (FR-020).
 */
export const RENAME_TEMP_SUFFIX = '.codegraph-tmp';

/** {@link reverifySpans} result: all spans matched, or the drifted files. */
export type ReverifyResult = { ok: true } | { ok: false; driftedFiles: string[] };

/**
 * {@link writeEdits} result: the written files, a refused overlap, or a
 * mid-loop write/rename malfunction (D5 review finding) — some earlier files
 * in `editsByFile`'s order may already be written when this fires; the caller
 * (the apply engine) is the one holding the pre-write snapshots, so it is the
 * one that routes this through rollback (FR-019/FR-019a).
 */
export type WriteEditsResult =
  | { ok: true; writtenFiles: string[] }
  | { overlap: true; file: string }
  | { writeError: true; file: string; message: string };

/**
 * {@link restoreSnapshots} result (RecoveryInfo-shaped). `recoveryDir` is set
 * ONLY when a restore failed — the engine surfaces it as the FR-019a `recovery`.
 */
export interface RestoreResult {
  restoredFiles: string[];
  unrestoredFiles: string[];
  recoveryDir?: string;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Whether a file Buffer opens with the 3-byte UTF-8 BOM. */
function hasUtf8Bom(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

/**
 * Line-start offsets (UTF-16 code units) into `text`, indexed 0-based: line N
 * (1-indexed) begins at `starts[N-1]`. Counted by `\n` alone — a CRLF's `\r`
 * remains the previous line's final char and never shifts the next line's start,
 * so intra-line columns and the `\r\n` bytes both stay intact. No separator
 * normalization; this matches the graph's line numbering.
 */
function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) starts.push(i + 1);
  }
  return starts;
}

/** Raw-byte snapshot (a Buffer) of every touched file, keyed by its given path. */
export function takeSnapshots(projectRoot: string, files: string[]): Map<string, Buffer> {
  const snapshots = new Map<string, Buffer>();
  for (const file of files) {
    snapshots.set(file, fs.readFileSync(path.resolve(projectRoot, file)));
  }
  return snapshots;
}

/**
 * Re-verify every planned edit against the live file bytes (FR-016), reusing the
 * FR-005 span check per edit. Reads each file once via the injected `readFile`
 * (a leading BOM is stripped so line-1 columns align with the graph-native,
 * BOM-free column count). Read-only — it never writes.
 */
export function reverifySpans(input: {
  edits: RenameEdit[];
  readFile: (file: string) => string;
}): ReverifyResult {
  const drifted = new Set<string>();
  const lineCache = new Map<string, string[]>();
  for (const edit of input.edits) {
    let lines = lineCache.get(edit.file);
    if (!lines) {
      let content = input.readFile(edit.file);
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1); // strip BOM
      lines = content.split(/\r?\n/);
      lineCache.set(edit.file, lines);
    }
    const lineText = lines[edit.range.start.line - 1] ?? '';
    if (verifySpan({ lineText, start: edit.range.start, oldName: edit.oldText }) === null) {
      drifted.add(edit.file);
    }
  }
  return drifted.size > 0 ? { ok: false, driftedFiles: [...drifted] } : { ok: true };
}

/**
 * Apply the plan's edits, one file at a time, via temp-sibling → atomic rename.
 * Two phases so the whole plan is atomic through detection: Phase 1 computes each
 * file's output bytes and runs the de-dup + overlap checks with NO writes (an
 * overlap in any file refuses before the first byte is written); Phase 2 writes.
 */
export function writeEdits(input: {
  projectRoot: string;
  editsByFile: Map<string, RenameEdit[]>;
}): WriteEditsResult {
  const planned: Array<{ file: string; abs: string; bytes: Buffer }> = [];

  for (const [file, edits] of input.editsByFile) {
    const abs = path.resolve(input.projectRoot, file);
    const raw = fs.readFileSync(abs);
    const bom = hasUtf8Bom(raw);
    const text = (bom ? raw.subarray(3) : raw).toString('utf8');
    const lineStarts = computeLineStarts(text);

    // Absolute UTF-16 [start, end) offsets; end from the old name's UTF-16 length.
    const spans = edits.map((e) => {
      // The line index is valid — reverifySpans passed over these same edits and
      // both derive identical `\n`-based line counts.
      const start = lineStarts[e.range.start.line - 1]! + e.range.start.column;
      return { start, end: start + e.oldText.length, newText: e.newText };
    });

    // De-dup fully-coincident edits (identical range + substitution): a duplicate
    // graph edge for one occurrence must not double-write.
    const seen = new Set<string>();
    const unique = spans.filter((s) => {
      const key = `${s.start}:${s.end}:${s.newText}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Overlap (half-open ranges): after de-dup, a range starting before the prior
    // range's end is a genuine collision — never valid (only a misbehaving LSP
    // edit reaches here). Refuse the whole plan; the engine degrades (FR-003a).
    // (Shared with the D5c plan-time LSP-edit overlap guard — same algorithm,
    // a different offset space; see {@link hasOverlappingSpans}.)
    if (hasOverlappingSpans(unique)) return { overlap: true, file };

    // Apply descending / right-to-left so an applied edit never invalidates an
    // unapplied offset. Whole-string splice — never a line-split/rejoin.
    let out = text;
    for (const s of [...unique].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, s.start) + s.newText + out.slice(s.end);
    }
    const body = Buffer.from(out, 'utf8');
    planned.push({ file, abs, bytes: bom ? Buffer.concat([UTF8_BOM, body]) : body });
  }

  const writtenFiles: string[] = [];
  for (const p of planned) {
    // CodeQL js/insecure-temporary-file (alert #43): a per-write random
    // component makes the temp-sibling name unpredictable — defense against a
    // pre-planted file/symlink at a guessable path. `.codegraph-tmp` stays
    // the TRAILING suffix (isSourceFile's extension check, and every
    // `*.codegraph-tmp` test assertion, key on the suffix alone). `mode:
    // 0o600` closes the CodeQL sink directly (it fires on any writeFileSync
    // with no/insecure mode, independent of name predictability).
    const tmp = path.join(
      path.dirname(p.abs),
      `.${path.basename(p.abs)}.${randomBytes(6).toString('hex')}${RENAME_TEMP_SUFFIX}`,
    );
    try {
      fs.writeFileSync(tmp, p.bytes, { mode: 0o600 });
      fs.renameSync(tmp, p.abs); // atomic within the directory (same filesystem)
    } catch (error) {
      // D5 review finding (BLOCKER): a mid-loop write/rename malfunction
      // (EACCES/ENOSPC/…) — files earlier in `planned`'s order may already be
      // written. Report the cause instead of throwing uncaught, so the caller
      // (which holds the pre-write snapshots) can route the WHOLE plan
      // through rollback rather than leaving a half-renamed workspace.
      // Copilot review finding: best-effort clean up the orphaned temp
      // sibling (e.g. writeFileSync succeeded but the FOLLOWING renameSync
      // is what threw) so a failed write never leaves .codegraph-tmp
      // clutter; swallow any cleanup failure of its own (tmp may never have
      // been created at all) — the ORIGINAL error below is what's reported.
      try {
        fs.unlinkSync(tmp);
      } catch {
        // best-effort — nothing to report if this itself fails
      }
      return { writeError: true, file: p.file, message: error instanceof Error ? error.message : String(error) };
    }
    writtenFiles.push(p.file);
  }
  return { ok: true, writtenFiles };
}

/**
 * True when any two `[start, end)` spans genuinely overlap (one starts before
 * another ends) — spans are assumed already de-duplicated by the caller;
 * merely-adjacent spans (`next.start === prev.end`) are NOT an overlap.
 * Shared by {@link writeEdits}' byte-offset write-time check (FR-020) and the
 * D5c plan-time LSP-edit overlap guard (`src/refactor/plan-engine.ts`,
 * line/column-derived offsets) — same algorithm, two different offset spaces.
 */
export function hasOverlappingSpans(spans: Array<{ start: number; end: number }>): boolean {
  const ascending = [...spans].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ascending.length; i++) {
    if (ascending[i]!.start < ascending[i - 1]!.end) return true;
  }
  return false;
}

/**
 * Write each snapshot's bytes back to its file, byte-identically (FR-019). A file
 * that cannot be written (EACCES/EPERM/ENOSPC) is recorded unrestored and its
 * snapshot dumped — preserving its relative path — to a per-incident recovery dir
 * under `.codegraph/` (PID + random hex so a later incident never clobbers an
 * earlier dump), created ONLY when something failed (FR-019a).
 */
export function restoreSnapshots(input: {
  projectRoot: string;
  snapshots: Map<string, Buffer>;
}): RestoreResult {
  const restoredFiles: string[] = [];
  const unrestoredFiles: string[] = [];
  for (const [file, bytes] of input.snapshots) {
    try {
      // CodeQL js/insecure-temporary-file (alert #44): `mode: 0o600` closes
      // the sink (it fires on any writeFileSync with no/insecure mode). A
      // no-op for the normal restore-of-an-existing-file case — POSIX only
      // applies the mode argument when open() actually CREATES the file, so
      // an existing file's own permission bits are untouched — and only
      // tightens permissions in the edge case where the file was itself
      // deleted and gets recreated here.
      fs.writeFileSync(path.resolve(input.projectRoot, file), bytes, { mode: 0o600 });
      restoredFiles.push(file);
    } catch {
      unrestoredFiles.push(file);
    }
  }
  if (unrestoredFiles.length === 0) return { restoredFiles, unrestoredFiles };

  const recoveryDir = path.join(
    input.projectRoot,
    '.codegraph',
    `rename-recovery-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
  // CodeQL js/insecure-temporary-file (alert #45 covers the per-file write
  // below; this hardens the DIRECTORY the same way): created up front at
  // 0o700 so the incident dump — potentially-sensitive unrestored source —
  // is owner-only from its first file, regardless of how many/which files
  // land inside it (a per-file nested mkdirSync below only ever adds
  // subdirectories INSIDE this already-locked-down directory).
  fs.mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
  for (const file of unrestoredFiles) {
    const dest = path.join(recoveryDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, input.snapshots.get(file)!, { mode: 0o600 });
  }
  return { restoredFiles, unrestoredFiles, recoveryDir };
}
