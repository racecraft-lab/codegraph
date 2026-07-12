/**
 * FR-003 / FR-003a / FR-027 — the rename plan engine (SPEC-010).
 *
 * The Slice-1 orchestrator: resolve the target selector ({@link resolveTarget}),
 * fork between the LSP path ({@link deriveLspRename}) and the graph path
 * ({@link deriveGraphRename}), then assemble a {@link RenamePlan} with aggregate
 * confidence and deterministic edit ordering. A dry-run always — `applied:false`.
 *
 * ## The FR-003/FR-003a fork
 * The LSP path is attempted only when LSP is enabled AND a server covers the
 * target's language (`isLspLanguage`). `deriveLspRename` runs its own
 * availability probe and never throws across its seam — an `unavailable` or
 * runtime-`failed` result degrades THAT rename to the graph path (SPEC-008
 * per-language degradation parity), success-shaped, with the per-edit `source`
 * recording the path actually used. Whichever path produces the edits, the plan
 * always carries a leftover-mention count computed with the identical whole-word
 * logic ({@link countTextualLeftovers}).
 *
 * ## D3 — the completeness check on an `ok` LSP result
 * The graph derivation ({@link deriveGraphRename}) now runs FIRST and
 * unconditionally, once, because an `ok`-status LSP result is no longer
 * automatically authoritative: it is accepted only when its touched files are
 * a superset of every file the graph independently knows carries a
 * span-verified occurrence of the target ({@link lspCoversGraphFiles}). A
 * server can answer `ok` from a single open file before it finishes loading
 * the wider project (observed on a real multi-hundred-file repo), silently
 * dropping cross-file edits — per FR-003a's unusable-result contract (the
 * spec's overlapping-range clause is the existing precedent), that is treated
 * as UNUSABLE, not merely smaller: the WHOLE rename degrades to the graph
 * derivation (never a per-file merge of the two sources), and the plan
 * records why via `lspDegradation`.
 *
 * Injected dependencies (a `QueryBuilder`, the project root, and a resolved LSP
 * config) keep the `CodeGraph.planRename` wrapper (a later task) thin. No writes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { QueryBuilder } from '../db/queries';
import { detectLanguage } from '../extraction/grammars';
import { EffectiveLspConfig, isLspLanguage, probeLspServerCommand } from '../lsp';
import { countTextualLeftovers, deriveGraphRename } from './graph-rename';
import { checkPlanJail } from './jail';
import { deriveLspRename } from './lsp-rename';
import { LspPathDisposition, resolveTarget } from './target-resolver';
import {
  EditSource,
  LspDegradationReason,
  PlanConfidence,
  RenameEdit,
  RenamePlan,
  SourcePosition,
  Target,
  TargetSelector,
} from './types';

export interface PlanRenameOptions {
  /** The graph the engine reads (same access pattern the derivation paths use). */
  queries: QueryBuilder;
  /** Absolute workspace root; edit `file`s are relative to it. */
  projectRoot: string;
  /** The user's target identity (FR-006). */
  selector: TargetSelector;
  /** The requested new name. */
  newName: string;
  /** Resolved SPEC-008 LSP config; gates + parameterizes the LSP path (FR-003a). */
  lspConfig: EffectiveLspConfig;
  /** Env override for the LSP probe + spawned server (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
}

/**
 * Produce the dry-run {@link RenamePlan} for `selector` → `newName`. A resolution
 * refusal returns success-shaped (`newName` + `applied:false` + `refusal`, no
 * edits); a resolved target returns the ordered edit set with aggregate
 * confidence, plan-level `source`, and the leftover-mention FYI.
 */
