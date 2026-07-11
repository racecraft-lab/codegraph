/**
 * FR-006 — target selector resolution (SPEC-010).
 *
 * Resolves a {@link TargetSelector} — a bare name or a qualified `Class.method`,
 * optionally narrowed by `--file` / `--kind` — to exactly one {@link Target}
 * (the declaration's name/kind/file plus its span read verbatim from the node),
 * or a success-shaped {@link Refusal}.
 *
 * This is the BASIC contract (T017): an unmatched selector is `target-not-found`;
 * a surviving multi-match is a placeholder `ambiguous-target` whose candidate
 * list US2 (T026) fills in — along with the `unsupported-kind-graph-local` /
 * `excluded-kind` / `invalid-argument` refusals, which slot in ahead of the
 * narrowing filters here without reshaping this function's return type.
 *
 * Qualified matching is separator-normalized: a method's stored `qualified_name`
 * uses the language's own scope separator (`Worker::handle` for TS), so a
 * `Worker.handle` selector is matched by comparing name SEGMENTS split on
 * `::` / `.` / `#`, never a literal string compare.
 */

import { QueryBuilder } from '../db/queries';
import { Node } from '../types';
import { Refusal, Target, TargetSelector } from './types';

export interface ResolveTargetOptions {
  /** The graph the resolver reads (same access pattern the plan path uses). */
  queries: QueryBuilder;
  /** The user's target identity (FR-006). */
  selector: TargetSelector;
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
  const { queries, selector } = options;

  const segments = nameSegments(selector.name);
  const bareName = segments[segments.length - 1] ?? selector.name;

  // Every symbol sharing the (last-segment) name is a candidate; the qualifier
  // and narrowing flags below whittle it down.
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
  // --kind: keep candidates of the named kind. Raw string compare — an
  // unrecognized kind matches nothing here; T026 promotes that to an
  // `invalid-argument` refusal carrying `validKinds`.
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
    // Placeholder — US2 (T026) attaches the full candidate list with a
    // uniquely-selecting qualifier per candidate (FR-007).
    return {
      reason: 'ambiguous-target',
      message: `"${selector.name}" matches ${candidates.length} symbols. Qualify with Class.method, --file, or --kind.`,
    };
  }
  return toTarget(candidates[0]!);
}
