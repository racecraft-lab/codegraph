/**
 * FR-027 — rename-plan rendering (SPEC-010). Two encodings of the ONE
 * {@link RenamePlan} value object:
 *
 * - {@link formatRenamePlanTable} — the default human-readable plan, grouped by
 *   file, each source line shown as a before/after preview (composed
 *   right-to-left for a same-line multi-edit), with a per-edit confidence tier
 *   and an aggregate + leftover-mention footer.
 * - {@link serializeRenamePlanJson} — the `-j/--json` canonical serialization:
 *   stable object-key order, UTF-8, no insignificant whitespace, byte-identical
 *   to the `codegraph_rename` MCP result (SC-005). This is the SOLE boundary
 *   where internal graph-native positions (line 1-indexed, `column` 0-indexed)
 *   convert to the LSP-style 0-based surface (`line`/`character`).
 *
 * Pure — no I/O, no graph access; every byte it needs is already on the plan
 * (`lineText` from the plan-time span read, FR-005/SC-001).
 */

import { Candidate, Refusal, RenameEdit, RenamePlan, SourcePosition, SourceRange } from './types';

// --- Same-line composition (FR-027) ----------------------------------------

/**
 * Compose the single after-line for a source line carrying `edits`, applied
 * **right-to-left by `range` start** so an earlier column's offsets stay valid
 * while a later column is rewritten first. Input order is irrelevant — the
 * composer sorts descending — so the same before-line + edit set always yields
 * the same after-line (FR-027 same-line composition note).
 */
export function composeAfterLine(lineText: string, edits: RenameEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.range.start.column - a.range.start.column);
  let out = lineText;
  for (const edit of ordered) {
    out = out.slice(0, edit.range.start.column) + edit.newText + out.slice(edit.range.end.column);
  }
  return out;
}

// --- Human table (default) --------------------------------------------------

/**
 * Render the default human-readable plan. A refusal renders its reason + the
 * actionable guidance message PLUS whichever machine-actionable payload it
 * carries ({@link renderRefusal}); a plan renders each file group with a per-edit
 * row and a composed before/after preview, then an aggregate + leftover footer.
 */
export function formatRenamePlanTable(plan: RenamePlan): string {
  if (plan.refusal) {
    return renderRefusal(plan.refusal);
  }

  const lines: string[] = [];
  if (plan.target) {
    lines.push(`rename ${plan.target.name} (${plan.target.kind}) → ${plan.newName}`);
  }

  for (const [file, fileEdits] of groupBy(plan.edits ?? [], (e) => e.file)) {
    lines.push(file);
    for (const [startLine, lineEdits] of groupBy(fileEdits, (e) => e.range.start.line)) {
      for (const edit of lineEdits) {
        lines.push(`  ${startLine}:${edit.range.start.column}  ${edit.confidence}  ${edit.oldText} → ${edit.newText}`);
      }
      const before = lineEdits[0]!.lineText;
      lines.push(`    - ${before}`);
      lines.push(`    + ${composeAfterLine(before, lineEdits)}`);
    }
  }

  const footer = [`confidence: ${plan.confidence ?? 'n/a'}`];
  if (plan.leftoverMentions !== undefined) footer.push(`${plan.leftoverMentions} leftover mention(s)`);
  lines.push('', footer.join(' · '));
  return lines.join('\n') + '\n';
}

/**
 * Render a success-shaped refusal for the human surface (FR-007): the reason +
 * guidance message, then whichever machine-actionable payload the reason carries,
 * each block emitted ONLY when present (so a bare refusal stays reason+message,
 * with no stray headers). This closes the Slice-1 gap where the human table
 * listed nothing while its message said "the listed selectors":
 * - `candidates` (ambiguous-target) — one line each: `selector  kind  file:line`,
 *   so a qualified retry needs no file read (SC-003, now on the human path too).
 * - `validKinds` (invalid-argument on an unrecognized kind) — the recognized set.
 * - `files` (stale-span / out-of-root / scope-ignored) — the offending files.
 * - `gatedEdits` (heuristic-gated) — the below-`exact` edits, `file:line  tier`.
 */
