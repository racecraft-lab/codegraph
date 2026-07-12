/**
 * Graph-Aware Rename — shared value-object & protocol types (SPEC-010).
 *
 * The in-memory value objects owned by `src/refactor/` (data-model.md) plus the
 * minimal local LSP rename-protocol types (research Decision 1). No schema
 * change: rename reads existing nodes/edges and writes source files.
 *
 * ## Position conventions (the one invariant every downstream module inherits)
 *
 * All offsets are **UTF-16 code units** (SPEC-008 pin; research Decision 2) —
 * no byte↔UTF-16 translation anywhere. There are two indexing conventions, kept
 * as two distinct type families on purpose so a conversion can never be skipped
 * silently:
 *
 * - **Internal** (`SourcePosition` / `SourceRange`) — the graph's native
 *   convention: line **1-indexed**, column **0-indexed** (`src/types.ts` Node
 *   spans). Every in-memory value object here (`Target`, `RenameEdit`,
 *   `DanglingReference`) carries positions in this convention, regardless of
 *   whether the edit was derived from the graph or from an LSP workspace edit.
 * - **LSP / surface** (`Position` / `Range`) — LSP-style: line **0-indexed**,
 *   `character` **0-indexed**. This is both the language-server wire shape and
 *   the surface-JSON shape (`contracts/rename-plan.schema.json` calls the
 *   surface "LSP-style 0-based line/character").
 *
 * The differing field name (`column` internal vs `character` LSP/surface) makes
 * the two families structurally incompatible, so the derivation must convert
 * explicitly at each boundary: once on the LSP-input side (0-based line → 1-based
 * `SourceRange` when translating a `WorkspaceEdit` into `RenameEdit[]`) and once
 * on the surface-output side (1-based `SourceRange` → 0-based JSON at
 * serialization — the "convert once at the surface boundary" of data-model.md).
 */

import { NodeKind } from '../types';

// =============================================================================
// LSP rename protocol (local, minimal — research Decision 1)
//
// No `textDocument/rename` types exist in the repo yet; SPEC-010 defines the
// minimal subset it needs, scoped to `src/refactor/` so upstream files stay
// untouched (constitution Principle III). Line/`character` are 0-indexed
// UTF-16 code units — the LSP default encoding this feature relies on.
// =============================================================================

/**
 * An LSP position: 0-indexed `line`, 0-indexed `character` (UTF-16 code units).
 * Also the surface-JSON position shape (`rename-plan.schema.json` `position`),
 * which is deliberately LSP-style 0-based. Distinct from the internal
 * {@link SourcePosition} (1-indexed line, `column`).
 */
export interface Position {
  /** 0-based line. */
  line: number;
  /** 0-based offset in UTF-16 code units on that line. */
  character: number;
}

/** An LSP range: half-open `[start, end)` over {@link Position}s. */
export interface Range {
  start: Position;
  end: Position;
}

/** A single LSP text edit: replace `range` with `newText`. */
export interface TextEdit {
  range: Range;
  newText: string;
}

/**
 * One entry of a {@link WorkspaceEdit} `documentChanges` array: the ordered
 * text edits for a single document, tagged with its (optionally versioned) URI.
 * Resource operations (create/rename/delete file) are intentionally NOT modeled
 * — a symbol rename edits occurrences in place (FR-011 excludes the `file` kind).
 */
export interface TextDocumentEdit {
  /** LSP `OptionalVersionedTextDocumentIdentifier`. */
  textDocument: { uri: string; version: number | null };
  edits: TextEdit[];
}

/**
 * The result of a `textDocument/rename` request. A server returns edits through
 * exactly one of the two channels, both keyed by document URI:
 * - `changes` — a URI → edits map (older shape), or
 * - `documentChanges` — an array of {@link TextDocumentEdit} (preferred shape).
 */
export interface WorkspaceEdit {
  /** URI → edits map. */
  changes?: Record<string, TextEdit[]>;
  /** Preferred: per-document edits, each carrying its own URI. */
  documentChanges?: TextDocumentEdit[];
}

// =============================================================================
// Internal source positions (graph-native — line 1-indexed, column 0-indexed)
// =============================================================================

/**
 * A position in a source file in the graph's native convention: line
 * **1-indexed**, `column` **0-indexed**, both UTF-16 code units. The internal
 * counterpart to the LSP/surface {@link Position}; the naming difference
 * (`column` vs `character`) is the compile-time barrier that forces an explicit
 * conversion at each boundary.
 */
