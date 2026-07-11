/**
 * FR-003 / FR-004 / FR-005 / FR-012 / FR-013 — graph-path rename derivation
 * (SPEC-010). The fallback path used when no language server covers the target's
 * language (LSP path: {@link ../refactor/lsp-rename}).
 *
 * It reads the target's incoming `references` edges (the T007
 * {@link QueryBuilder.getReferencesToNode} statement), derives each occurrence's
 * span from the old name's UTF-16 length (research Decision 8), confirms it
 * against the live line (`verifySpan`, FR-005), and assigns a confidence tier
 * (`classifyEdgeConfidence`, FR-004) — emitting `source:'graph'` edits. The
 * declaration edit is ALWAYS included (an empty-reference plan is valid, not an
 * error — FR-002); a framework self-loop sentinel (`source===target`) is dropped
 * before classification (the endpoints are invisible to the tier function); and
 * un-editable occurrences (comments/strings, synthesized dispatch sites) are only
 * tallied in the leftover-mention FYI, never edited (FR-012/FR-013).
 *
 * Positions are UTF-16 code units end-to-end (SPEC-008 pin); the module reads each
 * touched file once (plan-time span read) and reuses those lines for both the
 * edit `lineText` preview and the leftover tally.
 */

import * as fs from 'fs';
import * as path from 'path';
import { QueryBuilder } from '../db/queries';
import { classifyEdgeConfidence } from './confidence';
import { verifySpan } from './span-verify';
import { ConfidenceTier, RenameEdit, SourceRange } from './types';

export interface DeriveGraphRenameOptions {
  /** The graph the plan reads (same access pattern the T006 tests use). */
  queries: QueryBuilder;
  /** Absolute workspace root; edit `file`s are relative to it. */
  projectRoot: string;
  /** Node id of the resolved rename target (its declaration node). */
  targetId: string;
  /** The requested new name. */
  newName: string;
}

export interface GraphRenameDerivation {
  /** The graph-path edits: the declaration plus every span-verified reference. */
  edits: RenameEdit[];
  /** Non-gating FYI count of un-edited old-name mentions + synthesized dispatch sites (FR-013). */
  leftoverMentions: number;
}

/** Identifier-character test for the whole-word leftover tally (ASCII identifiers). */
const IDENT_CHAR = /[A-Za-z0-9_$]/;

/**
 * Derive the graph-path rename plan for `targetId`. Pure w.r.t. the graph; the
 * only side effect is reading each touched file's bytes for span verification.
 */
export function deriveGraphRename(options: DeriveGraphRenameOptions): GraphRenameDerivation {
  const { queries, projectRoot, targetId, newName } = options;

  const decl = queries.getNodeById(targetId);
  if (!decl) return { edits: [], leftoverMentions: 0 };
  const oldName = decl.name;

  // One read per touched file; its `.split('\n')` lines back both the `lineText`
  // preview and the leftover tally, so a file is never read twice.
  const lineCache = new Map<string, string[]>();
  const readLines = (relFile: string): string[] => {
    let lines = lineCache.get(relFile);
    if (!lines) {
      lines = fs.readFileSync(path.join(projectRoot, relFile), 'utf8').split('\n');
      lineCache.set(relFile, lines);
    }
    return lines;
  };
  const lineAt = (relFile: string, line: number): string =>
    (readLines(relFile)[line - 1] ?? '').replace(/\r$/, '');

  const edits: RenameEdit[] = [];
  const emitted = new Set<string>(); // `${file}:${line}:${column}` of every emitted edit
  const push = (file: string, range: SourceRange, lineText: string, confidence: ConfidenceTier): void => {
    edits.push({ file, range, oldText: oldName, newText: newName, lineText, confidence, source: 'graph' });
    emitted.add(`${file}:${range.start.line}:${range.start.column}`);
  };

  // Declaration edit — always present (FR-002). The node start column is the
  // declaration keyword, so find the NAME occurrence at/after it (research
  // Decision 8), then span-verify it like any other edit; it is `exact` (FR-004).
  const declLine = lineAt(decl.filePath, decl.startLine);
  const declCol = declLine.indexOf(oldName, decl.startColumn);
  if (declCol >= 0) {
    const range = verifySpan({ lineText: declLine, start: { line: decl.startLine, column: declCol }, oldName });
    if (range) push(decl.filePath, range, declLine, 'exact');
  }

  // Reference edits + the synthesized-dispatch leftover count.
  let synthesized = 0;
  for (const ref of queries.getReferencesToNode(targetId)) {
    // Framework self-loop sentinel (`source===target`): a framework-global marker,
    // NEVER a candidate at any tier — dropped before classification, which cannot
    // see the endpoints (FR-004, carried-forward T004 rule).
    if (ref.sourceId === targetId) continue;
    const tier = classifyEdgeConfidence({
      resolvedBy: ref.metadata?.resolvedBy as string | undefined,
      provenance: ref.provenance,
      confidence: ref.metadata?.confidence as number | undefined,
    });
    if (tier === null) {
      // A synthesized (`provenance='heuristic'`) edge's position is a dispatch /
      // wiring site, not a name occurrence — tallied only, never edited (FR-013).
      if (ref.provenance === 'heuristic') synthesized += 1;
      continue;
    }
    if (ref.line == null || ref.column == null) continue;
    const lineText = lineAt(ref.sourceFilePath, ref.line);
    const range = verifySpan({ lineText, start: { line: ref.line, column: ref.column }, oldName });
    if (!range) continue; // FR-005: shadow / alias / string-similar / drift → drop
    push(ref.sourceFilePath, range, lineText, tier);
  }

  // Leftover FYI (FR-013): whole-word old-name occurrences in the TOUCHED files
  // that were not emitted (comments/strings/un-editable import specifiers), plus
  // the synthesized dispatch sites. Cheap — only over files the plan already read.
  const touched = [...new Set(edits.map((e) => e.file))].map((file) => ({ file, lines: readLines(file) }));
  const textual = countTextualLeftovers(touched, oldName, emitted);

  return { edits, leftoverMentions: textual + synthesized };
}

/**
 * Count whole-word `oldName` occurrences across the given pre-split file lines
 * that were NOT emitted as edits — the FR-013 leftover-mention FYI. Shared with
 * the plan engine so the LSP path tallies leftovers with the identical
 * whole-word logic (over the LSP-touched files). `emitted` holds
 * `${file}:${line}:${column}` (line 1-indexed, column 0-indexed) of every edit.
 */
export function countTextualLeftovers(
  files: Array<{ file: string; lines: string[] }>,
  oldName: string,
  emitted: Set<string>,
): number {
  let count = 0;
  for (const { file, lines } of files) {
    lines.forEach((raw, i) => {
      const text = raw.replace(/\r$/, '');
      for (let idx = text.indexOf(oldName); idx >= 0; idx = text.indexOf(oldName, idx + oldName.length)) {
        const before = text[idx - 1] ?? ''; // out-of-range (incl. idx 0) → '' (a boundary)
        const after = text[idx + oldName.length] ?? '';
        if (!IDENT_CHAR.test(before) && !IDENT_CHAR.test(after) && !emitted.has(`${file}:${i + 1}:${idx}`)) {
          count += 1;
        }
      }
    });
  }
  return count;
}