function renderRefusal(refusal: Refusal): string {
  const lines: string[] = [`refused: ${refusal.reason}`, refusal.message];
  if (refusal.candidates?.length) {
    lines.push('candidates:');
    for (const c of refusal.candidates) lines.push(`  ${c.selector}  ${c.kind}  ${c.file}:${c.line}`);
  }
  if (refusal.validKinds?.length) {
    lines.push(`valid kinds: ${refusal.validKinds.join(', ')}`);
  }
  if (refusal.files?.length) {
    lines.push('files:');
    for (const f of refusal.files) lines.push(`  ${f}`);
  }
  if (refusal.gatedEdits?.length) {
    lines.push('gated edits:');
    for (const e of refusal.gatedEdits) lines.push(`  ${e.file}:${e.range.start.line}  ${e.confidence}`);
  }
  return lines.join('\n') + '\n';
}

/** Ordered group-by that preserves first-seen key order (edits arrive sorted). */
function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = out.get(k);
    if (arr) arr.push(item);
    else out.set(k, [item]);
  }
  return out;
}

// --- Canonical JSON (-j/--json ≡ MCP result, SC-005) ------------------------

/**
 * Serialize the plan to the canonical surface JSON string: stable key order (the
 * schema's property order), no insignificant whitespace, positions converted
 * once from internal 1-indexed line to the LSP-style 0-based surface.
 */
export function serializeRenamePlanJson(plan: RenamePlan): string {
  return JSON.stringify(toSurfacePlan(plan));
}

/** Internal (line 1-indexed, column 0-indexed) → surface (0-based line/character). */
function toSurfacePosition(p: SourcePosition): { line: number; character: number } {
  return { line: p.line - 1, character: p.column };
}

function toSurfaceRange(r: SourceRange): { start: { line: number; character: number }; end: { line: number; character: number } } {
  return { start: toSurfacePosition(r.start), end: toSurfacePosition(r.end) };
}

function toSurfaceEdit(e: RenameEdit): Record<string, unknown> {
  return {
    file: e.file,
    range: toSurfaceRange(e.range),
    oldText: e.oldText,
    newText: e.newText,
    lineText: e.lineText,
    confidence: e.confidence,
    source: e.source,
  };
}

function toSurfaceCandidate(c: Candidate): Record<string, unknown> {
  return { name: c.name, kind: c.kind, file: c.file, line: c.line, selector: c.selector };
}

function toSurfaceRefusal(r: Refusal): Record<string, unknown> {
  const out: Record<string, unknown> = { reason: r.reason, message: r.message };
  if (r.candidates) out.candidates = r.candidates.map(toSurfaceCandidate);
  if (r.files) out.files = r.files;
  if (r.gatedEdits) out.gatedEdits = r.gatedEdits.map(toSurfaceEdit);
  if (r.validKinds) out.validKinds = r.validKinds;
  return out;
}

/**
 * Build the surface plan object with keys inserted in the schema's declared
 * order (so `JSON.stringify` emits them canonically) and only the fields that
 * are present (`additionalProperties: false` — never an undefined-valued key).
 */
function toSurfacePlan(plan: RenamePlan): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (plan.target) {
    out.target = {
      name: plan.target.name,
      kind: plan.target.kind,
      file: plan.target.file,
      range: toSurfaceRange(plan.target.range),
    };
  }
  out.newName = plan.newName;
  if (plan.edits) out.edits = plan.edits.map(toSurfaceEdit);
  if (plan.confidence) out.confidence = plan.confidence;
  if (plan.source) out.source = plan.source;
  if (plan.leftoverMentions !== undefined) out.leftoverMentions = plan.leftoverMentions;
  out.applied = plan.applied;
  if (plan.refusal) out.refusal = toSurfaceRefusal(plan.refusal);
  return out;
}