export interface SourcePosition {
  /** 1-based line. */
  line: number;
  /** 0-based offset in UTF-16 code units on that line. */
  column: number;
}

/** A half-open `[start, end)` span of {@link SourcePosition}s within one file. */
export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

// =============================================================================
// Confidence & derivation unions
// =============================================================================

/**
 * Per-edit confidence (FR-004). A pure function of the resolver edge's
 * `resolvedBy` category + `provenance` (computed later in
 * `src/refactor/confidence.ts`), **necessary but not sufficient** — every edit
 * regardless of tier must also pass live-byte span verification (FR-005 /
 * FR-016), which drops a byte-mismatched edit outright.
 */
export type ConfidenceTier = 'exact' | 'heuristic';

/** Which derivation path produced an edit or plan (FR-003 / FR-027). */
export type EditSource = 'lsp' | 'graph';

/**
 * Why an `ok`-status LSP result was rejected as unusable and the WHOLE rename
 * degraded to the graph derivation instead — never a per-file merge of the two
 * sources (FR-003a's unusable-result contract; spec.md's overlapping-range
 * clause is the precedent this extends — SPEC-010 D3 / D5c). Two values:
 * - `incomplete-coverage` — the LSP edit set was missing at least one file
 *   the graph already knows carries a span-verified occurrence of the target
 *   (observed cause: an ephemeral LSP client issuing `textDocument/rename`
 *   before the language server finishes project load, so it answers from the
 *   single open file only).
 * - `overlapping-edits` — two of the LSP result's own edits genuinely overlap
 *   within a file (spec.md's overlapping-range clause, applied at PLAN time —
 *   `writeEdits` keeps its own apply-time check as defense-in-depth). A
 *   fully-coincident duplicate is NOT an overlap; it still de-duplicates as
 *   usual at write time.
 * - `unsupported-edits` — the LSP result carried an edit SHAPE the symbol
 *   writer cannot honor: a `documentChanges` resource operation (Create/
 *   Rename/DeleteFile), or an in-root text edit with a multiline range or an
 *   empty live-derived `oldText` (both of which `writeEdits` would apply as an
 *   insert-at-start rather than a replace, corrupting the file). SPEC-010 A2 —
 *   the same "unusable rename result degrades to the graph path" contract as
 *   the two reasons above.
 * Distinct from the FR-003a `unavailable`/`failed` degradation routes (a
 * probe failure or a runtime crash/timeout) — those carry no reason here;
 * this field is populated ONLY for an ok-but-unusable result.
 */
export type LspDegradationReason = 'incomplete-coverage' | 'overlapping-edits' | 'unsupported-edits';

/**
 * Aggregate confidence over a plan's edits, driving the `--apply` gate
 * (FR-015): `contains-heuristic` refuses apply unless heuristics are opted in.
 */
export type PlanConfidence = 'all-exact' | 'contains-heuristic';

// =============================================================================
// Targeting (Target Selector → resolved Target; Candidate)
// =============================================================================

/**
 * The rename target's input identity (FR-006): a bare `name` or a qualified
 * `Class.method`, optionally narrowed by `file` / `kind`. Resolving it yields
 * exactly one {@link Target} or a {@link Refusal}.
 *
 * `kind` is the raw user-supplied string (CLI `--kind` / MCP `kind`), NOT yet
 * validated against {@link NodeKind}: an unrecognized value is a success-shaped
 * `invalid-argument` refusal carrying `validKinds` (FR-021a), decided during
 * resolution — so it is typed `string`, not `NodeKind`.
 */
export interface TargetSelector {
  /** Bare name or `Class.method`. */
  name: string;
  /** `--file` qualifier: workspace-relative path narrowing. */
  file?: string;
  /** `--kind` qualifier: an as-yet-unvalidated NodeKind string. */
  kind?: string;
}

/**
 * A resolved, disambiguated rename target (data-model Target; schema `target`).
 * Excluded/unsupported kinds (FR-010 / FR-011) resolve to a {@link Refusal}, so
 * a `Target` is always a renameable code symbol.
 */
export interface Target {
  /** The symbol's current name (the old name). */
  name: string;
  /** NodeKind of the target (function, method, class, interface, …). */
  kind: NodeKind;
  /** Workspace-relative path of the declaration. */
  file: string;
  /** The declaration span (from the node's start/end line & column). */
  range: SourceRange;
}

/**
 * A symbol matching an ambiguous selector (FR-007), surfaced in an
 * `ambiguous-target` refusal so a single qualified retry succeeds with zero
 * files read (SC-003).
 */
