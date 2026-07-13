/**
 * FR-006 — target selector resolution (SPEC-010).
 *
 * Resolves a {@link TargetSelector} — a bare name or a qualified `Class.method`,
 * optionally narrowed by `--file` / `--kind` — to exactly one {@link Target}
 * (the declaration's name/kind/file plus its span read verbatim from the node),
 * or a success-shaped {@link Refusal}.
 *
 * The full FR-006/FR-007 contract: an unmatched selector is `target-not-found`;
 * a surviving multi-match is an `ambiguous-target` refusal carrying every
 * candidate with the exact qualifier that uniquely selects it (SC-003). Ahead of
 * the narrowing filters, FR-021a validates the arguments (`invalid-argument` for
 * an empty/invalid/no-op new name or an unrecognized `--kind`, with `validKinds`);
 * after resolution, coverage limits apply — `excluded-kind` (file/route/import/
 * export, every path, FR-011) and `unsupported-kind-graph-local` (a local/parameter
 * on the graph path, FR-009/FR-010, keyed on the plan engine's LSP-path disposition).
 *
 * Qualified matching is separator-normalized: a method's stored `qualified_name`
 * uses the language's own scope separator (`Worker::handle` for TS), so a
 * `Worker.handle` selector is matched by comparing name SEGMENTS split on
 * `::` / `.` / `#`, never a literal string compare.
 */

import { QueryBuilder } from '../db/queries';
import { NODE_KINDS, Node } from '../types';
import { Candidate, Refusal, Target, TargetSelector } from './types';

/**
 * FR-003a fork disposition for a resolved target's language, supplied by the plan
 * engine (which owns the SPEC-008 availability probe). The resolver consults it
 * ONLY for a local/parameter target — the one kind whose renameability differs by
 * path (FR-009 vs FR-010) — so the probe is paid only when it changes the outcome.
 * This is a command-availability probe ONLY (no server process is ever spawned to
 * reach this disposition), so its wording must never imply one was attempted:
 * - `available`                          — a server covers the language and is
 *   usable: the LSP path renames any kind (FR-009), so no local/parameter
 *   restriction.
 * - `absent`                             — LSP disabled or no server covers the
 *   language: the graph path applies; a local/parameter is refused (needs a
 *   language server).
 * - `unavailable-missing-command`        — LSP covers the language but nothing is
 *   configured/found for it (SPEC-008 `missing-default-command`): the graph path
 *   applies; the refusal says no server is configured or found.
 * - `unavailable-command-not-executable` — a server command IS configured for this
 *   language, but it isn't on PATH / isn't executable (SPEC-008
 *   `configured-command-unavailable`): the graph path applies AND the refusal
 *   names the CONFIGURED command as unavailable (FR-003a honesty clause) — never
 *   "did not respond", since no server was ever launched at probe time.
 */
export type LspPathDisposition =
  | 'available'
  | 'absent'
  | 'unavailable-missing-command'
  | 'unavailable-command-not-executable';

/** Kinds excluded from rename on EVERY path (FR-011). */
const EXCLUDED_KINDS: ReadonlySet<string> = new Set(['file', 'route', 'import', 'export']);
/** Kinds the graph path cannot cover: locals/parameters carry no tracked
 *  references, so only a language server can rename them (FR-010). */
const GRAPH_LOCAL_KINDS: ReadonlySet<string> = new Set(['variable', 'parameter']);
/** Recognized NodeKinds, for FR-021a `--kind` validation (mirrors the
 *  `query-parser.ts` precedent — derived from the canonical `NODE_KINDS`). */
const VALID_KINDS: ReadonlySet<string> = new Set<string>(NODE_KINDS);
/** A syntactically valid identifier (FR-021a): a Unicode letter / `_` / `$` start,
 *  then letters / digits / `_` / `$`. A conservative v1 shape covering the
 *  identifier grammar of the languages CodeGraph indexes. */
const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

export interface ResolveTargetOptions {
  /** The graph the resolver reads (same access pattern the plan path uses). */
  queries: QueryBuilder;
  /** The user's target identity (FR-006). */
  selector: TargetSelector;
  /**
   * FR-021a — the requested new name. When provided it is validated (non-empty ·
   * a syntactically valid identifier · not a no-op equal to the current name)
   * before the target is returned. Omitted by identity-only callers (the FR-006
   * basic contract), which skip new-name validation.
   */
  newName?: string;
  /**
   * FR-003a fork — the LSP-path {@link LspPathDisposition} for the RESOLVED target,
   * supplied by the plan engine. Consulted ONLY when the resolved target is a
   * local/parameter (FR-009/FR-010). Omitted by identity-only callers; a
   * local/parameter then resolves without the graph-path refusal.
   */
  lspPath?: (target: Target) => LspPathDisposition;
}

