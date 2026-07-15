/**
 * SPEC-011 — Execution Flows: deterministic flow naming (T022, FR-010).
 *
 * A flow is named by its route method+path when route-rooted, by its CLI command
 * name when CLI-rooted, and otherwise by its qualified root symbol.
 */

import type { EntryPoint } from './entry-points';

/** Name a flow from its entry point (FR-010). */
export function nameFlow(entry: EntryPoint): string {
  if (entry.entryKind === 'route') return entry.routeName ?? entry.rootName;
  if (entry.entryKind === 'cli') return entry.commandName ?? entry.rootName;
  return entry.rootQualifiedName ?? entry.rootName;
}