export interface Candidate {
  name: string;
  kind: NodeKind;
  /** Workspace-relative path of the declaration. */
  file: string;
  /** 1-based declaration line (graph-native; the `file:line` a human reads). */
  line: number;
  /** The exact qualifier that uniquely selects this candidate
   *  (e.g. `Worker.handle`, `--file src/a.ts`, `--kind method`). */
  selector: string;
}

// =============================================================================
// Rename plan & edits
// =============================================================================

/**
 * A single change within one file (data-model RenameEdit; schema `edit`). Field
 * names match the surface schema so serialization is field-preserving — only
 * `range` is converted (internal 1-based {@link SourceRange} → surface 0-based).
 */
export interface RenameEdit {
  /** Workspace-relative path of the edited file. */
  file: string;
  /** The span to replace, in the internal 1-indexed-line convention. */
  range: SourceRange;
  /** The old-name occurrence — verified to equal the live-byte slice at `range`
   *  (FR-005 / FR-016). */
  oldText: string;
  /** The new-name occurrence that replaces `oldText`. */
  newText: string;
  /** The edited span's full source line BEFORE the edit (no trailing newline),
   *  carrying before/after-preview context so a JSON/MCP consumer satisfies
   *  SC-001 without a Read (FR-027). */
  lineText: string;
  /** Per-edit tier (FR-004); every edit also passed span verification. */
  confidence: ConfidenceTier;
  /** Derivation path for this edit (authoritative over the plan-level `source`). */
  source: EditSource;
}

/**
 * The one surface-neutral result envelope (data-model RenamePlan; schema
 * `RenamePlan`). It carries three shapes distinguished by `applied` / `refusal`
 * / `outcome`: a successful plan (dry-run or apply-green), a success-shaped
 * refusal, and an apply terminal. Only `newName` and `applied` are present in
 * every shape (schema `required`), so `target` / `edits` / `confidence` are
 * optional — a refusal has no resolved target or edit set.
 */
export interface RenamePlan {
  /** The resolved target. Omitted on a refusal that never resolved one. */
  target?: Target;
  /** The requested new name (the echoed request — always present). */
  newName: string;
  /**
   * The ordered edits (data-model). When present, non-empty (schema
   * `minItems: 1`) — an empty-references plan still contains the declaration
   * edit (FR-002). Ordered deterministically by (`file`, `range` start line,
   * start character) for byte-identical CLI≡MCP parity (SC-005 / FR-027).
   * Omitted on a refusal.
   */
  edits?: RenameEdit[];
  /** Aggregate confidence over `edits` (FR-015). Omitted on a refusal. */
  confidence?: PlanConfidence;
  /** Whole-plan derivation path when uniform; per-edit `source` is authoritative. */
  source?: EditSource;
  /** Present when an `ok` LSP result was unusable-incomplete and the WHOLE
   *  rename degraded to the graph derivation instead (D3 / FR-003a extension).
   *  Never present when `source` is `lsp`. */
  lspDegradation?: LspDegradationReason;
  /** Optional, non-gating FYI count of un-edited old-name occurrences (FR-013). */
  leftoverMentions?: number;
  /** `false` for every dry-run; `true` only on a post-check-green apply (always present). */
  applied: boolean;
  /** Apply-only (Slice 2); absent on a dry-run. */
  outcome?: ApplyOutcome;
  /** Present on a recoverable refusal (success-shaped). */
  refusal?: Refusal;
  /** Present on outcome `rolled-back` (FR-019). */
  danglingReferences?: DanglingReference[];
  /** Present on outcome `rollback-failed` (FR-019a) — the sole error-shaped terminal. */
  recovery?: RecoveryInfo;
  /** Present when a Rung-4 write/rename malfunction forced the rollback
   *  (`rolled-back` or `rollback-failed`) — D5 review finding. */
  writeFailure?: WriteFailure;
  /** Present (`true`) on a `rolled-back` outcome whose own post-restore re-sync
   *  failed — the bytes are restored but the index is stale (B2 review finding). */
  resyncFailed?: boolean;
}

// =============================================================================
// Refusals (all success-shaped except the FR-019a malfunction — FR-023)
// =============================================================================

/**
 * The reason a request was refused (schema `refusal.reason`). Every value is a
 * recoverable, success-shaped condition delivered as actionable guidance, never
 * an `isError` response (FR-023); the sole error-shaped terminal is a failed
 * rollback (FR-019a), which carries {@link RecoveryInfo} instead of a refusal.
 */