export async function planRename(options: PlanRenameOptions): Promise<RenamePlan> {
  const { queries, selector, newName } = options;

  // FR-021a validation + FR-009/FR-010 kind coverage: pass the validated new name
  // and a lazy LSP-path probe consulted only for a local/parameter target (the one
  // kind whose coverage differs by path — see {@link lspPathDisposition}).
  const target = resolveTarget({
    queries,
    selector,
    newName,
    lspPath: (resolved) => lspPathDisposition(options, resolved),
  });
  if ('reason' in target) {
    return { newName, applied: false, refusal: target };
  }

  // The graph path needs the declaration node id (resolveTarget yields the
  // value-object Target, not the node); recover it from the unique
  // (name, kind, file, declaration-start) resolveTarget already pinned.
  const targetId = findTargetNodeId(queries, target);
  if (targetId === null) {
    return {
      newName,
      applied: false,
      refusal: { reason: 'target-not-found', message: `No symbol matches "${selector.name}".` },
    };
  }

  const { edits, source, leftoverMentions, lspDegradation } = await deriveEdits(options, target, targetId);
  const ordered = sortEdits(edits);

  // FR-017 plan-time path jail + index-scope guard — refuse the whole plan at plan
  // time too ("at plan and apply time alike") when the derived edit set names a file
  // outside the workspace root or excluded from index scope. Reachable in practice
  // only via the LSP path (a language server may return a workspace edit naming a
  // dependency's source or a monorepo sibling); graph-path occurrences are in the
  // index, hence in-root and in-scope by construction. Success-shaped, names the
  // offending file(s); the apply engine re-checks after its own recompute (FR-014).
  const jail = checkPlanJail({ projectRoot: options.projectRoot, files: [...new Set(ordered.map((e) => e.file))] });
  if (jail) return { newName, applied: false, refusal: jail };

  return {
    target,
    newName,
    edits: ordered,
    confidence: aggregateConfidence(ordered),
    source,
    lspDegradation,
    leftoverMentions,
    applied: false,
  };
}

interface Derivation {
  edits: RenameEdit[];
  source: EditSource;
  leftoverMentions: number;
  /** Set only when an `ok` LSP result was rejected as unusable-incomplete and
   *  this derivation is the graph fallback for the WHOLE rename (D3). */
  lspDegradation?: LspDegradationReason;
}

/**
 * The FR-003/FR-003a fork: LSP path when covered+available, else the graph
 * path. The graph derivation is computed FIRST and unconditionally — it is
 * both the FR-003a fallback (as before D3) and, new in D3, the completeness
 * baseline an `ok` LSP result is checked against, so it is derived exactly
 * once regardless of which path the plan ultimately uses (its queries are
 * sub-millisecond — not a meaningful added cost on every rename).
 */
async function deriveEdits(options: PlanRenameOptions, target: Target, targetId: string): Promise<Derivation> {
  const { queries, projectRoot, newName, lspConfig, env } = options;
  const language = detectLanguage(target.file);
  const graph = deriveGraphRename({ queries, projectRoot, targetId, newName });

  if (lspConfig.enabled && isLspLanguage(language)) {
    const result = await deriveLspRename({
      projectRoot,
      config: lspConfig,
      language,
      file: target.file,
      position: lspCursorPosition(projectRoot, target),
      newName,
      env,
    });
    if (result.status === 'ok') {
      if (lspCoversGraphFiles(graph.edits, result.edits)) {
        // LSP edit set is authoritative (it already includes the declaration
        // edit); the leftover count still comes from the graph-side whole-word
        // logic, run over the LSP-touched files.
        return {
          edits: result.edits,
          source: 'lsp',
          leftoverMentions: countLspLeftovers(projectRoot, target.name, result.edits),
        };
      }
      // D3 (dogfood UAT finding): the LSP edit set is missing at least one
      // file the graph already knows carries a span-verified occurrence of
      // the target — e.g. an ephemeral client's `textDocument/rename` landing
      // before the server finishes project load, so it answers from the
      // single open file only. Per FR-003a's unusable-result contract (the
      // spec's overlapping-range clause is the existing precedent), this is
      // UNUSABLE, not merely smaller: degrade the WHOLE rename to the graph
      // derivation (never a per-file merge of the two sources), recording why.
      return { edits: graph.edits, source: 'graph', leftoverMentions: graph.leftoverMentions, lspDegradation: 'incomplete-coverage' };
    }
    // FR-003a: unavailable / runtime-failed → degrade THAT rename to the graph.
  }

  return { edits: graph.edits, source: 'graph', leftoverMentions: graph.leftoverMentions };
}

