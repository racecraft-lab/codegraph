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
 * ## D4 — the plan-time index-freshness guard (gate S2-C finding)
 * Per-edge span verification ({@link verifySpan}, inside {@link deriveGraphRename})
 * already silently drops any candidate whose live bytes mismatch — necessary to
 * keep discarding genuine shadow/alias/string-similar false positives (SC-008) on
 * a file unchanged since indexing. But when the FILE ITSELF has drifted (mutated
 * on disk without a `codegraph sync`), that same drop silently swallows a REAL
 * edit instead of a false positive, leaving a partially-renamed workspace with no
 * signal. The discriminator is index freshness of the FILE, not the span: every
 * file the graph derivation nominated as a candidate (win or lose against
 * `verifySpan`), the declaration file, and every file the accepted edit set
 * touches (covers the LSP path's own files when that path is used) are checked
 * against their indexed `files` row ({@link findDriftedFiles}) — ANY drift refuses
 * the WHOLE plan `stale-span`, at plan time, so both a dry-run and `--apply`
 * (which recomputes via this same function, FR-014) refuse identically, and a
 * misleading "all-exact · 0 leftovers" plan can never render over stale bytes.
 *
 * Injected dependencies (a `QueryBuilder`, the project root, and a resolved LSP
 * config) keep the `CodeGraph.planRename` wrapper (a later task) thin. No writes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { QueryBuilder } from '../db/queries';
import { hashContent } from '../extraction';
import { detectLanguage } from '../extraction/grammars';
import { EffectiveLspConfig, isLspLanguage, probeLspServerCommand } from '../lsp';
import { validatePathWithinRoot } from '../utils';
import { countTextualLeftovers, deriveGraphRename } from './graph-rename';
import { checkPlanJail } from './jail';
import { deriveLspRename } from './lsp-rename';
import { hasOverlappingSpans } from './snapshot';
import { findDeclarationNameColumn } from './span-verify';
import { GRAPH_LOCAL_KINDS, LspPathDisposition, resolveTarget } from './target-resolver';
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
 * confidence, plan-level `source`, and the leftover-mention FYI — unless a
 * candidate file has drifted from the index since the last sync, which refuses
 * the WHOLE plan `stale-span` instead (D4; see {@link findDriftedFiles}).
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

  const { edits, source, leftoverMentions, lspDegradation, candidateFiles } = await deriveEdits(options, target, targetId);

  // A1 (rp-review) — graph-local runtime-degrade refusal (FR-010 / FR-003a).
  // A variable/parameter target is only admitted by resolveTarget when the LSP
  // command PROBE reported `available` (target-resolver.ts) — but if the LSP
  // rename then fails at RUNTIME or its result was unusable, `deriveEdits`
  // silently falls back to `deriveGraphRename`, which cannot cover a local (no
  // tracked usage edges) — yielding a "successful" declaration-only plan that
  // misses every local usage. The discriminator is the FINAL derivation source:
  // when a graph-local's edits end up on the graph path, no language server
  // actually renamed it, so refuse the WHOLE plan rather than ship an incomplete
  // rename. Truthful per FR-003a/D7 — a server WAS configured (the probe passed);
  // it just could not complete the rename — so the message never claims none is
  // configured.
  if (source === 'graph' && GRAPH_LOCAL_KINDS.has(target.kind)) {
    return {
      newName,
      applied: false,
      refusal: {
        reason: 'unsupported-kind-graph-local',
        message:
          `Cannot rename the ${target.kind} "${target.name}": renaming a local or parameter needs a working ` +
          `language server, but the LSP rename could not be completed (the server attempt failed at runtime or ` +
          `returned an unusable result), so the rename fell back to the graph path — which has no local usage ` +
          `tracking. Re-run once the language server is working.`,
      },
    };
  }

  const ordered = sortEdits(edits);

  // FR-017 plan-time path jail + index-scope guard — refuse the whole plan at plan
  // time too ("at plan and apply time alike") when the derived edit set names a file
  // outside the workspace root or excluded from index scope. Reachable in practice
  // only via the LSP path (a language server may return a workspace edit naming a
  // dependency's source or a monorepo sibling); graph-path occurrences are in the
  // index, hence in-root and in-scope by construction. Success-shaped, names the
  // offending file(s); the apply engine re-checks after its own recompute (FR-014).
  // Runs BEFORE the D4 drift guard below so an out-of-root LSP-set file is refused
  // here first — the drift guard never stats/reads a path outside the root.
  const jail = checkPlanJail({ projectRoot: options.projectRoot, files: [...new Set(ordered.map((e) => e.file))] });
  if (jail) return { newName, applied: false, refusal: jail };

  // D4 — plan-time index-freshness guard (gate S2-C finding; spec.md "Index stale
  // vs. working tree" edge case / SC-004). Every file the graph derivation
  // nominated as a candidate (whether or not its edit survived verifySpan), the
  // declaration file, and every file the accepted edit set touches (the LSP
  // path's own files, when that path is used — already confirmed in-root by the
  // jail check above) must match their indexed `files` row. ANY drift refuses the
  // WHOLE plan — dry-run included, so a misleading "all-exact · 0 leftovers" plan
  // can never render over stale bytes — never a partial, silent drop.
  const driftCandidates = new Set<string>([...candidateFiles, target.file, ...ordered.map((e) => e.file)]);
  const drifted = findDriftedFiles({ queries, projectRoot: options.projectRoot, files: driftCandidates });
  if (drifted.length > 0) {
    return {
      newName,
      applied: false,
      refusal: {
        reason: 'stale-span',
        message:
          `Refusing the rename: the live bytes of ${drifted.join(', ')} no longer match ` +
          `the index (the index is stale). Run \`codegraph sync\` and retry.`,
        files: drifted,
      },
    };
  }

  // A3 (rp-review) — a resolved target whose ordered edit set is EMPTY (the
  // declaration edit dropped because its recorded span no longer locates the
  // name in the live file, with no references, while the file is NOT drifted so
  // D4 passed) must not return a success plan with `edits: []`: the published
  // schema requires `edits.minItems: 1`, and `aggregateConfidence([])` would
  // misleadingly report `all-exact`. Refuse `stale-span` naming the declaration
  // file — the same re-sync-and-retry remedy as a drifted candidate (FR-005).
  if (ordered.length === 0) {
    return {
      newName,
      applied: false,
      refusal: {
        reason: 'stale-span',
        message:
          `Refusing the rename: the recorded declaration span of "${target.name}" in ${target.file} could no ` +
          `longer be located in the live file (the index is stale). Run \`codegraph sync\` and retry.`,
        files: [target.file],
      },
    };
  }

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
  /** The graph derivation's pre-verifySpan candidate files (D4) — carried through
   *  regardless of which path's edits are ultimately used, since the graph
   *  derivation always runs unconditionally (D3). */
  candidateFiles: string[];
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
      // R20 (rp-review): thread the target's old name so translateWorkspaceEdit can
      // reject an in-root edit whose live bytes replace an unrelated token.
      oldName: target.name,
      env,
    });
    if (result.status === 'ok') {
      // A2 (rp-review): the LSP result carried an edit SHAPE the writer cannot
      // honor (a documentChanges resource operation, or an in-root multiline /
      // empty-oldText edit — {@link translateWorkspaceEdit}). Per FR-003a's
      // unusable-result contract, degrade the WHOLE rename to the graph
      // derivation. Checked FIRST — an unusable shape is unusable regardless of
      // coverage/overlap. The out-of-root refuse-before-read placeholder is NOT
      // flagged unusable (content checks are in-root only), so its whole-plan
      // out-of-root refusal (via checkPlanJail, below) still wins.
      if (result.unusable) {
        return {
          edits: graph.edits,
          source: 'graph',
          leftoverMentions: graph.leftoverMentions,
          lspDegradation: 'unsupported-edits',
          candidateFiles: graph.candidateFiles,
        };
      }
      // D5c: a genuinely-overlapping LSP edit set is ALSO unusable (spec.md's
      // overlapping-range clause, applied here at PLAN time — writeEdits keeps
      // its own apply-time check as defense-in-depth). Checked only when
      // coverage already passed — an incomplete result degrades for THAT
      // reason regardless.
      const covers = lspCoversGraphFiles(graph.edits, result.edits);
      if (covers && !hasOverlappingLspEdits(result.edits)) {
        // LSP edit set is authoritative (it already includes the declaration
        // edit); the leftover count still comes from the graph-side whole-word
        // logic, run over the LSP-touched files. A4 (rp-review): de-duplicate
        // identical (file+range+newText) edits before returning them, so the
        // dry-run preview/JSON never shows a duplicate (writeEdits still de-dups
        // at write time as defense-in-depth).
        const deduped = dedupeLspEdits(result.edits);
        return {
          edits: deduped,
          source: 'lsp',
          leftoverMentions: countLspLeftovers(projectRoot, target.name, deduped),
          candidateFiles: graph.candidateFiles,
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
      return {
        edits: graph.edits,
        source: 'graph',
        leftoverMentions: graph.leftoverMentions,
        lspDegradation: covers ? 'overlapping-edits' : 'incomplete-coverage',
        candidateFiles: graph.candidateFiles,
      };
    }
    // FR-003a: unavailable / runtime-failed → degrade THAT rename to the graph.
  }

  return { edits: graph.edits, source: 'graph', leftoverMentions: graph.leftoverMentions, candidateFiles: graph.candidateFiles };
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

/** A safe per-line multiplier for encoding an edit's (line, column) as one
 *  comparable number — real source lines never approach 1,000,000 UTF-16
 *  code units, so ordering is preserved exactly. */
const LSP_OVERLAP_LINE_BASE = 1_000_000;

/**
 * D5c — true when, per file, two of `edits`' own ranges genuinely overlap
 * (spec.md's overlapping-range clause, checked at PLAN time). Fully-coincident
 * duplicates (identical start+end AND `newText`) are de-duplicated first — the
 * same edit emitted twice is NOT an overlap; `writeEdits` still de-duplicates
 * them again at write time. The dedup key includes `newText` to MATCH
 * `writeEdits`' own `${start}:${end}:${newText}` key (D1 round-2 review finding):
 * two coincident ranges carrying DIFFERENT `newText` are a genuine, contradictory
 * overlap the writer would refuse — omitting `newText` here collapsed them to one
 * span, so the plan reported source `lsp` while apply-time `writeEdits` would
 * degrade the same set (a plan/apply disagreement). Reuses
 * {@link hasOverlappingSpans} (shared with `writeEdits`' own byte-offset check)
 * over a (line, column)-derived numeric encoding — no file read needed, since
 * overlap is a pure property of the edit ranges themselves.
 */
function hasOverlappingLspEdits(edits: RenameEdit[]): boolean {
  const byFile = new Map<string, RenameEdit[]>();
  for (const e of edits) {
    const list = byFile.get(e.file);
    if (list) list.push(e);
    else byFile.set(e.file, [e]);
  }
  for (const fileEdits of byFile.values()) {
    const spans = fileEdits.map((e) => ({
      start: e.range.start.line * LSP_OVERLAP_LINE_BASE + e.range.start.column,
      end: e.range.end.line * LSP_OVERLAP_LINE_BASE + e.range.end.column,
      newText: e.newText,
    }));
    const seen = new Set<string>();
    const unique = spans.filter((s) => {
      const key = `${s.start}:${s.end}:${s.newText}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (hasOverlappingSpans(unique)) return true;
  }
  return false;
}

/**
 * The FR-003a fork disposition for a resolved target's language, for the resolver's
 * FR-009/FR-010 kind check. Mirrors {@link deriveEdits}'s fork: the LSP path is
 * `available` only when LSP is enabled, a server covers the language, AND the
 * SPEC-008 probe resolves its command; a disabled/uncovered language is `absent`.
 * A covered language whose probe does NOT resolve a command carries the probe's
 * own `reasonCode` forward rather than a generic "unavailable" — this is a
 * command-availability probe, so no server process is ever spawned here, and the
 * disposition (and the resolver's refusal message built from it) must not imply
 * one was: `unavailable-missing-command` when nothing is configured/found for the
 * language, `unavailable-command-not-executable` when a command IS configured but
 * isn't on PATH / executable (the FR-003a honesty case). resolveTarget calls this
 * lazily (only for a local/parameter target), so the probe is paid only when it
 * decides the outcome — every function/method/class rename skips it entirely.
 */
function lspPathDisposition(options: PlanRenameOptions, target: Target): LspPathDisposition {
  const { lspConfig, projectRoot, env } = options;
  const language = detectLanguage(target.file);
  if (!lspConfig.enabled || !isLspLanguage(language)) return 'absent';
  const probe = probeLspServerCommand(lspConfig.servers[language], { cwd: projectRoot, env });
  if (probe.state === 'available') return 'available';
  return probe.reasonCode === 'configured-command-unavailable'
    ? 'unavailable-command-not-executable'
    : 'unavailable-missing-command';
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
    // R18 (rp-review): whole-word, decorator-aware scan — the SAME helper the graph
    // declaration edit uses — so an accessor/modifier keyword or `@name` decorator
    // equal to the name never mis-aims the LSP rename cursor at the wrong token.
    const col = findDeclarationNameColumn(raw.replace(/\r$/, ''), target.range.start.column, target.name);
    if (col >= 0) return { line: target.range.start.line, column: col };
  } catch {
    /* fall through to the declaration start */
  }
  return target.range.start;
}

/**
 * Leftover-mention FYI over the LSP-touched files (same whole-word logic).
 * Runs BEFORE `checkPlanJail` (called by this module's own caller, below) —
 * an out-of-root file's edits reach here too, so it is excluded from the read
 * the SAME refuse-before-read way `translateWorkspaceEdit` (lsp-rename.ts)
 * excludes it (Copilot review finding: this was the second, easy-to-miss read
 * site on the identical LSP-ok code path — a leftover count for a file the
 * whole plan is about to be refused over is moot anyway).
 */
function countLspLeftovers(projectRoot: string, oldName: string, edits: RenameEdit[]): number {
  // A5 (rp-review): guard the per-file read. Normally these files were just read
  // by translateWorkspaceEdit (lsp-rename.ts) moments ago, but a file the server
  // invented, or one deleted in the plan→count window (TOCTOU), must not throw an
  // uncaught internal error here — BEFORE the downstream D4 drift guard can refuse
  // `stale-span`. An unreadable file contributes no leftover lines (skip it); its
  // presence in the edit set still flows into `driftCandidates`, so the drift
  // guard refuses the whole plan (no `files` row / doesn't stat). Mirrors
  // deriveGraphRename's own defensive read (graph-rename.ts).
  const files: Array<{ file: string; lines: string[] }> = [];
  for (const file of new Set(edits.map((e) => e.file))) {
    if (validatePathWithinRoot(projectRoot, file) === null) continue;
    try {
      files.push({ file, lines: fs.readFileSync(path.join(projectRoot, file), 'utf8').split('\n') });
    } catch {
      // unreadable (invented / deleted since translate) — no leftover lines
    }
  }
  const emitted = new Set(edits.map((e) => `${e.file}:${e.range.start.line}:${e.range.start.column}`));
  return countTextualLeftovers(files, oldName, emitted);
}

/**
 * A4 (rp-review) — de-duplicate identical LSP edits (same file + range +
 * newText) from an accepted LSP result before it becomes the plan, keyed the
 * SAME way writeEdits keys its own write-time de-dup. Preserves first-seen order
 * (sortEdits re-orders deterministically afterwards).
 */
function dedupeLspEdits(edits: RenameEdit[]): RenameEdit[] {
  const seen = new Set<string>();
  return edits.filter((e) => {
    const key = `${e.file}:${e.range.start.line}:${e.range.start.column}:${e.range.end.line}:${e.range.end.column}:${e.newText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Deterministic total order for byte-identical CLI≡MCP parity (FR-027/SC-005).
 *  A4 (rp-review): full tie-breakers (end line, end column, then codepoint of
 *  newText) so two edits sharing a start can never depend on SQL/server order. */
function sortEdits(edits: RenameEdit[]): RenameEdit[] {
  return [...edits].sort(
    (a, b) =>
      byCodepoint(a.file, b.file) ||
      a.range.start.line - b.range.start.line ||
      a.range.start.column - b.range.start.column ||
      a.range.end.line - b.range.end.line ||
      a.range.end.column - b.range.end.column ||
      byCodepoint(a.newText, b.newText),
  );
}

/** Locale-independent string comparison (byte-identical parity needs no locale). */
function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * D4 — every file in `files` whose live disk state no longer matches its indexed
 * `files` row (`content_hash` / `size` / `modified_at`). Fast path: identical
 * size + modified_at skips a hash, mirroring the indexer's own `sync()` fast path
 * (`src/extraction/index.ts`); otherwise the live bytes are re-hashed with the
 * IDENTICAL {@link hashContent} the indexer writes, so "fresh" here means exactly
 * what a `codegraph sync` would also treat as unchanged — including a CRLF/BOM/
 * encoding-only edit, which changes the read string and therefore the hash even
 * when a byte count coincidence defeats the fast path. A file missing from disk,
 * or missing its `files` row despite being a rename candidate, counts as drifted
 * too (the refuse-rather-than-crash counterpart of {@link deriveGraphRename}'s own
 * defensive read). `files` is already deduped by the caller (a `Set`); the result
 * is sorted for deterministic surface parity (mirrors {@link checkPlanJail}'s
 * `files` convention).
 */
function findDriftedFiles(input: { queries: QueryBuilder; projectRoot: string; files: Iterable<string> }): string[] {
  const { queries, projectRoot, files } = input;
  const drifted: string[] = [];
  for (const file of files) {
    const tracked = queries.getFileByPath(file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(projectRoot, file));
    } catch {
      drifted.push(file); // deleted (or never materialized) since indexing
      continue;
    }
    if (!tracked) {
      drifted.push(file); // a rename candidate with no files-table row at all
      continue;
    }
    if (stat.size === tracked.size && Math.floor(stat.mtimeMs) === Math.floor(tracked.modifiedAt)) {
      continue; // fast path: unchanged since indexing (mirrors sync())
    }
    let content: string;
    try {
      content = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    } catch {
      drifted.push(file);
      continue;
    }
    if (hashContent(content) !== tracked.contentHash) drifted.push(file);
  }
  return drifted.sort(byCodepoint);
}

function aggregateConfidence(edits: RenameEdit[]): PlanConfidence {
  return edits.every((e) => e.confidence === 'exact') ? 'all-exact' : 'contains-heuristic';
}