export type RefusalReason =
  | 'ambiguous-target' // FR-007: several symbols match; see `candidates`.
  | 'unsupported-kind-graph-local' // FR-010: local/parameter on the graph path.
  | 'excluded-kind' // FR-011: file/route/import/export kinds.
  | 'invalid-argument' // FR-021a: empty/invalid newName, no-op, or unrecognized kind.
  | 'heuristic-gated' // FR-015: below-exact edits block apply; see `gatedEdits`.
  | 'stale-span' // FR-005 plan-time (candidate file drifted from the index, D4) or FR-016 apply-window (live bytes drifted from the planned span); see `files`.
  | 'out-of-root' // FR-017: an edit targets a path outside the workspace root.
  | 'scope-ignored' // FR-017: an edit targets an in-root but scope-ignored file.
  | 'not-indexed' // Project has no `.codegraph/` index.
  | 'target-not-found'; // A valid selector matched no symbol.

/**
 * A recoverable refusal (schema `refusal`). Each optional field is populated for
 * the reason it serves, so the caller can act without reading a file (SC-006):
 * `candidates` (ambiguous-target), `gatedEdits` (heuristic-gated), `files`
 * (stale-span / out-of-root / scope-ignored), `validKinds` (invalid-argument on
 * an unrecognized kind).
 */
export interface Refusal {
  reason: RefusalReason;
  /** Human-actionable guidance that names the exact fix/retry. */
  message: string;
  /** For `ambiguous-target`: every match with a uniquely-selecting qualifier (FR-007). */
  candidates?: Candidate[];
  /** For `stale-span` (drifted files) / `out-of-root` / `scope-ignored` (offending files). */
  files?: string[];
  /** For `heuristic-gated`: the below-`exact` edits blocking apply (FR-015). */
  gatedEdits?: RenameEdit[];
  /** For `invalid-argument` on an unrecognized kind: every recognized NodeKind (FR-021a). */
  validKinds?: NodeKind[];
}

// =============================================================================
// Apply outcome & result (Slice 2)
// =============================================================================

/**
 * The terminal state of an apply (schema `outcome`), each mapping 1:1 to a CLI
 * exit code ({@link RENAME_EXIT_CODES}) and MCP result shape:
 * - `applied` — post-check green (exit 0).
 * - `refused` — a recoverable pre-write gate refusal, zero writes (exit 2).
 * - `rolled-back` — wrote then restored byte-identically (exit 3).
 * - `rollback-failed` — the sole malfunction; restore itself failed (exit 4).
 */
export type ApplyOutcome = 'applied' | 'refused' | 'rolled-back' | 'rollback-failed';

/**
 * An old-name reference the post-check found still dangling after the write,
 * forcing the unconditional rollback (FR-019; schema `danglingReferences`
 * item). Machine-actionable — names exactly what blocked the rename.
 */
export interface DanglingReference {
  /** Workspace-relative path of the file still carrying the old name. */
  file: string;
  /** The dangling occurrence's span (internal 1-indexed-line convention). */
  range: SourceRange;
  /** The old-name occurrence that dangled. */
  name: string;
}

/**
 * Post-rollback restore state for the `rollback-failed` malfunction (FR-019a;
 * schema `recovery`). Lets a caller retry the restore step alone (an idempotent
 * write-back of known snapshot bytes) — never the rename itself.
 */
export interface RecoveryInfo {
  /** Touched files confirmed restored byte-identically from snapshot. */
  restoredFiles: string[];
  /** Touched files whose snapshot could NOT be written back (EACCES/ENOSPC/…). */
  unrestoredFiles: string[];
  /** Per-incident dir holding the unrestored snapshots
   *  (`.codegraph/rename-recovery-<pid>-<hex>/`). Optional (B5 review finding):
   *  ABSENT when the recovery dump itself also failed (e.g. `.codegraph`
   *  unwritable) — the unrestored files still need manual attention, but no dump
   *  was written. */
  recoveryDir?: string;
}

/**
 * The Rung-4 write-path malfunction that forced a rollback (D5 review finding;
 * schema `writeFailure`) — the write/rename cause, mirroring how a post-check
 * dangle carries {@link DanglingReference}s. Orthogonal to `outcome`: it can
 * accompany EITHER `rolled-back` (the restore itself then succeeded) or
 * `rollback-failed` (the restore ALSO failed) — whichever the rollback of the
 * write failure lands on. Absent when the rollback was instead forced by a
 * post-check dangle or a sync lock-failure (those causes are self-evident from
 * `danglingReferences`).
 */