/**
 * D3 completeness check: every file carrying ≥1 span-verified graph edit must
 * appear among the LSP result's touched files. File-level on purpose — the
 * graph and a real language server can legitimately disagree on exact spans
 * (e.g. whether an import specifier is itself renamed), so this asks only "did
 * the LSP result reach every file the graph already knows about", never "does
 * every individual edit match".
 */
function lspCoversGraphFiles(graphEdits: RenameEdit[], lspEdits: RenameEdit[]): boolean {
  const lspFiles = new Set(lspEdits.map((e) => e.file));
  return graphEdits.every((e) => lspFiles.has(e.file));
}

/**
 * The FR-003a fork disposition for a resolved target's language, for the resolver's
 * FR-009/FR-010 kind check. Mirrors {@link deriveEdits}'s fork: the LSP path is
 * `available` only when LSP is enabled, a server covers the language, AND the
 * SPEC-008 probe resolves its command; a covered-but-unprobeable command is
 * `unavailable` (a CONFIGURED server that did not respond — the FR-003a honesty
 * case), and a disabled/uncovered language is `absent`. resolveTarget calls this
 * lazily (only for a local/parameter target), so the probe is paid only when it
 * decides the outcome — every function/method/class rename skips it entirely.
 */
function lspPathDisposition(options: PlanRenameOptions, target: Target): LspPathDisposition {
  const { lspConfig, projectRoot, env } = options;
  const language = detectLanguage(target.file);
  if (!lspConfig.enabled || !isLspLanguage(language)) return 'absent';
  const probe = probeLspServerCommand(lspConfig.servers[language], { cwd: projectRoot, env });
  return probe.state === 'available' ? 'available' : 'unavailable';
}

/** Recover the resolved target's declaration node id (unique by construction). */
function findTargetNodeId(queries: QueryBuilder, target: Target): string | null {
  const match = queries
    .getNodesByName(target.name)
    .find(
      (n) =>
        n.filePath === target.file &&
        n.kind === target.kind &&
        n.startLine === target.range.start.line &&
        n.startColumn === target.range.start.column,
    );
  return match ? match.id : null;
}

/**
 * Land the LSP rename cursor on the declaration's NAME occurrence — the node
 * start column is the declaration keyword for many kinds (research Decision 8),
 * so scan the declaration line for the name at/after the node start. Falls back
 * to the declaration start if the line/name cannot be read.
 */
function lspCursorPosition(projectRoot: string, target: Target): SourcePosition {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, target.file), 'utf8').split('\n')[target.range.start.line - 1] ?? '';
    const col = raw.replace(/\r$/, '').indexOf(target.name, target.range.start.column);
    if (col >= 0) return { line: target.range.start.line, column: col };
  } catch {
    /* fall through to the declaration start */
  }
  return target.range.start;
}

/** Leftover-mention FYI over the LSP-touched files (same whole-word logic). */
function countLspLeftovers(projectRoot: string, oldName: string, edits: RenameEdit[]): number {
  const files = [...new Set(edits.map((e) => e.file))].map((file) => ({
    file,
    lines: fs.readFileSync(path.join(projectRoot, file), 'utf8').split('\n'),
  }));
  const emitted = new Set(edits.map((e) => `${e.file}:${e.range.start.line}:${e.range.start.column}`));
  return countTextualLeftovers(files, oldName, emitted);
}

/** Deterministic total order for byte-identical CLI≡MCP parity (FR-027/SC-005). */
function sortEdits(edits: RenameEdit[]): RenameEdit[] {
  return [...edits].sort(
    (a, b) =>
      byCodepoint(a.file, b.file) ||
      a.range.start.line - b.range.start.line ||
      a.range.start.column - b.range.start.column,
  );
}

/** Locale-independent string comparison (byte-identical parity needs no locale). */
function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function aggregateConfidence(edits: RenameEdit[]): PlanConfidence {
  return edits.every((e) => e.confidence === 'exact') ? 'all-exact' : 'contains-heuristic';
}
