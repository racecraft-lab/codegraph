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

/** Identifier-character test (ASCII identifiers) — the same class the graph-path
 *  leftover tally uses, so whole-word matching stays consistent across the module. */
const IDENT_CHAR = /[A-Za-z0-9_$]/;
/** A gap made up entirely of whitespace (the keyword-prefix advance condition). */
const WHITESPACE_ONLY = /^\s+$/;

/**
 * R18 (rp-review, P0) — locate the DECLARATION NAME occurrence of `name` on
 * `lineText`, scanning WHOLE-WORD occurrences at/after `fromColumn`. Returns the
 * 0-indexed UTF-16 start column, or `-1` when `name` never occurs as a whole word
 * at/after `fromColumn`.
 *
 * The recorded node start column is often a KEYWORD, not the name (`function`,
 * `class`, an accessor `get`/`set`, `async`), so a raw `indexOf(name, fromColumn)`
 * lands on the wrong token when a keyword prefix or a decorator EQUALS the name:
 *  - an occurrence immediately preceded by `@` is a DECORATOR reference
 *    (`@foo … foo`), never the declaration name — skip it;
 *  - a keyword prefix equal to the name (`get get`, `set set`, `async async`) sits
 *    immediately left of the real name with only whitespace between, so while the
 *    gap to the NEXT whole-word occurrence is pure whitespace, advance to it.
 * Whole-word = identifier boundary on both sides, so `foo` inside `foobar` is never
 * matched and a same-line parameter of the same name (`function foo(foo: number)`)
 * is reached only if it is the FIRST whole-word occurrence — which the declaration
 * name always precedes (the `(` between them is not whitespace, so no advance).
 * Shared by the graph declaration edit ({@link ../refactor/graph-rename}) and the
 * LSP cursor position ({@link ../refactor/plan-engine}) so both land identically.
 */
export function findDeclarationNameColumn(lineText: string, fromColumn: number, name: string): number {
  if (name.length === 0) return -1;
  const from = Math.max(0, fromColumn);
  const occurrences: number[] = [];
  for (let idx = lineText.indexOf(name, from); idx >= 0; idx = lineText.indexOf(name, idx + 1)) {
    const before = lineText[idx - 1] ?? ''; // out-of-range (incl. idx 0) → '' (a boundary)
    const after = lineText[idx + name.length] ?? '';
    if (!IDENT_CHAR.test(before) && !IDENT_CHAR.test(after)) occurrences.push(idx);
  }
  // Skip a leading decorator reference (`@name`) — never the declaration name.
  let i = 0;
  while (i < occurrences.length && lineText[occurrences[i]! - 1] === '@') i += 1;
  if (i >= occurrences.length) return -1;
  // Advance past a keyword prefix equal to the name while the gap is pure whitespace.
  let col = occurrences[i]!;
  while (i + 1 < occurrences.length) {
    const gap = lineText.slice(col + name.length, occurrences[i + 1]!);
    if (gap.length > 0 && WHITESPACE_ONLY.test(gap)) {
      i += 1;
      col = occurrences[i]!;
    } else {
      break;
    }
  }
  return col;
}

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
