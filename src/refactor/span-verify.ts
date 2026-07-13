/**
 * FR-005 / FR-016 span verification — the shared live-byte guard (SPEC-010).
 *
 * Verifies that the live source line, indexed as a UTF-16 JS string slice,
 * actually carries `oldName` at the recorded position, and derives the edit's
 * end from the old name's UTF-16 length. A mismatch — a shadowing declaration,
 * an import alias, a string-similar name, or an index that has drifted from the
 * working tree — drops the edit by returning `null`.
 *
 * Positions are UTF-16 code units end-to-end (SPEC-008 pin): a JS string's
 * `.length` and `.slice` are already UTF-16-code-unit based, so **no** byte↔
 * UTF-16 translation is performed anywhere. The caller reads the file and
 * supplies the line, so this seam stays pure and both plan-time (FR-005) and
 * apply-time (FR-016) reuse it unchanged.
 */

import { SourcePosition, SourceRange } from './types';

/** Inputs to {@link verifySpan}. */
export interface SpanVerifyInput {
  /** The live source line carrying the occurrence (no trailing newline). */
  lineText: string;
  /** The occurrence's start: line 1-indexed, column 0-indexed UTF-16 (graph-native). */
  start: SourcePosition;
  /** The expected old-name text; its UTF-16 `.length` fixes the span end. */
  oldName: string;
}

/**
 * Return the verified {@link SourceRange} when `lineText`'s UTF-16 slice at
 * `start` equals `oldName`, else `null` — the FR-005 / FR-016 false-positive
 * drop. An out-of-range span yields a short slice that cannot equal `oldName`,
 * so no explicit bounds check is needed.
 */
export function verifySpan(input: SpanVerifyInput): SourceRange | null {
  const { lineText, start, oldName } = input;
  const endColumn = start.column + oldName.length; // UTF-16 code units
  if (lineText.slice(start.column, endColumn) !== oldName) return null;
  return { start, end: { line: start.line, column: endColumn } };
}
