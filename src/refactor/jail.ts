/**
 * FR-017 path jail + index-scope guard (SPEC-010) — the pre-write gate that
 * confines every rename edit to the workspace root and to files the index
 * actually covers.
 *
 * Pure over paths: it inspects only path metadata (lexical containment plus a
 * symlink `realpath` on both sides) and the project's scope config — it NEVER
 * reads an edited file's content. That is FR-017's **refuse-before-read**
 * guarantee: a path outside the root or in ignored scope is refused before its
 * bytes are ever read for span verification (FR-005 / FR-016), so plan
 * derivation never discloses a file it would refuse to write.
 *
 * Both refusals are **whole-plan** (never a partial apply) and **success-shaped**
 * — a returned {@link Refusal} object, deliberately NOT the isError-shaped
 * `PathRefusalError` (FR-023). Mapping the refusal onto a CLI exit code / MCP
 * result shape is the caller's job (the apply engine, and the plan-engine
 * plan-time guard); this seam only returns the object.
 *
 * Reuses the existing security-reviewed primitives rather than reimplementing
 * them (research Decision 5): {@link validatePathWithinRoot} for the
 * symlink-resolved containment jail, and {@link buildScopeIgnore} — the SAME
 * matcher the indexer and file watcher share, honoring `codegraph.json`
 * `include` / `exclude` — never a raw `.gitignore` reparse.
 */

import * as path from 'path';
import { validatePathWithinRoot, normalizePath } from '../utils';
import { buildScopeIgnore } from '../extraction';
import type { Refusal } from './types';

/** Inputs to {@link checkPlanJail}: the workspace root and the plan's edited files. */
export interface PlanJailInput {
  /** Absolute workspace root the edits must stay within. */
  projectRoot: string;
  /** The plan's edited file paths (workspace-relative, as carried on each RenameEdit). */
  files: string[];
}

/**
 * Refuse the whole plan when any edited file escapes the workspace root
 * (`out-of-root`) or is in-root but excluded from index scope (`scope-ignored`),
 * else `null`. Out-of-root — the content-leak condition — takes precedence when a
 * plan mixes both, and its refusal lists only the escaping files. Per FR-017 the
 * refusal names every offending file in `files` (deduped, sorted for
 * deterministic surface parity).
 */
export function checkPlanJail(input: PlanJailInput): Refusal | null {
  const { projectRoot } = input;
  const files = [...new Set(input.files)];

  // Jail (symlink-resolved containment, refuse-before-read): validatePathWithinRoot
  // realpaths BOTH sides, so a symlinked root and case-variant paths compare at
  // their real on-disk location and an in-root symlink whose target escapes the
  // root is caught — while a `../` escape is rejected lexically. It reads no file
  // content, so a not-yet-existing offending path is still refused on the path
  // alone (never opened).
  const outOfRoot = files.filter((f) => validatePathWithinRoot(projectRoot, f) === null).sort();
  if (outOfRoot.length > 0) {
    return {
      reason: 'out-of-root',
      message:
        `Refusing the rename: ${outOfRoot.join(', ')} ` +
        `${outOfRoot.length === 1 ? 'resolves' : 'resolve'} outside the workspace root. ` +
        `Renames are confined to the workspace root.`,
      files: outOfRoot,
    };
  }

  // Scope (reached only when every file is in-root): the shared indexer/watcher
  // matcher — codegraph.json exclude/include plus .gitignore — fed the same
  // project-relative POSIX path the watcher uses, never a raw .gitignore reparse.
  const scope = buildScopeIgnore(projectRoot);
  const scopeIgnored = files
    .filter((f) => scope.ignores(normalizePath(path.relative(projectRoot, path.resolve(projectRoot, f)))))
    .sort();
  if (scopeIgnored.length > 0) {
    return {
      reason: 'scope-ignored',
      message:
        `Refusing the rename: ${scopeIgnored.join(', ')} ` +
        `${scopeIgnored.length === 1 ? 'is' : 'are'} inside the workspace root but excluded from ` +
        `index scope (gitignored or codegraph.json exclude). Bring the file into scope with a ` +
        `codegraph.json include, or edit it manually.`,
      files: scopeIgnored,
    };
  }

  return null;
}