export interface WriteFailure {
  /** Workspace-relative path of the file whose write/rename threw. */
  file: string;
  /** The underlying error's message (EACCES/ENOSPC/…). */
  message: string;
}

/**
 * The full internal result of an apply (data-model ApplyResult). The serializer
 * (`serializeApplyResultJson`) folds it onto the {@link RenamePlan} surface
 * envelope: `outcome`, `touchedFiles`, and `postCheckPassed` on every apply
 * terminal, plus whichever terminal payload it carries (`danglingReferences` /
 * `recovery` / `refusal` / `writeFailure` / `resyncFailed`) — every one declared
 * in `rename-plan.schema.json` (R16 review finding: `touchedFiles` /
 * `postCheckPassed` were formerly mis-noted here as internal-only, yet the
 * serializer has always emitted them, so the schema now declares them too).
 */
export interface ApplyResult {
  outcome: ApplyOutcome;
  /** Every file the apply snapshotted and wrote (or attempted to write). */
  touchedFiles: string[];
  /** The touched-file-scoped dual assertion result (FR-018); `false` when the
   *  apply refused before the post-check ran. */
  postCheckPassed: boolean;
  /** Present when `outcome === 'rolled-back'` (FR-019). */
  danglingReferences?: DanglingReference[];
  /** Present when `outcome === 'rollback-failed'` (FR-019a). */
  recovery?: RecoveryInfo;
  /** Present when `outcome === 'refused'` — the pre-write gate refusal. */
  refusal?: Refusal;
  /** Present when a Rung-4 write/rename malfunction forced the rollback that
   *  led to `outcome` `rolled-back` or `rollback-failed` (D5 review finding). */
  writeFailure?: WriteFailure;
  /** `true` when the rollback's OWN post-restore re-sync failed (threw, or
   *  returned the lock-failure zero-shape) AFTER the bytes were restored (B2
   *  review finding). The workspace IS restored (`rolled-back`), but the index no
   *  longer matches it — the caller must `codegraph sync`. Only ever set on a
   *  `rolled-back` outcome. */
  resyncFailed?: boolean;
}

// =============================================================================
// CLI exit codes (FR-026)
// =============================================================================

/**
 * Process exit codes for `codegraph rename` (FR-026). A dry-run plan and an
 * applied-green apply intentionally share `0` (a non-zero code for the common
 * dry-run success would break shell chaining). Codes `3`/`4` are reachable only
 * once the Slice-2 apply engine ships. Kept here as an `as const` map so the CLI
 * action handler (`src/bin/codegraph.ts`) maps an outcome to a code additively,
 * opting out of the generic error→exit-1 mapping the read-only commands use.
 */
export const RENAME_EXIT_CODES = {
  /** A dry-run plan was produced, or `--apply` reached post-check-green. */
  ok: 0,
  /** An unexpected internal or usage error. */
  error: 1,
  /** A recoverable refusal with zero writes (FR-023 list). */
  refused: 2,
  /** An apply that wrote then rolled back byte-identically (FR-019). */
  rolledBack: 3,
  /** A failed rollback restore — the sole malfunction code (FR-019a). */
  rollbackFailed: 4,
} as const;

/** One of the {@link RENAME_EXIT_CODES} values (`0 | 1 | 2 | 3 | 4`). */
export type RenameExitCode = (typeof RENAME_EXIT_CODES)[keyof typeof RENAME_EXIT_CODES];

/**
 * Map an {@link ApplyOutcome} to its {@link RENAME_EXIT_CODES} process code (FR-026):
 * `applied → 0`, `refused → 2`, `rolled-back → 3`, `rollback-failed → 4`. The one
 * seam the CLI action uses to turn an apply terminal into an exit code, exported so
 * the mapping is unit-testable directly (the `rolled-back`/`rollback-failed` codes
 * are impractical to induce through a CLI subprocess). Exhaustive switch — a future
 * outcome becomes a compile error, never a silent exit `0`.
 */
export function renameApplyExitCode(outcome: ApplyOutcome): RenameExitCode {
  switch (outcome) {
    case 'applied':
      return RENAME_EXIT_CODES.ok;
    case 'refused':
      return RENAME_EXIT_CODES.refused;
    case 'rolled-back':
      return RENAME_EXIT_CODES.rolledBack;
    case 'rollback-failed':
      return RENAME_EXIT_CODES.rollbackFailed;
  }
}
