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
/**
 * The first signature delimiter after a declaration name — an opening paren, an
 * assignment `=`, a type-annotation `:`, a body `{`, a statement terminator `;`,
 * or a generic `<`. The declaration name is the LAST whole-word occurrence BEFORE
 * the first of these on the line; anything at/after is a parameter, type, value,
 * or body, never the name.
 */
const SIGNATURE_DELIMITER = /[(={:;<]/;

/**
 * R18/R22 (rp-review, P0) — locate the DECLARATION NAME occurrence of `name` on
 * `lineText`, scanning WHOLE-WORD occurrences at/after `fromColumn`. Returns the
 * 0-indexed UTF-16 start column, or `-1` when `name` never occurs as a whole word
 * at/after `fromColumn`.
 *
 * The recorded node start column is often a KEYWORD, not the name (`function`,
 * `class`, an accessor `get`/`set`, `async`), so a raw `indexOf(name, fromColumn)`
 * lands on the wrong token when a keyword prefix or a decorator EQUALS the name.
 * Two rules pick the real name:
 *  - an occurrence immediately preceded by `@` is a DECORATOR reference
 *    (`@foo … foo`), never the declaration name — drop it from the candidates;
 *  - among the remaining whole-word occurrences, take the LAST one BEFORE the first
 *    {@link SIGNATURE_DELIMITER} on the line. The name always sits just left of its
 *    own `(`/`=`/`:`/`{`/`;`/`<`, while a keyword prefix that equals the name
 *    (`get get`, `async function async`) sits even further left — so the
 *    last-before-delimiter occurrence is the name regardless of what fills the gap
 *    (whitespace, a block comment, or an intervening keyword). R22: the earlier
 *    whitespace-only advance broke on a comment/keyword gap, keeping the keyword —
 *    which then span-verified and got rewritten on --apply (round-3 finding).
 * If NO candidate precedes the first delimiter — a receiver/parenthesized prefix
 * opens the line before the name (Go `func (s *Server) foo(`) — fall back to the
 * FIRST whole-word occurrence at/after `fromColumn`. Whole-word = identifier
 * boundary on both sides (`foo` inside `foobar` never matches). No string-literal
 * awareness is needed at this altitude: {@link verifySpan} re-checks the chosen
 * column against the live bytes and drops a mismatch. Shared by the graph
 * declaration edit ({@link ../refactor/graph-rename}) and the LSP cursor position
 * ({@link ../refactor/plan-engine}) so both land identically.
 */
export function findDeclarationNameColumn(lineText: string, fromColumn: number, name: string): number {
  if (name.length === 0) return -1;
  const from = Math.max(0, fromColumn);
  // Whole-word occurrences of `name` at/after `fromColumn` (ascending), dropping a
  // decorator reference (`@name`) — never the declaration name.
  const occurrences: number[] = [];
  for (let idx = lineText.indexOf(name, from); idx >= 0; idx = lineText.indexOf(name, idx + 1)) {
    const before = lineText[idx - 1] ?? ''; // out-of-range (incl. idx 0) → '' (a boundary)
    const after = lineText[idx + name.length] ?? '';
    if (IDENT_CHAR.test(before) || IDENT_CHAR.test(after)) continue; // not whole-word
    if (before === '@') continue; // decorator reference
    occurrences.push(idx);
  }
  if (occurrences.length === 0) return -1;
  // The first signature delimiter at/after `fromColumn` (line end when none).
  let delimiter = lineText.length;
  for (let idx = from; idx < lineText.length; idx += 1) {
    if (SIGNATURE_DELIMITER.test(lineText[idx]!)) {
      delimiter = idx;
      break;
    }
  }
  // The LAST occurrence before the delimiter is the name; if none precedes it (a
  // receiver/parenthesized prefix opened the line), fall back to the first.
  let chosen = -1;
  for (const idx of occurrences) {
    if (idx < delimiter) chosen = idx;
    else break;
  }
  return chosen >= 0 ? chosen : occurrences[0]!;
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