/** Split a (possibly scoped) name into its segments on `::` / `.` / `#`. */
function nameSegments(name: string): string[] {
  return name.split(/::|[.#]/).filter(Boolean);
}

/** True when `segments` ends with the whole `suffix` sequence. */
function endsWithSegments(segments: string[], suffix: string[]): boolean {
  if (suffix.length > segments.length) return false;
  const offset = segments.length - suffix.length;
  return suffix.every((seg, i) => segments[offset + i] === seg);
}

/** Workspace-relative path suffix match on a segment boundary (`a.ts` ⊂ `sub/a.ts`). */
function fileMatches(nodePath: string, wanted: string): boolean {
  const p = nodePath.replace(/\\/g, '/');
  const w = wanted.replace(/\\/g, '/').replace(/^\.\//, '');
  return p === w || p.endsWith(`/${w}`);
}

/** Build the resolved Target from a node — its span verbatim (research Decision 8). */
function toTarget(node: Node): Target {
  return {
    name: node.name,
    kind: node.kind,
    file: node.filePath,
    range: {
      start: { line: node.startLine, column: node.startColumn },
      end: { line: node.endLine, column: node.endColumn },
    },
  };
}

/**
 * Resolve `selector` to exactly one {@link Target}, or a success-shaped
 * {@link Refusal}. Pure over the graph — no file I/O.
 */
export function resolveTarget(options: ResolveTargetOptions): Target | Refusal {
  const { queries, selector, newName, lspPath } = options;

  // ── FR-021a input validation (target-independent) — BEFORE resolution.
  // An empty / syntactically-invalid new name is a success-shaped refusal naming
  // the offending argument (never a silent write).
  if (newName !== undefined && !IDENTIFIER.test(newName)) {
    return {
      reason: 'invalid-argument',
      message: `New name "${newName}" is not a valid identifier — provide a non-empty identifier for the target's language.`,
    };
  }
  // An unrecognized `--kind` is `invalid-argument` carrying every recognized
  // NodeKind (validKinds) — distinct from a well-formed but excluded kind
  // (excluded-kind, below) and a valid kind that simply matches nothing
  // (target-not-found, below), so a single corrected retry needs no file read.
  if (selector.kind !== undefined && !VALID_KINDS.has(selector.kind)) {
    return {
      reason: 'invalid-argument',
      message: `--kind "${selector.kind}" is not a recognized NodeKind. Valid kinds: ${NODE_KINDS.join(', ')}.`,
      validKinds: [...NODE_KINDS],
    };
  }

  // ── FR-006 resolution. Every symbol sharing the (last-segment) name is a
  // candidate; the qualifier and narrowing flags below whittle it down.
  const segments = nameSegments(selector.name);
  const bareName = segments[segments.length - 1] ?? selector.name;
  let candidates = queries.getNodesByName(bareName);

  // Qualified `Class.method`: keep candidates whose scoped name ends with the
  // selector's segments (separator-normalized).
  if (segments.length > 1) {
    candidates = candidates.filter((n) => endsWithSegments(nameSegments(n.qualifiedName), segments));
  }
  // --file: keep candidates declared in the named file (path suffix match).
  if (selector.file !== undefined) {
    const wantedFile = selector.file;
    candidates = candidates.filter((n) => fileMatches(n.filePath, wantedFile));
  }
  // --kind (already validated as a recognized kind): keep candidates of that kind.
  if (selector.kind !== undefined) {
    const wantedKind = selector.kind;
    candidates = candidates.filter((n) => n.kind === wantedKind);
  }

  if (candidates.length === 0) {
    return {
      reason: 'target-not-found',
      message: `No symbol matches "${selector.name}". Check the name, or narrow with --file / --kind.`,
    };
  }
  if (candidates.length > 1) {
    // FR-007: refuse (no writes, no guess) with every candidate + the exact
    // qualifier that uniquely selects it, so a single qualified retry succeeds
    // with zero files read (SC-003).
    return {
      reason: 'ambiguous-target',
      message: `"${selector.name}" matches ${candidates.length} symbols. Retry with one of the listed selectors (or narrow with --file / --kind).`,
      candidates: buildCandidates(candidates),
    };
  }

  const target = toTarget(candidates[0]!);

  // ── FR-021a no-op (needs the resolved name): renaming to the current name.
  if (newName !== undefined && newName === target.name) {
    return {
      reason: 'invalid-argument',
      message: `New name "${newName}" is the same as the current name — nothing to rename.`,
    };
  }

  // ── FR-011 excluded kinds — refused on EVERY path.
  if (EXCLUDED_KINDS.has(target.kind)) {
    return {
      reason: 'excluded-kind',
      message: `Cannot rename a "${target.kind}" symbol — file, route, import, and export kinds are excluded from rename on every path.`,
    };
  }

  // ── FR-010 graph-path locals/parameters — refused when the graph path handles
  // this rename; the LSP path (FR-009) renames any kind, so `available` lifts it.
  if (GRAPH_LOCAL_KINDS.has(target.kind) && lspPath) {
    const disposition = lspPath(target);
    if (disposition !== 'available') {
      return { reason: 'unsupported-kind-graph-local', message: graphLocalMessage(target, disposition) };
    }
  }

  return target;
}

/**
 * Build the FR-007 candidate list: each match with the exact qualifier that
 * uniquely selects IT among the matches (SC-003). The preference order mirrors
 * the user-facing qualifiers — a scoped `Class.method`, else `--file <path>`,
 * else `--kind <kind>` — and every returned selector is checked (via the
 * resolver's own matching rules) to actually resolve to a single match, so a
 * retry lands on exactly this candidate.
 */
function buildCandidates(matches: Node[]): Candidate[] {
  return matches.map((node) => ({
    name: node.name,
    kind: node.kind,
    file: node.filePath,
    line: node.startLine,
    selector: uniqueSelector(node, matches),
  }));
}

/** The most user-friendly qualifier that selects `node` and no other of
 *  `matches`: a scoped `Class.method` suffix, else `--file <path>`, else
 *  `--kind <kind>`; falls back to the fully-qualified dotted name. */
function uniqueSelector(node: Node, matches: Node[]): string {
  // 1. Qualified `Class.method` — the shortest scoped suffix (>=2 segments) that
  //    is unique among the matches (matched by the resolver's segment-suffix rule).
  const segs = nameSegments(node.qualifiedName);
  for (let take = 2; take <= segs.length; take++) {
    const suffix = segs.slice(segs.length - take);
    if (matches.filter((m) => endsWithSegments(nameSegments(m.qualifiedName), suffix)).length === 1) {
      return suffix.join('.');
    }
  }
  // 2. --file <path> — a unique declaration file among the matches.
  if (matches.filter((m) => fileMatches(m.filePath, node.filePath)).length === 1) {
    return `--file ${node.filePath}`;
  }
  // 3. --kind <kind> — a unique kind among the matches.
  if (matches.filter((m) => m.kind === node.kind).length === 1) {
    return `--kind ${node.kind}`;
  }
  // 4. Best effort — the fully-qualified dotted name (still the most specific).
  return segs.length >= 2 ? segs.join('.') : `--file ${node.filePath}`;
}

/** The FR-010 refusal message, truthful per FR-003a about WHY the LSP path isn't
 *  available. `lspPathDisposition` is a command-availability probe only — no
 *  server process is ever spawned to reach any of these dispositions — so the
 *  message never claims a server "did not respond": `unavailable-command-not-
 *  executable` names the CONFIGURED command as unavailable (not on PATH / not
 *  executable, the FR-003a honesty case); `absent` and `unavailable-missing-
 *  command` both mean no server is configured or found for the language. */
function graphLocalMessage(target: Target, disposition: LspPathDisposition): string {
  const who = `the ${target.kind} "${target.name}"`;
  if (disposition === 'unavailable-command-not-executable') {
    return `Cannot rename ${who}: renaming a local or parameter needs a working language server, but the configured server command is not available (not on PATH or not executable). Fix the configured command and retry.`;
  }
  if (disposition === 'unavailable-missing-command') {
    return `Cannot rename ${who} on the graph path — no local usage tracking for locals/parameters, which needs a language server, but none is configured or found for this language. Configure a language server command and retry.`;
  }
  return `Cannot rename ${who} on the graph path — no local usage tracking for locals/parameters, which needs a language server. Enable an LSP server for this language and retry.`;
}
